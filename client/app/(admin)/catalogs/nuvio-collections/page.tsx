"use client";

import type { DragEndEvent } from "@dnd-kit/core";
import { restrictToParentElement } from "@dnd-kit/modifiers";
import { arrayMove, rectSortingStrategy } from "@dnd-kit/sortable";
import {
    ArrowDownIcon,
    ArrowLeftIcon,
    ArrowTopRightOnSquareIcon,
    ArrowUpIcon,
    ArrowUpTrayIcon,
    Bars3BottomLeftIcon,
    ChevronDownIcon,
    ChevronRightIcon,
    DocumentDuplicateIcon,
    EllipsisVerticalIcon,
    ExclamationTriangleIcon,
    EyeIcon,
    FilmIcon,
    FolderIcon,
    MapPinIcon,
    PencilSquareIcon,
    PhotoIcon,
    PlusIcon,
    QuestionMarkCircleIcon,
    RectangleStackIcon,
    SparklesIcon,
    TrashIcon,
    TvIcon,
} from "@heroicons/react/24/outline";
import { MapPinIcon as MapPinIconSolid } from "@heroicons/react/24/solid";
import { AnimatePresence, motion } from "framer-motion";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { Breadcrumbs, Header } from "@/components/layout/Header";
import { NebulaPageHeading } from "@/components/layout/NebulaTopbar";
import { PageSection } from "@/components/layout/PageContainer";
import { AvatarPickerModal } from "@/components/modals/AvatarPickerModal";
import { HomeRowsEditor } from "@/components/nuvio/HomeRowsEditor";
import {
    Badge,
    Button,
    Card,
    CSS,
    closestCenter,
    DndContext,
    MediaDetailModal,
    Modal,
    SortableContext,
    useSortable,
    useSortableSensors,
} from "@/components/ui";
import { Avatar } from "@/components/ui/Avatar";
import { ScrollRow } from "@/components/ui/ScrollRow";
import { PasteCodeDialog, ShareCodeDialog } from "@/components/ui/ShareCodeDialog";
import { toast } from "@/components/ui/Toast";
import {
    api,
    type NuvioCatalogSource,
    type NuvioCollection,
    type NuvioCollectionFolder,
    type NuvioProfile,
    type StremioAddon,
    type User,
} from "@/lib/api";
import { readErrorMessage } from "@/lib/errors";
import { useLayoutMode } from "@/lib/layout-mode";
import { decodeShareCode, encodeNuvioCollectionsShareCode } from "@/lib/shareCodes";
import { useDefaultViewMode } from "@/lib/viewMode";

// Starter templates - genre folders built from each catalog's own "genre"
// extra parameter, not from separate per-genre catalogs. Confirmed two ways
// this session: real installed addons expose genre as a filter VALUE on one
// broad catalog (manifest.catalogs[].extra: [{name:'genre', options:[...]}])
// rather than one catalog per genre, and real Collections data already
// carries a `genre` field on each catalogSource entry for exactly this
// reason. An earlier version of this feature matched by catalog NAME
// keywords instead (e.g. hunting for a catalog literally named "Action" or
// "Netflix") - that failed against a real test account (0 of 9 folders
// matched) because AIOMetadata's actual catalogs are generic/aggregated
// ("Mix Of Movies", "TMDB + TVDB"), and "streaming service" folders in a
// real account turned out to be hand-curated mdblist picks with no signal
// in the catalog name at all - not something automatable, so that template
// was dropped rather than shipped as something that mostly shows "0
// matches."
interface GenreTemplateSlot {
    aliases: string[]; // matched case-insensitively against a catalog's own genre option value
    title: string;
}

const GENRE_TEMPLATE: {
    id: string;
    title: string;
    description: string;
    genres: GenreTemplateSlot[];
} = {
    description:
        "One folder per genre, using each matching catalog's own genre filter - not a separate catalog per genre.",
    // Broader than TMDb's own genre list (the usual source addons draw their
    // own genre-extra options from) plus a couple of common regional/style
    // groupings (Anime, Korean) real accounts turned out to actually have as
    // their own distinct catalogs, not folded into Animation - splitting
    // those two out matched a real account exactly (13 real matches) where
    // the earlier combined 9-entry list undershot it. Genres with zero
    // matching sources on a given account are dropped automatically (see
    // the filter below), so listing more candidates than any one account
    // will use is free - it only ever produces MORE useful folders, never
    // empty ones.
    genres: [
        { aliases: ["action"], title: "Action" },
        { aliases: ["adventure"], title: "Adventure" },
        { aliases: ["animation"], title: "Animation" },
        { aliases: ["anime"], title: "Anime" },
        { aliases: ["comedy"], title: "Comedy" },
        { aliases: ["crime"], title: "Crime" },
        { aliases: ["documentary"], title: "Documentary" },
        { aliases: ["drama"], title: "Drama" },
        { aliases: ["family"], title: "Family" },
        { aliases: ["fantasy"], title: "Fantasy" },
        { aliases: ["horror"], title: "Horror" },
        { aliases: ["korean"], title: "Korean" },
        { aliases: ["music", "musical"], title: "Music" },
        { aliases: ["mystery"], title: "Mystery" },
        { aliases: ["romance"], title: "Romance" },
        { aliases: ["sci-fi", "science fiction"], title: "Sci-Fi" },
        { aliases: ["thriller"], title: "Thriller" },
        { aliases: ["war"], title: "War" },
        { aliases: ["western"], title: "Western" },
    ],
    id: "genres",
    title: "Genres",
};

// A catalog's `genre` extra having an option that matches an alias isn't
// enough on its own - confirmed live against a real account: AIOMetadata
// exposes MDBList's full ~40-item generic genre taxonomy (down to junk like
// "Home and Garden", "Talk Show", "Donghua") on catalogs that are actually
// small, static, hand-curated lists ("Nostalgic Movies of the 80s & 90s",
// "Movie Collections", "Kids + 90s Kids") that don't meaningfully filter by
// genre at all. The result: unrelated genre folders (Action, Adventure,
// Fantasy) all pulled from the same static list and showed the identical
// top item as their hero poster, while genres poorly represented in that
// list (Anime) came back with sources attached but zero real items. Both
// tells are cheap to detect from the manifest alone, with no extra network
// calls: the catalog id is literally "mdblist.<id>" (MDBList-backed static
// lists always self-identify this way), or the catalog is `type: "all"`
// (a mixed-media curated/merged catalog, never how a real per-type
// genre-browsable catalog - Cinemeta's included - is shaped).
function isReliableGenreCatalog(cat: { id: string; type: string }): boolean {
    return !cat.id.includes("mdblist") && cat.type !== "all";
}

function matchGenreSources(aliases: string[], addons: StremioAddon[]): NuvioCatalogSource[] {
    const matches: NuvioCatalogSource[] = [];
    for (const addon of addons) {
        const addonId = addon.manifest?.id || addon.transportUrl;
        for (const cat of addon.manifest?.catalogs || []) {
            if (!isReliableGenreCatalog(cat)) {
                continue;
            }
            const genreExtra = cat.extra?.find((e) => e.name === "genre");
            const matchedOption = (genreExtra?.options || []).find((opt) =>
                aliases.some((a) => opt.toLowerCase() === a || opt.toLowerCase().includes(a))
            );
            if (matchedOption) {
                matches.push({ addonId, catalogId: cat.id, genre: matchedOption, type: cat.type });
            }
        }
    }
    return matches;
}

// Nuvio's own native "Collections" - the home-screen folder/catalog-source
// organizer in the real Nuvio app, live-synced against the account itself
// (via sync_pull_collections/sync_push_collections on the same backend
// server/providers/nuvio.js already talks to for library/addons). Distinct
// from this app's local Catalogs lists one level up.
//
// v1 scope is deliberately narrow: title/folders/catalogSources only - the
// structural fields this feature exists to edit, all fully working
// end-to-end. Every other field a real Collection can carry (pinToTop,
// viewMode, coverImageUrl, tileShape, focusGifEnabled, ...) is a Nuvio-app-
// only visual effect with no way to preview from here, so v1 leaves them
// alone entirely rather than shipping an unverifiable toggle. Critically,
// those fields are preserved untouched through edit-and-save (see the
// spread-only mutation helpers below) - editing a title must never silently
// delete a real account's existing settings for the rest.

type PickerTarget = { collectionId: string; folderId: string } | null;

function newId() {
    return typeof crypto !== "undefined" && crypto.randomUUID
        ? crypto.randomUUID()
        : Math.random().toString(36).slice(2, 10);
}

function moveItem<T>(arr: T[], index: number, dir: -1 | 1): T[] {
    const next = [...arr];
    const target = index + dir;
    if (target < 0 || target >= next.length) {
        return arr;
    }
    [next[index], next[target]] = [next[target], next[index]];
    return next;
}

// Confirmed live (2026-08-06): Nuvio's real client only picks up a folder
// object on FIRST sync if it carries these fields - a folder missing them
// entirely (not just falsy) silently never renders, even after a full app
// restart, even though the write itself lands correctly and reads back
// fine everywhere (including this app's own editor). Pre-existing folders
// already in an account keep working without them since they're not going
// through whatever "is this a genuinely new folder" check gates a first
// sync - but every NEW folder this editor creates needs them from the start.
function newFolderDefaults() {
    return { focusGifEnabled: false, hideTitle: false, tileShape: "LANDSCAPE" as const };
}

// Nuvio's app only animates a folder's coverImageUrl when focusGifEnabled
// is explicitly true - otherwise a real .gif cover just renders its first
// frame, static. The cover picker only ever asks for a URL, never whether
// it's a gif, so infer it from the extension (ignoring query strings, since
// CDN-hosted gifs like Tenor/Giphy links commonly carry a token after it).
function isGifUrl(url: string | null | undefined): boolean {
    if (!url) {
        return false;
    }
    try {
        return /\.gif$/i.test(new URL(url).pathname);
    } catch {
        return /\.gif(\?|$)/i.test(url);
    }
}

// Fresh ids for the collection and every folder inside it, so pasting a
// copy into a target profile never collides with (or aliases) the source's
// own ids. catalogSources carry no id of their own - copied as-is. Also
// backfills newFolderDefaults() for any folder missing them (e.g. copying
// an old-style folder, or importing a JSON export from before this fix) -
// a copy into a different profile is a first sync there regardless of
// whether it was "new" in the source profile.
function deepCopyCollection(c: NuvioCollection): NuvioCollection {
    return {
        ...c,
        folders: (c.folders || []).map((f) => ({
            ...newFolderDefaults(),
            ...f,
            catalogSources: [...(f.catalogSources || [])],
            id: newId(),
        })),
        id: newId(),
    };
}

type PreviewFolderItems = { id: string; type: string; name: string; poster: string | null }[];

// One grid tile: a single hero poster from the folder's own cached preview
// (ambient - no click needed, which is the actual fix for "the preview icon
// is too small") with the title/source-count on a solid bottom band for
// real contrast regardless of the poster's own colors, and a hover overlay
// that clearly labels the tile as a preview (per feedback: the old 2x2
// multi-poster collage read as "too busy," and it wasn't obvious this tile
// was even clickable). Delete sits as an absolutely-positioned sibling
// button, not nested inside the clickable tile, so a click on it never also
// counts as a click on the tile (see CatalogGridCard in catalogs/[id] for
// the same structure) - drag reorder and the open-folder click coexist
// safely because useSortableSensors' PointerSensor has an 8px activation
// distance, so a plain click never crosses the threshold to start a drag.
function FolderTile({
    folder,
    previewItems,
    heroItem,
    previewLoading,
    hasBrokenSource,
    coverOverride,
    onOpen,
    onDelete,
}: {
    folder: NuvioCollectionFolder;
    previewItems?: PreviewFolderItems;
    // Which item to show as the tile's hero poster - defaults to the
    // folder's own top item (items[0]), but CollectionSection may override
    // this to dedup heroes across folders in the same collection (see its
    // heroOverrideByFolder comment for why that matters).
    heroItem?: PreviewFolderItems[number] | null;
    previewLoading: boolean;
    hasBrokenSource: boolean;
    coverOverride?: string;
    onOpen: () => void;
    onDelete: () => void;
}) {
    const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
        id: folder.id,
    });
    const style: React.CSSProperties = {
        transform: CSS.Transform.toString(transform),
        transition: isDragging ? "none" : transition,
        zIndex: isDragging ? 50 : undefined,
    };
    const sourceCount = (folder.catalogSources || []).length;
    const items = previewItems || [];
    const hero = heroItem === undefined ? items[0] : heroItem;
    const heroPoster = coverOverride || hero?.poster;

    return (
        <div
            className={`group relative ${isDragging ? "opacity-50" : ""}`}
            ref={setNodeRef}
            style={style}
        >
            <button
                className="w-full overflow-hidden rounded-xl border border-default bg-subtle text-left transition-colors hover:border-primary/50"
                onClick={onOpen}
                type="button"
                {...attributes}
                {...listeners}
            >
                <div className="relative aspect-[4/3] bg-surface-hover">
                    {heroPoster ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img alt="" className="h-full w-full object-cover" src={heroPoster} />
                    ) : sourceCount === 0 || items.length === 0 ? (
                        <div className="flex h-full w-full items-center justify-center">
                            {previewLoading ? (
                                <div className="h-5 w-5 animate-spin rounded-full border-2 border-subtle border-t-transparent" />
                            ) : (
                                <FolderIcon className="h-8 w-8 text-subtle" />
                            )}
                        </div>
                    ) : (
                        <div className="flex h-full w-full items-center justify-center p-2 text-center text-subtle text-xs">
                            {hero?.name}
                        </div>
                    )}

                    {/* Hover overlay - explicit "Preview" label + icon, so the tile
              unambiguously reads as clickable instead of relying on the
              cursor alone. */}
                    <div className="absolute inset-0 flex items-center justify-center bg-black/0 transition-colors group-hover:bg-black/50">
                        <div className="flex flex-col items-center gap-1.5 text-white opacity-0 transition-opacity group-hover:opacity-100">
                            <EyeIcon className="h-6 w-6" />
                            <span className="font-semibold text-xs">Preview</span>
                        </div>
                    </div>

                    {/* Solid band (not just a gradient) so title/count stay readable
              against any poster's own colors. */}
                    <div className="absolute inset-x-0 bottom-0 bg-black/85 px-2.5 py-2">
                        <p className="truncate font-semibold text-sm text-white">{folder.title}</p>
                        <p className="flex items-center gap-1 text-white/80 text-xs">
                            {sourceCount} source{sourceCount === 1 ? "" : "s"}
                            {sourceCount === 0 ? (
                                <span className="font-medium text-warning">
                                    · won&apos;t appear in Nuvio yet
                                </span>
                            ) : (
                                hasBrokenSource && (
                                    <span className="font-medium text-warning">
                                        · needs attention
                                    </span>
                                )
                            )}
                        </p>
                    </div>

                    {/* Always visible, not hover-only - a broken or missing source is
              worth noticing at a glance, same reasoning as the old tiny
              preview icon that got missed entirely. A folder with zero
              sources saves fine and round-trips through Nuvio's sync
              correctly, but Nuvio's own apps silently don't render an empty
              folder at all - confirmed live, so this needs to be at least as
              visible as a broken source, not a silent no-op. */}
                    {(hasBrokenSource || sourceCount === 0) && (
                        <div
                            className="absolute top-1.5 left-1.5 rounded-lg bg-warning/90 p-1.5 text-black"
                            title={
                                sourceCount === 0
                                    ? "This folder has no sources yet - it won't show up in Nuvio until you add at least one"
                                    : "A source in this folder no longer resolves"
                            }
                        >
                            <ExclamationTriangleIcon className="h-4 w-4" />
                        </div>
                    )}
                </div>
            </button>
            <button
                className="absolute top-1.5 right-1.5 rounded-lg bg-black/60 p-1.5 text-white opacity-0 transition-opacity hover:bg-error group-hover:opacity-100"
                onClick={(e) => {
                    e.stopPropagation();
                    onDelete();
                }}
                title="Delete folder"
                type="button"
            >
                <TrashIcon className="h-4 w-4" />
            </button>
        </div>
    );
}

// Labeled dropdown for a collection's own actions (pin/copy/reorder/delete) -
// replaces a row of bare icon buttons that real feedback confirmed nobody
// could identify without hovering for a tooltip (no touch equivalent), and
// which visibly overflowed/got clipped on mobile at typical collection-
// header widths. One fixed-width trigger button can never overflow the
// same way a variable-length icon row could.
function CollectionActionsMenu({
    isPinned,
    canMoveUp,
    canMoveDown,
    canCopy,
    onTogglePin,
    onCopy,
    onMoveUp,
    onMoveDown,
    onDelete,
}: {
    isPinned: boolean;
    canMoveUp: boolean;
    canMoveDown: boolean;
    canCopy: boolean;
    onTogglePin: () => void;
    onCopy: () => void;
    onMoveUp: () => void;
    onMoveDown: () => void;
    onDelete: () => void;
}) {
    const [open, setOpen] = useState(false);
    const ref = useRef<HTMLDivElement>(null);
    useEffect(() => {
        if (!open) {
            return;
        }
        const onClickOutside = (e: MouseEvent) => {
            if (ref.current && !ref.current.contains(e.target as Node)) {
                setOpen(false);
            }
        };
        document.addEventListener("mousedown", onClickOutside);
        return () => document.removeEventListener("mousedown", onClickOutside);
    }, [open]);

    const item = (
        label: string,
        icon: React.ReactNode,
        onClick: () => void,
        opts?: { disabled?: boolean; danger?: boolean }
    ) => (
        <button
            className={`flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-sm transition-colors disabled:pointer-events-none disabled:opacity-30 ${opts?.danger ? "text-error hover:bg-error/10" : "text-default hover:bg-surface-hover"}`}
            disabled={opts?.disabled}
            onClick={() => {
                onClick();
                setOpen(false);
            }}
            type="button"
        >
            {icon}
            {label}
        </button>
    );

    return (
        <div className="relative shrink-0" ref={ref}>
            <button
                className="rounded-lg p-1.5 text-muted transition-colors hover:bg-surface-hover hover:text-default"
                onClick={() => setOpen((v) => !v)}
                title="Collection actions"
                type="button"
            >
                <EllipsisVerticalIcon className="h-5 w-5" />
            </button>
            {open && (
                <div className="absolute top-full right-0 z-20 mt-1 w-56 rounded-xl border border-default bg-surface p-1.5 shadow-xl">
                    {item(
                        isPinned ? "Unpin from top" : "Pin to top of home screen",
                        isPinned ? (
                            <MapPinIconSolid className="h-4 w-4 text-primary" />
                        ) : (
                            <MapPinIcon className="h-4 w-4" />
                        ),
                        onTogglePin
                    )}
                    {item(
                        "Copy to another profile",
                        <DocumentDuplicateIcon className="h-4 w-4" />,
                        onCopy,
                        { disabled: !canCopy }
                    )}
                    {item("Move up", <ArrowUpIcon className="h-4 w-4" />, onMoveUp, {
                        disabled: !canMoveUp,
                    })}
                    {item("Move down", <ArrowDownIcon className="h-4 w-4" />, onMoveDown, {
                        disabled: !canMoveDown,
                    })}
                    <div className="my-1 border-default border-t" />
                    {item("Delete collection", <TrashIcon className="h-4 w-4" />, onDelete, {
                        danger: true,
                    })}
                </div>
            )}
        </div>
    );
}

// One collection: header (rename/reorder/copy/delete, all at a real hit-
// target size instead of the old cramped w-3.5 icon row) plus a responsive
// grid of FolderTiles instead of an always-expanded indented list - the
// actual "make it feel like a grid, not a list" change. A dedicated
// component (rather than inlining this in a .map()) so useSortableSensors -
// a hook - can be called once per collection's own DndContext, each
// collection reordering its folders independently of every other one.
function CollectionSection({
    collection,
    cIndex,
    collectionsLength,
    otherProfilesCount,
    previewByFolder,
    previewLoadingIds,
    brokenFolderIds,
    onRename,
    onReorder,
    onDelete,
    onCopy,
    onAddFolder,
    onOpenFolder,
    onDeleteFolder,
    onFolderDragEnd,
    onTogglePin,
}: {
    collection: NuvioCollection;
    cIndex: number;
    collectionsLength: number;
    otherProfilesCount: number;
    previewByFolder: Record<string, PreviewFolderItems>;
    previewLoadingIds: Set<string>;
    brokenFolderIds: Set<string>;
    onRename: (title: string) => void;
    onReorder: (dir: -1 | 1) => void;
    onDelete: () => void;
    onCopy: () => void;
    onAddFolder: () => void;
    onOpenFolder: (folderId: string) => void;
    onDeleteFolder: (folderId: string) => void;
    onFolderDragEnd: (event: DragEndEvent) => void;
    onTogglePin: () => void;
}) {
    const sensors = useSortableSensors();
    const folders = collection.folders || [];
    const isPinned = !!collection.pinToTop;
    const brokenFolderCount = folders.filter(
        (f) => brokenFolderIds.has(f.id) || (f.catalogSources || []).length === 0
    ).length;

    // A genre template's folders often share sources (Cinemeta's own "Popular"
    // catalog, filtered per-genre) - confirmed live, its single most-popular
    // title is frequently tagged with more than one genre (a blockbuster
    // topping both the Action and Adventure charts at once, for example), so
    // the raw #1 item can legitimately be identical across folders even
    // though each folder's full list differs beyond that. Picking each
    // folder's hero in order and skipping any title already claimed by an
    // earlier folder in this same collection keeps every tile's cover
    // visually distinct without touching the real, correct underlying data.
    const heroOverrideByFolder = useMemo(() => {
        const used = new Set<string>();
        const map: Record<string, PreviewFolderItems[number] | null> = {};
        for (const f of folders) {
            const items = previewByFolder[f.id] || [];
            const pick = items.find((it) => !used.has(it.id)) || items[0] || null;
            if (pick) {
                used.add(pick.id);
            }
            map[f.id] = pick;
        }
        return map;
    }, [folders, previewByFolder]);

    return (
        <Card className="mb-4" padding="lg">
            <div className="mb-4 flex items-center gap-2">
                {/* Deliberately no collection-level cover editor here - real
            feedback was that a cover picker at this level is confusing
            clutter, since the thing anyone actually wants to customize is
            each individual FOLDER inside a collection (Netflix, Prime,
            etc - see FolderTile's own cover picker for that). Removed
            2026-08-05, not just restyled - a folder-level-only earlier
            pass here missed the actual ask twice before landing on this. */}
                <input
                    className="min-w-0 flex-1 rounded-lg border border-transparent bg-transparent px-2 py-1.5 font-semibold text-base text-default hover:border-default focus:border-primary focus:outline-none"
                    onChange={(e) => onRename(e.target.value)}
                    value={collection.title}
                />
                <span className="mr-1 shrink-0 text-subtle text-xs">
                    {folders.length} folder{folders.length === 1 ? "" : "s"}
                    {brokenFolderCount > 0 && (
                        <span className="ml-1 text-warning">
                            · {brokenFolderCount} need{brokenFolderCount === 1 ? "s" : ""} attention
                        </span>
                    )}
                </span>
                <CollectionActionsMenu
                    canCopy={otherProfilesCount > 0}
                    canMoveDown={cIndex < collectionsLength - 1}
                    canMoveUp={cIndex > 0}
                    isPinned={isPinned}
                    onCopy={onCopy}
                    onDelete={onDelete}
                    onMoveDown={() => onReorder(1)}
                    onMoveUp={() => onReorder(-1)}
                    onTogglePin={onTogglePin}
                />
            </div>

            {folders.length === 0 ? (
                <div className="rounded-xl border border-default border-dashed p-6 text-center">
                    <p className="mb-3 text-muted text-sm">No folders yet.</p>
                    <Button
                        leftIcon={<PlusIcon className="h-4 w-4" />}
                        onClick={onAddFolder}
                        size="sm"
                        variant="secondary"
                    >
                        Add folder
                    </Button>
                </div>
            ) : (
                <DndContext
                    collisionDetection={closestCenter}
                    modifiers={[restrictToParentElement]}
                    onDragEnd={onFolderDragEnd}
                    sensors={sensors}
                >
                    <SortableContext
                        items={folders.map((f) => f.id)}
                        strategy={rectSortingStrategy}
                    >
                        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
                            {folders.map((folder) => (
                                <FolderTile
                                    coverOverride={
                                        typeof folder.coverImageUrl === "string"
                                            ? folder.coverImageUrl
                                            : undefined
                                    }
                                    folder={folder}
                                    hasBrokenSource={brokenFolderIds.has(folder.id)}
                                    heroItem={heroOverrideByFolder[folder.id]}
                                    key={folder.id}
                                    onDelete={() => onDeleteFolder(folder.id)}
                                    onOpen={() => onOpenFolder(folder.id)}
                                    previewItems={previewByFolder[folder.id]}
                                    previewLoading={previewLoadingIds.has(folder.id)}
                                />
                            ))}
                            <button
                                className="flex aspect-[4/3] flex-col items-center justify-center gap-1.5 rounded-xl border border-default border-dashed text-subtle transition-colors hover:border-primary/50 hover:text-default"
                                onClick={onAddFolder}
                                type="button"
                            >
                                <PlusIcon className="h-6 w-6" />
                                <span className="font-medium text-xs">Add folder</span>
                            </button>
                        </div>
                    </SortableContext>
                </DndContext>
            )}
        </Card>
    );
}

export default function NuvioCollectionsPage() {
    const groupLabelId1 = useId();
    const fieldId1 = useId();
    const { layoutMode } = useLayoutMode();
    const router = useRouter();
    // Shared app-wide grid/list preference (Settings -> Themes), same hook
    // Activity/Addons/Users/etc. already use - defaults to 'grid' when unset.
    // Deliberately no page-level toggle for it here - it follows the global
    // Settings choice silently, same as every other page that reads it.
    const { viewMode } = useDefaultViewMode();
    // List mode only: which collection/folder rows are expanded, mirroring
    // the original inline nested-list UX exactly (grid mode has no notion of
    // "expanded" - each folder is its own always-visible tile).
    const [expanded, setExpanded] = useState<Record<string, boolean>>({});
    const toggleExpanded = (id: string) => setExpanded((prev) => ({ ...prev, [id]: !prev[id] }));

    const [users, setUsers] = useState<User[]>([]);
    const [usersLoading, setUsersLoading] = useState(true);
    const [selectedUserId, setSelectedUserId] = useState("");

    const [profiles, setProfiles] = useState<NuvioProfile[]>([]);
    const [profilesLoading, setProfilesLoading] = useState(false);
    const [selectedProfileIndex, setSelectedProfileIndex] = useState<number | null>(null);

    const [collections, setCollections] = useState<NuvioCollection[]>([]);
    const [savedSnapshot, setSavedSnapshot] = useState("[]");
    const [collectionsLoading, setCollectionsLoading] = useState(false);
    const [importExportInfoOpen, setImportExportInfoOpen] = useState(false);
    // Share codes for collections (ShareCodeDialog). Which ones go into the
    // code is chosen in the dialog - defaults to all, because "share my
    // layout" is the common case, but a household's whole shabang is rarely
    // what a friend actually asked for.
    const [showShareCode, setShowShareCode] = useState(false);
    const [shareSelected, setShareSelected] = useState<Set<string>>(new Set());
    const openShareCode = () => {
        setShareSelected(new Set(collections.map((c) => c.id)));
        setShowShareCode(true);
    };
    const [showPasteCode, setShowPasteCode] = useState(false);
    // The two info banners (TMDb templates, bridging a Catalog in) read fine
    // the first time but are a permanent eyesore taking up space on every
    // later visit - same "?" icon + Modal pattern as importExportInfoOpen
    // above, tucked away until someone actually wants them.
    const [tipsInfoOpen, setTipsInfoOpen] = useState(false);
    const [saving, setSaving] = useState(false);

    const [addons, setAddons] = useState<StremioAddon[]>([]);
    const [addonsLoading, setAddonsLoading] = useState(false);

    const [deleting, setDeleting] = useState<{
        kind: "collection" | "folder";
        collectionId: string;
        folderId?: string;
    } | null>(null);
    const [templatesOpen, setTemplatesOpen] = useState(false);

    const [pickerTarget, setPickerTarget] = useState<PickerTarget>(null);
    // Linked SlickSync catalogs: a folder source pointing at this user's own
    // SlickTrax Addon catalog (slicktrax-list-<id>). The addon serves the
    // catalog's CURRENT items on every request, so the folder follows the
    // catalog automatically - auto-refresh, manual edits, everything - with
    // no push machinery at all. The only precondition is the user's SlickTrax
    // Addon being enabled and synced onto the account.
    const [slickCatalogs, setSlickCatalogs] = useState<Awaited<
        ReturnType<typeof api.getLists>
    > | null>(null);
    const [traxEnabled, setTraxEnabled] = useState<boolean | null>(null);
    const [linkBusyId, setLinkBusyId] = useState<string | null>(null);
    const [pickerAddonId, setPickerAddonId] = useState<string | null>(null);
    const [pickerCatalog, setPickerCatalog] = useState<{
        id: string;
        type: string;
        name?: string;
    } | null>(null);
    const [pickerPreview, setPickerPreview] = useState<
        { id: string; type: string; name: string; poster: string | null }[]
    >([]);
    const [pickerPreviewLoading, setPickerPreviewLoading] = useState(false);
    const [detail, setDetail] = useState<{
        id: string;
        type: string;
        name: string;
        poster?: string | null;
    } | null>(null);

    // Per-folder preview cache - powers both the ambient poster-collage tile
    // thumbnail (ever-visible, no click needed - the actual fix for "the
    // preview icon is too small") and the folder detail modal's larger poster
    // row. Read-only: no setCollections call anywhere in this flow, so it
    // can't touch the unsaved-changes/dirty-state guard at all. Prefetched
    // automatically per-folder (see the effect below) rather than gated
    // behind an explicit "Preview" click.
    const [previewByFolder, setPreviewByFolder] = useState<Record<string, PreviewFolderItems>>({});
    const [previewLoadingIds, setPreviewLoadingIds] = useState<Set<string>>(new Set());

    // Which folder's detail modal (rename / sources / live preview row) is
    // open - clicking a grid tile opens this instead of the old always-
    // expanded inline nested list.
    const [folderDetail, setFolderDetail] = useState<{
        collectionId: string;
        folderId: string;
    } | null>(null);
    // Sources and Preview are tabs, not stacked sections - a folder with a
    // lot of preview posters otherwise pushed Sources far enough down that
    // reaching "Add source" needed scrolling every time, the actual place
    // most of the editing happens. Defaults to Sources for exactly that
    // reason; Preview is one click away, not the default landing view.
    const [folderDetailTab, setFolderDetailTab] = useState<"sources" | "preview">("sources");

    // List mode only - the original per-collection "Preview layout" button
    // (all folders at once). Reads straight from the same ambient
    // previewByFolder cache the grid tiles already populate - no separate
    // fetch-on-click needed the way the pre-redesign version had, since the
    // prefetch effect above already loads every folder's preview regardless
    // of which view mode is active.
    const [previewCollection, setPreviewCollection] = useState<NuvioCollection | null>(null);

    // Copy a Collection to another profile - writes immediately (not staged
    // in local `collections` state) since there's no "current session" for a
    // profile you're not actively viewing to hold a draft in.
    const [copyTarget, setCopyTarget] = useState<NuvioCollection | null>(null);
    const [copyingToIndex, setCopyingToIndex] = useState<number | null>(null);

    // Which collection's cover-image picker is open. coverImageUrl is a real
    // field Nuvio's own app reads (unlike most other unedited Collection
    // fields - see the big comment above this component) so it's worth a
    // real editor, reusing the same AvatarPickerModal Catalogs already uses.

    // Per-folder cover - coverImageUrl is a real field on the folder object
    // itself (confirmed via a real exported Collections JSON: each folder has
    // its own coverImageUrl, alongside tileShape/focusGifUrl/hideTitle - not
    // just a collection-level field). Read/write it the same way the
    // collection-level cover already does, straight on the folder object via
    // updateFolder, so it round-trips through setNuvioCollections like every
    // other real field here. (An earlier version of this stored the override
    // client-side only in localStorage on the mistaken assumption that no such
    // field existed - fixed once the real field turned up.)
    const [coverPickerFolder, setCoverPickerFolder] = useState<{
        collectionId: string;
        folderId: string;
    } | null>(null);

    const isDirty = JSON.stringify(collections) !== savedSnapshot;
    const nuvioUsers = useMemo(() => users.filter((u) => u.providerType === "nuvio"), [users]);
    const selectedUser = nuvioUsers.find((u) => u.id === selectedUserId) || null;

    // Sources are stored as bare {addonId, type, catalogId} - resolves to a
    // real, readable name using the addon manifests already loaded for the
    // source picker, instead of showing raw ids like "aio-metadata ·
    // mdblist.88328". Falls back to the raw id only when the addon/catalog
    // can no longer be found (e.g. the addon was since removed).
    const describeSource = useCallback(
        (source: NuvioCatalogSource) => {
            const addon = addons.find((a) => a.manifest?.id === source.addonId);
            const catalog = addon?.manifest?.catalogs?.find(
                (c) => c.id === source.catalogId && c.type === source.type
            );
            const linked =
                typeof source.addonId === "string" &&
                source.addonId.startsWith("vip.slicksync.trax.");
            // A SlickTrax addon id carries the id of the SlickSync user it belongs
            // to, so a linked source says which instance created it. One made on a
            // DIFFERENT instance (a test box sharing the same Nuvio account, an old
            // install, a user since deleted) can never resolve here no matter how
            // many times sync runs - the lists it points at live in another
            // database. Worth telling apart, because the advice is the opposite:
            // one is "wait", the other is "link it again here".
            const linkedUserId = linked ? source.addonId.slice("vip.slicksync.trax.".length) : null;
            const linkedHere = !!linkedUserId && users.some((u) => u.id === linkedUserId);
            return {
                addonName: addon?.name || addon?.manifest?.name || source.addonId,
                catalogName: catalog?.name || source.catalogId,
                // False when the addon was removed, or is still installed but no
                // longer exposes this catalog (renamed/removed catalog id) - a real
                // failure mode since a source is only ever a bare {addonId,
                // catalogId} pointer, nothing here validates it stays resolvable
                // over time. Only meaningful once `addons` has actually loaded -
                // during the loading window itself, treat every source as fine
                // rather than flashing a false "broken" state before data arrives.
                found: addonsLoading || !!catalog,
                linked,
                linkedHere,
            };
        },
        [addons, addonsLoading, users]
    );

    // A folder is broken if ANY of its sources no longer resolve - checked
    // once per folder (not per source) since that's the granularity the grid
    // tile and collection-level indicators need.
    const folderHasBrokenSource = useCallback(
        (folder: NuvioCollectionFolder) => {
            if (addonsLoading) {
                return false;
            }
            return (folder.catalogSources || []).some((s) => !describeSource(s).found);
        },
        [addonsLoading, describeSource]
    );

    useEffect(() => {
        api.getUsers()
            .then((r) => setUsers(Array.isArray(r) ? r : []))
            .catch(() => setUsers([]))
            .finally(() => setUsersLoading(false));
    }, []);

    // Prefetches an ambient poster-collage preview for every folder that has
    // sources and isn't already cached (or already loading) - runs whenever
    // collections or addons change, but only fires per folder once, since a
    // cache hit is a no-op. addSource/removeSource evict a folder's cache
    // entry below, which is what lets an edited folder's tile refresh here on
    // the next render instead of showing a stale collage.
    useEffect(() => {
        if (addons.length === 0) {
            return;
        }
        const toFetch = collections
            .flatMap((c) => c.folders || [])
            .filter(
                (f) =>
                    (f.catalogSources || []).length > 0 &&
                    !(f.id in previewByFolder) &&
                    !previewLoadingIds.has(f.id)
            );
        if (toFetch.length === 0) {
            return;
        }

        setPreviewLoadingIds((prev) => new Set([...prev, ...toFetch.map((f) => f.id)]));
        toFetch.forEach(async (folder) => {
            const results = await Promise.all(
                (folder.catalogSources || []).map(async (source) => {
                    const addon = addons.find((a) => a.manifest?.id === source.addonId);
                    if (!(addon?.transportUrl && selectedUserId)) {
                        return [];
                    }
                    try {
                        const r = await api.getNuvioCatalogPreview(
                            selectedUserId,
                            addon.transportUrl,
                            source.type,
                            source.catalogId,
                            source.genre
                        );
                        return r.items || [];
                    } catch {
                        return [];
                    }
                })
            );
            const seen = new Set<string>();
            const merged: PreviewFolderItems = [];
            for (const items of results) {
                for (const item of items) {
                    if (seen.has(item.id)) {
                        continue;
                    }
                    seen.add(item.id);
                    merged.push(item);
                }
            }
            setPreviewByFolder((prev) => ({ ...prev, [folder.id]: merged }));
            setPreviewLoadingIds((prev) => {
                const next = new Set(prev);
                next.delete(folder.id);
                return next;
            });
        });
    }, [collections, addons, selectedUserId, previewByFolder, previewLoadingIds]);

    const resetDownstream = () => {
        setProfiles([]);
        setSelectedProfileIndex(null);
        setCollections([]);
        setSavedSnapshot("[]");
        setAddons([]);
        setPreviewByFolder({});
        setPreviewLoadingIds(new Set());
    };

    const handleSelectUser = (userId: string) => {
        if (isDirty && !confirm("Discard unsaved Collections changes?")) {
            return;
        }
        setSelectedUserId(userId);
        resetDownstream();
        if (!userId) {
            return;
        }
        setProfilesLoading(true);
        api.getNuvioProfiles(userId)
            .then((r) => {
                const list = r.profiles || [];
                setProfiles(list);
                if (list.length === 1) {
                    handleSelectProfile(userId, list[0].profile_index);
                }
            })
            .catch((e: any) => toast.error(e.message || "Failed to load Nuvio profiles"))
            .finally(() => setProfilesLoading(false));
        setAddonsLoading(true);
        api.getUserStremioAddons(userId)
            .then((r) => setAddons(Array.isArray(r) ? r : []))
            .catch(() => setAddons([]))
            .finally(() => setAddonsLoading(false));
    };

    const handleSelectProfile = (userId: string, profileIndex: number) => {
        if (isDirty && collections.length > 0 && !confirm("Discard unsaved Collections changes?")) {
            return;
        }
        setSelectedProfileIndex(profileIndex);
        setPreviewByFolder({});
        setPreviewLoadingIds(new Set());
        setCollectionsLoading(true);
        api.getNuvioCollections(userId, profileIndex)
            .then((r) => {
                const list = r.collections || [];
                setCollections(list);
                setSavedSnapshot(JSON.stringify(list));
            })
            .catch((e: any) => toast.error(e.message || "Failed to load Collections"))
            .finally(() => setCollectionsLoading(false));
    };

    const handleSave = async () => {
        if (!selectedUserId || selectedProfileIndex === null) {
            return;
        }
        setSaving(true);
        try {
            // Self-heal focusGifEnabled/focusGifUrl on every save, not just through
            // the cover picker - folders created before either field existed (or
            // before this fix) can carry a real .gif coverImageUrl with neither
            // set, which Nuvio renders as a static first frame instead of
            // animating (focusGifUrl specifically is what its home-row rendering
            // actually checks - see HomeCollectionRowSection.kt's
            // isAnimatedCollectionFolderImage()). Only touches folders that
            // already have a cover set.
            const normalized = collections.map((c) => ({
                ...c,
                folders: (c.folders || []).map((f) =>
                    typeof f.coverImageUrl === "string" && f.coverImageUrl
                        ? {
                              ...f,
                              focusGifEnabled: isGifUrl(f.coverImageUrl),
                              focusGifUrl: isGifUrl(f.coverImageUrl) ? f.coverImageUrl : null,
                          }
                        : f
                ),
            }));
            await api.setNuvioCollections(selectedUserId, selectedProfileIndex, normalized);
            setCollections(normalized);
            setSavedSnapshot(JSON.stringify(normalized));
            toast.success("Collections saved");
        } catch (e) {
            toast.error(readErrorMessage(e, "Failed to save Collections"));
        } finally {
            setSaving(false);
        }
    };

    // --- Mutation helpers - always spread the existing object first so any
    // field this editor doesn't know about (pinToTop, viewMode, ...) survives
    // untouched. ---

    const addCollection = () => {
        setCollections((prev) => [...prev, { folders: [], id: newId(), title: "New Collection" }]);
    };

    // Export/Import as raw JSON - a manual escape hatch alongside the normal
    // Nuvio-sync save path (api.setNuvioCollections -> sync_push_collections).
    // Export downloads exactly the array shape this profile's collections_json
    // holds; Import stages it into the local draft (fresh ids via
    // deepCopyCollection, same as "Copy to another profile") so it goes
    // through the same review + Save button as any other change, rather than
    // writing straight to the backend unreviewed.
    const exportCollectionsJson = () => {
        const profile = profiles.find((p) => p.profile_index === selectedProfileIndex);
        const stamp = new Date().toISOString().slice(0, 10);
        const filename = `nuvio-collections-${(profile?.name || "profile").replace(/[^a-z0-9-]+/gi, "-")}-${stamp}.json`;
        const blob = new Blob([JSON.stringify(collections, null, 2)], { type: "application/json" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = filename;
        a.click();
        URL.revokeObjectURL(url);
    };

    const importFileInputRef = useRef<HTMLInputElement>(null);

    const handleImportFile = async (file: File) => {
        try {
            const text = await file.text();
            const parsed = JSON.parse(text);
            const list: NuvioCollection[] = Array.isArray(parsed)
                ? parsed
                : Array.isArray(parsed?.collections)
                  ? parsed.collections
                  : null;
            if (!list) {
                throw new Error("Expected a JSON array of collections");
            }
            const valid = list.filter(
                (c) =>
                    c &&
                    typeof c === "object" &&
                    typeof c.title === "string" &&
                    Array.isArray(c.folders)
            );
            if (valid.length === 0) {
                throw new Error("No valid collections found in that file");
            }
            setCollections((prev) => [...prev, ...valid.map(deepCopyCollection)]);
            toast.success(
                `Imported ${valid.length} collection${valid.length === 1 ? "" : "s"} - review, then Save changes`
            );
        } catch (e) {
            toast.error(readErrorMessage(e, "That file isn't valid Collections JSON"));
        }
    };

    // Builds folders only for genre slots that actually matched a real
    // genre-filterable catalog in this account's own installed addons - never
    // an empty/fake placeholder folder just because the template listed it.
    const applyGenreTemplate = () => {
        const folders = GENRE_TEMPLATE.genres
            .map((slot) => ({
                catalogSources: matchGenreSources(slot.aliases, addons),
                id: newId(),
                title: slot.title,
                ...newFolderDefaults(),
            }))
            .filter((f) => f.catalogSources.length > 0);
        if (folders.length === 0) {
            toast.error("No genre-filterable catalogs found in your installed addons");
            return;
        }
        setCollections((prev) => [...prev, { folders, id: newId(), title: GENRE_TEMPLATE.title }]);
        setTemplatesOpen(false);
        toast.success(
            `Added "${GENRE_TEMPLATE.title}" (${folders.length} of ${GENRE_TEMPLATE.genres.length} folders matched)`
        );
    };

    const updateCollection = (id: string, patch: Partial<NuvioCollection>) => {
        setCollections((prev) => prev.map((c) => (c.id === id ? { ...c, ...patch } : c)));
    };

    const removeCollection = (id: string) => {
        setCollections((prev) => prev.filter((c) => c.id !== id));
    };

    const reorderCollection = (index: number, dir: -1 | 1) => {
        setCollections((prev) => moveItem(prev, index, dir));
    };

    const addFolder = (collectionId: string) => {
        setCollections((prev) =>
            prev.map((c) =>
                c.id === collectionId
                    ? {
                          ...c,
                          folders: [
                              ...(c.folders || []),
                              {
                                  catalogSources: [],
                                  id: newId(),
                                  title: "New Folder",
                                  ...newFolderDefaults(),
                              },
                          ],
                      }
                    : c
            )
        );
    };

    const updateFolder = (
        collectionId: string,
        folderId: string,
        patch: Partial<NuvioCollectionFolder>
    ) => {
        setCollections((prev) =>
            prev.map((c) =>
                c.id === collectionId
                    ? {
                          ...c,
                          folders: (c.folders || []).map((f) =>
                              f.id === folderId ? { ...f, ...patch } : f
                          ),
                      }
                    : c
            )
        );
    };

    const removeFolder = (collectionId: string, folderId: string) => {
        setCollections((prev) =>
            prev.map((c) =>
                c.id === collectionId
                    ? {
                          ...c,
                          folders: (c.folders || []).filter((f) => f.id !== folderId),
                      }
                    : c
            )
        );
    };

    // List mode only - grid mode reorders folders via drag-and-drop
    // (handleFolderDragEnd) instead.
    const reorderFolder = (collectionId: string, index: number, dir: -1 | 1) => {
        setCollections((prev) =>
            prev.map((c) =>
                c.id === collectionId
                    ? {
                          ...c,
                          folders: moveItem(c.folders || [], index, dir),
                      }
                    : c
            )
        );
    };

    // Evicts a folder's cached preview so the prefetch effect treats it as a
    // cache miss again and re-fetches - otherwise the grid tile's ambient
    // collage (and the folder detail modal's preview row) would keep showing
    // stale items after a source is added or removed.
    const invalidateFolderPreview = (folderId: string) => {
        setPreviewByFolder((prev) => {
            if (!(folderId in prev)) {
                return prev;
            }
            const next = { ...prev };
            delete next[folderId];
            return next;
        });
    };

    const addSource = (collectionId: string, folderId: string, source: NuvioCatalogSource) => {
        setCollections((prev) =>
            prev.map((c) =>
                c.id === collectionId
                    ? {
                          ...c,
                          folders: (c.folders || []).map((f) =>
                              f.id === folderId
                                  ? {
                                        ...f,
                                        catalogSources: [...(f.catalogSources || []), source],
                                    }
                                  : f
                          ),
                      }
                    : c
            )
        );
        invalidateFolderPreview(folderId);
    };

    const removeSource = (collectionId: string, folderId: string, index: number) => {
        setCollections((prev) =>
            prev.map((c) =>
                c.id === collectionId
                    ? {
                          ...c,
                          folders: (c.folders || []).map((f) =>
                              f.id === folderId
                                  ? {
                                        ...f,
                                        catalogSources: (f.catalogSources || []).filter(
                                            (_, i) => i !== index
                                        ),
                                    }
                                  : f
                          ),
                      }
                    : c
            )
        );
        invalidateFolderPreview(folderId);
    };

    // --- Source picker ---

    const openPicker = (collectionId: string, folderId: string) => {
        setPickerTarget({ collectionId, folderId });
        setPickerAddonId(null);
        setPickerCatalog(null);
        setPickerPreview([]);
        // Lazy per open: the catalog list is tiny and the trax flag can change
        // from the user's own page between opens.
        api.getLists()
            .then((ls) => setSlickCatalogs(ls.filter((l) => l.isOwner !== false)))
            .catch(() => setSlickCatalogs([]));
        if (selectedUserId) {
            api.getUser(selectedUserId)
                .then((u) => setTraxEnabled(u.traxAddonEnabled === true))
                .catch(() => setTraxEnabled(null));
        }
    };

    // Adds a linked source for every content type the catalog actually holds
    // (both when it holds neither/unknown - an empty trax row is harmless,
    // a missing one is a gap). Enables + syncs the SlickTrax Addon first when
    // it is off, since the addon IS the delivery mechanism.
    const linkSlickCatalog = async (list: NonNullable<typeof slickCatalogs>[number]) => {
        if (!(pickerTarget && selectedUserId)) {
            return;
        }
        setLinkBusyId(list.id);
        try {
            // The toggle being on is NOT enough - the addon only reaches the
            // account when a sync runs (confirmed live: toggle Enabled, addon
            // absent, every linked source "not found"). What matters is presence
            // in the LIVE account list; missing means enable if needed, sync, and
            // re-read the addons so the new sources resolve immediately.
            const traxId = `vip.slicksync.trax.${selectedUserId}`;
            const traxInstalled = addons.some((a) => a.manifest?.id === traxId);
            if (!traxInstalled) {
                if (traxEnabled === false) {
                    await api.setTraxAddon(selectedUserId, true);
                }
                toast.success("Installing the SlickTrax Addon on the account (one sync)...");
                await api.syncUser(selectedUserId);
                setTraxEnabled(true);
                try {
                    const fresh = await api.getUserStremioAddons(selectedUserId);
                    setAddons(Array.isArray(fresh) ? fresh : []);
                } catch {
                    /* sources may show as pending until next page load */
                }
            }
            const types = [
                ...new Set(
                    (list.items || [])
                        .map((i) => i.type)
                        .filter((t) => t === "movie" || t === "series")
                ),
            ];
            const useTypes = types.length > 0 ? types : ["movie", "series"];
            for (const type of useTypes) {
                addSource(pickerTarget.collectionId, pickerTarget.folderId, {
                    addonId: `vip.slicksync.trax.${selectedUserId}`,
                    catalogId: `slicktrax-list-${list.id}`,
                    type,
                });
            }
            setPickerTarget(null);
            toast.success(
                `Linked "${list.name}" - press Save changes to push it. From then on the folder follows the catalog automatically`
            );
        } catch (e) {
            toast.error(e instanceof Error ? e.message : "Could not link that catalog");
        } finally {
            setLinkBusyId(null);
        }
    };

    const pickerAddon = addons.find((a) => a.manifest?.id === pickerAddonId) || null;

    const handlePickCatalog = useCallback(
        (catalog: { id: string; type: string; name?: string }) => {
            setPickerCatalog(catalog);
            if (!(selectedUserId && pickerAddon?.transportUrl)) {
                return;
            }
            setPickerPreviewLoading(true);
            api.getNuvioCatalogPreview(
                selectedUserId,
                pickerAddon.transportUrl,
                catalog.type,
                catalog.id
            )
                .then((r) => setPickerPreview(r.items || []))
                .catch(() => setPickerPreview([]))
                .finally(() => setPickerPreviewLoading(false));
        },
        [selectedUserId, pickerAddon]
    );

    const confirmAddSource = () => {
        if (!(pickerTarget && pickerAddon && pickerCatalog)) {
            return;
        }
        addSource(pickerTarget.collectionId, pickerTarget.folderId, {
            addonId: pickerAddon.manifest?.id || pickerAddon.transportUrl,
            catalogId: pickerCatalog.id,
            type: pickerCatalog.type,
        });
        setPickerTarget(null);
    };

    // Folder tiles drag-reorder within their own collection's grid - purely
    // local state like every other edit here, persisted only on Save changes.
    const handleFolderDragEnd = (collectionId: string) => (event: DragEndEvent) => {
        const { active, over } = event;
        if (!over || active.id === over.id) {
            return;
        }
        setCollections((prev) =>
            prev.map((c) => {
                if (c.id !== collectionId) {
                    return c;
                }
                const folders = c.folders || [];
                const oldIndex = folders.findIndex((f) => f.id === active.id);
                const newIndex = folders.findIndex((f) => f.id === over.id);
                if (oldIndex === -1 || newIndex === -1) {
                    return c;
                }
                return { ...c, folders: arrayMove(folders, oldIndex, newIndex) };
            })
        );
    };

    // Which folders have at least one source that no longer resolves - a
    // Set (not a per-folder callback prop) so CollectionSection/FolderTile
    // stay plain data-in components, computed once per addons/collections
    // change instead of re-walking every folder's sources on every render.
    const brokenFolderIds = useMemo(() => {
        const ids = new Set<string>();
        for (const c of collections) {
            for (const f of c.folders || []) {
                if (folderHasBrokenSource(f)) {
                    ids.add(f.id);
                }
            }
        }
        return ids;
    }, [collections, folderHasBrokenSource]);

    // --- Copy a Collection to another profile ---

    const otherProfiles = profiles.filter((p) => p.profile_index !== selectedProfileIndex);

    const handleCopyTo = useCallback(
        async (targetProfileIndex: number) => {
            if (!(copyTarget && selectedUserId)) {
                return;
            }
            setCopyingToIndex(targetProfileIndex);
            try {
                const r = await api.getNuvioCollections(selectedUserId, targetProfileIndex);
                const targetCollections = r.collections || [];
                const updated = [...targetCollections, deepCopyCollection(copyTarget)];
                await api.setNuvioCollections(selectedUserId, targetProfileIndex, updated);
                const targetName =
                    profiles.find((p) => p.profile_index === targetProfileIndex)?.name ||
                    `Profile ${targetProfileIndex}`;
                toast.success(`Copied "${copyTarget.title}" to ${targetName}`);
                setCopyTarget(null);
            } catch (e) {
                toast.error(readErrorMessage(e, "Failed to copy Collection"));
            } finally {
                setCopyingToIndex(null);
            }
        },
        [copyTarget, selectedUserId, profiles]
    );

    // --- Collections Guard banner ---
    // Alarms come from the hourly guard pass (server-side): a profile whose
    // collections mass-vanished since the last good snapshot. Restore pushes
    // that snapshot back; Accept adopts the new state as the baseline.
    interface GuardAlarm {
        currentCount: number;
        detectedAt: string;
        kind: "collections" | "layout";
        lastGoodAt: string | null;
        lastGoodCount: number | null;
        preview: string[];
        previewTotal: number;
        profileId: number;
        profileName?: string | null;
        userId: string;
        username: string | null;
    }
    const [guardAlarms, setGuardAlarms] = useState<GuardAlarm[]>([]);
    const [guardBusy, setGuardBusy] = useState<string | null>(null);
    const loadGuardAlarms = useCallback(() => {
        api.getCollectionsGuardAlarms()
            .then((r) => setGuardAlarms(r.alarms || []))
            .catch(() => undefined);
    }, []);
    useEffect(() => {
        loadGuardAlarms();
    }, [loadGuardAlarms]);

    const handleGuardRestore = async (alarm: GuardAlarm) => {
        setGuardBusy(`${alarm.kind}:${alarm.userId}:${alarm.profileId}`);
        try {
            const r = await api.restoreCollectionsSnapshot(
                alarm.userId,
                alarm.profileId,
                alarm.kind
            );
            const n = alarm.kind === "layout" ? (r.restoredItems ?? 0) : (r.restoredCount ?? 0);
            toast.success(
                alarm.kind === "layout"
                    ? `Restored the home-row layout (${n} row${n === 1 ? "" : "s"}) from the last good snapshot`
                    : `Restored ${n} collection${n === 1 ? "" : "s"} from the last good snapshot`
            );
            loadGuardAlarms();
            // If the restored profile is on screen, reload it so the grid shows
            // the recovered collections rather than the overwritten state.
            if (alarm.userId === selectedUserId && alarm.profileId === selectedProfileIndex) {
                window.location.reload();
            }
        } catch (e) {
            toast.error(readErrorMessage(e, "Restore failed"));
        } finally {
            setGuardBusy(null);
        }
    };

    const handleGuardAccept = async (alarm: GuardAlarm) => {
        setGuardBusy(`${alarm.kind}:${alarm.userId}:${alarm.profileId}`);
        try {
            await api.acceptCollectionsState(alarm.userId, alarm.profileId, alarm.kind);
            toast.success("Current state accepted as the new baseline");
            loadGuardAlarms();
        } catch (e) {
            toast.error(readErrorMessage(e, "Accept failed"));
        } finally {
            setGuardBusy(null);
        }
    };

    const guardBanner =
        guardAlarms.length > 0 ? (
            <div
                className="mb-4 rounded-xl border p-4"
                style={{
                    background: "var(--color-error-muted, rgba(239,68,68,0.08))",
                    borderColor: "var(--color-error)",
                }}
            >
                <p className="mb-1 font-semibold text-default text-sm">
                    Something on the account may have been overwritten
                </p>
                <p className="mb-3 text-muted text-xs">
                    Another logged-in Nuvio app pushing a stale state erases collections and
                    home-row layouts exactly like this. Restore puts back the last good snapshot;
                    Accept keeps what&apos;s on the account now.{" "}
                    <span className="text-subtle">
                        Nuvio&apos;s backend does not record which app made a change, so SlickSync
                        can tell you what changed and when, but never from which device - if you
                        were rearranging things in the Nuvio app just before the time below, it was
                        probably you.
                    </span>
                </p>
                <div className="space-y-2">
                    {guardAlarms.map((a) => {
                        const key = `${a.kind}:${a.userId}:${a.profileId}`;
                        const noun = a.kind === "layout" ? "home rows" : "collections";
                        return (
                            <div
                                className="flex flex-wrap items-center justify-between gap-2"
                                key={key}
                            >
                                <div className="min-w-0 text-default text-xs">
                                    <p>
                                        {/* The profile's own name, the way the picker below shows
                      it - the bare index says nothing about which profile
                      lost collections. Falls back to the index when the
                      account could not be reached for its profile list. */}
                                        <span className="font-medium">
                                            {a.username || a.userId}
                                        </span>{" "}
                                        · {a.profileName || `profile ${a.profileId}`}:{" "}
                                        {a.lastGoodCount ?? "?"} {noun} → {a.currentCount}
                                        <span className="text-muted">
                                            {" "}
                                            · noticed {new Date(a.detectedAt).toLocaleString()}
                                        </span>
                                    </p>
                                    {a.preview.length > 0 && (
                                        <p className="mt-0.5 truncate text-muted">
                                            Restore brings back: {a.preview.join(", ")}
                                            {a.previewTotal > a.preview.length
                                                ? ` and ${a.previewTotal - a.preview.length} more`
                                                : ""}
                                            {a.lastGoodAt
                                                ? ` (as of ${new Date(a.lastGoodAt).toLocaleString()})`
                                                : ""}
                                        </p>
                                    )}
                                </div>
                                <div className="flex items-center gap-2">
                                    <Button
                                        isLoading={guardBusy === key}
                                        onClick={() => handleGuardRestore(a)}
                                        size="sm"
                                        variant="primary"
                                    >
                                        Restore
                                    </Button>
                                    <Button
                                        disabled={guardBusy === key}
                                        onClick={() => handleGuardAccept(a)}
                                        size="sm"
                                        variant="ghost"
                                    >
                                        Accept new state
                                    </Button>
                                </div>
                            </div>
                        );
                    })}
                </div>
            </div>
        ) : null;

    // --- Home-row layout clone ---
    // Copies the selected profile's whole home-screen ARRANGEMENT (row order,
    // renames, hidden rows - the synced home-catalog settings, not the
    // collections) onto another profile, instead of re-dragging every row by
    // hand. Two-step arm on the target since it overwrites that profile's
    // arrangement outright.
    const [homeRowsEditorOpen, setHomeRowsEditorOpen] = useState(false);
    const [homeRowsMenuOpen, setHomeRowsMenuOpen] = useState(false);
    const [transferMenuOpen, setTransferMenuOpen] = useState(false);
    const toolbarMenusRef = useRef<HTMLDivElement | null>(null);
    // Close on an outside click only. The first version listened for ANY
    // document click, which closed the menu on its own items too - so arming
    // a copy target ("Overwrite X's rows?") shut the menu before that label
    // could ever be seen, and the feature looked like it did nothing.
    useEffect(() => {
        if (!(homeRowsMenuOpen || transferMenuOpen)) {
            return;
        }
        const onDown = (e: MouseEvent) => {
            const target = e.target as Node | null;
            if (target && toolbarMenusRef.current?.contains(target)) {
                return;
            }
            setHomeRowsMenuOpen(false);
            setTransferMenuOpen(false);
            setHomeRowsArmed(null);
        };
        const id = setTimeout(() => document.addEventListener("mousedown", onDown), 0);
        return () => {
            clearTimeout(id);
            document.removeEventListener("mousedown", onDown);
        };
    }, [homeRowsMenuOpen, transferMenuOpen]);
    const [homeRowsArmed, setHomeRowsArmed] = useState<number | null>(null);
    const [homeRowsBusy, setHomeRowsBusy] = useState(false);
    const copyHomeRows = async (targetProfileIndex: number) => {
        if (selectedProfileIndex === null) {
            return;
        }
        if (homeRowsArmed !== targetProfileIndex) {
            setHomeRowsArmed(targetProfileIndex);
            setTimeout(
                () => setHomeRowsArmed((cur) => (cur === targetProfileIndex ? null : cur)),
                5000
            );
            return;
        }
        setHomeRowsArmed(null);
        setHomeRowsBusy(true);
        try {
            const r = await api.copyHomeLayout(
                selectedUserId,
                selectedProfileIndex,
                targetProfileIndex
            );
            const targetName =
                profiles.find((p) => p.profile_index === targetProfileIndex)?.name ||
                `Profile ${targetProfileIndex}`;
            toast.success(
                `Home-row layout copied to ${targetName} (${r.copiedItems} row${r.copiedItems === 1 ? "" : "s"})`
            );
            setHomeRowsMenuOpen(false);
        } catch (e) {
            toast.error(readErrorMessage(e, "Failed to copy the home-row layout"));
        } finally {
            setHomeRowsBusy(false);
        }
    };

    // --- Layout ---

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

    const saveAction = (
        <Button
            disabled={!isDirty || selectedProfileIndex === null}
            isLoading={saving}
            onClick={handleSave}
            size="sm"
            variant="primary"
        >
            Save changes
        </Button>
    );

    const detailActions = (
        <div className="flex items-center gap-2">
            {backButton}
            {selectedProfileIndex !== null && saveAction}
        </div>
    );

    return (
        <>
            {layoutMode !== "nebula" && (
                <Header
                    actions={detailActions}
                    subtitle="Organize a Nuvio account's own home-screen collections"
                    title={
                        <Breadcrumbs
                            className="font-semibold text-xl"
                            items={[
                                { href: "/catalogs", label: "Catalogs" },
                                { label: "Nuvio Collections" },
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
                            actions={selectedProfileIndex === null ? undefined : saveAction}
                            leading={backButton}
                            subtitle="Organize a Nuvio account's own home-screen collections"
                            title="Nuvio Collections"
                        />
                    )}

                    {guardBanner}

                    <PageSection>
                        {/* Grid of Nuvio-connected users, same card-grid pattern as
              Users/Groups, instead of a dropdown - picking an account you
              manage shouldn't feel different here than anywhere else in
              the app. Once one's picked, collapses to a compact summary
              strip (avatar + name + Switch account) so the page doesn't
              keep spending a full grid's worth of vertical space once
              you're actually working on that account's collections. */}
                        {selectedUserId ? (
                            <Card className="mb-6" padding="lg">
                                <div className="flex flex-wrap items-end gap-3">
                                    <button
                                        className="flex items-center gap-3 rounded-xl pr-3 text-left transition-colors hover:bg-surface-hover"
                                        onClick={() => handleSelectUser("")}
                                        title="Switch account"
                                        type="button"
                                    >
                                        <Avatar
                                            colorIndex={selectedUser?.colorIndex}
                                            email={selectedUser?.email}
                                            name={
                                                selectedUser?.name ||
                                                selectedUser?.email ||
                                                selectedUserId
                                            }
                                            size="md"
                                            src={selectedUser?.avatarUrl || undefined}
                                            useGravatar={selectedUser?.useGravatar}
                                        />
                                        <div className="min-w-0">
                                            <p className="truncate font-medium text-default text-sm">
                                                {selectedUser?.name ||
                                                    selectedUser?.email ||
                                                    selectedUserId}
                                            </p>
                                            <p className="text-primary text-xs">Switch account</p>
                                        </div>
                                    </button>

                                    {(profiles.length > 1 || profilesLoading) && (
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
                                            {profilesLoading ? (
                                                <div className="flex gap-2">
                                                    {Array.from({ length: 3 }).map((_, i) => (
                                                        <div
                                                            className="h-9 w-24 animate-pulse rounded-lg bg-surface-hover"
                                                            key={i}
                                                        />
                                                    ))}
                                                </div>
                                            ) : (
                                                <div className="flex flex-wrap gap-2">
                                                    {profiles.map((p) => (
                                                        <button
                                                            className={`flex items-center gap-2 rounded-lg border py-1.5 pr-3 pl-1.5 text-sm transition-colors ${
                                                                selectedProfileIndex ===
                                                                p.profile_index
                                                                    ? "border-primary bg-primary/10 text-default"
                                                                    : "border-default bg-subtle text-subtle hover:bg-surface-hover hover:text-default"
                                                            }`}
                                                            key={p.profile_index}
                                                            onClick={() =>
                                                                handleSelectProfile(
                                                                    selectedUserId,
                                                                    p.profile_index
                                                                )
                                                            }
                                                            type="button"
                                                        >
                                                            <span
                                                                className="h-5 w-5 shrink-0 rounded-full"
                                                                style={{
                                                                    backgroundColor:
                                                                        p.avatar_color_hex ||
                                                                        "var(--color-surface-hover)",
                                                                }}
                                                            />
                                                            <span
                                                                className="truncate"
                                                                style={{ maxWidth: "120px" }}
                                                            >
                                                                {p.name ||
                                                                    `Profile ${p.profile_index}`}
                                                            </span>
                                                        </button>
                                                    ))}
                                                </div>
                                            )}
                                        </fieldset>
                                    )}

                                    {selectedUser && (
                                        <Badge className="mb-2.5" size="sm" variant="nuvio">
                                            Nuvio
                                        </Badge>
                                    )}
                                </div>
                            </Card>
                        ) : (
                            <Card className="mb-6" padding="lg">
                                <h3 className="mb-3 block font-medium text-muted text-xs">
                                    Nuvio account
                                </h3>
                                {usersLoading ? (
                                    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
                                        {Array.from({ length: 4 }).map((_, i) => (
                                            <div
                                                className="h-20 animate-pulse rounded-xl bg-surface-hover"
                                                key={i}
                                            />
                                        ))}
                                    </div>
                                ) : nuvioUsers.length === 0 ? (
                                    <p className="text-subtle text-xs">
                                        No Nuvio-connected users yet.
                                    </p>
                                ) : (
                                    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
                                        {nuvioUsers.map((u) => (
                                            <button
                                                className="flex items-center gap-3 rounded-xl border border-default bg-subtle p-3 text-left transition-colors hover:border-primary/50 hover:bg-surface-hover"
                                                key={u.id}
                                                onClick={() => handleSelectUser(u.id)}
                                                type="button"
                                            >
                                                <Avatar
                                                    colorIndex={u.colorIndex}
                                                    email={u.email}
                                                    name={u.name || u.email || u.id}
                                                    size="md"
                                                    src={u.avatarUrl || undefined}
                                                    useGravatar={u.useGravatar}
                                                />
                                                <div className="min-w-0">
                                                    <p className="truncate font-medium text-default text-sm">
                                                        {u.name || u.email || u.id}
                                                    </p>
                                                    {u.email && u.name && (
                                                        <p className="truncate text-subtle text-xs">
                                                            {u.email}
                                                        </p>
                                                    )}
                                                    <Badge
                                                        className="mt-1"
                                                        size="sm"
                                                        variant="nuvio"
                                                    >
                                                        Nuvio
                                                    </Badge>
                                                </div>
                                            </button>
                                        ))}
                                    </div>
                                )}
                            </Card>
                        )}

                        {/* Home-row editing is a VIEW on this page, not a dialog - the
              same account -> profile -> content progression the collections
              flow already uses, so it inherits the page's header, profile
              strip and back behaviour instead of stacking a modal over
              them (user's call). */}
                        {selectedProfileIndex !== null && homeRowsEditorOpen && selectedUserId && (
                            <HomeRowsEditor
                                onDone={() => setHomeRowsEditorOpen(false)}
                                profileId={selectedProfileIndex}
                                profileName={
                                    profiles.find((p) => p.profile_index === selectedProfileIndex)
                                        ?.name || `Profile ${selectedProfileIndex}`
                                }
                                userId={selectedUserId}
                            />
                        )}

                        {selectedProfileIndex !== null &&
                            !homeRowsEditorOpen &&
                            (collectionsLoading ? (
                                <div className="space-y-3">
                                    {[...new Array(3)].map((_, i) => (
                                        <div
                                            className="h-16 animate-pulse rounded-xl bg-surface-hover"
                                            key={i}
                                        />
                                    ))}
                                </div>
                            ) : (
                                <>
                                    <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                                        <div className="flex items-center gap-1.5">
                                            <p className="text-muted text-sm">
                                                {collections.length} collection
                                                {collections.length === 1 ? "" : "s"}
                                                {isDirty && (
                                                    <span className="ml-2 text-warning">
                                                        (unsaved changes)
                                                    </span>
                                                )}
                                            </p>
                                            {/* Both "?" buttons on this page (this one and Export &
                        Import's below) went unnoticed for a long time per
                        real feedback - a soft primary-color glow, same
                        visual language the logo badge already uses
                        elsewhere, makes them read as "worth a tap" instead
                        of blending into the muted icon row around them. */}
                                            <button
                                                className="rounded-lg p-1.5 text-primary transition-colors hover:bg-surface-hover hover:text-default"
                                                onClick={() => setTipsInfoOpen(true)}
                                                style={{
                                                    boxShadow:
                                                        "0 0 0 1px color-mix(in srgb, var(--color-primary) 45%, transparent), 0 0 10px -1px var(--color-primary)",
                                                }}
                                                title="Tips"
                                                type="button"
                                            >
                                                <QuestionMarkCircleIcon className="h-4 w-4" />
                                            </button>
                                        </div>
                                        <div className="flex items-center gap-2">
                                            <input
                                                accept="application/json"
                                                className="hidden"
                                                onChange={(e) => {
                                                    const file = e.target.files?.[0];
                                                    if (file) {
                                                        handleImportFile(file);
                                                    }
                                                    e.target.value = "";
                                                }}
                                                ref={importFileInputRef}
                                                type="file"
                                            />
                                            <div
                                                className="flex items-center gap-2"
                                                ref={toolbarMenusRef}
                                            >
                                                {/* Nine separate controls had accumulated here (user
                        feedback). The related ones now live behind two
                        menus - everything that moves a layout in or out of
                        this profile under "Transfer", everything about the
                        home-screen rows under "Home rows" - leaving the two
                        genuinely primary actions visible. */}
                                                <div className="relative">
                                                    <Button
                                                        leftIcon={
                                                            <ArrowUpTrayIcon className="h-4 w-4" />
                                                        }
                                                        onClick={() => {
                                                            setTransferMenuOpen((v) => !v);
                                                            setHomeRowsMenuOpen(false);
                                                        }}
                                                        size="sm"
                                                        variant="ghost"
                                                    >
                                                        Transfer
                                                    </Button>
                                                    {transferMenuOpen && (
                                                        <div
                                                            className="absolute top-full right-0 z-20 mt-2 min-w-[240px] rounded-2xl p-1.5"
                                                            style={{
                                                                background:
                                                                    "linear-gradient(180deg, rgba(12,8,4,0.98), rgba(24,14,4,0.98))",
                                                                border: "1.5px solid rgba(255,152,0,0.55)",
                                                                boxShadow:
                                                                    "0 12px 32px -8px rgba(0,0,0,0.8), 0 0 20px -6px rgba(255,152,0,0.45)",
                                                            }}
                                                        >
                                                            <p
                                                                className="px-3 pt-1.5 pb-1 font-semibold text-[10px] uppercase tracking-wider"
                                                                style={{
                                                                    color: "rgba(255,152,0,0.75)",
                                                                }}
                                                            >
                                                                As a file
                                                            </p>
                                                            <button
                                                                className="w-full rounded-xl px-3 py-2 text-left text-xs transition-colors hover:bg-white/10"
                                                                onClick={() => {
                                                                    setTransferMenuOpen(false);
                                                                    importFileInputRef.current?.click();
                                                                }}
                                                                style={{
                                                                    color: "rgb(226,232,240)",
                                                                }}
                                                                type="button"
                                                            >
                                                                Import from JSON…
                                                            </button>
                                                            <button
                                                                className="w-full rounded-xl px-3 py-2 text-left text-xs transition-colors hover:bg-white/10 disabled:opacity-40"
                                                                disabled={collections.length === 0}
                                                                onClick={() => {
                                                                    setTransferMenuOpen(false);
                                                                    exportCollectionsJson();
                                                                }}
                                                                style={{
                                                                    color: "rgb(226,232,240)",
                                                                }}
                                                                type="button"
                                                            >
                                                                Export as JSON
                                                            </button>
                                                            <p
                                                                className="mt-1 px-3 pt-2 pb-1 font-semibold text-[10px] uppercase tracking-wider"
                                                                style={{
                                                                    color: "rgba(255,152,0,0.75)",
                                                                }}
                                                            >
                                                                As a share code
                                                            </p>
                                                            <button
                                                                className="w-full rounded-xl px-3 py-2 text-left text-xs transition-colors hover:bg-white/10"
                                                                onClick={() => {
                                                                    setTransferMenuOpen(false);
                                                                    setShowPasteCode(true);
                                                                }}
                                                                style={{
                                                                    color: "rgb(226,232,240)",
                                                                }}
                                                                type="button"
                                                            >
                                                                Paste a code…
                                                            </button>
                                                            <button
                                                                className="w-full rounded-xl px-3 py-2 text-left text-xs transition-colors hover:bg-white/10 disabled:opacity-40"
                                                                disabled={collections.length === 0}
                                                                onClick={() => {
                                                                    setTransferMenuOpen(false);
                                                                    openShareCode();
                                                                }}
                                                                style={{
                                                                    color: "rgb(226,232,240)",
                                                                }}
                                                                type="button"
                                                            >
                                                                Create a code…
                                                            </button>
                                                            <button
                                                                className="mt-1 w-full rounded-xl px-3 py-2 text-left text-xs transition-colors hover:bg-white/10"
                                                                onClick={() => {
                                                                    setTransferMenuOpen(false);
                                                                    setImportExportInfoOpen(true);
                                                                }}
                                                                style={{
                                                                    color: "rgb(147,197,253)",
                                                                }}
                                                                type="button"
                                                            >
                                                                Where do I use these?
                                                            </button>
                                                        </div>
                                                    )}
                                                </div>
                                                <div className="relative">
                                                    {/* Given the same lockup treatment as the Nuvio
                          Collections pill on the Catalogs page (icon chip +
                          wordmark, Nuvio's own two-tone identity rather than
                          the generic palette): this edits a connected Nuvio
                          account's real home screen, and as a plain ghost
                          button it read as an afterthought - same feedback
                          that pill was built from. */}
                                                    <button
                                                        className="flex items-center gap-2 rounded-full py-1.5 pr-4 pl-1.5 transition-transform hover:scale-105"
                                                        onClick={() => {
                                                            setHomeRowsMenuOpen((v) => !v);
                                                            setTransferMenuOpen(false);
                                                            setHomeRowsArmed(null);
                                                        }}
                                                        style={{
                                                            background:
                                                                "linear-gradient(180deg, rgba(12,8,4,0.92), rgba(24,14,4,0.92))",
                                                            border: "1.5px solid rgba(255,152,0,0.55)",
                                                            boxShadow:
                                                                "0 0 20px -4px rgba(255,152,0,0.45)",
                                                        }}
                                                        title="Reorder, rename or hide this profile's Nuvio home-screen rows"
                                                        type="button"
                                                    >
                                                        <span
                                                            className="flex shrink-0 items-center justify-center rounded-full"
                                                            style={{
                                                                background:
                                                                    "linear-gradient(135deg, #2E9FE0 0%, #6C5CE7 55%, #C24FE0 100%)",
                                                                height: 28,
                                                                width: 28,
                                                            }}
                                                        >
                                                            <Bars3BottomLeftIcon className="h-4 w-4 text-white" />
                                                        </span>
                                                        <span
                                                            className="font-bold font-display text-sm tracking-tight"
                                                            style={{ color: "rgb(147, 197, 253)" }}
                                                        >
                                                            Home rows
                                                        </span>
                                                    </button>
                                                    {homeRowsMenuOpen && (
                                                        <div
                                                            className="absolute top-full right-0 z-20 mt-2 min-w-[240px] rounded-2xl p-1.5"
                                                            style={{
                                                                background:
                                                                    "linear-gradient(180deg, rgba(12,8,4,0.98), rgba(24,14,4,0.98))",
                                                                border: "1.5px solid rgba(255,152,0,0.55)",
                                                                boxShadow:
                                                                    "0 12px 32px -8px rgba(0,0,0,0.8), 0 0 20px -6px rgba(255,152,0,0.45)",
                                                            }}
                                                        >
                                                            <button
                                                                className="w-full rounded-xl px-3 py-2 text-left text-xs transition-colors hover:bg-white/10"
                                                                onClick={() => {
                                                                    setHomeRowsMenuOpen(false);
                                                                    setHomeRowsEditorOpen(true);
                                                                }}
                                                                style={{
                                                                    color: "rgb(226,232,240)",
                                                                }}
                                                                type="button"
                                                            >
                                                                Edit this profile&apos;s rows…
                                                            </button>
                                                            {otherProfiles.length > 0 && (
                                                                <>
                                                                    <p
                                                                        className="mt-1 px-3 pt-2 pb-1 font-semibold text-[10px] uppercase tracking-wider"
                                                                        style={{
                                                                            color: "rgba(255,152,0,0.75)",
                                                                        }}
                                                                    >
                                                                        Copy rows onto…
                                                                    </p>
                                                                    {otherProfiles.map((p) => (
                                                                        <button
                                                                            className={`w-full rounded-xl px-3 py-2 text-left text-xs transition-colors hover:bg-white/10 ${homeRowsArmed === p.profile_index ? "armed-on" : "armed-off"}`}
                                                                            disabled={homeRowsBusy}
                                                                            key={p.profile_index}
                                                                            onClick={() =>
                                                                                copyHomeRows(
                                                                                    p.profile_index
                                                                                )
                                                                            }
                                                                            type="button"
                                                                        >
                                                                            {homeRowsBusy &&
                                                                            homeRowsArmed === null
                                                                                ? "Copying..."
                                                                                : homeRowsArmed ===
                                                                                    p.profile_index
                                                                                  ? `Click again to overwrite ${p.name || `Profile ${p.profile_index}`}`
                                                                                  : p.name ||
                                                                                    `Profile ${p.profile_index}`}
                                                                        </button>
                                                                    ))}
                                                                </>
                                                            )}
                                                        </div>
                                                    )}
                                                </div>
                                            </div>
                                            <Button
                                                leftIcon={<SparklesIcon className="h-4 w-4" />}
                                                onClick={() => setTemplatesOpen(true)}
                                                size="sm"
                                                variant="ghost"
                                            >
                                                Use a template
                                            </Button>
                                            <Button
                                                leftIcon={<PlusIcon className="h-4 w-4" />}
                                                onClick={addCollection}
                                                size="sm"
                                                variant="secondary"
                                            >
                                                Add collection
                                            </Button>
                                        </div>
                                    </div>

                                    {collections.length === 0 ? (
                                        <Card className="text-center" padding="lg">
                                            <RectangleStackIcon className="mx-auto mb-3 h-10 w-10 text-subtle" />
                                            <p className="text-muted text-sm">
                                                No collections yet on this profile.
                                            </p>
                                        </Card>
                                    ) : viewMode === "grid" ? (
                                        collections.map((collection, cIndex) => (
                                            <CollectionSection
                                                brokenFolderIds={brokenFolderIds}
                                                cIndex={cIndex}
                                                collection={collection}
                                                collectionsLength={collections.length}
                                                key={collection.id}
                                                onAddFolder={() => addFolder(collection.id)}
                                                onCopy={() => setCopyTarget(collection)}
                                                onDelete={() =>
                                                    setDeleting({
                                                        collectionId: collection.id,
                                                        kind: "collection",
                                                    })
                                                }
                                                onDeleteFolder={(folderId) =>
                                                    setDeleting({
                                                        collectionId: collection.id,
                                                        folderId,
                                                        kind: "folder",
                                                    })
                                                }
                                                onFolderDragEnd={handleFolderDragEnd(collection.id)}
                                                onOpenFolder={(folderId) => {
                                                    setFolderDetail({
                                                        collectionId: collection.id,
                                                        folderId,
                                                    });
                                                    setFolderDetailTab("sources");
                                                }}
                                                onRename={(title) =>
                                                    updateCollection(collection.id, { title })
                                                }
                                                onReorder={(dir) => reorderCollection(cIndex, dir)}
                                                onTogglePin={() =>
                                                    updateCollection(collection.id, {
                                                        pinToTop: !collection.pinToTop,
                                                    })
                                                }
                                                otherProfilesCount={otherProfiles.length}
                                                previewByFolder={previewByFolder}
                                                previewLoadingIds={previewLoadingIds}
                                            />
                                        ))
                                    ) : (
                                        // Original list layout, unchanged - kept for anyone who
                                        // preferred it, per explicit request. Folder/source
                                        // reorder uses the up/down arrows (reorderFolder) here
                                        // instead of grid mode's drag-and-drop, and the
                                        // collection-level "Preview layout" eye button reads from
                                        // the same ambient previewByFolder cache grid mode's
                                        // tiles use rather than doing its own fetch.
                                        <div className="space-y-3">
                                            {collections.map((collection, cIndex) => (
                                                <Card key={collection.id} padding="md">
                                                    <div className="flex items-center gap-2">
                                                        <button
                                                            className="p-1 text-subtle hover:text-default"
                                                            onClick={() =>
                                                                toggleExpanded(collection.id)
                                                            }
                                                            type="button"
                                                        >
                                                            {expanded[collection.id] ? (
                                                                <ChevronDownIcon className="h-4 w-4" />
                                                            ) : (
                                                                <ChevronRightIcon className="h-4 w-4" />
                                                            )}
                                                        </button>
                                                        <input
                                                            className="flex-1 rounded-lg border border-transparent bg-transparent px-2 py-1 font-semibold text-default text-sm hover:border-default focus:border-primary focus:outline-none"
                                                            onChange={(e) =>
                                                                updateCollection(collection.id, {
                                                                    title: e.target.value,
                                                                })
                                                            }
                                                            value={collection.title}
                                                        />
                                                        <span className="shrink-0 text-subtle text-xs">
                                                            {(collection.folders || []).length}{" "}
                                                            folder
                                                            {(collection.folders || []).length === 1
                                                                ? ""
                                                                : "s"}
                                                        </span>
                                                        <button
                                                            className="p-1 text-subtle hover:text-default disabled:opacity-30"
                                                            disabled={(
                                                                collection.folders || []
                                                            ).every(
                                                                (f) =>
                                                                    (f.catalogSources || [])
                                                                        .length === 0
                                                            )}
                                                            onClick={() =>
                                                                setPreviewCollection(collection)
                                                            }
                                                            title="Preview layout"
                                                            type="button"
                                                        >
                                                            <EyeIcon className="h-3.5 w-3.5" />
                                                        </button>
                                                        <CollectionActionsMenu
                                                            canCopy={otherProfiles.length > 0}
                                                            canMoveDown={
                                                                cIndex < collections.length - 1
                                                            }
                                                            canMoveUp={cIndex > 0}
                                                            isPinned={!!collection.pinToTop}
                                                            onCopy={() => setCopyTarget(collection)}
                                                            onDelete={() =>
                                                                setDeleting({
                                                                    collectionId: collection.id,
                                                                    kind: "collection",
                                                                })
                                                            }
                                                            onMoveDown={() =>
                                                                reorderCollection(cIndex, 1)
                                                            }
                                                            onMoveUp={() =>
                                                                reorderCollection(cIndex, -1)
                                                            }
                                                            onTogglePin={() =>
                                                                updateCollection(collection.id, {
                                                                    pinToTop: !collection.pinToTop,
                                                                })
                                                            }
                                                        />
                                                    </div>

                                                    {expanded[collection.id] && (
                                                        <div className="mt-3 space-y-2 border-default border-l pl-6">
                                                            {(collection.folders || []).map(
                                                                (folder, fIndex) => (
                                                                    <div
                                                                        className="rounded-lg border border-default bg-subtle p-2.5"
                                                                        key={folder.id}
                                                                    >
                                                                        <div className="flex items-center gap-2">
                                                                            <button
                                                                                className="p-1 text-subtle hover:text-default"
                                                                                onClick={() =>
                                                                                    toggleExpanded(
                                                                                        folder.id
                                                                                    )
                                                                                }
                                                                                type="button"
                                                                            >
                                                                                {expanded[
                                                                                    folder.id
                                                                                ] ? (
                                                                                    <ChevronDownIcon className="h-3.5 w-3.5" />
                                                                                ) : (
                                                                                    <ChevronRightIcon className="h-3.5 w-3.5" />
                                                                                )}
                                                                            </button>
                                                                            {brokenFolderIds.has(
                                                                                folder.id
                                                                            ) ? (
                                                                                <span
                                                                                    className="shrink-0"
                                                                                    title="A source in this folder no longer resolves"
                                                                                >
                                                                                    <ExclamationTriangleIcon className="h-4 w-4 text-warning" />
                                                                                </span>
                                                                            ) : (
                                                                                  folder.catalogSources ||
                                                                                  []
                                                                              ).length === 0 ? (
                                                                                <span
                                                                                    className="shrink-0"
                                                                                    title="This folder has no sources yet - it won't show up in Nuvio until you add at least one"
                                                                                >
                                                                                    <ExclamationTriangleIcon className="h-4 w-4 text-warning" />
                                                                                </span>
                                                                            ) : (
                                                                                <FolderIcon className="h-4 w-4 shrink-0 text-subtle" />
                                                                            )}
                                                                            <input
                                                                                className="flex-1 rounded-lg border border-transparent bg-transparent px-2 py-1 text-default text-sm hover:border-default focus:border-primary focus:outline-none"
                                                                                onChange={(e) =>
                                                                                    updateFolder(
                                                                                        collection.id,
                                                                                        folder.id,
                                                                                        {
                                                                                            title: e
                                                                                                .target
                                                                                                .value,
                                                                                        }
                                                                                    )
                                                                                }
                                                                                value={folder.title}
                                                                            />
                                                                            <span
                                                                                className={`shrink-0 text-xs ${(folder.catalogSources || []).length === 0 ? "text-warning" : "text-subtle"}`}
                                                                            >
                                                                                {
                                                                                    (
                                                                                        folder.catalogSources ||
                                                                                        []
                                                                                    ).length
                                                                                }{" "}
                                                                                source
                                                                                {(
                                                                                    folder.catalogSources ||
                                                                                    []
                                                                                ).length === 1
                                                                                    ? ""
                                                                                    : "s"}
                                                                            </span>
                                                                            <button
                                                                                className="p-1 text-subtle hover:text-default disabled:opacity-30"
                                                                                disabled={
                                                                                    fIndex === 0
                                                                                }
                                                                                onClick={() =>
                                                                                    reorderFolder(
                                                                                        collection.id,
                                                                                        fIndex,
                                                                                        -1
                                                                                    )
                                                                                }
                                                                                type="button"
                                                                            >
                                                                                <ArrowUpIcon className="h-3 w-3" />
                                                                            </button>
                                                                            <button
                                                                                className="p-1 text-subtle hover:text-default disabled:opacity-30"
                                                                                disabled={
                                                                                    fIndex ===
                                                                                    (
                                                                                        collection.folders ||
                                                                                        []
                                                                                    ).length -
                                                                                        1
                                                                                }
                                                                                onClick={() =>
                                                                                    reorderFolder(
                                                                                        collection.id,
                                                                                        fIndex,
                                                                                        1
                                                                                    )
                                                                                }
                                                                                type="button"
                                                                            >
                                                                                <ArrowDownIcon className="h-3 w-3" />
                                                                            </button>
                                                                            <button
                                                                                className="p-1 text-subtle hover:text-error"
                                                                                onClick={() =>
                                                                                    setDeleting({
                                                                                        collectionId:
                                                                                            collection.id,
                                                                                        folderId:
                                                                                            folder.id,
                                                                                        kind: "folder",
                                                                                    })
                                                                                }
                                                                                type="button"
                                                                            >
                                                                                <TrashIcon className="h-3 w-3" />
                                                                            </button>
                                                                        </div>

                                                                        {expanded[folder.id] && (
                                                                            <div className="mt-2 space-y-1.5 pl-6">
                                                                                {(
                                                                                    folder.catalogSources ||
                                                                                    []
                                                                                ).map(
                                                                                    (
                                                                                        source,
                                                                                        sIndex
                                                                                    ) => {
                                                                                        const {
                                                                                            addonName,
                                                                                            catalogName,
                                                                                            found,
                                                                                            linked,
                                                                                            linkedHere,
                                                                                        } =
                                                                                            describeSource(
                                                                                                source
                                                                                            );
                                                                                        const genreSuffix =
                                                                                            source.genre &&
                                                                                            source.genre !==
                                                                                                "none"
                                                                                                ? ` — ${source.genre}`
                                                                                                : "";
                                                                                        return (
                                                                                            <div
                                                                                                className="flex items-center gap-2 rounded-md bg-surface-hover px-2 py-1.5 text-xs"
                                                                                                key={
                                                                                                    sIndex
                                                                                                }
                                                                                            >
                                                                                                {!found && (
                                                                                                    <ExclamationTriangleIcon className="h-3.5 w-3.5 shrink-0 text-warning" />
                                                                                                )}
                                                                                                <span className="flex-1 truncate text-default">
                                                                                                    {found ? (
                                                                                                        <>
                                                                                                            {
                                                                                                                catalogName
                                                                                                            }
                                                                                                            {
                                                                                                                genreSuffix
                                                                                                            }{" "}
                                                                                                            <span className="text-subtle">
                                                                                                                ·{" "}
                                                                                                                {
                                                                                                                    addonName
                                                                                                                }{" "}
                                                                                                                (
                                                                                                                {
                                                                                                                    source.type
                                                                                                                }
                                                                                                                )
                                                                                                            </span>
                                                                                                            {linked && (
                                                                                                                <span
                                                                                                                    className="ml-1.5 rounded px-1.5 py-0.5 font-medium text-[10px]"
                                                                                                                    style={{
                                                                                                                        background:
                                                                                                                            "var(--color-primary-muted)",
                                                                                                                        color: "var(--color-primary)",
                                                                                                                    }}
                                                                                                                >
                                                                                                                    linked
                                                                                                                    ·
                                                                                                                    auto-updates
                                                                                                                </span>
                                                                                                            )}
                                                                                                        </>
                                                                                                    ) : linked &&
                                                                                                      linkedHere ? (
                                                                                                        <span className="text-warning">
                                                                                                            Linked
                                                                                                            catalog
                                                                                                            -
                                                                                                            SlickTrax
                                                                                                            Addon
                                                                                                            not
                                                                                                            on
                                                                                                            the
                                                                                                            account{" "}
                                                                                                            <span className="text-subtle">
                                                                                                                ·
                                                                                                                press
                                                                                                                Sync
                                                                                                                on
                                                                                                                the
                                                                                                                user
                                                                                                                to
                                                                                                                install
                                                                                                                it,
                                                                                                                then
                                                                                                                this
                                                                                                                resolves
                                                                                                                by
                                                                                                                itself
                                                                                                            </span>
                                                                                                        </span>
                                                                                                    ) : linked ? (
                                                                                                        <span className="text-warning">
                                                                                                            Linked
                                                                                                            on
                                                                                                            another
                                                                                                            instance{" "}
                                                                                                            <span className="text-subtle">
                                                                                                                ·
                                                                                                                created
                                                                                                                by
                                                                                                                a
                                                                                                                different
                                                                                                                SlickSync,
                                                                                                                so
                                                                                                                this
                                                                                                                catalog
                                                                                                                does
                                                                                                                not
                                                                                                                exist
                                                                                                                here
                                                                                                                -
                                                                                                                remove
                                                                                                                it
                                                                                                                and
                                                                                                                link
                                                                                                                the
                                                                                                                catalog
                                                                                                                again
                                                                                                            </span>
                                                                                                        </span>
                                                                                                    ) : (
                                                                                                        <span className="text-warning">
                                                                                                            Source
                                                                                                            not
                                                                                                            found{" "}
                                                                                                            <span className="text-subtle">
                                                                                                                ·
                                                                                                                addon
                                                                                                                removed
                                                                                                                or
                                                                                                                catalog
                                                                                                                no
                                                                                                                longer
                                                                                                                exists
                                                                                                            </span>
                                                                                                        </span>
                                                                                                    )}
                                                                                                </span>
                                                                                                <button
                                                                                                    className="shrink-0 text-subtle hover:text-error"
                                                                                                    onClick={() =>
                                                                                                        removeSource(
                                                                                                            collection.id,
                                                                                                            folder.id,
                                                                                                            sIndex
                                                                                                        )
                                                                                                    }
                                                                                                    type="button"
                                                                                                >
                                                                                                    <TrashIcon className="h-3 w-3" />
                                                                                                </button>
                                                                                            </div>
                                                                                        );
                                                                                    }
                                                                                )}
                                                                                <Button
                                                                                    leftIcon={
                                                                                        <PlusIcon className="h-3.5 w-3.5" />
                                                                                    }
                                                                                    onClick={() =>
                                                                                        openPicker(
                                                                                            collection.id,
                                                                                            folder.id
                                                                                        )
                                                                                    }
                                                                                    size="sm"
                                                                                    variant="ghost"
                                                                                >
                                                                                    Add source
                                                                                </Button>
                                                                            </div>
                                                                        )}
                                                                    </div>
                                                                )
                                                            )}
                                                            <Button
                                                                leftIcon={
                                                                    <PlusIcon className="h-4 w-4" />
                                                                }
                                                                onClick={() =>
                                                                    addFolder(collection.id)
                                                                }
                                                                size="sm"
                                                                variant="ghost"
                                                            >
                                                                Add folder
                                                            </Button>
                                                        </div>
                                                    )}
                                                </Card>
                                            ))}
                                        </div>
                                    )}
                                </>
                            ))}
                    </PageSection>
                </div>
            </div>

            {/* Floating save bar - fixed to the viewport so it's reachable without
          scrolling back to the header, however far down a long Collections
          list (some real accounts have 10+ folders) you've scrolled while
          editing. The header's own Save button stays too (muscle memory /
          consistency with every other detail page), this is purely an
          always-reachable second entry point for the exact same action. */}
            <AnimatePresence>
                {isDirty && selectedProfileIndex !== null && (
                    <motion.div
                        animate={{ opacity: 1, y: 0 }}
                        className="fixed bottom-8 left-1/2 z-50 -translate-x-1/2"
                        exit={{ opacity: 0, y: 100 }}
                        initial={{ opacity: 0, y: 100 }}
                    >
                        <div className="flex items-center gap-4 rounded-2xl border border-default bg-surface px-6 py-4 shadow-2xl backdrop-blur-xl">
                            <span className="text-sm text-warning">Unsaved changes</span>
                            <div className="flex items-center gap-2">
                                <Button
                                    disabled={saving}
                                    onClick={() => setCollections(JSON.parse(savedSnapshot))}
                                    size="sm"
                                    variant="ghost"
                                >
                                    Discard
                                </Button>
                                <Button
                                    isLoading={saving}
                                    onClick={handleSave}
                                    size="sm"
                                    variant="primary"
                                >
                                    Save changes
                                </Button>
                            </div>
                        </div>
                    </motion.div>
                )}
            </AnimatePresence>

            {/* Delete confirmation */}
            <Modal
                isOpen={!!deleting}
                onClose={() => setDeleting(null)}
                size="sm"
                title={deleting?.kind === "folder" ? "Delete folder" : "Delete collection"}
            >
                <div className="space-y-4">
                    <p className="text-muted text-sm">
                        {deleting?.kind === "folder"
                            ? "Delete this folder and its sources? This only changes what you're about to save - nothing happens on the Nuvio account until you click Save changes."
                            : "Delete this collection and everything in it? This only changes what you're about to save - nothing happens on the Nuvio account until you click Save changes."}
                    </p>
                    <div className="flex justify-end gap-2">
                        <Button onClick={() => setDeleting(null)} size="sm" variant="ghost">
                            Cancel
                        </Button>
                        <Button
                            onClick={() => {
                                if (!deleting) {
                                    return;
                                }
                                if (deleting.kind === "collection") {
                                    removeCollection(deleting.collectionId);
                                } else if (deleting.folderId) {
                                    removeFolder(deleting.collectionId, deleting.folderId);
                                }
                                setDeleting(null);
                            }}
                            size="sm"
                            variant="danger"
                        >
                            Delete
                        </Button>
                    </div>
                </div>
            </Modal>

            <Modal
                isOpen={importExportInfoOpen}
                onClose={() => setImportExportInfoOpen(false)}
                size="sm"
                title="Export & Import"
            >
                <div className="space-y-3 text-muted text-sm">
                    <p>
                        {/* Both actually trigger the same Export/Import buttons in the
                page's own toolbar - real feedback that bold-but-inert text
                reads as broken/clickable-looking with nothing behind it. */}
                        <button
                            className="font-medium text-default hover:underline disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:no-underline"
                            disabled={collections.length === 0}
                            onClick={() => {
                                setImportExportInfoOpen(false);
                                exportCollectionsJson();
                            }}
                            type="button"
                        >
                            Export
                        </button>{" "}
                        downloads this profile&apos;s collections exactly as SlickSync sends them to
                        Nuvio&apos;s sync backend.
                    </p>
                    <p>
                        <button
                            className="font-medium text-default hover:underline"
                            onClick={() => {
                                setImportExportInfoOpen(false);
                                importFileInputRef.current?.click();
                            }}
                            type="button"
                        >
                            Import
                        </button>{" "}
                        loads a JSON file back into this page as a draft - review it, then hit Save
                        changes to push it through the normal sync path. Nothing is written until
                        you save.
                    </p>
                    <p>
                        Folders linked to a SlickSync Catalog travel too - but the link points at
                        the ORIGINAL user&apos;s SlickTrax Addon. Importing onto a different account
                        keeps showing that user&apos;s catalog; re-link the folder there if it
                        should follow the new account&apos;s own catalogs instead.
                    </p>
                    <p className="mt-3 text-muted text-sm">
                        Nuvio&apos;s own site has a matching Import/Export on its Collections page,
                        if you&apos;d rather manage things from there:
                    </p>
                    <a
                        className="flex w-fit items-center gap-1.5 text-primary hover:underline"
                        href="https://nuvio.tv/account?tab=collections"
                        rel="noopener noreferrer"
                        target="_blank"
                    >
                        nuvio.tv/account?tab=collections
                        <ArrowTopRightOnSquareIcon className="h-3.5 w-3.5" />
                    </a>
                </div>
            </Modal>

            {/* Share codes for the whole layout. Import STAGES into the draft
          (same as the JSON file import above) rather than writing straight
          to Nuvio - review, then Save changes, exactly like every other
          edit on this page. */}
            <ShareCodeDialog
                extraContent={
                    collections.length > 1 ? (
                        <div className="space-y-1.5">
                            <div className="flex items-center justify-between">
                                <p className="font-medium text-muted text-xs">
                                    Which collections go in the code
                                </p>
                                <button
                                    className="text-muted text-xs transition-colors hover:text-default"
                                    onClick={() =>
                                        setShareSelected(
                                            shareSelected.size === collections.length
                                                ? new Set()
                                                : new Set(collections.map((c) => c.id))
                                        )
                                    }
                                    type="button"
                                >
                                    {shareSelected.size === collections.length
                                        ? "Select none"
                                        : "Select all"}
                                </button>
                            </div>
                            {collections.map((c) => {
                                const on = shareSelected.has(c.id);
                                return (
                                    <label
                                        className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5"
                                        key={c.id}
                                        style={{ background: "var(--color-surface-hover)" }}
                                    >
                                        <input
                                            checked={on}
                                            className="accent-[var(--color-primary)]"
                                            onChange={() =>
                                                setShareSelected((prev) => {
                                                    const n = new Set(prev);
                                                    if (n.has(c.id)) {
                                                        n.delete(c.id);
                                                    } else {
                                                        n.add(c.id);
                                                    }
                                                    return n;
                                                })
                                            }
                                            type="checkbox"
                                        />
                                        <span className="truncate text-default text-sm">
                                            {c.title}
                                        </span>
                                        <span className="shrink-0 text-subtle text-xs">
                                            {(c.folders || []).length} folder
                                            {(c.folders || []).length === 1 ? "" : "s"}
                                        </span>
                                    </label>
                                );
                            })}
                        </div>
                    ) : undefined
                }
                generate={() => {
                    const chosen = collections.filter((c) => shareSelected.has(c.id));
                    if (chosen.length === 0) {
                        throw new Error("Pick at least one collection to share");
                    }
                    return encodeNuvioCollectionsShareCode({
                        collections: chosen as unknown as Array<
                            { title: string; folders: unknown[] } & Record<string, unknown>
                        >,
                    });
                }}
                isOpen={showShareCode}
                onClose={() => setShowShareCode(false)}
                summary={`${shareSelected.size} of ${collections.length} collection${collections.length === 1 ? "" : "s"} and their folders (titles, covers, and which catalogs each folder pulls from)`}
                title="Share collections as code"
            />
            <PasteCodeDialog
                isOpen={showPasteCode}
                onClose={() => setShowPasteCode(false)}
                onImport={(text) => {
                    const decoded = decodeShareCode(text);
                    if (decoded?.kind !== "nuvioCollections") {
                        throw new Error("That code isn't a collections share code");
                    }
                    const staged = (
                        decoded.payload.collections as unknown as NuvioCollection[]
                    ).map(deepCopyCollection);
                    setCollections((prev) => [...prev, ...staged]);
                    toast.success(
                        `Added ${staged.length} collection${staged.length === 1 ? "" : "s"} - review, then Save changes`
                    );
                }}
                placeholder="Paste an SSN1: collections code…"
                title="Import collections from a code"
            />

            <Modal
                isOpen={tipsInfoOpen}
                onClose={() => setTipsInfoOpen(false)}
                size="sm"
                title="Tips"
            >
                <div className="space-y-3 text-muted text-sm">
                    <p>
                        Some folders may use TMDb-sourced templates (created in the Nuvio app or on
                        nuvio.tv) rather than an addon catalog. Those need a TMDb API key set in the{" "}
                        {/* nuvio.tv/account?tab=settings inferred from the confirmed
                ?tab=collections pattern below (same site, same account
                dashboard) - not independently verified the tab itself
                exists, unlike that one. */}
                        <a
                            className="text-primary hover:underline"
                            href="https://nuvio.tv/account?tab=settings"
                            rel="noopener noreferrer"
                            target="_blank"
                        >
                            Nuvio app&apos;s own Settings
                        </a>{" "}
                        — separate from SlickSync&apos;s — or they won&apos;t render on-device.
                    </p>
                    <p>
                        Want to turn a SlickSync Catalog into a folder here? Open any folder, press{" "}
                        <button
                            className="font-medium text-primary hover:underline"
                            onClick={() => setTipsInfoOpen(false)}
                            type="button"
                        >
                            Add source
                        </button>{" "}
                        and pick it under{" "}
                        <span className="font-medium text-default">Link a SlickSync Catalog</span> —
                        the folder then follows the catalog automatically: refresh it, auto-refresh
                        it, edit it, and the device updates on its own. The link is served through
                        that user&apos;s SlickTrax Addon; if the addon isn&apos;t on the account
                        yet, linking installs and syncs it in the same step. Press Save changes to
                        push, and from then on there is nothing to re-push.
                    </p>
                    <p className="mt-3 text-muted text-sm">
                        Prefer the folder to work without the SlickTrax Addon? The older route still
                        works: open the Catalog, use{" "}
                        <button
                            className="font-medium text-primary hover:underline"
                            onClick={() => {
                                setTipsInfoOpen(false);
                                router.push("/catalogs");
                            }}
                            type="button"
                        >
                            Export to MDBList
                        </button>{" "}
                        to create a real MDBList list from it, then add that list&apos;s URL as a
                        Custom Catalog (provider: MDBList) in{" "}
                        {/* AIOStreams/AIOMetadata deliberately left as plain text, not
                links - this account doesn't host either for anyone else to
                use, and pointing at a specific instance would be wrong for
                most readers; find your own is the correct answer here. */}
                        AIOStreams or AIOMetadata&apos;s own config, and add that as the source
                        instead. That copy lives on MDBList and does not follow later edits by
                        itself — linking is the set-and-forget option.
                    </p>
                </div>
            </Modal>

            {/* Starter templates - previews real match counts against this
          account's own installed addons before anything is added, so
          there's never a surprise empty folder. */}
            <Modal
                isOpen={templatesOpen}
                onClose={() => setTemplatesOpen(false)}
                size="lg"
                title="Use a template"
            >
                <div className="space-y-3">
                    <p className="text-muted text-sm">
                        Folders are only added where a real match is found in your installed addons
                        - nothing is guessed or left empty.
                    </p>
                    {addonsLoading && (
                        <p className="text-muted text-sm">Loading your installed addons...</p>
                    )}
                    {!addonsLoading &&
                        (() => {
                            const matchedGenres = GENRE_TEMPLATE.genres.filter(
                                (slot) => matchGenreSources(slot.aliases, addons).length > 0
                            );
                            return (
                                <Card padding="md">
                                    <div className="flex items-center justify-between gap-3">
                                        <div className="min-w-0">
                                            <p className="font-semibold text-default text-sm">
                                                {GENRE_TEMPLATE.title}
                                            </p>
                                            <p className="text-muted text-xs">
                                                {GENRE_TEMPLATE.description}
                                            </p>
                                            <p className="mt-1 text-subtle text-xs">
                                                {matchedGenres.length} of{" "}
                                                {GENRE_TEMPLATE.genres.length} genres match your
                                                installed addons
                                            </p>
                                        </div>
                                        <Button
                                            disabled={matchedGenres.length === 0}
                                            onClick={applyGenreTemplate}
                                            size="sm"
                                            variant="secondary"
                                        >
                                            Add
                                        </Button>
                                    </div>
                                </Card>
                            );
                        })()}
                </div>
            </Modal>

            {/* Source picker */}
            <Modal
                isOpen={!!pickerTarget}
                onClose={() => setPickerTarget(null)}
                size="lg"
                title="Add a catalog source"
            >
                <div className="space-y-4">
                    {addonsLoading ? (
                        <p className="text-muted text-sm">Loading installed addons...</p>
                    ) : addons.length === 0 ? (
                        <p className="py-6 text-center text-muted text-sm">
                            This account has no installed addons to pick a catalog from yet.
                        </p>
                    ) : (
                        <>
                            {slickCatalogs && slickCatalogs.length > 0 && (
                                <fieldset
                                    aria-labelledby={`${groupLabelId1}-2`}
                                    className="mx-0 min-w-0 border-0 p-0"
                                >
                                    <p
                                        className="mb-1.5 block font-medium text-muted text-xs"
                                        id={`${groupLabelId1}-2`}
                                    >
                                        Link a SlickSync Catalog
                                    </p>
                                    <p className="mb-2 text-[11px] text-subtle">
                                        A linked folder follows the catalog automatically - refresh
                                        it, auto-refresh it, edit it, and the folder updates on its
                                        own. Served through this user&apos;s SlickTrax Addon
                                        {traxEnabled === false
                                            ? ", which is currently off and will be enabled and synced when you link"
                                            : ""}
                                        .
                                    </p>
                                    <div className="grid grid-cols-2 gap-2">
                                        {slickCatalogs.map((list) => (
                                            <button
                                                className="rounded-lg border border-default px-3 py-2 text-left text-xs transition-colors hover:border-primary/50 disabled:opacity-50"
                                                disabled={linkBusyId !== null}
                                                key={list.id}
                                                onClick={() => linkSlickCatalog(list)}
                                                type="button"
                                            >
                                                <p className="truncate font-medium text-default">
                                                    {linkBusyId === list.id
                                                        ? "Linking..."
                                                        : list.name}
                                                </p>
                                                <p className="text-subtle">
                                                    {(list.items || []).length} title
                                                    {(list.items || []).length === 1 ? "" : "s"} ·
                                                    stays in sync
                                                </p>
                                            </button>
                                        ))}
                                    </div>
                                    <div className="my-4 flex items-center gap-2">
                                        <div
                                            className="h-px flex-1 bg-surface-border"
                                            style={{ background: "var(--color-surface-border)" }}
                                        />
                                        <span className="text-[10px] text-subtle uppercase tracking-wide">
                                            or pick from an installed addon
                                        </span>
                                        <div
                                            className="h-px flex-1"
                                            style={{ background: "var(--color-surface-border)" }}
                                        />
                                    </div>
                                </fieldset>
                            )}

                            <div>
                                <label
                                    className="mb-1.5 block font-medium text-muted text-xs"
                                    htmlFor={`${fieldId1}-5`}
                                >
                                    Addon
                                </label>
                                <select
                                    className="input-base w-full appearance-none px-3 py-2 pr-10 text-sm"
                                    id={`${fieldId1}-5`}
                                    onChange={(e) => {
                                        setPickerAddonId(e.target.value || null);
                                        setPickerCatalog(null);
                                        setPickerPreview([]);
                                    }}
                                    value={pickerAddonId || ""}
                                >
                                    <option value="">Select an addon...</option>
                                    {addons.map((a) => (
                                        <option
                                            key={a.manifest?.id || a.transportUrl}
                                            value={a.manifest?.id}
                                        >
                                            {a.name || a.manifest?.name || "Unknown"}
                                        </option>
                                    ))}
                                </select>
                            </div>

                            {pickerAddon && (
                                <fieldset
                                    aria-labelledby={`${groupLabelId1}-3`}
                                    className="mx-0 min-w-0 border-0 p-0"
                                >
                                    <p
                                        className="mb-1.5 block font-medium text-muted text-xs"
                                        id={`${groupLabelId1}-3`}
                                    >
                                        Catalog
                                    </p>
                                    {(pickerAddon.manifest?.catalogs || []).length === 0 ? (
                                        <p className="text-subtle text-xs">
                                            This addon has no catalogs.
                                        </p>
                                    ) : (
                                        <div className="grid grid-cols-2 gap-2">
                                            {(pickerAddon.manifest?.catalogs || []).map((cat) => (
                                                <button
                                                    className={`rounded-lg border px-3 py-2 text-left text-xs transition-colors ${pickerCatalog?.id === cat.id && pickerCatalog?.type === cat.type ? "border-primary bg-primary/10" : "border-default hover:border-primary/50"}`}
                                                    key={`${cat.type}:${cat.id}`}
                                                    onClick={() => handlePickCatalog(cat)}
                                                    type="button"
                                                >
                                                    <p className="truncate font-medium text-default">
                                                        {cat.name || cat.id}
                                                    </p>
                                                    <p className="text-subtle">{cat.type}</p>
                                                </button>
                                            ))}
                                        </div>
                                    )}
                                </fieldset>
                            )}

                            {pickerCatalog && (
                                <fieldset
                                    aria-labelledby={`${groupLabelId1}-4`}
                                    className="mx-0 min-w-0 border-0 p-0"
                                >
                                    <p
                                        className="mb-1.5 block font-medium text-muted text-xs"
                                        id={`${groupLabelId1}-4`}
                                    >
                                        Preview
                                    </p>
                                    {pickerPreviewLoading ? (
                                        <div className="flex gap-2">
                                            {[...new Array(6)].map((_, i) => (
                                                <div
                                                    className="aspect-[2/3] w-16 animate-pulse rounded-md bg-surface-hover"
                                                    key={i}
                                                />
                                            ))}
                                        </div>
                                    ) : pickerPreview.length === 0 ? (
                                        <p className="text-subtle text-xs">
                                            No preview available for this catalog.
                                        </p>
                                    ) : (
                                        <ScrollRow className="flex gap-2 pb-1">
                                            {pickerPreview.map((item) => (
                                                <button
                                                    className="aspect-[2/3] w-16 shrink-0 overflow-hidden rounded-md bg-surface-hover"
                                                    key={item.id}
                                                    onClick={() => setDetail(item)}
                                                    title={item.name}
                                                    type="button"
                                                >
                                                    {item.poster ? (
                                                        // eslint-disable-next-line @next/next/no-img-element
                                                        <img
                                                            alt=""
                                                            className="h-full w-full object-cover"
                                                            src={item.poster}
                                                        />
                                                    ) : (
                                                        <div className="flex h-full w-full items-center justify-center p-1 text-center text-[10px] text-subtle">
                                                            {item.name}
                                                        </div>
                                                    )}
                                                </button>
                                            ))}
                                        </ScrollRow>
                                    )}
                                </fieldset>
                            )}

                            <div className="flex justify-end gap-2 pt-2">
                                <Button
                                    onClick={() => setPickerTarget(null)}
                                    size="sm"
                                    variant="ghost"
                                >
                                    Cancel
                                </Button>
                                <Button
                                    disabled={!pickerCatalog}
                                    onClick={confirmAddSource}
                                    size="sm"
                                    variant="primary"
                                >
                                    Add source
                                </Button>
                            </div>
                        </>
                    )}
                </div>
            </Modal>

            {/* Folder detail - clicking a grid tile opens this: rename, a live
          preview row (same cached data the tile's own ambient collage
          already uses), and the source list/picker - replaces both the old
          always-expanded inline nested list and the separate collection-
          wide "Preview" modal in one place. */}
            {(() => {
                const activeCollection = folderDetail
                    ? collections.find((c) => c.id === folderDetail.collectionId)
                    : null;
                const activeFolder =
                    activeCollection?.folders?.find((f) => f.id === folderDetail?.folderId) || null;
                const items = folderDetail ? previewByFolder[folderDetail.folderId] || [] : [];
                const isLoadingPreview = folderDetail
                    ? previewLoadingIds.has(folderDetail.folderId)
                    : false;

                const hero = items[0];
                // hero.poster is string | null (see PreviewFolderItems), not
                // string | undefined - <img src> only accepts the latter (a
                // previous string | null here broke a production build the same
                // way, see posterUrl.ts's own comment on this exact gotcha).
                const modalHeroPoster =
                    (typeof activeFolder?.coverImageUrl === "string"
                        ? activeFolder.coverImageUrl
                        : null) ||
                    hero?.poster ||
                    undefined;

                return (
                    <Modal
                        backdropImage={modalHeroPoster}
                        isOpen={!!folderDetail}
                        onClose={() => setFolderDetail(null)}
                        size="lg"
                    >
                        {activeFolder && folderDetail && (
                            <div className="space-y-4">
                                <div className="flex items-start gap-3">
                                    <button
                                        className="group relative h-20 w-20 shrink-0 overflow-hidden rounded-xl border border-default bg-surface-hover transition-colors hover:border-primary/50"
                                        onClick={() =>
                                            setCoverPickerFolder({
                                                collectionId: folderDetail.collectionId,
                                                folderId: folderDetail.folderId,
                                            })
                                        }
                                        title="Change folder cover"
                                        type="button"
                                    >
                                        {modalHeroPoster ? (
                                            // eslint-disable-next-line @next/next/no-img-element
                                            <img
                                                alt=""
                                                className="h-full w-full object-cover"
                                                src={modalHeroPoster}
                                            />
                                        ) : (
                                            <div className="flex h-full w-full items-center justify-center">
                                                <PhotoIcon className="h-6 w-6 text-subtle" />
                                            </div>
                                        )}
                                        {/* Always-visible, not hover-only - a hover cue alone
                          is invisible on touch devices with no way to
                          discover the thumbnail is clickable. */}
                                        <div
                                            className="absolute right-1 bottom-1 flex h-6 w-6 items-center justify-center rounded-full shadow-sm transition-transform group-hover:scale-110"
                                            style={{ background: "var(--color-primary)" }}
                                        >
                                            <PencilSquareIcon className="h-3.5 w-3.5 text-white" />
                                        </div>
                                    </button>
                                    <input
                                        className="mt-2 flex-1 border-transparent border-b bg-transparent pb-1 font-display font-semibold text-2xl text-default hover:border-default focus:border-primary focus:outline-none"
                                        onChange={(e) =>
                                            updateFolder(
                                                folderDetail.collectionId,
                                                folderDetail.folderId,
                                                { title: e.target.value }
                                            )
                                        }
                                        placeholder="Folder title"
                                        value={activeFolder.title}
                                    />
                                </div>

                                {/* Tabs, not stacked sections - a folder with a lot of
                      preview posters otherwise pushed "Add source" far
                      enough down that reaching it needed scrolling every
                      single time. */}
                                <div className="flex w-fit gap-1 rounded-xl bg-surface-hover p-1">
                                    <button
                                        className={`rounded-lg px-4 py-1.5 font-medium text-sm transition-colors ${folderDetailTab === "sources" ? "bg-surface text-default shadow-sm" : "text-muted hover:text-default"}`}
                                        onClick={() => setFolderDetailTab("sources")}
                                        type="button"
                                    >
                                        Sources
                                        {(activeFolder.catalogSources || []).length > 0
                                            ? ` (${(activeFolder.catalogSources || []).length})`
                                            : ""}
                                    </button>
                                    <button
                                        className={`rounded-lg px-4 py-1.5 font-medium text-sm transition-colors ${folderDetailTab === "preview" ? "bg-surface text-default shadow-sm" : "text-muted hover:text-default"}`}
                                        onClick={() => setFolderDetailTab("preview")}
                                        type="button"
                                    >
                                        Preview
                                    </button>
                                </div>

                                {folderDetailTab === "sources" ? (
                                    <div>
                                        {(activeFolder.catalogSources || []).length === 0 ? (
                                            <div className="mb-2 flex items-start gap-2 rounded-lg border border-warning/30 bg-warning/10 p-3">
                                                <ExclamationTriangleIcon className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
                                                <p className="text-default text-sm">
                                                    No sources yet — this folder saves fine, but
                                                    Nuvio won&apos;t show it at all until it has at
                                                    least one. Add a source below.
                                                </p>
                                            </div>
                                        ) : (
                                            <div className="mb-2 space-y-1.5">
                                                {(activeFolder.catalogSources || []).map(
                                                    (source, sIndex) => {
                                                        const {
                                                            addonName,
                                                            catalogName,
                                                            found,
                                                            linked,
                                                            linkedHere,
                                                        } = describeSource(source);
                                                        const genreSuffix =
                                                            source.genre && source.genre !== "none"
                                                                ? ` — ${source.genre}`
                                                                : "";
                                                        return (
                                                            <div
                                                                className="flex items-center gap-3 rounded-xl bg-surface-hover px-3 py-2.5 text-sm"
                                                                key={sIndex}
                                                            >
                                                                {found ? (
                                                                    // An icon, not a color dot - primary/secondary
                                                                    // render too similarly in this theme to tell
                                                                    // movie/series apart by color alone, and the
                                                                    // type is already spelled out in the text
                                                                    // beside it anyway, so make the redundant
                                                                    // indicator at least legible on its own.
                                                                    source.type === "movie" ? (
                                                                        <FilmIcon className="h-4 w-4 shrink-0 text-subtle" />
                                                                    ) : (
                                                                        <TvIcon className="h-4 w-4 shrink-0 text-subtle" />
                                                                    )
                                                                ) : (
                                                                    <ExclamationTriangleIcon className="h-4 w-4 shrink-0 text-warning" />
                                                                )}
                                                                <span className="flex-1 truncate text-default">
                                                                    {found ? (
                                                                        <>
                                                                            {catalogName}
                                                                            {genreSuffix}{" "}
                                                                            <span className="text-subtle text-xs">
                                                                                · {addonName} (
                                                                                {source.type})
                                                                            </span>
                                                                        </>
                                                                    ) : linked && linkedHere ? (
                                                                        // A linked catalog rides the SlickTrax
                                                                        // addon, so until that is installed the
                                                                        // source genuinely does not resolve -
                                                                        // but "addon removed" is the wrong story
                                                                        // for something that is mid-install.
                                                                        <span className="text-warning">
                                                                            Linked catalog{" "}
                                                                            <span className="text-subtle text-xs">
                                                                                · SlickTrax is still
                                                                                installing on the
                                                                                account - press Sync
                                                                                on the user, then
                                                                                this resolves itself
                                                                            </span>
                                                                        </span>
                                                                    ) : linked ? (
                                                                        <span className="text-warning">
                                                                            Linked on another
                                                                            instance{" "}
                                                                            <span className="text-subtle text-xs">
                                                                                · this source was
                                                                                created by a
                                                                                different SlickSync,
                                                                                so its catalog does
                                                                                not exist here -
                                                                                remove it and link
                                                                                the catalog again
                                                                            </span>
                                                                        </span>
                                                                    ) : (
                                                                        <span className="text-warning">
                                                                            Source not found{" "}
                                                                            <span className="text-subtle text-xs">
                                                                                · addon removed or
                                                                                catalog no longer
                                                                                exists
                                                                            </span>
                                                                        </span>
                                                                    )}
                                                                </span>
                                                                <button
                                                                    className="shrink-0 rounded-lg p-1.5 text-subtle hover:bg-surface hover:text-error"
                                                                    onClick={() =>
                                                                        removeSource(
                                                                            folderDetail.collectionId,
                                                                            folderDetail.folderId,
                                                                            sIndex
                                                                        )
                                                                    }
                                                                    type="button"
                                                                >
                                                                    <TrashIcon className="h-4 w-4" />
                                                                </button>
                                                            </div>
                                                        );
                                                    }
                                                )}
                                            </div>
                                        )}
                                        <Button
                                            leftIcon={<PlusIcon className="h-4 w-4" />}
                                            onClick={() =>
                                                openPicker(
                                                    folderDetail.collectionId,
                                                    folderDetail.folderId
                                                )
                                            }
                                            size="sm"
                                            variant="ghost"
                                        >
                                            Add source
                                        </Button>
                                    </div>
                                ) : (
                                    <div>
                                        {items.length > 0 && (
                                            <p className="mb-2 text-subtle text-xs">
                                                {items.length} title{items.length === 1 ? "" : "s"}
                                            </p>
                                        )}
                                        {(activeFolder.catalogSources || []).length === 0 ? (
                                            <div className="rounded-xl border border-default border-dashed py-6 text-center">
                                                <p className="text-muted text-sm">
                                                    No sources yet - add one from the Sources tab to
                                                    see a preview here.
                                                </p>
                                            </div>
                                        ) : isLoadingPreview ? (
                                            <div className="flex flex-wrap gap-2.5">
                                                {[...new Array(6)].map((_, i) => (
                                                    <div
                                                        className="aspect-[2/3] w-20 animate-pulse rounded-lg bg-surface-hover"
                                                        key={i}
                                                    />
                                                ))}
                                            </div>
                                        ) : items.length === 0 ? (
                                            <p className="text-sm text-subtle">
                                                No preview available for this folder&apos;s sources.
                                            </p>
                                        ) : (
                                            <div className="flex flex-wrap gap-2.5">
                                                {items.map((item) => (
                                                    <button
                                                        className="group aspect-[2/3] w-20 shrink-0 overflow-hidden rounded-lg bg-surface-hover ring-1 ring-transparent transition-all hover:scale-[1.03] hover:ring-primary/60"
                                                        key={item.id}
                                                        onClick={() => setDetail(item)}
                                                        title={item.name}
                                                        type="button"
                                                    >
                                                        {item.poster ? (
                                                            // eslint-disable-next-line @next/next/no-img-element
                                                            <img
                                                                alt=""
                                                                className="h-full w-full object-cover"
                                                                src={item.poster}
                                                            />
                                                        ) : (
                                                            <div className="flex h-full w-full items-center justify-center p-1.5 text-center text-[10px] text-subtle leading-tight">
                                                                {item.name}
                                                            </div>
                                                        )}
                                                    </button>
                                                ))}
                                            </div>
                                        )}
                                    </div>
                                )}

                                <div className="flex justify-end border-default border-t pt-2">
                                    <Button
                                        onClick={() => setFolderDetail(null)}
                                        size="sm"
                                        variant="ghost"
                                    >
                                        Done
                                    </Button>
                                </div>
                            </div>
                        )}
                    </Modal>
                );
            })()}

            {/* List mode only - the original per-collection preview, reading
          straight from the ambient previewByFolder cache (see
          previewCollection's own comment above). */}
            <Modal
                isOpen={!!previewCollection}
                onClose={() => setPreviewCollection(null)}
                size="lg"
                title={`Preview: ${previewCollection?.title || ""}`}
            >
                <div className="space-y-4">
                    {(previewCollection?.folders || []).length === 0 ? (
                        <p className="py-6 text-center text-muted text-sm">
                            This collection has no folders yet.
                        </p>
                    ) : (
                        (previewCollection?.folders || []).map((folder) => {
                            const items = previewByFolder[folder.id] || [];
                            const loading = previewLoadingIds.has(folder.id);
                            return (
                                <div key={folder.id}>
                                    <p className="mb-1.5 font-medium text-muted text-xs">
                                        {folder.title}{" "}
                                        <span className="text-subtle">({items.length})</span>
                                    </p>
                                    {(folder.catalogSources || []).length === 0 ? (
                                        <p className="text-subtle text-xs">
                                            No sources in this folder.
                                        </p>
                                    ) : loading ? (
                                        <div className="flex gap-2">
                                            {[...new Array(6)].map((_, i) => (
                                                <div
                                                    className="aspect-[2/3] w-16 animate-pulse rounded-md bg-surface-hover"
                                                    key={i}
                                                />
                                            ))}
                                        </div>
                                    ) : items.length === 0 ? (
                                        <p className="text-subtle text-xs">
                                            No preview available for this folder&apos;s sources.
                                        </p>
                                    ) : (
                                        <ScrollRow className="flex gap-2 pb-1">
                                            {items.map((item) => (
                                                <button
                                                    className="aspect-[2/3] w-16 shrink-0 overflow-hidden rounded-md bg-surface-hover"
                                                    key={item.id}
                                                    onClick={() => setDetail(item)}
                                                    title={item.name}
                                                    type="button"
                                                >
                                                    {item.poster ? (
                                                        // eslint-disable-next-line @next/next/no-img-element
                                                        <img
                                                            alt=""
                                                            className="h-full w-full object-cover"
                                                            src={item.poster}
                                                        />
                                                    ) : (
                                                        <div className="flex h-full w-full items-center justify-center p-1 text-center text-[10px] text-subtle">
                                                            {item.name}
                                                        </div>
                                                    )}
                                                </button>
                                            ))}
                                        </ScrollRow>
                                    )}
                                </div>
                            );
                        })
                    )}
                </div>
            </Modal>

            {/* Folder cover - real Nuvio-native field (folder.coverImageUrl), same
          as the collection-level cover above. */}
            {coverPickerFolder &&
                (() => {
                    const folder = collections
                        .find((c) => c.id === coverPickerFolder.collectionId)
                        ?.folders?.find((f) => f.id === coverPickerFolder.folderId);
                    return (
                        <AvatarPickerModal
                            currentAvatarUrl={
                                typeof folder?.coverImageUrl === "string"
                                    ? folder.coverImageUrl
                                    : null
                            }
                            isOpen={!!coverPickerFolder}
                            name={folder?.title || "Folder"}
                            nuvioCoversUserId={selectedUserId || undefined}
                            onClose={() => setCoverPickerFolder(null)}
                            onSave={async (data) => {
                                if (!("avatarUrl" in data)) {
                                    setCoverPickerFolder(null);
                                    return;
                                }
                                updateFolder(
                                    coverPickerFolder.collectionId,
                                    coverPickerFolder.folderId,
                                    {
                                        coverImageUrl: data.avatarUrl ?? null,
                                        focusGifEnabled: isGifUrl(data.avatarUrl),
                                        focusGifUrl: isGifUrl(data.avatarUrl)
                                            ? data.avatarUrl
                                            : null,
                                    }
                                );
                                setCoverPickerFolder(null);
                            }}
                            previewShape="rect"
                            size="full"
                            title=""
                        />
                    );
                })()}

            {/* Copy a Collection to another profile - writes immediately on
          confirm (see handleCopyTo's own comment for why). */}
            <Modal
                isOpen={!!copyTarget}
                onClose={() => setCopyTarget(null)}
                size="sm"
                title={`Copy "${copyTarget?.title || ""}" to...`}
            >
                <div className="space-y-2">
                    {otherProfiles.length === 0 ? (
                        <p className="text-muted text-sm">No other profiles on this account.</p>
                    ) : (
                        otherProfiles.map((p) => (
                            <button
                                className="flex w-full items-center justify-between rounded-lg border border-default px-3 py-2.5 text-left text-default text-sm transition-colors hover:border-primary/50 disabled:opacity-50"
                                disabled={copyingToIndex !== null}
                                key={p.profile_index}
                                onClick={() => handleCopyTo(p.profile_index)}
                                type="button"
                            >
                                <span>{p.name || `Profile ${p.profile_index}`}</span>
                                {copyingToIndex === p.profile_index && (
                                    <span className="text-subtle text-xs">Copying...</span>
                                )}
                            </button>
                        ))
                    )}
                    <div className="flex justify-end pt-2">
                        <Button onClick={() => setCopyTarget(null)} size="sm" variant="ghost">
                            Cancel
                        </Button>
                    </div>
                </div>
            </Modal>

            {detail && (
                <MediaDetailModal
                    fallbackPoster={detail.poster || undefined}
                    fallbackTitle={detail.name}
                    isOpen={!!detail}
                    itemId={detail.id}
                    itemType={detail.type as "movie" | "series"}
                    onClose={() => setDetail(null)}
                />
            )}
        </>
    );
}
