"use client";

import {
    AdjustmentsHorizontalIcon,
    ArrowPathIcon,
    ArrowUturnLeftIcon,
    Bars3Icon,
    BookOpenIcon,
    CalendarIcon,
    ChevronDownIcon,
    CodeBracketIcon,
    Cog6ToothIcon,
    CubeIcon,
    DocumentDuplicateIcon,
    FolderIcon,
    HeartIcon,
    LinkIcon,
    PlusIcon,
    PuzzlePieceIcon,
    ShieldCheckIcon,
    SparklesIcon,
    TrashIcon,
    UsersIcon,
    XMarkIcon,
} from "@heroicons/react/24/outline";
import { AnimatePresence, motion } from "framer-motion";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { AddonConfigModal } from "@/components/addons/AddonConfigModal";
import { AddonHealthSettings } from "@/components/addons/AddonHealthSettings";
import { DetailToolbar } from "@/components/layout/DetailToolbar";
import { Breadcrumbs, Header } from "@/components/layout/Header";
import { PageSection, StaggerContainer, StaggerItem } from "@/components/layout/PageContainer";
import {
    Button,
    Card,
    ConfirmModal,
    InlineEdit,
    Input,
    Modal,
    SyncBadge,
    ToggleSwitch,
    VersionBadge,
} from "@/components/ui";
import { showToast, toast } from "@/components/ui/Toast";
import { decodeAddonConfig } from "@/lib/addonConfig";
import type { StremioAddon } from "@/lib/api";
import { type Addon, api, type Group } from "@/lib/api";
import { copyToClipboard } from "@/lib/clipboard";
import { readErrorMessage, readErrorName } from "@/lib/errors";
import { useLayoutMode } from "@/lib/layout-mode";
import { configKindOf, type SharedPeer, sharedConfigPeers } from "@/lib/sharedConfig";
import type { StremioCatalog, StremioManifest, StremioResource } from "@/lib/stremio-manifest";

// Helper to compute configure URL from manifest URL
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

import { closestCenter, DndContext, type DragEndEvent, type DragStartEvent } from "@dnd-kit/core";
import {
    arrayMove,
    SortableContext,
    useSortable,
    verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { DragOverlay, useSortableSensors } from "@/components/ui/DragSortable";
import type { AddonBackup } from "@/lib/api";

interface AddonWithGroups extends Addon {
    customLogo?: string | null;
    groups?: Array<{
        id: string;
        name: string;
        users?: number;
        addonCount?: number;
        addons?: number;
        color?: string;
    }>;
    healthCheckError?: string;
    isActive?: boolean;
    lastHealthCheck?: string;
    logo?: string;
    manifest?: Partial<StremioManifest>;
    originalManifest?: Partial<StremioManifest>;
}

// Both provider manifests and saved catalog selections use these keys.
const getCatalogKey = (catalog: unknown) => {
    if (!catalog || typeof catalog !== "object") {
        return "unknown:unknown";
    }
    const type = "type" in catalog && typeof catalog.type === "string" ? catalog.type : "unknown";
    const id = "id" in catalog && typeof catalog.id === "string" ? catalog.id : "unknown";
    return catalogHasSearch(catalog) ? `${type}:${id}:search` : `${type}:${id}`;
};

const catalogHasSearch = (catalog: unknown) => {
    if (!catalog || typeof catalog !== "object") {
        return false;
    }
    if ("extra" in catalog && Array.isArray(catalog.extra)) {
        return catalog.extra.some(
            (extra: unknown) =>
                typeof extra === "object" &&
                extra !== null &&
                "name" in extra &&
                extra.name === "search"
        );
    }
    return "search" in catalog && catalog.search === true;
};

// Build a unified manifest diff where catalog/resource items are highlighted as complete blocks
interface DiffLine {
    text: string;
    type: "same" | "add" | "del";
}
function buildManifestUnifiedDiff(
    orig: Partial<StremioManifest>,
    curr: Partial<StremioManifest>
): DiffLine[] {
    const result: DiffLine[] = [];
    const catKey = (c: StremioCatalog) => `${c.type}:${c.id}`;
    const resName = (r: StremioResource) => (typeof r === "string" ? r : (r?.name ?? ""));
    const currCatKeys = new Set((curr.catalogs || []).map(catKey));
    const origCatKeys = new Set((orig.catalogs || []).map(catKey));
    const currResNames = new Set((curr.resources || []).map(resName));
    const origResNames = new Set((orig.resources || []).map(resName));
    const push = (type: DiffLine["type"], text: string) => result.push({ text, type });

    const allCats = [
        ...(orig.catalogs || []).map((c) => ({
            c,
            t: (currCatKeys.has(catKey(c)) ? "same" : "del") as DiffLine["type"],
        })),
        ...(curr.catalogs || [])
            .filter((c) => !origCatKeys.has(catKey(c)))
            .map((c) => ({ c, t: "add" as DiffLine["type"] })),
    ];
    const allRes = [
        ...(orig.resources || []).map((r: StremioResource) => ({
            r,
            t: (currResNames.has(resName(r)) ? "same" : "del") as DiffLine["type"],
        })),
        ...(curr.resources || [])
            .filter((r: StremioResource) => !origResNames.has(resName(r)))
            .map((r: StremioResource) => ({ r, t: "add" as DiffLine["type"] })),
    ];

    push("same", "{");
    const allKeys = [...new Set([...Object.keys(orig), ...Object.keys(curr)])];
    allKeys.forEach((key, ki) => {
        const trail = ki < allKeys.length - 1 ? "," : "";
        const inOrig = key in orig,
            inCurr = key in curr;

        if (key === "resources") {
            push("same", `  "resources": [`);
            allRes.forEach(({ r, t }, ri) => {
                push(t, `    ${JSON.stringify(r)}${ri < allRes.length - 1 ? "," : ""}`);
            });
            push("same", `  ]${trail}`);
        } else if (key === "catalogs") {
            push("same", `  "catalogs": [`);
            allCats.forEach(({ c, t }, ci) => {
                const lines = JSON.stringify(c, null, 2).split("\n");
                lines.forEach((line, li) => {
                    push(
                        t,
                        `    ${line}${li === lines.length - 1 && ci < allCats.length - 1 ? "," : ""}`
                    );
                });
            });
            push("same", `  ]${trail}`);
        } else if (!inOrig) {
            push("add", `  ${JSON.stringify(key)}: ${JSON.stringify(curr[key])}${trail}`);
        } else if (inCurr) {
            const same = JSON.stringify(orig[key]) === JSON.stringify(curr[key]);
            push(
                same ? "same" : "del",
                `  ${JSON.stringify(key)}: ${JSON.stringify(orig[key])}${trail}`
            );
            if (!same) {
                push("add", `  ${JSON.stringify(key)}: ${JSON.stringify(curr[key])}${trail}`);
            }
        } else {
            push("del", `  ${JSON.stringify(key)}: ${JSON.stringify(orig[key])}${trail}`);
        }
    });
    push("same", "}");
    return result;
}

// Parse a catalog key back into type and id
const parseCatalogKey = (key: string) => {
    const parts = key.split(":");
    return {
        id: parts[1] || "unknown",
        isSearch: parts[2] === "search",
        type: parts[0] || "unknown",
    };
};

// Manifest URL Input Component
interface ManifestUrlInputProps {
    onSave: (data: { manifestUrl: string }) => Promise<void>;
    value: string;
}

function ManifestUrlInput({ value, onSave }: ManifestUrlInputProps) {
    const [isFocused, setIsFocused] = useState(false);
    const [localValue, setLocalValue] = useState(value);
    const [currentSavedUrl, setCurrentSavedUrl] = useState(value);
    const [urlBeforeLastUpdate, setUrlBeforeLastUpdate] = useState(value);
    const [isSaving, setIsSaving] = useState(false);

    useEffect(() => {
        setLocalValue(value);
        setCurrentSavedUrl(value);
        setUrlBeforeLastUpdate(value);
    }, []);

    const validateAndFetchManifest = async (
        url: string
    ): Promise<{ valid: boolean; error?: string; data?: Partial<StremioManifest> }> => {
        if (!url || url.trim() === "") {
            return { error: "URL is required", valid: false };
        }

        const urlPattern = /^@?(https?|stremio):\/\/.+\.json$/;
        if (!urlPattern.test(url.trim())) {
            return { error: "URL must be a valid JSON manifest URL", valid: false };
        }

        try {
            let fetchUrl = url.trim();
            if (fetchUrl.startsWith("stremio://")) {
                fetchUrl = fetchUrl.replace(/^stremio:\/\//, "https://");
            }

            const response = await fetch(fetchUrl, { cache: "no-cache", mode: "cors" });
            if (!response.ok) {
                return {
                    error: `Failed to fetch manifest (HTTP ${response.status})`,
                    valid: false,
                };
            }

            const data = await response.json();

            if (!data.name || typeof data.name !== "string") {
                return { error: 'Invalid manifest: missing or invalid "name" field', valid: false };
            }
            if (!data.version || typeof data.version !== "string") {
                return {
                    error: 'Invalid manifest: missing or invalid "version" field',
                    valid: false,
                };
            }
            if (!data.id || typeof data.id !== "string") {
                return { error: 'Invalid manifest: missing or invalid "id" field', valid: false };
            }

            return { data, valid: true };
        } catch (err) {
            const isCorsError =
                readErrorMessage(err)?.includes("CORS") ||
                readErrorMessage(err)?.includes("Failed to fetch") ||
                readErrorName(err) === "TypeError";
            if (isCorsError) {
                return {
                    error: "Cannot validate manifest (CORS error). Server will handle it.",
                    valid: false,
                };
            }
            return { error: readErrorMessage(err, "Failed to validate manifest"), valid: false };
        }
    };

    const handleRevert = () => {
        setLocalValue(urlBeforeLastUpdate);
        setCurrentSavedUrl(urlBeforeLastUpdate);
        onSave({ manifestUrl: urlBeforeLastUpdate });
        toast("Reverted to previous URL", { icon: "↩️" });
    };

    const handleBlur = async () => {
        setIsFocused(false);

        if (localValue === currentSavedUrl) {
            return;
        }

        const trimmedValue = localValue.trim();
        setIsSaving(true);
        const validation = await validateAndFetchManifest(trimmedValue);

        if (!validation.valid) {
            setIsSaving(false);
            if (validation.error?.includes("CORS")) {
                try {
                    await onSave({ manifestUrl: trimmedValue });
                    setUrlBeforeLastUpdate(currentSavedUrl);
                    setCurrentSavedUrl(trimmedValue);
                    toast.success("Manifest URL updated successfully");
                } catch (err) {
                    setLocalValue(currentSavedUrl);
                    toast.error(readErrorMessage(err, "Failed to update manifest URL"));
                } finally {
                    setIsSaving(false);
                }
                return;
            }

            toast.error(
                <div className="flex flex-col gap-2">
                    <span>{validation.error}</span>
                    <Button
                        className="self-start text-warning hover:text-warning"
                        onClick={() => {
                            setLocalValue(currentSavedUrl);
                            toast("Reverted to previous URL", { icon: "↩️" });
                        }}
                        size="sm"
                        variant="ghost"
                    >
                        Revert to previous URL
                    </Button>
                </div>,
                { duration: 5000 }
            );
            setIsSaving(false);
            return;
        }

        try {
            await onSave({ manifestUrl: trimmedValue });
            setUrlBeforeLastUpdate(currentSavedUrl);
            setCurrentSavedUrl(trimmedValue);
            toast.success("Manifest URL updated successfully");
        } catch (err) {
            setLocalValue(currentSavedUrl);
            toast.error(readErrorMessage(err, "Failed to update manifest URL"));
        } finally {
            setIsSaving(false);
        }
    };

    const canRevert =
        currentSavedUrl !== urlBeforeLastUpdate &&
        urlBeforeLastUpdate !== "" &&
        urlBeforeLastUpdate !== currentSavedUrl;

    return (
        <div
            className={`flex flex-1 items-center gap-3 rounded-xl border bg-surface-hover p-3 transition-all ${
                isFocused ? "border-theme-secondary" : "border-default"
            } ${isSaving ? "opacity-70" : ""}`}
        >
            <LinkIcon className="h-5 w-5 shrink-0 text-muted" />
            <input
                aria-label="Manifest URL"
                className="flex-1 bg-transparent text-default placeholder:text-subtle disabled:cursor-not-allowed"
                disabled={isSaving}
                onBlur={handleBlur}
                onChange={(e) => setLocalValue(e.target.value)}
                onFocus={() => setIsFocused(true)}
                placeholder="Enter manifest URL (e.g., https://example.com/manifest.json)"
                style={{ border: "none", boxShadow: "none", outline: "none" }}
                value={localValue}
            />
            {isSaving && (
                <div className="h-4 w-4 shrink-0 animate-spin rounded-full border-2 border-current border-t-transparent text-primary" />
            )}
            {!isSaving && canRevert && (
                <button
                    className="shrink-0 rounded-lg p-1.5 text-muted transition-colors hover:bg-surface-hover hover:text-default"
                    onClick={handleRevert}
                    title={`Revert to: ${urlBeforeLastUpdate.slice(0, 40)}${urlBeforeLastUpdate.length > 40 ? "..." : ""}`}
                    type="button"
                >
                    <ArrowUturnLeftIcon className="h-4 w-4" />
                </button>
            )}
        </div>
    );
}

// Sortable Catalog Item Component
function SortableCatalogItem({
    catalog,
    isSelected,
    onToggle,
}: {
    catalog: StremioCatalog;
    isSelected: boolean;
    onToggle: () => void;
}) {
    const key = getCatalogKey(catalog);
    const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
        id: key || "",
    });

    const style = {
        opacity: isDragging ? 0 : 1,
        transform: CSS.Transform.toString(transform),
        transition: isDragging ? "none" : transition,
        zIndex: isDragging ? 100 : undefined,
    } as React.CSSProperties;

    return (
        <motion.div
            className={`group flex cursor-pointer items-center gap-3 rounded-xl border border-default bg-surface-hover p-3 transition-all duration-200 hover:border-primary hover:bg-surface ${
                isDragging ? "shadow-lg ring-2 ring-primary" : ""
            }`}
            ref={setNodeRef}
            style={style}
        >
            {/* Drag handle */}
            <button
                aria-label="Drag to reorder"
                type="button"
                {...attributes}
                {...listeners}
                className="cursor-grab rounded border-0 bg-transparent p-0 p-1 hover:bg-surface-hover active:cursor-grabbing"
                onClick={(e) => e.stopPropagation()}
                style={{ touchAction: "none" }}
            >
                <Bars3Icon className="h-5 w-5 text-subtle" />
            </button>

            {/* Content */}
            <button
                className="w-full min-w-0 flex-1 border-0 bg-transparent p-0 text-left"
                onClick={onToggle}
                type="button"
            >
                <div className="flex items-center gap-2">
                    <span
                        className={`truncate font-medium ${isSelected ? "text-default" : "text-subtle group-hover:text-default"}`}
                    >
                        {catalog.name || catalog.id}
                    </span>
                    <span className="rounded-full border border-primary/20 bg-primary-muted px-2 py-0.5 font-medium text-[10px] text-primary">
                        {catalog.type}
                    </span>
                </div>
            </button>

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
                        animate={{ scale: 1 }}
                        className="h-2 w-2 rounded-full bg-white"
                        initial={{ scale: 0 }}
                    />
                )}
            </div>
        </motion.div>
    );
}

export default function AddonDetailPage() {
    const fieldId1 = useId();
    const { layoutMode } = useLayoutMode();
    const params = useParams();
    const router = useRouter();
    const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);
    const [isEditModalOpen, setIsEditModalOpen] = useState(false);
    const [isAddToGroupModalOpen, setIsAddToGroupModalOpen] = useState(false);
    const [isReloading, setIsReloading] = useState(false);
    const [isDeleting, setIsDeleting] = useState(false);
    const [isTogglingStatus, setIsTogglingStatus] = useState(false);
    const [logoError, setLogoError] = useState(false);

    // Data state
    const [addon, setAddon] = useState<AddonWithGroups | null>(null);
    // Other addons opening this addon's saved configuration (lib/sharedConfig.ts).
    const [sharedPeers, setSharedPeers] = useState<SharedPeer[]>([]);
    // The single-addon response names the address `url`; the list says manifestUrl.
    const ownUrl = addon?.manifestUrl || (addon as { url?: string } | null)?.url || "";
    useEffect(() => {
        if (!ownUrl) {
            setSharedPeers([]);
            return;
        }
        let cancelled = false;
        api.getAddons()
            .then((all) => {
                if (!cancelled) {
                    setSharedPeers(sharedConfigPeers(all).get(String(params.id)) || []);
                }
            })
            .catch(() => {
                if (!cancelled) {
                    setSharedPeers([]);
                }
            });
        return () => {
            cancelled = true;
        };
    }, [params.id, ownUrl]);
    const [allGroups, setAllGroups] = useState<Group[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<Error | null>(null);
    const [totalUsers, setTotalUsers] = useState(0);

    // Resources / catalogs editing
    const [selectedResources, setSelectedResources] = useState<Set<string>>(new Set());
    const [selectedCatalogs, setSelectedCatalogs] = useState<Set<string>>(new Set());
    const [orderedRegularCatalogs, setOrderedRegularCatalogs] = useState<StremioCatalog[]>([]);
    const [orderedSearchCatalogs, setOrderedSearchCatalogs] = useState<StremioCatalog[]>([]);
    const [manifestData, setManifestData] = useState<Partial<StremioManifest> | null>(null);
    const [originalManifestData, setOriginalManifestData] =
        useState<Partial<StremioManifest> | null>(null);
    const [loadingManifest, setLoadingManifest] = useState(false);
    // In-place config editor (AddonConfigModal) - decodes the settings inside
    // the manifest URL into editable fields.
    const [showConfigEditor, setShowConfigEditor] = useState(false);
    const [isSavingResources, setIsSavingResources] = useState(false);
    const [isSavingCatalogs, setIsSavingCatalogs] = useState(false);
    const [activeCatalogId, setActiveCatalogId] = useState<string | null>(null);
    const resourceSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
    const catalogSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

    // Form state for editing
    const [editForm, setEditForm] = useState({
        customLogo: "",
        description: "",
        name: "",
    });

    // Manifest diff section state
    const [isManifestExpanded, setIsManifestExpanded] = useState(false);

    // Proxy state
    const [isTogglingProxy, setIsTogglingProxy] = useState(false);
    const [isRegeneratingProxy, setIsRegeneratingProxy] = useState(false);
    // Vault-injection state - see server/utils/vaultInjection.js. Lives in
    // the Proxy card because the proxy IS the mechanism: only proxied serving
    // can resolve the placeholders.
    const [isVaultifying, setIsVaultifying] = useState(false);

    const handleToggleVaultify = async () => {
        if (!addon) {
            return;
        }
        setIsVaultifying(true);
        try {
            if (addon.vaultified) {
                await api.unvaultifyAddon(addon.id);
                setAddon((prev) => (prev ? { ...prev, vaultified: false } : prev));
                toast.success("Addon URL restored with the current secrets");
            } else {
                const r = await api.vaultifyAddon(addon.id);
                const d = "data" in r ? r.data : r;
                setAddon((prev) =>
                    prev
                        ? {
                              ...prev,
                              proxyEnabled: true,
                              proxyManifestUrl: d.proxyManifestUrl || prev.proxyManifestUrl,
                              vaultified: true,
                          }
                        : prev
                );
                toast.success(
                    `Keys now live only in the Vault${d.entries?.length ? ` (${d.entries.join(", ")})` : ""} - users pick up the proxy URL on their next sync`
                );
            }
        } catch (err) {
            toast.error(readErrorMessage(err, "Failed to update vault-injection"));
        } finally {
            setIsVaultifying(false);
        }
    };

    // Drag sensors
    const sensors = useSortableSensors();

    // Fetch addon data
    const fetchAddon = useCallback(
        async (skipLoading = false) => {
            if (!skipLoading) {
                setIsLoading(true);
            }
            setError(null);
            try {
                const addonData = await api.getAddon(params.id as string);
                const anyAddon = addonData;

                const logo =
                    anyAddon.customLogo ||
                    anyAddon.manifest?.logo ||
                    anyAddon.logo ||
                    anyAddon.iconUrl ||
                    (anyAddon.manifest?.id &&
                        `https://stremio-addon.netlify.app/${anyAddon.manifest.id}/icon.png`) ||
                    undefined;

                const groupsData = await api.getGroups();

                // Which groups carry this addon, and how many people that adds up to.
                //
                // This used to walk the groups one at a time, waiting for each before
                // starting the next, and then fetch each matching group AGAIN for its
                // member list - which the list above already carries. On a household
                // with ten groups that was twenty-one round trips in a row before the
                // page could render. Now: one request per group, all at once, and no
                // second fetch at all.
                const groupAddonLists = await Promise.all(
                    groupsData.map((g) => api.getGroupAddons(g.id).catch(() => [] as Addon[]))
                );
                const groupsWithAddon: Group[] = [];
                let userCount = 0;
                groupsData.forEach((group, i) => {
                    if (!groupAddonLists[i].some((ga) => ga.id === params.id)) {
                        return;
                    }
                    groupsWithAddon.push(group);
                    let userIds: string[] = [];
                    try {
                        const raw = group?.userIds;
                        if (typeof raw === "string") {
                            userIds = JSON.parse(raw);
                        } else if (Array.isArray(raw)) {
                            userIds = raw;
                        }
                    } catch (e) {
                        console.error("Error parsing group userIds:", e);
                    }
                    userCount += userIds.length;
                });

                setAddon({
                    ...addonData,
                    groups: groupsWithAddon,
                    logo,
                });
                setTotalUsers(userCount);
                setSelectedResources(new Set(addonData.resources || []));
                const savedCatalogs = addonData.catalogs || [];
                const catalogKeys = savedCatalogs.map((c) => getCatalogKey(c)).filter(Boolean);
                setSelectedCatalogs(new Set(catalogKeys));
                setAllGroups(groupsData);
                setLogoError(false);

                if (anyAddon.originalManifest) {
                    setOriginalManifestData(anyAddon.originalManifest);
                }
            } catch (err) {
                setError(err as Error);
            } finally {
                setIsLoading(false);
            }
        },
        [params.id]
    );

    // Initial fetch
    useEffect(() => {
        if (params.id) {
            fetchAddon();
        }
    }, [params.id, fetchAddon]);

    useEffect(() => {
        if (addon) {
            document.title = `SlickSync - ${addon.name || "Addon Detail"}`;
        }
    }, [addon]);

    const handleReload = useCallback(async () => {
        setIsReloading(true);
        try {
            await api.reloadAddon(params.id as string);
            const addonData = await api.getAddon(params.id as string);
            const anyAddon = addonData;

            const logo =
                anyAddon.customLogo ||
                anyAddon.manifest?.logo ||
                anyAddon.logo ||
                anyAddon.iconUrl ||
                (anyAddon.manifest?.id &&
                    `https://stremio-addon.netlify.app/${anyAddon.manifest.id}/icon.png`) ||
                undefined;

            setAddon((prev) => (prev ? { ...prev, ...addonData, logo } : null));
            setSelectedResources(new Set(anyAddon.resources || []));
            const savedCatalogs = anyAddon.catalogs || [];
            const catalogKeys = savedCatalogs.map((c) => getCatalogKey(c)).filter(Boolean);
            setSelectedCatalogs(new Set(catalogKeys));

            if (anyAddon.originalManifest) {
                setOriginalManifestData(anyAddon.originalManifest);
            }
            if (anyAddon.manifest) {
                setManifestData(anyAddon.manifest);
            }

            toast.success("Addon reloaded successfully");
        } catch (err) {
            toast.error(readErrorMessage(err, "Failed to reload addon"));
        } finally {
            setIsReloading(false);
        }
    }, [params.id]);

    const handleDelete = useCallback(async () => {
        setIsDeleting(true);
        try {
            await api.deleteAddon(params.id as string);
            toast.success("Addon deleted successfully");
            router.push("/addons");
        } catch (err) {
            toast.error(readErrorMessage(err, "Failed to delete addon"));
            setIsDeleting(false);
            setIsDeleteModalOpen(false);
        }
    }, [params.id, router]);

    const handleToggleStatus = async () => {
        if (!addon) {
            return;
        }

        setIsTogglingStatus(true);
        try {
            const newStatus = !addon.isActive;
            await api.toggleAddonStatus(addon.id, newStatus);
            setAddon({ ...addon, isActive: newStatus });
            toast.success(newStatus ? "Addon enabled" : "Addon disabled");
        } catch (err) {
            toast.error(readErrorMessage(err, "Failed to toggle status"));
        } finally {
            setIsTogglingStatus(false);
        }
    };

    // The server builds proxyManifestUrl from the host IT sees, and the API is
    // reached through the app's own internal proxy - so the server's idea of
    // the host is "localhost:4000", which is useless to anyone pasting the URL
    // into Stremio. The browser is the only party that knows the address this
    // instance is actually reachable at, so build it here and only fall back
    // to the server's value if there's no UUID to build from.
    const proxyUrlFor = (uuid?: string | null, serverValue?: string | null) => {
        if (uuid && typeof window !== "undefined") {
            return `${window.location.origin}/proxy/${uuid}/manifest.json`;
        }
        return serverValue || null;
    };

    // Handle proxy toggle
    const handleToggleProxy = async () => {
        if (!addon) {
            return;
        }

        setIsTogglingProxy(true);
        try {
            const anyAddon = addon;
            if (anyAddon.proxyEnabled) {
                await api.disableProxy(addon.id);
                setAddon({ ...addon, proxyEnabled: false });
                toast.success("Proxy disabled");
            } else {
                const result = await api.enableProxy(addon.id);
                setAddon({
                    ...addon,
                    proxyEnabled: true,
                    proxyManifestUrl: proxyUrlFor(result.proxyUuid, result.proxyManifestUrl),
                    proxyUuid: result.proxyUuid,
                });
                toast.success("Proxy enabled");
            }
        } catch (err) {
            toast.error(readErrorMessage(err, "Failed to toggle proxy"));
        } finally {
            setIsTogglingProxy(false);
        }
    };

    // Handle regenerate proxy UUID
    const handleRegenerateProxyUuid = async () => {
        if (!addon) {
            return;
        }

        setIsRegeneratingProxy(true);
        try {
            const result = await api.regenerateProxyUuid(addon.id);
            setAddon({
                ...addon,
                proxyManifestUrl: proxyUrlFor(result.proxyUuid, result.proxyManifestUrl),
                proxyUuid: result.proxyUuid,
            });
            toast.success("Proxy URL regenerated");
        } catch (err) {
            toast.error(readErrorMessage(err, "Failed to regenerate proxy URL"));
        } finally {
            setIsRegeneratingProxy(false);
        }
    };

    // Handle name update
    const handleNameUpdate = useCallback(
        async (newName: string) => {
            if (!addon) {
                return;
            }
            try {
                await api.updateAddon(addon.id, { name: newName });
                setAddon({ ...addon, name: newName });
                toast.success("Addon name updated");
            } catch (err) {
                toast.error(readErrorMessage(err, "Failed to update name"));
            }
        },
        [addon]
    );

    // Handle description update
    const handleDescriptionUpdate = useCallback(
        async (newDescription: string) => {
            if (!addon) {
                return;
            }
            try {
                await api.updateAddon(addon.id, { description: newDescription || undefined });
                setAddon({ ...addon, description: newDescription });
                toast.success("Addon description updated");
            } catch (err) {
                toast.error(readErrorMessage(err, "Failed to update description"));
            }
        },
        [addon]
    );

    // Load manifest data
    useEffect(() => {
        if (!addon || manifestData || loadingManifest) {
            return;
        }

        const loadManifest = async () => {
            setLoadingManifest(true);
            try {
                const manifestUrl = addon.url || addon.manifestUrl;
                if (manifestUrl) {
                    let fetchUrl = manifestUrl;
                    if (fetchUrl.startsWith("stremio://")) {
                        fetchUrl = fetchUrl.replace(/^stremio:\/\//, "https://");
                    }
                    const response = await fetch(fetchUrl);
                    if (response.ok) {
                        const data = await response.json();
                        setManifestData(data);
                    }
                }
            } catch (err) {
                console.error("Failed to fetch manifest:", err);
            } finally {
                setLoadingManifest(false);
            }
        };

        const apiManifest = addon.manifest || addon.originalManifest;
        if (apiManifest) {
            setManifestData(apiManifest);
        } else if (addon.manifestUrl) {
            loadManifest();
        }
    }, [addon, manifestData, loadingManifest]);

    // Compute filtered manifest from original + current selections (used for diff)
    const currentManifest = useMemo(() => {
        if (!originalManifestData) {
            return null;
        }
        const base = originalManifestData;
        const resources = (base.resources || []).filter((r: StremioResource) => {
            const name = typeof r === "string" ? r : r?.name;
            return name && selectedResources.has(name);
        });
        const catalogs = (base.catalogs || []).filter((c) =>
            selectedCatalogs.has(getCatalogKey(c))
        );
        return { ...base, catalogs, resources };
    }, [originalManifestData, selectedResources, selectedCatalogs]);

    // Initialize ordered catalogs
    useEffect(() => {
        const catalogs =
            originalManifestData?.catalogs ||
            manifestData?.catalogs ||
            addon?.manifest?.catalogs ||
            [];

        // Regular catalogs: those without search functionality
        const regularCatalogs = catalogs.filter((c) => {
            if (!c || typeof c !== "object") {
                return true;
            }
            return !catalogHasSearch(c);
        });

        // Search catalogs: any catalog with search functionality (even if it has other extras)
        const searchCatalogs = catalogs.filter((c) => {
            if (!c || typeof c !== "object") {
                return false;
            }
            return catalogHasSearch(c);
        });

        const savedCatalogs = addon?.catalogs || [];
        const savedKeys = new Set(savedCatalogs.map((c) => getCatalogKey(c)));

        const selectedRegular = savedCatalogs
            .filter((c) => {
                const key = getCatalogKey(c);
                return (
                    key && regularCatalogs.some((rc: StremioCatalog) => getCatalogKey(rc) === key)
                );
            })
            .map((c) => {
                const fullCatalog = regularCatalogs.find(
                    (rc: StremioCatalog) => getCatalogKey(rc) === getCatalogKey(c)
                );
                return fullCatalog;
            })
            .filter((catalog): catalog is StremioCatalog => catalog !== undefined);

        const unselectedRegular = regularCatalogs.filter((c) => {
            const key = getCatalogKey(c);
            return key && !savedKeys.has(key);
        });

        const orderedRegular = [...selectedRegular, ...unselectedRegular];

        const selectedSearch = savedCatalogs
            .filter((c) => {
                const key = getCatalogKey(c);
                return (
                    key && searchCatalogs.some((sc: StremioCatalog) => getCatalogKey(sc) === key)
                );
            })
            .map((c) => {
                const fullCatalog = searchCatalogs.find(
                    (sc: StremioCatalog) => getCatalogKey(sc) === getCatalogKey(c)
                );
                return fullCatalog;
            })
            .filter((catalog): catalog is StremioCatalog => catalog !== undefined);

        const unselectedSearch = searchCatalogs.filter((c) => {
            const key = getCatalogKey(c);
            return key && !savedKeys.has(key);
        });

        const orderedSearch = [...selectedSearch, ...unselectedSearch];

        setOrderedRegularCatalogs(orderedRegular);
        setOrderedSearchCatalogs(orderedSearch);
    }, [originalManifestData, manifestData, addon]);

    // Initialize selectedResources and selectedCatalogs when addon is first loaded
    useEffect(() => {
        if (addon) {
            // Initialize resources
            if (addon?.resources) {
                let savedResources = addon.resources;

                // Auto-add "search" resource if any catalog has search functionality and wasn't already saved
                if (addon?.catalogs) {
                    const savedCatalogs = addon.catalogs;
                    const hasSearchCatalog = savedCatalogs.some((c) => c?.search);
                    if (hasSearchCatalog && !savedResources.includes("search")) {
                        savedResources = [...savedResources, "search"];
                    }
                }

                setSelectedResources(new Set(savedResources));
            }

            // Initialize catalogs
            if (addon?.catalogs) {
                const savedCatalogs = addon.catalogs;
                const catalogKeys = savedCatalogs.map((c) => getCatalogKey(c)).filter(Boolean);
                setSelectedCatalogs(new Set(catalogKeys));
            }
        }
    }, [addon?.id]); // Only run when addon ID changes (initial load)

    // Combine manifest resources with addon's saved resources to show all available resources
    const allResources = useMemo(() => {
        const manifestResources = manifestData?.resources || [];
        const savedResources = addon?.resources || [];

        // Create a set of resource names from manifest to avoid duplicates
        const manifestNames = new Set(
            manifestResources.map((r: StremioResource) => (typeof r === "string" ? r : r.name))
        );

        // Start with manifest resources
        const combined = [...manifestResources];

        // Add saved resources that aren't in the manifest (like "search")
        for (const resource of savedResources) {
            if (!manifestNames.has(resource)) {
                combined.push(resource);
            }
        }

        // Auto-add "search" resource if any catalog has search functionality
        const hasSearchCatalog = (manifestData?.catalogs || []).some((c) =>
            c?.extra?.some((e) => e.name === "search")
        );
        if (
            hasSearchCatalog &&
            !manifestNames.has("search") &&
            !savedResources.includes("search")
        ) {
            combined.push("search");
        }

        return combined;
    }, [manifestData, addon]);

    // Auto-save helpers (debounced)
    const autoSaveResources = useCallback(
        (resources: Set<string>) => {
            if (!addon) {
                return;
            }
            if (resourceSaveTimer.current) {
                clearTimeout(resourceSaveTimer.current);
            }
            resourceSaveTimer.current = setTimeout(async () => {
                setIsSavingResources(true);
                try {
                    await api.updateAddon(addon.id, { resources: Array.from(resources) });
                } catch (err) {
                    toast.error(readErrorMessage(err, "Failed to update resources"));
                } finally {
                    setIsSavingResources(false);
                }
            }, 500);
        },
        [addon]
    );

    const autoSaveCatalogs = useCallback(
        (
            selectedCats: Set<string>,
            regularCats: NonNullable<StremioAddon["manifest"]["catalogs"]>,
            searchCats: NonNullable<StremioAddon["manifest"]["catalogs"]>
        ) => {
            if (!addon) {
                return;
            }
            if (catalogSaveTimer.current) {
                clearTimeout(catalogSaveTimer.current);
            }
            catalogSaveTimer.current = setTimeout(async () => {
                setIsSavingCatalogs(true);
                try {
                    const finalCatalogs: { type: string; id: string; search: boolean }[] = [];
                    let hasSearchCatalog = false;

                    for (const cat of regularCats) {
                        const key = getCatalogKey(cat);
                        if (selectedCats.has(key)) {
                            const { type, id, isSearch } = parseCatalogKey(key);
                            finalCatalogs.push({ id, search: isSearch, type });
                            if (isSearch) {
                                hasSearchCatalog = true;
                            }
                        }
                    }
                    for (const cat of searchCats) {
                        const key = getCatalogKey(cat);
                        if (selectedCats.has(key)) {
                            const { type, id, isSearch } = parseCatalogKey(key);
                            finalCatalogs.push({ id, search: isSearch, type });
                            if (isSearch) {
                                hasSearchCatalog = true;
                            }
                        }
                    }
                    await api.updateAddon(addon.id, { catalogs: finalCatalogs });

                    // Auto-add "search" resource if any search catalog is enabled
                    const currentResources = addon?.resources || [];
                    if (hasSearchCatalog && !currentResources.includes("search")) {
                        const newResources = [...currentResources, "search"];
                        await api.updateAddon(addon.id, { resources: newResources });
                        setSelectedResources(new Set(newResources));
                    }
                } catch (err) {
                    toast.error(readErrorMessage(err, "Failed to update catalogs"));
                } finally {
                    setIsSavingCatalogs(false);
                }
            }, 500);
        },
        [addon]
    );

    // Resource toggle handler
    const handleResourceToggle = (resource: string) => {
        const newSelectedResources = new Set(selectedResources);
        const isDeactivating = newSelectedResources.has(resource);

        if (isDeactivating) {
            newSelectedResources.delete(resource);

            // Cascade: deselect matching catalogs when their resource is disabled
            if (resource === "search" || resource === "catalog") {
                const newSelectedCatalogs = new Set(selectedCatalogs);
                for (const key of newSelectedCatalogs) {
                    const { isSearch } = parseCatalogKey(key);
                    if (resource === "search" ? isSearch : !isSearch) {
                        newSelectedCatalogs.delete(key);
                    }
                }
                setSelectedCatalogs(newSelectedCatalogs);
                autoSaveCatalogs(
                    newSelectedCatalogs,
                    orderedRegularCatalogs,
                    orderedSearchCatalogs
                );
            }
        } else {
            newSelectedResources.add(resource);
        }

        setSelectedResources(newSelectedResources);
        autoSaveResources(newSelectedResources);
    };

    // Catalog toggle handler
    const handleCatalogToggle = (catalogKey: string) => {
        const newSelected = new Set(selectedCatalogs);
        if (newSelected.has(catalogKey)) {
            newSelected.delete(catalogKey);
        } else {
            newSelected.add(catalogKey);
        }
        setSelectedCatalogs(newSelected);
        autoSaveCatalogs(newSelected, orderedRegularCatalogs, orderedSearchCatalogs);
    };

    // Check if all catalogs selected
    const allRegularSelected =
        orderedRegularCatalogs.length > 0 &&
        orderedRegularCatalogs.every((c) => selectedCatalogs.has(getCatalogKey(c)));

    const allSearchSelected =
        orderedSearchCatalogs.length > 0 &&
        orderedSearchCatalogs.every((c) => selectedCatalogs.has(getCatalogKey(c)));

    // Toggle all catalogs
    const handleToggleAllRegular = () => {
        const newSelected = new Set(selectedCatalogs);
        if (allRegularSelected) {
            orderedRegularCatalogs.forEach((c) => {
                newSelected.delete(getCatalogKey(c));
            });
        } else {
            orderedRegularCatalogs.forEach((c) => {
                newSelected.add(getCatalogKey(c));
            });
        }
        setSelectedCatalogs(newSelected);
        autoSaveCatalogs(newSelected, orderedRegularCatalogs, orderedSearchCatalogs);
    };

    const handleToggleAllSearch = () => {
        const newSelected = new Set(selectedCatalogs);
        if (allSearchSelected) {
            orderedSearchCatalogs.forEach((c) => {
                newSelected.delete(getCatalogKey(c));
            });
        } else {
            orderedSearchCatalogs.forEach((c) => {
                newSelected.add(getCatalogKey(c));
            });
        }
        setSelectedCatalogs(newSelected);
        autoSaveCatalogs(newSelected, orderedRegularCatalogs, orderedSearchCatalogs);
    };

    // Drag handlers
    const handleDragStart = (event: DragStartEvent) => {
        setActiveCatalogId(event.active.id as string);
    };

    const handleDragEnd = (event: DragEndEvent) => {
        const { active, over } = event;
        if (over && active.id !== over.id) {
            const activeKey = active.id as string;
            const isRegular = orderedRegularCatalogs.some((c) => getCatalogKey(c) === activeKey);
            if (isRegular) {
                const oldIndex = orderedRegularCatalogs.findIndex(
                    (c) => getCatalogKey(c) === activeKey
                );
                const newIndex = orderedRegularCatalogs.findIndex(
                    (c) => getCatalogKey(c) === over.id
                );
                const newOrder = arrayMove(orderedRegularCatalogs, oldIndex, newIndex);
                setOrderedRegularCatalogs(newOrder);
                autoSaveCatalogs(selectedCatalogs, newOrder, orderedSearchCatalogs);
            } else {
                const oldIndex = orderedSearchCatalogs.findIndex(
                    (c) => getCatalogKey(c) === activeKey
                );
                const newIndex = orderedSearchCatalogs.findIndex(
                    (c) => getCatalogKey(c) === over.id
                );
                const newOrder = arrayMove(orderedSearchCatalogs, oldIndex, newIndex);
                setOrderedSearchCatalogs(newOrder);
                autoSaveCatalogs(selectedCatalogs, orderedRegularCatalogs, newOrder);
            }
        }
        setActiveCatalogId(null);
    };

    // Handle save from edit modal
    // Shared by the raw URL input AND the Configure modal - both end in
    // "the manifest URL changed, refresh everything derived from it".
    const handleManifestUrlSave = async (updateData: { manifestUrl: string }) => {
        await api.updateAddon(params.id as string, updateData);
        const addonData = await api.getAddon(params.id as string);
        const anyAddon = addonData;
        const logo =
            anyAddon.customLogo ||
            anyAddon.manifest?.logo ||
            anyAddon.logo ||
            anyAddon.iconUrl ||
            (anyAddon.manifest?.id &&
                `https://stremio-addon.netlify.app/${anyAddon.manifest.id}/icon.png`) ||
            undefined;
        setAddon((prev) => (prev ? { ...prev, ...addonData, logo } : null));
        setLogoError(false);
        if (anyAddon.manifest) {
            setManifestData(anyAddon.manifest);
        }
        if (anyAddon.originalManifest) {
            setOriginalManifestData(anyAddon.originalManifest);
        }

        // Initialize resources, auto-add "search" if search catalogs enabled
        let savedResources = anyAddon.resources || [];
        const savedCatalogs = anyAddon.catalogs || [];
        const hasSearchCatalog = savedCatalogs.some((c) => c?.search);
        if (hasSearchCatalog && !savedResources.includes("search")) {
            savedResources = [...savedResources, "search"];
            // Update addon with the search resource
            await api.updateAddon(params.id as string, { resources: savedResources });
        }
        setSelectedResources(new Set(savedResources));

        const catalogKeys = savedCatalogs.map((c) => getCatalogKey(c)).filter(Boolean);
        setSelectedCatalogs(new Set(catalogKeys));
    };

    const handleSaveEdit = async () => {
        if (!addon) {
            return;
        }
        try {
            await api.updateAddon(addon.id, {
                customLogo: editForm.customLogo,
                description: editForm.description,
                name: editForm.name,
            });

            // Compute the new logo URL using the same logic as fetchAddon
            const anyAddon = addon;
            const newLogoUrl =
                editForm.customLogo ||
                addon.logo ||
                anyAddon.iconUrl ||
                addon.manifest?.logo ||
                (addon.manifest?.id &&
                    `https://stremio-addon.netlify.app/${addon.manifest.id}/icon.png`) ||
                undefined;

            setAddon({
                ...addon,
                customLogo: editForm.customLogo,
                description: editForm.description,
                logo: newLogoUrl,
                name: editForm.name,
            });

            // Reset logo error so the new image will be attempted
            setLogoError(false);

            setIsEditModalOpen(false);
            toast.success("Addon updated successfully");
        } catch (err) {
            toast.error(readErrorMessage(err, "Failed to update addon"));
        }
    };

    // Handle reset to manifest defaults
    const handleResetToManifest = async () => {
        if (!addon) {
            return;
        }
        try {
            const manifest = originalManifestData || manifestData;
            if (!manifest) {
                toast.error("No manifest data available");
                return;
            }

            // Prepare reset values
            const resetName = manifest.name || addon.name;
            const resetDescription = manifest.description || "";
            const resetLogo = manifest.logo || "";

            // Update addon via API
            await api.updateAddon(addon.id, {
                customLogo: resetLogo,
                description: resetDescription,
                name: resetName,
            });

            // Compute the logo using the same logic as fetchAddon
            const anyAddon = addon;
            const resetLogoUrl =
                resetLogo ||
                manifest?.logo ||
                addon.logo ||
                anyAddon.iconUrl ||
                (manifest?.id && `https://stremio-addon.netlify.app/${manifest.id}/icon.png`) ||
                undefined;

            // Update local state
            setAddon({
                ...addon,
                customLogo: resetLogo,
                description: resetDescription,
                logo: resetLogoUrl,
                name: resetName,
            });

            // Reset logo error state so the new logo will be attempted
            setLogoError(false);

            // Reset resources
            const manifestResources = manifest?.resources || [];
            const resourceNames = manifestResources
                .map((r: StremioResource) => (typeof r === "string" ? r : r.name))
                .filter(Boolean);
            const hasSearch = (manifest?.catalogs || []).some((c) =>
                c.extra?.some((e) => e.name === "search")
            );
            if (hasSearch && !resourceNames.includes("search")) {
                resourceNames.push("search");
            }
            await api.updateAddon(addon.id, { resources: resourceNames });
            setSelectedResources(new Set(resourceNames));

            // Reset catalogs
            const catalogs = manifest?.catalogs || [];
            const regularCatalogs = catalogs.filter((c) => {
                if (!c || typeof c !== "object") {
                    return true;
                }
                return !catalogHasSearch(c);
            });
            const searchCatalogs = catalogs.filter((c) => {
                if (!c || typeof c !== "object") {
                    return false;
                }
                return catalogHasSearch(c);
            });

            const finalCatalogs = catalogs.map((c) => ({
                id: c.id,
                search: catalogHasSearch(c),
                type: c.type,
            }));
            await api.updateAddon(addon.id, { catalogs: finalCatalogs });

            setOrderedRegularCatalogs(regularCatalogs);
            setOrderedSearchCatalogs(searchCatalogs);
            const allKeys = catalogs.map((c) => getCatalogKey(c)).filter(Boolean);
            setSelectedCatalogs(new Set(allKeys));

            // Update edit form
            setEditForm({
                customLogo: resetLogo,
                description: resetDescription,
                name: resetName,
            });

            showToast.info("Reset to manifest defaults");
        } catch (err) {
            toast.error(readErrorMessage(err, "Failed to reset addon"));
        }
    };

    // Handle remove from group
    const handleRemoveFromGroup = async (groupId: string, groupName: string) => {
        if (!addon) {
            return;
        }
        try {
            await api.removeAddonFromGroup(groupId, addon.id);
            toast.success(`Removed from ${groupName}`);
            await fetchAddon();
        } catch (err) {
            toast.error(readErrorMessage(err, "Failed to remove from group"));
        }
    };

    if (isLoading) {
        return (
            <>
                {layoutMode !== "nebula" && <Header title="Loading..." />}
                <div className="p-8">
                    <div className="flex h-40 items-center justify-center md:h-64">
                        <div className="h-8 w-8 animate-spin rounded-full border-2 border-current border-t-transparent text-primary" />
                    </div>
                </div>
            </>
        );
    }

    if (error) {
        return (
            <>
                {layoutMode !== "nebula" && <Header title="Error" />}
                <div className="p-8">
                    <div className="flex h-40 flex-col items-center justify-center gap-4 md:h-64">
                        <p className="text-error text-lg">Failed to load addon</p>
                        <p className="text-sm text-subtle">{error.message}</p>
                        <Button onClick={() => window.location.reload()}>Retry</Button>
                    </div>
                </div>
            </>
        );
    }

    if (!addon) {
        return (
            <>
                {layoutMode !== "nebula" && <Header title="Not Found" />}
                <div className="p-8">
                    <div className="flex h-40 flex-col items-center justify-center gap-4 md:h-64">
                        <p className="text-default text-lg">Addon not found</p>
                        <Link href="/addons">
                            <Button variant="secondary">Back to Addons</Button>
                        </Link>
                    </div>
                </div>
            </>
        );
    }

    const anyAddon = addon;

    const detailActions = (
        <div className="flex flex-wrap items-center justify-end gap-3">
            <div className="flex items-center gap-2">
                <span className="text-muted text-sm">Active</span>
                <ToggleSwitch
                    checked={addon.isActive !== false}
                    disabled={isTogglingStatus}
                    onChange={handleToggleStatus}
                    size="sm"
                    title="Activate addon"
                />
            </div>
            <Button
                isLoading={isReloading}
                leftIcon={
                    <ArrowPathIcon className={`h-5 w-5 ${isReloading ? "animate-spin" : ""}`} />
                }
                onClick={handleReload}
                variant="glass"
            >
                Reload Addon
            </Button>
            {getConfigureUrl(addon) && (
                <Button
                    leftIcon={<Cog6ToothIcon className="h-5 w-5" />}
                    onClick={() => {
                        const configUrl = getConfigureUrl(addon);
                        if (configUrl) {
                            window.open(configUrl, "_blank", "noopener,noreferrer");
                        }
                    }}
                    variant="glass"
                >
                    Configure
                </Button>
            )}
            <Button
                leftIcon={<ArrowUturnLeftIcon className="h-5 w-5" />}
                onClick={handleResetToManifest}
                variant="glass"
            >
                Reset
            </Button>
            <Button
                leftIcon={<TrashIcon className="h-5 w-5" />}
                onClick={() => setIsDeleteModalOpen(true)}
                variant="danger"
            >
                Delete
            </Button>
        </div>
    );

    return (
        <>
            {layoutMode !== "nebula" && (
                <Header
                    actions={detailActions}
                    title={
                        <Breadcrumbs
                            className="font-semibold text-xl"
                            items={[{ href: "/addons", label: "Addons" }, { label: addon.name }]}
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
                        <DetailToolbar
                            actions={detailActions}
                            backHref="/addons"
                            backLabel="Addons"
                            title={addon.name}
                        />
                    )}
                    {/* Hero Section */}
                    <PageSection className="mb-8">
                        <Card className="profile-hero" padding="lg">
                            <div className="relative">
                                <div className="profile-hero-layout flex flex-col items-start gap-4 sm:flex-row sm:gap-6">
                                    {/* Addon Logo - Large and clickable */}
                                    <motion.div
                                        animate={{ opacity: 1, scale: 1 }}
                                        className="profile-hero-avatar relative shrink-0"
                                        initial={false}
                                        transition={{ stiffness: 200, type: "spring" }}
                                    >
                                        <button
                                            aria-label="Edit addon appearance"
                                            className="cursor-pointer transition-transform hover:scale-105"
                                            onClick={() => {
                                                setEditForm({
                                                    customLogo: addon.customLogo || "",
                                                    description: addon.description || "",
                                                    name: addon.name,
                                                });
                                                setIsEditModalOpen(true);
                                            }}
                                            type="button"
                                        >
                                            <div className="flex h-24 w-24 items-center justify-center overflow-hidden rounded-2xl border-2 border-default bg-surface shadow-lg">
                                                {addon.logo && !logoError ? (
                                                    /* biome-ignore lint/a11y/noNoninteractiveElementInteractions: Image load failures choose fallback artwork; this is not a user action. */
                                                    <img
                                                        alt={addon.name}
                                                        className="h-full w-full object-contain p-2"
                                                        height={96}
                                                        onError={() => setLogoError(true)}
                                                        src={addon.logo}
                                                        width={96}
                                                    />
                                                ) : (
                                                    <PuzzlePieceIcon className="h-12 w-12 text-primary" />
                                                )}
                                            </div>
                                        </button>
                                    </motion.div>

                                    {/* Info */}
                                    <div className="min-w-0 flex-1">
                                        {/* Name with version badge */}
                                        <div className="mb-1 flex flex-wrap items-center gap-2">
                                            <InlineEdit
                                                className="font-bold text-2xl"
                                                maxLength={50}
                                                onSave={handleNameUpdate}
                                                placeholder="Enter addon name..."
                                                value={addon.name}
                                            />
                                            {addon.version && (
                                                <VersionBadge size="sm" version={addon.version} />
                                            )}
                                            {addon.lastHealthCheck && (
                                                <div
                                                    className={`h-2.5 w-2.5 rounded-full ${addon.isOnline ? "bg-success" : "bg-error"}`}
                                                    title={addon.isOnline ? "Online" : "Offline"}
                                                />
                                            )}
                                            {getConfigureUrl(addon) && (
                                                <button
                                                    className="rounded-lg p-1.5 transition-colors hover:bg-surface-hover"
                                                    onClick={() => {
                                                        const configUrl = getConfigureUrl(addon);
                                                        if (configUrl) {
                                                            window.open(
                                                                configUrl,
                                                                "_blank",
                                                                "noopener,noreferrer"
                                                            );
                                                        }
                                                    }}
                                                    title="Open configure page"
                                                    type="button"
                                                >
                                                    <Cog6ToothIcon className="h-5 w-5 text-muted" />
                                                </button>
                                            )}
                                        </div>
                                        <div className="mb-4">
                                            <InlineEdit
                                                className="profile-description text-muted"
                                                maxLength={200}
                                                onSave={handleDescriptionUpdate}
                                                placeholder="Enter description..."
                                                value={addon.description || undefined}
                                            />
                                        </div>

                                        {/* Quick stats row */}
                                        <div className="flex flex-wrap items-center gap-6">
                                            <div className="flex items-center gap-2">
                                                <UsersIcon className="h-5 w-5 text-secondary" />
                                                <span className="font-medium text-default">
                                                    {totalUsers}
                                                </span>
                                                <span className="text-muted">
                                                    user{totalUsers === 1 ? "" : "s"}
                                                </span>
                                            </div>
                                            <div className="flex items-center gap-2">
                                                <FolderIcon className="h-5 w-5 text-secondary" />
                                                <span className="font-medium text-default">
                                                    {addon.groups?.length || 0}
                                                </span>
                                                <span className="text-muted">
                                                    group{addon.groups?.length === 1 ? "" : "s"}
                                                </span>
                                            </div>
                                            <div className="flex items-center gap-2">
                                                <PuzzlePieceIcon className="h-5 w-5 text-secondary" />
                                                <span className="font-medium text-default">
                                                    {selectedResources.size}
                                                </span>
                                                <span className="text-muted">
                                                    resource
                                                    {selectedResources.size === 1 ? "" : "s"}
                                                </span>
                                            </div>
                                            <div className="flex items-center gap-2">
                                                <CalendarIcon className="h-5 w-5 text-secondary" />
                                                <span className="text-muted">
                                                    Created:{" "}
                                                    {addon.createdAt
                                                        ? new Date(
                                                              addon.createdAt
                                                          ).toLocaleDateString()
                                                        : "Unknown"}
                                                </span>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </Card>
                    </PageSection>

                    {/* Manifest URL Section */}
                    <PageSection className="mb-8" delay={0.1}>
                        <Card padding="lg">
                            {sharedPeers.length > 0 && addon && (
                                <div
                                    className="mb-4 flex items-start gap-2 rounded-xl border px-3 py-2.5 text-default text-sm"
                                    style={{
                                        background:
                                            "color-mix(in srgb, var(--color-warning) 10%, transparent)",
                                        borderColor:
                                            "color-mix(in srgb, var(--color-warning) 45%, transparent)",
                                    }}
                                >
                                    <LinkIcon className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
                                    <p>
                                        Same{" "}
                                        {configKindOf(ownUrl, addon.name)
                                            ? `${configKindOf(ownUrl, addon.name)} `
                                            : ""}
                                        configuration as{" "}
                                        {sharedPeers.map((p, i) => (
                                            <span key={p.id}>
                                                {i > 0 &&
                                                    (i === sharedPeers.length - 1 ? " and " : ", ")}
                                                <Link
                                                    className="font-medium text-primary hover:underline"
                                                    href={`/addons/${p.id}`}
                                                >
                                                    {p.name}
                                                </Link>
                                            </span>
                                        ))}
                                        . Changing its settings changes{" "}
                                        {sharedPeers.length > 1 ? "all of them" : "both"}. To keep
                                        them apart, save it as a new configuration and paste the new
                                        link below.
                                    </p>
                                </div>
                            )}
                            <div className="mb-4 flex items-center justify-between">
                                <div className="flex items-center gap-3">
                                    <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-500/20">
                                        <LinkIcon className="h-5 w-5 text-blue-400" />
                                    </div>
                                    <div>
                                        <h3 className="font-semibold text-default text-lg">
                                            Manifest URL
                                        </h3>
                                        <p className="text-muted text-sm">
                                            The source URL for this addon
                                        </p>
                                    </div>
                                </div>
                                <div className="flex items-center gap-2">
                                    {loadingManifest && (
                                        <div className="flex items-center gap-2 text-subtle text-xs">
                                            <div className="h-3 w-3 animate-spin rounded-full border border-current border-t-transparent" />
                                            Loading manifest...
                                        </div>
                                    )}
                                </div>
                            </div>

                            <div className="flex items-center gap-2">
                                <ManifestUrlInput
                                    onSave={handleManifestUrlSave}
                                    value={addon.url || addon.manifestUrl || ""}
                                />
                                <Button
                                    aria-label="Copy manifest URL"
                                    onClick={async () => {
                                        const url = addon.url || addon.manifestUrl;
                                        if (url) {
                                            try {
                                                await copyToClipboard(url);
                                                toast.success("Copied to clipboard");
                                            } catch {
                                                toast.error("Failed to copy to clipboard");
                                            }
                                        } else {
                                            toast.error("No URL available to copy");
                                        }
                                    }}
                                    size="sm"
                                    variant="ghost"
                                >
                                    <DocumentDuplicateIcon className="h-4 w-4" />
                                </Button>
                                {/* Only rendered when the URL's config actually decodes into
                  editable fields. Opaque/encrypted configs (AIOStreams,
                  UUID-style hosted configs) get NO button here - the page's
                  existing top Configure action already opens the addon's
                  own external configure page, and duplicating that link
                  here was confirmed redundant. */}
                                {(() => {
                                    const u =
                                        (addon as unknown as { url?: string }).url ||
                                        addon.manifestUrl ||
                                        "";
                                    return decodeAddonConfig(u) ? (
                                        <Button
                                            onClick={() => setShowConfigEditor(true)}
                                            size="sm"
                                            title="Edit the settings stored inside this addon's install URL"
                                            variant="secondary"
                                        >
                                            <AdjustmentsHorizontalIcon className="mr-1.5 h-4 w-4" />
                                            Edit config
                                        </Button>
                                    ) : null;
                                })()}
                            </div>
                            {/* key: remount on every open so the field state always starts
                from the CURRENT manifest URL, including right after a save.
                Runtime addon objects carry both `url` and `manifestUrl`
                (the server returns both for compatibility) - same
                either-field read the rest of this page does, minus the
                bare `any` casts. */}
                            {showConfigEditor &&
                                (() => {
                                    const currentManifestUrl =
                                        (addon as unknown as { url?: string }).url ||
                                        addon.manifestUrl ||
                                        "";
                                    return (
                                        <AddonConfigModal
                                            addonName={addon.name}
                                            isOpen={showConfigEditor}
                                            key={currentManifestUrl}
                                            manifestUrl={currentManifestUrl}
                                            onClose={() => setShowConfigEditor(false)}
                                            onSave={handleManifestUrlSave}
                                        />
                                    );
                                })()}
                        </Card>
                    </PageSection>

                    {/* Manifest Diff Section */}
                    {(originalManifestData || manifestData) && (
                        <PageSection className="mb-8" delay={0.15}>
                            <Card padding="lg">
                                <button
                                    aria-expanded={isManifestExpanded}
                                    className="flex w-full items-center justify-between gap-3"
                                    onClick={() => setIsManifestExpanded((prev: boolean) => !prev)}
                                    type="button"
                                >
                                    <div className="flex items-center gap-3">
                                        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-amber-500/20">
                                            <CodeBracketIcon className="h-5 w-5 text-amber-400" />
                                        </div>
                                        <div className="text-left">
                                            <h3 className="font-semibold text-default text-lg">
                                                Manifest
                                            </h3>
                                            <p className="text-muted text-sm">
                                                {originalManifestData && currentManifest
                                                    ? "Diff between original and current"
                                                    : "Manifest JSON"}
                                            </p>
                                        </div>
                                    </div>
                                    <ChevronDownIcon
                                        className={`h-5 w-5 text-muted transition-transform duration-200 ${isManifestExpanded ? "rotate-180" : ""}`}
                                    />
                                </button>

                                <AnimatePresence>
                                    {isManifestExpanded && (
                                        <motion.div
                                            animate={{ height: "auto", opacity: 1 }}
                                            className="overflow-hidden"
                                            exit={{ height: 0, opacity: 0 }}
                                            initial={{ height: 0, opacity: 0 }}
                                            transition={{ duration: 0.2 }}
                                        >
                                            <div className="mt-4">
                                                {(() => {
                                                    if (originalManifestData && currentManifest) {
                                                        const lines = buildManifestUnifiedDiff(
                                                            originalManifestData,
                                                            currentManifest
                                                        );
                                                        const hasDiff = lines.some(
                                                            (l) => l.type !== "same"
                                                        );
                                                        return (
                                                            <>
                                                                {!hasDiff && (
                                                                    <p className="mb-2 text-subtle text-xs italic">
                                                                        No differences — manifests
                                                                        are identical.
                                                                    </p>
                                                                )}
                                                                <pre className="max-h-[32rem] overflow-auto rounded-xl border border-default bg-surface p-4 font-mono text-xs leading-5">
                                                                    {lines.map((line, i) => (
                                                                        <span
                                                                            className={`block ${
                                                                                line.type === "del"
                                                                                    ? "bg-red-500/10 text-red-400"
                                                                                    : line.type ===
                                                                                        "add"
                                                                                      ? "bg-green-500/10 text-green-400"
                                                                                      : "text-subtle"
                                                                            }`}
                                                                            key={i}
                                                                        >
                                                                            {line.type === "del"
                                                                                ? "- "
                                                                                : line.type ===
                                                                                    "add"
                                                                                  ? "+ "
                                                                                  : "  "}
                                                                            {line.text}
                                                                        </span>
                                                                    ))}
                                                                </pre>
                                                            </>
                                                        );
                                                    }

                                                    // Only one available — show plain JSON
                                                    const json = JSON.stringify(
                                                        originalManifestData ?? manifestData,
                                                        null,
                                                        2
                                                    );
                                                    return (
                                                        <pre className="max-h-[32rem] overflow-auto whitespace-pre-wrap break-all rounded-xl border border-default bg-surface p-4 font-mono text-subtle text-xs">
                                                            {json}
                                                        </pre>
                                                    );
                                                })()}
                                            </div>
                                        </motion.div>
                                    )}
                                </AnimatePresence>
                            </Card>
                        </PageSection>
                    )}

                    {/* Resources Section */}
                    <PageSection className="mb-8" delay={0.2}>
                        <Card padding="lg">
                            <div className="detail-section-header mb-6 flex items-center justify-between">
                                <div className="flex items-center gap-3">
                                    <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-purple-500/20">
                                        <CubeIcon className="h-5 w-5 text-purple-400" />
                                    </div>
                                    <div>
                                        <h3 className="font-semibold text-default text-lg">
                                            Resources
                                        </h3>
                                        <p className="text-muted text-sm">
                                            Choose which resources this addon exposes
                                        </p>
                                    </div>
                                </div>
                                <div className="flex h-9 flex-shrink-0 items-center gap-2">
                                    {isSavingResources && (
                                        <div className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-t-transparent text-muted" />
                                    )}
                                    <Button
                                        leftIcon={<ArrowUturnLeftIcon className="h-4 w-4" />}
                                        onClick={() => {
                                            const manifest = originalManifestData || manifestData;
                                            const manifestResources = manifest?.resources || [];
                                            const resourceNames = manifestResources
                                                .map((r: StremioResource) =>
                                                    typeof r === "string" ? r : r.name
                                                )
                                                .filter(Boolean);

                                            const hasSearch = (manifest?.catalogs || []).some((c) =>
                                                c.extra?.some((e) => e.name === "search")
                                            );
                                            if (hasSearch && !resourceNames.includes("search")) {
                                                resourceNames.push("search");
                                            }

                                            const newSet = new Set<string>(resourceNames);
                                            setSelectedResources(newSet);
                                            autoSaveResources(newSet);
                                            showToast.info("Resources reset to manifest defaults");
                                        }}
                                        size="sm"
                                        variant="ghost"
                                    >
                                        Reset
                                    </Button>
                                </div>
                            </div>

                            {allResources.length > 0 ? (
                                <div className="flex flex-wrap gap-2">
                                    {allResources.map((resource, index: number) => {
                                        const name =
                                            typeof resource === "string" ? resource : resource.name;
                                        const isSelected = selectedResources.has(name);

                                        return (
                                            <motion.button
                                                animate={{ opacity: 1, y: 0 }}
                                                className={
                                                    "group flex cursor-pointer items-center gap-2 whitespace-nowrap rounded-lg border border-default bg-surface-hover px-3 py-2 transition-all duration-200 hover:border-primary hover:bg-surface"
                                                }
                                                initial={{ opacity: 0, y: 10 }}
                                                key={`${name}-${index}`}
                                                onClick={() => handleResourceToggle(name)}
                                                transition={{ delay: index * 0.03 }}
                                            >
                                                {/* Content */}
                                                <span
                                                    className={`font-medium ${isSelected ? "text-default" : "text-subtle group-hover:text-default"}`}
                                                >
                                                    {name}
                                                </span>

                                                {/* Selection indicator circle */}
                                                <div
                                                    className={`flex h-4 w-4 flex-shrink-0 items-center justify-center rounded-full border-2 transition-all duration-200 ${
                                                        isSelected
                                                            ? "border-primary bg-primary"
                                                            : "border-default group-hover:border-primary/50"
                                                    }`}
                                                >
                                                    {isSelected && (
                                                        <motion.div
                                                            animate={{ scale: 1 }}
                                                            className="h-1.5 w-1.5 rounded-full bg-white"
                                                            initial={{ scale: 0 }}
                                                        />
                                                    )}
                                                </div>
                                            </motion.button>
                                        );
                                    })}
                                </div>
                            ) : (
                                <p className="text-sm text-subtle">No resources available</p>
                            )}
                        </Card>
                    </PageSection>

                    {/* Catalogs Section */}
                    <PageSection className="mb-8" delay={0.3}>
                        <Card padding="lg">
                            <div className="detail-section-header mb-6 flex items-center justify-between">
                                <div className="flex items-center gap-3">
                                    <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-green-500/20">
                                        <BookOpenIcon className="h-5 w-5 text-green-400" />
                                    </div>
                                    <div>
                                        <h3 className="font-semibold text-default text-lg">
                                            Catalogs
                                        </h3>
                                        <p className="text-muted text-sm">
                                            Select and reorder catalogs
                                        </p>
                                    </div>
                                </div>
                                <div className="flex h-9 flex-shrink-0 items-center gap-2">
                                    {isSavingCatalogs && (
                                        <div className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-t-transparent text-muted" />
                                    )}
                                    <Button
                                        leftIcon={<ArrowUturnLeftIcon className="h-4 w-4" />}
                                        onClick={() => {
                                            const manifest = originalManifestData || manifestData;
                                            const catalogs = manifest?.catalogs || [];

                                            const regularCatalogs = catalogs.filter((c) => {
                                                if (!c || typeof c !== "object") {
                                                    return true;
                                                }
                                                return !catalogHasSearch(c);
                                            });
                                            const searchCatalogs = catalogs.filter((c) => {
                                                if (!c || typeof c !== "object") {
                                                    return false;
                                                }
                                                return catalogHasSearch(c);
                                            });

                                            setOrderedRegularCatalogs(regularCatalogs);
                                            setOrderedSearchCatalogs(searchCatalogs);

                                            const allKeys = new Set<string>(
                                                catalogs
                                                    .map((c) => getCatalogKey(c))
                                                    .filter(Boolean)
                                            );
                                            setSelectedCatalogs(allKeys);
                                            autoSaveCatalogs(
                                                allKeys,
                                                regularCatalogs,
                                                searchCatalogs
                                            );
                                            showToast.info("Catalogs reset to manifest defaults");
                                        }}
                                        size="sm"
                                        variant="ghost"
                                    >
                                        Reset
                                    </Button>
                                </div>
                            </div>

                            <DndContext
                                collisionDetection={closestCenter}
                                onDragEnd={handleDragEnd}
                                onDragStart={handleDragStart}
                                sensors={sensors}
                            >
                                <div
                                    className="grid grid-cols-1 gap-6 md:grid-cols-2"
                                    style={{ userSelect: "none" }}
                                >
                                    {/* Regular Catalogs */}
                                    {orderedRegularCatalogs.length > 0 && (
                                        <div>
                                            <div className="mb-4 flex items-center justify-between">
                                                <div className="flex items-center gap-2">
                                                    <div className="h-1.5 w-1.5 rounded-full bg-green-400" />
                                                    <p className="font-semibold text-default text-xs uppercase tracking-wider">
                                                        Catalogs
                                                    </p>
                                                </div>
                                                <button
                                                    className="rounded-lg px-2 py-1 font-medium text-primary text-xs transition-colors hover:bg-primary/10 hover:text-primary-hover"
                                                    onClick={handleToggleAllRegular}
                                                    type="button"
                                                >
                                                    {allRegularSelected
                                                        ? "Deselect All"
                                                        : "Select All"}
                                                </button>
                                            </div>
                                            <SortableContext
                                                items={orderedRegularCatalogs.map(
                                                    (c) => getCatalogKey(c) || ""
                                                )}
                                                strategy={verticalListSortingStrategy}
                                            >
                                                <div className="space-y-2">
                                                    {orderedRegularCatalogs.map((catalog) => (
                                                        <SortableCatalogItem
                                                            catalog={catalog}
                                                            isSelected={selectedCatalogs.has(
                                                                getCatalogKey(catalog) || ""
                                                            )}
                                                            key={getCatalogKey(catalog)}
                                                            onToggle={() =>
                                                                handleCatalogToggle(
                                                                    getCatalogKey(catalog) || ""
                                                                )
                                                            }
                                                        />
                                                    ))}
                                                </div>
                                            </SortableContext>
                                        </div>
                                    )}

                                    {/* Search Catalogs */}
                                    {orderedSearchCatalogs.length > 0 && (
                                        <div>
                                            <div className="mb-4 flex items-center justify-between">
                                                <div className="flex items-center gap-2">
                                                    <div className="h-1.5 w-1.5 rounded-full bg-amber-400" />
                                                    <p className="font-semibold text-default text-xs uppercase tracking-wider">
                                                        Search Catalogs
                                                    </p>
                                                </div>
                                                <button
                                                    className="rounded-lg px-2 py-1 font-medium text-primary text-xs transition-colors hover:bg-primary/10 hover:text-primary-hover"
                                                    onClick={handleToggleAllSearch}
                                                    type="button"
                                                >
                                                    {allSearchSelected
                                                        ? "Deselect All"
                                                        : "Select All"}
                                                </button>
                                            </div>
                                            <SortableContext
                                                items={orderedSearchCatalogs.map(
                                                    (c) => getCatalogKey(c) || ""
                                                )}
                                                strategy={verticalListSortingStrategy}
                                            >
                                                <div className="space-y-2">
                                                    {orderedSearchCatalogs.map((catalog) => (
                                                        <SortableCatalogItem
                                                            catalog={catalog}
                                                            isSelected={selectedCatalogs.has(
                                                                getCatalogKey(catalog) || ""
                                                            )}
                                                            key={getCatalogKey(catalog)}
                                                            onToggle={() =>
                                                                handleCatalogToggle(
                                                                    getCatalogKey(catalog) || ""
                                                                )
                                                            }
                                                        />
                                                    ))}
                                                </div>
                                            </SortableContext>
                                        </div>
                                    )}

                                    {orderedRegularCatalogs.length === 0 &&
                                        orderedSearchCatalogs.length === 0 && (
                                            <p className="col-span-2 text-sm text-subtle">
                                                No catalogs available
                                            </p>
                                        )}
                                </div>
                                <DragOverlay>
                                    {(() => {
                                        if (!activeCatalogId) {
                                            return null;
                                        }
                                        const allCatalogs = [
                                            ...orderedRegularCatalogs,
                                            ...orderedSearchCatalogs,
                                        ];
                                        const activeCatalog = allCatalogs.find(
                                            (c) => getCatalogKey(c) === activeCatalogId
                                        );
                                        if (!activeCatalog) {
                                            return null;
                                        }
                                        return (
                                            <SortableCatalogItem
                                                catalog={activeCatalog}
                                                isSelected={selectedCatalogs.has(
                                                    getCatalogKey(activeCatalog) || ""
                                                )}
                                                onToggle={() =>
                                                    handleCatalogToggle(
                                                        getCatalogKey(activeCatalog) || ""
                                                    )
                                                }
                                            />
                                        );
                                    })()}
                                </DragOverlay>
                            </DndContext>
                        </Card>
                    </PageSection>

                    {/* Groups Section */}
                    <PageSection className="mb-8" delay={0.4}>
                        <Card padding="lg">
                            <div className="detail-section-header mb-6 flex items-center justify-between">
                                <div className="flex items-center gap-3">
                                    <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-500/20">
                                        <UsersIcon className="h-5 w-5 text-blue-400" />
                                    </div>
                                    <div>
                                        <h3 className="font-semibold text-default text-lg">
                                            Groups
                                        </h3>
                                        <p className="text-muted text-sm">
                                            {addon.groups?.length || 0} group
                                            {addon.groups?.length === 1 ? "" : "s"} using this addon
                                        </p>
                                    </div>
                                </div>
                                <Button
                                    leftIcon={<PlusIcon className="h-4 w-4" />}
                                    onClick={() => setIsAddToGroupModalOpen(true)}
                                    size="sm"
                                    variant="primary"
                                >
                                    Add to Group
                                </Button>
                            </div>

                            <StaggerContainer className="space-y-3">
                                {addon.groups && addon.groups.length > 0 ? (
                                    addon.groups.map((group) => (
                                        <StaggerItem key={group.id}>
                                            <Link href={`/groups/${group.id}`}>
                                                <motion.div
                                                    className="group flex cursor-pointer items-center gap-4 overflow-hidden rounded-xl border border-default bg-surface-hover p-4 transition-all hover:border-primary hover:bg-surface"
                                                    whileHover={{ x: 4 }}
                                                >
                                                    {/* Group colored avatar with first letter */}
                                                    <div
                                                        className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg font-bold text-sm text-white"
                                                        style={{
                                                            backgroundColor:
                                                                group.color || "#7c3aed",
                                                        }}
                                                    >
                                                        {group.name?.[0] || "G"}
                                                    </div>

                                                    <div className="min-w-0 flex-1">
                                                        <div className="flex items-center gap-2">
                                                            <span className="truncate font-medium text-default transition-colors group-hover:text-primary">
                                                                {group.name}
                                                            </span>
                                                        </div>
                                                        <p className="text-muted text-sm">
                                                            {group.users || 0} users •{" "}
                                                            {group.addons || 0} addons
                                                        </p>
                                                    </div>

                                                    {/* Sync Status Badge */}
                                                    <SyncBadge groupId={group.id} size="sm" />

                                                    <div
                                                        className="flex items-center gap-2 opacity-100 transition-opacity md:opacity-0 md:group-hover:opacity-100 md:focus-within:opacity-100"
                                                        onClick={(e) => e.preventDefault()}
                                                        role="none"
                                                    >
                                                        <Button
                                                            aria-label={`Sync ${group.name}`}
                                                            onClick={async (e) => {
                                                                e.preventDefault();
                                                                try {
                                                                    await api.syncGroup(group.id);
                                                                    toast.success(
                                                                        `Synced ${group.name} successfully`
                                                                    );
                                                                } catch (err) {
                                                                    toast.error(
                                                                        readErrorMessage(
                                                                            err,
                                                                            `Failed to sync ${group.name}`
                                                                        )
                                                                    );
                                                                }
                                                            }}
                                                            size="sm"
                                                            variant="ghost"
                                                        >
                                                            <ArrowPathIcon className="h-4 w-4" />
                                                        </Button>
                                                        <Button
                                                            aria-label={`Remove addon from ${group.name}`}
                                                            className="text-error hover:bg-error-muted"
                                                            onClick={(e) => {
                                                                e.preventDefault();
                                                                handleRemoveFromGroup(
                                                                    group.id,
                                                                    group.name
                                                                );
                                                            }}
                                                            size="sm"
                                                            variant="ghost"
                                                        >
                                                            <XMarkIcon className="h-4 w-4" />
                                                        </Button>
                                                    </div>
                                                </motion.div>
                                            </Link>
                                        </StaggerItem>
                                    ))
                                ) : (
                                    <div className="py-8 text-center">
                                        <FolderIcon className="mx-auto mb-4 h-12 w-12 text-muted opacity-50" />
                                        <p className="mb-4 text-muted">
                                            Not assigned to any groups
                                        </p>
                                        <Button
                                            leftIcon={<PlusIcon className="h-4 w-4" />}
                                            onClick={() => setIsAddToGroupModalOpen(true)}
                                            size="sm"
                                            variant="secondary"
                                        >
                                            Add to First Group
                                        </Button>
                                    </div>
                                )}
                            </StaggerContainer>
                        </Card>
                    </PageSection>

                    {/* Health History Section */}
                    <PageSection className="mb-8" delay={0.5}>
                        <AddonHealthHistorySection addonId={params.id as string} />
                    </PageSection>

                    {/* Backup Section */}
                    <AddonBackupSection
                        addon={addon}
                        addonId={params.id as string}
                        onUpdate={fetchAddon}
                    />

                    {/* Proxy Section */}
                    <PageSection className="mb-8" delay={0.55}>
                        <Card padding="lg">
                            <div className="mb-4 flex items-center justify-between">
                                <div className="flex items-center gap-3">
                                    <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-indigo-500/20">
                                        <ShieldCheckIcon className="h-5 w-5 text-indigo-400" />
                                    </div>
                                    <div>
                                        <h3 className="font-semibold text-default text-lg">
                                            Proxy
                                        </h3>
                                        <p className="text-muted text-sm">
                                            Hide the original addon URL with a proxied endpoint
                                        </p>
                                    </div>
                                </div>
                                <div className="flex items-center gap-2">
                                    <span className="text-muted text-sm">
                                        {anyAddon?.proxyEnabled ? "Enabled" : "Disabled"}
                                    </span>
                                    <ToggleSwitch
                                        checked={anyAddon?.proxyEnabled || false}
                                        disabled={isTogglingProxy}
                                        onChange={handleToggleProxy}
                                        title="Proxy streams"
                                    />
                                </div>
                            </div>

                            {/* Vault-injection - the step past proxying: the stored URL
                itself stops containing the key. */}
                            <div className="mb-4 flex items-center justify-between gap-3 rounded-lg bg-surface-hover p-3">
                                <div className="min-w-0">
                                    <p className="font-medium text-default text-sm">
                                        Keys stay in the Vault
                                    </p>
                                    <p className="mt-0.5 text-muted text-xs">
                                        {anyAddon?.vaultified
                                            ? "The stored URL holds a placeholder, not the key. Rotating the Vault entry needs no rewrite and no re-sync - the proxy resolves the current secret on every request."
                                            : "Replace the key inside the addon URL with a Vault reference. The real key then never appears in the stored URL, synced manifests, or on any device."}
                                    </p>
                                </div>
                                <Button
                                    isLoading={isVaultifying}
                                    onClick={handleToggleVaultify}
                                    size="sm"
                                    variant={anyAddon?.vaultified ? "ghost" : "secondary"}
                                >
                                    {anyAddon?.vaultified ? "Restore plain URL" : "Vault-inject"}
                                </Button>
                            </div>

                            {anyAddon?.proxyEnabled && (
                                <div className="space-y-4">
                                    <div className="rounded-xl border border-default bg-surface p-4">
                                        <div className="mb-3 flex items-center gap-3">
                                            <ShieldCheckIcon className="h-5 w-5 text-success" />
                                            <span className="font-medium text-default text-sm">
                                                Proxy URL
                                            </span>
                                        </div>

                                        {proxyUrlFor(
                                            anyAddon?.proxyUuid,
                                            anyAddon?.proxyManifestUrl
                                        ) ? (
                                            <div className="flex items-center gap-2">
                                                <code className="flex-1 break-all rounded-lg bg-surface-hover p-2 font-mono text-subtle text-xs">
                                                    {proxyUrlFor(
                                                        anyAddon?.proxyUuid,
                                                        anyAddon?.proxyManifestUrl
                                                    )}
                                                </code>
                                                <Button
                                                    onClick={() => {
                                                        copyToClipboard(
                                                            proxyUrlFor(
                                                                anyAddon?.proxyUuid,
                                                                anyAddon?.proxyManifestUrl
                                                            ) || ""
                                                        );
                                                        toast.success("Copied to clipboard");
                                                    }}
                                                    size="sm"
                                                    variant="ghost"
                                                >
                                                    <DocumentDuplicateIcon className="h-4 w-4" />
                                                </Button>
                                            </div>
                                        ) : (
                                            <p className="text-sm text-subtle">
                                                Proxy URL will be generated when enabled
                                            </p>
                                        )}
                                    </div>

                                    <div className="flex items-center justify-between rounded-lg bg-surface-hover p-3">
                                        <div className="flex items-center gap-2">
                                            <span className="text-muted text-xs">UUID:</span>
                                            <code className="font-mono text-subtle text-xs">
                                                {anyAddon?.proxyUuid || "Not generated"}
                                            </code>
                                        </div>
                                        <Button
                                            disabled={!anyAddon?.proxyEnabled}
                                            isLoading={isRegeneratingProxy}
                                            onClick={handleRegenerateProxyUuid}
                                            size="sm"
                                            variant="ghost"
                                        >
                                            <ArrowPathIcon className="mr-1 h-4 w-4" />
                                            Regenerate
                                        </Button>
                                    </div>

                                    <div className="text-subtle text-xs">
                                        <p className="mb-1">
                                            When enabled, users access this addon through a proxy
                                            URL that hides the original addon URL.
                                        </p>
                                        <p>
                                            The proxy provides an additional layer of security by
                                            preventing users from seeing or accessing the original
                                            manifest URL directly.
                                        </p>
                                    </div>
                                </div>
                            )}
                        </Card>
                    </PageSection>
                </div>
            </div>

            {/* Edit Modal */}
            <Modal
                description="Update addon details"
                isOpen={isEditModalOpen}
                onClose={() => setIsEditModalOpen(false)}
                size="md"
                title="Edit Addon"
            >
                <div className="space-y-4">
                    <div>
                        <label
                            className="mb-1 block font-medium text-default text-sm"
                            htmlFor={`${fieldId1}-1`}
                        >
                            Name
                        </label>
                        <Input
                            id={`${fieldId1}-1`}
                            onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
                            placeholder="Addon name"
                            value={editForm.name}
                        />
                    </div>
                    <div>
                        <label
                            className="mb-1 block font-medium text-default text-sm"
                            htmlFor={`${fieldId1}-2`}
                        >
                            Description
                        </label>
                        <textarea
                            className="min-h-[80px] w-full rounded-lg border border-default bg-surface px-3 py-2 text-default placeholder:text-subtle focus:border-theme-secondary focus:outline-none"
                            id={`${fieldId1}-2`}
                            onChange={(e) =>
                                setEditForm({ ...editForm, description: e.target.value })
                            }
                            placeholder="Addon description"
                            value={editForm.description}
                        />
                    </div>
                    <div>
                        <label
                            className="mb-1 block font-medium text-default text-sm"
                            htmlFor={`${fieldId1}-3`}
                        >
                            Custom Logo URL
                        </label>
                        <Input
                            id={`${fieldId1}-3`}
                            onChange={(e) =>
                                setEditForm({ ...editForm, customLogo: e.target.value })
                            }
                            placeholder="https://example.com/logo.png"
                            value={editForm.customLogo}
                        />
                        <p className="mt-1 text-subtle text-xs">
                            Leave empty to use the default logo from the manifest.
                        </p>
                    </div>
                    <div className="flex justify-end gap-2 pt-4">
                        <Button onClick={() => setIsEditModalOpen(false)} variant="secondary">
                            Cancel
                        </Button>
                        <Button onClick={handleSaveEdit}>Save Changes</Button>
                    </div>
                </div>
            </Modal>

            {/* Delete Confirmation */}
            <ConfirmModal
                confirmText={isDeleting ? "Deleting..." : "Delete"}
                description={`Are you sure you want to delete "${addon.name}"? This action cannot be undone.`}
                isLoading={isDeleting}
                isOpen={isDeleteModalOpen}
                onClose={() => setIsDeleteModalOpen(false)}
                onConfirm={handleDelete}
                title="Delete Addon"
                variant="danger"
            />

            {/* Add to Group Modal */}
            <Modal
                description="Select a group to add this addon to"
                isOpen={isAddToGroupModalOpen}
                onClose={() => setIsAddToGroupModalOpen(false)}
                size="md"
                title="Add to Group"
            >
                <div className="space-y-4">
                    <div className="max-h-64 space-y-2 overflow-auto">
                        {allGroups
                            .filter((g) => !addon.groups?.some((ag) => ag.id === g.id))
                            .map((group) => (
                                <motion.button
                                    className="w-full rounded-xl border border-default p-3 text-left transition-all hover:border-primary hover:bg-surface-hover"
                                    key={group.id}
                                    onClick={async () => {
                                        try {
                                            await api.addAddonToGroup(group.id, addon.id);
                                            toast.success(`Added to ${group.name}`);
                                            await fetchAddon();
                                            setIsAddToGroupModalOpen(false);
                                        } catch (err) {
                                            toast.error(
                                                readErrorMessage(err, "Failed to add to group")
                                            );
                                        }
                                    }}
                                    whileHover={{ x: 4 }}
                                >
                                    <div className="flex items-center gap-3">
                                        <div className="flex h-10 w-10 items-center justify-center rounded-lg border border-default bg-surface">
                                            <FolderIcon className="h-5 w-5 text-muted" />
                                        </div>
                                        <div>
                                            <p className="font-medium text-default">{group.name}</p>
                                            <p className="text-subtle text-xs">
                                                {group.users || 0} users • {group.addons || 0}{" "}
                                                addons
                                            </p>
                                        </div>
                                        <PlusIcon className="ml-auto h-5 w-5 text-primary" />
                                    </div>
                                </motion.button>
                            ))}
                    </div>
                    {allGroups.filter((g) => !addon.groups?.some((ag) => ag.id === g.id)).length ===
                        0 && (
                        <div className="py-8 text-center">
                            <FolderIcon className="mx-auto mb-2 h-8 w-8 text-muted opacity-50" />
                            <p className="text-sm text-subtle">
                                No available groups. This addon is already in all groups.
                            </p>
                        </div>
                    )}
                    <div className="flex justify-end pt-4">
                        <Button onClick={() => setIsAddToGroupModalOpen(false)} variant="secondary">
                            Cancel
                        </Button>
                    </div>
                </div>
            </Modal>
        </>
    );
}

// Addon Backup Section Component
function BackupAddonPickerModal({
    isOpen,
    onClose,
    onSelect,
    currentAddonId,
    excludeIds = [],
}: {
    isOpen: boolean;
    onClose: () => void;
    onSelect: (addonId: string) => void;
    currentAddonId: string;
    excludeIds?: string[];
}) {
    const [addons, setAddons] = useState<Addon[]>([]);
    const [search, setSearch] = useState("");
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        if (!isOpen) {
            return;
        }
        setLoading(true);
        setSearch("");
        api.getAddons()
            .then((data) => {
                // Exclude current addon and all addons in the backup chain
                const excluded = new Set([currentAddonId, ...excludeIds]);
                setAddons(data.filter((a) => !excluded.has(a.id)));
                setLoading(false);
            })
            .catch(() => setLoading(false));
    }, [isOpen, currentAddonId, excludeIds]);

    const filtered = addons.filter((a) => {
        if (!search) {
            return true;
        }
        const q = search.toLowerCase();
        return (
            (a.name || "").toLowerCase().includes(q) ||
            (a.description || "").toLowerCase().includes(q)
        );
    });

    return (
        <Modal
            description="Choose an existing addon to use as a fallback"
            isOpen={isOpen}
            onClose={onClose}
            size="lg"
            title="Select Backup Addon"
        >
            <div className="mb-4">
                <div
                    className="flex items-center gap-3 rounded-xl border px-4 py-3 transition-all"
                    style={{
                        backgroundColor: "var(--color-surface-hover)",
                        borderColor: "var(--color-surface-border)",
                    }}
                >
                    <svg
                        aria-hidden="true"
                        className="h-4 w-4 shrink-0"
                        fill="none"
                        focusable="false"
                        stroke="currentColor"
                        strokeWidth={2}
                        style={{ color: "var(--color-text-muted)" }}
                        viewBox="0 0 24 24"
                    >
                        <path
                            d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                        />
                    </svg>
                    <input
                        autoFocus
                        className="flex-1 bg-transparent text-sm outline-none"
                        onChange={(e) => setSearch(e.target.value)}
                        placeholder="Search addons..."
                        style={{ color: "var(--color-text)" }}
                        value={search}
                    />
                </div>
            </div>

            <div
                className="-mx-1 max-h-[380px] space-y-1.5 overflow-y-auto px-1"
                style={{ scrollbarWidth: "thin" }}
            >
                {loading ? (
                    <div className="flex items-center justify-center py-12">
                        <motion.div
                            animate={{ rotate: 360 }}
                            className="h-6 w-6 rounded-full border-2 border-t-transparent"
                            style={{
                                borderColor: "var(--color-primary)",
                                borderTopColor: "transparent",
                            }}
                            transition={{
                                duration: 1,
                                ease: "linear",
                                repeat: Number.POSITIVE_INFINITY,
                            }}
                        />
                    </div>
                ) : filtered.length === 0 ? (
                    <div className="py-12 text-center">
                        <PuzzlePieceIcon
                            className="mx-auto mb-3 h-10 w-10"
                            style={{ color: "var(--color-text-subtle)" }}
                        />
                        <p className="text-sm" style={{ color: "var(--color-text-muted)" }}>
                            {search ? "No addons match your search" : "No other addons available"}
                        </p>
                    </div>
                ) : (
                    filtered.map((addon) => {
                        const logo =
                            addon.customLogo ||
                            addon.logo ||
                            addon.iconUrl ||
                            addon.manifest?.logo ||
                            null;
                        return (
                            <motion.button
                                className="group hov-outline-row flex w-full items-center gap-4 rounded-xl p-3.5 text-left transition-all"
                                key={addon.id}
                                onClick={() => {
                                    onSelect(addon.id);
                                    onClose();
                                }}
                                whileHover={{ scale: 1.005 }}
                                whileTap={{ scale: 0.995 }}
                            >
                                {/* Addon icon */}
                                <div
                                    className="flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-xl"
                                    style={{
                                        background: "var(--color-surface-hover)",
                                        border: "1px solid var(--color-surface-border)",
                                    }}
                                >
                                    {logo ? (
                                        <img
                                            alt=""
                                            className="h-full w-full object-contain p-1.5"
                                            height={44}
                                            src={logo}
                                            width={44}
                                        />
                                    ) : (
                                        <PuzzlePieceIcon
                                            className="h-5 w-5"
                                            style={{ color: "var(--color-primary)" }}
                                        />
                                    )}
                                </div>

                                {/* Info */}
                                <div className="min-w-0 flex-1">
                                    <div className="flex items-center gap-2">
                                        <span
                                            className="truncate font-medium text-sm"
                                            style={{ color: "var(--color-text)" }}
                                        >
                                            {addon.name || "Unnamed Addon"}
                                        </span>
                                        {addon.version && (
                                            <span
                                                className="shrink-0 rounded-full px-1.5 py-0.5 font-medium text-[10px]"
                                                style={{
                                                    background: "var(--color-primaryMuted)",
                                                    color: "var(--color-primary)",
                                                }}
                                            >
                                                v{addon.version}
                                            </span>
                                        )}
                                    </div>
                                    {addon.description && (
                                        <p
                                            className="mt-0.5 truncate text-xs"
                                            style={{ color: "var(--color-text-muted)" }}
                                        >
                                            {addon.description}
                                        </p>
                                    )}
                                </div>

                                {/* Status dot */}
                                <div className="flex shrink-0 items-center gap-2">
                                    <div
                                        className={`h-2 w-2 rounded-full ${addon.isOnline ? "bg-success" : "bg-error"}`}
                                    />
                                    <span
                                        className="text-xs"
                                        style={{ color: "var(--color-text-subtle)" }}
                                    >
                                        {addon.isOnline ? "Online" : "Offline"}
                                    </span>
                                </div>
                            </motion.button>
                        );
                    })
                )}
            </div>
        </Modal>
    );
}

function AddonBackupSection({
    addonId,
    addon,
    onUpdate,
}: {
    addonId: string;
    addon: Addon;
    onUpdate: () => void;
}) {
    const [loading, setLoading] = useState(false);
    const [isPickerOpen, setIsPickerOpen] = useState(false);
    const [isRemoveModalOpen, setIsRemoveModalOpen] = useState(false);
    const [targetAddonId, setTargetAddonId] = useState<string>(addonId);
    const [activeAddonInfo, setActiveAddonInfo] = useState<{
        chain: Array<{
            id: string;
            name: string;
            isActive: boolean;
            isOnline: boolean;
            lastHealthCheck: string | null;
        }>;
        activeAddon: {
            id: string;
            name: string;
            isActive: boolean;
            isOnline: boolean;
            lastHealthCheck: string | null;
        };
        isUsingBackup: boolean;
        totalChainLength: number;
        message: string;
    } | null>(null);

    // Fetch active addon info
    useEffect(() => {
        const fetchActiveInfo = async () => {
            try {
                const info = await api.getAddonBackupActive(addonId);
                setActiveAddonInfo(info);
            } catch (error) {
                console.error("Failed to fetch active addon info:", error);
            }
        };
        fetchActiveInfo();
    }, [addonId, addon]);

    // Build the backup chain from addon data - recursively traverse the chain
    const buildChain = (startAddon: Pick<Addon, "backupAddon">): AddonBackup[] => {
        const chain: AddonBackup[] = [];

        // Recursive function to traverse the entire chain
        const traverse = (addonLocal: Pick<Addon, "backupAddon">) => {
            if (addonLocal?.backupAddon) {
                chain.push(addonLocal.backupAddon);
                // Continue traversing if this backup also has a backup
                traverse(addonLocal.backupAddon);
            }
        };

        traverse(startAddon);
        return chain;
    };

    const backupChain = buildChain(addon);
    const lastAddonInChain = backupChain.at(-1) ?? addon;

    const handleSelectBackup = async (backupId: string) => {
        setLoading(true);
        try {
            // Add backup to the LAST addon in the chain
            await api.setAddonBackup(targetAddonId, backupId);
            toast.success("Backup addon linked successfully");
            onUpdate();
        } catch (error) {
            toast.error(readErrorMessage(error, "Failed to link backup"));
        } finally {
            setLoading(false);
            setIsPickerOpen(false);
        }
    };

    const handleRemoveBackup = async () => {
        setLoading(true);
        try {
            await api.deleteAddonBackup(addonId);
            toast.success("Backup addon unlinked");
            setIsRemoveModalOpen(false);
            onUpdate();
        } catch (error) {
            toast.error(readErrorMessage(error, "Failed to unlink backup"));
        } finally {
            setLoading(false);
        }
    };

    const openPickerForAddon = (targetId: string) => {
        setTargetAddonId(targetId);
        setIsPickerOpen(true);
    };

    // Derive logos helper - same logic as addons list page
    const getLogo = (
        a:
            | Pick<AddonBackup, "customLogo" | "manifest" | "logo" | "iconUrl" | "stremioAddonId">
            | null
            | undefined
    ) => {
        if (!a) {
            return null;
        }
        return (
            a.customLogo ||
            a.manifest?.logo ||
            a.logo ||
            a.iconUrl ||
            (a.manifest?.id && `https://stremio-addon.netlify.app/${a.manifest.id}/icon.png`) ||
            null
        );
    };

    return (
        <PageSection className="mb-8" delay={0.5}>
            <Card padding="lg">
                {/* Section Header */}
                <div className="detail-section-header mb-6 flex items-center justify-between">
                    <div className="flex items-center gap-3">
                        <div
                            className="flex h-10 w-10 items-center justify-center rounded-xl"
                            style={{ background: "rgba(245, 158, 11, 0.15)" }}
                        >
                            <ShieldCheckIcon className="h-5 w-5" style={{ color: "#f59e0b" }} />
                        </div>
                        <div>
                            <h3
                                className="font-semibold text-lg"
                                style={{ color: "var(--color-text)" }}
                            >
                                Backup Addon
                            </h3>
                            <p className="text-xs" style={{ color: "var(--color-text-muted)" }}>
                                Assign a fallback addon for when the primary goes offline
                            </p>
                        </div>
                    </div>
                </div>

                {/* Backup Chain - Vertical Layout */}
                <div className="space-y-3">
                    {/* Primary Addon */}
                    <div
                        className="relative overflow-hidden rounded-xl border p-4"
                        style={{
                            background: "var(--color-surface-hover)",
                            borderColor: "var(--color-surface-border)",
                        }}
                    >
                        <div className="mb-3 flex items-center gap-1.5">
                            <div
                                className="h-1.5 w-1.5 rounded-full"
                                style={{ background: "var(--color-primary)" }}
                            />
                            <span
                                className="font-semibold text-[10px] uppercase tracking-wider"
                                style={{ color: "var(--color-primary)" }}
                            >
                                Primary
                            </span>
                            {activeAddonInfo && activeAddonInfo.activeAddon.id === addon.id && (
                                <span
                                    className="ml-2 rounded-full px-2 py-0.5 font-medium text-[10px]"
                                    style={{
                                        background: "var(--color-successMuted)",
                                        color: "var(--color-success)",
                                    }}
                                >
                                    Currently Active
                                </span>
                            )}
                        </div>
                        <div className="flex items-center gap-3">
                            <div
                                className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-lg"
                                style={{
                                    background: "var(--color-surface)",
                                    border: "1px solid var(--color-surface-border)",
                                }}
                            >
                                {getLogo(addon) ? (
                                    <img
                                        alt=""
                                        className="h-full w-full object-contain p-1"
                                        height={40}
                                        src={getLogo(addon) ?? undefined}
                                        width={40}
                                    />
                                ) : (
                                    <PuzzlePieceIcon
                                        className="h-5 w-5"
                                        style={{ color: "var(--color-primary)" }}
                                    />
                                )}
                            </div>
                            <div className="min-w-0 flex-1">
                                <div className="flex items-center gap-2">
                                    <p
                                        className="truncate font-medium text-sm"
                                        style={{ color: "var(--color-text)" }}
                                    >
                                        {addon?.name || "Current Addon"}
                                    </p>
                                    {addon?.version && (
                                        <span
                                            className="shrink-0 rounded-full px-1.5 py-0.5 font-medium text-[10px]"
                                            style={{
                                                background: "var(--color-primaryMuted)",
                                                color: "var(--color-primary)",
                                            }}
                                        >
                                            v{addon.version}
                                        </span>
                                    )}
                                </div>
                                <div className="mt-0.5 flex items-center gap-2">
                                    <div
                                        className={`h-1.5 w-1.5 rounded-full ${addon?.isOnline === false ? "bg-error" : "bg-success"}`}
                                    />
                                    <span
                                        className="text-[11px]"
                                        style={{ color: "var(--color-text-subtle)" }}
                                    >
                                        {addon?.isOnline === false ? "Offline" : "Online"}
                                    </span>
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* Connector - Arrow only, no lines */}
                    <div className="flex items-center justify-center py-1">
                        <div
                            className={`flex h-6 w-6 items-center justify-center rounded-full ${backupChain.length > 0 ? "chain-link-on" : "chain-link-off"}`}
                        >
                            <svg
                                aria-hidden="true"
                                className="h-3 w-3"
                                fill="none"
                                focusable="false"
                                stroke="currentColor"
                                strokeWidth={2.5}
                                viewBox="0 0 24 24"
                            >
                                <path
                                    d="M19.5 8.25l-7.5 7.5-7.5-7.5"
                                    strokeLinecap="round"
                                    strokeLinejoin="round"
                                />
                            </svg>
                        </div>
                    </div>

                    {/* Backup Chain - flattened structure for consistent spacing */}
                    {backupChain.flatMap((backup, index) => [
                        // Card
                        <motion.div
                            animate={{ opacity: 1, y: 0 }}
                            className="group relative overflow-hidden rounded-xl border p-4"
                            initial={{ opacity: 0, y: -10 }}
                            key={backup.id}
                            style={{
                                background: "var(--color-surface-hover)",
                                borderColor: "var(--color-surface-border)",
                            }}
                            transition={{ delay: index * 0.1, duration: 0.3 }}
                        >
                            <div className="mb-3 flex items-center justify-between">
                                <div className="flex items-center gap-1.5">
                                    <div
                                        className="h-1.5 w-1.5 rounded-full"
                                        style={{ background: "var(--color-primary)" }}
                                    />
                                    <span
                                        className="font-semibold text-[10px] uppercase tracking-wider"
                                        style={{ color: "var(--color-primary)" }}
                                    >
                                        Backup {index + 1}
                                    </span>
                                    {activeAddonInfo &&
                                        activeAddonInfo.activeAddon.id === backup.id && (
                                            <span
                                                className="ml-2 rounded-full px-2 py-0.5 font-medium text-[10px]"
                                                style={{
                                                    background: "var(--color-successMuted)",
                                                    color: "var(--color-success)",
                                                }}
                                            >
                                                Currently Active
                                            </span>
                                        )}
                                </div>
                                <motion.button
                                    className="rounded-lg p-1 opacity-100 transition-opacity md:opacity-0 md:group-hover:opacity-100 md:focus-within:opacity-100"
                                    onClick={() => setIsRemoveModalOpen(true)}
                                    style={{ color: "var(--color-error)" }}
                                    title="Remove backup chain"
                                    whileHover={{ scale: 1.1 }}
                                    whileTap={{ scale: 0.9 }}
                                >
                                    <XMarkIcon className="h-4 w-4" />
                                </motion.button>
                            </div>

                            <div className="flex items-center gap-3">
                                <div
                                    className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-lg"
                                    style={{
                                        background: "var(--color-surface)",
                                        border: "1px solid var(--color-surface-border)",
                                    }}
                                >
                                    {getLogo(backup) ? (
                                        <img
                                            alt=""
                                            className="h-full w-full object-contain p-1"
                                            height={40}
                                            src={getLogo(backup) ?? undefined}
                                            width={40}
                                        />
                                    ) : (
                                        <PuzzlePieceIcon
                                            className="h-5 w-5"
                                            style={{ color: "var(--color-primary)" }}
                                        />
                                    )}
                                </div>
                                <div className="min-w-0 flex-1">
                                    <div className="flex items-center gap-2">
                                        <Link
                                            className="truncate font-medium text-sm hover:underline"
                                            href={`/addons/${backup.id}`}
                                            style={{ color: "var(--color-text)" }}
                                        >
                                            {backup.name || "Unnamed Addon"}
                                        </Link>
                                        {backup.version && (
                                            <span
                                                className="shrink-0 rounded-full px-1.5 py-0.5 font-medium text-[10px]"
                                                style={{
                                                    background: "var(--color-primaryMuted)",
                                                    color: "var(--color-primary)",
                                                }}
                                            >
                                                v{backup.version}
                                            </span>
                                        )}
                                    </div>
                                    <div className="mt-0.5 flex items-center gap-2">
                                        <div
                                            className={`h-1.5 w-1.5 rounded-full ${backup.isOnline ? "animate-pulse bg-success" : "bg-error"}`}
                                        />
                                        <span
                                            className="text-[11px]"
                                            style={{ color: "var(--color-text-subtle)" }}
                                        >
                                            {backup.isOnline ? "Online" : "Offline"}
                                        </span>
                                    </div>
                                </div>
                            </div>
                        </motion.div>,
                        // Arrow after each backup
                        <div
                            className="flex items-center justify-center py-1"
                            key={`arrow-${backup.id}`}
                        >
                            <div
                                className="flex h-6 w-6 items-center justify-center rounded-full"
                                style={{
                                    background: "rgba(245, 158, 11, 0.15)",
                                    border: "1.5px solid rgba(245, 158, 11, 0.4)",
                                }}
                            >
                                <svg
                                    aria-hidden="true"
                                    className="h-3 w-3"
                                    fill="none"
                                    focusable="false"
                                    stroke="currentColor"
                                    strokeWidth={2.5}
                                    style={{ color: "#f59e0b" }}
                                    viewBox="0 0 24 24"
                                >
                                    <path
                                        d="M19.5 8.25l-7.5 7.5-7.5-7.5"
                                        strokeLinecap="round"
                                        strokeLinejoin="round"
                                    />
                                </svg>
                            </div>
                        </div>,
                    ])}

                    {/* Add Backup Button - Always at the end */}
                    <motion.button
                        className="group hov-amber-add flex w-full items-center justify-center gap-3 rounded-xl border-2 border-dashed p-4 transition-all"
                        disabled={loading}
                        onClick={() => openPickerForAddon(lastAddonInChain.id)}
                        style={{ minHeight: backupChain.length === 0 ? "96px" : "64px" }}
                        whileHover={{ scale: 1.01 }}
                        whileTap={{ scale: 0.99 }}
                    >
                        <div
                            className="flex h-9 w-9 items-center justify-center rounded-xl transition-colors"
                            style={{ background: "var(--color-surface-hover)" }}
                        >
                            <PlusIcon
                                className="h-5 w-5"
                                style={{ color: "var(--color-text-subtle)" }}
                            />
                        </div>
                        <span
                            className="font-medium text-xs"
                            style={{ color: "var(--color-text-muted)" }}
                        >
                            {backupChain.length === 0 ? "Add Backup" : "Add Another Backup"}
                        </span>
                    </motion.button>
                </div>

                {/* Info text */}
                <p
                    className="pt-2 text-center text-[11px]"
                    style={{ color: "var(--color-text-subtle)" }}
                >
                    {backupChain.length === 0
                        ? "Add a backup addon that will be used when the primary is offline"
                        : activeAddonInfo
                          ? `${activeAddonInfo.message} • Chain depth: ${activeAddonInfo.totalChainLength} addons`
                          : `Chain depth: ${backupChain.length + 1} addons. If one fails, the next will be used.`}
                </p>

                {/* How "offline" is decided for THIS addon, plus a one-click path
            into the automation engine's existing addon.offline trigger -
            failover config and failover trigger, side by side. */}
                {addon && (
                    <AddonHealthSettings
                        addonId={addonId}
                        addonName={addon.name || "Addon"}
                        healthConfig={
                            (
                                addon as unknown as {
                                    healthConfig?: import("@/lib/api").AddonHealthConfig | null;
                                }
                            ).healthConfig
                        }
                        onSaved={() => {
                            /* server state updated; next health cycle uses it */
                        }}
                    />
                )}
            </Card>

            {/* Addon Picker Modal */}
            <BackupAddonPickerModal
                currentAddonId={addonId}
                excludeIds={backupChain.map((b) => b.id)}
                isOpen={isPickerOpen}
                onClose={() => setIsPickerOpen(false)}
                onSelect={handleSelectBackup}
            />

            {/* Remove Confirmation */}
            <ConfirmModal
                confirmText="Remove"
                description="This will unlink the entire backup chain. The backup addons themselves won't be deleted."
                isLoading={loading}
                isOpen={isRemoveModalOpen}
                onClose={() => setIsRemoveModalOpen(false)}
                onConfirm={handleRemoveBackup}
                title="Remove Backup Chain"
                variant="danger"
            />
        </PageSection>
    );
}

// Addon Health History Section Component
function AddonHealthHistorySection({ addonId }: { addonId: string }) {
    const [history, setHistory] = useState<
        Array<{
            id: string;
            isOnline: boolean;
            error: string | null;
            checkedAt: string;
            responseTimeMs: number | null;
        }>
    >([]);
    const [loading, setLoading] = useState(true);
    const [isChecking, setIsChecking] = useState(false);
    const [error, setError] = useState<string | null>(null);
    // Null while loading/not-yet-fetched or when there's nothing to summarize
    // (clean history, or no AI key configured) - the raw log below covers
    // both cases fine on its own, so this only ever renders when it has
    // something genuinely useful to add.
    const [aiSummary, setAiSummary] = useState<string | null>(null);

    const fetchHistory = useCallback(async () => {
        try {
            setLoading(true);
            const data = await api.getAddonHealthHistory(addonId, 50);
            setHistory(data.history);
        } catch (err) {
            setError(readErrorMessage(err, "Failed to load health history"));
        } finally {
            setLoading(false);
        }
    }, [addonId]);

    useEffect(() => {
        fetchHistory();
        api.getAddonHealthSummary(addonId)
            .then((r) => setAiSummary(r.summary))
            .catch(() => setAiSummary(null));
    }, [fetchHistory, addonId]);

    const handleCheckNow = async () => {
        setIsChecking(true);
        try {
            await api.runAddonHealthCheckNow();
            // Give the server a moment to complete the check then refresh
            await new Promise((resolve) => setTimeout(resolve, 2500));
            await fetchHistory();
            api.getAddonHealthSummary(addonId)
                .then((r) => setAiSummary(r.summary))
                .catch(() => undefined);
            toast.success("Health check complete");
        } catch (err) {
            toast.error(readErrorMessage(err, "Health check failed"));
        } finally {
            setIsChecking(false);
        }
    };

    if (loading) {
        return (
            <Card padding="lg">
                <div className="detail-section-header mb-6 flex items-center justify-between">
                    <div className="flex items-center gap-3">
                        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-rose-500/20">
                            <HeartIcon className="h-5 w-5 text-rose-400" />
                        </div>
                        <div>
                            <h3 className="font-semibold text-default text-lg">Health History</h3>
                            <p className="text-muted text-sm">Loading...</p>
                        </div>
                    </div>
                </div>
                <div className="max-h-[340px] space-y-3 overflow-y-auto">
                    {[1, 2, 3].map((i) => (
                        <div
                            className="flex animate-pulse items-center gap-4 overflow-hidden rounded-xl border border-default bg-surface-hover p-4"
                            key={i}
                        >
                            <div className="h-10 w-10 shrink-0 rounded-lg bg-muted" />
                            <div className="flex-1 space-y-2">
                                <div className="h-4 w-24 rounded bg-muted" />
                                <div className="h-3 w-48 rounded bg-muted" />
                            </div>
                        </div>
                    ))}
                </div>
            </Card>
        );
    }

    // Group consecutive same-status entries
    const groupedHistory: Array<{
        status: boolean;
        startTime: Date;
        endTime: Date;
        count: number;
        errors: string[];
    }> = [];

    for (const entry of history) {
        const entryTime = new Date(entry.checkedAt);
        const lastGroup = groupedHistory.at(-1);

        if (lastGroup && lastGroup.status === entry.isOnline) {
            lastGroup.endTime = entryTime;
            lastGroup.count++;
            if (entry.error && !lastGroup.errors.includes(entry.error)) {
                lastGroup.errors.push(entry.error);
            }
        } else {
            groupedHistory.push({
                count: 1,
                endTime: entryTime,
                errors: entry.error ? [entry.error] : [],
                startTime: entryTime,
                status: entry.isOnline,
            });
        }
    }

    return (
        <Card padding="lg">
            <div className="detail-section-header mb-6 flex items-center justify-between">
                <div className="flex items-center gap-3">
                    <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-rose-500/20">
                        <HeartIcon className="h-5 w-5 text-rose-400" />
                    </div>
                    <div>
                        <h3 className="font-semibold text-default text-lg">Health History</h3>
                        <p className="text-muted text-sm">
                            {history.length > 0 ? `Last ${history.length} checks` : "No checks yet"}
                        </p>
                    </div>
                </div>
                <Button
                    isLoading={isChecking}
                    leftIcon={
                        <ArrowPathIcon className={`h-4 w-4 ${isChecking ? "animate-spin" : ""}`} />
                    }
                    onClick={handleCheckNow}
                    size="sm"
                    variant="glass"
                >
                    Check Now
                </Button>
            </div>

            {aiSummary && (
                <div
                    className="mb-4 flex items-start gap-2.5 rounded-xl p-3 text-sm"
                    style={{
                        background: "var(--color-primary-muted)",
                        border: "1px solid var(--color-surface-border)",
                        color: "var(--color-text)",
                    }}
                >
                    <SparklesIcon
                        className="mt-0.5 h-4 w-4 shrink-0"
                        style={{ color: "var(--color-primary)" }}
                    />
                    <p>{aiSummary}</p>
                </div>
            )}

            {error || history.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-8 text-center">
                    <HeartIcon className="mb-3 h-10 w-10 text-muted opacity-30" />
                    <p className="text-sm text-subtle">
                        {error
                            ? error
                            : 'No health checks recorded yet. Click "Check Now" to run one.'}
                    </p>
                </div>
            ) : (
                <div className="max-h-[340px] space-y-3 overflow-y-auto">
                    {groupedHistory.map((group, index) => (
                        <motion.div
                            animate={{ opacity: 1, x: 0 }}
                            className="flex items-center gap-4 overflow-hidden rounded-xl border border-default bg-surface-hover p-4 transition-all hover:border-primary hover:bg-surface-hover/80"
                            initial={{ opacity: 0, x: -20 }}
                            key={index}
                            transition={{ delay: index * 0.05 }}
                        >
                            <div
                                className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg ${
                                    group.status ? "bg-success/20" : "bg-error/20"
                                }`}
                            >
                                <div
                                    className={`h-3 w-3 rounded-full ${
                                        group.status ? "bg-success" : "bg-error"
                                    }`}
                                />
                            </div>
                            <div className="min-w-0 flex-1">
                                <div className="flex items-center gap-2">
                                    <span
                                        className={`font-medium ${group.status ? "text-success" : "text-error"}`}
                                    >
                                        {group.status ? "Online" : "Offline"}
                                    </span>
                                    <span className="text-muted text-xs">
                                        {group.count > 1 ? `(${group.count} checks)` : ""}
                                    </span>
                                </div>
                                <div className="text-muted text-xs">
                                    {group.startTime.toLocaleString()}
                                    {group.count > 1 &&
                                        group.startTime.getTime() !== group.endTime.getTime() && (
                                            <span> - {group.endTime.toLocaleString()}</span>
                                        )}
                                </div>
                                {!group.status && group.errors.length > 0 && (
                                    <div
                                        className="mt-1 truncate text-error text-xs"
                                        title={group.errors.join(", ")}
                                    >
                                        {group.errors[0].length > 50
                                            ? `${group.errors[0].slice(0, 50)}...`
                                            : group.errors[0]}
                                        {group.errors.length > 1 &&
                                            ` (+${group.errors.length - 1} more)`}
                                    </div>
                                )}
                            </div>
                        </motion.div>
                    ))}
                </div>
            )}
        </Card>
    );
}
