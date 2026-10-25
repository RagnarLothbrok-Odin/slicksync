"use client";

import type { DragEndEvent } from "@dnd-kit/core";
import { useDroppable } from "@dnd-kit/core";
import {
    rectSortingStrategy,
    SortableContext,
    verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { Dialog, DialogPanel } from "@headlessui/react";
import {
    ArrowLeftIcon,
    ArrowPathIcon,
    Bars3Icon,
    CheckIcon,
    Cog6ToothIcon,
    DocumentDuplicateIcon,
    EyeIcon,
    LinkIcon,
    MagnifyingGlassIcon,
    PlusIcon,
    PuzzlePieceIcon,
    ShieldCheckIcon,
    TagIcon,
    TrashIcon,
    UsersIcon,
    XCircleIcon,
    XMarkIcon,
} from "@heroicons/react/24/outline";
import { AnimatePresence, LayoutGroup, motion } from "framer-motion";
import Head from "next/head";
import Link from "next/link";
import { Fragment, useCallback, useEffect, useId, useMemo, useState } from "react";
import { AddonDirectoryModal } from "@/components/addons/AddonDirectoryModal";
import { SharedConfigPill } from "@/components/addons/SharedConfigPill";
import { Header } from "@/components/layout/Header";
import {
    NebulaCompactStatCard,
    NebulaGlassStripe,
    NebulaHeaderStats,
    NebulaPageHeading,
} from "@/components/layout/NebulaTopbar";
import { StaggerContainer, StaggerItem } from "@/components/layout/PageContainer";
import { useVaultDrag } from "@/components/providers/VaultDragContext";
import { TVFocusable } from "@/components/tv/TVFocusable";
import { TVPageProvider } from "@/components/tv/TVPageProvider";
import {
    Button,
    Card,
    ConfirmModal,
    ContextMenu,
    Input,
    Modal,
    PageToolbar,
    ResourceBadge,
    SelectionCheckbox,
    ToggleSwitch,
    useContextMenu,
    VersionBadge,
} from "@/components/ui";
import { BeginnerHint } from "@/components/ui/BeginnerHint";
import { useSortableDragState } from "@/components/ui/DragSortable";
import { toast } from "@/components/ui/Toast";
import { showDeletedWithUndo } from "@/components/ui/undoToast";
import type { Group } from "@/lib/api";
import { type Addon, api } from "@/lib/api";
import { readErrorMessage, readErrorName } from "@/lib/errors";
import { useIsMobile } from "@/lib/hooks/useIsMobile";
import { useIsTV } from "@/lib/hooks/useIsTV";
import { useLastKnown } from "@/lib/hooks/useLastKnown";
import { useLongPress } from "@/lib/hooks/useLongPress";
import { useLayoutMode } from "@/lib/layout-mode";
import { configKindOf, type SharedPeer, sharedConfigPeers } from "@/lib/sharedConfig";
import type { StremioManifest } from "@/lib/stremio-manifest";
import { useDefaultViewMode } from "@/lib/viewMode";

const ADDON_VAULT_CATEGORIES = [
    { label: "AIOStreams", value: "aiostreams" },
    { label: "Stremio", value: "stremio" },
    { label: "Nuvio", value: "nuvio" },
    { label: "Debrid Services", value: "debrid" },
    { label: "Usenet Providers", value: "usenet_provider" },
    { label: "Usenet Indexers", value: "usenet_indexer" },
    { label: "Metadata & Trackers", value: "metadata" },
    { label: "AI Services", value: "ai" },
    { label: "VPN", value: "vpn" },
    { label: "Custom", value: "custom" },
];

// Helper to compute configure URL from addon object
function getConfigureUrl(addon: Pick<Addon, "manifestUrl" | "url"> | null): string | null {
    const manifestUrl = addon?.manifestUrl || addon?.url;
    if (!manifestUrl) {
        return null;
    }
    try {
        const url = new URL(manifestUrl);
        const baseUrl = `${url.origin}${url.pathname.replace(/\/manifest(\.[^/?#]+)?$/i, "").replace(/\/$/, "")}`;
        return baseUrl.endsWith("/configure") ? baseUrl : `${baseUrl}/configure`;
    } catch {
        return null;
    }
}

// Addon display type
interface AddonDisplay {
    catalogs: Array<string | { type: string; id: string; search?: boolean }>;
    customTag: string | null;
    description?: string;
    groupCount: number;
    healthCheckError?: string;
    id: string;
    isActive?: boolean;
    isOnline?: boolean;
    isProtected: boolean;
    lastHealthCheck?: string;
    logo?: string | null;
    manifestUrl: string;
    name: string;
    resources: string[];
    userCount?: number;
    version?: string;
}

// Wraps an addon card with dnd-kit's sortable drag state, matching Vault's
// existing pattern. Unlike Vault, AddonCard's own right-click menu lives
// inside AddonCard itself, so this wraps from the outside (whole-card
// draggable) rather than passing a separate drag-handle prop through -
// AddonCard's internals, including its existing right-click menu, are
// completely untouched.
// A custom-tag pill: click to filter by it, drag an addon card onto it to
// tag it, hover for a small × to delete the tag entirely (with confirm via
// toast — deleting clears the tag off every addon that had it, server-side).
// The leading dot is a native color input styled small/circular — clicking
// it opens the OS color picker; picking a color tints the whole pill (and
// every place this tag shows up elsewhere) instead of the flat gray default.
function TagPill({
    tag,
    color,
    isActive,
    onClick,
    onDelete,
    onColorChange,
}: {
    tag: string;
    color?: string;
    isActive: boolean;
    onClick: () => void;
    onDelete: () => void;
    onColorChange: (color: string | null) => void;
}) {
    const { setNodeRef, isOver } = useDroppable({ id: `addon-tag-${encodeURIComponent(tag)}` });
    const tinted = !isActive && color;
    return (
        <div
            className={`group/tag flex items-center gap-1.5 rounded-full border py-1 pr-1 pl-1.5 font-medium text-xs transition-colors ${
                isActive
                    ? "border-transparent bg-primary text-white"
                    : tinted
                      ? "border-transparent"
                      : "nav-item-hover-pill border-default bg-surface-hover text-muted"
            }`}
            ref={setNodeRef}
            style={{
                ...(isOver
                    ? {
                          background: "var(--color-primary-muted)",
                          boxShadow: "0 0 0 2px var(--color-primary)",
                      }
                    : {}),
                ...(tinted ? { background: `${color}26`, color } : {}),
            }}
        >
            <span
                className="relative h-3.5 w-3.5 shrink-0 overflow-hidden rounded-full border border-white/20"
                style={{ background: color || "var(--color-text-muted)" }}
            >
                <input
                    aria-label={`Set a color for ${tag}`}
                    className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
                    onChange={(e) => onColorChange(e.target.value)}
                    onClick={(e) => e.stopPropagation()}
                    title={`Set a color for "${tag}"`}
                    type="color"
                    value={color || "#8b7ec8"}
                />
            </span>
            <button className="flex items-center" onClick={onClick} type="button">
                {tag}
            </button>
            <button
                aria-label={`Delete tag ${tag}`}
                className={`rounded-full p-0.5 opacity-0 transition-opacity group-hover/tag:opacity-100 ${isActive ? "hover:bg-white/20" : "hover:bg-surface"}`}
                onClick={(e) => {
                    e.stopPropagation();
                    onDelete();
                }}
                title={`Delete tag "${tag}"`}
                type="button"
            >
                <XCircleIcon className="h-3.5 w-3.5" />
            </button>
        </div>
    );
}

// Only itemProps (position/transform tracking, no listeners) goes on the
// outer wrapper now - dragHandleProps (the actual drag listeners) gets
// threaded into AddonCard as a prop instead, which renders it as a small
// dedicated grab handle rather than making clicking anywhere on the card
// (including its own buttons/links) a potential drag. Previously the whole
// card WAS the drag handle with no visible affordance at all - real
// feedback that reordering wasn't discoverable.
function SortableAddonWrapper({
    id,
    children,
}: {
    id: string;
    children: (dragHandleProps: Record<string, unknown>) => React.ReactNode;
}) {
    const { dragHandleProps, itemProps } = useSortableDragState(id);
    return (
        <div className={itemProps.className} ref={itemProps.ref} style={itemProps.style}>
            {children(dragHandleProps)}
        </div>
    );
}

export default function AddonsPage() {
    const fieldId1 = useId();
    const { layoutMode } = useLayoutMode();
    // Desktop-only: gives the 3 stat cards their own full-width row (same
    // grid-cols-3 block Users/Groups/Vault already use) instead of being
    // squeezed into NebulaPageHeading's own center column alongside the
    // title/actions, which is what made them look noticeably smaller here
    // than on those other pages despite using the identical card component.
    // Mobile keeps the existing NebulaHeaderStats placement untouched, per
    // explicit request.
    const isMobile = useIsMobile();
    const isTV = useIsTV();
    const Wrapper = isTV ? TVPageProvider : Fragment;
    const [searchQuery, setSearchQuery] = useState("");
    const { viewMode, setViewMode: _setViewMode } = useDefaultViewMode();
    const [isAddModalOpen, setIsAddModalOpen] = useState(false);
    const [isDirectoryOpen, setIsDirectoryOpen] = useState(false);
    const [activeFilter, setActiveFilter] = useState("all");
    // Custom tag catalog (account-wide list of names) + which one is active as
    // a filter. null = no tag filter applied (shows every addon regardless of
    // tag, same as activeFilter === 'all' does for the built-in filters).
    const [addonTags, setAddonTags] = useState<string[]>([]);
    const [addonTagColors, setAddonTagColors] = useState<Record<string, string>>({});
    const [activeTag, setActiveTag] = useState<string | null>(null);
    const [isAddingTag, setIsAddingTag] = useState(false);
    const [newTagName, setNewTagName] = useState("");
    const [deleteTagTarget, setDeleteTagTarget] = useState<string | null>(null);

    // Data state
    const [addons, setAddons] = useState<Addon[]>([]);
    // Addons whose links open the same AIOStreams/AIOMetadata configuration.
    const sharedPeers = useMemo(() => sharedConfigPeers(addons), [addons]);
    const [groups, setGroups] = useState<Group[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<Error | null>(null);

    // Multi-select state - NO isSelectMode, just selectedIds
    const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
    const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);
    const [isReloading, setIsReloading] = useState(false);
    const [isDeleting, setIsDeleting] = useState(false);

    // Single item delete state (for quick action menu)
    const [deleteTarget, setDeleteTarget] = useState<AddonDisplay | null>(null);

    // Clone state
    const [cloneTarget, setCloneTarget] = useState<AddonDisplay | null>(null);
    const [moveToVaultTarget, setMoveToVaultTarget] = useState<AddonDisplay | null>(null);
    const [moveToVaultCategory, setMoveToVaultCategory] = useState("custom");
    const [isMovingToVault, setIsMovingToVault] = useState(false);
    const [isBulkMoveToVaultOpen, setIsBulkMoveToVaultOpen] = useState(false);
    const [bulkMoveToVaultCategory, setBulkMoveToVaultCategory] = useState("custom");
    const [isBulkMovingToVault, setIsBulkMovingToVault] = useState(false);

    // Instant navigation: last-known addons/groups/tags shown immediately,
    // refreshed by the fetch below - see useLastKnown's own comment.
    useLastKnown<Addon[]>("/addons", (cached) => {
        setAddons(cached);
        setIsLoading(false);
    });
    // Cached snapshots use the same response model as live group updates.
    useLastKnown<Group[]>("/groups", (cached) => setGroups(cached));
    useLastKnown<{ tags: string[]; tagColors: Record<string, string> }>(
        "/addons/tags",
        (cached) => {
            setAddonTags(cached.tags || []);
            setAddonTagColors(cached.tagColors || {});
        }
    );

    // Fetch addons and groups
    useEffect(() => {
        const fetchData = async () => {
            setIsLoading(true);
            setError(null);
            try {
                const [addonsData, groupsData, tagsData] = await Promise.all([
                    api.getAddons(),
                    api.getGroups(),
                    api.getAddonTags().catch(() => ({ tagColors: {}, tags: [] })),
                ]);
                setAddons(addonsData);
                setGroups(groupsData);
                setAddonTags(tagsData.tags || []);
                setAddonTagColors(tagsData.tagColors || {});
            } catch (err) {
                setError(err as Error);
                toast.error("Failed to load addons");
            } finally {
                setIsLoading(false);
            }
        };

        fetchData();
    }, []);

    // Transform addons for display
    const addonsDisplay = useMemo<AddonDisplay[]>(() => {
        return addons.map((addon) => {
            const anyAddon = addon;
            // Count groups that use this addon (from API response)
            const groupCount =
                typeof anyAddon.groups === "number"
                    ? anyAddon.groups
                    : anyAddon.groups?.length || 0;

            // Extract logo - backend returns customLogo and manifest.logo
            // Priority: customLogo > manifest.logo > fallback icon service
            const logo =
                anyAddon.customLogo ||
                anyAddon.manifest?.logo ||
                addon.logo ||
                anyAddon.iconUrl ||
                (anyAddon.manifest?.id &&
                    `https://stremio-addon.netlify.app/${anyAddon.manifest.id}/icon.png`) ||
                undefined;

            return {
                catalogs: addon.catalogs || [],
                customTag: anyAddon.customTag || null,
                description: addon.description,
                groupCount,
                healthCheckError: addon.healthCheckError,
                id: addon.id,
                isActive: anyAddon.isActive !== false, // Default to true if not specified
                isOnline: addon.isOnline,
                isProtected: !!anyAddon.isProtected,
                lastHealthCheck: addon.lastHealthCheck,
                logo,
                manifestUrl: addon.manifestUrl,
                name: addon.name || "Unnamed Addon",
                resources: addon.resources || [],
                userCount: anyAddon.users || 0, // Get from API response
                version: addon.version,
            };
        });
    }, [addons]);

    const filteredAddons = addonsDisplay.filter((addon) => {
        // Search filter
        const matchesSearch =
            addon.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
            addon.description?.toLowerCase().includes(searchQuery.toLowerCase());

        if (!matchesSearch) {
            return false;
        }

        // Custom-tag filter — ANDs with the built-in category filter below.
        if (activeTag && addon.customTag !== activeTag) {
            return false;
        }

        // Category filter
        if (activeFilter === "all") {
            return true;
        }
        if (activeFilter === "protected") {
            return addon.isProtected;
        }
        if (activeFilter === "stream") {
            return addon.resources.includes("stream");
        }
        if (activeFilter === "catalogs") {
            return addon.catalogs.length > 0;
        }
        if (activeFilter === "subtitles") {
            return addon.resources.includes("subtitles");
        }
        if (activeFilter === "online") {
            return addon.isOnline === true;
        }
        if (activeFilter === "offline") {
            return addon.isOnline === false;
        }

        return true;
    });

    const protectedCount = addonsDisplay.filter((a) => a.isProtected).length;
    // Nebula's stat row - real total from the same addonsDisplay data already rendered.
    const totalAddonAssignments = addonsDisplay.reduce((sum, a) => sum + (a.userCount || 0), 0);

    const toggleSelect = useCallback((id: string) => {
        setSelectedIds((prev) => {
            const next = new Set(prev);
            if (next.has(id)) {
                next.delete(id);
            } else {
                next.add(id);
            }
            return next;
        });
    }, []);

    const selectAll = useCallback(() => {
        setSelectedIds(new Set(filteredAddons.map((a) => a.id)));
    }, [filteredAddons]);

    const deselectAll = useCallback(() => {
        setSelectedIds(new Set());
    }, []);

    const handleReloadSelected = useCallback(async () => {
        setIsReloading(true);
        const ids = Array.from(selectedIds);
        let success = 0;

        for (const id of ids) {
            try {
                await api.reloadAddon(id);
                success++;
            } catch (err) {
                console.error("Failed to reload addon:", err);
            }
        }

        setIsReloading(false);
        if (success > 0) {
            toast.success(`Reloaded ${success} addon${success === 1 ? "" : "s"} successfully`);
        }
        setSelectedIds(new Set());
        // Refresh addons
        try {
            const addonsData = await api.getAddons();
            setAddons(addonsData);
        } catch (err) {
            console.error("Failed to refresh addons:", err);
        }
    }, [selectedIds]);

    const handleDeleteSelected = useCallback(async () => {
        setIsDeleting(true);
        const ids = Array.from(selectedIds);
        let success = 0;

        for (const id of ids) {
            try {
                await api.deleteAddon(id);
                success++;
            } catch (err) {
                console.error("Failed to delete addon:", err);
            }
        }

        setIsDeleting(false);
        setIsDeleteModalOpen(false);
        if (success > 0) {
            toast.success(`Deleted ${success} addon${success === 1 ? "" : "s"} successfully`);
            // Refresh addons
            try {
                const addonsData = await api.getAddons();
                setAddons(addonsData);
            } catch (err) {
                console.error("Failed to refresh addons:", err);
            }
        }
        setSelectedIds(new Set());
    }, [selectedIds]);

    // Delete single addon (from quick action menu)
    const handleDeleteSingle = useCallback(async () => {
        if (!deleteTarget) {
            return;
        }
        setIsDeleting(true);
        try {
            const delRes = await api.deleteAddon(deleteTarget.id);
            showDeletedWithUndo(deleteTarget.name, delRes?.trashId, async () => {
                try {
                    setAddons(await api.getAddons());
                } catch {
                    /* list refresh is best-effort */
                }
            });
            // Refresh addons
            try {
                const addonsData = await api.getAddons();
                setAddons(addonsData);
            } catch (err) {
                console.error("Failed to refresh addons:", err);
            }
        } catch (err) {
            toast.error(`Failed to delete ${deleteTarget.name}`);
            console.error("Failed to delete addon:", err);
        } finally {
            setIsDeleting(false);
            setDeleteTarget(null);
        }
    }, [deleteTarget]);

    const hasSelection = selectedIds.size > 0;

    // Drag an addon card onto the "Protected" filter tab to protect it (see
    // routes/addons.js's /:id/protect for why this is account-wide, not
    // per-user). Optimistic local flip, revert on failure.
    const handleToggleProtect = useCallback(async (addon: AddonDisplay, next: boolean) => {
        setAddons((prev) => prev.map((a) => (a.id === addon.id ? { ...a, isProtected: next } : a)));
        try {
            await api.setAddonProtected(addon.id, next);
            toast.success(next ? `Protected "${addon.name}"` : `Unprotected "${addon.name}"`);
        } catch (err) {
            setAddons((prev) =>
                prev.map((a) => (a.id === addon.id ? { ...a, isProtected: !next } : a))
            );
            toast.error(readErrorMessage(err, "Failed to update protection"));
        }
    }, []);

    // Drag an addon card onto a tag pill to tag it (or clear via context menu).
    const handleSetTag = useCallback(async (addon: AddonDisplay, tag: string | null) => {
        const previous = addon.customTag;
        setAddons((prev) => prev.map((a) => (a.id === addon.id ? { ...a, customTag: tag } : a)));
        try {
            await api.setAddonTag(addon.id, tag);
            toast.success(
                tag ? `Tagged "${addon.name}" as ${tag}` : `Removed tag from "${addon.name}"`
            );
        } catch (err) {
            setAddons((prev) =>
                prev.map((a) => (a.id === addon.id ? { ...a, customTag: previous } : a))
            );
            toast.error(readErrorMessage(err, "Failed to update tag"));
        }
    }, []);

    const handleCreateTag = useCallback(async () => {
        const name = newTagName.trim();
        if (!name) {
            return;
        }
        try {
            const result = await api.createAddonTag(name);
            setAddonTags(result.tags);
            setNewTagName("");
            setIsAddingTag(false);
            toast.success(`Created tag "${name}"`);
        } catch (err) {
            toast.error(readErrorMessage(err, "Failed to create tag"));
        }
    }, [newTagName]);

    // Used by the card's own right-click "Label" submenu when the label you
    // want doesn't exist in the catalog yet — creates it AND assigns it to
    // this addon in one step, so finishing the flow always leaves the addon
    // labeled (rather than creating an orphan tag nobody's wearing).
    const handleCreateAndSetTag = useCallback(
        async (addon: AddonDisplay, name: string) => {
            const trimmed = name.trim();
            if (!trimmed) {
                return;
            }
            try {
                const result = await api.createAddonTag(trimmed);
                setAddonTags(result.tags);
                // Server dedupes case-insensitively — resolve to whatever form is
                // actually stored so re-typing an existing tag with different casing
                // still assigns the canonical one instead of a near-duplicate.
                const canonical =
                    result.tags.find((t: string) => t.toLowerCase() === trimmed.toLowerCase()) ||
                    trimmed;
                await handleSetTag(addon, canonical);
            } catch (err) {
                toast.error(readErrorMessage(err, "Failed to create label"));
            }
        },
        [handleSetTag]
    );

    const handleDeleteTag = useCallback(
        async (name: string) => {
            try {
                const result = await api.deleteAddonTag(name);
                setAddonTags(result.tags);
                setAddonTagColors((prev) => {
                    const next = { ...prev };
                    delete next[name];
                    return next;
                });
                // Any addon that had this tag just lost it server-side — reflect locally.
                setAddons((prev) =>
                    prev.map((a) => (a.customTag === name ? { ...a, customTag: null } : a))
                );
                if (activeTag === name) {
                    setActiveTag(null);
                }
                toast.success(`Deleted tag "${name}"`);
            } catch (err) {
                toast.error(readErrorMessage(err, "Failed to delete tag"));
            }
        },
        [activeTag]
    );

    // Optimistic color update for a tag pill — cosmetic-only server call, so a
    // failure just reverts the swatch rather than needing a toast every time.
    const handleSetTagColor = useCallback(
        async (name: string, color: string | null) => {
            const previous = addonTagColors[name];
            setAddonTagColors((prev) => {
                const next = { ...prev };
                if (color) {
                    next[name] = color;
                } else {
                    delete next[name];
                }
                return next;
            });
            try {
                await api.setAddonTagColor(name, color);
            } catch (err) {
                setAddonTagColors((prev) => {
                    const next = { ...prev };
                    if (previous) {
                        next[name] = previous;
                    } else {
                        delete next[name];
                    }
                    return next;
                });
                toast.error(readErrorMessage(err, "Failed to set label color"));
            }
        },
        [addonTagColors]
    );

    // Register this page's drag-end logic with the layout-level DndContext,
    // same shared mechanism Vault already uses. Handles three drop kinds:
    // onto the "Protected" filter tab, onto a custom-tag pill, or onto
    // another addon card (same-list reorder, the original behavior).
    const { registerDragEndHandler } = useVaultDrag();
    useEffect(() => {
        const handleDragEnd = (event: DragEndEvent) => {
            const { active, over } = event;
            if (!over) {
                return;
            }

            const entry = filteredAddons.find((a) => a.id === active.id);

            if (typeof over.id === "string" && over.id === "addon-filter-protected") {
                if (entry) {
                    handleToggleProtect(entry, true);
                }
                return;
            }
            // Every other built-in filter tab (all/stream/catalogs/subtitles/
            // online/offline) is a computed, non-assignable property — dropping
            // there is a deliberate no-op, same precedent as Vault's "all" tab.
            if (typeof over.id === "string" && over.id.startsWith("addon-filter-")) {
                return;
            }

            if (typeof over.id === "string" && over.id.startsWith("addon-tag-")) {
                const tag = decodeURIComponent(over.id.replace("addon-tag-", ""));
                if (entry) {
                    handleSetTag(entry, tag);
                }
                return;
            }

            if (active.id === over.id) {
                return;
            }
            const oldIndex = filteredAddons.findIndex((a) => a.id === active.id);
            const newIndex = filteredAddons.findIndex((a) => a.id === over.id);
            if (oldIndex === -1 || newIndex === -1) {
                return;
            }
            // Only extract the ID order from filteredAddons (an AddonDisplay[]
            // transform, not the same type as the raw Addon[] state) - the
            // actual Addon objects get looked up from prev inside setAddons,
            // where the real type is properly preserved.
            const reorderedIds = filteredAddons.map((a) => a.id);
            const [movedId] = reorderedIds.splice(oldIndex, 1);
            reorderedIds.splice(newIndex, 0, movedId);
            setAddons((prev) => {
                const byId = new Map(prev.map((a) => [a.id, a]));
                const reorderedAddons = reorderedIds
                    .map((id) => byId.get(id))
                    .filter((a): a is Addon => !!a);
                const rest = prev.filter((a) => !reorderedIds.includes(a.id));
                return [...reorderedAddons, ...rest];
            });
            api.reorderAddons(reorderedIds).catch((err: unknown) => {
                toast.error(readErrorMessage(err, "Failed to save new order"));
            });
        };
        return registerDragEndHandler(handleDragEnd);
    }, [filteredAddons, registerDragEndHandler, handleToggleProtect, handleSetTag]);

    const handleReloadAllAddons = async () => {
        setIsReloading(true);
        try {
            const addonIds = addons.map((a) => a.id);
            let success = 0;
            for (const id of addonIds) {
                try {
                    await api.reloadAddon(id);
                    success++;
                } catch (err) {
                    console.error("Failed to reload addon:", err);
                }
            }
            if (success > 0) {
                toast.success(`Reloaded ${success} addon${success === 1 ? "" : "s"} successfully`);
            }
            const addonsData = await api.getAddons();
            setAddons(addonsData);
        } catch (err) {
            toast.error(readErrorMessage(err, "Failed to reload all addons"));
        } finally {
            setIsReloading(false);
        }
    };

    const reloadAllButtonInner = (
        <Button
            disabled={isReloading}
            leftIcon={<ArrowPathIcon className={`h-5 w-5 ${isReloading ? "animate-spin" : ""}`} />}
            onClick={handleReloadAllAddons}
            variant="secondary"
        >
            {isReloading ? "Reloading..." : "Reload All"}
        </Button>
    );
    const reloadAllButton = isTV ? (
        <TVFocusable onEnterPress={handleReloadAllAddons}>{reloadAllButtonInner}</TVFocusable>
    ) : (
        reloadAllButtonInner
    );

    return (
        <Wrapper>
            <Head>
                <title>SlickSync - Addons</title>
            </Head>
            {layoutMode !== "nebula" && (
                <Header
                    actions={reloadAllButton}
                    subtitle={
                        isLoading
                            ? "Loading..."
                            : `${addons.length} addon${addons.length === 1 ? "" : "s"} • ${protectedCount} protected`
                    }
                    title="Addons"
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
                            actions={reloadAllButton}
                            stats={
                                isMobile ? (
                                    <NebulaHeaderStats
                                        stats={[
                                            {
                                                icon: (
                                                    <PuzzlePieceIcon className="h-4 w-4 md:h-6 md:w-6" />
                                                ),
                                                label: "Total Addons",
                                                value: isLoading ? "..." : addons.length,
                                            },
                                            {
                                                icon: (
                                                    <ShieldCheckIcon className="h-4 w-4 md:h-6 md:w-6" />
                                                ),
                                                label: "Protected",
                                                value: isLoading ? "..." : protectedCount,
                                            },
                                            {
                                                icon: (
                                                    <UsersIcon className="h-4 w-4 md:h-6 md:w-6" />
                                                ),
                                                label: "Assignments",
                                                value: isLoading ? "..." : totalAddonAssignments,
                                            },
                                        ]}
                                    />
                                ) : undefined
                            }
                            subtitle={
                                isLoading
                                    ? "Loading..."
                                    : `${addons.length} addon${addons.length === 1 ? "" : "s"} • ${protectedCount} protected`
                            }
                            title="Addons"
                        />
                    )}
                    {layoutMode === "nebula" && !isMobile && (
                        <div className="mb-5 grid grid-cols-3 gap-2 sm:gap-4">
                            <NebulaCompactStatCard
                                colorIndex={0}
                                icon={<PuzzlePieceIcon className="h-4 w-4 md:h-6 md:w-6" />}
                                label="Total Addons"
                                value={isLoading ? "..." : addons.length}
                            />
                            <NebulaCompactStatCard
                                colorIndex={1}
                                icon={<ShieldCheckIcon className="h-4 w-4 md:h-6 md:w-6" />}
                                label="Protected"
                                value={isLoading ? "..." : protectedCount}
                            />
                            <NebulaCompactStatCard
                                colorIndex={0}
                                icon={<UsersIcon className="h-4 w-4 md:h-6 md:w-6" />}
                                label="Assignments"
                                value={isLoading ? "..." : totalAddonAssignments}
                            />
                        </div>
                    )}
                    <div className="interface-management-content">
                        {layoutMode === "nebula" && <NebulaGlassStripe />}
                        {/* Filters */}
                        <PageToolbar
                            filterTabs={{
                                activeKey: activeFilter,
                                dropTargetPrefix: "addon-filter-",
                                // Drag a card onto "Protected" to protect it account-wide; the
                                // other tabs are computed/non-assignable and silently ignore
                                // drops (see handleDragEnd). 'all' still needs to be listed even
                                // though it's a no-op target, so dropping there doesn't fall
                                // through to reorder logic against a mismatched id.
                                enableDropTargets: true,
                                fill: true,
                                layoutId: "addons-filter-tabs",
                                onChange: setActiveFilter,
                                options: [
                                    { key: "all", label: "All" },
                                    { key: "protected", label: "Protected" },
                                    { key: "stream", label: "Streams" },
                                    { key: "catalogs", label: "Catalogs" },
                                    { key: "subtitles", label: "Subtitles" },
                                    { key: "online", label: "Online" },
                                    { key: "offline", label: "Offline" },
                                ],
                            }}
                            primaryAction={(() => {
                                const btn = (
                                    <div className="flex gap-2">
                                        {/* Browse comes first: pasting a manifest URL assumes you
                    already found one somewhere, which is the harder path for
                    anyone who isn't already deep in the ecosystem.
                    Labels collapse to icons under sm so both actions still
                    fit a phone toolbar rather than one of them wrapping or
                    being dropped. */}
                                        <Button
                                            aria-label="Browse addon directory"
                                            leftIcon={<MagnifyingGlassIcon className="h-5 w-5" />}
                                            onClick={() => setIsDirectoryOpen(true)}
                                            title="Browse addon directory"
                                            variant="secondary"
                                        >
                                            <span className="hidden sm:inline">Browse</span>
                                        </Button>
                                        <Button
                                            aria-label="Add addon"
                                            leftIcon={<PlusIcon className="h-5 w-5" />}
                                            onClick={() => setIsAddModalOpen(true)}
                                            title="Add addon"
                                            variant="primary"
                                        >
                                            <span className="hidden sm:inline">Add</span>
                                        </Button>
                                    </div>
                                );
                                return isTV ? (
                                    <TVFocusable onEnterPress={() => setIsAddModalOpen(true)}>
                                        {btn}
                                    </TVFocusable>
                                ) : (
                                    btn
                                );
                            })()}
                            searchConfig={{
                                onChange: setSearchQuery,
                                placeholder: "Search addons...",
                                value: searchQuery,
                            }}
                            selectionConfig={{
                                onDeselectAll: deselectAll,
                                onSelectAll: selectAll,
                                selectedCount: selectedIds.size,
                                totalCount: filteredAddons.length,
                            }}
                        />

                        <BeginnerHint guideId="addons-overview">
                            Addons are the sources your users stream from. Add one here, then assign
                            it to a user or a group - assigning is what actually pushes it to their
                            Stremio or Nuvio account.
                        </BeginnerHint>

                        {/* Custom tag pills — drag an addon card onto one to tag it (or click
            to filter by it). Own row below the built-in filter tabs since
            these are user-created, not computed properties. */}
                        <div className="mb-6 flex flex-wrap items-center gap-2">
                            <TagIcon className="h-4 w-4 shrink-0 text-subtle" />
                            {addonTags.map((tag) => (
                                <TagPill
                                    color={addonTagColors[tag]}
                                    isActive={activeTag === tag}
                                    key={tag}
                                    onClick={() =>
                                        setActiveTag((prev) => (prev === tag ? null : tag))
                                    }
                                    onColorChange={(color) => handleSetTagColor(tag, color)}
                                    onDelete={() => setDeleteTagTarget(tag)}
                                    tag={tag}
                                />
                            ))}
                            {isAddingTag ? (
                                <div className="flex items-center gap-1">
                                    <input
                                        autoFocus
                                        className="input-base w-28 px-2.5 py-1 text-xs"
                                        maxLength={40}
                                        onBlur={() => {
                                            if (!newTagName.trim()) {
                                                setIsAddingTag(false);
                                            }
                                        }}
                                        onChange={(e) => setNewTagName(e.target.value)}
                                        onKeyDown={(e) => {
                                            if (e.key === "Enter") {
                                                handleCreateTag();
                                            }
                                            if (e.key === "Escape") {
                                                setIsAddingTag(false);
                                                setNewTagName("");
                                            }
                                        }}
                                        placeholder="Tag name…"
                                        value={newTagName}
                                    />
                                    <button
                                        aria-label="Create tag"
                                        className="rounded-md p-1 text-success transition-colors hover:bg-success-muted"
                                        onClick={handleCreateTag}
                                        type="button"
                                    >
                                        <CheckIcon className="h-3.5 w-3.5" />
                                    </button>
                                </div>
                            ) : (
                                <button
                                    className="nav-item-hover-pill flex items-center gap-1 rounded-full border border-default border-dashed px-2.5 py-1 font-medium text-muted text-xs transition-colors"
                                    onClick={() => setIsAddingTag(true)}
                                    type="button"
                                >
                                    <PlusIcon className="h-3.5 w-3.5" />
                                    New Tag
                                </button>
                            )}
                        </div>

                        {/* Loading state */}
                        {isLoading ? (
                            <div className="py-16 text-center">
                                <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-surface-hover">
                                    <div className="h-8 w-8 animate-spin rounded-full border-2 border-current border-t-transparent text-primary" />
                                </div>
                                <p className="text-muted">Loading addons...</p>
                            </div>
                        ) : error ? (
                            <div className="py-16 text-center">
                                <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-surface-hover">
                                    <XMarkIcon className="h-8 w-8 text-error" />
                                </div>
                                <h3 className="mb-2 font-medium text-default text-lg">
                                    Error Loading Addons
                                </h3>
                                <p className="mb-4 text-muted">{error.message}</p>
                                <Button onClick={() => window.location.reload()} variant="primary">
                                    Retry
                                </Button>
                            </div>
                        ) : (
                            <>
                                {/* Addons Grid/List */}
                                <LayoutGroup>
                                    <AnimatePresence mode="popLayout">
                                        {viewMode === "grid" ? (
                                            <StaggerContainer
                                                className="grid grid-cols-1 gap-6 md:grid-cols-2 xl:grid-cols-3"
                                                key="grid"
                                            >
                                                <AnimatePresence mode="popLayout">
                                                    <SortableContext
                                                        items={filteredAddons.map((a) => a.id)}
                                                        strategy={rectSortingStrategy}
                                                    >
                                                        {filteredAddons.map((addon) => (
                                                            <SortableAddonWrapper
                                                                id={addon.id}
                                                                key={addon.id}
                                                            >
                                                                {(dragHandleProps) => (
                                                                    <StaggerItem>
                                                                        <AddonCard
                                                                            addon={addon}
                                                                            addonTagColors={
                                                                                addonTagColors
                                                                            }
                                                                            addonTags={addonTags}
                                                                            dragHandleProps={
                                                                                dragHandleProps
                                                                            }
                                                                            focusable={isTV}
                                                                            isSelected={selectedIds.has(
                                                                                addon.id
                                                                            )}
                                                                            onClearTag={() =>
                                                                                handleSetTag(
                                                                                    addon,
                                                                                    null
                                                                                )
                                                                            }
                                                                            onClone={() =>
                                                                                setCloneTarget(
                                                                                    addon
                                                                                )
                                                                            }
                                                                            onCreateLabel={(name) =>
                                                                                handleCreateAndSetTag(
                                                                                    addon,
                                                                                    name
                                                                                )
                                                                            }
                                                                            onDelete={() =>
                                                                                setDeleteTarget(
                                                                                    addon
                                                                                )
                                                                            }
                                                                            onMoveToVault={() =>
                                                                                setMoveToVaultTarget(
                                                                                    addon
                                                                                )
                                                                            }
                                                                            onSetTag={(tag) =>
                                                                                handleSetTag(
                                                                                    addon,
                                                                                    tag
                                                                                )
                                                                            }
                                                                            onToggleProtect={(
                                                                                next
                                                                            ) =>
                                                                                handleToggleProtect(
                                                                                    addon,
                                                                                    next
                                                                                )
                                                                            }
                                                                            onToggleSelect={() =>
                                                                                toggleSelect(
                                                                                    addon.id
                                                                                )
                                                                            }
                                                                            onToggleStatus={(
                                                                                addonId,
                                                                                newStatus
                                                                            ) => {
                                                                                setAddons((prev) =>
                                                                                    prev.map((a) =>
                                                                                        a.id ===
                                                                                        addonId
                                                                                            ? {
                                                                                                  ...a,
                                                                                                  isActive:
                                                                                                      newStatus,
                                                                                              }
                                                                                            : a
                                                                                    )
                                                                                );
                                                                            }}
                                                                            sharedPeers={sharedPeers.get(
                                                                                addon.id
                                                                            )}
                                                                        />
                                                                    </StaggerItem>
                                                                )}
                                                            </SortableAddonWrapper>
                                                        ))}
                                                    </SortableContext>
                                                </AnimatePresence>
                                            </StaggerContainer>
                                        ) : (
                                            <motion.div
                                                animate={{ opacity: 1 }}
                                                className="space-y-3"
                                                exit={{ opacity: 0 }}
                                                initial={{ opacity: 0 }}
                                                key="list"
                                                layout
                                            >
                                                <AnimatePresence mode="popLayout">
                                                    <SortableContext
                                                        items={filteredAddons.map((a) => a.id)}
                                                        strategy={verticalListSortingStrategy}
                                                    >
                                                        {filteredAddons.map((addon) => (
                                                            <SortableAddonWrapper
                                                                id={addon.id}
                                                                key={addon.id}
                                                            >
                                                                {(dragHandleProps) => (
                                                                    <AddonCard
                                                                        addon={addon}
                                                                        addonTagColors={
                                                                            addonTagColors
                                                                        }
                                                                        addonTags={addonTags}
                                                                        dragHandleProps={
                                                                            dragHandleProps
                                                                        }
                                                                        focusable={isTV}
                                                                        isSelected={selectedIds.has(
                                                                            addon.id
                                                                        )}
                                                                        layout="row"
                                                                        onClearTag={() =>
                                                                            handleSetTag(
                                                                                addon,
                                                                                null
                                                                            )
                                                                        }
                                                                        onClone={() =>
                                                                            setCloneTarget(addon)
                                                                        }
                                                                        onCreateLabel={(name) =>
                                                                            handleCreateAndSetTag(
                                                                                addon,
                                                                                name
                                                                            )
                                                                        }
                                                                        onDelete={() =>
                                                                            setDeleteTarget(addon)
                                                                        }
                                                                        onMoveToVault={() =>
                                                                            setMoveToVaultTarget(
                                                                                addon
                                                                            )
                                                                        }
                                                                        onSetTag={(tag) =>
                                                                            handleSetTag(addon, tag)
                                                                        }
                                                                        onToggleProtect={(next) =>
                                                                            handleToggleProtect(
                                                                                addon,
                                                                                next
                                                                            )
                                                                        }
                                                                        onToggleSelect={() =>
                                                                            toggleSelect(addon.id)
                                                                        }
                                                                        onToggleStatus={(
                                                                            addonId,
                                                                            newStatus
                                                                        ) => {
                                                                            setAddons((prev) =>
                                                                                prev.map((a) =>
                                                                                    a.id === addonId
                                                                                        ? {
                                                                                              ...a,
                                                                                              isActive:
                                                                                                  newStatus,
                                                                                          }
                                                                                        : a
                                                                                )
                                                                            );
                                                                        }}
                                                                        sharedPeers={sharedPeers.get(
                                                                            addon.id
                                                                        )}
                                                                    />
                                                                )}
                                                            </SortableAddonWrapper>
                                                        ))}
                                                    </SortableContext>
                                                </AnimatePresence>
                                            </motion.div>
                                        )}
                                    </AnimatePresence>
                                </LayoutGroup>

                                {/* Empty state */}
                                {filteredAddons.length === 0 && (
                                    <motion.div
                                        animate={{ opacity: 1, scale: 1 }}
                                        className="py-16 text-center"
                                        initial={{ opacity: 0, scale: 0.95 }}
                                    >
                                        <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-surface-hover">
                                            <PuzzlePieceIcon className="h-8 w-8 text-subtle" />
                                        </div>
                                        <h3 className="mb-2 font-medium text-default text-lg">
                                            No addons found
                                        </h3>
                                        <p className="mb-6 text-muted">
                                            {searchQuery
                                                ? "Try adjusting your search"
                                                : "Get started by adding your first addon"}
                                        </p>
                                        {!searchQuery && (
                                            <Button
                                                onClick={() => setIsAddModalOpen(true)}
                                                variant="primary"
                                            >
                                                Add Addon
                                            </Button>
                                        )}
                                    </motion.div>
                                )}
                            </>
                        )}
                    </div>
                </div>
            </div>

            {/* Floating Action Bar */}
            <AnimatePresence>
                {hasSelection && (
                    <motion.div
                        animate={{ opacity: 1, y: 0 }}
                        className="fixed bottom-8 left-1/2 z-50 max-w-[calc(100vw-2rem)] -translate-x-1/2"
                        exit={{ opacity: 0, y: 100 }}
                        initial={{ opacity: 0, y: 100 }}
                    >
                        {/* flex-wrap + justify-center: 3 action buttons (Reload/Move to
                Vault/Delete) plus the count badge and close button is wide
                enough to run off both edges of a phone screen at once, since
                this bar is position:fixed and centered - unlike a normal-flow
                overflow there's no scroll to reach the clipped buttons at
                all. Confirmed live: Delete and the close button were
                completely unreachable on a 375px viewport before this.
                Groups/Users' bars only have 2 short-label buttons and fit
                without wrapping (verified live), so left as-is. */}
                        <div className="flex flex-wrap items-center justify-center gap-4 rounded-2xl border border-default bg-surface px-6 py-4 shadow-2xl backdrop-blur-xl">
                            <div className="flex items-center gap-2 border-default border-r pr-4">
                                <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary-muted">
                                    <span className="font-bold text-primary text-sm">
                                        {selectedIds.size}
                                    </span>
                                </div>
                                <span className="text-muted text-sm">selected</span>
                            </div>

                            <div className="flex flex-wrap items-center justify-center gap-2">
                                <Button
                                    isLoading={isReloading}
                                    leftIcon={
                                        <ArrowPathIcon
                                            className={`h-4 w-4 ${isReloading ? "animate-spin" : ""}`}
                                        />
                                    }
                                    onClick={handleReloadSelected}
                                    size="sm"
                                    variant="secondary"
                                >
                                    Reload
                                </Button>
                                <Button
                                    leftIcon={<ShieldCheckIcon className="h-4 w-4" />}
                                    onClick={() => setIsBulkMoveToVaultOpen(true)}
                                    size="sm"
                                    variant="secondary"
                                >
                                    Move to Vault
                                </Button>
                                <Button
                                    leftIcon={<TrashIcon className="h-4 w-4" />}
                                    onClick={() => setIsDeleteModalOpen(true)}
                                    size="sm"
                                    variant="danger"
                                >
                                    Delete
                                </Button>
                            </div>

                            <button
                                className="rounded-lg p-2 text-muted transition-colors hover:bg-surface-hover"
                                onClick={deselectAll}
                                type="button"
                            >
                                <XMarkIcon className="h-5 w-5" />
                            </button>
                        </div>
                    </motion.div>
                )}
            </AnimatePresence>

            {/* Floating Add Button - Mobile Only */}
            <button
                aria-label="Add addon"
                className="nav-item-hover-pill fixed right-4 bottom-4 z-50 flex h-14 w-14 items-center justify-center rounded-full border border-default bg-surface shadow-lg lg:hidden"
                onClick={() => setIsAddModalOpen(true)}
                style={{
                    boxShadow:
                        "0 10px 25px -5px rgba(0, 0, 0, 0.2), 0 8px 10px -6px rgba(0, 0, 0, 0.1)",
                }}
                type="button"
            >
                <PlusIcon className="h-6 w-6" />
            </button>

            {/* Browse the public addon directory - see AddonDirectoryModal */}
            <AddonDirectoryModal
                isOpen={isDirectoryOpen}
                onAdded={async () => {
                    try {
                        setAddons(await api.getAddons());
                    } catch (err) {
                        console.error("Failed to refresh addons after directory add:", err);
                    }
                }}
                onClose={() => setIsDirectoryOpen(false)}
            />

            {/* Add Addon Modal */}
            <AddAddonModal
                groups={groups}
                isOpen={isAddModalOpen}
                onClose={() => setIsAddModalOpen(false)}
            />

            {/* Delete Confirmation Modal (bulk) */}
            <ConfirmModal
                confirmText={isDeleting ? "Deleting..." : "Delete Addons"}
                description={`Are you sure you want to delete ${selectedIds.size} addon${selectedIds.size === 1 ? "" : "s"}? This action cannot be undone.`}
                isLoading={isDeleting}
                isOpen={isDeleteModalOpen}
                onClose={() => setIsDeleteModalOpen(false)}
                onConfirm={handleDeleteSelected}
                title="Delete Addons"
                variant="danger"
            />

            {/* Delete Confirmation Modal (single) */}
            <ConfirmModal
                confirmText={isDeleting ? "Deleting..." : "Delete Addon"}
                description={`Are you sure you want to delete "${deleteTarget?.name}"? This action cannot be undone.`}
                isLoading={isDeleting}
                isOpen={!!deleteTarget}
                onClose={() => setDeleteTarget(null)}
                onConfirm={handleDeleteSingle}
                title="Delete Addon"
                variant="danger"
            />

            {/* Delete Tag Confirmation Modal */}
            <ConfirmModal
                confirmText="Delete Tag"
                description={`Delete the "${deleteTagTarget}" tag? Any addon currently tagged with it will become untagged.`}
                isOpen={!!deleteTagTarget}
                onClose={() => setDeleteTagTarget(null)}
                onConfirm={() => {
                    if (deleteTagTarget) {
                        handleDeleteTag(deleteTagTarget);
                        setDeleteTagTarget(null);
                    }
                }}
                title="Delete Tag"
                variant="danger"
            />

            {/* Clone Addon Modal */}
            <Modal
                description={`Create a copy of "${cloneTarget?.name}"`}
                isOpen={!!cloneTarget}
                onClose={() => setCloneTarget(null)}
                size="md"
                title="Clone Addon"
            >
                {cloneTarget && (
                    <CloneAddonForm addon={cloneTarget} onClose={() => setCloneTarget(null)} />
                )}
            </Modal>

            {/* Move to Vault Modal */}
            <Modal
                description={`This removes "${moveToVaultTarget?.name}" from Addons and creates a tracked Vault entry with its manifest URL instead. If it's currently assigned to any group, it will be removed from there too.`}
                isOpen={!!moveToVaultTarget}
                onClose={() => setMoveToVaultTarget(null)}
                size="md"
                title="Move to Vault"
            >
                <div className="space-y-4">
                    <div>
                        <label
                            className="mb-2 block font-medium text-sm"
                            htmlFor={`${fieldId1}-1`}
                            style={{ color: "var(--color-text-muted)" }}
                        >
                            Vault category
                        </label>
                        <select
                            className="w-full rounded-xl px-4 py-3 focus:outline-none"
                            id={`${fieldId1}-1`}
                            onChange={(e) => setMoveToVaultCategory(e.target.value)}
                            style={{
                                background: "var(--color-surface-hover)",
                                border: "1px solid var(--color-surface-border)",
                                color: "var(--color-text)",
                            }}
                            value={moveToVaultCategory}
                        >
                            {ADDON_VAULT_CATEGORIES.map(({ value, label }) => (
                                <option key={value} value={value}>
                                    {label}
                                </option>
                            ))}
                        </select>
                    </div>
                    <div className="flex justify-end gap-3">
                        <Button onClick={() => setMoveToVaultTarget(null)} variant="secondary">
                            Cancel
                        </Button>
                        <Button
                            disabled={isMovingToVault}
                            onClick={async () => {
                                if (!moveToVaultTarget) {
                                    return;
                                }
                                setIsMovingToVault(true);
                                try {
                                    const result = await api.moveAddonToVault(
                                        moveToVaultTarget.id,
                                        moveToVaultCategory
                                    );
                                    toast.success(
                                        result.removedFromGroups > 0
                                            ? `Moved to Vault (removed from ${result.removedFromGroups} group${result.removedFromGroups === 1 ? "" : "s"})`
                                            : "Moved to Vault"
                                    );
                                    setAddons((prev) =>
                                        prev.filter((a) => a.id !== moveToVaultTarget.id)
                                    );
                                    setMoveToVaultTarget(null);
                                } catch (err) {
                                    toast.error(
                                        readErrorMessage(err, "Failed to move addon to Vault")
                                    );
                                } finally {
                                    setIsMovingToVault(false);
                                }
                            }}
                        >
                            {isMovingToVault ? "Moving..." : "Move to Vault"}
                        </Button>
                    </div>
                </div>
            </Modal>

            {/* Bulk Move to Vault Modal */}
            <Modal
                description={`Move ${selectedIds.size} selected addon${selectedIds.size === 1 ? "" : "s"} to Vault? Each becomes a tracked credential entry with its manifest URL, and is removed from Addons (and any groups it's assigned to).`}
                isOpen={isBulkMoveToVaultOpen}
                onClose={() => setIsBulkMoveToVaultOpen(false)}
                size="md"
                title="Move to Vault"
            >
                <div className="space-y-4">
                    <div>
                        <label
                            className="mb-2 block font-medium text-sm"
                            htmlFor={`${fieldId1}-2`}
                            style={{ color: "var(--color-text-muted)" }}
                        >
                            Vault category
                        </label>
                        <select
                            className="w-full rounded-xl px-4 py-3 focus:outline-none"
                            id={`${fieldId1}-2`}
                            onChange={(e) => setBulkMoveToVaultCategory(e.target.value)}
                            style={{
                                background: "var(--color-surface-hover)",
                                border: "1px solid var(--color-surface-border)",
                                color: "var(--color-text)",
                            }}
                            value={bulkMoveToVaultCategory}
                        >
                            {ADDON_VAULT_CATEGORIES.map(({ value, label }) => (
                                <option key={value} value={value}>
                                    {label}
                                </option>
                            ))}
                        </select>
                    </div>
                    <div className="flex justify-end gap-3">
                        <Button onClick={() => setIsBulkMoveToVaultOpen(false)} variant="secondary">
                            Cancel
                        </Button>
                        <Button
                            disabled={isBulkMovingToVault || selectedIds.size === 0}
                            onClick={async () => {
                                const ids = Array.from(selectedIds);
                                setIsBulkMovingToVault(true);
                                let succeeded = 0;
                                let failed = 0;
                                for (const id of ids) {
                                    try {
                                        await api.moveAddonToVault(id, bulkMoveToVaultCategory);
                                        succeeded++;
                                    } catch {
                                        failed++;
                                    }
                                }
                                // Refetch rather than optimistically patch local state — with partial
                                // failures possible across the loop, a fresh list is simpler and correct
                                try {
                                    const usersData = await api.getAddons();
                                    setAddons(usersData);
                                } catch {
                                    // Optional remote data does not prevent the current operation from completing.
                                }
                                deselectAll();
                                setIsBulkMovingToVault(false);
                                setIsBulkMoveToVaultOpen(false);
                                if (failed === 0) {
                                    toast.success(
                                        `Moved ${succeeded} addon${succeeded === 1 ? "" : "s"} to Vault`
                                    );
                                } else {
                                    toast.error(`Moved ${succeeded}, failed to move ${failed}`);
                                }
                            }}
                        >
                            {isBulkMovingToVault
                                ? "Moving..."
                                : `Move ${selectedIds.size} to Vault`}
                        </Button>
                    </div>
                </div>
            </Modal>
        </Wrapper>
    );
}

// Addon Card Component - single click opens, long press/right-click shows menu
function AddonCard({
    addon,
    isSelected,
    onToggleSelect,
    onDelete,
    onClone,
    onMoveToVault,
    onToggleStatus,
    onToggleProtect,
    onClearTag,
    addonTags,
    addonTagColors,
    onSetTag,
    onCreateLabel,
    focusable = false,
    dragHandleProps,
    layout = "grid",
    sharedPeers,
}: {
    addon: AddonDisplay;
    isSelected: boolean;
    onToggleSelect: () => void;
    onDelete: () => void;
    onClone: () => void;
    onMoveToVault: () => void;
    onToggleStatus?: (addonId: string, newStatus: boolean) => void;
    onToggleProtect?: (next: boolean) => void;
    onClearTag?: () => void;
    addonTags?: string[];
    addonTagColors?: Record<string, string>;
    onSetTag?: (tag: string) => void;
    onCreateLabel?: (name: string) => void;
    /** TV mode: wraps the card in a D-pad-focusable container, Enter/OK opens
     *  the same detail page a click would. */
    focusable?: boolean;
    /** Renders a dedicated grab handle (top-left) instead of the whole card
     *  being the drag target - real feedback (with a reference screenshot of
     *  the same pattern already used on the User detail page's own addon
     *  lists) that a bare draggable card with no visible affordance wasn't
     *  discoverable as reorderable at all. */
    dragHandleProps?: Record<string, unknown>;
    /** 'row' replaces the vertical card with a full-width horizontal row
     *  (icon, name, description, tags all in one line-flowing row) - the
     *  Addons page's "list view" used to be a spreadsheet-style table that
     *  truncated names at 200px, which real feedback said made it impossible
     *  to tell same-provider addons with long custom names apart. Full width
     *  means no truncation is needed. Same underlying state/handlers/context
     *  menu either way - only the presentational JSX differs. */
    layout?: "grid" | "row";
    /** Other addons opening the same saved configuration (lib/sharedConfig.ts). */
    sharedPeers?: SharedPeer[];
}) {
    const [_isReloading, setIsReloading] = useState(false);
    const { isOpen, position, handleContextMenu, close } = useContextMenu();
    const [showActions, setShowActions] = useState(false);
    // Long-press → context menu on mobile - a plain JS timer, not the DOM
    // `contextmenu` event, since iOS Safari doesn't reliably synthesize that
    // from a touch-and-hold the way desktop browsers do from a real
    // right-click (see useLongPress's own comment).
    const longPress = useLongPress({
        onLongPress: (e, x, y) => {
            setShowActions(true);
            handleContextMenu(e, x, y);
        },
    });
    // Context menu's "Label" item drills into a sub-view of the same menu
    // (existing labels to pick from + create-new) rather than opening a
    // separate modal — reset back to the main view whenever the menu closes.
    const [menuView, setMenuView] = useState<"main" | "label">("main");
    const [isCreatingLabel, setIsCreatingLabel] = useState(false);
    const [newLabelName, setNewLabelName] = useState("");
    useEffect(() => {
        if (!isOpen) {
            setMenuView("main");
            setIsCreatingLabel(false);
            setNewLabelName("");
        }
    }, [isOpen]);
    const submitNewLabel = () => {
        const name = newLabelName.trim();
        if (!name) {
            return;
        }
        onCreateLabel?.(name);
        setNewLabelName("");
        setIsCreatingLabel(false);
        close();
    };

    const handleReload = async (e: React.MouseEvent) => {
        e.stopPropagation();
        close();
        setIsReloading(true);
        try {
            await api.reloadAddon(addon.id);
            toast.success(`${addon.name} reloaded`);
        } catch (err) {
            toast.error(`Failed to reload ${addon.name}`);
            console.error("Failed to reload addon:", err);
        } finally {
            setIsReloading(false);
        }
    };

    // Single click opens detail page
    const handleClick = (e: React.MouseEvent) => {
        if (showActions) {
            setShowActions(false);
            return;
        }
        // If clicking a button, menu, or interactive element, navigate to detail
        if ((e.target as HTMLElement).closest("button")) {
            return;
        }
        window.location.href = `/addons/${addon.id}`;
    };

    const handleClone = (e: React.MouseEvent) => {
        e.stopPropagation();
        close();
        onClone();
    };

    const handleDelete = (e: React.MouseEvent) => {
        e.stopPropagation();
        close();
        onDelete();
    };

    const handleOpenConfigure = (e: React.MouseEvent) => {
        e.stopPropagation();
        const configUrl = getConfigureUrl(addon);
        if (configUrl) {
            window.open(configUrl, "_blank", "noopener,noreferrer");
        }
    };

    const configUrl = getConfigureUrl(addon);

    // The name wraps instead of being cut; its last word carries the status dot
    // (and, on a wide card, the version) so they never sit on a line alone.
    const nameWords = addon.name.split(" ");
    const nameLast = nameWords.pop() || "";
    const nameHead = nameWords.length ? `${nameWords.join(" ")} ` : "";
    const nameTail = (
        <span className="whitespace-nowrap">
            {nameLast}
            <span className="ml-2 inline-flex items-center gap-2 align-middle">
                {addon.lastHealthCheck && (
                    <span
                        className={`inline-block h-2 w-2 shrink-0 rounded-full ${addon.isOnline ? "bg-success" : "bg-error"}`}
                        title={
                            addon.isOnline
                                ? `Online - Last checked: ${new Date(addon.lastHealthCheck).toLocaleString()}`
                                : `Offline${addon.healthCheckError ? `: ${addon.healthCheckError}` : ""} - Last checked: ${new Date(addon.lastHealthCheck).toLocaleString()}`
                        }
                    />
                )}
                {addon.version && (
                    <VersionBadge
                        className="addon-card-wide"
                        size="sm"
                        version={addon.version.slice(0, 7)}
                    />
                )}
                {addon.isProtected && (
                    <ShieldCheckIcon className="h-5 w-5 shrink-0 text-success" title="Protected" />
                )}
            </span>
        </span>
    );
    const counts = (
        <>
            <span className="flex items-center gap-1.5">
                <UsersIcon className="h-4 w-4 text-secondary" />
                {addon.userCount || 0} user{addon.userCount === 1 ? "" : "s"}
            </span>
            <span className="flex items-center gap-1.5">
                <PuzzlePieceIcon className="h-4 w-4 text-secondary" />
                {addon.groupCount} group{addon.groupCount === 1 ? "" : "s"}
            </span>
        </>
    );
    const selectBox = (
        <div className="shrink-0" onClick={(e) => e.stopPropagation()} role="none">
            <SelectionCheckbox checked={isSelected} onChange={onToggleSelect} />
        </div>
    );

    // The label and Shared settings: on a phone they follow the version and
    // counts, everywhere else they lead the tags row - never a row of their own.
    const labelPills =
        addon.customTag || (sharedPeers && sharedPeers.length > 0) ? (
            <>
                {addon.customTag && (
                    <span
                        className="inline-flex items-center gap-1 rounded-full bg-primary-muted px-2 py-0.5 font-medium text-primary text-xs"
                        key={addonTagColors?.[addon.customTag] || "default"}
                        style={
                            addonTagColors?.[addon.customTag]
                                ? {
                                      background: `${addonTagColors[addon.customTag]}26`,
                                      color: addonTagColors[addon.customTag],
                                  }
                                : undefined
                        }
                        title={`Labeled "${addon.customTag}" — right-click to change or remove`}
                    >
                        <TagIcon className="h-3 w-3" />
                        {addon.customTag}
                    </span>
                )}
                {sharedPeers && sharedPeers.length > 0 && (
                    <SharedConfigPill
                        isTV={focusable}
                        kind={configKindOf(addon.manifestUrl, addon.name)}
                        peers={sharedPeers}
                    />
                )}
            </>
        ) : null;

    const cardElement = (
        <Card
            // Narrow card (phone, 1280 laptop): icon, name and switch on top,
            // then version + counts + select box, then the tags. Wide card
            // (1920 and up): the version sits beside the name and the counts
            // under it, and the tags row ends with the select box. Which one
            // shows is decided by the card's own width - see .addon-card.
            className={`addon-card group tap-card relative cursor-pointer ${isSelected ? "ring-2 ring-primary" : ""}`}
            onClick={handleClick}
            onContextMenu={handleContextMenu}
            padding="none"
            variant="interactive"
            {...longPress}
        >
            <div className={`addon-card-body ${dragHandleProps ? "has-drag" : ""}`}>
                <div className="addon-card-head flex items-center gap-2.5">
                    {dragHandleProps && (
                        <button
                            type="button"
                            {...dragHandleProps}
                            className="shrink-0 cursor-grab rounded-lg border-0 bg-transparent p-0 p-1.5 text-subtle hover:bg-surface-hover hover:text-default active:cursor-grabbing"
                            onClick={(e: React.MouseEvent) => e.stopPropagation()}
                            title="Drag to reorder"
                        >
                            <Bars3Icon className="h-4 w-4" />
                        </button>
                    )}
                    <div
                        className="addon-card-icon flex shrink-0 items-center justify-center overflow-hidden rounded-xl"
                        style={{
                            background:
                                "linear-gradient(135deg, var(--color-primary-muted), var(--color-secondary-muted))",
                        }}
                    >
                        {addon.logo ? (
                            <img
                                alt={addon.name}
                                className="h-full w-full object-contain p-1.5"
                                height={44}
                                src={addon.logo}
                                width={44}
                            />
                        ) : (
                            <PuzzlePieceIcon className="h-1/2 w-1/2 text-primary" />
                        )}
                    </div>
                    <div className="min-w-0 flex-1">
                        {configUrl ? (
                            <button
                                className="addon-card-name text-left font-semibold text-default transition-all group-hover:text-primary"
                                onClick={handleOpenConfigure}
                                onPointerDown={(e) => e.stopPropagation()}
                                title="Open configure page"
                                type="button"
                            >
                                {nameHead}
                                {nameTail}
                            </button>
                        ) : (
                            <h3 className="addon-card-name font-semibold text-default transition-all group-hover:text-primary">
                                {nameHead}
                                {nameTail}
                            </h3>
                        )}
                        <div className="addon-card-wide mt-1 flex-wrap items-center gap-x-3 gap-y-1 whitespace-nowrap text-muted text-sm">
                            {counts}
                        </div>
                    </div>
                    <div
                        className="shrink-0 self-start"
                        onClick={(e) => e.stopPropagation()}
                        role="none"
                    >
                        <ToggleSwitch
                            checked={addon.isActive !== false}
                            onChange={async () => {
                                try {
                                    const newStatus = !addon.isActive;
                                    await api.toggleAddonStatus(addon.id, newStatus);
                                    toast.success(
                                        `Addon ${newStatus ? "activated" : "deactivated"}`
                                    );
                                    onToggleStatus?.(addon.id, newStatus);
                                } catch (err) {
                                    toast.error(
                                        readErrorMessage(err, `Failed to toggle ${addon.name}`)
                                    );
                                }
                            }}
                            title={`Activate ${addon.name}`}
                        />
                    </div>
                </div>

                <div className="addon-card-narrow mt-3 items-center justify-between gap-2.5">
                    <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1.5 whitespace-nowrap text-muted text-sm">
                        {addon.version && (
                            <VersionBadge size="sm" version={addon.version.slice(0, 7)} />
                        )}
                        {counts}
                        {labelPills && <span className="contents md:hidden">{labelPills}</span>}
                    </div>
                    {selectBox}
                </div>

                {/* Tags - not on a phone - led by the label and Shared settings. On a
              wide card the select box ends this row. */}
                <div className="addon-card-tags mt-2.5 items-center justify-between gap-2.5">
                    <div className="flex min-w-0 flex-wrap items-center gap-1.5">
                        {labelPills}
                        {addon.resources.map((resource) => (
                            <ResourceBadge key={resource} resource={resource} />
                        ))}
                    </div>
                    <div className="addon-card-wide">{selectBox}</div>
                </div>
            </div>
        </Card>
    );

    // Full-width row - name/description/tags all get the page's full width
    // instead of a 3-column grid cell's, so nothing needs truncating. Same
    // state/handlers/context menu as the grid card above, just laid out
    // horizontally in one flowing row instead of a vertical card.
    const rowElement = (
        <Card
            className={`tap-card cursor-pointer ${isSelected ? "ring-2 ring-primary" : ""}`}
            onClick={handleClick}
            onContextMenu={handleContextMenu}
            padding="none"
            variant="interactive"
            {...longPress}
        >
            <div className="flex items-center gap-3 p-4">
                {dragHandleProps && (
                    <button
                        type="button"
                        {...dragHandleProps}
                        className="shrink-0 cursor-grab rounded-lg border-0 bg-transparent p-0 p-1 text-subtle hover:bg-surface-hover hover:text-default active:cursor-grabbing"
                        onClick={(e: React.MouseEvent) => e.stopPropagation()}
                        title="Drag to reorder"
                    >
                        <Bars3Icon className="h-3.5 w-3.5" />
                    </button>
                )}
                <div
                    className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-xl"
                    style={{
                        background:
                            "linear-gradient(135deg, var(--color-primary-muted), var(--color-secondary-muted))",
                    }}
                >
                    {addon.logo ? (
                        <img
                            alt={addon.name}
                            className="h-full w-full object-contain p-1.5"
                            height={48}
                            src={addon.logo}
                            width={48}
                        />
                    ) : (
                        <PuzzlePieceIcon className="h-6 w-6 text-primary" />
                    )}
                </div>
                <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                        {configUrl ? (
                            <button
                                className="text-left font-semibold text-default transition-colors hover:text-primary"
                                onClick={handleOpenConfigure}
                                onPointerDown={(e) => e.stopPropagation()}
                                title="Open configure page"
                                type="button"
                            >
                                {addon.name}
                            </button>
                        ) : (
                            <h3 className="font-semibold text-default">{addon.name}</h3>
                        )}
                        {addon.lastHealthCheck && (
                            <div
                                className={`h-2 w-2 shrink-0 rounded-full ${addon.isOnline ? "bg-success" : "bg-error"}`}
                                title={
                                    addon.isOnline
                                        ? `Online - Last checked: ${new Date(addon.lastHealthCheck).toLocaleString()}`
                                        : `Offline${addon.healthCheckError ? `: ${addon.healthCheckError}` : ""} - Last checked: ${new Date(addon.lastHealthCheck).toLocaleString()}`
                                }
                            />
                        )}
                        {addon.version && (
                            <VersionBadge size="sm" version={addon.version.slice(0, 7)} />
                        )}
                        {addon.isProtected && (
                            <ShieldCheckIcon
                                className="h-4 w-4 shrink-0 text-success"
                                title="Protected"
                            />
                        )}
                        {addon.customTag && (
                            <span
                                className="inline-flex items-center gap-1 rounded-full bg-primary-muted px-2 py-0.5 font-medium text-primary text-xs"
                                key={addonTagColors?.[addon.customTag] || "default"}
                                style={
                                    addonTagColors?.[addon.customTag]
                                        ? {
                                              background: `${addonTagColors[addon.customTag]}26`,
                                              color: addonTagColors[addon.customTag],
                                          }
                                        : undefined
                                }
                                title={`Labeled "${addon.customTag}" — right-click to change or remove`}
                            >
                                <TagIcon className="h-3 w-3" />
                                {addon.customTag}
                            </span>
                        )}
                        {sharedPeers && sharedPeers.length > 0 && (
                            <SharedConfigPill
                                isTV={focusable}
                                kind={configKindOf(addon.manifestUrl, addon.name)}
                                peers={sharedPeers}
                            />
                        )}
                        {/* Moved out of its old leading spot (before the drag handle,
                crowding every row's start on mobile). A flex-basis:100%
                spacer forces this onto its own line UNCONDITIONALLY - a
                plain ml-auto sibling only wraps if the row happens to
                overflow, which a short addon name never does, so it just
                sat inline at the row's right edge instead of moving at all
                (confirmed live: same line as the version tag, not under it). */}
                        <span aria-hidden="true" className="h-0 basis-full" />
                        <span
                            className="ml-auto shrink-0"
                            onClick={(e) => e.stopPropagation()}
                            role="none"
                        >
                            <SelectionCheckbox checked={isSelected} onChange={onToggleSelect} />
                        </span>
                    </div>
                    {addon.description && (
                        <p className="mt-0.5 line-clamp-2 text-muted text-sm">
                            {addon.description}
                        </p>
                    )}
                    <div className="mt-1.5 flex flex-wrap items-center gap-2">
                        {addon.resources.map((resource) => (
                            <ResourceBadge key={resource} resource={resource} />
                        ))}
                        <span className="flex items-center gap-1 text-muted text-xs">
                            <UsersIcon className="h-3.5 w-3.5 text-secondary" />
                            {addon.userCount || 0} user{addon.userCount === 1 ? "" : "s"}
                        </span>
                        <span className="flex items-center gap-1 text-muted text-xs">
                            <PuzzlePieceIcon className="h-3.5 w-3.5 text-secondary" />
                            {addon.groupCount} group{addon.groupCount === 1 ? "" : "s"}
                        </span>
                    </div>
                </div>
                <div
                    className="hidden shrink-0 md:block"
                    onClick={(e) => e.stopPropagation()}
                    role="none"
                >
                    <ToggleSwitch
                        checked={addon.isActive !== false}
                        onChange={async () => {
                            try {
                                const newStatus = !addon.isActive;
                                await api.toggleAddonStatus(addon.id, newStatus);
                                toast.success(`Addon ${newStatus ? "activated" : "deactivated"}`);
                                onToggleStatus?.(addon.id, newStatus);
                            } catch (err) {
                                toast.error(
                                    readErrorMessage(err, `Failed to toggle ${addon.name}`)
                                );
                            }
                        }}
                        title={`Activate ${addon.name}`}
                    />
                </div>
            </div>
        </Card>
    );

    const activeElement = layout === "row" ? rowElement : cardElement;

    return (
        <>
            {focusable ? (
                <TVFocusable
                    onEnterPress={() => {
                        window.location.href = `/addons/${addon.id}`;
                    }}
                >
                    {activeElement}
                </TVFocusable>
            ) : (
                activeElement
            )}

            <ContextMenu isOpen={isOpen} onClose={close} position={position}>
                {menuView === "main" ? (
                    <>
                        <Link
                            className="flex w-full items-center gap-2 px-3 py-2 text-default text-sm transition-colors hover:bg-surface-hover"
                            href={`/addons/${addon.id}`}
                            onClick={(e) => {
                                e.stopPropagation();
                                close();
                            }}
                        >
                            <EyeIcon className="h-4 w-4" />
                            View Details
                        </Link>
                        {configUrl && (
                            <button
                                className="flex w-full items-center gap-2 px-3 py-2 text-default text-sm transition-colors hover:bg-surface-hover"
                                onClick={(e) => {
                                    e.stopPropagation();
                                    close();
                                    handleOpenConfigure(e);
                                }}
                                type="button"
                            >
                                <Cog6ToothIcon className="h-4 w-4" />
                                Open Configure
                            </button>
                        )}
                        <button
                            className="flex w-full items-center gap-2 px-3 py-2 text-default text-sm transition-colors hover:bg-surface-hover"
                            onClick={handleReload}
                            type="button"
                        >
                            <ArrowPathIcon className="h-4 w-4" />
                            Reload Addon
                        </button>
                        <button
                            className="flex w-full items-center gap-2 px-3 py-2 text-default text-sm transition-colors hover:bg-surface-hover"
                            onClick={handleClone}
                            type="button"
                        >
                            <DocumentDuplicateIcon className="h-4 w-4" />
                            Clone Addon
                        </button>
                        <button
                            className="flex w-full items-center gap-2 px-3 py-2 text-default text-sm transition-colors hover:bg-surface-hover"
                            onClick={async (e) => {
                                e.stopPropagation();
                                close();
                                try {
                                    const newStatus = !addon.isActive;
                                    await api.toggleAddonStatus(addon.id, newStatus);
                                    toast.success(
                                        `Addon ${newStatus ? "activated" : "deactivated"}`
                                    );
                                    onToggleStatus?.(addon.id, newStatus);
                                } catch (err) {
                                    toast.error(
                                        readErrorMessage(err, `Failed to toggle ${addon.name}`)
                                    );
                                }
                            }}
                            type="button"
                        >
                            {addon.isActive ? (
                                <>
                                    <XMarkIcon className="h-4 w-4" />
                                    Disable
                                </>
                            ) : (
                                <>
                                    <CheckIcon className="h-4 w-4" />
                                    Enable
                                </>
                            )}
                        </button>
                        <div className="my-1 border-default border-t" />
                        <button
                            className="flex w-full items-center gap-2 px-3 py-2 text-default text-sm transition-colors hover:bg-surface-hover"
                            onClick={(e) => {
                                e.stopPropagation();
                                close();
                                onToggleProtect?.(!addon.isProtected);
                            }}
                            type="button"
                        >
                            <ShieldCheckIcon className="h-4 w-4" />
                            {addon.isProtected ? "Unprotect" : "Protect"}
                        </button>
                        <button
                            className="flex w-full items-center justify-between gap-2 px-3 py-2 text-default text-sm transition-colors hover:bg-surface-hover"
                            onClick={(e) => {
                                e.stopPropagation();
                                setMenuView("label");
                            }}
                            type="button"
                        >
                            <span className="flex items-center gap-2 truncate">
                                <TagIcon
                                    className="h-4 w-4 shrink-0"
                                    key={
                                        (addon.customTag && addonTagColors?.[addon.customTag]) ||
                                        "default"
                                    }
                                    style={
                                        addon.customTag && addonTagColors?.[addon.customTag]
                                            ? { color: addonTagColors[addon.customTag] }
                                            : undefined
                                    }
                                />
                                <span className="truncate">
                                    {addon.customTag ? `Label: ${addon.customTag}` : "Label"}
                                </span>
                            </span>
                            <span className="shrink-0 text-muted">›</span>
                        </button>
                        <div className="my-1 border-default border-t" />
                        <button
                            className="flex w-full items-center gap-2 px-3 py-2 text-default text-sm transition-colors hover:bg-surface-hover"
                            onClick={(e) => {
                                e.stopPropagation();
                                close();
                                onMoveToVault();
                            }}
                            type="button"
                        >
                            <ShieldCheckIcon className="h-4 w-4" />
                            Move to Vault
                        </button>
                        <div className="my-1 border-default border-t" />
                        <button
                            className="flex w-full items-center gap-2 px-3 py-2 text-error text-sm transition-colors hover:bg-error-muted"
                            onClick={handleDelete}
                            type="button"
                        >
                            <TrashIcon className="h-4 w-4" />
                            Delete
                        </button>
                    </>
                ) : (
                    <>
                        {/* Label sub-view — pick an existing label, clear the current
                one, or create a brand new one. Creating always assigns it
                too (onCreateLabel does create+assign in one call), so
                finishing this flow never leaves a label orphaned unworn. */}
                        <button
                            className="flex w-full items-center gap-2 px-3 py-2 text-default text-sm transition-colors hover:bg-surface-hover"
                            onClick={(e) => {
                                e.stopPropagation();
                                setMenuView("main");
                            }}
                            type="button"
                        >
                            <ArrowLeftIcon className="h-4 w-4" />
                            Back
                        </button>
                        <div className="my-1 border-default border-t" />
                        <div className="px-3 pt-1 pb-1.5 font-medium text-[11px] text-subtle uppercase tracking-wide">
                            Label
                        </div>
                        <div className="max-h-48 overflow-y-auto">
                            {(addonTags?.length || 0) === 0 && (
                                <p className="px-3 py-2 text-muted text-xs">
                                    No labels yet — create one below.
                                </p>
                            )}
                            {addonTags?.map((tag) => {
                                const isCurrent = addon.customTag === tag;
                                const swatch = addonTagColors?.[tag];
                                return (
                                    <button
                                        className="flex w-full items-center justify-between gap-2 px-3 py-2 text-default text-sm transition-colors hover:bg-surface-hover"
                                        key={tag}
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            // Clicking the already-applied label deselects it
                                            // (same as "Clear label" below) instead of re-setting
                                            // it — a quick way to remove without a second row.
                                            if (isCurrent) {
                                                onClearTag?.();
                                            } else {
                                                onSetTag?.(tag);
                                            }
                                            close();
                                        }}
                                        type="button"
                                    >
                                        <span className="flex items-center gap-2 truncate">
                                            <span
                                                className="h-2.5 w-2.5 shrink-0 rounded-full"
                                                style={{
                                                    background: swatch || "var(--color-text-muted)",
                                                }}
                                            />
                                            <span className="truncate">{tag}</span>
                                        </span>
                                        {isCurrent && (
                                            <CheckIcon className="h-4 w-4 shrink-0 text-primary" />
                                        )}
                                    </button>
                                );
                            })}
                        </div>
                        {addon.customTag && (
                            <button
                                className="flex w-full items-center gap-2 px-3 py-2 text-error text-sm transition-colors hover:bg-error-muted"
                                onClick={(e) => {
                                    e.stopPropagation();
                                    onClearTag?.();
                                    close();
                                }}
                                type="button"
                            >
                                <XCircleIcon className="h-4 w-4" />
                                Clear label
                            </button>
                        )}
                        <div className="my-1 border-default border-t" />
                        {isCreatingLabel ? (
                            <div className="flex items-center gap-1 px-3 py-2">
                                <input
                                    autoFocus
                                    className="input-base min-w-0 flex-1 px-2.5 py-1 text-xs"
                                    maxLength={40}
                                    onChange={(e) => setNewLabelName(e.target.value)}
                                    onClick={(e) => e.stopPropagation()}
                                    onKeyDown={(e) => {
                                        e.stopPropagation();
                                        if (e.key === "Enter") {
                                            submitNewLabel();
                                        }
                                        if (e.key === "Escape") {
                                            setIsCreatingLabel(false);
                                            setNewLabelName("");
                                        }
                                    }}
                                    placeholder="Label name…"
                                    value={newLabelName}
                                />
                                <button
                                    aria-label="Create and apply label"
                                    className="shrink-0 rounded-md p-1.5 text-success transition-colors hover:bg-success-muted"
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        submitNewLabel();
                                    }}
                                    type="button"
                                >
                                    <CheckIcon className="h-4 w-4" />
                                </button>
                            </div>
                        ) : (
                            <button
                                className="flex w-full items-center gap-2 px-3 py-2 text-default text-sm transition-colors hover:bg-surface-hover"
                                onClick={(e) => {
                                    e.stopPropagation();
                                    setIsCreatingLabel(true);
                                }}
                                type="button"
                            >
                                <PlusIcon className="h-4 w-4" />
                                New label
                            </button>
                        )}
                    </>
                )}
            </ContextMenu>
        </>
    );
}

// Add Addon Modal - Premium styled
function AddAddonModal({
    isOpen,
    onClose,
    groups,
}: {
    isOpen: boolean;
    onClose: () => void;
    groups: Group[];
}) {
    const groupLabelId1 = useId();
    const fieldId2 = useId();
    const [isLoading, setIsLoading] = useState(false);
    const [manifestUrl, setManifestUrl] = useState("");
    const [error, setError] = useState("");
    const [manifestData, setManifestData] = useState<Partial<StremioManifest> | null>(null);
    const [isLoadingManifest, setIsLoadingManifest] = useState(false);
    const [urlError, setUrlError] = useState("");
    const [showSuccess, setShowSuccess] = useState(false);
    const [selectedGroupIds, setSelectedGroupIds] = useState<Set<string>>(new Set());

    // Reset state when modal closes
    useEffect(() => {
        if (!isOpen) {
            setTimeout(() => {
                setManifestUrl("");
                setError("");
                setManifestData(null);
                setUrlError("");
                setShowSuccess(false);
                setSelectedGroupIds(new Set());
            }, 300);
        }
    }, [isOpen]);

    // Load manifest when URL changes
    useEffect(() => {
        if (!manifestUrl.trim()) {
            setUrlError("");
            setManifestData(null);
            return;
        }

        const urlPattern = /^@?(https?|stremio):\/\/.+\.json$/;
        if (!urlPattern.test(manifestUrl.trim())) {
            setUrlError("URL must be a valid JSON manifest URL");
            setManifestData(null);
            return;
        }

        setUrlError("");

        const loadManifest = async () => {
            try {
                setIsLoadingManifest(true);
                let fetchUrl = manifestUrl.trim();
                if (fetchUrl.startsWith("stremio://")) {
                    fetchUrl = fetchUrl.replace(/^stremio:\/\//, "https://");
                }

                const response = await fetch(fetchUrl, { cache: "no-cache", mode: "cors" });
                if (!response.ok) {
                    throw new Error(`HTTP ${response.status}`);
                }
                const data = await response.json();
                setManifestData(data);
                setUrlError("");
            } catch (err) {
                const isCorsError =
                    readErrorMessage(err)?.includes("CORS") ||
                    readErrorMessage(err)?.includes("Failed to fetch") ||
                    readErrorName(err) === "TypeError";
                setUrlError(
                    isCorsError
                        ? "Cannot preview (CORS). Server will fetch it."
                        : readErrorMessage(err, "Failed to load")
                );
                setManifestData(null);
            } finally {
                setIsLoadingManifest(false);
            }
        };

        const timeoutId = setTimeout(loadManifest, 500);
        return () => clearTimeout(timeoutId);
    }, [manifestUrl]);

    const handleSubmit = async () => {
        setError("");
        if (!manifestUrl.trim()) {
            setError("Manifest URL is required");
            return;
        }

        setIsLoading(true);
        try {
            const newAddon = await api.createAddon({
                manifestUrl,
                ...(manifestData ? { manifestData } : {}),
            });

            // Assign to selected groups if any
            if (selectedGroupIds.size > 0 && newAddon?.id) {
                try {
                    await Promise.all(
                        Array.from(selectedGroupIds).map((groupId) =>
                            api.addAddonToGroup(groupId, newAddon.id)
                        )
                    );
                } catch (groupErr) {
                    console.error("Failed to assign addon to some groups:", groupErr);
                    // Don't fail the whole operation if group assignment fails
                }
            }

            setShowSuccess(true);
            setTimeout(() => {
                onClose();
                if (newAddon?.id) {
                    window.location.href = `/addons/${newAddon.id}`;
                } else {
                    window.location.reload();
                }
            }, 800);
        } catch (err) {
            setError(readErrorMessage(err, "Failed to add addon"));
            toast.error(readErrorMessage(err, "Failed to add addon"));
        } finally {
            setIsLoading(false);
        }
    };

    return (
        <AnimatePresence>
            {isOpen && (
                <Dialog className="relative z-50" onClose={onClose} open={isOpen}>
                    <motion.div
                        animate={{ opacity: 1 }}
                        className="fixed inset-0"
                        exit={{ opacity: 0 }}
                        initial={{ opacity: 0 }}
                        style={{
                            backdropFilter: "blur(8px)",
                            background:
                                "radial-gradient(ellipse at center, rgba(0,0,0,0.6) 0%, rgba(0,0,0,0.85) 100%)",
                        }}
                    />

                    <div className="fixed inset-0 flex items-center justify-center p-4">
                        <motion.div
                            animate={{ opacity: 1, scale: 1, y: 0 }}
                            exit={{ opacity: 0, scale: 0.95, y: 10 }}
                            initial={{ opacity: 0, scale: 0.9, y: 20 }}
                            transition={{ damping: 25, stiffness: 300, type: "spring" }}
                        >
                            <DialogPanel
                                className="w-full overflow-hidden"
                                style={{
                                    background: "var(--color-surface)",
                                    border: "1px solid var(--color-surface-border)",
                                    borderRadius: "24px",
                                    boxShadow:
                                        "0 0 0 1px rgba(255,255,255,0.05), 0 40px 80px -20px rgba(0,0,0,0.5)",
                                    maxWidth: "512px",
                                }}
                            >
                                <div
                                    className="h-1.5 w-full"
                                    style={{
                                        background:
                                            "linear-gradient(90deg, var(--color-primary) 0%, color-mix(in srgb, var(--color-primary) 60%, var(--color-secondary)) 50%, var(--color-secondary) 100%)",
                                    }}
                                />

                                <div className="p-8">
                                    <AnimatePresence mode="wait">
                                        {showSuccess ? (
                                            <motion.div
                                                animate={{ opacity: 1, scale: 1 }}
                                                className="py-8 text-center"
                                                initial={{ opacity: 0, scale: 0.9 }}
                                                key="success"
                                            >
                                                <motion.div
                                                    animate={{ scale: 1 }}
                                                    className="mx-auto mb-6 flex h-20 w-20 items-center justify-center rounded-full"
                                                    initial={{ scale: 0 }}
                                                    style={{
                                                        background:
                                                            "linear-gradient(135deg, var(--color-secondary) 0%, color-mix(in srgb, var(--color-secondary) 80%, var(--color-primary)) 100%)",
                                                        boxShadow:
                                                            "0 12px 40px -8px var(--color-secondary)",
                                                    }}
                                                    transition={{
                                                        damping: 10,
                                                        delay: 0.1,
                                                        type: "spring",
                                                    }}
                                                >
                                                    <CheckIcon className="h-10 w-10 text-white" />
                                                </motion.div>
                                                <h3
                                                    className="mb-2 font-bold text-2xl"
                                                    style={{ color: "var(--color-text)" }}
                                                >
                                                    Addon Added!
                                                </h3>
                                                <p
                                                    className="text-sm"
                                                    style={{ color: "var(--color-text-muted)" }}
                                                >
                                                    {manifestData?.name || "New addon"} is ready to
                                                    use
                                                </p>
                                            </motion.div>
                                        ) : (
                                            <motion.div
                                                animate={{ opacity: 1, x: 0 }}
                                                exit={{ opacity: 0, x: 20 }}
                                                initial={{ opacity: 0, x: -20 }}
                                                key="form"
                                            >
                                                {/* Header */}
                                                <div className="mb-8 text-center">
                                                    <motion.div
                                                        animate={{ rotate: 0, scale: 1 }}
                                                        className="mx-auto mb-4 flex h-16 w-16 items-center justify-center overflow-hidden rounded-2xl"
                                                        initial={{ rotate: -180, scale: 0 }}
                                                        key={manifestData?.logo || "default"}
                                                        style={{
                                                            background: manifestData?.logo
                                                                ? "var(--color-subtle)"
                                                                : "linear-gradient(135deg, var(--color-primary) 0%, color-mix(in srgb, var(--color-primary) 70%, var(--color-secondary)) 100%)",
                                                            border: manifestData?.logo
                                                                ? "1px solid var(--color-surface-border)"
                                                                : "none",
                                                            boxShadow:
                                                                "0 8px 32px -8px var(--color-primary)",
                                                        }}
                                                        transition={{
                                                            damping: 15,
                                                            delay: 0.1,
                                                            type: "spring",
                                                        }}
                                                    >
                                                        {manifestData?.logo ? (
                                                            <img
                                                                alt={manifestData.name}
                                                                className="h-full w-full object-contain p-2"
                                                                height={64}
                                                                src={manifestData.logo}
                                                                width={64}
                                                            />
                                                        ) : (
                                                            <PuzzlePieceIcon className="h-8 w-8 text-white" />
                                                        )}
                                                    </motion.div>
                                                    <h2
                                                        className="mb-2 flex items-center justify-center gap-2 font-bold text-2xl"
                                                        style={{ color: "var(--color-text)" }}
                                                    >
                                                        {manifestData?.name || "Add New Addon"}
                                                        {manifestData?.version && (
                                                            <VersionBadge
                                                                size="md"
                                                                version={manifestData.version}
                                                            />
                                                        )}
                                                    </h2>
                                                    <p
                                                        className="text-sm"
                                                        style={{ color: "var(--color-text-muted)" }}
                                                    >
                                                        {manifestData?.description ||
                                                            "Enter the manifest URL to add an addon"}
                                                    </p>

                                                    {/* Resources preview as tags */}
                                                    {(() => {
                                                        const resources =
                                                            manifestData?.resources || [];
                                                        const hasSearchCatalog = (
                                                            manifestData?.catalogs || []
                                                        ).some((c) =>
                                                            c?.extra?.some(
                                                                (e) => e.name === "search"
                                                            )
                                                        );
                                                        const resourceNames = resources
                                                            .map((r) =>
                                                                typeof r === "string" ? r : r.name
                                                            )
                                                            .filter(Boolean);
                                                        if (
                                                            hasSearchCatalog &&
                                                            !resourceNames.includes("search")
                                                        ) {
                                                            resourceNames.push("search");
                                                        }
                                                        if (resourceNames.length === 0) {
                                                            return null;
                                                        }
                                                        return (
                                                            <div className="mt-3 flex flex-wrap justify-center gap-2">
                                                                {resourceNames.map(
                                                                    (name: string) => (
                                                                        <ResourceBadge
                                                                            key={name}
                                                                            resource={name}
                                                                        />
                                                                    )
                                                                )}
                                                            </div>
                                                        );
                                                    })()}
                                                </div>

                                                {/* Form */}
                                                <div className="space-y-5">
                                                    <div>
                                                        <label
                                                            className="mb-2 block font-medium text-sm"
                                                            htmlFor={`${fieldId2}-3`}
                                                            style={{
                                                                color: "var(--color-text-muted)",
                                                            }}
                                                        >
                                                            Manifest URL{" "}
                                                            <span
                                                                style={{
                                                                    color: "var(--color-error)",
                                                                }}
                                                            >
                                                                *
                                                            </span>
                                                        </label>
                                                        <div className="relative">
                                                            <div
                                                                className="absolute top-1/2 left-4 -translate-y-1/2"
                                                                style={{
                                                                    color: "var(--color-text-muted)",
                                                                }}
                                                            >
                                                                <LinkIcon className="h-5 w-5" />
                                                            </div>
                                                            <input
                                                                className={`w-full rounded-xl py-3.5 pr-4 pl-12 transition-all duration-200 focus:outline-none ${error || urlError ? "bd-err" : "bd-ok"}`}
                                                                id={`${fieldId2}-3`}
                                                                onChange={(e) =>
                                                                    setManifestUrl(e.target.value)
                                                                }
                                                                placeholder="https://addon.example.com/manifest.json"
                                                                style={{
                                                                    background:
                                                                        "var(--color-subtle)",
                                                                    color: "var(--color-text)",
                                                                }}
                                                                type="text"
                                                                value={manifestUrl}
                                                            />
                                                        </div>
                                                        {(error || urlError) && (
                                                            <p
                                                                className="mt-2 text-sm"
                                                                style={{
                                                                    color: "var(--color-error)",
                                                                }}
                                                            >
                                                                {error || urlError}
                                                            </p>
                                                        )}
                                                        {!(
                                                            manifestUrl.trim() ||
                                                            error ||
                                                            urlError
                                                        ) && (
                                                            <p
                                                                className="mt-2 text-xs"
                                                                style={{
                                                                    color: "var(--color-text-subtle)",
                                                                }}
                                                            >
                                                                Enter the full URL to the addon's
                                                                manifest.json file
                                                            </p>
                                                        )}
                                                    </div>

                                                    {/* Loading state */}
                                                    {isLoadingManifest && (
                                                        <motion.div
                                                            animate={{ opacity: 1, y: 0 }}
                                                            className="flex items-center gap-3 rounded-xl p-4"
                                                            initial={{ opacity: 0, y: 10 }}
                                                            style={{
                                                                background: "var(--color-subtle)",
                                                            }}
                                                        >
                                                            <div className="h-5 w-5 animate-spin rounded-full border-2 border-primary border-t-transparent" />
                                                            <span
                                                                className="text-sm"
                                                                style={{
                                                                    color: "var(--color-text-muted)",
                                                                }}
                                                            >
                                                                Loading manifest...
                                                            </span>
                                                        </motion.div>
                                                    )}

                                                    {/* Group Assignment */}
                                                    {manifestData &&
                                                        !isLoadingManifest &&
                                                        groups.length > 0 && (
                                                            <motion.div
                                                                animate={{ opacity: 1, y: 0 }}
                                                                initial={{ opacity: 0, y: 10 }}
                                                            >
                                                                <fieldset
                                                                    aria-labelledby={`${groupLabelId1}-1`}
                                                                    className="mx-0 mb-3 flex min-w-0 items-center justify-between border-0 p-0"
                                                                >
                                                                    <p
                                                                        className="block font-medium text-sm"
                                                                        id={`${groupLabelId1}-1`}
                                                                        style={{
                                                                            color: "var(--color-text-muted)",
                                                                        }}
                                                                    >
                                                                        <UsersIcon className="mr-2 inline h-4 w-4" />
                                                                        Assign to Groups
                                                                    </p>
                                                                    <span
                                                                        className="text-xs"
                                                                        style={{
                                                                            color: "var(--color-text-subtle)",
                                                                        }}
                                                                    >
                                                                        {selectedGroupIds.size === 0
                                                                            ? "No groups selected"
                                                                            : `${selectedGroupIds.size} group${selectedGroupIds.size > 1 ? "s" : ""} selected`}
                                                                    </span>
                                                                </fieldset>
                                                                <div className="max-h-48 space-y-2 overflow-y-auto p-1">
                                                                    {groups.map((group, index) => {
                                                                        const isSelected =
                                                                            selectedGroupIds.has(
                                                                                group.id
                                                                            );
                                                                        return (
                                                                            <motion.div
                                                                                animate={{
                                                                                    opacity: 1,
                                                                                    y: 0,
                                                                                }}
                                                                                className={
                                                                                    "group flex cursor-pointer items-center gap-3 rounded-xl border border-default bg-surface-hover p-3 transition-all duration-200 hover:border-primary hover:bg-surface"
                                                                                }
                                                                                initial={{
                                                                                    opacity: 0,
                                                                                    y: 10,
                                                                                }}
                                                                                key={group.id}
                                                                                onClick={() => {
                                                                                    const newSet =
                                                                                        new Set(
                                                                                            selectedGroupIds
                                                                                        );
                                                                                    if (
                                                                                        isSelected
                                                                                    ) {
                                                                                        newSet.delete(
                                                                                            group.id
                                                                                        );
                                                                                    } else {
                                                                                        newSet.add(
                                                                                            group.id
                                                                                        );
                                                                                    }
                                                                                    setSelectedGroupIds(
                                                                                        newSet
                                                                                    );
                                                                                }}
                                                                                transition={{
                                                                                    delay:
                                                                                        index *
                                                                                        0.03,
                                                                                }}
                                                                            >
                                                                                {/* Group color indicator */}
                                                                                <div
                                                                                    className="h-3 w-3 flex-shrink-0 rounded-full"
                                                                                    style={{
                                                                                        background:
                                                                                            group.color ||
                                                                                            "var(--color-primary)",
                                                                                    }}
                                                                                />

                                                                                {/* Content */}
                                                                                <div className="min-w-0 flex-1">
                                                                                    <div className="flex items-center gap-2">
                                                                                        <span
                                                                                            className={`truncate font-medium ${isSelected ? "text-default" : "text-subtle group-hover:text-default"}`}
                                                                                        >
                                                                                            {
                                                                                                group.name
                                                                                            }
                                                                                        </span>
                                                                                        {group.description && (
                                                                                            <span className="truncate text-muted text-xs">
                                                                                                •{" "}
                                                                                                {
                                                                                                    group.description
                                                                                                }
                                                                                            </span>
                                                                                        )}
                                                                                    </div>
                                                                                </div>

                                                                                {/* Selection indicator circle */}
                                                                                <div
                                                                                    className={`flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full border-2 transition-all duration-200 ${
                                                                                        isSelected
                                                                                            ? "border-primary bg-primary"
                                                                                            : "border-default group-hover:border-primary/50"
                                                                                    }`}
                                                                                >
                                                                                    {isSelected && (
                                                                                        <motion.div
                                                                                            animate={{
                                                                                                scale: 1,
                                                                                            }}
                                                                                            className="h-2 w-2 rounded-full bg-white"
                                                                                            initial={{
                                                                                                scale: 0,
                                                                                            }}
                                                                                        />
                                                                                    )}
                                                                                </div>
                                                                            </motion.div>
                                                                        );
                                                                    })}
                                                                </div>
                                                                <p
                                                                    className="mt-2 text-xs"
                                                                    style={{
                                                                        color: "var(--color-text-subtle)",
                                                                    }}
                                                                >
                                                                    Click to select groups. You can
                                                                    assign this addon to groups
                                                                    later.
                                                                </p>
                                                            </motion.div>
                                                        )}
                                                </div>

                                                {/* Actions */}
                                                <div className="mt-8 flex gap-3">
                                                    <button
                                                        className="flex-1 rounded-xl py-3.5 font-medium text-sm transition-colors"
                                                        onClick={onClose}
                                                        style={{
                                                            background: "var(--color-subtle)",
                                                            color: "var(--color-text)",
                                                        }}
                                                        type="button"
                                                    >
                                                        Cancel
                                                    </button>
                                                    <Button
                                                        className="flex-1"
                                                        disabled={isLoadingManifest}
                                                        isLoading={isLoading}
                                                        onClick={handleSubmit}
                                                        variant="primary"
                                                    >
                                                        Add Addon
                                                    </Button>
                                                </div>
                                            </motion.div>
                                        )}
                                    </AnimatePresence>
                                </div>
                            </DialogPanel>
                        </motion.div>
                    </div>
                </Dialog>
            )}
        </AnimatePresence>
    );
}

// Addon Detail View - Enhanced with editing, group management, and resource selection
function CloneAddonForm({ addon, onClose }: { addon: AddonDisplay; onClose: () => void }) {
    const [isLoading, setIsLoading] = useState(false);
    const [name, setName] = useState(`${addon.name} (Copy)`);
    const [manifestUrl, setManifestUrl] = useState(addon.manifestUrl);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setIsLoading(true);

        try {
            const created = await api.createAddon({
                manifestUrl,
                name,
            });
            toast.success("Addon cloned successfully");
            onClose();
            if (created?.id) {
                window.location.href = `/addons/${created.id}`;
            } else {
                window.location.reload();
            }
        } catch (err) {
            toast.error(readErrorMessage(err, "Failed to clone addon"));
        } finally {
            setIsLoading(false);
        }
    };

    return (
        <form className="space-y-6" onSubmit={handleSubmit}>
            <Input
                label="Addon Name"
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g., My Custom Addon"
                required
                value={name}
            />

            <Input
                label="Manifest URL"
                leftIcon={<LinkIcon className="h-5 w-5" />}
                onChange={(e) => setManifestUrl(e.target.value)}
                placeholder="https://addon.example.com/manifest.json"
                required
                value={manifestUrl}
            />

            <div className="rounded-xl border border-default bg-subtle p-4">
                <p className="mb-2 text-muted text-sm">Original Addon Info:</p>
                <div className="space-y-1 text-sm">
                    <p className="text-default">Version: {addon.version}</p>
                    <p className="text-default">Resources: {addon.resources.join(", ")}</p>
                    <p className="text-default">Protected: {addon.isProtected ? "Yes" : "No"}</p>
                </div>
            </div>

            <div className="flex justify-end gap-3 pt-4">
                <Button onClick={onClose} type="button" variant="secondary">
                    Cancel
                </Button>
                <Button isLoading={isLoading} type="submit" variant="primary">
                    Clone Addon
                </Button>
            </div>
        </form>
    );
}
