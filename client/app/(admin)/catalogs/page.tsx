"use client";

import {
    ArrowDownTrayIcon,
    MapPinIcon,
    PencilSquareIcon,
    PhotoIcon,
    PlusIcon,
    RectangleStackIcon,
    ShieldExclamationIcon,
    SparklesIcon,
    TrashIcon,
} from "@heroicons/react/24/outline";
import { MapPinIcon as MapPinIconSolid, PlayIcon } from "@heroicons/react/24/solid";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { JellyfinLogo } from "@/components/jellyfin/JellyfinLogo";
import { Breadcrumbs, Header } from "@/components/layout/Header";
import { NebulaPageHeading } from "@/components/layout/NebulaTopbar";
import { PageSection } from "@/components/layout/PageContainer";
import { AvatarPickerModal } from "@/components/modals/AvatarPickerModal";
import {
    Badge,
    Button,
    Card,
    ContextMenu,
    MediaDetailModal,
    Modal,
    PosterThumb,
    useContextMenu,
} from "@/components/ui";
import { avatarColorFill } from "@/components/ui/Avatar";
import { BeginnerHint } from "@/components/ui/BeginnerHint";
import { EmptyState } from "@/components/ui/EmptyState";
import { toast } from "@/components/ui/Toast";
import { showDeletedWithUndo } from "@/components/ui/undoToast";
import { api, type CustomList, type CustomListItem, type DescribedCatalogPreview } from "@/lib/api";
import { useLastKnown } from "@/lib/hooks/useLastKnown";
import { useLayoutMode } from "@/lib/layout-mode";
import { decodeShareCode, looksLikeShareCode } from "@/lib/shareCodes";

// Matches AvatarPickerModal's own color-swatch formula exactly, so a
// catalog's solid-color cover reads as the same color the picker showed.
function coverColorStyle(colorIndex: number): React.CSSProperties {
    return { background: avatarColorFill(colorIndex) };
}

// Custom Lists (roadmap #7): named collections of titles. Create/rename/delete
// a list here; click one to open its own page at /catalogs/[id] (a real page, not
// a popup - browsing a list's contents is a destination, not a transient
// action). Titles are ADDED to a list from the "Add to list" control on a
// title's detail modal elsewhere.

export default function ListsPage() {
    const { layoutMode } = useLayoutMode();
    const router = useRouter();
    const [lists, setLists] = useState<CustomList[]>([]);
    const [loaded, setLoaded] = useState(false);
    const [showCreate, setShowCreate] = useState(false);
    const [newName, setNewName] = useState("");
    const [renaming, setRenaming] = useState<CustomList | null>(null);
    const [renameValue, setRenameValue] = useState("");
    const [deleting, setDeleting] = useState<CustomList | null>(null);
    const [showImport, setShowImport] = useState(false);
    const [showDescribe, setShowDescribe] = useState(false);
    const [importUrl, setImportUrl] = useState("");
    const [importName, setImportName] = useState("");
    const [importing, setImporting] = useState(false);
    const [coverPicker, setCoverPicker] = useState<CustomList | null>(null);
    // SIMKL has no named-list URL to paste (see server/utils/simklLists.js) -
    // import instead picks one of this account's SIMKL-linked users and pulls
    // their Plan to Watch, so this needs its own picker state alongside the
    // URL-based flow above.
    const [simklUsers, setSimklUsers] = useState<
        Array<{ id: string; username: string; avatarUrl: string | null; colorIndex: number | null }>
    >([]);
    const [simklUsersLoaded, setSimklUsersLoaded] = useState(false);
    const [selectedSimklUserId, setSelectedSimklUserId] = useState("");
    const [importingSimkl, setImportingSimkl] = useState(false);

    // Instant navigation: last-known catalogs shown immediately while load()
    // refreshes them - see useLastKnown's own comment.
    useLastKnown<CustomList[]>("/lists", (cached) => {
        if (Array.isArray(cached)) {
            setLists(cached);
            setLoaded(true);
        }
    });

    const load = useCallback(() => {
        api.getLists()
            .then((r) => setLists(Array.isArray(r) ? r : []))
            .catch(() => setLists([]))
            .finally(() => setLoaded(true));
    }, []);
    useEffect(() => {
        load();
    }, [load]);

    useEffect(() => {
        if (!showImport || simklUsersLoaded) {
            return;
        }
        api.getSimklLinkedUsers()
            .then((users) => {
                // No auto-select, even with exactly one linked user - starting on
                // the "Select a SIMKL-linked user…" placeholder makes it explicit
                // that pressing Import here acts on a specific person's SIMKL
                // account; pre-filling it read as if the choice had already been
                // made somewhere else.
                setSimklUsers(users);
            })
            .catch(() => setSimklUsers([]))
            .finally(() => setSimklUsersLoaded(true));
    }, [showImport, simklUsersLoaded]);

    const handleCreate = async () => {
        const name = newName.trim();
        if (!name) {
            return;
        }
        try {
            const list = await api.createList(name);
            setNewName("");
            setShowCreate(false);
            toast.success(`Created "${name}"`);
            router.push(`/catalogs/${list.id}`);
        } catch {
            toast.error("Failed to create catalog");
        }
    };

    const handleRename = async () => {
        if (!renaming) {
            return;
        }
        const name = renameValue.trim();
        if (!name) {
            return;
        }
        try {
            const updated = await api.updateList(renaming.id, { name });
            setLists((prev) => prev.map((l) => (l.id === updated.id ? updated : l)));
            setRenaming(null);
            toast.success("Renamed");
        } catch {
            toast.error("Failed to rename");
        }
    };

    const handleImport = async () => {
        const url = importUrl.trim();
        if (!url) {
            return;
        }
        setImporting(true);

        // A pasted share code takes the same field as a URL - it's the same
        // intent ("bring this catalog in"), and making people find a second
        // input for it would be pure ceremony. Creates the catalog, then bulk-
        // adds its titles in one write.
        if (looksLikeShareCode(url)) {
            try {
                const decoded = decodeShareCode(url);
                if (decoded?.kind !== "catalog") {
                    throw new Error("That code isn't a catalog share code");
                }
                const created = await api.createList(
                    importName.trim() || decoded.payload.name,
                    decoded.payload.description
                );
                const result = await api.addToListBulk(created.id, decoded.payload.items);
                setImportUrl("");
                setImportName("");
                setShowImport(false);
                toast.success(
                    `Imported "${created.name}" (${result.added} title${result.added === 1 ? "" : "s"})`
                );
                router.push(`/catalogs/${created.id}`);
            } catch (e) {
                toast.error(e instanceof Error ? e.message : "Failed to import that code");
            } finally {
                setImporting(false);
            }
            return;
        }

        try {
            const list = await api.importList(url, importName.trim() || undefined);
            setImportUrl("");
            setImportName("");
            setShowImport(false);
            toast.success(
                list.truncated
                    ? `Imported ${list.items.length} of ${list.totalAvailable} titles (capped at ${list.items.length})`
                    : `Imported "${list.name}" (${list.items.length} title${list.items.length === 1 ? "" : "s"})`
            );
            router.push(`/catalogs/${list.id}`);
        } catch (e: any) {
            toast.error(e?.message || "Failed to import catalog");
        } finally {
            setImporting(false);
        }
    };

    const handleImportSimkl = async () => {
        if (!selectedSimklUserId) {
            return;
        }
        setImportingSimkl(true);
        try {
            const list = await api.importListFromSimkl(
                selectedSimklUserId,
                importName.trim() || undefined
            );
            setImportName("");
            setSelectedSimklUserId("");
            setShowImport(false);
            toast.success(
                `Imported "${list.name}" (${list.items.length} title${list.items.length === 1 ? "" : "s"})`
            );
            router.push(`/catalogs/${list.id}`);
        } catch (e: any) {
            toast.error(e?.message || "Failed to import from SIMKL");
        } finally {
            setImportingSimkl(false);
        }
    };

    const handleTogglePin = async (list: CustomList) => {
        const next = !list.pinned;
        setLists((prev) => prev.map((l) => (l.id === list.id ? { ...l, pinned: next } : l)));
        try {
            await api.updateList(list.id, { pinned: next });
        } catch {
            toast.error("Failed to update");
            setLists((prev) => prev.map((l) => (l.id === list.id ? { ...l, pinned: !next } : l)));
        }
    };

    const handleDelete = async () => {
        if (!deleting) {
            return;
        }
        const list = deleting;
        setLists((prev) => prev.filter((l) => l.id !== list.id));
        setDeleting(null);
        try {
            const res = await api.deleteList(list.id);
            // Offers Undo when the catalog was archived to Trash first.
            showDeletedWithUndo(list.name, res?.trashId, load);
        } catch {
            toast.error("Failed to delete");
            load();
        }
    };

    // Right-click context menu - one shared instance for every card, tracking
    // which list it's currently open for, rather than a per-card hook
    // instance (cards render inline in a .map() here, not as their own
    // component, so a per-card useContextMenu()/useLongPress() isn't an
    // option - hooks can't be called a variable number of times per render).
    const {
        isOpen: menuOpen,
        position: menuPosition,
        handleContextMenu,
        close: closeMenu,
    } = useContextMenu();
    const [menuTarget, setMenuTarget] = useState<CustomList | null>(null);
    const openContextMenuFor = (list: CustomList, e: React.MouseEvent) => {
        if (!list.isOwner) {
            return; // read-only shared catalog - nothing to mutate
        }
        setMenuTarget(list);
        handleContextMenu(e, e.clientX, e.clientY);
    };

    // AvatarPickerModal's onSave only includes the key(s) for the tab that was
    // actually saved (color tab sends both colorIndex + a clearing avatarUrl,
    // URL/upload tabs send only avatarUrl) - forward exactly that presence
    // through to the PATCH so the untouched field is left alone server-side.
    const handleCoverSave = async (data: { avatarUrl?: string | null; colorIndex?: number }) => {
        if (!coverPicker) {
            return;
        }
        const patch: { coverImageUrl?: string | null; coverColorIndex?: number | null } = {};
        if ("avatarUrl" in data) {
            patch.coverImageUrl = data.avatarUrl ?? null;
        }
        if ("colorIndex" in data) {
            patch.coverColorIndex = data.colorIndex ?? null;
        }
        const updated = await api.updateList(coverPicker.id, patch);
        setLists((prev) => prev.map((l) => (l.id === updated.id ? updated : l)));
    };

    const heading = {
        subtitle: "Your taste, collected. Movies and shows worth keeping together.",
        title: "Catalogs",
    };

    // Connected collections share the same secondary action style as local catalogs.
    const collectionsButtons = (
        <div className="flex flex-wrap items-center gap-2">
            <Button
                leftIcon={<PlayIcon className="h-4 w-4" />}
                onClick={() => router.push("/catalogs/nuvio-collections")}
                size="sm"
                variant="secondary"
            >
                Nuvio Collections
            </Button>
            <Button
                leftIcon={<JellyfinLogo size={18} />}
                onClick={() => router.push("/catalogs/aiostreams-collections")}
                size="sm"
                variant="secondary"
            >
                Jellyfin / AIOStreams
            </Button>
        </div>
    );

    return (
        <>
            {layoutMode !== "nebula" && (
                <Header
                    subtitle={heading.subtitle}
                    title={
                        <Breadcrumbs
                            className="font-semibold text-xl"
                            items={[{ label: "Catalogs" }]}
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
                        <NebulaPageHeading subtitle={heading.subtitle} title={heading.title} />
                    )}

                    <section
                        aria-label="Connected collections"
                        className="mb-6 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-default bg-surface px-4 py-3"
                    >
                        <div>
                            <h2 className="font-semibold text-default text-sm">
                                Connected collections
                            </h2>
                            <p className="mt-0.5 text-muted text-xs">
                                Organize the collections shown in your apps.
                            </p>
                        </div>
                        {collectionsButtons}
                    </section>
                    <BeginnerHint guideId="catalog-create">
                        Catalogs are your own named lists of titles - separate from the Watchlist -
                        that you can share with a code or push to a user's app.
                    </BeginnerHint>
                    <PageSection>
                        {/* Wraps on a phone: the three buttons are wider than one line there. */}
                        <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
                            <div className="flex shrink-0 items-center gap-2">
                                <RectangleStackIcon className="h-5 w-5 text-primary" />
                                <h3 className="font-display font-semibold text-base text-default">
                                    {loaded
                                        ? `${lists.length} catalog${lists.length === 1 ? "" : "s"}`
                                        : "Catalogs"}
                                </h3>
                            </div>
                            <div className="flex min-w-0 flex-wrap items-center justify-end gap-2">
                                <Button
                                    leftIcon={<ArrowDownTrayIcon className="h-4 w-4" />}
                                    onClick={() => setShowImport(true)}
                                    size="sm"
                                    variant="ghost"
                                >
                                    Import
                                </Button>
                                <Button
                                    leftIcon={<SparklesIcon className="h-4 w-4" />}
                                    onClick={() => setShowDescribe(true)}
                                    size="sm"
                                    variant="ghost"
                                >
                                    Describe a catalog
                                </Button>
                                <Button
                                    leftIcon={<PlusIcon className="h-4 w-4" />}
                                    onClick={() => setShowCreate(true)}
                                    size="sm"
                                    variant="secondary"
                                >
                                    New catalog
                                </Button>
                            </div>
                        </div>

                        {loaded && lists.length === 0 && (
                            <div className="catalog-starter interface-panel rounded-2xl">
                                <EmptyState
                                    action={
                                        <Button
                                            leftIcon={<PlusIcon className="h-4 w-4" />}
                                            onClick={() => setShowCreate(true)}
                                            size="md"
                                            variant="primary"
                                        >
                                            Create a catalog
                                        </Button>
                                    }
                                    description="Gather movies and shows for a mood, a movie night, or someone you love sharing with."
                                    icon={<RectangleStackIcon className="h-6 w-6" />}
                                    title="A collection with your name on it"
                                />
                                <div className="catalog-starter-ideas flex flex-wrap items-center justify-center gap-2 px-5 pb-7">
                                    <span className="mr-1 text-muted text-xs">
                                        Start with an idea
                                    </span>
                                    {["Movie night", "Worth a rewatch", "Next up"].map((name) => (
                                        <button
                                            className="rounded-full bg-surface-hover px-3 py-2 font-medium text-muted text-xs"
                                            key={name}
                                            onClick={() => {
                                                setNewName(name);
                                                setShowCreate(true);
                                            }}
                                            type="button"
                                        >
                                            {name}
                                        </button>
                                    ))}
                                </div>
                            </div>
                        )}

                        {lists.length > 0 &&
                            (() => {
                                // At most one hero - the pinned catalog with the most recent
                                // activity if more than one happens to be pinned (see the
                                // pinned field's own schema comment).
                                const pinned = lists
                                    .filter((l) => l.pinned)
                                    .sort(
                                        (a, b) =>
                                            new Date(b.updatedAt).getTime() -
                                            new Date(a.updatedAt).getTime()
                                    );
                                const hero = pinned[0] || null;
                                const rest = hero ? lists.filter((l) => l.id !== hero.id) : lists;

                                // Action row is always visible (not hover-only) - hover has no
                                // touch equivalent, so the original opacity-0 group-hover
                                // treatment made Cover art/Rename/Delete completely unreachable
                                // on mobile. Small enough not to compete with the title/count.
                                // A catalog someone else shared with you is read-only here - no
                                // pin/cover/rename/delete, since those all mutate a list you
                                // don't own (the server already blocks the write, this just
                                // avoids showing a control that would 404).
                                const actionRow = (list: CustomList, size: "sm" | "lg") =>
                                    list.isOwner ? (
                                        <div
                                            className={`flex items-center gap-1 ${size === "lg" ? "rounded-lg bg-black/40 p-1 backdrop-blur-sm" : ""}`}
                                        >
                                            <button
                                                className={`rounded-lg p-1.5 transition-colors ${list.pinned ? "text-primary" : `${size === "lg" ? "text-white/80 hover:text-white" : "text-muted hover:text-default"} hover:bg-surface-hover`}`}
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    handleTogglePin(list);
                                                }}
                                                title={
                                                    list.pinned ? "Unpin from top" : "Pin to top"
                                                }
                                                type="button"
                                            >
                                                {list.pinned ? (
                                                    <MapPinIconSolid className="h-4 w-4" />
                                                ) : (
                                                    <MapPinIcon className="h-4 w-4" />
                                                )}
                                            </button>
                                            <button
                                                className={`rounded-lg p-1.5 transition-colors ${size === "lg" ? "text-white/80 hover:text-white" : "text-muted hover:text-default"} hover:bg-surface-hover`}
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    setCoverPicker(list);
                                                }}
                                                title="Cover art"
                                                type="button"
                                            >
                                                <PhotoIcon className="h-4 w-4" />
                                            </button>
                                            <button
                                                className={`rounded-lg p-1.5 transition-colors ${size === "lg" ? "text-white/80 hover:text-white" : "text-muted hover:text-default"} hover:bg-surface-hover`}
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    setRenaming(list);
                                                    setRenameValue(list.name);
                                                }}
                                                title="Rename"
                                                type="button"
                                            >
                                                <PencilSquareIcon className="h-4 w-4" />
                                            </button>
                                            <button
                                                className={`rounded-lg p-1.5 transition-colors hover:text-error ${size === "lg" ? "text-white/80" : "text-muted"} hover:bg-surface-hover`}
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    setDeleting(list);
                                                }}
                                                title="Delete catalog"
                                                type="button"
                                            >
                                                <TrashIcon className="h-4 w-4" />
                                            </button>
                                        </div>
                                    ) : (
                                        <Badge size="sm" variant="muted">
                                            Shared with you
                                        </Badge>
                                    );

                                return (
                                    <div className="space-y-4">
                                        {hero && (
                                            <Card
                                                className="overflow-hidden"
                                                onContextMenu={(e) => openContextMenuFor(hero, e)}
                                                padding="none"
                                            >
                                                <button
                                                    className="group relative block w-full text-left"
                                                    onClick={() =>
                                                        router.push(`/catalogs/${hero.id}`)
                                                    }
                                                    type="button"
                                                >
                                                    <div className="relative h-48 bg-black md:h-72">
                                                        {hero.coverImageUrl ? (
                                                            <>
                                                                {/* eslint-disable-next-line @next/next/no-img-element */}
                                                                <img
                                                                    alt=""
                                                                    aria-hidden
                                                                    className="absolute inset-0 h-full w-full scale-110 object-cover opacity-40 blur-xl"
                                                                    src={hero.coverImageUrl}
                                                                />
                                                                {/* eslint-disable-next-line @next/next/no-img-element */}
                                                                <img
                                                                    alt=""
                                                                    className="relative h-full w-full object-contain"
                                                                    src={hero.coverImageUrl}
                                                                />
                                                            </>
                                                        ) : hero.coverColorIndex !== null &&
                                                          hero.coverColorIndex !== undefined ? (
                                                            <div
                                                                className="h-full w-full"
                                                                style={coverColorStyle(
                                                                    hero.coverColorIndex
                                                                )}
                                                            />
                                                        ) : hero.items.length > 0 ? (
                                                            <div className="flex h-full w-full gap-1">
                                                                {hero.items
                                                                    .slice(0, 4)
                                                                    .map((it) => (
                                                                        <PosterThumb
                                                                            className="h-full flex-1"
                                                                            item={it}
                                                                            key={it.id}
                                                                        />
                                                                    ))}
                                                            </div>
                                                        ) : (
                                                            <div className="flex h-full w-full items-center justify-center">
                                                                <RectangleStackIcon className="h-10 w-10 text-subtle" />
                                                            </div>
                                                        )}
                                                        <div
                                                            className="absolute inset-0"
                                                            style={{
                                                                background:
                                                                    "linear-gradient(0deg, rgba(0,0,0,0.75) 0%, transparent 45%)",
                                                            }}
                                                        />
                                                        <div className="absolute top-3 right-3">
                                                            {actionRow(hero, "lg")}
                                                        </div>
                                                        <div className="absolute right-0 bottom-0 left-0 p-4 md:p-5">
                                                            <div className="mb-1 flex items-center gap-2">
                                                                <Badge size="sm" variant="primary">
                                                                    Featured
                                                                </Badge>
                                                                {hero.isOwner && hero.shared && (
                                                                    <Badge
                                                                        size="sm"
                                                                        title="Visible (read-only) to other accounts on this instance"
                                                                        variant="muted"
                                                                    >
                                                                        Shared
                                                                    </Badge>
                                                                )}
                                                                {!hero.isOwner && (
                                                                    <Badge
                                                                        size="sm"
                                                                        variant="muted"
                                                                    >
                                                                        Shared with you
                                                                    </Badge>
                                                                )}
                                                                {hero.autoGenerated && (
                                                                    <Badge
                                                                        size="sm"
                                                                        title="Auto-generated from your watch history"
                                                                        variant="muted"
                                                                    >
                                                                        Auto
                                                                    </Badge>
                                                                )}
                                                            </div>
                                                            <p className="truncate font-display font-semibold text-white text-xl md:text-2xl">
                                                                {hero.name}
                                                            </p>
                                                            <p className="text-sm text-white/70">
                                                                {hero.items.length} title
                                                                {hero.items.length === 1 ? "" : "s"}
                                                            </p>
                                                        </div>
                                                    </div>
                                                </button>
                                            </Card>
                                        )}

                                        {rest.length > 0 && (
                                            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                                                {rest.map((list) => (
                                                    <Card
                                                        key={list.id}
                                                        onContextMenu={(e) =>
                                                            openContextMenuFor(list, e)
                                                        }
                                                        padding="md"
                                                    >
                                                        <button
                                                            className="w-full text-left"
                                                            onClick={() =>
                                                                router.push(`/catalogs/${list.id}`)
                                                            }
                                                            type="button"
                                                        >
                                                            {/* Custom cover (image or solid color) takes over the whole
                              strip; otherwise the up-to-4-poster collage / empty
                              placeholder from before. h-40 (was h-24) on the image
                              variant specifically - object-contain on a 2:3 poster
                              needs real height to read as anything but a tiny
                              centered sliver; the other two variants match it so
                              cards in the same grid row stay the same height. */}
                                                            {list.coverImageUrl ? (
                                                                // object-contain (not cover) - a tall poster jammed into
                                                                // this wide/short strip via object-cover crops down to
                                                                // an unrecognizable sliver of the middle of the image.
                                                                // The blurred duplicate behind it fills the letterbox
                                                                // bars instead of leaving them flat black.
                                                                <div className="relative mb-3 h-40 overflow-hidden rounded-md bg-black">
                                                                    {/* eslint-disable-next-line @next/next/no-img-element */}
                                                                    <img
                                                                        alt=""
                                                                        aria-hidden
                                                                        className="absolute inset-0 h-full w-full scale-110 object-cover opacity-40 blur-xl"
                                                                        src={list.coverImageUrl}
                                                                    />
                                                                    {/* eslint-disable-next-line @next/next/no-img-element */}
                                                                    <img
                                                                        alt=""
                                                                        className="relative h-full w-full object-contain"
                                                                        src={list.coverImageUrl}
                                                                    />
                                                                </div>
                                                            ) : list.coverColorIndex !== null &&
                                                              list.coverColorIndex !== undefined ? (
                                                                <div
                                                                    className="mb-3 h-40 rounded-md"
                                                                    style={coverColorStyle(
                                                                        list.coverColorIndex
                                                                    )}
                                                                />
                                                            ) : (
                                                                <div className="mb-3 flex h-40 gap-1">
                                                                    {list.items.length === 0 ? (
                                                                        <div className="flex flex-1 items-center justify-center rounded-md bg-surface-hover">
                                                                            <RectangleStackIcon className="h-6 w-6 text-subtle" />
                                                                        </div>
                                                                    ) : (
                                                                        list.items
                                                                            .slice(0, 4)
                                                                            .map((it) => (
                                                                                <PosterThumb
                                                                                    className="h-full flex-1"
                                                                                    item={it}
                                                                                    key={it.id}
                                                                                />
                                                                            ))
                                                                    )}
                                                                </div>
                                                            )}
                                                            <div className="flex items-center gap-1.5">
                                                                <p className="truncate font-semibold text-default text-sm">
                                                                    {list.name}
                                                                </p>
                                                                {list.isOwner && list.shared && (
                                                                    <Badge
                                                                        size="sm"
                                                                        title="Visible (read-only) to other accounts on this instance"
                                                                        variant="primary"
                                                                    >
                                                                        Shared
                                                                    </Badge>
                                                                )}
                                                                {list.autoGenerated && (
                                                                    <Badge
                                                                        size="sm"
                                                                        title="Auto-generated from your watch history"
                                                                        variant="muted"
                                                                    >
                                                                        Auto
                                                                    </Badge>
                                                                )}
                                                            </div>
                                                            <p className="text-muted text-xs">
                                                                {list.items.length} title
                                                                {list.items.length === 1 ? "" : "s"}
                                                            </p>
                                                        </button>
                                                        <div className="mt-2 flex items-center gap-1">
                                                            {actionRow(list, "sm")}
                                                        </div>
                                                    </Card>
                                                ))}
                                            </div>
                                        )}
                                    </div>
                                );
                            })()}
                    </PageSection>
                </div>
            </div>

            {/* Right-click actions - same set the always-visible icon row already
          offers (Pin/Cover art/Rename/Delete), plus Content Rating, which
          only lived on the catalog's own detail page before. Content Rating
          navigates there with a query flag that auto-opens the policy modal
          on load, reusing that page's existing modal instead of duplicating
          it here. */}
            <ContextMenu isOpen={menuOpen} onClose={closeMenu} position={menuPosition}>
                {menuTarget && (
                    <>
                        <button
                            className="flex w-full items-center gap-2 px-3 py-2 text-default text-sm transition-colors hover:bg-surface-hover"
                            onClick={() => {
                                handleTogglePin(menuTarget);
                                closeMenu();
                            }}
                        >
                            {menuTarget.pinned ? (
                                <MapPinIconSolid className="h-4 w-4 text-primary" />
                            ) : (
                                <MapPinIcon className="h-4 w-4" />
                            )}
                            {menuTarget.pinned ? "Unpin from top" : "Pin to top"}
                        </button>
                        <button
                            className="flex w-full items-center gap-2 px-3 py-2 text-default text-sm transition-colors hover:bg-surface-hover"
                            onClick={() => {
                                setCoverPicker(menuTarget);
                                closeMenu();
                            }}
                        >
                            <PhotoIcon className="h-4 w-4" />
                            Cover art
                        </button>
                        <button
                            className="flex w-full items-center gap-2 px-3 py-2 text-default text-sm transition-colors hover:bg-surface-hover"
                            onClick={() => {
                                setRenaming(menuTarget);
                                setRenameValue(menuTarget.name);
                                closeMenu();
                            }}
                        >
                            <PencilSquareIcon className="h-4 w-4" />
                            Rename
                        </button>
                        <button
                            className="flex w-full items-center gap-2 px-3 py-2 text-default text-sm transition-colors hover:bg-surface-hover"
                            onClick={() => {
                                router.push(`/catalogs/${menuTarget.id}?openRating=1`);
                                closeMenu();
                            }}
                        >
                            <ShieldExclamationIcon className="h-4 w-4" />
                            Content Rating
                        </button>
                        <button
                            className="flex w-full items-center gap-2 px-3 py-2 text-error text-sm transition-colors hover:bg-surface-hover"
                            onClick={() => {
                                setDeleting(menuTarget);
                                closeMenu();
                            }}
                        >
                            <TrashIcon className="h-4 w-4" />
                            Delete catalog
                        </button>
                    </>
                )}
            </ContextMenu>

            {/* Create catalog */}
            <Modal
                isOpen={showCreate}
                onClose={() => setShowCreate(false)}
                size="sm"
                title="New catalog"
            >
                <div className="space-y-4">
                    <input
                        autoFocus
                        className="w-full rounded-lg border border-transparent bg-surface-hover px-3 py-2 text-default text-sm focus:border-primary focus:outline-none"
                        onChange={(e) => setNewName(e.target.value)}
                        onKeyDown={(e) => {
                            if (e.key === "Enter") {
                                handleCreate();
                            }
                        }}
                        placeholder="e.g. Halloween Marathon"
                        type="text"
                        value={newName}
                    />
                    <div className="flex justify-end gap-2">
                        <Button onClick={() => setShowCreate(false)} size="sm" variant="ghost">
                            Cancel
                        </Button>
                        <Button
                            disabled={!newName.trim()}
                            onClick={handleCreate}
                            size="sm"
                            variant="primary"
                        >
                            Create
                        </Button>
                    </div>
                </div>
            </Modal>

            {/* Import catalog from TMDb, MDBList, another SlickSync instance's share
          link, or a linked user's SIMKL Plan to Watch. The first three are all
          URL-based with the provider auto-detected (detectProvider in
          server/utils/listImport.js); SIMKL has no named-list API yet (see
          server/utils/simklLists.js) so it picks a linked user instead. */}
            <Modal
                isOpen={showImport}
                onClose={() => setShowImport(false)}
                size="sm"
                title="Import a catalog"
            >
                <div className="space-y-4">
                    <div>
                        <label className="mb-1.5 block font-medium text-muted text-xs">
                            Catalog URL
                        </label>
                        <input
                            autoFocus
                            className="w-full rounded-lg border border-transparent bg-surface-hover px-3 py-2 text-default text-sm focus:border-primary focus:outline-none"
                            onChange={(e) => setImportUrl(e.target.value)}
                            onKeyDown={(e) => {
                                if (e.key === "Enter") {
                                    handleImport();
                                }
                            }}
                            placeholder="A list URL from MDBList, TMDb, Trakt, AniList or MAL - or a SlickSync share link"
                            type="text"
                            value={importUrl}
                        />
                        <p className="mt-1.5 text-subtle text-xs">
                            Supports MDBList and TMDb lists (movies only for TMDb), public Trakt
                            lists, and anime lists from AniList (anilist.co/user/NAME/animelist -
                            add the section, e.g. /Planning, to import just that one) and
                            MyAnimeList (myanimelist.net/animelist/NAME). Anime lists carry no IMDb
                            ids, so those are matched through TMDb and need that key; anything TMDb
                            cannot place is left out rather than imported broken. Also takes share
                            links from another household&apos;s SlickSync and pasted{" "}
                            <span className="font-mono">SSC1:</span> share codes, neither of which
                            needs a key. Either way this copies the titles now; turn on Auto-refresh
                            on the catalog afterwards to keep it following its source.
                        </p>
                    </div>

                    {simklUsers.length > 0 && (
                        <div>
                            <label className="mb-1.5 block font-medium text-muted text-xs">
                                Or import from SIMKL
                            </label>
                            <select
                                className="w-full rounded-lg border border-transparent bg-surface-hover px-3 py-2 text-default text-sm focus:border-primary focus:outline-none"
                                onChange={(e) => setSelectedSimklUserId(e.target.value)}
                                value={selectedSimklUserId}
                            >
                                <option value="">Select a SIMKL-linked user…</option>
                                {simklUsers.map((u) => (
                                    <option key={u.id} value={u.id}>
                                        {u.username}
                                    </option>
                                ))}
                            </select>
                            <p className="mt-1.5 text-subtle text-xs">
                                Pulls that user&apos;s SIMKL Plan to Watch — SIMKL doesn&apos;t
                                expose named lists via API yet, this is the closest equivalent.
                            </p>
                        </div>
                    )}

                    <div>
                        <label className="mb-1.5 block font-medium text-muted text-xs">
                            Name{" "}
                            <span className="font-normal text-subtle">
                                (optional — uses the source&apos;s name if blank)
                            </span>
                        </label>
                        <input
                            className="w-full rounded-lg border border-transparent bg-surface-hover px-3 py-2 text-default text-sm focus:border-primary focus:outline-none"
                            onChange={(e) => setImportName(e.target.value)}
                            onKeyDown={(e) => {
                                if (e.key === "Enter") {
                                    handleImport();
                                }
                            }}
                            placeholder="e.g. Halloween Marathon"
                            type="text"
                            value={importName}
                        />
                    </div>
                    <div className="flex justify-end gap-2">
                        <Button
                            disabled={importing || importingSimkl}
                            onClick={() => setShowImport(false)}
                            size="sm"
                            variant="ghost"
                        >
                            Cancel
                        </Button>
                        {selectedSimklUserId ? (
                            <Button
                                disabled={importingSimkl}
                                onClick={handleImportSimkl}
                                size="sm"
                                variant="primary"
                            >
                                {importingSimkl ? "Importing…" : "Import from SIMKL"}
                            </Button>
                        ) : (
                            <Button
                                disabled={!importUrl.trim() || importing}
                                onClick={handleImport}
                                size="sm"
                                variant="primary"
                            >
                                {importing ? "Importing…" : "Import"}
                            </Button>
                        )}
                    </div>
                </div>
            </Modal>

            {showDescribe && (
                <DescribeCatalogModal
                    onClose={() => setShowDescribe(false)}
                    onSaved={(saved) => {
                        setLists((prev) => [saved, ...prev]);
                        setShowDescribe(false);
                        toast.success(`Created "${saved.name}"`);
                    }}
                />
            )}

            {/* Rename catalog */}
            <Modal
                isOpen={!!renaming}
                onClose={() => setRenaming(null)}
                size="sm"
                title="Rename catalog"
            >
                <div className="space-y-4">
                    <input
                        autoFocus
                        className="w-full rounded-lg border border-transparent bg-surface-hover px-3 py-2 text-default text-sm focus:border-primary focus:outline-none"
                        onChange={(e) => setRenameValue(e.target.value)}
                        onKeyDown={(e) => {
                            if (e.key === "Enter") {
                                handleRename();
                            }
                        }}
                        type="text"
                        value={renameValue}
                    />
                    <div className="flex justify-end gap-2">
                        <Button onClick={() => setRenaming(null)} size="sm" variant="ghost">
                            Cancel
                        </Button>
                        <Button
                            disabled={!renameValue.trim()}
                            onClick={handleRename}
                            size="sm"
                            variant="primary"
                        >
                            Save
                        </Button>
                    </div>
                </div>
            </Modal>

            {/* Delete confirm */}
            <Modal
                isOpen={!!deleting}
                onClose={() => setDeleting(null)}
                size="sm"
                title="Delete catalog"
            >
                <div className="space-y-4">
                    <p className="text-muted text-sm">
                        Delete <span className="font-medium text-default">{deleting?.name}</span>?
                        This removes the catalog only — nothing about your watch history changes.
                    </p>
                    <div className="flex justify-end gap-2">
                        <Button onClick={() => setDeleting(null)} size="sm" variant="ghost">
                            Cancel
                        </Button>
                        <Button onClick={handleDelete} size="sm" variant="danger">
                            Delete
                        </Button>
                    </div>
                </div>
            </Modal>

            {/* Cover art - same picker Settings/Users/Groups already use for
          avatars, repurposed for a catalog's own cover. */}
            {coverPicker && (
                <AvatarPickerModal
                    currentAvatarUrl={coverPicker.coverImageUrl}
                    currentColorIndex={coverPicker.coverColorIndex ?? 0}
                    isOpen={!!coverPicker}
                    name={coverPicker.name}
                    onClose={() => setCoverPicker(null)}
                    onSave={handleCoverSave}
                    previewShape="rect"
                    size="lg"
                    title=""
                />
            )}
        </>
    );
}

// ---- Describe a catalog (natural-language) ---------------------------------
//
// Two steps, deliberately never collapsed into one: describe -> preview
// (nothing saved) -> review what the parser actually understood + the real
// results -> save. Skipping straight to save would mean the first time an
// admin learns the AI (or the keyword fallback) misread their request is
// after a wrong catalog already exists.
function DescribeCatalogModal({
    onClose,
    onSaved,
}: {
    onClose: () => void;
    onSaved: (list: CustomList) => void;
}) {
    const [description, setDescription] = useState("");
    const [name, setName] = useState("");
    const [preview, setPreview] = useState<DescribedCatalogPreview | null>(null);
    const [loading, setLoading] = useState(false);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [detailItem, setDetailItem] = useState<CustomListItem | null>(null);

    const handlePreview = async () => {
        if (!description.trim()) {
            return;
        }
        setLoading(true);
        setError(null);
        try {
            const result = await api.previewDescribedCatalog(description.trim());
            setPreview(result);
            if (!name.trim()) {
                // A short default name from the description itself - trimmed to a
                // sane title length rather than dumping the whole sentence as the
                // catalog's name. Still just a starting point; the input below it
                // stays fully editable before save.
                const words = description.trim().split(/\s+/).slice(0, 6).join(" ");
                setName(words.charAt(0).toUpperCase() + words.slice(1));
            }
        } catch (err: any) {
            setError(err.message || "Failed to generate a preview");
        } finally {
            setLoading(false);
        }
    };

    const handleSave = async () => {
        if (!(name.trim() && preview)) {
            return;
        }
        setSaving(true);
        try {
            const saved = await api.saveDescribedCatalog({
                description: description.trim(),
                items: preview.items,
                name: name.trim(),
            });
            onSaved(saved);
        } catch (err: any) {
            toast.error(err.message || "Failed to save catalog");
        } finally {
            setSaving(false);
        }
    };

    const queryParts: string[] = [];
    if (preview?.summary) {
        queryParts.push(preview.summary);
    } else if (preview) {
        if (preview.query.genres.length) {
            queryParts.push(preview.query.genres.join("/"));
        }
        if (
            preview.query.yearFrom &&
            preview.query.yearTo &&
            preview.query.yearFrom !== preview.query.yearTo
        ) {
            queryParts.push(`${preview.query.yearFrom}-${preview.query.yearTo}`);
        } else if (preview.query.yearFrom) {
            queryParts.push(String(preview.query.yearFrom));
        }
        if (preview.query.maxRuntimeMinutes) {
            queryParts.push(`under ${preview.query.maxRuntimeMinutes}m`);
        }
        queryParts.push(preview.mediaType === "tv" ? "series" : "movies");
    }

    return (
        <>
            <Modal isOpen onClose={onClose} size="lg" title="Describe a catalog">
                <div className="space-y-4">
                    <div>
                        <textarea
                            autoFocus
                            className="w-full resize-none rounded-xl px-4 py-3 focus:outline-none"
                            maxLength={500}
                            onChange={(e) => {
                                setDescription(e.target.value);
                                setPreview(null);
                            }}
                            placeholder='e.g. "A 90s neo-noir under two hours" or "cozy horror series"'
                            rows={2}
                            style={{
                                background: "var(--color-surface-hover)",
                                border: "1px solid var(--color-surface-border)",
                                color: "var(--color-text)",
                            }}
                            value={description}
                        />
                        <p className="mt-1.5 text-muted text-xs">
                            Genre, decade, runtime, actors, directors, movie or series - whatever
                            you mention gets used. Already-watched titles are always excluded.
                        </p>
                    </div>

                    {!preview && (
                        <div className="flex justify-end">
                            <Button
                                disabled={!description.trim()}
                                isLoading={loading}
                                onClick={handlePreview}
                                variant="primary"
                            >
                                Preview
                            </Button>
                        </div>
                    )}

                    {error && (
                        <p className="rounded-lg bg-error-muted p-3 text-error text-sm">{error}</p>
                    )}

                    {preview && (
                        <div className="space-y-4">
                            <div className="rounded-xl bg-surface-hover p-3">
                                <p className="mb-1 text-subtle text-xs uppercase tracking-wide">
                                    {preview.usedAi ? "AI understood this as" : "Understood as"}
                                </p>
                                <p className="text-default text-sm">
                                    {queryParts.length > 0
                                        ? queryParts.join(" · ")
                                        : "No specific filters detected - showing top-rated results"}
                                </p>
                                {!preview.usedAi && preview.aiError && (
                                    <p
                                        className="mt-1.5 text-xs"
                                        style={{ color: "var(--color-error)" }}
                                    >
                                        Your configured AI key didn&apos;t work ({preview.aiError})
                                        - used the built-in keyword parser instead. Check the
                                        model/base URL pairing in{" "}
                                        <Link
                                            className="underline hover:text-default"
                                            href="/settings"
                                        >
                                            Settings
                                        </Link>
                                        .
                                    </p>
                                )}
                                {!(preview.usedAi || preview.aiError) && (
                                    <p className="mt-1.5 text-subtle text-xs">
                                        Using the built-in keyword parser.{" "}
                                        <Link
                                            className="underline hover:text-default"
                                            href="/settings"
                                        >
                                            Add an AI key in Settings
                                        </Link>{" "}
                                        for better understanding of nuanced descriptions.
                                    </p>
                                )}
                            </div>

                            {preview.items.length === 0 ? (
                                <p className="text-muted text-sm">
                                    No matches found - try rephrasing, or widening the
                                    runtime/decade.
                                </p>
                            ) : (
                                <div className="grid max-h-96 grid-cols-4 gap-3 overflow-y-auto p-1 sm:grid-cols-5">
                                    {preview.items.map((item) => (
                                        <button
                                            className="group text-left"
                                            key={item.id}
                                            onClick={() => setDetailItem(item)}
                                            type="button"
                                        >
                                            <PosterThumb
                                                className="aspect-[2/3] transition-transform group-hover:scale-[1.03] group-hover:ring-2 group-hover:ring-primary"
                                                item={item}
                                            />
                                            <p
                                                className="mt-1 truncate text-muted text-xs transition-colors group-hover:text-default"
                                                title={item.name}
                                            >
                                                {item.name}
                                            </p>
                                        </button>
                                    ))}
                                </div>
                            )}

                            {preview.items.length > 0 && (
                                <input
                                    className="w-full rounded-xl px-4 py-3 focus:outline-none"
                                    onChange={(e) => setName(e.target.value)}
                                    placeholder="Catalog name"
                                    style={{
                                        background: "var(--color-surface-hover)",
                                        border: "1px solid var(--color-surface-border)",
                                        color: "var(--color-text)",
                                    }}
                                    value={name}
                                />
                            )}

                            <div className="flex justify-between gap-3">
                                <Button onClick={() => setPreview(null)} variant="ghost">
                                    Try again
                                </Button>
                                <div className="flex gap-3">
                                    <Button onClick={onClose} variant="secondary">
                                        Cancel
                                    </Button>
                                    {preview.items.length > 0 && (
                                        <Button
                                            disabled={!name.trim()}
                                            isLoading={saving}
                                            onClick={handleSave}
                                            variant="primary"
                                        >
                                            Save as Catalog
                                        </Button>
                                    )}
                                </div>
                            </div>
                        </div>
                    )}
                </div>
            </Modal>
            {detailItem && (
                <MediaDetailModal
                    fallbackPoster={detailItem.poster || undefined}
                    fallbackTitle={detailItem.name}
                    isOpen={!!detailItem}
                    itemId={detailItem.id}
                    itemType={detailItem.type}
                    onClose={() => setDetailItem(null)}
                />
            )}
        </>
    );
}
