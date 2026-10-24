"use client";
import { readErrorMessage } from "@/lib/errors";

// One AIOStreams collection, as its own page (/catalogs/aiostreams-collections/
// <id>, or /new) - the same shape as a Nuvio collection: open it and you see
// the titles in it, search to add more, × to take one out, drag to reorder. A collection's
// titles live in SlickSync catalogs (usually one, named like the collection),
// so Discover's "Add to Catalogs" fills it too. Everything saves as it
// happens - there is no Save step to forget.

import type { DragEndEvent } from "@dnd-kit/core";
import { arrayMove, rectSortingStrategy } from "@dnd-kit/sortable";
import {
    ArrowLeftIcon,
    CheckIcon,
    ChevronDownIcon,
    MagnifyingGlassIcon,
    PlusIcon,
    Squares2X2Icon,
    TrashIcon,
    XMarkIcon,
} from "@heroicons/react/24/outline";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Breadcrumbs, Header } from "@/components/layout/Header";
import { NebulaPageHeading } from "@/components/layout/NebulaTopbar";
import { PageSection } from "@/components/layout/PageContainer";
import {
    Button,
    Card,
    ConfirmModal,
    CSS,
    closestCenter,
    DndContext,
    MediaDetailModal,
    PosterCard,
    SortableContext,
    useSortable,
    useSortableSensors,
} from "@/components/ui";
import { ScrollRow } from "@/components/ui/ScrollRow";
import { toast } from "@/components/ui/Toast";
import {
    type AioCollection,
    type AioCollectionsView,
    api,
    type CustomList,
    type CustomListItem,
    type DiscoverItem,
} from "@/lib/api";
import { usePersonalFeatures } from "@/lib/hooks/usePersonalFeatures";
import { useLayoutMode } from "@/lib/layout-mode";
import { cachedImageUrl, posterUrl } from "@/lib/posterUrl";

const LIST = "/catalogs/aiostreams-collections";

const noop = () => undefined;

function toPosterItem(t: {
    id: string;
    type: "movie" | "series";
    name: string;
    poster?: string | null;
    year?: number | string | null;
    releaseInfo?: string | null;
}) {
    return {
        id: t.id,
        name: t.name,
        poster: t.poster ?? null,
        releaseInfo: t.releaseInfo ?? (t.year ? String(t.year) : null),
        type: t.type,
    };
}

// `order` is only used by a collection built from several catalogs - one
// built from a single catalog takes that catalog's own order.
interface Form {
    catalogIds: string[];
    coverUrl: string;
    name: string;
    order: string[];
}

function newId() {
    return `c-${Math.random().toString(36).slice(2, 12)}`;
}

// The form's starting values, or null while that collection isn't in hand yet.
function formFrom(view: AioCollectionsView | null, id: string): Form | null {
    if (id === "new") {
        return { catalogIds: [], coverUrl: "", name: "", order: [] };
    }
    const existing = view?.collections.find((c) => c.id === id);
    return existing
        ? {
              catalogIds: existing.catalogIds,
              coverUrl: existing.coverUrl || "",
              name: existing.name,
              order: existing.order ?? [],
          }
        : null;
}

const stored = (
    list: Pick<AioCollection, "id" | "name" | "coverUrl" | "catalogIds" | "hidden" | "order">[]
) =>
    list.map(({ id, name, coverUrl, catalogIds, hidden, order }) => ({
        catalogIds,
        coverUrl,
        hidden,
        id,
        name,
        order,
    }));

const isImdb = (id: string) => /^tt\d+$/.test(id);

// The same PosterCard the catalog page and Discover use - same artwork, same
// long-press / right-click menu, where Remove takes a title out - wired for drag.
function TitleTile({
    t,
    onOpen,
    onRemove,
    menuOpen,
    onMenuOpenChange,
}: {
    t: CustomListItem;
    onOpen: () => void;
    onRemove: () => void;
    menuOpen: boolean;
    onMenuOpenChange: (open: boolean, itemId: string) => void;
}) {
    const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
        id: t.id,
    });
    return (
        <div
            className={`group relative ${isDragging ? "opacity-50" : ""}`}
            ref={setNodeRef}
            style={{
                transform: CSS.Transform.toString(transform),
                transition: isDragging ? "none" : transition,
                zIndex: isDragging ? 50 : undefined,
            }}
            {...attributes}
            {...listeners}
        >
            <PosterCard
                isMenuOpen={menuOpen}
                item={toPosterItem(t)}
                onMenuOpenChange={onMenuOpenChange}
                onOpenDetails={onOpen}
                onRemoveFromCatalog={onRemove}
                onToggleWatched={noop}
                onToggleWatchlist={noop}
                removeLabel="Remove from collection"
                showWatchedMenu={false}
                showWatchlistMenu={false}
            />
        </div>
    );
}

export default function AiostreamsCollectionPage() {
    const router = useRouter();
    const params = useParams();
    const searchParams = useSearchParams();
    const userId = searchParams.get("user") || "";
    // The profile whose collections these are, when it isn't the account's.
    const profileId = searchParams.get("profile") || null;
    const scope = `user=${encodeURIComponent(userId)}${profileId ? `&profile=${encodeURIComponent(profileId)}` : ""}`;
    const listPath = `${LIST}?${scope}`;
    const collectionId = String(params.collectionId || "new");
    const isNew = collectionId === "new";
    const { layoutMode } = useLayoutMode();

    const [initial] = useState(() => {
        const cached = userId
            ? (api.peekGet<AioCollectionsView>(api.aioCollectionsPath(userId, profileId)) ?? null)
            : null;
        return { form: formFrom(cached, collectionId), view: cached };
    });
    const [view, setView] = useState<AioCollectionsView | null>(initial.view);
    const [form, setForm] = useState<Form>(
        initial.form ?? { catalogIds: [], coverUrl: "", name: "", order: [] }
    );
    const [ready, setReady] = useState(!!initial.form);
    const filled = useRef(!!initial.form);
    const [lists, setLists] = useState<CustomList[] | null>(null);
    const [creating, setCreating] = useState(false);
    const [confirmRemove, setConfirmRemove] = useState(false);
    const [showSources, setShowSources] = useState(false);
    const [detail, setDetail] = useState<CustomListItem | null>(null);
    const [busyTitle, setBusyTitle] = useState<string | null>(null);
    // One title's long-press / right-click menu open at a time, as on the catalog page.
    const [menuTitleId, setMenuTitleId] = useState<string | null>(null);
    const onMenuOpenChange = useCallback((open: boolean, itemId: string) => {
        setMenuTitleId((cur) => (open ? itemId : cur === itemId ? null : cur));
    }, []);

    const [query, setQuery] = useState("");
    const [results, setResults] = useState<DiscoverItem[]>([]);
    const [searching, setSearching] = useState(false);

    // Saves go one after another, newest arrangement last; `latest` is the
    // whole arrangement as the server last saw it (plus anything queued).
    const queue = useRef<Promise<unknown>>(Promise.resolve());
    const latest = useRef<AioCollection[]>(initial.view?.collections ?? []);
    const typingTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

    useEffect(() => {
        if (!userId) {
            router.replace(LIST);
            return;
        }
        api.getAioCollections(userId, profileId)
            .then((next) => {
                setView(next);
                latest.current = next.collections;
                const f = formFrom(next, collectionId);
                if (!f) {
                    toast.error("That collection is gone");
                    router.replace(listPath);
                    return;
                }
                if (!filled.current) {
                    filled.current = true;
                    setForm(f);
                    setReady(true);
                }
            })
            .catch((e: any) => toast.error(e?.message || "Could not load the collections"));
        api.getLists()
            .then((r) => setLists(Array.isArray(r) ? r.filter((l) => l.isOwner) : []))
            .catch(() => setLists([]));
    }, [collectionId, router, userId, profileId, listPath]);

    useEffect(
        () => () => {
            if (typingTimer.current) {
                clearTimeout(typingTimer.current);
            }
        },
        []
    );

    const listsRef = useRef<CustomList[] | null>(null);
    useEffect(() => {
        listsRef.current = lists;
    }, [lists]);
    const listById = useMemo(() => new Map((lists ?? []).map((l) => [l.id, l])), [lists]);
    const catalogs = useMemo(() => view?.catalogs ?? [], [view]);
    // Where new titles go: the collection's first catalog.
    const home = listById.get(form.catalogIds[0]) || null;

    // The collection's titles: its catalogs' titles, in order, each once - the
    // same thing AIOStreams is served (server/utils/aioCollections.js).
    const titles = useMemo(() => {
        const seen = new Set<string>();
        const out: CustomListItem[] = [];
        for (const id of form.catalogIds) {
            for (const item of listById.get(id)?.items ?? []) {
                if (!isImdb(item.id) || seen.has(item.id)) {
                    continue;
                }
                seen.add(item.id);
                out.push(item);
            }
        }
        if (form.order.length === 0) {
            return out;
        }
        const rank = new Map(form.order.map((id, i) => [id, i]));
        return out
            .map((item, i) => ({ item, key: rank.get(item.id) ?? form.order.length + i }))
            .sort((a, b) => a.key - b.key)
            .map((x) => x.item);
    }, [form.catalogIds, form.order, listById]);
    const inCollection = useMemo(() => new Set(titles.map((t) => t.id)), [titles]);
    // The collection's own cover, its first catalog's, or its first title's
    // poster - that last one shown the way the poster cards below show it.
    const { rpdbEnabled } = usePersonalFeatures();
    const ownCover =
        form.coverUrl.trim() || listById.get(form.catalogIds[0])?.coverImageUrl || null;
    const firstTitle = titles.find((t) => t.poster);
    const cover = ownCover
        ? cachedImageUrl(ownCover, 342)
        : firstTitle
          ? posterUrl(firstTitle, rpdbEnabled)
          : null;

    const persist = useCallback(
        (next: Form) => {
            queue.current = queue.current.then(async () => {
                const mine = latest.current.find((c) => c.id === collectionId);
                if (!mine) {
                    return;
                }
                const entry = {
                    ...mine,
                    catalogIds: next.catalogIds,
                    coverUrl: next.coverUrl.trim() || null,
                    name: next.name.trim() || mine.name,
                    order: next.order,
                };
                const list = latest.current.map((c) => (c.id === collectionId ? entry : c));
                try {
                    await api.saveAioCollections(userId, stored(list), profileId);
                    latest.current = list;
                    // A collection with its own same-named catalog keeps the two names
                    // together, so Discover's Add to Catalogs shows the new name too.
                    const only =
                        entry.catalogIds.length === 1
                            ? listsRef.current?.find((l) => l.id === entry.catalogIds[0])
                            : null;
                    if (only && only.name === mine.name && entry.name !== mine.name) {
                        await api.updateList(only.id, { name: entry.name });
                        setLists((prev) =>
                            (prev ?? []).map((l) =>
                                l.id === only.id ? { ...l, name: entry.name } : l
                            )
                        );
                    }
                } catch (e) {
                    toast.error(readErrorMessage(e, "Could not save that change"));
                }
            });
        },
        [collectionId, userId, profileId]
    );

    // Typing saves a moment after the last key; picking catalogs saves at once.
    const editText = (patch: Partial<Form>) => {
        const next = { ...form, ...patch };
        setForm(next);
        if (isNew) {
            return;
        }
        if (typingTimer.current) {
            clearTimeout(typingTimer.current);
        }
        typingTimer.current = setTimeout(() => persist(next), 700);
    };
    const toggleCatalog = (id: string) => {
        const on = form.catalogIds.includes(id);
        if (on && form.catalogIds.length === 1) {
            toast.error("A collection needs at least one catalog");
            return;
        }
        const next = {
            ...form,
            catalogIds: on ? form.catalogIds.filter((x) => x !== id) : [...form.catalogIds, id],
        };
        setForm(next);
        persist(next);
    };

    // Search as you type, movies and shows together.
    useEffect(() => {
        const q = query.trim();
        if (q.length < 2) {
            setResults([]);
            setSearching(false);
            return;
        }
        setSearching(true);
        const t = setTimeout(async () => {
            const [movies, shows] = await Promise.all([
                api.discoverSearch("movie", q),
                api.discoverSearch("series", q),
            ]);
            const merged: DiscoverItem[] = [];
            for (let i = 0; i < Math.max(movies.length, shows.length); i++) {
                if (movies[i]) {
                    merged.push(movies[i]);
                }
                if (shows[i]) {
                    merged.push(shows[i]);
                }
            }
            setResults(merged.filter((r) => isImdb(r.id)).slice(0, 24));
            setSearching(false);
        }, 350);
        return () => clearTimeout(t);
    }, [query]);

    // Dragging a title: a collection from one catalog reorders that catalog
    // (so the catalog page and AIOStreams agree); one from several keeps its
    // own order. Letting go also lands as a tap - not an open.
    const sensors = useSortableSensors();
    const draggedAt = useRef(0);
    const onDragEnd = async (e: DragEndEvent) => {
        draggedAt.current = Date.now();
        const { active, over } = e;
        if (!over || active.id === over.id) {
            return;
        }
        const from = titles.findIndex((t) => t.id === active.id);
        const to = titles.findIndex((t) => t.id === over.id);
        if (from < 0 || to < 0) {
            return;
        }
        const moved = arrayMove(titles, from, to);
        if (form.catalogIds.length === 1 && home) {
            const before = home;
            const others = home.items.filter((i) => !isImdb(i.id));
            const items = [...moved, ...others];
            setLists((prev) => (prev ?? []).map((l) => (l.id === home.id ? { ...l, items } : l)));
            if (form.order.length > 0) {
                const next = { ...form, order: [] };
                setForm(next);
                persist(next);
            }
            try {
                await api.reorderListItems(
                    home.id,
                    items.map((i) => i.id)
                );
            } catch (err) {
                toast.error(readErrorMessage(err, "Could not save the new order"));
                setLists((prev) => (prev ?? []).map((l) => (l.id === before.id ? before : l)));
            }
            return;
        }
        const next = { ...form, order: moved.map((t) => t.id) };
        setForm(next);
        persist(next);
    };
    const openTitle = (t: CustomListItem) => {
        if (Date.now() - draggedAt.current < 300) {
            return;
        }
        setDetail(t);
    };

    const replaceList = (updated: CustomList) =>
        setLists((prev) =>
            (prev ?? []).map((l) => (l.id === updated.id ? { ...updated, isOwner: true } : l))
        );

    const addTitle = async (item: DiscoverItem) => {
        if (!home) {
            toast.error("This collection has no catalog of yours to add to");
            return;
        }
        setBusyTitle(item.id);
        try {
            const year = item.releaseInfo ? Number.parseInt(item.releaseInfo, 10) || null : null;
            replaceList(
                await api.addToList(home.id, {
                    id: item.id,
                    name: item.name,
                    poster: item.poster,
                    type: item.type,
                    year,
                })
            );
            toast.success(`Added ${item.name}`);
        } catch (e) {
            toast.error(readErrorMessage(e, "Could not add it"));
        } finally {
            setBusyTitle(null);
        }
    };

    // Out of the collection = out of every one of its catalogs that has it.
    const removeTitle = async (item: CustomListItem) => {
        setBusyTitle(item.id);
        try {
            for (const id of form.catalogIds) {
                const list = listById.get(id);
                if (list?.items.some((i) => i.id === item.id)) {
                    replaceList(await api.removeFromList(id, item.id));
                }
            }
        } catch (e) {
            toast.error(readErrorMessage(e, "Could not take it out"));
        } finally {
            setBusyTitle(null);
        }
    };

    // A new collection gets its own catalog, named the same, so it shows up in
    // Discover's "Add to Catalogs" too. Then it opens like any other.
    const create = async () => {
        const name = form.name.trim();
        if (!name) {
            toast.error("Give the collection a name");
            return;
        }
        setCreating(true);
        try {
            const list = await api.createList(name);
            const current = await api.getAioCollections(userId, profileId);
            const id = newId();
            await api.saveAioCollections(
                userId,
                stored([
                    ...current.collections,
                    {
                        catalogIds: [list.id],
                        coverUrl: form.coverUrl.trim() || null,
                        hidden: false,
                        id,
                        name,
                    },
                ]),
                profileId
            );
            router.replace(`${LIST}/${id}?${scope}`);
        } catch (e) {
            toast.error(readErrorMessage(e, "Could not make the collection"));
            setCreating(false);
        }
    };

    const remove = async () => {
        await queue.current;
        try {
            await api.saveAioCollections(
                userId,
                stored(latest.current.filter((c) => c.id !== collectionId)),
                profileId
            );
            toast.success("Collection removed");
            router.push(listPath);
        } catch (e) {
            toast.error(readErrorMessage(e, "Could not remove it"));
        }
    };

    const goBack = async () => {
        if (typingTimer.current) {
            clearTimeout(typingTimer.current);
            typingTimer.current = null;
            if (!isNew) {
                persist(form);
            }
        }
        await queue.current;
        router.push(listPath);
    };

    const backButton = (
        <Button
            leftIcon={<ArrowLeftIcon className="h-4 w-4" />}
            onClick={goBack}
            size="sm"
            variant="ghost"
        >
            Back
        </Button>
    );
    const actions = isNew ? (
        <Button isLoading={creating} onClick={create} size="sm" variant="primary">
            Create
        </Button>
    ) : (
        <Button
            disabled={!ready}
            leftIcon={<TrashIcon className="h-4 w-4" />}
            onClick={() => setConfirmRemove(true)}
            size="sm"
            variant="ghost"
        >
            Remove
        </Button>
    );
    const title = isNew ? "New collection" : form.name.trim() || "Collection";
    const subtitle = isNew
        ? "A collection in AIOStreams’ apps"
        : `${titles.length} title${titles.length === 1 ? "" : "s"} · changes save as you go`;
    const field = "w-full px-4 py-3 rounded-xl text-sm";
    const fieldStyle = {
        background: "var(--color-bg)",
        border: "1px solid var(--color-surface-border)",
        color: "var(--color-text)",
    };
    const grid = "grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 gap-3";
    // Search results on a phone: one row that scrolls sideways, so the
    // collection itself stays in view below; the usual grid from sm up.
    const resultsRow =
        "flex gap-3 snap-x snap-mandatory scroll-px-4 -mx-4 px-4 pb-2 sm:scroll-px-0 sm:mx-0 sm:px-0 sm:pb-0 sm:overflow-visible sm:grid sm:grid-cols-4 md:grid-cols-6";
    const resultCell = "w-[30%] shrink-0 snap-start sm:w-auto";

    return (
        <>
            {layoutMode !== "nebula" && (
                <Header
                    actions={
                        <div className="flex items-center gap-2">
                            {backButton}
                            {actions}
                        </div>
                    }
                    subtitle={subtitle}
                    title={
                        <Breadcrumbs
                            className="font-semibold text-xl"
                            items={[
                                { href: "/catalogs", label: "Catalogs" },
                                { href: listPath, label: "Jellyfin | AIOStreams Collections" },
                                { label: title },
                            ]}
                        />
                    }
                />
            )}
            <div className={layoutMode === "nebula" ? "px-4 pt-6 pb-8 md:px-6" : "p-8"}>
                <div
                    className={layoutMode === "nebula" ? "mx-auto" : ""}
                    style={
                        layoutMode === "nebula"
                            ? { maxWidth: "var(--interface-content-width)" }
                            : undefined
                    }
                >
                    {layoutMode === "nebula" && (
                        <NebulaPageHeading
                            actions={actions}
                            leading={backButton}
                            subtitle={subtitle}
                            title={title}
                        />
                    )}

                    <PageSection>
                        {ready ? (
                            <div className="space-y-6">
                                <Card className="sm:p-6" padding="md">
                                    <div className="flex gap-4 sm:gap-5">
                                        <div className="w-20 shrink-0 self-start sm:w-32">
                                            <div className="relative aspect-[2/3] overflow-hidden rounded-2xl border border-default bg-surface-hover">
                                                {cover ? (
                                                    // eslint-disable-next-line @next/next/no-img-element
                                                    <img
                                                        alt=""
                                                        className="absolute inset-0 h-full w-full object-cover"
                                                        src={cover}
                                                    />
                                                ) : (
                                                    <div className="absolute inset-0 flex items-center justify-center">
                                                        <Squares2X2Icon className="h-8 w-8 text-muted sm:h-10 sm:w-10" />
                                                    </div>
                                                )}
                                            </div>
                                        </div>
                                        <div className="min-w-0 flex-1 space-y-3 sm:space-y-4">
                                            <div>
                                                <label
                                                    className="mb-2 block font-medium text-default text-sm"
                                                    htmlFor="aio-col-name"
                                                >
                                                    Name
                                                </label>
                                                <input
                                                    autoFocus={isNew}
                                                    className={field}
                                                    id="aio-col-name"
                                                    maxLength={80}
                                                    onChange={(e) =>
                                                        editText({ name: e.target.value })
                                                    }
                                                    onKeyDown={(e) => {
                                                        if (isNew && e.key === "Enter") {
                                                            create();
                                                        }
                                                    }}
                                                    style={fieldStyle}
                                                    value={form.name}
                                                />
                                            </div>
                                            <div>
                                                <label
                                                    className="mb-2 block font-medium text-default text-sm"
                                                    htmlFor="aio-col-cover"
                                                >
                                                    Cover image address
                                                </label>
                                                <input
                                                    className={field}
                                                    id="aio-col-cover"
                                                    onChange={(e) =>
                                                        editText({ coverUrl: e.target.value })
                                                    }
                                                    placeholder="Optional - first title's poster"
                                                    style={fieldStyle}
                                                    value={form.coverUrl}
                                                />
                                            </div>
                                        </div>
                                    </div>
                                </Card>

                                {isNew ? (
                                    <p className="text-center text-muted text-sm">
                                        Name it and press Create - then search for titles to put in
                                        it.
                                    </p>
                                ) : (
                                    <>
                                        <div>
                                            <div className="relative mb-3">
                                                <MagnifyingGlassIcon className="pointer-events-none absolute top-1/2 left-4 h-4 w-4 -translate-y-1/2 text-muted" />
                                                <input
                                                    aria-label="Search movies and shows to add"
                                                    className={`${field} pr-10 pl-10`}
                                                    onChange={(e) => setQuery(e.target.value)}
                                                    placeholder="Search movies and shows to add"
                                                    style={fieldStyle}
                                                    value={query}
                                                />
                                                {query && (
                                                    <button
                                                        aria-label="Clear search"
                                                        className="absolute top-1/2 right-3 -translate-y-1/2 rounded-lg p-1 text-muted hover:text-default"
                                                        onClick={() => setQuery("")}
                                                        type="button"
                                                    >
                                                        <XMarkIcon className="h-4 w-4" />
                                                    </button>
                                                )}
                                            </div>
                                            {query.trim().length >= 2 &&
                                                (searching ? (
                                                    <ScrollRow className={resultsRow}>
                                                        {Array.from({ length: 8 }).map((_, i) => (
                                                            <div
                                                                className={`${resultCell} aspect-[2/3] animate-pulse rounded-xl bg-surface-hover`}
                                                                key={i}
                                                            />
                                                        ))}
                                                    </ScrollRow>
                                                ) : results.length === 0 ? (
                                                    <p className="text-muted text-sm">
                                                        Nothing found for “{query.trim()}”.
                                                    </p>
                                                ) : (
                                                    <ScrollRow className={resultsRow}>
                                                        {results.map((r) => {
                                                            const added = inCollection.has(r.id);
                                                            return (
                                                                <div
                                                                    className={`relative ${resultCell}`}
                                                                    key={`${r.type}-${r.id}`}
                                                                >
                                                                    <PosterCard
                                                                        item={toPosterItem(r)}
                                                                        onOpenDetails={() =>
                                                                            setDetail({
                                                                                id: r.id,
                                                                                name: r.name,
                                                                                poster: r.poster,
                                                                                type: r.type,
                                                                            })
                                                                        }
                                                                        onToggleWatched={noop}
                                                                        onToggleWatchlist={noop}
                                                                        showWatchedMenu={false}
                                                                        showWatchlistMenu={false}
                                                                    />
                                                                    <button
                                                                        aria-label={
                                                                            added
                                                                                ? `${r.name} is in this collection`
                                                                                : `Add ${r.name}`
                                                                        }
                                                                        className={`absolute top-1.5 right-1.5 z-10 flex h-8 w-8 items-center justify-center rounded-full shadow transition-colors ${added ? "bg-primary" : "bg-black/70 hover:bg-primary"}`}
                                                                        disabled={
                                                                            busyTitle === r.id ||
                                                                            added
                                                                        }
                                                                        onClick={() =>
                                                                            added
                                                                                ? undefined
                                                                                : addTitle(r)
                                                                        }
                                                                        title={
                                                                            added
                                                                                ? "In this collection"
                                                                                : "Add to this collection"
                                                                        }
                                                                        type="button"
                                                                    >
                                                                        {added ? (
                                                                            <CheckIcon className="h-4 w-4 text-white" />
                                                                        ) : (
                                                                            <PlusIcon className="h-4 w-4 text-white" />
                                                                        )}
                                                                    </button>
                                                                </div>
                                                            );
                                                        })}
                                                    </ScrollRow>
                                                ))}
                                        </div>

                                        <div>
                                            <div className="mb-3 flex flex-col gap-0.5 sm:flex-row sm:items-baseline sm:justify-between sm:gap-3">
                                                <h2 className="font-semibold text-base text-default">
                                                    In this collection
                                                </h2>
                                                {titles.length > 0 && (
                                                    <p className="text-muted text-xs">
                                                        Drag to reorder · hold or right-click a
                                                        title to remove it
                                                    </p>
                                                )}
                                            </div>
                                            {lists === null ? (
                                                <div className={grid}>
                                                    {Array.from({ length: 8 }).map((_, i) => (
                                                        <div
                                                            className="aspect-[2/3] animate-pulse rounded-xl bg-surface-hover"
                                                            key={i}
                                                        />
                                                    ))}
                                                </div>
                                            ) : titles.length === 0 ? (
                                                <Card padding="lg">
                                                    <p className="text-center text-muted text-sm">
                                                        Nothing in it yet. Search above, or use Add
                                                        to Catalogs on any title in Discover
                                                        {home ? ` and pick “${home.name}”` : ""}.
                                                    </p>
                                                </Card>
                                            ) : (
                                                <DndContext
                                                    collisionDetection={closestCenter}
                                                    onDragCancel={() => {
                                                        draggedAt.current = Date.now();
                                                    }}
                                                    onDragEnd={onDragEnd}
                                                    sensors={sensors}
                                                >
                                                    <SortableContext
                                                        items={titles.map((t) => t.id)}
                                                        strategy={rectSortingStrategy}
                                                    >
                                                        <div className={grid}>
                                                            {titles.map((t) => (
                                                                <TitleTile
                                                                    key={t.id}
                                                                    menuOpen={menuTitleId === t.id}
                                                                    onMenuOpenChange={
                                                                        onMenuOpenChange
                                                                    }
                                                                    onOpen={() => openTitle(t)}
                                                                    onRemove={() => removeTitle(t)}
                                                                    t={t}
                                                                />
                                                            ))}
                                                        </div>
                                                    </SortableContext>
                                                </DndContext>
                                            )}
                                        </div>

                                        <div className="rounded-2xl border border-default">
                                            <button
                                                aria-expanded={showSources}
                                                className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left"
                                                onClick={() => setShowSources((v) => !v)}
                                                type="button"
                                            >
                                                <span>
                                                    <span className="block font-medium text-default text-sm">
                                                        Built from catalogs
                                                    </span>
                                                    <span className="block text-muted text-xs">
                                                        {form.catalogIds
                                                            .map(
                                                                (id) =>
                                                                    catalogs.find(
                                                                        (c) => c.id === id
                                                                    )?.name
                                                            )
                                                            .filter(Boolean)
                                                            .join(", ") || "None"}{" "}
                                                        - new titles go into{" "}
                                                        {home ? `“${home.name}”` : "the first one"}
                                                    </span>
                                                </span>
                                                <ChevronDownIcon
                                                    className={`h-4 w-4 shrink-0 text-muted transition-transform ${showSources ? "rotate-180" : ""}`}
                                                />
                                            </button>
                                            {showSources && (
                                                <div className="px-4 pb-4">
                                                    <p className="mb-3 text-muted text-xs">
                                                        Pick more catalogs to show their titles here
                                                        too.
                                                    </p>
                                                    <div className={grid}>
                                                        {catalogs.map((cat) => {
                                                            const on = form.catalogIds.includes(
                                                                cat.id
                                                            );
                                                            return (
                                                                <button
                                                                    aria-pressed={on}
                                                                    className={`group overflow-hidden rounded-xl border text-left transition-colors ${on ? "border-primary ring-2 ring-primary/60" : "border-default hover:border-primary/50"}`}
                                                                    key={cat.id}
                                                                    onClick={() =>
                                                                        toggleCatalog(cat.id)
                                                                    }
                                                                    type="button"
                                                                >
                                                                    <div className="relative aspect-[2/3] bg-surface-hover">
                                                                        {cat.cover ? (
                                                                            // eslint-disable-next-line @next/next/no-img-element
                                                                            <img
                                                                                alt=""
                                                                                className={`absolute inset-0 h-full w-full object-cover transition-opacity ${on ? "" : "opacity-50 group-hover:opacity-90"}`}
                                                                                src={cat.cover}
                                                                            />
                                                                        ) : (
                                                                            <div className="absolute inset-0 flex items-center justify-center">
                                                                                <Squares2X2Icon className="h-8 w-8 text-muted" />
                                                                            </div>
                                                                        )}
                                                                        {on && (
                                                                            <span className="absolute top-1.5 right-1.5 flex h-6 w-6 items-center justify-center rounded-full bg-primary shadow">
                                                                                <CheckIcon className="h-4 w-4 text-white" />
                                                                            </span>
                                                                        )}
                                                                    </div>
                                                                    <div className="p-1.5">
                                                                        <p className="truncate font-medium text-[11px] text-default">
                                                                            {cat.name}
                                                                        </p>
                                                                        <p className="text-[10px] text-muted">
                                                                            {cat.titles} title
                                                                            {cat.titles === 1
                                                                                ? ""
                                                                                : "s"}
                                                                        </p>
                                                                    </div>
                                                                </button>
                                                            );
                                                        })}
                                                    </div>
                                                </div>
                                            )}
                                        </div>
                                    </>
                                )}
                            </div>
                        ) : (
                            <div className="space-y-4">
                                <div className="h-40 animate-pulse rounded-2xl bg-surface-hover" />
                                <div className="h-64 animate-pulse rounded-2xl bg-surface-hover" />
                            </div>
                        )}
                    </PageSection>
                </div>
            </div>

            {detail && (
                <MediaDetailModal
                    fallbackPoster={detail.poster || undefined}
                    fallbackTitle={detail.name}
                    isOpen={!!detail}
                    itemId={detail.id}
                    itemType={detail.type}
                    onClose={() => setDetail(null)}
                />
            )}

            <ConfirmModal
                confirmText="Remove"
                description="It stops showing in AIOStreams' apps. Its titles stay in their catalogs."
                isOpen={confirmRemove}
                onClose={() => setConfirmRemove(false)}
                onConfirm={remove}
                title={`Remove ${form.name.trim() || "this collection"}?`}
            />
        </>
    );
}
