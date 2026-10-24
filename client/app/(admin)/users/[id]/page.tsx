"use client";

import type { DragEndEvent } from "@dnd-kit/core";
import { arrayMove } from "@dnd-kit/sortable";
import {
    ArrowDownTrayIcon,
    ArrowPathIcon,
    ArrowUpTrayIcon,
    Bars3Icon,
    BoltIcon,
    CalendarIcon,
    CheckCircleIcon,
    ChevronDownIcon,
    ClockIcon,
    EyeIcon,
    EyeSlashIcon,
    FilmIcon,
    FireIcon,
    FolderIcon,
    LinkIcon,
    MagnifyingGlassIcon,
    PencilIcon,
    PlayIcon,
    PuzzlePieceIcon,
    ShieldCheckIcon,
    TrashIcon,
    TvIcon,
    UsersIcon,
    XMarkIcon,
} from "@heroicons/react/24/outline";
import { format } from "date-fns";
import { motion } from "framer-motion";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { memo, useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import {
    Area,
    AreaChart,
    Bar,
    BarChart,
    CartesianGrid,
    ResponsiveContainer,
    Tooltip,
    XAxis,
    YAxis,
} from "recharts";
import { AioHealthButton } from "@/components/jellyfin/AioHealthButton";
import { AioHistoryButton } from "@/components/jellyfin/AioHistoryButton";
import { AioRotateKeysRow } from "@/components/jellyfin/AioRotateKeysRow";
import { JellyfinDevicesButton } from "@/components/jellyfin/JellyfinDevicesButton";
import { MarkPlayedRow } from "@/components/jellyfin/MarkPlayedRow";
import { SignInTvButton } from "@/components/jellyfin/SignInTvButton";
import { DetailToolbar } from "@/components/layout/DetailToolbar";
import { Breadcrumbs, Header } from "@/components/layout/Header";
import { PageSection, StaggerContainer, StaggerItem } from "@/components/layout/PageContainer";
import { AvatarPickerModal } from "@/components/modals/AvatarPickerModal";
import { CreateUserModal } from "@/components/modals/CreateUserModal";
import { NuvioServersTile } from "@/components/nuvio/NuvioServersTile";
import { SignInNuvioTvButton } from "@/components/nuvio/SignInNuvioTvButton";
import {
    Badge,
    Button,
    Card,
    ConfirmModal,
    DateTimePicker,
    InlineEdit,
    Modal,
    ResourceBadge,
    Select,
    StatCard,
    SyncBadge,
    ToggleSwitch,
    UserAvatar,
    VersionBadge,
} from "@/components/ui";
import { DraggableList } from "@/components/ui/DragSortable";
import { FilterTabs } from "@/components/ui/FilterTabs";
import { SyncPreviewDialog } from "@/components/ui/SyncPreviewDialog";
import { toast } from "@/components/ui/Toast";
import { CatchUpButton } from "@/components/user/CatchUpButton";
import { CopyHistoryTile } from "@/components/user/CopyHistoryTile";
import { LimitsButton } from "@/components/user/LimitsButton";
import { SignInOfferBanner } from "@/components/user/SignInOfferBanner";
import { TraxRowsEditor } from "@/components/user/TraxRowsEditor";
import { WatchStateRow } from "@/components/user/WatchStateRow";
import { startAdaptivePoll } from "@/lib/adaptivePoll";
import {
    type Addon,
    api,
    type MergeCandidate,
    type MergeInfo,
    type MergePreview,
    type StremioAddon,
    type User,
} from "@/lib/api";
import { copyToClipboard } from "@/lib/clipboard";
import { readErrorMessage } from "@/lib/errors";
import { useLayoutMode } from "@/lib/layout-mode";
import {
    displayEmail,
    hasAddonList,
    isJellyfin,
    providerBadgeVariant,
    providerLabel,
} from "@/lib/providers";
import { useTheme } from "@/lib/theme";

// Watch time data type
interface WatchTimeDataPoint {
    date: string;
    minutes: number;
    movies: number;
    series: number;
}

// Mirrors server/utils/validation.js's canonicalizeManifestUrl() - Account
// Addons' transportUrl (raw, as installed on the provider account) rarely
// matches a SlickSync Addon's stored manifestUrl by exact string equality
// (http vs https, trailing /manifest.json, query strings, case), so a naive
// === comparison silently fails to find the match even when it's the same
// addon. Keep this in sync with the server version if that one changes.
function canonicalizeManifestUrl(raw: string | null | undefined): string {
    if (!raw) {
        return "";
    }
    try {
        let s = String(raw).trim();
        s = s.replace(/^@+/, "");
        let u = s.replace(/^https?:\/\//i, "").toLowerCase();
        u = u.split("?")[0].split("#")[0];
        u = u.replace(/\/manifest\.json$/i, "");
        u = u.replace(/\/+$/g, "");
        return u;
    } catch {
        return String(raw).trim().toLowerCase();
    }
}

function formatMinutes(minutes: number): string {
    if (minutes < 60) {
        return `${minutes}m`;
    }
    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;
    if (hours < 24) {
        return mins > 0 ? `${hours}h ${mins}m` : `${hours}h`;
    }
    const days = Math.floor(hours / 24);
    const remainingHours = hours % 24;
    return `${days}d ${remainingHours}h`;
}

// Memoized tooltip style to avoid recreating on each render (Vercel best practice: rerender-memo-with-default-value)
const TOOLTIP_STYLE = {
    backdropFilter: "blur(12px)",
    backgroundColor: "rgba(30, 30, 56, 0.9)",
    border: "1px solid rgba(255,255,255,0.1)",
    borderRadius: "12px",
} as const;

const TOOLTIP_LABEL_STYLE = { color: "#fff" } as const;

// Memoized chart components to prevent unnecessary re-renders (Vercel best practice: rerender-memo)
const WatchTimeChart = memo(function WatchTimeChartLocal({ data }: { data: WatchTimeDataPoint[] }) {
    // Calculate max minutes to determine ticks dynamically
    const maxMinutes = Math.max(...data.map((d) => d.minutes), 60);
    const hourTicks = Math.ceil(maxMinutes / 30);
    const ticks = Array.from({ length: hourTicks + 1 }, (_, i) => i * 30);

    return (
        <Card padding="lg">
            <div className="detail-section-header mb-6 flex items-center justify-between">
                <h3 className="font-display font-semibold text-default text-lg">Watch Time</h3>
                <div className="flex items-center gap-2">
                    <select
                        aria-label="Select time period"
                        className="rounded-lg border border-default bg-surface px-3 py-1.5 text-default text-sm"
                    >
                        <option>This Week</option>
                        <option>This Month</option>
                        <option>This Year</option>
                    </select>
                </div>
            </div>

            <div className="h-40 md:h-64">
                <ResponsiveContainer height="100%" width="100%">
                    <AreaChart data={data}>
                        <defs>
                            <linearGradient id="colorMinutes" x1="0" x2="0" y1="0" y2="1">
                                <stop
                                    offset="5%"
                                    stopColor="var(--color-chart-1)"
                                    stopOpacity={0.4}
                                />
                                <stop
                                    offset="95%"
                                    stopColor="var(--color-chart-1)"
                                    stopOpacity={0}
                                />
                            </linearGradient>
                        </defs>
                        <CartesianGrid stroke="rgba(255,255,255,0.1)" strokeDasharray="3 3" />
                        <XAxis dataKey="date" fontSize={12} stroke="#64748b" />
                        <YAxis
                            fontSize={12}
                            stroke="#64748b"
                            tickFormatter={(value) => {
                                if (value === 0) {
                                    return "0m";
                                }
                                const h = Math.floor(value / 60);
                                const m = value % 60;
                                if (h === 0) {
                                    return `${m}m`;
                                }
                                return m === 0 ? `${h}h` : `${h}h${m}m`;
                            }}
                            ticks={ticks}
                        />
                        <Tooltip
                            contentStyle={TOOLTIP_STYLE}
                            formatter={(value: any) => [formatMinutes(value), "Watch Time"]}
                            labelStyle={TOOLTIP_LABEL_STYLE}
                        />
                        <Area
                            dataKey="minutes"
                            fill="url(#colorMinutes)"
                            fillOpacity={1}
                            isAnimationActive={false}
                            stroke="var(--color-chart-1)"
                            strokeWidth={2}
                            type="monotone"
                        />
                    </AreaChart>
                </ResponsiveContainer>
            </div>

            {/* Legend */}
            <div className="mt-4 flex items-center justify-center gap-6 border-default border-t pt-4">
                <div className="flex items-center gap-2">
                    <span
                        className="h-3 w-3 rounded-full"
                        style={{ background: "var(--color-chart-1)" }}
                    />
                    <span className="text-muted text-sm">Total</span>
                </div>
            </div>
        </Card>
    );
});

const ContentBreakdownChart = memo(function ContentBreakdownChartLocal({
    data,
}: {
    data: WatchTimeDataPoint[];
}) {
    return (
        <Card padding="lg">
            <div className="detail-section-header mb-6 flex items-center justify-between">
                <h3 className="font-display font-semibold text-default text-lg">
                    Content Breakdown
                </h3>
            </div>

            <div className="h-40 md:h-64">
                <ResponsiveContainer height="100%" width="100%">
                    <BarChart data={data}>
                        <CartesianGrid stroke="rgba(255,255,255,0.1)" strokeDasharray="3 3" />
                        <XAxis dataKey="date" fontSize={12} stroke="#64748b" />
                        <YAxis fontSize={12} stroke="#64748b" />
                        <Tooltip contentStyle={TOOLTIP_STYLE} labelStyle={TOOLTIP_LABEL_STYLE} />
                        <Bar dataKey="movies" fill="var(--color-chart-1)" radius={[4, 4, 0, 0]} />
                        <Bar dataKey="series" fill="var(--color-chart-2)" radius={[4, 4, 0, 0]} />
                    </BarChart>
                </ResponsiveContainer>
            </div>

            {/* Legend */}
            <div className="mt-4 flex items-center justify-center gap-6 border-default border-t pt-4">
                <div className="flex items-center gap-2">
                    <span
                        className="h-3 w-3 rounded-full"
                        style={{ background: "var(--color-chart-1)" }}
                    />
                    <span className="text-muted text-sm">Movies</span>
                </div>
                <div className="flex items-center gap-2">
                    <span
                        className="h-3 w-3 rounded-full"
                        style={{ background: "var(--color-chart-2)" }}
                    />
                    <span className="text-muted text-sm">Series</span>
                </div>
            </div>
        </Card>
    );
});

export default function UserDetailPage() {
    const { layoutMode } = useLayoutMode();
    const { hideSensitive } = useTheme();
    const params = useParams();
    const router = useRouter();
    const [activeTab, setActiveTab] = useState<"overview" | "addons">("overview");
    const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);
    const [isEditDetailsOpen, setIsEditDetailsOpen] = useState(false);
    const [isReconnectModalOpen, setIsReconnectModalOpen] = useState(false);
    const [isSimklModalOpen, setIsSimklModalOpen] = useState(false);
    const [isDisconnectingSimkl, setIsDisconnectingSimkl] = useState(false);
    const [isSyncing, setIsSyncing] = useState(false);
    const [isDeleting, setIsDeleting] = useState(false);
    const [showEmail, setShowEmail] = useState(false);
    const [nowTick, setNowTick] = useState(Date.now());

    // Account merge (Stremio<->Nuvio, same real person) - manual only, picked
    // from the "Merge with another user" picker below. See server/utils/userMerge.js.
    const [mergeCandidate, setMergeCandidate] = useState<MergeCandidate | null>(null);
    const [mergePreview, setMergePreview] = useState<MergePreview | null>(null);
    const [isMergeModalOpen, setIsMergeModalOpen] = useState(false);
    const [isSyncPreviewOpen, setIsSyncPreviewOpen] = useState(false);
    const [isMerging, setIsMerging] = useState(false);
    const [mergeInfo, setMergeInfo] = useState<MergeInfo | null>(null);
    const [isUndoModalOpen, setIsUndoModalOpen] = useState(false);
    const [isUndoing, setIsUndoing] = useState(false);
    const [isMergePickerOpen, setIsMergePickerOpen] = useState(false);
    const [mergePickerUsers, setMergePickerUsers] = useState<User[] | null>(null);
    const [mergePickerSearch, setMergePickerSearch] = useState("");

    // Watch-history CSV import/export - see server/utils/csvHistoryImport.js
    const historyFileInputRef = useRef<HTMLInputElement>(null);
    const [isImportingHistory, setIsImportingHistory] = useState(false);
    const [isExportingHistory, setIsExportingHistory] = useState(false);

    // SlickTrax Addon toggle - see server/routes/traxAddon.js. The manifest
    // URL comes back from the toggle call (the server knows the right base);
    // reconstructed on load from the user's stored token as a best-effort
    // display until the first toggle response replaces it.
    const [isTogglingTrax, setIsTogglingTrax] = useState(false);
    const [traxManifestUrl, setTraxManifestUrl] = useState<string | null>(null);

    const [historyImportResult, setHistoryImportResult] = useState<{
        filesProcessed: number;
        filesUsed: number;
        filesUnusable: string[];
        imported: number;
        skipped: number;
        truncated: boolean;
        unresolvedTitles: string[];
    } | null>(null);
    // Only shown while a multi-file batch is running - counts down so someone
    // watching a 20+ file Trakt export import (collections, comments, lists,
    // network, hidden progress, etc. - only history/ratings are actually
    // importable) can see it is progressing rather than staring at a spinner
    // that could be stuck.
    const [historyImportProgress, setHistoryImportProgress] = useState<{
        done: number;
        total: number;
    } | null>(null);

    // Handles one file OR a whole batch selected at once (the input now allows
    // multiple). A real Trakt export unzips into 20-30+ files - collections,
    // comments, lists, network, hidden progress, settings, stats - and only
    // the history/ratings ones are actually importable. Rather than make
    // someone pick through that list one at a time, or throw an error toast
    // for every irrelevant file, every selected file is sent to the SAME
    // tested single-file endpoint in sequence, and the results are folded into
    // one summary: files that contributed rows count toward the totals, files
    // that came back with nothing usable are named once at the end rather than
    // erroring individually.
    const handleImportHistoryFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const files = Array.from(e.target.files || []);
        e.target.value = ""; // allow re-selecting the same file(s) next time
        if (files.length === 0 || !params.id) {
            return;
        }

        setIsImportingHistory(true);
        setHistoryImportResult(null);
        setHistoryImportProgress(files.length > 1 ? { done: 0, total: files.length } : null);

        let imported = 0;
        let skipped = 0;
        let truncated = false;
        let filesUsed = 0;
        const filesUnusable: string[] = [];
        const unresolvedTitles: string[] = [];
        let lastError: string | null = null;

        for (const file of files) {
            try {
                const result = await api.importUserHistory(params.id as string, file);
                if (result.imported > 0) {
                    filesUsed++;
                } else {
                    filesUnusable.push(file.name);
                }
                imported += result.imported;
                skipped += result.skipped;
                truncated = truncated || result.truncated;
                for (const t of result.unresolvedTitles) {
                    if (!unresolvedTitles.includes(t)) {
                        unresolvedTitles.push(t);
                    }
                }
            } catch (err) {
                // A file this endpoint cannot use at all (wrong format, or one of
                // the non-history Trakt files) - counted, not fatal to the batch.
                filesUnusable.push(file.name);
                lastError = readErrorMessage(err, "Failed to import");
            }
            setHistoryImportProgress((prev) => (prev ? { ...prev, done: prev.done + 1 } : null));
        }

        setHistoryImportResult({
            filesProcessed: files.length,
            filesUnusable,
            filesUsed,
            imported,
            skipped,
            truncated,
            unresolvedTitles,
        });
        setHistoryImportProgress(null);
        setIsImportingHistory(false);

        if (imported > 0) {
            toast.success(
                `Imported ${imported} title${imported === 1 ? "" : "s"}${filesUsed < files.length ? ` from ${filesUsed} of ${files.length} file${files.length === 1 ? "" : "s"}` : ""}`
            );
        } else if (files.length === 1 && lastError) {
            toast.error(lastError);
        } else {
            toast.error(
                files.length === 1
                    ? "Nothing importable in that file"
                    : `Nothing importable across ${files.length} files - see the summary below`
            );
        }
    };

    const handleExportHistory = async () => {
        if (!params.id) {
            return;
        }
        setIsExportingHistory(true);
        try {
            const csv = await api.exportUserHistory(params.id as string);
            const blob = new Blob([csv], { type: "text/csv" });
            const url = URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = url;
            a.download = `${user?.username || "watch-history"}.csv`;
            a.click();
            URL.revokeObjectURL(url);
            toast.success("History exported");
        } catch (err) {
            toast.error(readErrorMessage(err, "Failed to export history"));
        } finally {
            setIsExportingHistory(false);
        }
    };

    useEffect(() => {
        if (!params.id) {
            return;
        }
        let cancelled = false;
        api.getMergeInfo(params.id as string)
            .then((res) => {
                if (!cancelled) {
                    setMergeInfo(res.info);
                }
            })
            .catch(() => undefined);
        return () => {
            cancelled = true;
        };
    }, [params.id]);

    const openMergeModal = async (candidateOverride?: MergeCandidate) => {
        // Explicit param, not just the mergeCandidate state read: setMergeCandidate
        // right before calling this (the manual-picker path) wouldn't be visible
        // here yet - React state updates aren't synchronous within the same
        // handler, so reading the closure's `mergeCandidate` immediately after
        // setting it would still see the previous (likely null) value.
        const candidate = candidateOverride ?? mergeCandidate;
        if (!candidate) {
            return;
        }
        try {
            const preview = await api.getMergePreview(params.id as string, candidate.id);
            setMergePreview(preview);
            setIsMergeModalOpen(true);
        } catch (err) {
            toast.error(readErrorMessage(err, "Failed to load merge preview"));
        }
    };

    const handleMerge = async () => {
        if (!mergeCandidate) {
            return;
        }
        setIsMerging(true);
        try {
            await api.mergeUsers(params.id as string, mergeCandidate.id);
            toast.success(`Merged ${mergeCandidate.username} into this account`);
            setIsMergeModalOpen(false);
            setMergeCandidate(null);
            const [userData, infoRes] = await Promise.all([
                api.getUser(params.id as string),
                api.getMergeInfo(params.id as string),
            ]);
            setUser(userData);
            setMergeInfo(infoRes.info);
        } catch (err) {
            toast.error(readErrorMessage(err, "Failed to merge accounts"));
        } finally {
            setIsMerging(false);
        }
    };

    const openMergePicker = async () => {
        setIsMergePickerOpen(true);
        setMergePickerSearch("");
        if (mergePickerUsers) {
            return; // already loaded this visit to the page
        }
        try {
            const all = await api.getUsers();
            setMergePickerUsers(all);
        } catch {
            toast.error("Failed to load users");
            setMergePickerUsers([]);
        }
    };

    const handlePickMergeCandidate = (picked: User) => {
        const candidate: MergeCandidate = {
            avatarUrl: picked.avatarUrl,
            colorIndex: picked.colorIndex,
            email: picked.email,
            id: picked.id,
            providerType: (picked.providerType || "stremio") as "stremio" | "nuvio" | "jellyfin",
            username:
                picked.username || picked.name || displayEmail(picked.email) || "Unnamed user",
        };
        setMergeCandidate(candidate);
        setIsMergePickerOpen(false);
        openMergeModal(candidate);
    };

    const handleUndoMerge = async () => {
        setIsUndoing(true);
        try {
            const result = await api.undoMerge(params.id as string);
            toast.success(`Split ${result.donorUsername} back into its own account`);
            setIsUndoModalOpen(false);
            setMergeInfo(null);
            const userData = await api.getUser(params.id as string);
            setUser(userData);
            setMergeCandidate(null);
        } catch (err) {
            toast.error(readErrorMessage(err, "Failed to undo merge"));
        } finally {
            setIsUndoing(false);
        }
    };

    // Time boundaries for grouping (Local Time)
    const dateBoundaries = useMemo(() => {
        const now = new Date();
        const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
        const weekStart = todayStart - 7 * 24 * 60 * 60 * 1000;
        return { todayStart, weekStart };
    }, []);

    // Data state
    const [user, setUser] = useState<any>(null);

    useEffect(() => {
        if (user?.traxAddonEnabled && !traxManifestUrl) {
            // Deliberately NOT built from window.location any more. That produced
            // a url that works in this browser and proves nothing about whether
            // the SERVER can install it - and when the server had no public
            // address configured, sync skipped SlickTrax entirely while this row
            // happily showed a link. The server is the only thing that knows.
            setTraxManifestUrl(user.traxManifestUrl || null);
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [user?.traxAddonEnabled, user?.traxToken]);

    // Two of the biggest blocks on this page are things you set up once and
    // then rarely touch, so they collapse. Deliberately NOT remembered: the
    // point is that the page always opens on the parts you came back for, so
    // leaving and returning starts closed again rather than restoring whatever
    // was open last time.
    const [openSections, setOpenSections] = useState<{ tracking: boolean; history: boolean }>({
        history: false,
        tracking: false,
    });
    const toggleSection = (key: "tracking" | "history") => {
        setOpenSections((prev) => ({ ...prev, [key]: !prev[key] }));
    };

    // Cinemeta patching. The state is read back from the manifest actually on
    // the account rather than from what we last wrote, so an edit made
    // anywhere else still shows up here.
    const [cinemetaState, setCinemetaState] = useState<{
        supported?: boolean;
        installed: boolean;
        removeSearch: boolean;
        removeCatalogs: boolean;
        removeMeta: boolean;
        canReset: boolean;
    } | null>(null);
    const [cinemetaOpen, setCinemetaOpen] = useState(false);
    const [cinemetaBusy, setCinemetaBusy] = useState(false);
    const [cinemetaDraft, setCinemetaDraft] = useState({
        removeCatalogs: false,
        removeMeta: false,
        removeSearch: false,
    });
    const loadCinemeta = useCallback(async () => {
        if (!params.id) {
            return;
        }
        try {
            const r = await api.getCinemetaState(params.id as string);
            setCinemetaState(r);
            setCinemetaDraft({
                removeCatalogs: r.removeCatalogs,
                removeMeta: r.removeMeta,
                removeSearch: r.removeSearch,
            });
        } catch {
            setCinemetaState(null);
        }
    }, [params.id]);
    useEffect(() => {
        loadCinemeta();
    }, [loadCinemeta]);

    const cinemetaPatched =
        !!cinemetaState &&
        (cinemetaState.removeSearch || cinemetaState.removeCatalogs || cinemetaState.removeMeta);

    const handleSaveCinemeta = async () => {
        if (!params.id) {
            return;
        }
        setCinemetaBusy(true);
        try {
            const r = await api.patchCinemeta(params.id as string, cinemetaDraft);
            toast.success(`Cinemeta patched - ${r.summary}`);
            setCinemetaOpen(false);
            await loadCinemeta();
        } catch (e) {
            toast.error(readErrorMessage(e, "Could not patch Cinemeta"));
        } finally {
            setCinemetaBusy(false);
        }
    };

    const handleResetCinemeta = async () => {
        if (!params.id) {
            return;
        }
        setCinemetaBusy(true);
        try {
            await api.resetCinemeta(params.id as string);
            toast.success("Cinemeta restored to its original state");
            setCinemetaOpen(false);
            await loadCinemeta();
        } catch (e) {
            toast.error(readErrorMessage(e, "Could not restore Cinemeta"));
        } finally {
            setCinemetaBusy(false);
        }
    };

    const handleToggleTraxAddon = async () => {
        if (!(params.id && user)) {
            return;
        }
        const next = !user.traxAddonEnabled;
        setIsTogglingTrax(true);
        try {
            const r = await api.setTraxAddon(params.id as string, next);
            setUser((prev: any) => (prev ? { ...prev, traxAddonEnabled: r.enabled } : prev));
            setTraxManifestUrl(r.manifestUrl || null);
            if (r.enabled) {
                toast.success(
                    r.autoInstall
                        ? "SlickTrax Addon enabled - it installs on the next sync"
                        : "Enabled, but SlickSync doesn’t know the address devices reach it at yet. Open SlickSync once from that address, then sync."
                );
            } else {
                toast.success("SlickTrax Addon disabled - the next sync removes it");
            }
        } catch (err) {
            toast.error(readErrorMessage(err, "Failed to toggle SlickTrax Addon"));
        } finally {
            setIsTogglingTrax(false);
        }
    };
    const [groups, setGroups] = useState<any[]>([]);
    const [watchTimeData, setWatchTimeData] = useState<WatchTimeDataPoint[]>([]);
    const [_totalWatchTimeSeconds, setTotalWatchTimeSeconds] = useState(0);
    const [streaks, setStreaks] = useState<any>(null);
    const [metricsData, setMetricsData] = useState<any>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [providerAddonsLoading, setProviderAddonsLoading] = useState(true);
    const [error, setError] = useState<Error | null>(null);

    // Addons state
    const [groupAddons, setGroupAddons] = useState<Addon[]>([]);
    const [stremioAddons, setStremioAddons] = useState<StremioAddon[]>([]);
    const [excludedAddonIds, setExcludedAddonIds] = useState<Set<string>>(new Set());
    const [protectedAddonNames, setProtectedAddonNames] = useState<Set<string>>(new Set());
    const [isRefreshingAddons, setIsRefreshingAddons] = useState(false);
    const [showSyncDebug, setShowSyncDebug] = useState(false);
    const [syncPlanLoading, setSyncPlanLoading] = useState(false);
    const [syncPlanError, setSyncPlanError] = useState<string | null>(null);
    const [syncPlan, setSyncPlan] = useState<{
        alreadySynced: boolean;
        current: { name: string; transportUrl: string; fingerprint: string }[];
        desired: { name: string; transportUrl: string; fingerprint: string }[];
        currentCount: number;
        desiredCount: number;
    } | null>(null);

    const refreshSyncPlan = useCallback(async () => {
        setSyncPlanLoading(true);
        setSyncPlanError(null);
        try {
            const plan = await api.getUserSyncPlan(params.id as string);
            setSyncPlan(plan);
        } catch (err) {
            console.error("Failed to fetch sync plan:", err);
            setSyncPlanError(readErrorMessage(err, "Failed to fetch sync plan"));
        } finally {
            setSyncPlanLoading(false);
        }
    }, [params.id]);

    const refreshGroupAddons = useCallback(
        async (showSpinner = true) => {
            if (showSpinner) {
                setIsRefreshingAddons(true);
            }
            try {
                const data = await api.getUserGroupAddons(params.id as string).catch(() => []);
                setGroupAddons(data || []);
            } finally {
                if (showSpinner) {
                    setIsRefreshingAddons(false);
                }
            }
        },
        [params.id]
    );

    // Poll group addons so backup/primary state stays fresh - every 30s, or
    // every 3 minutes while live updates are connected, never while hidden.
    useEffect(
        () => startAdaptivePoll(() => refreshGroupAddons(false), 30_000, 180_000),
        [refreshGroupAddons]
    );

    // Derive user-specific sessions from metricsData
    const userSessions = useMemo(() => {
        if (!(metricsData?.watchSessions && params.id)) {
            return [];
        }

        const targetId = String(params.id);
        const targetUsername = user?.username?.toLowerCase();

        return metricsData.watchSessions.filter((s: any) => {
            const sessionId = String(s.user.id);
            const sessionUsername = s.user.username?.toLowerCase();

            return sessionId === targetId || (targetUsername && sessionUsername === targetUsername);
        });
    }, [metricsData, params.id, user]);

    const userTopItems = useMemo(() => {
        const itemsMap = new Map<string, any>();
        userSessions.forEach((s: any) => {
            if (!itemsMap.has(s.item.id)) {
                itemsMap.set(s.item.id, {
                    id: s.item.id,
                    name: s.item.name,
                    poster: s.item.poster,
                    type: s.item.type,
                    watchTime: 0,
                });
            }
            const item = itemsMap.get(s.item.id);
            // Use durationSeconds if session is complete, otherwise use elapsed time
            const sessionStart = new Date(s.startTime).getTime();
            const _sessionEnd = s.endTime ? new Date(s.endTime).getTime() : nowTick;
            const duration = s.endTime
                ? s.durationSeconds || 0
                : Math.max(0, (nowTick - sessionStart) / 1000);

            item.watchTime += duration / 60;
        });
        const sorted = Array.from(itemsMap.values()).sort((a, b) => b.watchTime - a.watchTime);
        const maxTime = sorted[0]?.watchTime || 1;
        return sorted
            .slice(0, 5)
            .map((item) => ({ ...item, progress: (item.watchTime / maxTime) * 100 }));
    }, [userSessions, nowTick]);

    const userRecentActivity = useMemo(
        () =>
            [...userSessions]
                .sort(
                    (a: any, b: any) =>
                        new Date(b.startTime).getTime() - new Date(a.startTime).getTime()
                )
                .slice(0, 5),
        [userSessions]
    );

    // The counters below are whole minutes, so the tick that advances them
    // runs every fifteen seconds, only while this user has a session open,
    // and never while the tab is hidden. It used to run once a second for
    // the life of the page, re-rendering everything on it each time.
    const hasLiveSession =
        (metricsData?.nowPlaying?.length ?? 0) > 0 || userSessions.some((s: any) => !s.endTime);
    useEffect(() => {
        if (!hasLiveSession) {
            return;
        }
        const id = setInterval(() => {
            if (document.visibilityState === "visible") {
                setNowTick(Date.now());
            }
        }, 15_000);
        return () => clearInterval(id);
    }, [hasLiveSession]);

    const liveTodayMinutes = useMemo(() => {
        let totalSeconds = 0;
        userSessions.forEach((s: any) => {
            const sessionStart = new Date(s.startTime).getTime();
            const sessionEnd = s.endTime ? new Date(s.endTime).getTime() : nowTick;
            const start = Math.max(sessionStart, dateBoundaries.todayStart);
            if (sessionEnd > start) {
                totalSeconds += (sessionEnd - start) / 1000;
            }
        });
        return Math.round(totalSeconds / 60);
    }, [userSessions, nowTick, dateBoundaries]);

    const liveWeekMinutes = useMemo(() => {
        let totalSeconds = 0;
        userSessions.forEach((s: any) => {
            const sessionStart = new Date(s.startTime).getTime();
            const sessionEnd = s.endTime ? new Date(s.endTime).getTime() : nowTick;
            const start = Math.max(sessionStart, dateBoundaries.weekStart);
            if (sessionEnd > start) {
                totalSeconds += (sessionEnd - start) / 1000;
            }
        });
        return Math.round(totalSeconds / 60);
    }, [userSessions, nowTick, dateBoundaries]);

    // Calculate absolute total watch time (completed sessions from API + current live session)
    const absoluteTotalMinutes = useMemo(() => {
        if (!user) {
            return 0;
        }

        let extraSeconds = 0;
        if (metricsData?.nowPlaying) {
            metricsData.nowPlaying
                .filter((np: any) => np.user.id === params.id || np.user.username === user.username)
                .forEach((np: any) => {
                    const startMs = np.watchedAtTimestamp || new Date(np.watchedAt).getTime();
                    if (startMs) {
                        extraSeconds += Math.max(0, (nowTick - startMs) / 1000);
                    }
                });
        }

        return (user.watchTime || 0) + Math.round(extraSeconds / 60);
    }, [user, metricsData, nowTick, params.id]);

    // UI state for user detail page
    const [_showColorPicker, _setShowColorPicker] = useState(false);
    const [showAvatarPicker, setShowAvatarPicker] = useState(false);
    const [_expiresAtValue, setExpiresAtValue] = useState("");
    const avatarRef = useRef<HTMLDivElement>(null);

    // DnD sensors (now handled by DraggableList)

    // Fetch user data
    useEffect(() => {
        let cancelled = false;
        const fetchData = async () => {
            setIsLoading(true);
            setError(null);
            setProviderAddonsLoading(true);
            setStremioAddons([]);
            // A slow provider must not hold the profile and household data behind
            // a page-wide spinner. Its own section reports progress separately.
            api.getUserStremioAddons(params.id as string)
                .then((data) => {
                    if (cancelled) {
                        return;
                    }
                    setStremioAddons(data || []);
                    if (data?.length) {
                        console.log("Loaded Stremio addons:", data.length, data);
                    } else {
                        console.log("No Stremio addons found or empty array");
                    }
                })
                .catch((err) => {
                    console.error("Failed to fetch Stremio addons:", err);
                })
                .finally(() => {
                    if (!cancelled) {
                        setProviderAddonsLoading(false);
                    }
                });
            try {
                const [
                    userData,
                    groupsData,
                    watchTime,
                    _topItemsData,
                    streaksData,
                    metrics,
                    groupAddonsData,
                ] = await Promise.all([
                    api.getUser(params.id as string),
                    api.getGroups(),
                    api.getUserWatchTime(params.id as string, "year").catch(() => null),
                    api.getUserTopItems(params.id as string, 5).catch(() => []),
                    api.getUserStreaks(params.id as string).catch(() => null),
                    api.getMetrics("7d").catch(() => null),
                    api.getUserGroupAddons(params.id as string).catch(() => []),
                ]);
                if (cancelled) {
                    return;
                }
                setUser(userData);
                setGroups(groupsData);
                setStreaks(streaksData);
                setMetricsData(metrics);
                setGroupAddons(groupAddonsData || []);

                // Set total watch time from absolute user total (minutes -> seconds)
                if (userData?.watchTime !== undefined) {
                    setTotalWatchTimeSeconds(userData.watchTime * 60);
                } else if (watchTime) {
                    setTotalWatchTimeSeconds(watchTime.totalWatchTimeSeconds || 0);
                }

                // Set excluded and protected addons from user data
                if (userData?.excludedAddons) {
                    setExcludedAddonIds(new Set(userData.excludedAddons));
                }
                if (userData?.protectedAddons) {
                    setProtectedAddonNames(new Set(userData.protectedAddons));
                }

                // Transform watch time data
                if (watchTime) {
                    // Use byDate from API response (fixed interface)
                    const periods = watchTime.byDate || [];
                    // Sort by date just in case
                    periods.sort(
                        (a: any, b: any) => new Date(a.date).getTime() - new Date(b.date).getTime()
                    );

                    const transformed = periods.map((p) => ({
                        date: p.date,
                        minutes: Math.round((p.watchTimeSeconds || 0) / 60),
                        movies: p.movies || 0,
                        series: p.shows || 0,
                    }));
                    setWatchTimeData(transformed);
                    setTotalWatchTimeSeconds(watchTime.totalWatchTimeSeconds || 0);
                }
            } catch (err) {
                if (!cancelled) {
                    setError(err as Error);
                }
            } finally {
                if (!cancelled) {
                    setIsLoading(false);
                }
            }
        };

        if (params.id) {
            fetchData();
        }
        return () => {
            cancelled = true;
        };
    }, [params.id]);

    useEffect(() => {
        if (user) {
            document.title = `SlickSync - ${user.username || user.name || "User Detail"}`;
        }
    }, [user]);

    const handleSync = useCallback(async () => {
        setIsSyncing(true);
        try {
            await api.syncUser(params.id as string);
        } catch {
            // Fallback to mock delay if API fails
            await new Promise((resolve) => setTimeout(resolve, 2000));
        } finally {
            setIsSyncing(false);
        }
    }, [params.id]);

    const handleDelete = useCallback(async () => {
        setIsDeleting(true);
        try {
            await api.deleteUser(params.id as string);
            setIsDeleteModalOpen(false);
            router.push("/users");
        } catch {
            // If API fails, just close modal (mock behavior)
            setIsDeleteModalOpen(false);
            router.push("/users");
        } finally {
            setIsDeleting(false);
        }
    }, [params.id, router]);

    // Handle avatar change (color, URL, or uploaded image)
    const handleAvatarSave = useCallback(
        async ({
            alsoOnServer,
            ...data
        }: {
            avatarUrl?: string | null;
            colorIndex?: number;
            alsoOnServer?: boolean;
        }) => {
            setUser((prev: any) => (prev ? { ...prev, ...data } : null));
            await api.updateUser(params.id as string, data);
            // Their server too, when asked (server/utils/serverAvatars.js). The
            // picture is saved here either way; only the server half can fail.
            if (alsoOnServer) {
                try {
                    const done = await api.pushServerPicture(params.id as string);
                    toast.success(`Set on their ${done.server} too`);
                } catch (e) {
                    toast.error(
                        (e as Error)?.message || "Saved here, but their server didn’t take it"
                    );
                }
            }
        },
        [params.id]
    );

    // Handle color change
    const _handleColorChange = useCallback(
        async (colorIndex: number) => {
            // Optimistic update
            setUser((prev: any) => (prev ? { ...prev, colorIndex } : null));

            try {
                await api.updateUser(params.id as string, { colorIndex });
                toast.success("User color updated");
            } catch (err) {
                toast.error(readErrorMessage(err, "Failed to update user color"));
                // Refresh to revert
                const userData = await api.getUser(params.id as string);
                setUser(userData);
            }
        },
        [params.id]
    );

    // Handle username update
    const handleUsernameUpdate = useCallback(
        async (newUsername: string) => {
            try {
                await api.updateUser(params.id as string, { username: newUsername });
                toast.success("Username updated");
                // Refresh user data
                const userData = await api.getUser(params.id as string);
                setUser(userData);
            } catch (err) {
                toast.error(readErrorMessage(err, "Failed to update username"));
            }
        },
        [params.id]
    );

    // Handle expiresAt change
    const handleExpiresAtChange = useCallback(
        async (value: string) => {
            setExpiresAtValue(value);
            try {
                await api.updateUser(params.id as string, { expiresAt: value || null });
                toast.success("Expiration date updated");
                // Refresh user data
                const userData = await api.getUser(params.id as string);
                setUser(userData);
            } catch (err) {
                toast.error(readErrorMessage(err, "Failed to update expiration date"));
            }
        },
        [params.id]
    );

    // Handle group change
    const handleGroupChange = useCallback(
        async (groupId: string) => {
            try {
                const currentUser = await api.getUser(params.id as string);
                const currentGroupIds =
                    currentUser.groupIds || (currentUser.groupId ? [currentUser.groupId] : []);

                if (groupId) {
                    // Add to new group if not already in it
                    if (!currentGroupIds.includes(groupId)) {
                        await api.addUserToGroup(groupId, params.id as string);
                    }
                    // Remove from other groups
                    for (const gId of currentGroupIds) {
                        if (gId !== groupId) {
                            try {
                                await api.removeUserFromGroup(gId, params.id as string);
                            } catch {
                                // Ignore errors for individual removals
                            }
                        }
                    }
                } else {
                    // Remove from all groups
                    for (const gId of currentGroupIds) {
                        try {
                            await api.removeUserFromGroup(gId, params.id as string);
                        } catch {
                            // Ignore errors for individual removals
                        }
                    }
                }
                toast.success("Group updated");
                // Refresh user data
                const userData = await api.getUser(params.id as string);
                setUser(userData);
            } catch (err) {
                toast.error(readErrorMessage(err, "Failed to update group"));
            }
        },
        [params.id]
    );

    // Handle toggle active status
    const handleToggleActive = useCallback(async () => {
        try {
            const newStatus = !user?.isActive;
            await api.toggleUserStatus(params.id as string, newStatus);
            toast.success(`User ${newStatus ? "activated" : "deactivated"}`);
            // Refresh user data
            const userData = await api.getUser(params.id as string);
            setUser(userData);
        } catch (err) {
            toast.error(readErrorMessage(err, "Failed to toggle user status"));
        }
    }, [params.id, user?.isActive]);

    // Handle reset Stremio addons
    const handleResetStremioAddons = useCallback(async () => {
        try {
            // Clear all Stremio addons by removing them one by one
            for (const addon of stremioAddons) {
                const addonName = addon.manifest?.name || "";
                if (addonName) {
                    try {
                        await api.removeUserStremioAddon(params.id as string, addonName);
                    } catch {
                        // Ignore individual errors
                    }
                }
            }
            toast.success("Addons cleared from their account");
            // Refresh user data
            const stremioAddonsData = await api.getUserStremioAddons(params.id as string);
            setStremioAddons(stremioAddonsData || []);
        } catch (err) {
            toast.error(readErrorMessage(err, "Could not clear their addons"));
        }
    }, [params.id, stremioAddons]);

    // Handle toggling addon exclusion
    const handleToggleExclude = useCallback(
        async (addonId: string) => {
            const newExcluded = new Set(excludedAddonIds);
            const wasExcluded = newExcluded.has(addonId);
            if (wasExcluded) {
                newExcluded.delete(addonId);
            } else {
                newExcluded.add(addonId);
            }

            // Optimistic update
            setExcludedAddonIds(newExcluded);

            try {
                await api.updateUserExcludedAddons(params.id as string, Array.from(newExcluded));
                toast.success(wasExcluded ? "Addon included" : "Addon excluded");
            } catch (err) {
                // Revert on error
                if (wasExcluded) {
                    newExcluded.add(addonId);
                } else {
                    newExcluded.delete(addonId);
                }
                setExcludedAddonIds(newExcluded);
                toast.error(readErrorMessage(err, "Failed to update addon"));
            }
        },
        [params.id, excludedAddonIds]
    );

    // Handle toggling addon protection
    const handleToggleProtect = useCallback(
        async (addonName: string) => {
            try {
                const result = await api.toggleUserProtectedAddon(params.id as string, addonName);
                const newProtected = new Set(protectedAddonNames);
                if (result.isProtected) {
                    newProtected.add(addonName);
                } else {
                    newProtected.delete(addonName);
                }
                setProtectedAddonNames(newProtected);
                toast.success(result.message);
            } catch (err) {
                toast.error(readErrorMessage(err, "Failed to update addon protection"));
            }
        },
        [params.id, protectedAddonNames]
    );

    // Handle removing Stremio addon
    // Called with the addon's address (exact) from the Account Addons list.
    const handleRemoveStremioAddon = useCallback(
        async (addonRef: string) => {
            try {
                await api.removeUserStremioAddon(params.id as string, addonRef);
                setStremioAddons((prev) =>
                    prev.filter((a) => a.transportUrl !== addonRef && a.manifest?.name !== addonRef)
                );
                toast.success("Addon removed from account");
            } catch (err) {
                toast.error(readErrorMessage(err, "Failed to remove addon"));
            }
        },
        [params.id]
    );

    // Handle importing addons from user
    const handleImport = useCallback(async () => {
        if (!user) {
            return;
        }
        try {
            toast.success(`Importing addons from ${user.username || user.name}...`);
            const result = await api.importUserAddons(user.id);
            toast.success(
                result.message ||
                    `Successfully imported ${result.importedCount} addon${result.importedCount === 1 ? "" : "s"}`
            );

            // Refresh addons data
            try {
                const [groupAddonsData, stremioAddonsData] = await Promise.all([
                    api.getUserGroupAddons(params.id as string).catch(() => []),
                    api.getUserStremioAddons(params.id as string).catch((err) => {
                        console.error("Failed to fetch Stremio addons:", err);
                        return [];
                    }),
                ]);
                setGroupAddons(groupAddonsData || []);
                setStremioAddons(stremioAddonsData || []);
            } catch (e) {
                console.error("Failed to refresh addons after import", e);
            }
        } catch (err) {
            toast.error(readErrorMessage(err, "Failed to import addons"));
        }
    }, [user, params.id]);

    // Handle group addon drag end for reordering
    const handleGroupAddonDragEnd = useCallback(
        async (event: DragEndEvent) => {
            const { active, over } = event;
            if (!over || active.id === over.id) {
                return;
            }

            const oldIndex = groupAddons.findIndex((a) => a.id === active.id);
            const newIndex = groupAddons.findIndex((a) => a.id === over.id);

            if (oldIndex === -1 || newIndex === -1) {
                return;
            }

            // Optimistic update
            const newAddons = arrayMove(groupAddons, oldIndex, newIndex);
            setGroupAddons(newAddons);

            try {
                const groupId =
                    user.groupIds && user.groupIds.length > 0 ? user.groupIds[0] : user.groupId;
                if (groupId) {
                    const stringIds = newAddons.map((a) => String(a.id));
                    await api.reorderGroupAddons(groupId, stringIds);
                    toast.success("Group addon order updated");
                }
            } catch (err) {
                setGroupAddons(groupAddons);
                toast.error(readErrorMessage(err, "Failed to update addon order"));
            }
        },
        [groupAddons, user]
    );

    // Handle account addon drag end for reordering. Item ids are the addon's
    // own transportUrl (stable, already unique) - looked up via findIndex
    // rather than baking the current index into the id itself, which is what
    // this used to do (`${index}-${transportUrl}`). That broke dnd-kit: every
    // reorder changes every item's index, so the id of every OTHER item in
    // the list also changed on each render, invalidating dnd-kit's item-
    // identity tracking mid-drag - confirmed real, reported as the drag
    // "acting weird" (items jumping to wrong spots, drops landing in the
    // wrong place). The Group Addons list above never had this bug since it
    // already used addon.id (genuinely stable) as its item id.
    const handleStremioAddonDragEnd = useCallback(
        async (event: DragEndEvent) => {
            const { active, over } = event;
            if (!over || active.id === over.id) {
                return;
            }

            const oldIndex = stremioAddons.findIndex((a) => a.transportUrl === active.id);
            const newIndex = stremioAddons.findIndex((a) => a.transportUrl === over.id);

            if (oldIndex === -1 || newIndex === -1) {
                return;
            }

            // Optimistic update
            const newAddons = arrayMove(stremioAddons, oldIndex, newIndex);
            setStremioAddons(newAddons);

            try {
                const orderedNames = newAddons.map((a) => a.manifest?.name || "Unknown");
                await api.reorderUserStremioAddons(params.id as string, orderedNames);
                toast.success("Addon order updated");
            } catch (err) {
                // Revert on error
                setStremioAddons(stremioAddons);
                toast.error(readErrorMessage(err, "Failed to update addon order"));
            }
        },
        [params.id, stremioAddons]
    );

    const detailActions = (
        <div className="flex flex-wrap items-center justify-end gap-3">
            <div className="flex items-center gap-2">
                <span className="text-muted text-sm">Active</span>
                <ToggleSwitch
                    checked={user?.isActive !== false}
                    onChange={handleToggleActive}
                    size="sm"
                    title="Activate user"
                />
            </div>
            {/* Sync puts the group's addons into a Stremio or Nuvio account; a
          Jellyfin, AIOStreams or AIOMetadata sign-in has no addon list. */}
            {user && hasAddonList(user) && (
                <Button
                    isLoading={isSyncing}
                    leftIcon={
                        <ArrowPathIcon className={`h-5 w-5 ${isSyncing ? "animate-spin" : ""}`} />
                    }
                    onClick={() => setIsSyncPreviewOpen(true)}
                    variant="glass"
                >
                    Sync
                </Button>
            )}
            <Button
                leftIcon={<ArrowDownTrayIcon className="h-5 w-5" />}
                onClick={handleImport}
                variant="glass"
            >
                Import
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
                            items={[
                                { href: "/users", label: "Users" },
                                {
                                    label: isLoading
                                        ? "Loading..."
                                        : user?.username || user?.name || "User",
                                },
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
                        <DetailToolbar
                            actions={detailActions}
                            backHref="/users"
                            backLabel="Users"
                            title={
                                isLoading ? "Loading user" : user?.username || user?.name || "User"
                            }
                        />
                    )}
                    {/* Loading state */}
                    {isLoading ? (
                        <div className="py-16 text-center">
                            <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-surface-hover">
                                <div className="h-8 w-8 animate-spin rounded-full border-2 border-current border-t-transparent text-primary" />
                            </div>
                            <p className="text-muted">Loading user data...</p>
                        </div>
                    ) : error ? (
                        <div className="py-16 text-center">
                            <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-surface-hover">
                                <XMarkIcon className="h-8 w-8 text-error" />
                            </div>
                            <h3 className="mb-2 font-medium text-default text-lg">
                                Error Loading User
                            </h3>
                            <p className="mb-4 text-muted">{error.message}</p>
                            <Button onClick={() => window.location.reload()} variant="primary">
                                Retry
                            </Button>
                        </div>
                    ) : user ? (
                        <>
                            {/* User Hero Section */}
                            <PageSection className="mb-6 md:mb-8">
                                <Card className="profile-hero md:lg:p-6" padding="md">
                                    <div className="relative">
                                        <div className="flex flex-col items-start gap-4 md:flex-row md:items-center md:gap-6">
                                            {/* Avatar with Color Picker */}
                                            <motion.div
                                                animate={{ opacity: 1, scale: 1 }}
                                                className="relative shrink-0"
                                                initial={false}
                                                ref={avatarRef}
                                                transition={{ stiffness: 200, type: "spring" }}
                                            >
                                                <button
                                                    aria-label="Change profile picture"
                                                    className="group relative cursor-pointer transition-transform hover:scale-105"
                                                    onClick={() => setShowAvatarPicker(true)}
                                                    type="button"
                                                >
                                                    <UserAvatar
                                                        avatarClassName="rounded-xl md:rounded-2xl"
                                                        className="h-16 w-16 rounded-xl shadow-lg ring-2 ring-[var(--color-bg)] md:h-24 md:w-24 md:rounded-2xl md:ring-4"
                                                        colorIndex={user.colorIndex || 0}
                                                        email={user.email}
                                                        name={user.username || user.name || "User"}
                                                        showRing
                                                        size="2xl"
                                                        src={user.avatarUrl}
                                                        useGravatar={user.useGravatar}
                                                        userId={user.id}
                                                    />
                                                    {/* Edit indicator overlay */}
                                                    <div className="absolute inset-0 flex items-center justify-center rounded-xl bg-black/0 transition-colors group-hover:bg-black/30 md:rounded-2xl">
                                                        <PencilIcon className="h-4 w-4 text-white opacity-0 transition-opacity group-hover:opacity-100 md:h-6 md:w-6" />
                                                    </div>
                                                </button>
                                                <AvatarPickerModal
                                                    currentAvatarUrl={user.avatarUrl}
                                                    currentColorIndex={user.colorIndex || 0}
                                                    isOpen={showAvatarPicker}
                                                    name={user.username || user.name || "User"}
                                                    onClose={() => setShowAvatarPicker(false)}
                                                    onSave={handleAvatarSave}
                                                    serverLabel={
                                                        isJellyfin(user)
                                                            ? providerLabel(user)
                                                            : undefined
                                                    }
                                                />
                                            </motion.div>

                                            {/* Info */}
                                            <div className="w-full min-w-0 flex-1">
                                                {/* Name line: the name, then the provider with its sync status
                          right beside it (they wrap together, never apart). */}
                                                <div className="mb-2 flex flex-wrap items-center gap-x-2 gap-y-1.5">
                                                    <InlineEdit
                                                        className="profile-name font-display font-semibold"
                                                        maxLength={50}
                                                        onSave={handleUsernameUpdate}
                                                        placeholder="Enter username..."
                                                        value={user.username || user.name || "User"}
                                                    />
                                                    <span className="inline-flex flex-wrap items-center gap-1.5">
                                                        <Badge
                                                            size="sm"
                                                            variant={providerBadgeVariant(user)}
                                                        >
                                                            {providerLabel(user)}
                                                        </Badge>
                                                        {/* Only worth saying when it is not the primary - a
                              Nuvio user that manages profile 1 is the ordinary
                              case and does not need labelling. */}
                                                        {user.providerType === "nuvio" &&
                                                            (user.nuvioProfileId ?? 1) !== 1 && (
                                                                <Badge
                                                                    size="sm"
                                                                    variant="secondary"
                                                                >
                                                                    Profile {user.nuvioProfileId}
                                                                </Badge>
                                                            )}
                                                        <SyncBadge
                                                            isSyncing={isSyncing}
                                                            onReconnect={(_id) => {
                                                                setIsReconnectModalOpen(true);
                                                            }}
                                                            onSync={async (id) => {
                                                                setIsSyncing(true);
                                                                try {
                                                                    await api.syncUser(id);
                                                                    toast.success(
                                                                        `Synced ${user.username || user.name} successfully`
                                                                    );
                                                                } catch (err) {
                                                                    toast.error(
                                                                        readErrorMessage(
                                                                            err,
                                                                            `Failed to sync ${user.username || user.name}`
                                                                        )
                                                                    );
                                                                } finally {
                                                                    setIsSyncing(false);
                                                                }
                                                            }}
                                                            size="sm"
                                                            userId={user.id}
                                                        />
                                                        {streaks?.currentStreak > 0 ? (
                                                            <Badge
                                                                className="hidden sm:inline-flex"
                                                                size="sm"
                                                                variant="warning"
                                                            >
                                                                <FireIcon className="mr-1 h-3 w-3" />
                                                                {streaks.currentStreak}
                                                            </Badge>
                                                        ) : null}
                                                    </span>
                                                </div>
                                                {/* Buttons on a line of their own, Debug at the end. */}
                                                <div className="mb-2 flex flex-wrap items-center gap-2">
                                                    {/* Which server, and who they sign in as there. */}
                                                    {user.providerType === "jellyfin" &&
                                                        (user.jellyfinServer ||
                                                            user.jellyfinUserName) && (
                                                            <span
                                                                className="max-w-[16rem] truncate text-muted text-xs"
                                                                title={
                                                                    user.jellyfinServer || undefined
                                                                }
                                                            >
                                                                {user.jellyfinUserName
                                                                    ? `${user.jellyfinUserName} on `
                                                                    : ""}
                                                                {user.jellyfinServer}
                                                                {user.aioConfigWatched
                                                                    ? " · watched for changes"
                                                                    : ""}
                                                            </span>
                                                        )}
                                                    {user.providerType === "jellyfin" && (
                                                        <SignInTvButton
                                                            name={
                                                                user.username || user.name || "them"
                                                            }
                                                            userId={user.id}
                                                        />
                                                    )}
                                                    {/* Daily limit, bedtime and age limit, in one popup. */}
                                                    <LimitsButton
                                                        id={user.id}
                                                        name={user.username || user.name || "them"}
                                                        onPickGroup={() =>
                                                            setIsEditDetailsOpen(true)
                                                        }
                                                        onReconnect={() =>
                                                            setIsReconnectModalOpen(true)
                                                        }
                                                        size="md"
                                                    />
                                                    {/* Mark a show watched up to an episode - here and on their server. */}
                                                    <CatchUpButton
                                                        hasServer={user.providerType === "jellyfin"}
                                                        name={user.username || user.name || "them"}
                                                        userId={user.id}
                                                    />
                                                    {user.providerType === "nuvio" && (
                                                        <SignInNuvioTvButton
                                                            name={
                                                                user.username || user.name || "them"
                                                            }
                                                            userId={user.id}
                                                        />
                                                    )}
                                                    {/* What AIOStreams itself says about their configuration. */}
                                                    {user.providerType === "jellyfin" &&
                                                        user.jellyfinServerKind ===
                                                            "aiostreams" && (
                                                            <>
                                                                <AioHealthButton
                                                                    name={
                                                                        user.username ||
                                                                        user.name ||
                                                                        "them"
                                                                    }
                                                                    userId={user.id}
                                                                />
                                                                <AioHistoryButton
                                                                    name={
                                                                        user.username ||
                                                                        user.name ||
                                                                        "them"
                                                                    }
                                                                    userId={user.id}
                                                                />
                                                            </>
                                                        )}
                                                    {/* Only a real Jellyfin server keeps a device list. */}
                                                    {user.providerType === "jellyfin" &&
                                                        (user.jellyfinServerKind || "jellyfin") ===
                                                            "jellyfin" && (
                                                            <JellyfinDevicesButton
                                                                name={
                                                                    user.username ||
                                                                    user.name ||
                                                                    "them"
                                                                }
                                                                userId={user.id}
                                                            />
                                                        )}
                                                    <button
                                                        className="text-muted text-xs underline hover:text-primary"
                                                        onClick={() => {
                                                            if (!showSyncDebug) {
                                                                refreshSyncPlan();
                                                            }
                                                            setShowSyncDebug(!showSyncDebug);
                                                        }}
                                                        type="button"
                                                    >
                                                        {showSyncDebug ? "Hide" : "Debug"}
                                                    </button>
                                                </div>
                                                <div className="mb-3 flex items-center gap-2 md:mb-4">
                                                    <p className="truncate text-muted text-sm md:text-base">
                                                        {hideSensitive && !showEmail
                                                            ? "••••••••"
                                                            : displayEmail(user.email)}
                                                    </p>
                                                    {hideSensitive && (
                                                        <button
                                                            className="shrink-0 rounded-lg p-1 text-muted transition-colors hover:bg-surface-hover hover:text-primary"
                                                            onClick={() => setShowEmail(!showEmail)}
                                                            title={
                                                                showEmail
                                                                    ? "Hide email"
                                                                    : "Show email"
                                                            }
                                                            type="button"
                                                        >
                                                            {showEmail ? (
                                                                <EyeSlashIcon className="h-4 w-4" />
                                                            ) : (
                                                                <EyeIcon className="h-4 w-4" />
                                                            )}
                                                        </button>
                                                    )}
                                                </div>

                                                {/* Meta Row (Matched with Group Style) */}
                                                <div className="flex flex-col items-start gap-1.5">
                                                    <button
                                                        className="group flex items-center gap-2 transition-colors"
                                                        onClick={() => setIsEditDetailsOpen(true)}
                                                        type="button"
                                                    >
                                                        <UsersIcon className="h-4 w-4 text-secondary group-hover:text-primary md:h-5 md:w-5" />
                                                        <span className="font-medium text-default text-sm md:text-base">
                                                            {groups.find(
                                                                (g) =>
                                                                    g.id ===
                                                                    (user.groupIds?.[0] ||
                                                                        user.groupId)
                                                            )?.name || "No Group"}
                                                        </span>
                                                    </button>

                                                    <button
                                                        className="group flex items-center gap-2 transition-colors"
                                                        onClick={() => setIsEditDetailsOpen(true)}
                                                        type="button"
                                                    >
                                                        <ClockIcon className="h-4 w-4 text-secondary group-hover:text-primary md:h-5 md:w-5" />
                                                        <span className="text-muted text-sm md:text-base">
                                                            {user.expiresAt
                                                                ? `Expires ${new Date(user.expiresAt).toLocaleDateString()}`
                                                                : "Lifetime"}
                                                        </span>
                                                    </button>

                                                    <div className="flex items-center gap-2">
                                                        <CalendarIcon className="h-4 w-4 text-secondary md:h-5 md:w-5" />
                                                        <span className="text-muted text-sm md:text-base">
                                                            {user.createdAt
                                                                ? new Date(
                                                                      user.createdAt
                                                                  ).toLocaleDateString()
                                                                : "Unknown"}
                                                        </span>
                                                    </div>
                                                </div>
                                            </div>

                                            {/* Right column: quick stats - show on mobile too */}
                                            <div className="mt-4 flex shrink-0 items-start gap-4 md:mt-0 md:gap-8">
                                                <div className="text-center">
                                                    <p className="font-bold font-display text-default text-xl md:text-3xl">
                                                        {formatMinutes(absoluteTotalMinutes)}
                                                    </p>
                                                    <p className="mt-0.5 font-semibold text-[10px] text-muted uppercase tracking-wider md:mt-1 md:text-xs">
                                                        Total time
                                                    </p>
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                </Card>
                            </PageSection>

                            {/* Sync Debug Section */}
                            {showSyncDebug && (
                                <PageSection className="mb-6">
                                    <div className="rounded-xl border border-yellow-500/30 bg-surface p-4">
                                        <div className="mb-3 flex items-center justify-between">
                                            <h3 className="font-semibold text-yellow-400">
                                                Sync Debug Info
                                            </h3>
                                            {syncPlan && (
                                                <Badge
                                                    size="sm"
                                                    variant={
                                                        syncPlan.alreadySynced ? "success" : "error"
                                                    }
                                                >
                                                    {syncPlan.alreadySynced ? "Synced" : "Unsynced"}
                                                </Badge>
                                            )}
                                        </div>
                                        {syncPlanLoading && (
                                            <div className="text-muted text-sm">Loading...</div>
                                        )}
                                        {syncPlanError && (
                                            <div className="text-red-400 text-sm">
                                                Error: {syncPlanError}
                                            </div>
                                        )}
                                        {syncPlan && (
                                            <>
                                                <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                                                    <div>
                                                        <h4 className="mb-2 font-medium text-muted text-sm">
                                                            Current Addons ({syncPlan.currentCount})
                                                        </h4>
                                                        <div className="max-h-48 space-y-1 overflow-y-auto">
                                                            {syncPlan.current.map((addon, idx) => (
                                                                <div
                                                                    className="break-all rounded bg-surface-hover p-2 font-mono text-xs"
                                                                    key={idx}
                                                                >
                                                                    <span className="text-primary">
                                                                        {addon.name}
                                                                    </span>
                                                                    <div className="truncate text-muted">
                                                                        {addon.transportUrl}
                                                                    </div>
                                                                    <div
                                                                        className="truncate text-gray-500 text-xs"
                                                                        title={addon.fingerprint}
                                                                    >
                                                                        FP:{" "}
                                                                        {addon.fingerprint.slice(
                                                                            0,
                                                                            50
                                                                        )}
                                                                        ...
                                                                    </div>
                                                                </div>
                                                            ))}
                                                        </div>
                                                    </div>
                                                    <div>
                                                        <h4 className="mb-2 font-medium text-muted text-sm">
                                                            Desired Addons ({syncPlan.desiredCount})
                                                        </h4>
                                                        <div className="max-h-48 space-y-1 overflow-y-auto">
                                                            {syncPlan.desired.map((addon, idx) => (
                                                                <div
                                                                    className="break-all rounded bg-surface-hover p-2 font-mono text-xs"
                                                                    key={idx}
                                                                >
                                                                    <span className="text-green-400">
                                                                        {addon.name}
                                                                    </span>
                                                                    <div className="truncate text-muted">
                                                                        {addon.transportUrl}
                                                                    </div>
                                                                    <div
                                                                        className="truncate text-gray-500 text-xs"
                                                                        title={addon.fingerprint}
                                                                    >
                                                                        FP:{" "}
                                                                        {addon.fingerprint.slice(
                                                                            0,
                                                                            50
                                                                        )}
                                                                        ...
                                                                    </div>
                                                                </div>
                                                            ))}
                                                        </div>
                                                    </div>
                                                </div>
                                                <button
                                                    className="mt-3 mr-2 rounded bg-surface-hover px-3 py-1 text-xs transition-colors hover:bg-primary hover:text-white"
                                                    onClick={refreshSyncPlan}
                                                    type="button"
                                                >
                                                    Refresh
                                                </button>
                                                <button
                                                    className="mt-3 rounded bg-surface-hover px-3 py-1 text-xs transition-colors hover:bg-primary hover:text-white"
                                                    onClick={() => {
                                                        const text = JSON.stringify(
                                                            {
                                                                current: syncPlan.current,
                                                                desired: syncPlan.desired,
                                                            },
                                                            null,
                                                            2
                                                        );
                                                        copyToClipboard(text);
                                                        toast.success("Copied to clipboard");
                                                    }}
                                                    type="button"
                                                >
                                                    Copy
                                                </button>
                                            </>
                                        )}
                                    </div>
                                </PageSection>
                            )}

                            <details className="profile-management mb-7">
                                <summary className="flex cursor-pointer items-center justify-between gap-4 rounded-2xl px-5 py-4">
                                    <span>
                                        <span className="block font-semibold text-default text-sm">
                                            Connections &amp; history
                                        </span>
                                        <span className="mt-1 block text-muted text-xs">
                                            Linked apps, history imports, and household preferences
                                        </span>
                                    </span>
                                    <span
                                        aria-hidden
                                        className="profile-management-indicator text-muted text-xl"
                                    >
                                        +
                                    </span>
                                </summary>
                                <div className="pt-5">
                                    {/* Manual merge - shown when this account hasn't already
                absorbed a second provider's account. */}
                                    {!mergeInfo && (
                                        <PageSection className="mb-6">
                                            <Card padding="lg">
                                                <div className="flex flex-wrap items-center justify-between gap-4">
                                                    <div className="flex items-center gap-3">
                                                        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-surface-hover">
                                                            <LinkIcon className="h-5 w-5 text-muted" />
                                                        </div>
                                                        <div>
                                                            <h3 className="font-semibold text-base text-default">
                                                                Same person on another provider?
                                                            </h3>
                                                            <p className="text-muted text-sm">
                                                                Merge this person with their login
                                                                on another app - Stremio, Nuvio,
                                                                Jellyfin or AIOStreams.
                                                            </p>
                                                        </div>
                                                    </div>
                                                    <Button
                                                        leftIcon={<LinkIcon className="h-4 w-4" />}
                                                        onClick={openMergePicker}
                                                        size="sm"
                                                        variant="secondary"
                                                    >
                                                        Merge with another user
                                                    </Button>
                                                </div>
                                            </Card>
                                        </PageSection>
                                    )}

                                    {/* Household numbers: a test or guest person can be left out of
                totals, Top Viewers and Wrapped without losing their own page. */}
                                    <PageSection className="mb-6">
                                        <Card padding="lg">
                                            <div className="flex items-center justify-between gap-4">
                                                <div className="min-w-0">
                                                    <h3 className="font-semibold text-base text-default">
                                                        Leave out of household numbers
                                                    </h3>
                                                    <p className="text-muted text-sm">
                                                        For a test or guest person: their viewing
                                                        stays on this page, but stops counting in
                                                        household totals, Top Viewers and Wrapped.
                                                    </p>
                                                </div>
                                                <ToggleSwitch
                                                    checked={!!user.excludeFromHouseholdStats}
                                                    onChange={async () => {
                                                        const v = !user.excludeFromHouseholdStats;
                                                        try {
                                                            await api.setHouseholdStats(user.id, v);
                                                            setUser((prev: typeof user) =>
                                                                prev
                                                                    ? {
                                                                          ...prev,
                                                                          excludeFromHouseholdStats:
                                                                              v,
                                                                      }
                                                                    : prev
                                                            );
                                                            toast.success(
                                                                v
                                                                    ? `${user.username} is left out of household numbers`
                                                                    : `${user.username} counts in household numbers again`
                                                            );
                                                        } catch (err) {
                                                            toast.error(
                                                                readErrorMessage(
                                                                    err,
                                                                    "Could not change that"
                                                                )
                                                            );
                                                        }
                                                    }}
                                                    title="Leave out of household numbers"
                                                />
                                            </div>
                                        </Card>
                                    </PageSection>

                                    {/* Watch-tracking integrations. Trakt used to sit here as a
                second row doing a one-time OAuth pull; Trakt now gates
                creating an API application behind VIP, so that route needed
                a paid Trakt account to work at all. Bringing a Trakt history
                across is handled by the import below instead, which reads
                Trakt's own free export and needs no app and no VIP. */}
                                    {/* Their Jellyfin / AIOStreams / AIOMetadata in their Nuvio profile -
                only for someone with both sign-ins (renders nothing otherwise). */}
                                    <PageSection className="mb-6 empty:hidden">
                                        <NuvioServersTile userId={user.id} />
                                    </PageSection>

                                    <PageSection className="mb-6">
                                        <Card padding="lg">
                                            <button
                                                aria-expanded={openSections.tracking}
                                                className="flex w-full items-center justify-between gap-3 text-left"
                                                onClick={() => toggleSection("tracking")}
                                                type="button"
                                            >
                                                <div className="min-w-0">
                                                    <h3 className="mb-1 font-semibold text-default text-lg">
                                                        Watch-Tracking Integrations
                                                    </h3>
                                                    <p className="text-muted text-sm">
                                                        {openSections.tracking
                                                            ? "Link this user's history to an external tracker"
                                                            : `${user.simklConnected ? "SIMKL linked" : "SIMKL not linked"} · SlickTrax ${user.traxAddonEnabled ? "on" : "off"}`}
                                                    </p>
                                                </div>
                                                <ChevronDownIcon
                                                    className="h-5 w-5 shrink-0 text-muted transition-transform"
                                                    style={{
                                                        transform: openSections.tracking
                                                            ? "rotate(180deg)"
                                                            : "none",
                                                    }}
                                                />
                                            </button>

                                            {openSections.tracking && (
                                                <div className="mt-4">
                                                    <div className="flex flex-wrap items-center justify-between gap-4 py-3">
                                                        <div className="flex items-center gap-3">
                                                            <div
                                                                className={`flex h-10 w-10 items-center justify-center rounded-xl ${user.simklConnected ? "bg-success-muted" : "bg-primary-muted"}`}
                                                            >
                                                                <ArrowPathIcon
                                                                    className={`h-5 w-5 ${user.simklConnected ? "text-success" : "text-primary"}`}
                                                                />
                                                            </div>
                                                            <div>
                                                                <div className="flex items-center gap-2">
                                                                    <h4 className="font-semibold text-default">
                                                                        SIMKL
                                                                    </h4>
                                                                    {user.simklConnected && (
                                                                        <Badge
                                                                            size="sm"
                                                                            variant="success"
                                                                        >
                                                                            Linked
                                                                        </Badge>
                                                                    )}
                                                                </div>
                                                                <p className="text-muted text-sm">
                                                                    {user.simklConnected
                                                                        ? `Watch history syncs both ways with SIMKL${user.simklConnectedAt ? ` since ${new Date(user.simklConnectedAt).toLocaleDateString()}` : ""}.`
                                                                        : "Pull watch history from SIMKL and push everything this user watches back to it - a two-way sync, checked every 30 minutes."}
                                                                </p>
                                                            </div>
                                                        </div>
                                                        {user.simklConnected ? (
                                                            <Button
                                                                isLoading={isDisconnectingSimkl}
                                                                onClick={async () => {
                                                                    if (
                                                                        !confirm(
                                                                            "Disconnect SIMKL? Watch history already pulled stays in place, only the link stops."
                                                                        )
                                                                    ) {
                                                                        return;
                                                                    }
                                                                    setIsDisconnectingSimkl(true);
                                                                    try {
                                                                        await api.disconnectSimkl(
                                                                            user.id
                                                                        );
                                                                        toast.success(
                                                                            "SIMKL disconnected"
                                                                        );
                                                                        setUser((prev: any) =>
                                                                            prev
                                                                                ? {
                                                                                      ...prev,
                                                                                      simklConnected: false,
                                                                                      simklConnectedAt:
                                                                                          null,
                                                                                  }
                                                                                : prev
                                                                        );
                                                                    } catch (err) {
                                                                        toast.error(
                                                                            readErrorMessage(
                                                                                err,
                                                                                "Failed to disconnect SIMKL"
                                                                            )
                                                                        );
                                                                    } finally {
                                                                        setIsDisconnectingSimkl(
                                                                            false
                                                                        );
                                                                    }
                                                                }}
                                                                size="sm"
                                                                variant="ghost"
                                                            >
                                                                Disconnect
                                                            </Button>
                                                        ) : (
                                                            <Button
                                                                leftIcon={
                                                                    <LinkIcon className="h-4 w-4" />
                                                                }
                                                                onClick={() =>
                                                                    setIsSimklModalOpen(true)
                                                                }
                                                                size="sm"
                                                                variant="primary"
                                                            >
                                                                Link SIMKL
                                                            </Button>
                                                        )}
                                                    </div>

                                                    <div
                                                        className="border-t"
                                                        style={{
                                                            borderColor:
                                                                "var(--color-surface-border)",
                                                        }}
                                                    />

                                                    {/* SlickTrax Addon - SlickSync AS a Stremio addon: one
                    per-user manifest URL serving Continue Watching /
                    Watchlist / Catalogs as live rows inside Stremio and
                    Nuvio. Enabled here, installed by the next sync. */}
                                                    <div className="py-3">
                                                        <div className="flex flex-wrap items-center justify-between gap-4">
                                                            <div className="flex items-center gap-3">
                                                                <div
                                                                    className={`flex h-10 w-10 items-center justify-center rounded-xl ${user.traxAddonEnabled ? "bg-success-muted" : "bg-primary-muted"}`}
                                                                >
                                                                    <PuzzlePieceIcon
                                                                        className={`h-5 w-5 ${user.traxAddonEnabled ? "text-success" : "text-primary"}`}
                                                                    />
                                                                </div>
                                                                <div>
                                                                    <div className="flex items-center gap-2">
                                                                        <h4 className="font-semibold text-default">
                                                                            SlickTrax Addon
                                                                        </h4>
                                                                        {user.traxAddonEnabled && (
                                                                            <Badge
                                                                                size="sm"
                                                                                variant="success"
                                                                            >
                                                                                Enabled
                                                                            </Badge>
                                                                        )}
                                                                    </div>
                                                                    <p className="text-muted text-sm">
                                                                        {user.traxAddonEnabled
                                                                            ? "Continue Watching, Watchlist and Catalogs appear as rows inside Stremio/Nuvio. Kept installed by sync."
                                                                            : "Put SlickTrax inside the apps: Continue Watching, Watchlist and every Catalog as real rows on this user's devices."}
                                                                    </p>
                                                                    {user.traxAddonEnabled &&
                                                                        traxManifestUrl && (
                                                                            <button
                                                                                className="mt-1 break-all text-left text-muted text-xs underline underline-offset-2 hover:text-default"
                                                                                onClick={async () => {
                                                                                    (await copyToClipboard(
                                                                                        traxManifestUrl
                                                                                    ))
                                                                                        ? toast.success(
                                                                                              "Manifest URL copied"
                                                                                          )
                                                                                        : toast.error(
                                                                                              "Copy failed - select and copy the URL text directly"
                                                                                          );
                                                                                }}
                                                                                title="Copy manifest URL"
                                                                                type="button"
                                                                            >
                                                                                {traxManifestUrl}
                                                                            </button>
                                                                        )}
                                                                </div>
                                                            </div>
                                                            <Button
                                                                isLoading={isTogglingTrax}
                                                                onClick={handleToggleTraxAddon}
                                                                size="sm"
                                                                variant={
                                                                    user.traxAddonEnabled
                                                                        ? "ghost"
                                                                        : "primary"
                                                                }
                                                            >
                                                                {user.traxAddonEnabled
                                                                    ? "Disable"
                                                                    : "Enable"}
                                                            </Button>
                                                        </div>

                                                        {user.traxAddonEnabled && (
                                                            <div className="pl-13">
                                                                <TraxRowsEditor userId={user.id} />
                                                            </div>
                                                        )}
                                                    </div>

                                                    <div
                                                        className="border-t"
                                                        style={{
                                                            borderColor:
                                                                "var(--color-surface-border)",
                                                        }}
                                                    />

                                                    {/* AIOStreams watch history - the Watch State exchange.
                    See server/utils/watchState.js. */}
                                                    <WatchStateRow userId={user.id} />

                                                    {/* Played marks pushed to their real Jellyfin server; only
                    shows for someone who has one. */}
                                                    <MarkPlayedRow userId={user.id} />

                                                    {/* Opt-in: Vault key changes reach their AIOStreams setup. */}
                                                    <AioRotateKeysRow
                                                        name={user.username || user.name || "them"}
                                                        userId={user.id}
                                                    />
                                                </div>
                                            )}
                                        </Card>
                                    </PageSection>

                                    {/* Merged-account state - this user has already absorbed a
                second provider's account. See server/utils/userMerge.js;
                undo is best-effort (see its module comment for exactly
                what it can and can't reverse). */}
                                    {mergeInfo && (
                                        <PageSection className="mb-6">
                                            <Card padding="lg">
                                                <div className="flex flex-wrap items-center justify-between gap-4">
                                                    <div className="flex items-center gap-3">
                                                        <UserAvatar
                                                            colorIndex={
                                                                mergeInfo.donorColorIndex ??
                                                                undefined
                                                            }
                                                            email={
                                                                mergeInfo.donorEmail || undefined
                                                            }
                                                            name={
                                                                mergeInfo.donorUsername || undefined
                                                            }
                                                            size="md"
                                                            src={
                                                                mergeInfo.donorAvatarUrl ??
                                                                undefined
                                                            }
                                                            useGravatar={mergeInfo.donorUseGravatar}
                                                            userId={`${params.id}-merged-donor`}
                                                        />
                                                        <div>
                                                            <h3 className="font-semibold text-default text-lg">
                                                                Merged with{" "}
                                                                {mergeInfo.donorUsername ||
                                                                    "a second account"}
                                                            </h3>
                                                            <div className="mt-1 flex items-center gap-2">
                                                                <Badge
                                                                    size="sm"
                                                                    variant={providerBadgeVariant({
                                                                        providerType:
                                                                            mergeInfo.providerType,
                                                                    })}
                                                                >
                                                                    {providerLabel({
                                                                        providerType:
                                                                            mergeInfo.providerType,
                                                                    })}
                                                                </Badge>
                                                                <p className="text-muted text-sm">
                                                                    {mergeInfo.donorEmail ||
                                                                        "Its watch history now lives on this account"}
                                                                </p>
                                                            </div>
                                                        </div>
                                                    </div>
                                                    {mergeInfo.undoable ? (
                                                        <Button
                                                            onClick={() => setIsUndoModalOpen(true)}
                                                            size="sm"
                                                            variant="secondary"
                                                        >
                                                            Undo merge
                                                        </Button>
                                                    ) : (
                                                        <p className="max-w-xs text-right text-muted text-xs">
                                                            Can't be undone automatically (no
                                                            archive on file)
                                                        </p>
                                                    )}
                                                </div>
                                            </Card>
                                        </PageSection>
                                    )}

                                    {/* Watch History Import/Export - the biggest adoption blocker
                for a Trakt alternative is leaving your history behind, so
                this lets an admin bring an existing IMDb/Letterboxd CSV or
                a Trakt JSON export straight into this user's SlickTrax
                history, and export a Letterboxd-compatible CSV to leave with
                too. Trakt's own export (Settings -> Data on trakt.tv) is free
                and needs no API app, which the removed OAuth route did. */}
                                    <PageSection className="mb-6">
                                        <Card padding="lg">
                                            <button
                                                aria-expanded={openSections.history}
                                                className="flex w-full items-center justify-between gap-3 text-left"
                                                onClick={() => toggleSection("history")}
                                                type="button"
                                            >
                                                <div className="min-w-0">
                                                    <h3 className="font-semibold text-default text-lg">
                                                        Watch History Import/Export
                                                    </h3>
                                                    {!openSections.history && (
                                                        <p className="mt-0.5 text-muted text-sm">
                                                            Bring in an IMDb, Letterboxd, Trakt,
                                                            Netflix, TV Time, Plex or Movary export,
                                                            or take a copy out
                                                        </p>
                                                    )}
                                                </div>
                                                <ChevronDownIcon
                                                    className="h-5 w-5 shrink-0 text-muted transition-transform"
                                                    style={{
                                                        transform: openSections.history
                                                            ? "rotate(180deg)"
                                                            : "none",
                                                    }}
                                                />
                                            </button>
                                            {/* A new, nearly empty sign-in: offer to bring their history over. */}
                                            <SignInOfferBanner userId={user.id} />
                                            {/* AIOSync between their sign-ins (its own page; also on Tasks). */}
                                            <CopyHistoryTile
                                                name={user.username}
                                                userId={user.id}
                                            />

                                            {openSections.history && (
                                                <div className="mt-4">
                                                    <div className="mb-4 flex items-center justify-between">
                                                        <div>
                                                            {/* Each service is linked straight to its own export
                        page. Telling someone to "go to Settings -> Data"
                        still leaves them hunting through a site they may
                        not use often; the link just takes them there. */}
                                                            <p className="mt-0.5 text-muted text-sm">
                                                                Bring in an export from another
                                                                service &mdash; get yours from{" "}
                                                                <a
                                                                    className="text-primary hover:underline"
                                                                    href="https://www.imdb.com/exports/"
                                                                    rel="noopener noreferrer"
                                                                    target="_blank"
                                                                >
                                                                    IMDb
                                                                </a>
                                                                ,{" "}
                                                                <a
                                                                    className="text-primary hover:underline"
                                                                    href="https://letterboxd.com/settings/data/"
                                                                    rel="noopener noreferrer"
                                                                    target="_blank"
                                                                >
                                                                    Letterboxd
                                                                </a>
                                                                , or{" "}
                                                                <a
                                                                    className="text-primary hover:underline"
                                                                    href="https://trakt.tv/settings/data"
                                                                    rel="noopener noreferrer"
                                                                    target="_blank"
                                                                >
                                                                    Trakt
                                                                </a>
                                                                .
                                                            </p>
                                                            <p className="mt-1 text-muted text-sm">
                                                                IMDb and Letterboxd give you a CSV
                                                                you can import directly. Trakt gives
                                                                you a ZIP &mdash; unzip it and
                                                                select every file inside at once;
                                                                only the history and ratings JSON
                                                                actually carry anything importable,
                                                                everything else is skipped
                                                                automatically. Netflix (Account
                                                                &rarr; Viewing activity &rarr;
                                                                Download all), TV Time,
                                                                Plex/Tautulli and Movary CSV exports
                                                                work through the same button too.
                                                                Movies and their ratings are
                                                                imported; episode history is
                                                                skipped. You can also export this
                                                                user&apos;s history as a
                                                                Letterboxd-compatible CSV.
                                                            </p>
                                                        </div>
                                                    </div>
                                                    <div className="flex flex-wrap items-center gap-2">
                                                        <input
                                                            accept=".csv,text/csv,.json,application/json"
                                                            className="hidden"
                                                            multiple
                                                            onChange={handleImportHistoryFile}
                                                            ref={historyFileInputRef}
                                                            type="file"
                                                        />
                                                        <Button
                                                            isLoading={isImportingHistory}
                                                            leftIcon={
                                                                <ArrowUpTrayIcon className="h-4 w-4" />
                                                            }
                                                            onClick={() =>
                                                                historyFileInputRef.current?.click()
                                                            }
                                                            size="sm"
                                                            variant="secondary"
                                                        >
                                                            {historyImportProgress
                                                                ? `Importing ${historyImportProgress.done}/${historyImportProgress.total}...`
                                                                : "Import history"}
                                                        </Button>
                                                        <Button
                                                            isLoading={isExportingHistory}
                                                            leftIcon={
                                                                <ArrowDownTrayIcon className="h-4 w-4" />
                                                            }
                                                            onClick={handleExportHistory}
                                                            size="sm"
                                                            variant="secondary"
                                                        >
                                                            Export CSV
                                                        </Button>
                                                    </div>
                                                    {historyImportResult && (
                                                        <div
                                                            className="mt-4 rounded-lg p-3 text-sm"
                                                            style={{
                                                                background:
                                                                    "var(--color-surface-hover)",
                                                            }}
                                                        >
                                                            <p className="text-default">
                                                                Imported{" "}
                                                                <strong>
                                                                    {historyImportResult.imported}
                                                                </strong>{" "}
                                                                title
                                                                {historyImportResult.imported === 1
                                                                    ? ""
                                                                    : "s"}
                                                                {historyImportResult.filesProcessed >
                                                                    1 &&
                                                                    ` from ${historyImportResult.filesUsed} of ${historyImportResult.filesProcessed} files`}
                                                                {historyImportResult.skipped > 0 &&
                                                                    ` (${historyImportResult.skipped} skipped)`}
                                                                {historyImportResult.truncated &&
                                                                    " - a file was larger than the 2,000-row import cap"}
                                                            </p>
                                                            {historyImportResult.unresolvedTitles
                                                                .length > 0 && (
                                                                <p className="mt-1.5 text-muted text-xs">
                                                                    Couldn't resolve:{" "}
                                                                    {historyImportResult.unresolvedTitles.join(
                                                                        ", "
                                                                    )}
                                                                </p>
                                                            )}
                                                            {/* Named rather than silently dropped - lets someone
                        importing a whole unzipped Trakt export confirm the
                        files skipped were the expected ones (collections,
                        comments, lists, network, hidden progress, and so on)
                        rather than history/ratings that failed to parse. */}
                                                            {historyImportResult.filesUnusable
                                                                .length > 0 && (
                                                                <p className="mt-1.5 text-muted text-xs">
                                                                    No importable entries in:{" "}
                                                                    {historyImportResult.filesUnusable.join(
                                                                        ", "
                                                                    )}
                                                                </p>
                                                            )}
                                                        </div>
                                                    )}
                                                </div>
                                            )}
                                        </Card>
                                    </PageSection>
                                </div>
                            </details>

                            {/* Tab Navigation */}
                            <PageSection className="mb-6 md:mb-8">
                                <FilterTabs
                                    activeKey={activeTab}
                                    onChange={(key) => {
                                        if (key === "overview" || key === "addons") {
                                            setActiveTab(key);
                                        }
                                    }}
                                    options={[
                                        { key: "overview", label: "Overview" },
                                        ...(hasAddonList(user)
                                            ? [
                                                  {
                                                      count: stremioAddons.length || undefined,
                                                      icon: <PuzzlePieceIcon className="h-4 w-4" />,
                                                      key: "addons",
                                                      label: "Addons",
                                                  },
                                              ]
                                            : []),
                                    ]}
                                />
                            </PageSection>

                            {activeTab === "overview" && (
                                <>
                                    {/* Stats Cards */}
                                    <PageSection className="mb-8" delay={0.1}>
                                        <div className="profile-summary-grid grid grid-cols-2 gap-3 md:gap-4 lg:grid-cols-4">
                                            <Link
                                                href={`/activity?user=${encodeURIComponent(user?.username || "")}&period=today`}
                                            >
                                                <StatCard
                                                    delay={0}
                                                    icon={<ClockIcon className="h-6 w-6" />}
                                                    label="Watch Time Today"
                                                    value={
                                                        isLoading
                                                            ? "..."
                                                            : formatMinutes(liveTodayMinutes)
                                                    }
                                                />
                                            </Link>
                                            <Link
                                                href={`/activity?user=${encodeURIComponent(user?.username || "")}&period=week`}
                                            >
                                                <StatCard
                                                    delay={0.05}
                                                    icon={<CalendarIcon className="h-6 w-6" />}
                                                    label="Watch Time This Week"
                                                    value={
                                                        isLoading
                                                            ? "..."
                                                            : formatMinutes(liveWeekMinutes)
                                                    }
                                                />
                                            </Link>
                                            <StatCard
                                                delay={0.1}
                                                icon={<FireIcon className="h-6 w-6" />}
                                                label="Current Streak"
                                                value={`${streaks?.currentStreak || 0} days`}
                                            />
                                            <StatCard
                                                delay={0.15}
                                                icon={<BoltIcon className="h-6 w-6" />}
                                                label="Watch Velocity"
                                                value="0h/day"
                                            />
                                        </div>
                                    </PageSection>

                                    {/* Charts Section */}
                                    <PageSection className="mb-8" delay={0.2}>
                                        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
                                            {watchTimeData.length > 0 ? (
                                                <>
                                                    <WatchTimeChart data={watchTimeData} />
                                                    <ContentBreakdownChart data={watchTimeData} />
                                                </>
                                            ) : (
                                                <div className="col-span-2 py-16 text-center text-muted">
                                                    No watch time data available
                                                </div>
                                            )}
                                        </div>
                                    </PageSection>

                                    {/* Top Items and Activity */}
                                    <PageSection delay={0.3}>
                                        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
                                            {/* Top Items */}
                                            <Card padding="lg">
                                                <div className="detail-section-header mb-6 flex items-center justify-between">
                                                    <h3 className="font-display font-semibold text-default text-lg">
                                                        Top Watched
                                                    </h3>
                                                </div>

                                                <StaggerContainer className="space-y-3">
                                                    {userTopItems.length > 0 ? (
                                                        userTopItems.map((item, index) => (
                                                            <StaggerItem key={item.id}>
                                                                <motion.div
                                                                    className="group flex cursor-pointer items-center gap-4 rounded-xl bg-surface-hover p-3 transition-colors hover:bg-surface"
                                                                    whileHover={{ x: 4 }}
                                                                >
                                                                    {/* Rank */}
                                                                    <div
                                                                        className="flex h-8 w-8 items-center justify-center rounded-lg font-bold text-muted text-sm"
                                                                        style={{
                                                                            background:
                                                                                "var(--color-surface)",
                                                                        }}
                                                                    >
                                                                        {index + 1}
                                                                    </div>

                                                                    {/* Poster */}
                                                                    <div className="flex h-16 w-12 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-surface shadow-inner">
                                                                        {item.poster ? (
                                                                            <img
                                                                                alt={item.name}
                                                                                className="h-full w-full object-cover"
                                                                                src={item.poster}
                                                                            />
                                                                        ) : (
                                                                            <div
                                                                                className="flex h-full w-full items-center justify-center"
                                                                                style={{
                                                                                    background:
                                                                                        "var(--color-primary-muted)",
                                                                                }}
                                                                            >
                                                                                {item.type ===
                                                                                "movie" ? (
                                                                                    <FilmIcon
                                                                                        className="h-6 w-6"
                                                                                        style={{
                                                                                            color: "var(--color-primary)",
                                                                                        }}
                                                                                    />
                                                                                ) : (
                                                                                    <TvIcon
                                                                                        className="h-6 w-6"
                                                                                        style={{
                                                                                            color: "var(--color-secondary)",
                                                                                        }}
                                                                                    />
                                                                                )}
                                                                            </div>
                                                                        )}
                                                                    </div>

                                                                    {/* Info */}
                                                                    <div className="min-w-0 flex-1">
                                                                        <p className="truncate font-medium text-default transition-colors group-hover:text-primary">
                                                                            {item.name}
                                                                        </p>
                                                                        <p className="text-muted text-sm">
                                                                            {formatMinutes(
                                                                                Math.round(
                                                                                    item.watchTime
                                                                                )
                                                                            )}{" "}
                                                                            watched
                                                                        </p>
                                                                        {/* Progress bar */}
                                                                        <div
                                                                            className="mt-2 h-1 overflow-hidden rounded-full"
                                                                            style={{
                                                                                background:
                                                                                    "var(--color-surface)",
                                                                            }}
                                                                        >
                                                                            <motion.div
                                                                                animate={{
                                                                                    width: `${item.progress}%`,
                                                                                }}
                                                                                className="h-full rounded-full"
                                                                                initial={{
                                                                                    width: 0,
                                                                                }}
                                                                                style={{
                                                                                    background:
                                                                                        item.type ===
                                                                                        "movie"
                                                                                            ? "var(--color-chart-1)"
                                                                                            : "var(--color-chart-2)",
                                                                                }}
                                                                                transition={{
                                                                                    delay:
                                                                                        index * 0.1,
                                                                                    duration: 0.8,
                                                                                }}
                                                                            />
                                                                        </div>
                                                                    </div>

                                                                    {/* Badge */}
                                                                    <Badge
                                                                        size="sm"
                                                                        variant={
                                                                            item.type === "movie"
                                                                                ? "primary"
                                                                                : "secondary"
                                                                        }
                                                                    >
                                                                        {item.type}
                                                                    </Badge>
                                                                </motion.div>
                                                            </StaggerItem>
                                                        ))
                                                    ) : (
                                                        <div className="py-8 text-center text-muted text-sm">
                                                            No top items data
                                                        </div>
                                                    )}
                                                </StaggerContainer>
                                            </Card>

                                            {/* Activity Timeline */}
                                            <Card padding="lg">
                                                <div className="detail-section-header mb-6 flex items-center justify-between">
                                                    <h3 className="font-display font-semibold text-default text-lg">
                                                        Recent Activity
                                                    </h3>
                                                </div>

                                                <StaggerContainer className="space-y-3">
                                                    {userRecentActivity.length > 0 ? (
                                                        userRecentActivity.map(
                                                            (s: any, index: number) => (
                                                                <StaggerItem
                                                                    key={`activity-${s.id}-${index}`}
                                                                >
                                                                    <motion.div
                                                                        className="group flex cursor-pointer items-center gap-4 rounded-xl border border-transparent bg-surface-hover p-3 transition-colors hover:border-default hover:bg-surface"
                                                                        whileHover={{ x: 4 }}
                                                                    >
                                                                        {/* Poster */}
                                                                        <div className="flex h-16 w-12 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-surface shadow-inner">
                                                                            {s.item.poster ? (
                                                                                <img
                                                                                    alt={
                                                                                        s.item.name
                                                                                    }
                                                                                    className="h-full w-full object-cover"
                                                                                    src={
                                                                                        s.item
                                                                                            .poster
                                                                                    }
                                                                                />
                                                                            ) : (
                                                                                <div
                                                                                    className="flex h-full w-full items-center justify-center"
                                                                                    style={{
                                                                                        background:
                                                                                            "var(--color-primary-muted)",
                                                                                    }}
                                                                                >
                                                                                    {s.item.type ===
                                                                                    "movie" ? (
                                                                                        <FilmIcon
                                                                                            className="h-6 w-6"
                                                                                            style={{
                                                                                                color: "var(--color-primary)",
                                                                                            }}
                                                                                        />
                                                                                    ) : (
                                                                                        <TvIcon
                                                                                            className="h-6 w-6"
                                                                                            style={{
                                                                                                color: "var(--color-secondary)",
                                                                                            }}
                                                                                        />
                                                                                    )}
                                                                                </div>
                                                                            )}
                                                                        </div>

                                                                        {/* Info */}
                                                                        <div className="min-w-0 flex-1">
                                                                            <div className="mb-0.5 flex items-center gap-2">
                                                                                <p className="truncate font-medium text-default transition-colors group-hover:text-primary">
                                                                                    {s.item.name}
                                                                                </p>
                                                                                {s.isActive && (
                                                                                    <div className="flex items-center gap-1.5 rounded-full border border-primary/20 bg-primary/10 px-2 py-0.5">
                                                                                        <div className="h-1.5 w-1.5 animate-pulse rounded-full bg-primary" />
                                                                                        <span className="font-bold text-[10px] text-primary uppercase tracking-wider">
                                                                                            Live
                                                                                        </span>
                                                                                    </div>
                                                                                )}
                                                                            </div>
                                                                            <div className="flex items-center gap-2 text-muted text-xs">
                                                                                {s.item.type ===
                                                                                    "series" &&
                                                                                    s.item
                                                                                        .season && (
                                                                                        <span className="font-medium text-secondary">
                                                                                            S
                                                                                            {String(
                                                                                                s
                                                                                                    .item
                                                                                                    .season
                                                                                            ).padStart(
                                                                                                2,
                                                                                                "0"
                                                                                            )}
                                                                                            E
                                                                                            {String(
                                                                                                s
                                                                                                    .item
                                                                                                    .episode
                                                                                            ).padStart(
                                                                                                2,
                                                                                                "0"
                                                                                            )}
                                                                                        </span>
                                                                                    )}
                                                                                <span>
                                                                                    {new Date(
                                                                                        s.startTime
                                                                                    ).toLocaleTimeString(
                                                                                        [],
                                                                                        {
                                                                                            hour: "2-digit",
                                                                                            minute: "2-digit",
                                                                                        }
                                                                                    )}
                                                                                </span>
                                                                                {s.durationSeconds >
                                                                                    0 && (
                                                                                    <>
                                                                                        <span>
                                                                                            •
                                                                                        </span>
                                                                                        <span>
                                                                                            {formatMinutes(
                                                                                                Math.round(
                                                                                                    s.durationSeconds /
                                                                                                        60
                                                                                                )
                                                                                            )}
                                                                                        </span>
                                                                                    </>
                                                                                )}
                                                                            </div>
                                                                        </div>

                                                                        {/* Status */}
                                                                        <div className="shrink-0">
                                                                            {s.isActive ? (
                                                                                <div className="rounded-full bg-secondary/10 p-2">
                                                                                    <PlayIcon className="h-4 w-4 text-secondary" />
                                                                                </div>
                                                                            ) : (
                                                                                <div className="rounded-full bg-primary/10 p-2">
                                                                                    <CheckCircleIcon className="h-4 w-4 text-primary" />
                                                                                </div>
                                                                            )}
                                                                        </div>
                                                                    </motion.div>
                                                                </StaggerItem>
                                                            )
                                                        )
                                                    ) : (
                                                        <div className="py-8 text-center text-muted text-sm">
                                                            No recent activity
                                                        </div>
                                                    )}
                                                </StaggerContainer>
                                            </Card>
                                        </div>
                                    </PageSection>
                                </>
                            )}

                            {/* Addons Tab Content */}
                            {activeTab === "addons" && hasAddonList(user) && (
                                <>
                                    {/* Group Addons */}
                                    <PageSection className="mb-8" delay={0.1}>
                                        <Card padding="lg">
                                            <div className="detail-section-header mb-6 flex items-center justify-between">
                                                <div className="flex items-center gap-3">
                                                    <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/20">
                                                        <PuzzlePieceIcon className="h-5 w-5 text-primary" />
                                                    </div>
                                                    <div>
                                                        <h3 className="font-semibold text-default text-lg">
                                                            Group Addons
                                                        </h3>
                                                        <p className="text-muted text-sm">
                                                            {groupAddons.length} addon
                                                            {groupAddons.length === 1 ? "" : "s"}{" "}
                                                            from your group
                                                            {excludedAddonIds.size > 0 &&
                                                                ` • ${excludedAddonIds.size} excluded`}
                                                        </p>
                                                    </div>
                                                </div>
                                                <Button
                                                    disabled={isRefreshingAddons}
                                                    onClick={() => refreshGroupAddons(true)}
                                                    size="sm"
                                                    title="Refresh addons"
                                                    variant="ghost"
                                                >
                                                    <ArrowPathIcon
                                                        className={`h-4 w-4 ${isRefreshingAddons ? "animate-spin" : ""}`}
                                                    />
                                                </Button>
                                            </div>

                                            {groupAddons.length > 0 ? (
                                                <DraggableList
                                                    items={groupAddons.map((addon) => addon.id)}
                                                    onDragEnd={handleGroupAddonDragEnd}
                                                    renderItem={({
                                                        id,
                                                        dragHandleProps,
                                                        itemProps,
                                                        isDragging,
                                                    }) => {
                                                        const addon = groupAddons.find(
                                                            (a) => a.id === id
                                                        );
                                                        if (!addon) {
                                                            return null;
                                                        }
                                                        const isExcluded = excludedAddonIds.has(
                                                            addon.id
                                                        );
                                                        return (
                                                            <motion.div
                                                                className={`group flex items-center gap-3 rounded-xl border bg-surface-hover p-4 transition-all hover:bg-surface ${
                                                                    isExcluded
                                                                        ? "border-default opacity-50"
                                                                        : "border-default hover:border-primary"
                                                                } ${isDragging ? "shadow-lg ring-2 ring-primary" : ""}`}
                                                                ref={itemProps.ref}
                                                                style={itemProps.style}
                                                            >
                                                                <div
                                                                    {...dragHandleProps}
                                                                    className="cursor-grab rounded p-1 hover:bg-surface-hover active:cursor-grabbing"
                                                                >
                                                                    <Bars3Icon className="h-5 w-5 text-subtle" />
                                                                </div>
                                                                <Link
                                                                    className="flex min-w-0 flex-1 cursor-pointer items-center gap-3"
                                                                    href={`/addons/${addon.id}`}
                                                                    onClick={(e) =>
                                                                        e.stopPropagation()
                                                                    }
                                                                >
                                                                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary-muted">
                                                                        {addon.customLogo ? (
                                                                            <img
                                                                                alt={addon.name}
                                                                                className="h-6 w-6 object-contain"
                                                                                src={
                                                                                    addon.customLogo
                                                                                }
                                                                            />
                                                                        ) : addon.logo ? (
                                                                            <img
                                                                                alt={addon.name}
                                                                                className="h-6 w-6 object-contain"
                                                                                src={addon.logo}
                                                                            />
                                                                        ) : (
                                                                            <PuzzlePieceIcon className="h-5 w-5 text-primary" />
                                                                        )}
                                                                    </div>
                                                                    <div className="min-w-0 flex-1">
                                                                        <div className="mb-1 flex items-center gap-2">
                                                                            <h4
                                                                                className={`min-w-0 flex-1 truncate font-medium ${isExcluded ? "text-muted line-through" : "text-default"}`}
                                                                            >
                                                                                {addon.name}
                                                                            </h4>
                                                                            {addon.version && (
                                                                                <VersionBadge
                                                                                    size="sm"
                                                                                    version={
                                                                                        addon.version
                                                                                    }
                                                                                />
                                                                            )}
                                                                            {addon.isBackup && (
                                                                                <Badge
                                                                                    size="sm"
                                                                                    title={`Primary (${addon.primaryAddonName}) is offline`}
                                                                                    variant="warning"
                                                                                >
                                                                                    Backup
                                                                                </Badge>
                                                                            )}
                                                                            {isExcluded && (
                                                                                <Badge
                                                                                    size="sm"
                                                                                    variant="error"
                                                                                >
                                                                                    Excluded
                                                                                </Badge>
                                                                            )}
                                                                        </div>
                                                                        {addon.isBackup &&
                                                                            addon.primaryAddonName && (
                                                                                <p className="mb-1 truncate text-warning text-xs">
                                                                                    Primary offline:{" "}
                                                                                    {
                                                                                        addon.primaryAddonName
                                                                                    }
                                                                                </p>
                                                                            )}
                                                                        {addon.description && (
                                                                            <p className="mb-1 truncate text-muted text-xs">
                                                                                {addon.description}
                                                                            </p>
                                                                        )}
                                                                        {addon.resources &&
                                                                            addon.resources.length >
                                                                                0 && (
                                                                                <div className="mt-1 flex flex-wrap gap-1.5">
                                                                                    {addon.resources
                                                                                        .slice(0, 4)
                                                                                        .map(
                                                                                            (
                                                                                                res: string
                                                                                            ) => (
                                                                                                <ResourceBadge
                                                                                                    key={
                                                                                                        res
                                                                                                    }
                                                                                                    resource={
                                                                                                        res
                                                                                                    }
                                                                                                />
                                                                                            )
                                                                                        )}
                                                                                    {addon.resources
                                                                                        .length >
                                                                                        4 && (
                                                                                        <Badge
                                                                                            className="bg-surface"
                                                                                            size="sm"
                                                                                            variant="muted"
                                                                                        >
                                                                                            +
                                                                                            {addon
                                                                                                .resources
                                                                                                .length -
                                                                                                4}
                                                                                        </Badge>
                                                                                    )}
                                                                                </div>
                                                                            )}
                                                                    </div>
                                                                </Link>
                                                                <button
                                                                    aria-label={`${isExcluded ? "Include" : "Exclude"} ${addon.name}`}
                                                                    className={`rounded-lg p-2 transition-colors ${
                                                                        isExcluded
                                                                            ? "bg-error-muted text-error"
                                                                            : "text-muted hover:bg-error-muted hover:text-error"
                                                                    }`}
                                                                    onClick={() =>
                                                                        handleToggleExclude(
                                                                            addon.id
                                                                        )
                                                                    }
                                                                    type="button"
                                                                >
                                                                    {isExcluded ? (
                                                                        <ArrowPathIcon className="h-4 w-4" />
                                                                    ) : (
                                                                        <XMarkIcon className="h-4 w-4" />
                                                                    )}
                                                                </button>
                                                            </motion.div>
                                                        );
                                                    }}
                                                />
                                            ) : (
                                                <div className="py-8 text-center">
                                                    <PuzzlePieceIcon className="mx-auto mb-4 h-12 w-12 text-muted opacity-50" />
                                                    <p className="text-muted">
                                                        No group addons assigned
                                                    </p>
                                                    <p className="mt-1 text-sm text-subtle">
                                                        Join a group to get addons synced
                                                    </p>
                                                </div>
                                            )}
                                        </Card>
                                    </PageSection>

                                    {/* Account Addons - the provider's own addon collection
                    (Stremio's addonCollectionSet or Nuvio's equivalent),
                    not Stremio-specific despite the section's old name -
                    this same list renders for Nuvio users too. */}
                                    <PageSection delay={0.2}>
                                        <Card padding="lg">
                                            <div className="detail-section-header mb-6 flex items-center justify-between">
                                                <div className="flex items-center gap-3">
                                                    <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-secondary/20">
                                                        <FolderIcon className="h-5 w-5 text-secondary" />
                                                    </div>
                                                    <div>
                                                        <h3 className="font-semibold text-default text-lg">
                                                            Account Addons
                                                        </h3>
                                                        <p className="text-muted text-sm">
                                                            {providerAddonsLoading
                                                                ? "Checking connected account..."
                                                                : `${stremioAddons.length} addon${stremioAddons.length === 1 ? "" : "s"} in your account`}
                                                            {stremioAddons.length > 0 &&
                                                                " • Drag to reorder"}
                                                        </p>
                                                    </div>
                                                </div>
                                                {stremioAddons.length > 0 && (
                                                    <Button
                                                        onClick={handleResetStremioAddons}
                                                        size="sm"
                                                        variant="secondary"
                                                    >
                                                        Clear All
                                                    </Button>
                                                )}
                                            </div>

                                            {providerAddonsLoading ? (
                                                <p
                                                    className="py-6 text-muted text-sm"
                                                    role="status"
                                                >
                                                    Loading account addons...
                                                </p>
                                            ) : stremioAddons.length > 0 ? (
                                                <DraggableList
                                                    items={stremioAddons.map(
                                                        (addon) => addon.transportUrl
                                                    )}
                                                    onDragEnd={handleStremioAddonDragEnd}
                                                    renderItem={({
                                                        id,
                                                        dragHandleProps,
                                                        itemProps,
                                                        isDragging,
                                                    }) => {
                                                        const index = stremioAddons.findIndex(
                                                            (a) => a.transportUrl === id
                                                        );
                                                        if (index === -1) {
                                                            return null;
                                                        }
                                                        const addon = stremioAddons[index];
                                                        const name =
                                                            addon.manifest?.name || "Unknown Addon";
                                                        const version = addon.manifest?.version;
                                                        const description =
                                                            addon.manifest?.description;
                                                        const logo = addon.manifest?.logo;
                                                        const isProtected = protectedAddonNames.has(
                                                            addon.manifest?.name || ""
                                                        );
                                                        // Account Addons are raw entries from the provider's own addon
                                                        // collection - no SlickSync id of their own, only a transportUrl.
                                                        // GET /:id/group-addons also returns transportUrl per addon
                                                        // (despite the Addon TS type's manifestUrl field, which this
                                                        // endpoint doesn't actually populate) - match on that, through
                                                        // the same canonicalizer the backend uses everywhere else that
                                                        // compares two addon URLs, since they rarely match by exact
                                                        // string equality (http vs https, trailing /manifest.json,
                                                        // query strings, case). No match ⇒ not a SlickSync-managed
                                                        // addon, stays unlinked rather than guessing.
                                                        // A stream addon installed through their pause gate
                                                        // (/trax/gate/<token>/<addon id>/...) names its addon.
                                                        const canonicalTransportUrl =
                                                            canonicalizeManifestUrl(
                                                                addon.transportUrl
                                                            );
                                                        const gatedId =
                                                            /\/trax\/gate\/[a-f0-9]+\/([^/?#]+)\//i.exec(
                                                                addon.transportUrl || ""
                                                            )?.[1];
                                                        const matchedAddon = groupAddons.find(
                                                            (ga) =>
                                                                gatedId
                                                                    ? ga.id === gatedId
                                                                    : canonicalizeManifestUrl(
                                                                          ga.transportUrl
                                                                      ) === canonicalTransportUrl
                                                        );
                                                        const content = (
                                                            <>
                                                                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary-muted">
                                                                    {logo ? (
                                                                        <img
                                                                            alt={name}
                                                                            className="h-6 w-6 object-contain"
                                                                            src={logo}
                                                                        />
                                                                    ) : (
                                                                        <PuzzlePieceIcon className="h-5 w-5 text-primary" />
                                                                    )}
                                                                </div>
                                                                <div className="min-w-0 flex-1">
                                                                    <div className="mb-1 flex items-center gap-2">
                                                                        <h4 className="min-w-0 flex-1 truncate font-medium text-default">
                                                                            {name}
                                                                        </h4>
                                                                        {version && (
                                                                            <VersionBadge
                                                                                size="sm"
                                                                                version={version}
                                                                            />
                                                                        )}
                                                                        {isProtected && (
                                                                            <Badge
                                                                                size="sm"
                                                                                variant="success"
                                                                            >
                                                                                <ShieldCheckIcon className="mr-1 h-3 w-3" />
                                                                                Protected
                                                                            </Badge>
                                                                        )}
                                                                        {/* Cinemeta is the one addon on every
                                      account whose parts are worth removing
                                      individually - its catalogs sit at the
                                      top of the home screen and its metadata
                                      overrides addons installed to replace
                                      it. The row says when it has been
                                      patched, and the button leads to
                                      putting it back. */}
                                                                        {/cinemeta/i.test(
                                                                            addon.transportUrl || ""
                                                                        ) &&
                                                                            cinemetaPatched && (
                                                                                <Badge
                                                                                    size="sm"
                                                                                    variant="warning"
                                                                                >
                                                                                    Patched
                                                                                </Badge>
                                                                            )}
                                                                        {/cinemeta/i.test(
                                                                            addon.transportUrl || ""
                                                                        ) &&
                                                                            cinemetaState?.installed &&
                                                                            cinemetaState?.supported !==
                                                                                false && (
                                                                                <button
                                                                                    className="shrink-0 rounded-md px-2 py-0.5 text-xs transition-colors"
                                                                                    onClick={(
                                                                                        e
                                                                                    ) => {
                                                                                        e.preventDefault();
                                                                                        e.stopPropagation();
                                                                                        setCinemetaOpen(
                                                                                            true
                                                                                        );
                                                                                    }}
                                                                                    style={{
                                                                                        background:
                                                                                            "var(--color-surface-hover)",
                                                                                        color: "var(--color-text-muted)",
                                                                                    }}
                                                                                    type="button"
                                                                                >
                                                                                    {cinemetaPatched
                                                                                        ? "Edit patch"
                                                                                        : "Patch"}
                                                                                </button>
                                                                            )}
                                                                    </div>
                                                                    {description && (
                                                                        <p className="mb-1 truncate text-muted text-xs">
                                                                            {description}
                                                                        </p>
                                                                    )}
                                                                    {addon.manifest?.resources &&
                                                                        addon.manifest.resources
                                                                            .length > 0 && (
                                                                            <div className="mt-1 flex flex-wrap gap-1.5">
                                                                                {addon.manifest.resources
                                                                                    .slice(0, 4)
                                                                                    .map((res) => {
                                                                                        const resName =
                                                                                            typeof res ===
                                                                                            "string"
                                                                                                ? res
                                                                                                : res.name;
                                                                                        return (
                                                                                            <ResourceBadge
                                                                                                key={
                                                                                                    resName
                                                                                                }
                                                                                                resource={
                                                                                                    resName
                                                                                                }
                                                                                            />
                                                                                        );
                                                                                    })}
                                                                                {addon.manifest
                                                                                    .resources
                                                                                    .length > 4 && (
                                                                                    <Badge
                                                                                        className="bg-surface"
                                                                                        size="sm"
                                                                                        variant="muted"
                                                                                    >
                                                                                        +
                                                                                        {addon
                                                                                            .manifest
                                                                                            .resources
                                                                                            .length -
                                                                                            4}
                                                                                    </Badge>
                                                                                )}
                                                                            </div>
                                                                        )}
                                                                </div>
                                                            </>
                                                        );
                                                        return (
                                                            <motion.div
                                                                className={`group flex items-center gap-3 rounded-xl border border-default bg-surface-hover p-4 transition-all hover:bg-surface ${
                                                                    isDragging
                                                                        ? "shadow-lg ring-2 ring-primary"
                                                                        : ""
                                                                }`}
                                                                ref={itemProps.ref}
                                                                style={itemProps.style}
                                                            >
                                                                <div
                                                                    {...dragHandleProps}
                                                                    className="cursor-grab rounded p-1 hover:bg-surface-hover active:cursor-grabbing"
                                                                >
                                                                    <Bars3Icon className="h-5 w-5 text-subtle" />
                                                                </div>
                                                                {matchedAddon ? (
                                                                    <Link
                                                                        className="flex min-w-0 flex-1 cursor-pointer items-center gap-3"
                                                                        href={`/addons/${matchedAddon.id}`}
                                                                        onClick={(e) =>
                                                                            e.stopPropagation()
                                                                        }
                                                                    >
                                                                        {content}
                                                                    </Link>
                                                                ) : (
                                                                    <div className="flex min-w-0 flex-1 items-center gap-3">
                                                                        {content}
                                                                    </div>
                                                                )}
                                                                <div className="flex items-center gap-1 opacity-100 transition-opacity md:opacity-0 md:group-hover:opacity-100 md:focus-within:opacity-100">
                                                                    <button
                                                                        aria-label={`${isProtected ? "Unprotect" : "Protect"} ${name}`}
                                                                        className={`rounded-lg p-2 transition-colors ${
                                                                            isProtected
                                                                                ? "text-success hover:bg-success-muted"
                                                                                : "text-muted hover:bg-success-muted hover:text-success"
                                                                        }`}
                                                                        onClick={() =>
                                                                            handleToggleProtect(
                                                                                name
                                                                            )
                                                                        }
                                                                        type="button"
                                                                    >
                                                                        <ShieldCheckIcon className="h-4 w-4" />
                                                                    </button>
                                                                    <button
                                                                        aria-label={`Remove ${name}`}
                                                                        className="rounded-lg p-2 text-muted transition-colors hover:bg-error-muted hover:text-error"
                                                                        onClick={() =>
                                                                            handleRemoveStremioAddon(
                                                                                addon.transportUrl
                                                                            )
                                                                        }
                                                                        type="button"
                                                                    >
                                                                        <XMarkIcon className="h-4 w-4" />
                                                                    </button>
                                                                </div>
                                                            </motion.div>
                                                        );
                                                    }}
                                                />
                                            ) : (
                                                <div className="py-8 text-center">
                                                    <PuzzlePieceIcon className="mx-auto mb-4 h-12 w-12 text-muted opacity-50" />
                                                    <p className="text-muted">
                                                        No addons on their{" "}
                                                        {user ? providerLabel(user) : ""} account
                                                    </p>
                                                    <p className="mt-1 text-sm text-subtle">
                                                        Sync the user to populate their addons
                                                    </p>
                                                </div>
                                            )}
                                        </Card>
                                    </PageSection>
                                </>
                            )}
                        </>
                    ) : (
                        <div className="py-16 text-center">
                            <p className="text-muted">User not found</p>
                        </div>
                    )}
                </div>
            </div>

            {/* Delete Confirmation */}
            <ConfirmModal
                confirmText={isDeleting ? "Deleting..." : "Delete"}
                description={`Are you sure you want to delete ${user?.username || user?.name || "this user"}? This action cannot be undone.`}
                isLoading={isDeleting}
                isOpen={isDeleteModalOpen}
                onClose={() => setIsDeleteModalOpen(false)}
                onConfirm={handleDelete}
                title="Delete User"
                variant="danger"
            />

            {/* Undo-merge confirmation - splits the two accounts back apart using
          the pre-merge archive. Best-effort: any watching recorded on this
          account since the merge doesn't get un-merged, since there's no
          way to tell which side it belongs to after the fact. */}
            <ConfirmModal
                confirmText={isUndoing ? "Undoing..." : "Undo Merge"}
                description={`This recreates ${mergeInfo?.donorUsername || "the absorbed account"} as its own account again and splits its original watch history back out. Any new watching recorded on this account since the merge stays here — there's no way to tell which side it belongs to after the fact.`}
                isLoading={isUndoing}
                isOpen={isUndoModalOpen}
                onClose={() => setIsUndoModalOpen(false)}
                onConfirm={handleUndoMerge}
                title="Undo Merge"
                variant="danger"
            />

            {/* Manual merge picker - any other user, not just an auto-detected
          same-email match. Filtered to the opposite provider client-side
          (merge is always cross-provider); the real validation (not already
          absorbed, not already someone else's absorbed secondary) happens
          server-side in getMergePreview and surfaces as a toast if violated. */}
            <Modal
                description="Pick the other account to absorb into this one."
                isOpen={isMergePickerOpen}
                onClose={() => setIsMergePickerOpen(false)}
                size="md"
                title="Merge with another user"
            >
                <div className="space-y-3">
                    <div className="relative">
                        <MagnifyingGlassIcon className="absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-subtle" />
                        <input
                            autoFocus
                            className="w-full rounded-xl py-2.5 pr-4 pl-9 focus:outline-none"
                            onChange={(e) => setMergePickerSearch(e.target.value)}
                            placeholder="Search users..."
                            style={{
                                background: "var(--color-surface-hover)",
                                border: "1px solid var(--color-surface-border)",
                                color: "var(--color-text)",
                            }}
                            value={mergePickerSearch}
                        />
                    </div>
                    <div className="max-h-80 space-y-1 overflow-y-auto">
                        {mergePickerUsers === null ? (
                            <p className="py-4 text-center text-muted text-sm">Loading users...</p>
                        ) : (
                            (() => {
                                const query = mergePickerSearch.trim().toLowerCase();
                                const candidates = mergePickerUsers.filter((u) => {
                                    if (u.id === params.id) {
                                        return false;
                                    }
                                    if (
                                        (u.providerType || "stremio") ===
                                        (user?.providerType || "stremio")
                                    ) {
                                        return false;
                                    }
                                    if (!query) {
                                        return true;
                                    }
                                    return (
                                        (u.username || "").toLowerCase().includes(query) ||
                                        (u.email || "").toLowerCase().includes(query)
                                    );
                                });
                                if (candidates.length === 0) {
                                    return (
                                        <p className="py-4 text-center text-muted text-sm">
                                            No matching users on another app found.
                                        </p>
                                    );
                                }
                                return candidates.map((u) => (
                                    <button
                                        className="flex w-full items-center gap-3 rounded-xl p-2.5 text-left transition-colors hover:bg-surface-hover"
                                        key={u.id}
                                        onClick={() => handlePickMergeCandidate(u)}
                                        type="button"
                                    >
                                        <UserAvatar
                                            colorIndex={u.colorIndex ?? undefined}
                                            email={u.email}
                                            name={u.username || u.name}
                                            size="sm"
                                            src={u.avatarUrl ?? undefined}
                                            useGravatar={u.useGravatar}
                                            userId={u.id}
                                        />
                                        <div className="min-w-0 flex-1">
                                            <div className="flex items-center gap-2">
                                                <span className="truncate font-medium text-default">
                                                    {u.username || u.name}
                                                </span>
                                                <Badge size="sm" variant={providerBadgeVariant(u)}>
                                                    {providerLabel(u)}
                                                </Badge>
                                            </div>
                                            {u.email && (
                                                <p className="truncate text-muted text-xs">
                                                    {displayEmail(u.email)}
                                                </p>
                                            )}
                                        </div>
                                    </button>
                                ));
                            })()
                        )}
                    </div>
                </div>
            </Modal>

            {/* Merge confirmation - shows real counts before committing, and flags
          if the two accounts are in different Groups (merge deliberately
          doesn't auto-combine group membership - see userMerge.js). */}
            {/* Cinemeta patch. Three removals, each independent, plus putting the
          original back exactly as it was. */}
            <Modal
                isOpen={cinemetaOpen}
                onClose={() => setCinemetaOpen(false)}
                size="sm"
                title="Patch Cinemeta"
            >
                <div className="space-y-4">
                    <p className="text-muted text-xs">
                        Cinemeta is the default metadata addon every account ships with. Remove the
                        parts of it you don&apos;t want without uninstalling it - its catalogs sit
                        at the top of the home screen, and its metadata overrides addons installed
                        to replace it.
                    </p>

                    {user?.providerType === "nuvio" && (
                        <div
                            className="rounded-lg p-3 text-xs"
                            style={{
                                background: "var(--color-warning-muted)",
                                color: "var(--color-text)",
                            }}
                        >
                            <strong>
                                Nuvio stores only the addon&apos;s address, not its manifest
                            </strong>{" "}
                            - the app fetches Cinemeta&apos;s own manifest directly, so a patch
                            written here will not change what the device shows. To get
                            Cinemeta&apos;s catalogs off a Nuvio home screen, hide those rows in the
                            home-row editor instead. This works today on Stremio accounts.
                        </div>
                    )}

                    {[
                        {
                            hint: "Stops Cinemeta results appearing when you search.",
                            key: "removeSearch" as const,
                            label: "Remove Cinemeta search",
                        },
                        {
                            hint: "Removes Popular, New and Featured from the home screen.",
                            key: "removeCatalogs" as const,
                            label: "Remove Cinemeta catalogs",
                        },
                        {
                            hint: "Stops Cinemeta providing metadata for films and series.",
                            key: "removeMeta" as const,
                            label: "Remove Cinemeta metadata",
                        },
                    ].map((row) => (
                        <div
                            className="flex items-start justify-between gap-3 rounded-lg bg-surface-hover p-3"
                            key={row.key}
                        >
                            <div className="min-w-0">
                                <p className="font-medium text-default text-sm">{row.label}</p>
                                <p className="text-muted text-xs">{row.hint}</p>
                            </div>
                            <ToggleSwitch
                                checked={cinemetaDraft[row.key]}
                                onChange={() =>
                                    setCinemetaDraft((prev) => ({
                                        ...prev,
                                        [row.key]: !prev[row.key],
                                    }))
                                }
                                title={row.label}
                            />
                        </div>
                    ))}

                    <div className="flex items-center justify-between gap-2 pt-1">
                        <Button
                            disabled={cinemetaBusy || !cinemetaState?.canReset}
                            onClick={handleResetCinemeta}
                            size="sm"
                            title={
                                cinemetaState?.canReset
                                    ? "Put back the manifest exactly as it was before the first patch"
                                    : "Nothing to restore - Cinemeta has not been patched from here"
                            }
                            variant="ghost"
                        >
                            Restore original
                        </Button>
                        <div className="flex gap-2">
                            <Button
                                onClick={() => setCinemetaOpen(false)}
                                size="sm"
                                variant="ghost"
                            >
                                Cancel
                            </Button>
                            <Button
                                isLoading={cinemetaBusy}
                                onClick={handleSaveCinemeta}
                                size="sm"
                                variant="primary"
                            >
                                Save
                            </Button>
                        </div>
                    </div>
                </div>
            </Modal>

            <Modal
                isOpen={isMergeModalOpen}
                onClose={() => setIsMergeModalOpen(false)}
                size="md"
                title="Merge Accounts"
            >
                {mergePreview && mergeCandidate && (
                    <div className="space-y-4">
                        <p className="text-default">
                            Merge <strong>{mergePreview.donor.username}</strong> (
                            {providerLabel(mergePreview.donor)}) into{" "}
                            <strong>{mergePreview.survivor.username}</strong> (
                            {providerLabel(mergePreview.survivor)})?
                        </p>
                        <div className="grid grid-cols-2 gap-3 text-sm">
                            <div className="rounded-lg bg-surface-hover p-3">
                                <p className="text-muted">Movies</p>
                                <p className="font-semibold text-default text-lg">
                                    {mergePreview.movieCount}
                                </p>
                            </div>
                            <div className="rounded-lg bg-surface-hover p-3">
                                <p className="text-muted">Episodes</p>
                                <p className="font-semibold text-default text-lg">
                                    {mergePreview.episodeCount}
                                </p>
                            </div>
                        </div>
                        <p className="text-muted text-sm">
                            {mergePreview.donor.username}&apos;s watch history moves onto this
                            account, both providers will keep syncing their own addons, and{" "}
                            {mergePreview.donor.username} will be removed as a separate entry (its
                            data is archived first).
                        </p>
                        {mergePreview.groupsDiffer && (
                            <p className="rounded-lg bg-warning-muted p-3 text-sm text-warning">
                                <strong>{mergePreview.donor.username}</strong> is in{" "}
                                {mergePreview.donorGroupName || "a different group"}, separate from{" "}
                                {mergePreview.survivor.username}&apos;s{" "}
                                {mergePreview.survivorGroupName || "group"}. After merging,{" "}
                                {mergePreview.donor.providerType} will keep following{" "}
                                {mergePreview.donorGroupName || "its current group"} unless you
                                manually move it.
                            </p>
                        )}
                        <div className="flex justify-end gap-3 pt-2">
                            <Button
                                disabled={isMerging}
                                onClick={() => setIsMergeModalOpen(false)}
                                variant="secondary"
                            >
                                Cancel
                            </Button>
                            <Button isLoading={isMerging} onClick={handleMerge} variant="primary">
                                {isMerging ? "Merging..." : "Merge Accounts"}
                            </Button>
                        </div>
                    </div>
                )}
            </Modal>

            {/* Reconnect Modal - reusing CreateUserModal */}
            <CreateUserModal
                isOpen={isReconnectModalOpen}
                mode="reconnect"
                onClose={() => setIsReconnectModalOpen(false)}
                onReconnectSuccess={() => {
                    setIsReconnectModalOpen(false);
                    window.location.reload();
                }}
                providerType={user?.providerType}
                userId={params.id as string}
                userName={user?.username || user?.name || "User"}
            />

            {/* Preview what a sync would change before it touches the real
          account - see SyncPreviewDialog. */}
            {user && (
                <SyncPreviewDialog
                    isOpen={isSyncPreviewOpen}
                    onClose={() => setIsSyncPreviewOpen(false)}
                    onConfirm={handleSync}
                    userId={user.id}
                    userName={user.username}
                />
            )}

            {/* SIMKL Link Modal */}
            <SimklLinkModal
                isOpen={isSimklModalOpen}
                onClose={() => setIsSimklModalOpen(false)}
                onLinked={() => {
                    setIsSimklModalOpen(false);
                    setUser((prev: any) =>
                        prev
                            ? {
                                  ...prev,
                                  simklConnected: true,
                                  simklConnectedAt: new Date().toISOString(),
                              }
                            : prev
                    );
                }}
                userId={params.id as string}
            />

            {/* Edit Details Modal */}
            {isEditDetailsOpen && (
                <EditUserDetailsModal
                    groups={groups}
                    isOpen={isEditDetailsOpen}
                    onClose={() => setIsEditDetailsOpen(false)}
                    onUpdateExpiresAt={handleExpiresAtChange}
                    onUpdateGroup={handleGroupChange}
                    user={user}
                />
            )}
        </>
    );
}

// SIMKL Link Modal - PIN flow. Start fetches a code + verification URL from
// Simkl, then polls at Simkl's own recommended interval until authorized or
// the code expires. No client_secret involved (PIN flow doesn't use one),
// so unlike Stremio's OAuth this needs no popup-blocking workaround - the
// verification link is just a normal tappable link the user follows
// themselves, same as the existing Nuvio/Stremio device-code cards.
function SimklLinkModal({
    isOpen,
    onClose,
    userId,
    onLinked,
}: {
    isOpen: boolean;
    onClose: () => void;
    userId: string;
    onLinked: () => void;
}) {
    const [status, setStatus] = useState<"idle" | "starting" | "waiting">("idle");
    const [userCode, setUserCode] = useState<string | null>(null);
    const [verificationUrl, setVerificationUrl] = useState<string | null>(null);
    const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
    const expiresAtRef = useRef<number>(0);

    const stopPolling = () => {
        if (pollRef.current) {
            clearInterval(pollRef.current);
            pollRef.current = null;
        }
    };

    const start = async () => {
        setStatus("starting");
        try {
            const data = await api.startSimklPin(userId);
            setUserCode(data.userCode);
            setVerificationUrl(data.verificationUrl);
            expiresAtRef.current = Date.now() + data.expiresIn * 1000;
            setStatus("waiting");

            const intervalMs = Math.max(2, data.pollIntervalSeconds || 5) * 1000;
            pollRef.current = setInterval(async () => {
                if (Date.now() > expiresAtRef.current) {
                    // Same toast-and-close treatment as the start failure above, and
                    // as the Trakt row's own expiry path - not a modal left sitting
                    // open with an error inside it.
                    stopPolling();
                    toast.error("SIMKL code expired - try linking again");
                    onClose();
                    return;
                }
                try {
                    const poll = await api.pollSimklPin(userId, data.userCode);
                    if (poll.status === "authorized") {
                        stopPolling();
                        toast.success(
                            poll.username ? `Linked SIMKL as ${poll.username}` : "SIMKL linked"
                        );
                        onLinked();
                    }
                } catch {
                    // transient poll error - keep trying until expiry
                }
            }, intervalMs);
        } catch (err) {
            // Surfaced as a toast and the modal closed, rather than a modal whose
            // entire content is an error message. Matches how the Trakt row on the
            // same card reports the identical class of problem ("this integration
            // isn't configured on this instance") - previously SIMKL opened a
            // modal containing red text while Trakt toasted, which read as two
            // unrelated error systems for the same situation.
            toast.error(readErrorMessage(err, "Failed to start SIMKL authorization"));
            onClose();
        }
    };

    useEffect(() => {
        if (isOpen) {
            start();
        } else {
            stopPolling();
            setStatus("idle");
            setUserCode(null);
            setVerificationUrl(null);
        }
        return stopPolling;
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isOpen]);

    return (
        <Modal isOpen={isOpen} onClose={onClose} title="Link SIMKL">
            <div className="space-y-4 py-2 text-center">
                {status === "starting" && (
                    <p className="text-muted text-sm">Requesting a code from SIMKL...</p>
                )}
                {status === "waiting" && userCode && (
                    <>
                        <p className="text-muted text-sm">
                            Go to{" "}
                            <a
                                className="text-primary underline"
                                href={verificationUrl || undefined}
                                rel="noreferrer"
                                target="_blank"
                            >
                                {verificationUrl}
                            </a>{" "}
                            and enter this code:
                        </p>
                        <div
                            className="rounded-xl py-3 font-bold font-mono text-3xl tracking-widest"
                            style={{ background: "var(--color-surface-hover)" }}
                        >
                            {userCode}
                        </div>
                        <p className="text-muted text-xs">
                            Waiting for you to authorize on SIMKL...
                        </p>
                    </>
                )}
            </div>
        </Modal>
    );
}

// Edit User Details Modal
function EditUserDetailsModal({
    isOpen,
    onClose,
    user,
    groups,
    onUpdateGroup,
    onUpdateExpiresAt,
}: {
    isOpen: boolean;
    onClose: () => void;
    user: any;
    groups: any[];
    onUpdateGroup: (groupId: string) => Promise<void>;
    onUpdateExpiresAt: (date: string) => Promise<void>;
}) {
    const groupLabelId1 = useId();
    const [groupId, setGroupId] = useState(user.groupIds?.[0] || user.groupId || "");
    const [expiresAt, setExpiresAt] = useState(
        user.expiresAt ? format(new Date(user.expiresAt), "yyyy-MM-dd'T'HH:mm") : ""
    );
    const [isLoading, setIsLoading] = useState(false);

    // Update local state when user prop changes
    useEffect(() => {
        setGroupId(user.groupIds?.[0] || user.groupId || "");
        setExpiresAt(user.expiresAt ? format(new Date(user.expiresAt), "yyyy-MM-dd'T'HH:mm") : "");
    }, [user]);

    const handleSave = async () => {
        setIsLoading(true);
        try {
            // Update group if changed
            const currentGroupId = user.groupIds?.[0] || user.groupId || "";
            if (groupId !== currentGroupId) {
                await onUpdateGroup(groupId);
            }

            // Update expiration if changed
            const currentExpires = user.expiresAt
                ? format(new Date(user.expiresAt), "yyyy-MM-dd'T'HH:mm")
                : "";
            if (expiresAt !== currentExpires) {
                await onUpdateExpiresAt(expiresAt);
            }

            onClose();
        } catch (error) {
            console.error("Failed to update details:", error);
        } finally {
            setIsLoading(false);
        }
    };

    return (
        <Modal
            description="Update membership and group assignment"
            isOpen={isOpen}
            onClose={onClose}
            size="md"
            title="Edit User Details"
        >
            <div className="space-y-6">
                {/* Group Selector */}
                <fieldset
                    aria-labelledby={`${groupLabelId1}-1`}
                    className="mx-0 min-w-0 border-0 p-0"
                >
                    <p
                        className="mb-2 block font-medium text-default text-sm"
                        id={`${groupLabelId1}-1`}
                    >
                        Group Assignment
                    </p>
                    <Select
                        onChange={setGroupId}
                        options={[
                            { label: "No group", value: "" },
                            ...groups.map((g) => ({ label: g.name, value: g.id })),
                        ]}
                        value={groupId}
                    />
                    <p className="mt-2 text-muted text-xs">
                        Assigning a group will automatically sync the group's addons to this user.
                    </p>
                </fieldset>

                {/* ExpiresAt */}
                <fieldset
                    aria-labelledby={`${groupLabelId1}-2`}
                    className="mx-0 min-w-0 border-0 p-0"
                >
                    <p
                        className="mb-2 block font-medium text-default text-sm"
                        id={`${groupLabelId1}-2`}
                    >
                        Membership Expiration
                    </p>
                    <DateTimePicker
                        min={new Date()}
                        onChange={setExpiresAt}
                        placeholder="Lifetime (Never expires)"
                        value={expiresAt}
                    />
                    <p className="mt-2 text-muted text-xs">
                        Leave empty for lifetime membership. User will lose access after this date.
                    </p>
                </fieldset>

                <div className="flex justify-end gap-3 border-default border-t pt-4">
                    <Button disabled={isLoading} onClick={onClose} variant="secondary">
                        Cancel
                    </Button>
                    <Button isLoading={isLoading} onClick={handleSave} variant="primary">
                        Save Changes
                    </Button>
                </div>
            </div>
        </Modal>
    );
}
