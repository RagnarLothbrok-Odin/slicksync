"use client";
import { readErrorMessage } from "@/lib/errors";

// Jellyfin | AIOStreams collections, one page. An AIOStreams account and a
// household's own Jellyfin server are both picked here; a Jellyfin server
// opens components/jellyfin/ServerCollections (catalogs as server-wide
// Jellyfin collections). For an AIOStreams account, the rest of this note:
//
// AIOStreams Collections - which of SlickSync's catalogs show up as
// collections in an AIOStreams login's apps (and every Jellyfin app signed in
// to it), in what order, under what name and cover. The counterpart of Nuvio
// Collections, and laid out like it: pick the account, then the profile. A
// profile sees its account's collections until it's given its own - the
// first change on a profile sets that up in AIOStreams with a variant on that
// profile (server/utils/aioProfileVariants.js). Out of the box every catalog
// with titles is one collection; once arranged here, the arrangement is
// used. Served through the AIOStreams link - see server/utils/aioCollections.js
// and routes/traxAddon.js. A tile opens its own page ([collectionId]/page.tsx).

import type { DragEndEvent } from "@dnd-kit/core";
import { arrayMove, rectSortingStrategy } from "@dnd-kit/sortable";
import {
    ArrowLeftIcon,
    ArrowUpTrayIcon,
    ArrowUturnLeftIcon,
    DocumentDuplicateIcon,
    EyeIcon,
    EyeSlashIcon,
    PlusIcon,
    ServerStackIcon,
    Squares2X2Icon,
    TrashIcon,
} from "@heroicons/react/24/outline";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { ServerCollections } from "@/components/jellyfin/ServerCollections";
import { Breadcrumbs, Header } from "@/components/layout/Header";
import { NebulaPageHeading } from "@/components/layout/NebulaTopbar";
import { PageSection } from "@/components/layout/PageContainer";
import {
    Badge,
    Button,
    Card,
    ConfirmModal,
    CSS,
    closestCenter,
    DndContext,
    Modal,
    SortableContext,
    useSortable,
    useSortableSensors,
} from "@/components/ui";
import { Avatar } from "@/components/ui/Avatar";
import { PasteCodeDialog, ShareCodeDialog } from "@/components/ui/ShareCodeDialog";
import { toast } from "@/components/ui/Toast";
import {
    type AioCollection,
    type AioCollectionAccount,
    type AioCollectionsExport,
    type AioCollectionsView,
    api,
    type JellyfinCollectionServer,
} from "@/lib/api";
import { usePersonalFeatures } from "@/lib/hooks/usePersonalFeatures";
import { useLayoutMode } from "@/lib/layout-mode";
import { cachedImageUrl, posterUrl } from "@/lib/posterUrl";
import { decodeShareCode, encodeAioCollectionsShareCode } from "@/lib/shareCodes";

const LIST = "/catalogs/aiostreams-collections";

function Tile({
    c,
    onOpen,
    onToggle,
    onRemove,
}: {
    c: AioCollection;
    onOpen: () => void;
    onToggle: () => void;
    onRemove: () => void;
}) {
    const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
        id: c.id,
    });
    // A cover that is just a title's poster shows like that title's poster card.
    const { rpdbEnabled } = usePersonalFeatures();
    const coverSrc = c.coverTitleId
        ? posterUrl({ id: c.coverTitleId, poster: c.cover }, rpdbEnabled)
        : cachedImageUrl(c.cover, 342);
    return (
        <div
            ref={setNodeRef}
            style={{
                transform: CSS.Transform.toString(transform),
                transition,
                zIndex: isDragging ? 10 : undefined,
            }}
            {...attributes}
            {...listeners}
            aria-label={`Open ${c.name}`}
            className={`group cursor-pointer overflow-hidden rounded-2xl border border-default bg-surface-hover transition-colors hover:border-primary/50 active:cursor-grabbing ${c.hidden ? "opacity-50" : ""}`}
            onClick={onOpen}
            onKeyDown={(e) => {
                if (e.key === "Enter" && e.target === e.currentTarget) {
                    onOpen();
                }
            }}
            role="button"
            tabIndex={0}
            title="Open, or drag to reorder"
        >
            <div className="relative aspect-[2/3] bg-surface">
                {coverSrc ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                        alt=""
                        className="absolute inset-0 h-full w-full object-cover"
                        draggable={false}
                        src={coverSrc}
                    />
                ) : (
                    <div className="absolute inset-0 flex items-center justify-center">
                        <Squares2X2Icon className="h-10 w-10 text-muted" />
                    </div>
                )}
                {c.hidden && (
                    <span className="absolute inset-0 flex items-center justify-center bg-black/40">
                        <EyeSlashIcon className="h-8 w-8 text-white" />
                    </span>
                )}
            </div>
            <div className="p-2.5">
                <p className="truncate font-medium text-default text-sm">{c.name}</p>
                <p className="truncate text-[11px] text-muted">
                    {c.titles} title{c.titles === 1 ? "" : "s"}
                    {c.catalogIds.length > 1 ? ` · ${c.catalogIds.length} catalogs` : ""}
                </p>
                <div
                    className="mt-2 flex items-center gap-1"
                    onClick={(e) => e.stopPropagation()}
                    onPointerDown={(e) => e.stopPropagation()}
                >
                    <button
                        aria-label={c.hidden ? `Show ${c.name}` : `Hide ${c.name}`}
                        className="rounded-lg p-1.5 text-muted hover:bg-surface hover:text-default"
                        onClick={onToggle}
                        title={c.hidden ? "Show" : "Hide"}
                        type="button"
                    >
                        {c.hidden ? (
                            <EyeIcon className="h-4 w-4" />
                        ) : (
                            <EyeSlashIcon className="h-4 w-4" />
                        )}
                    </button>
                    <button
                        aria-label={`Remove ${c.name}`}
                        className="ml-auto rounded-lg p-1.5 text-muted hover:bg-surface hover:text-error"
                        onClick={onRemove}
                        title="Remove"
                        type="button"
                    >
                        <TrashIcon className="h-4 w-4" />
                    </button>
                </div>
            </div>
        </div>
    );
}

export default function AiostreamsCollectionsPage() {
    const groupLabelId1 = useId();
    const router = useRouter();
    const searchParams = useSearchParams();
    const userId = searchParams.get("user") || "";
    const profileParam = searchParams.get("profile") || "";
    const { layoutMode } = useLayoutMode();
    const [accounts, setAccounts] = useState<AioCollectionAccount[] | null>(
        () =>
            api.peekGet<{ accounts: AioCollectionAccount[] }>("/jellyfin/collections/accounts")
                ?.accounts ?? null
    );

    const serverKey = searchParams.get("server") || "";
    const [servers, setServers] = useState<JellyfinCollectionServer[] | null>(
        () =>
            api.peekGet<{ servers: JellyfinCollectionServer[] }>(
                "/jellyfin/server-collections/servers"
            )?.servers ?? null
    );

    const loadAccounts = useCallback(() => {
        api.getAioCollectionAccounts()
            .then((r) => setAccounts(r.accounts))
            .catch((e: any) => {
                toast.error(e?.message || "Could not load the AIOStreams accounts");
                setAccounts((a) => a ?? []);
            });
    }, []);
    useEffect(() => {
        loadAccounts();
    }, [loadAccounts]);
    useEffect(() => {
        api.getJellyfinCollectionServers()
            .then((r) => setServers(r.servers))
            .catch(() => setServers((s) => s ?? []));
    }, []);

    const loading = accounts === null || servers === null;
    const choices = (accounts?.length || 0) + (servers?.length || 0);

    // Only one AIOStreams account or Jellyfin server: nothing to pick.
    useEffect(() => {
        if (userId || serverKey || loading || choices !== 1) {
            return;
        }
        if (accounts?.length) {
            router.replace(`${LIST}?user=${encodeURIComponent(accounts[0].id)}`);
        } else if (servers?.length) {
            router.replace(`${LIST}?server=${encodeURIComponent(servers[0].key)}`);
        }
    }, [accounts, servers, userId, serverKey, loading, choices, router]);

    const selected = accounts?.find((a) => a.id === userId) || null;
    const selectedServer = selected ? null : servers?.find((s) => s.key === serverKey) || null;
    const profile = selected?.profiles.find((p) => p.id === profileParam) || null;
    const pick = (id: string) => router.push(id ? `${LIST}?user=${encodeURIComponent(id)}` : LIST);
    const pickServer = (key: string) => router.push(`${LIST}?server=${encodeURIComponent(key)}`);
    const pickProfile = (id: string | null) =>
        router.replace(
            `${LIST}?user=${encodeURIComponent(userId)}${id ? `&profile=${encodeURIComponent(id)}` : ""}`
        );

    const backButton = (
        <Button
            leftIcon={<ArrowLeftIcon className="h-4 w-4" />}
            onClick={() => router.push("/catalogs")}
            size="sm"
            variant="ghost"
        >
            Back
        </Button>
    );
    const subtitle =
        "Which catalogs show up as collections in AIOStreams’ apps and on your own Jellyfin server";

    return (
        <>
            {layoutMode !== "nebula" && (
                <Header
                    actions={backButton}
                    subtitle={subtitle}
                    title={
                        <Breadcrumbs
                            className="font-semibold text-xl"
                            items={[
                                { href: "/catalogs", label: "Catalogs" },
                                { label: "Jellyfin | AIOStreams Collections" },
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
                            leading={backButton}
                            subtitle={subtitle}
                            title="Jellyfin | AIOStreams Collections"
                        />
                    )}

                    <PageSection>
                        {/* Same account grid -> compact strip as Nuvio Collections. */}
                        {selectedServer ? (
                            <ServerCollections
                                canSwitch={choices > 1}
                                key={selectedServer.key}
                                onSwitch={() => pick("")}
                                server={selectedServer}
                            />
                        ) : selected ? (
                            <Card className="mb-6" padding="lg">
                                <div className="flex flex-wrap items-end gap-x-6 gap-y-3">
                                    <button
                                        className="flex items-center gap-3 rounded-xl pr-3 text-left transition-colors hover:bg-surface-hover"
                                        onClick={() => (choices > 1 ? pick("") : undefined)}
                                        title={choices > 1 ? "Switch account" : undefined}
                                        type="button"
                                    >
                                        <Avatar
                                            colorIndex={selected.colorIndex ?? undefined}
                                            email={selected.email || undefined}
                                            name={selected.name}
                                            size="md"
                                            src={selected.avatarUrl || undefined}
                                            useGravatar={selected.useGravatar}
                                        />
                                        <div className="min-w-0">
                                            <div className="flex min-w-0 items-center gap-2">
                                                <p className="truncate font-medium text-default text-sm">
                                                    {selected.name}
                                                </p>
                                                <Badge
                                                    className="shrink-0"
                                                    size="sm"
                                                    variant="aiostreams"
                                                >
                                                    AIOStreams
                                                </Badge>
                                            </div>
                                            {choices > 1 && (
                                                <p className="text-primary text-xs">
                                                    Switch account
                                                </p>
                                            )}
                                        </div>
                                    </button>

                                    {selected.profiles.length > 0 && (
                                        <fieldset
                                            aria-labelledby={`${groupLabelId1}-1`}
                                            className="mx-0 min-w-0 border-0 p-0"
                                        >
                                            <p
                                                className="mb-1.5 block font-medium text-muted text-xs"
                                                id={`${groupLabelId1}-1`}
                                            >
                                                Profile
                                            </p>
                                            {/* Same profile pills as Nuvio Collections. A profile still on its
                          account's collections says so; one with its own is marked. */}
                                            <div className="flex flex-wrap gap-2">
                                                {[
                                                    {
                                                        id: null as string | null,
                                                        name: selected.name,
                                                        own: true,
                                                    },
                                                    ...selected.profiles,
                                                ].map((p) => {
                                                    const on =
                                                        (p.id || null) === (profile?.id || null);
                                                    return (
                                                        <button
                                                            aria-pressed={on}
                                                            className={`flex items-center gap-2 rounded-lg border py-1.5 pr-3 pl-1.5 text-sm transition-colors ${
                                                                on
                                                                    ? "border-primary bg-primary/10 text-default"
                                                                    : "border-default bg-subtle text-subtle hover:bg-surface-hover hover:text-default"
                                                            }`}
                                                            key={p.id || "main"}
                                                            onClick={() => pickProfile(p.id)}
                                                            type="button"
                                                        >
                                                            <Avatar name={p.name} size="xs" />
                                                            <span
                                                                className="truncate"
                                                                style={{ maxWidth: "120px" }}
                                                            >
                                                                {p.name}
                                                            </span>
                                                            {p.id && !p.own && (
                                                                <span className="whitespace-nowrap text-[10px] text-muted">
                                                                    shared
                                                                </span>
                                                            )}
                                                        </button>
                                                    );
                                                })}
                                            </div>
                                        </fieldset>
                                    )}
                                </div>
                            </Card>
                        ) : (
                            <Card className="mb-6" padding="lg">
                                <h3 className="mb-3 block font-medium text-muted text-xs">
                                    AIOStreams account or Jellyfin server
                                </h3>
                                {loading || (!(userId || serverKey) && choices === 1) ? (
                                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4">
                                        {Array.from({ length: 4 }).map((_, i) => (
                                            <div
                                                className="h-20 animate-pulse rounded-xl bg-surface-hover"
                                                key={i}
                                            />
                                        ))}
                                    </div>
                                ) : choices === 0 ? (
                                    <p className="text-subtle text-xs">
                                        Nobody here signs in with AIOStreams or to a Jellyfin server
                                        of their own yet. Add someone with Users &rarr; Add &rarr;
                                        Jellyfin | AIOStreams.{" "}
                                        <Link
                                            className="text-primary hover:underline"
                                            href="/guides/add-jellyfin-account"
                                        >
                                            How
                                        </Link>
                                    </p>
                                ) : (
                                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4">
                                        {(servers || []).map((s) => (
                                            <button
                                                className="flex items-center gap-3 rounded-xl border border-default bg-subtle p-3 text-left transition-colors hover:border-primary/50 hover:bg-surface-hover"
                                                key={s.key}
                                                onClick={() => pickServer(s.key)}
                                                type="button"
                                            >
                                                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-surface-hover">
                                                    <ServerStackIcon className="h-5 w-5 text-muted" />
                                                </span>
                                                <div className="min-w-0">
                                                    <p className="truncate font-medium text-default text-sm">
                                                        {s.name}
                                                    </p>
                                                    <p className="truncate text-subtle text-xs">
                                                        {s.people.map((p) => p.username).join(", ")}
                                                    </p>
                                                    <Badge
                                                        className="mt-1"
                                                        size="sm"
                                                        variant="jellyfin"
                                                    >
                                                        Jellyfin
                                                    </Badge>
                                                </div>
                                            </button>
                                        ))}
                                        {(accounts || []).map((a) => (
                                            <button
                                                className="flex items-center gap-3 rounded-xl border border-default bg-subtle p-3 text-left transition-colors hover:border-primary/50 hover:bg-surface-hover"
                                                key={a.id}
                                                onClick={() => pick(a.id)}
                                                type="button"
                                            >
                                                <Avatar
                                                    colorIndex={a.colorIndex ?? undefined}
                                                    email={a.email || undefined}
                                                    name={a.name}
                                                    size="md"
                                                    src={a.avatarUrl || undefined}
                                                    useGravatar={a.useGravatar}
                                                />
                                                <div className="min-w-0">
                                                    <p className="truncate font-medium text-default text-sm">
                                                        {a.name}
                                                    </p>
                                                    {a.profiles.length > 0 && (
                                                        <p className="truncate text-subtle text-xs">
                                                            {a.profiles
                                                                .map((p) => p.name)
                                                                .join(", ")}
                                                        </p>
                                                    )}
                                                    <Badge
                                                        className="mt-1"
                                                        size="sm"
                                                        variant="aiostreams"
                                                    >
                                                        AIOStreams
                                                    </Badge>
                                                </div>
                                            </button>
                                        ))}
                                    </div>
                                )}
                            </Card>
                        )}

                        {selected && (
                            <AccountCollections
                                account={selected}
                                accounts={accounts || []}
                                key={`${selected.id}:${profile?.id || ""}`}
                                onProfileChanged={loadAccounts}
                                profile={profile}
                            />
                        )}
                    </PageSection>
                </div>
            </div>
        </>
    );
}

/** Somewhere "Copy to" can send a set of collections: an account, or a profile on one. */
interface CopyTarget {
    blocked: string | null;
    detail: string;
    name: string;
    profileId: string | null;
    userId: string;
}

/** One AIOStreams account's (or profile's) collections: reorder, hide, remove, open. */
function AccountCollections({
    account,
    profile,
    accounts,
    onProfileChanged,
}: {
    account: AioCollectionAccount;
    profile: AioCollectionAccount["profiles"][number] | null;
    /** Every AIOStreams account here - where "Copy to" can send these. */
    accounts: AioCollectionAccount[];
    onProfileChanged: () => void;
}) {
    const router = useRouter();
    const sensors = useSortableSensors();
    const userId = account.id;
    const profileId = profile?.id || null;
    const path = api.aioCollectionsPath(userId, profileId);
    const [view, setView] = useState<AioCollectionsView | null>(
        () => api.peekGet<AioCollectionsView>(path) ?? null
    );
    const [collections, setCollections] = useState<AioCollection[]>(
        () => api.peekGet<AioCollectionsView>(path)?.collections ?? []
    );
    const [saving, setSaving] = useState(false);
    const [confirmReset, setConfirmReset] = useState(false);
    const [removing, setRemoving] = useState<AioCollection | null>(null);
    // What the server last accepted, to fall back to if a save fails, and the
    // save in flight - each change waits for the one before so they land in order.
    const saved = useRef<AioCollection[]>(collections);
    const queue = useRef<Promise<unknown>>(Promise.resolve());

    const load = useCallback(async () => {
        try {
            const next = await api.getAioCollections(userId, profileId);
            setView(next);
            setCollections(next.collections);
            saved.current = next.collections;
        } catch (e) {
            toast.error(readErrorMessage(e, "Could not load the collections"));
        }
    }, [userId, profileId]);
    useEffect(() => {
        load();
    }, [load]);

    // A profile still on its account's collections: the first change gives it
    // its own (the server sets that up in AIOStreams first).
    const shared = !!profile && view?.profile?.own === false;

    // Every change on this page - hide, remove, reorder - saves straight away,
    // like a collection's own page does. There is no separate Save step to
    // forget: a removed collection used to come back on refresh without one.
    const change = (next: AioCollection[]) => {
        setCollections(next);
        queue.current = queue.current.then(async () => {
            try {
                await api.saveAioCollections(
                    userId,
                    next.map(({ id, name, coverUrl, catalogIds, hidden, order }) => ({
                        catalogIds,
                        coverUrl,
                        hidden,
                        id,
                        name,
                        order,
                    })),
                    profileId
                );
                saved.current = next;
                const becameOwn = !!profile && view?.profile?.own === false;
                setView((v) =>
                    v
                        ? {
                              ...v,
                              configured: true,
                              profile: v.profile ? { ...v.profile, own: true } : v.profile,
                          }
                        : v
                );
                if (becameOwn) {
                    toast.success(`${profile.name} has their own collections now`);
                    onProfileChanged();
                }
            } catch (e) {
                toast.error(readErrorMessage(e, "Could not save that change"));
                setCollections(saved.current);
            }
        });
    };

    // Letting go of a dragged tile also lands as a tap on it - not an open.
    const draggedAt = useRef(0);
    const onDragEnd = (e: DragEndEvent) => {
        draggedAt.current = Date.now();
        const { active, over } = e;
        if (!over || active.id === over.id) {
            return;
        }
        const from = collections.findIndex((c) => c.id === active.id);
        const to = collections.findIndex((c) => c.id === over.id);
        if (from >= 0 && to >= 0) {
            change(arrayMove(collections, from, to));
        }
    };

    const open = async (id: string) => {
        if (Date.now() - draggedAt.current < 300) {
            return;
        }
        await queue.current;
        router.push(
            `${LIST}/${encodeURIComponent(id)}?user=${encodeURIComponent(userId)}${profileId ? `&profile=${encodeURIComponent(profileId)}` : ""}`
        );
    };

    // --- Transfer: copy to another profile or account, a file, a share code ---
    const [transferOpen, setTransferOpen] = useState(false);
    // Lined up with the button's right edge, but always kept on screen: the
    // toolbar wraps on a phone, which can put the button anywhere in the row.
    const [transferLeft, setTransferLeft] = useState(0);
    const toggleTransfer = () => {
        const box = transferRef.current?.getBoundingClientRect();
        if (box) {
            const width = 240;
            const wanted = Math.min(Math.max(box.right - width, 8), window.innerWidth - 8 - width);
            setTransferLeft(wanted - box.left);
        }
        setTransferOpen((v) => !v);
    };
    const transferRef = useRef<HTMLDivElement>(null);
    useEffect(() => {
        if (!transferOpen) {
            return;
        }
        const close = (e: MouseEvent | TouchEvent) => {
            if (transferRef.current && !transferRef.current.contains(e.target as Node)) {
                setTransferOpen(false);
            }
        };
        document.addEventListener("mousedown", close);
        document.addEventListener("touchstart", close);
        return () => {
            document.removeEventListener("mousedown", close);
            document.removeEventListener("touchstart", close);
        };
    }, [transferOpen]);
    const [copyOpen, setCopyOpen] = useState(false);
    const [copyTo, setCopyTo] = useState<CopyTarget | null>(null);
    const [copying, setCopying] = useState(false);
    const [shareOpen, setShareOpen] = useState(false);
    const [pasteOpen, setPasteOpen] = useState(false);
    const fileRef = useRef<HTMLInputElement>(null);
    const here = profile ? profile.name : account.name;

    // Everywhere these could go: each account, and each profile on it.
    const targets: CopyTarget[] = accounts
        .flatMap((a) => [
            { blocked: null, detail: "Account", name: a.name, profileId: null, userId: a.id },
            ...a.profiles.map((p) => ({
                // A profile's first collections of its own are set up in AIOStreams,
                // which needs the configuration password SlickSync kept.
                blocked:
                    p.own || a.canSplit
                        ? null
                        : `Sign ${a.name} in again with the AIOStreams password first`,
                detail: `Profile on ${a.name}`,
                name: p.name,
                profileId: p.id,
                userId: a.id,
            })),
        ])
        .filter((t) => !(t.userId === userId && (t.profileId || null) === profileId));

    const doCopy = async () => {
        if (!copyTo) {
            return;
        }
        await queue.current;
        setCopying(true);
        try {
            await api.saveAioCollections(
                copyTo.userId,
                collections.map(({ id, name, coverUrl, catalogIds, hidden, order }) => ({
                    catalogIds,
                    coverUrl,
                    hidden,
                    id,
                    name,
                    order,
                })),
                copyTo.profileId
            );
            toast.success(`${copyTo.name} has ${here}'s collections now`);
            if (copyTo.profileId) {
                onProfileChanged();
            }
            setCopyTo(null);
            setCopyOpen(false);
        } catch (e) {
            toast.error(readErrorMessage(e, "Could not copy the collections"));
        } finally {
            setCopying(false);
        }
    };

    const exportPayload = async (): Promise<AioCollectionsExport> => {
        await queue.current;
        return api.exportAioCollections(userId, profileId);
    };

    const exportFile = async () => {
        try {
            const payload = await exportPayload();
            const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
            const url = URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = url;
            a.download = `aiostreams-collections-${here.replace(/[^\w-]+/g, "-").toLowerCase()}.json`;
            a.click();
            setTimeout(() => URL.revokeObjectURL(url), 1000);
        } catch (e) {
            toast.error(readErrorMessage(e, "Could not export the collections"));
        }
    };

    // A file or a code: its collections go after the ones already here.
    const importPayload = async (payload: AioCollectionsExport) => {
        await queue.current;
        const r = await api.importAioCollections(userId, payload, profileId);
        const made = r.catalogsCreated
            ? ` and ${r.catalogsCreated} new catalog${r.catalogsCreated === 1 ? "" : "s"}`
            : "";
        toast.success(`Added ${r.added} collection${r.added === 1 ? "" : "s"}${made}`);
        await load();
        if (profile) {
            onProfileChanged();
        }
    };

    const importFile = async (file: File) => {
        try {
            const payload = JSON.parse(await file.text());
            await importPayload(payload);
        } catch (e) {
            toast.error(
                e instanceof SyntaxError
                    ? "That file isn’t an AIOStreams collections export"
                    : readErrorMessage(e, "Could not import that file")
            );
        }
    };

    const reset = async () => {
        await queue.current;
        setSaving(true);
        try {
            await api.resetAioCollections(userId, profileId);
            toast.success(
                profile
                    ? `${profile.name} sees ${account.name}'s collections again`
                    : "Back to one collection per catalog"
            );
            await load();
            if (profile) {
                onProfileChanged();
            }
        } catch (e) {
            toast.error(readErrorMessage(e, "Could not reset"));
        } finally {
            setSaving(false);
            setConfirmReset(false);
        }
    };

    return (
        <>
            {view && !view.linked && (
                <Card className="mb-4" padding="md">
                    <p className="text-default text-sm">
                        These reach AIOStreams through this account&rsquo;s AIOStreams watch history
                        link. Turn it on (their page &rarr; Watch-tracking integrations) and add its
                        link to AIOStreams.{" "}
                        <Link
                            className="text-primary hover:underline"
                            href="/guides/aiostreams-watch-history"
                        >
                            How
                        </Link>
                    </p>
                </Card>
            )}

            {profile && view?.profile && (
                <Card className="mb-4" padding="md">
                    <p className="text-default text-sm">
                        {shared ? (
                            <>
                                {profile.name} sees {account.name}&rsquo;s collections. Change
                                anything below and {profile.name} gets their own &ndash; SlickSync
                                sets that up for {profile.name} in AIOStreams.
                            </>
                        ) : (
                            <>
                                {profile.name} has their own collections. {account.name} and the
                                other profiles don&rsquo;t see these.
                            </>
                        )}
                        {shared && !account.canSplit && (
                            <>
                                {" "}
                                To do that, SlickSync needs {account.name}&rsquo;s AIOStreams
                                configuration password &ndash; sign {account.name} in again with it.
                            </>
                        )}
                    </p>
                </Card>
            )}

            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                <p className="text-muted text-sm">
                    {view?.configured
                        ? "Tap a collection to change it, or drag to reorder. Each one holds the titles of the catalogs in it."
                        : "Right now every catalog is its own collection. Tap one to change it, or drag to reorder."}
                </p>
                <div className="flex items-center gap-2">
                    {profile
                        ? !shared &&
                          view?.profile && (
                              <Button
                                  leftIcon={<ArrowUturnLeftIcon className="h-4 w-4" />}
                                  onClick={() => setConfirmReset(true)}
                                  size="sm"
                                  variant="ghost"
                              >
                                  Use {account.name}&rsquo;s
                              </Button>
                          )
                        : view?.configured && (
                              <Button
                                  leftIcon={<ArrowUturnLeftIcon className="h-4 w-4" />}
                                  onClick={() => setConfirmReset(true)}
                                  size="sm"
                                  variant="ghost"
                              >
                                  One per catalog
                              </Button>
                          )}
                    <input
                        accept="application/json"
                        className="hidden"
                        onChange={(e) => {
                            const f = e.target.files?.[0];
                            if (f) {
                                importFile(f);
                            }
                            e.target.value = "";
                        }}
                        ref={fileRef}
                        type="file"
                    />
                    <div className="relative" ref={transferRef}>
                        <Button
                            aria-expanded={transferOpen}
                            leftIcon={<ArrowUpTrayIcon className="h-4 w-4" />}
                            onClick={toggleTransfer}
                            size="sm"
                            variant="ghost"
                        >
                            Transfer
                        </Button>
                        {transferOpen && (
                            <div
                                className="absolute top-full z-20 mt-2 w-60 rounded-xl border border-default bg-surface p-1.5 shadow-xl"
                                style={{ left: transferLeft }}
                            >
                                <button
                                    className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-default text-sm hover:bg-surface-hover disabled:pointer-events-none disabled:opacity-40"
                                    disabled={collections.length === 0 || targets.length === 0}
                                    onClick={() => {
                                        setTransferOpen(false);
                                        setCopyOpen(true);
                                    }}
                                    type="button"
                                >
                                    <DocumentDuplicateIcon className="h-4 w-4" /> Copy to another
                                    profile…
                                </button>
                                <p className="px-3 pt-2 pb-1 font-semibold text-[10px] text-muted uppercase tracking-wider">
                                    As a file
                                </p>
                                <button
                                    className="w-full rounded-lg px-3 py-2 text-left text-default text-sm hover:bg-surface-hover"
                                    onClick={() => {
                                        setTransferOpen(false);
                                        fileRef.current?.click();
                                    }}
                                    type="button"
                                >
                                    Import from a file…
                                </button>
                                <button
                                    className="w-full rounded-lg px-3 py-2 text-left text-default text-sm hover:bg-surface-hover disabled:pointer-events-none disabled:opacity-40"
                                    disabled={collections.length === 0}
                                    onClick={() => {
                                        setTransferOpen(false);
                                        exportFile();
                                    }}
                                    type="button"
                                >
                                    Export to a file
                                </button>
                                <p className="px-3 pt-2 pb-1 font-semibold text-[10px] text-muted uppercase tracking-wider">
                                    As a share code
                                </p>
                                <button
                                    className="w-full rounded-lg px-3 py-2 text-left text-default text-sm hover:bg-surface-hover"
                                    onClick={() => {
                                        setTransferOpen(false);
                                        setPasteOpen(true);
                                    }}
                                    type="button"
                                >
                                    Paste a code…
                                </button>
                                <button
                                    className="w-full rounded-lg px-3 py-2 text-left text-default text-sm hover:bg-surface-hover disabled:pointer-events-none disabled:opacity-40"
                                    disabled={collections.length === 0}
                                    onClick={() => {
                                        setTransferOpen(false);
                                        setShareOpen(true);
                                    }}
                                    type="button"
                                >
                                    Create a code…
                                </button>
                            </div>
                        )}
                    </div>
                    <Button
                        leftIcon={<PlusIcon className="h-4 w-4" />}
                        onClick={() => open("new")}
                        size="sm"
                        variant="secondary"
                    >
                        New collection
                    </Button>
                </div>
            </div>

            {view ? (
                collections.length === 0 ? (
                    <Card padding="lg">
                        <p className="text-center text-muted text-sm">
                            {view.configured
                                ? "No collections. Add one with New collection, or go back to One per catalog."
                                : "No catalogs with titles yet. Make one on the Catalogs page."}
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
                            items={collections.map((c) => c.id)}
                            strategy={rectSortingStrategy}
                        >
                            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
                                {collections.map((c) => (
                                    <Tile
                                        c={c}
                                        key={c.id}
                                        onOpen={() => open(c.id)}
                                        onRemove={() => setRemoving(c)}
                                        onToggle={() =>
                                            change(
                                                collections.map((x) =>
                                                    x.id === c.id ? { ...x, hidden: !x.hidden } : x
                                                )
                                            )
                                        }
                                    />
                                ))}
                            </div>
                        </SortableContext>
                    </DndContext>
                )
            ) : (
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
                    {Array.from({ length: 6 }).map((_, i) => (
                        <div
                            className="aspect-[2/3] animate-pulse rounded-2xl bg-surface-hover"
                            key={i}
                        />
                    ))}
                </div>
            )}

            <ConfirmModal
                confirmText="Remove"
                description="It stops showing in AIOStreams' apps. The catalogs in it stay as they are."
                isOpen={!!removing}
                onClose={() => setRemoving(null)}
                onConfirm={() => {
                    if (removing) {
                        change(collections.filter((x) => x.id !== removing.id));
                    }
                    setRemoving(null);
                }}
                title={`Remove ${removing?.name || "this collection"}?`}
            />

            <Modal
                isOpen={copyOpen}
                onClose={() => {
                    setCopyOpen(false);
                    setCopyTo(null);
                }}
                size="md"
                title={`Copy ${here}'s collections to…`}
            >
                <div className="space-y-4">
                    {copyTo ? (
                        <>
                            <p className="text-default text-sm">
                                {copyTo.name}&rsquo;s collections are replaced with {here}&rsquo;s{" "}
                                {collections.length}: the same names, covers, order and catalogs.
                                {copyTo.profileId && (
                                    <>
                                        {" "}
                                        If {copyTo.name} doesn&rsquo;t have collections of their own
                                        yet, SlickSync sets that up in AIOStreams.
                                    </>
                                )}
                            </p>
                            <div className="flex justify-end gap-2">
                                <Button
                                    disabled={copying}
                                    onClick={() => setCopyTo(null)}
                                    size="sm"
                                    variant="ghost"
                                >
                                    Back
                                </Button>
                                <Button
                                    isLoading={copying}
                                    onClick={doCopy}
                                    size="sm"
                                    variant="primary"
                                >
                                    Copy to {copyTo.name}
                                </Button>
                            </div>
                        </>
                    ) : (
                        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                            {targets.map((t) => (
                                <button
                                    className="flex items-center gap-3 rounded-xl border border-default bg-subtle p-3 text-left transition-colors hover:border-primary/50 hover:bg-surface-hover disabled:pointer-events-none disabled:opacity-40"
                                    disabled={!!t.blocked}
                                    key={`${t.userId}:${t.profileId || ""}`}
                                    onClick={() => setCopyTo(t)}
                                    title={t.blocked || undefined}
                                    type="button"
                                >
                                    <Avatar name={t.name} size="sm" />
                                    <div className="min-w-0">
                                        <p className="truncate font-medium text-default text-sm">
                                            {t.name}
                                        </p>
                                        <p
                                            className={`text-subtle text-xs ${t.blocked ? "" : "truncate"}`}
                                        >
                                            {t.blocked || t.detail}
                                        </p>
                                    </div>
                                </button>
                            ))}
                        </div>
                    )}
                </div>
            </Modal>

            <ShareCodeDialog
                generate={async () => encodeAioCollectionsShareCode(await exportPayload())}
                isOpen={shareOpen}
                onClose={() => setShareOpen(false)}
                summary={`${here}'s ${collections.length} collection${collections.length === 1 ? "" : "s"} and the catalogs in them, titles included - pasted into another SlickSync, any catalog it doesn't have is made`}
                title="Share collections as a code"
            />

            <PasteCodeDialog
                isOpen={pasteOpen}
                onClose={() => setPasteOpen(false)}
                onImport={async (text) => {
                    const decoded = decodeShareCode(text);
                    if (decoded?.kind !== "aioCollections") {
                        throw new Error("That code isn’t an AIOStreams collections code");
                    }
                    await importPayload(decoded.payload as unknown as AioCollectionsExport);
                }}
                placeholder="Paste an SSJ1: collections code…"
                title={`Add collections to ${here} from a code`}
            />

            <ConfirmModal
                confirmText={profile ? "Use theirs" : "Reset"}
                description={
                    profile
                        ? `${profile.name}'s own arrangement is cleared and ${profile.name} sees ${account.name}'s collections again. SlickSync takes its setup back out of AIOStreams.`
                        : "Your arrangement - names, covers, order and which catalogs are grouped - is cleared, and every catalog with titles shows as its own collection again."
                }
                isLoading={saving}
                isOpen={confirmReset}
                onClose={() => setConfirmReset(false)}
                onConfirm={reset}
                title={
                    profile
                        ? `Give ${profile.name} ${account.name}'s collections again?`
                        : "Go back to one collection per catalog?"
                }
            />
        </>
    );
}
