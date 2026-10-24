"use client";

import {
    ArrowPathIcon,
    ArrowsRightLeftIcon,
    ArrowTrendingDownIcon,
    ArrowTrendingUpIcon,
    CalendarIcon,
    ChartBarIcon,
    CheckCircleIcon,
    ChevronDownIcon,
    CircleStackIcon,
    ClockIcon,
    ExclamationTriangleIcon,
    EyeIcon,
    EyeSlashIcon,
    FilmIcon,
    FireIcon,
    HeartIcon,
    PlayIcon,
    PuzzlePieceIcon,
    ServerIcon,
    ShieldCheckIcon,
    SignalIcon,
    SparklesIcon,
    TagIcon,
    TrophyIcon,
    TvIcon,
    UsersIcon,
} from "@heroicons/react/24/outline";
import { Fragment, memo, useCallback, useEffect, useMemo, useState } from "react";
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
import {
    AddonPerformanceCard,
    AtRiskUsersTable,
    BingeWatchesSection,
    HourlyHeatmap,
    ServerHealthDashboard,
    TopItemsSection,
    UserLifecycleCard,
} from "@/components/admin";
import { DbStorageCard } from "@/components/admin/DbStorageCard";
import { Header } from "@/components/layout/Header";
import { NebulaPageHeading } from "@/components/layout/NebulaTopbar";
import { PageSection } from "@/components/layout/PageContainer";
import { TVPageProvider } from "@/components/tv/TVPageProvider";
import { Badge, Button, Card, PageToolbar, UserAvatar, YearInReviewCard } from "@/components/ui";
import { MetricStrip } from "@/components/ui/MetricStrip";
import { ScrollRow } from "@/components/ui/ScrollRow";
import {
    type AtRiskUser,
    api,
    type HealthStatus,
    type MetricsData,
    type TasteOverlapPair,
    type TasteProfile,
} from "@/lib/api";
import { useIsTV } from "@/lib/hooks/useIsTV";
import { useLastKnown } from "@/lib/hooks/useLastKnown";
import { useLayoutMode } from "@/lib/layout-mode";

// Period options for filtering
const PERIOD_OPTIONS = [
    { label: "All Time", value: "all" },
    { label: "1 Hour", value: "1h" },
    { label: "24 Hours", value: "24h" },
    { label: "7 Days", value: "7d" },
    { label: "30 Days", value: "30d" },
    { label: "90 Days", value: "90d" },
    { label: "1 Year", value: "1y" },
];

// Helper function to format minutes
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

// Hoisted tooltip style - uses CSS variable compatible colors
const TOOLTIP_STYLE = {
    backdropFilter: "blur(12px)",
    backgroundColor: "rgba(20, 20, 35, 0.95)",
    border: "1px solid rgba(255,255,255,0.1)",
    borderRadius: "12px",
} as const;

const TOOLTIP_LABEL_STYLE = { color: "#fff" } as const;

// Memoized chart component
const WatchTimeChart = memo(function WatchTimeChartLocal({
    data,
}: {
    data: Array<{ date: string; hours: number }>;
}) {
    // Calculate max hours to determine ticks dynamically or use a fixed set if small
    const maxHours = Math.max(...data.map((d) => d.hours), 1);
    const tickCount = Math.ceil(maxHours / 0.5);
    const ticks = Array.from({ length: tickCount + 1 }, (_, i) => i * 0.5);

    return (
        <ResponsiveContainer height="100%" width="100%">
            <AreaChart data={data}>
                <defs>
                    <linearGradient id="colorWatchTime" x1="0" x2="0" y1="0" y2="1">
                        <stop offset="5%" stopColor="var(--color-chart-1)" stopOpacity={0.4} />
                        <stop offset="95%" stopColor="var(--color-chart-1)" stopOpacity={0} />
                    </linearGradient>
                </defs>
                <CartesianGrid stroke="rgba(255,255,255,0.1)" strokeDasharray="3 3" />
                <XAxis
                    dataKey="date"
                    fontSize={12}
                    stroke="#64748b"
                    tickFormatter={(value) => {
                        const date = new Date(value);
                        return date.toLocaleDateString("en-US", {
                            day: "numeric",
                            month: "short",
                            timeZone: "UTC",
                        });
                    }}
                />
                <YAxis
                    fontSize={12}
                    stroke="#64748b"
                    tickFormatter={(value) => {
                        if (value === 0) {
                            return "0m";
                        }
                        const h = Math.floor(value);
                        const m = Math.round((value - h) * 60);
                        if (h === 0) {
                            return `${m}m`;
                        }
                        return m === 0 ? `${h}h` : `${h}h${m}m`;
                    }}
                    ticks={ticks}
                />
                <Tooltip
                    contentStyle={TOOLTIP_STYLE}
                    formatter={(value: any) => [formatMinutes(Math.round(value * 60)), "Time"]}
                    labelFormatter={(value: any) => {
                        const date = new Date(value);
                        return date.toLocaleDateString("en-US", {
                            day: "numeric",
                            month: "short",
                            timeZone: "UTC",
                            year: "numeric",
                        });
                    }}
                    labelStyle={TOOLTIP_LABEL_STYLE}
                />
                <Area
                    dataKey="hours"
                    fill="url(#colorWatchTime)"
                    fillOpacity={1}
                    isAnimationActive={false} // Disable animation to prevent blinking during updates
                    stroke="var(--color-chart-1)"
                    strokeWidth={2}
                    type="monotone"
                />
            </AreaChart>
        </ResponsiveContainer>
    );
});

const ContentBreakdownChart = memo(function ContentBreakdownChartLocal({
    data,
}: {
    data: Array<{ date: string; movies: number; series: number }>;
}) {
    return (
        <ResponsiveContainer height="100%" width="100%">
            <BarChart data={data}>
                <CartesianGrid stroke="rgba(255,255,255,0.1)" strokeDasharray="3 3" />
                <XAxis
                    dataKey="date"
                    fontSize={12}
                    stroke="#64748b"
                    tickFormatter={(value) => {
                        const date = new Date(value);
                        return date.toLocaleDateString("en-US", {
                            day: "numeric",
                            month: "short",
                            timeZone: "UTC",
                        });
                    }}
                />
                <YAxis fontSize={12} stroke="#64748b" />
                <Tooltip
                    contentStyle={TOOLTIP_STYLE}
                    labelFormatter={(value: any) => {
                        const date = new Date(value);
                        return date.toLocaleDateString("en-US", {
                            day: "numeric",
                            month: "short",
                            timeZone: "UTC",
                            year: "numeric",
                        });
                    }}
                    labelStyle={TOOLTIP_LABEL_STYLE}
                />
                <Bar
                    dataKey="movies"
                    fill="var(--color-chart-1)"
                    name="Movies"
                    radius={[4, 4, 0, 0]}
                />
                <Bar
                    dataKey="series"
                    fill="var(--color-chart-2)"
                    name="Series"
                    radius={[4, 4, 0, 0]}
                />
            </BarChart>
        </ResponsiveContainer>
    );
});

// Health tab: "is everything actually working right now." Every number
// here reads state an existing background monitor already maintains (Sync
// Guardian, addon health checker, vault monitor, the AIOStreams proxy
// poller) - this computes nothing live, it just unifies signals that were
// previously scattered across four different admin pages. Ported from the
// standalone Health page, now a tab here since it's monitoring-only with no
// real actions, same as this page's other tabs.
function healthTimeAgo(iso: string | null): string {
    if (!iso) {
        return "never";
    }
    const ms = Date.now() - new Date(iso).getTime();
    const min = Math.round(ms / 60_000);
    if (min < 1) {
        return "just now";
    }
    if (min < 60) {
        return `${min}m ago`;
    }
    const hr = Math.round(min / 60);
    if (hr < 24) {
        return `${hr}h ago`;
    }
    return `${Math.round(hr / 24)}d ago`;
}

function HealthStatusPill({ ok }: { ok: boolean | null }) {
    if (ok === null) {
        return (
            <Badge size="sm" variant="default">
                Unknown
            </Badge>
        );
    }
    return ok ? (
        <Badge size="sm" variant="success">
            Healthy
        </Badge>
    ) : (
        <Badge size="sm" variant="warning">
            Attention
        </Badge>
    );
}

function HealthCheckCard({
    icon,
    title,
    ok,
    summary,
    children,
}: {
    icon: React.ReactNode;
    title: string;
    ok: boolean | null;
    summary: string;
    children?: React.ReactNode;
}) {
    return (
        <Card padding="lg">
            <div className="mb-3 flex items-start justify-between">
                <div className="flex items-center gap-2.5">
                    <div
                        className={`flex h-9 w-9 items-center justify-center rounded-lg ${ok === false ? "bg-warning/15 text-warning" : "bg-primary/10 text-primary"}`}
                    >
                        {icon}
                    </div>
                    <div>
                        <h3 className="font-semibold text-default text-sm">{title}</h3>
                        <p className="text-muted text-xs">{summary}</p>
                    </div>
                </div>
                <HealthStatusPill ok={ok} />
            </div>
            {children}
        </Card>
    );
}

function HealthIssueRow({
    title,
    detail,
    meta,
    onIgnore,
}: {
    title: string;
    detail?: string | null;
    meta?: string;
    /** Present only when this row can be dismissed as a known, accepted
     *  failure (e.g. an indexer that blocks this server's IP) - hides it from
     *  this list and from notifications, without needing it to actually
     *  resolve first. Reversible any time from the card's "Ignored" list. */
    onIgnore?: () => void;
}) {
    return (
        <div className="border-default border-t py-2 first:border-t-0 first:pt-0">
            <div className="flex items-center justify-between gap-2">
                <p className="truncate text-default text-sm">{title}</p>
                <div className="flex flex-shrink-0 items-center gap-2">
                    {meta && <span className="text-subtle text-xs">{meta}</span>}
                    {onIgnore && (
                        <button
                            className="rounded p-1 text-subtle transition-colors hover:bg-surface-hover hover:text-default"
                            onClick={onIgnore}
                            title="Ignore - hide this from Health and its notifications"
                            type="button"
                        >
                            <EyeSlashIcon className="h-3.5 w-3.5" />
                        </button>
                    )}
                </div>
            </div>
            {detail && <p className="mt-0.5 truncate text-warning text-xs">{detail}</p>}
        </div>
    );
}

function HealthIgnoredList({
    items,
    onUnignore,
}: {
    items: Array<{ id: string; name: string }>;
    onUnignore: (id: string) => void;
}) {
    const [open, setOpen] = useState(false);
    if (items.length === 0) {
        return null;
    }
    return (
        <div className="mt-2 border-default border-t pt-2">
            <button
                className="flex items-center gap-1 text-subtle text-xs transition-colors hover:text-default"
                onClick={() => setOpen((v) => !v)}
                type="button"
            >
                <ChevronDownIcon
                    className={`h-3 w-3 transition-transform ${open ? "rotate-180" : ""}`}
                />
                {items.length} ignored
            </button>
            {open && (
                <div className="mt-1.5 space-y-1">
                    {items.map((item) => (
                        <div className="flex items-center justify-between gap-2" key={item.id}>
                            <p className="truncate text-subtle text-xs">{item.name}</p>
                            <button
                                className="flex-shrink-0 rounded p-1 text-subtle transition-colors hover:bg-surface-hover hover:text-default"
                                onClick={() => onUnignore(item.id)}
                                title="Un-ignore"
                                type="button"
                            >
                                <EyeIcon className="h-3.5 w-3.5" />
                            </button>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}

export default function MetricsPage() {
    const { layoutMode } = useLayoutMode();
    const isTV = useIsTV();
    const Wrapper = isTV ? TVPageProvider : Fragment;
    const [period, setPeriod] = useState("30d");
    // The yearly recap opens on request. It is a once-a-year read, and it
    // used to occupy the top of a page opened weekly.
    const [yearInReviewOpen, setYearInReviewOpen] = useState(false);
    const [viewMode, setViewMode] = useState<"users" | "content" | "admin" | "health">("users");
    // Deep-link support (?tab=health) so a notification tap can land directly
    // on this tab instead of always the default - read once on mount via
    // window.location rather than useSearchParams(), which needs a Suspense
    // boundary this page doesn't otherwise have any reason to add.
    useEffect(() => {
        const tab = new URLSearchParams(window.location.search).get("tab");
        if (tab === "users" || tab === "content" || tab === "admin" || tab === "health") {
            setViewMode(tab);
        }
    }, []);
    const [metricsData, setMetricsData] = useState<MetricsData | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<Error | null>(null);
    const [_selectedUser, setSelectedUser] = useState<AtRiskUser | null>(null);
    const [tasteOverlap, setTasteOverlap] = useState<TasteOverlapPair[]>([]);
    const [tasteProfiles, setTasteProfiles] = useState<TasteProfile[]>([]);
    const [healthData, setHealthData] = useState<HealthStatus | null>(null);
    const [healthLoading, setHealthLoading] = useState(true);

    // Instant navigation: the last-known metrics for the period this page
    // opens on, and the last health report, shown at once while the fetches
    // below refresh them - see useLastKnown's comment.
    useLastKnown<MetricsData>(`/users/metrics?period=${period}`, (cached) => {
        setMetricsData(cached);
        setIsLoading(false);
    });
    useLastKnown<HealthStatus>("/health", (cached) => {
        setHealthData(cached);
        setHealthLoading(false);
    });
    const [healthRefreshing, setHealthRefreshing] = useState(false);

    const loadHealth = useCallback((silent = false) => {
        if (silent) {
            setHealthRefreshing(true);
        } else {
            setHealthLoading(true);
        }
        api.getHealthStatus()
            .then(setHealthData)
            .catch(() => setHealthData(null))
            .finally(() => {
                setHealthLoading(false);
                setHealthRefreshing(false);
            });
    }, []);
    useEffect(() => {
        loadHealth();
    }, [loadHealth]);

    const toggleVaultIgnored = useCallback(
        (id: string, healthIgnored: boolean) => {
            api.setVaultHealthIgnored(id, healthIgnored)
                .then(() => loadHealth(true))
                .catch(() => undefined);
        },
        [loadHealth]
    );
    const toggleAddonIgnored = useCallback(
        (id: string, healthIgnored: boolean) => {
            api.setAddonHealthIgnored(id, healthIgnored)
                .then(() => loadHealth(true))
                .catch(() => undefined);
        },
        [loadHealth]
    );
    const toggleSyncIgnored = useCallback(
        (userId: string, healthIgnored: boolean) => {
            api.setUserHealthIgnored(userId, healthIgnored)
                .then(() => loadHealth(true))
                .catch(() => undefined);
        },
        [loadHealth]
    );
    const toggleProxyIgnored = useCallback(
        (healthIgnored: boolean) => {
            api.setProxyHealthIgnored(healthIgnored)
                .then(() => loadHealth(true))
                .catch(() => undefined);
        },
        [loadHealth]
    );

    // Fetch metrics data
    useEffect(() => {
        setIsLoading(true);
        setError(null);
        api.getMetrics(period)
            .then((data) => {
                setMetricsData(data);
                setIsLoading(false);
            })
            .catch((err) => {
                setError(err);
                setIsLoading(false);
            });
    }, [period]);

    // Taste overlap is all-time real watch-time comparison, not windowed by
    // the period filter above - fetched once, independently.
    useEffect(() => {
        api.getTasteOverlap()
            .then((data) => setTasteOverlap(data.pairs || []))
            .catch(() => setTasteOverlap([]));
        api.getTasteProfile()
            .then((data) => setTasteProfiles(data.profiles || []))
            .catch(() => setTasteProfiles([]));
    }, []);

    // Same fix as Dashboard/Activity's "Active Users" stat:
    // metricsData.summary.activeUsers counts anyone with watch activity
    // anywhere in the selected period, not who's watching right now - per
    // explicit request, this stat should read the same live count Dashboard
    // and Activity show (0 when nobody's actually streaming), not a
    // period-wide "was active at some point" count. Derived from the same
    // live nowPlaying feed, deduped by user id.
    const liveActiveUsersCount = metricsData?.nowPlaying
        ? new Set(metricsData.nowPlaying.map((np) => np.user.id)).size
        : 0;

    // Transform watch time data for chart
    const watchTimeChartData = useMemo(() => {
        if (!metricsData?.watchTime?.byDay) {
            return [];
        }
        return metricsData.watchTime.byDay.map((item) => ({
            date: item.date,
            hours: item.hours,
        }));
    }, [metricsData]);

    // Transform content breakdown data for chart - calculated from watchSessions for accuracy
    const contentBreakdownData = useMemo(() => {
        if (!metricsData?.watchActivity?.byDay || metricsData.watchActivity.byDay.length === 0) {
            return [];
        }

        // Use watchSessions to get actual counts (movies watched and episodes watched)
        // instead of unique series count from the API
        return metricsData.watchActivity.byDay.map((item) => {
            const dateStr = item.date;

            // If we have watchSessions, calculate actual counts from them
            if (metricsData.watchSessions && metricsData.watchSessions.length > 0) {
                const sessionsForDate = metricsData.watchSessions.filter((session) => {
                    const sessionDate = new Date(session.startTime).toLocaleDateString("sv-SE");
                    return sessionDate === dateStr;
                });

                const movieCount = sessionsForDate.filter((s) => s.item.type === "movie").length;
                const seriesCount = sessionsForDate.filter((s) => s.item.type === "series").length;

                return {
                    date: dateStr,
                    movies: movieCount,
                    series: seriesCount,
                };
            }

            // Fallback to API data if no sessions available
            return {
                date: dateStr,
                movies: item.movies || 0,
                series: item.shows || 0,
            };
        });
    }, [metricsData]);

    // Transform top users data
    const topUsersData = useMemo(() => {
        if (!metricsData?.watchActivity?.byUser) {
            return [];
        }
        return metricsData.watchActivity.byUser
            .sort((a, b) => (b.watchTimeHours || 0) - (a.watchTimeHours || 0))
            .slice(0, 5)
            .map((user) => ({
                avatarUrl: user.avatarUrl,
                email: user.email,
                id: user.id,
                movies: user.movies,
                name: user.username,
                series: user.shows,
                streak: user.streak || 0,
                trend: "up" as const, // Trend calculation would need historical data
                useGravatar: user.useGravatar,
                watchTime: Math.round(user.watchTimeHours * 60), // Convert to minutes
            }));
    }, [metricsData]);

    const periodSelect = (
        <select
            aria-label="Select time period"
            className="rounded-xl border border-default bg-surface px-4 py-2 text-default text-sm"
            onChange={(e) => setPeriod(e.target.value)}
            value={period}
        >
            {PERIOD_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                    {option.label}
                </option>
            ))}
        </select>
    );

    return (
        <Wrapper>
            {layoutMode !== "nebula" && (
                <Header
                    actions={<div className="flex items-center gap-3">{periodSelect}</div>}
                    subtitle="A clearer picture of your household’s viewing."
                    title="Metrics"
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
                            actions={periodSelect}
                            subtitle="A clearer picture of your household’s viewing."
                            title="Metrics"
                        />
                    )}
                    {/* View Mode Toggle - Centered */}
                    <PageSection className="mb-6">
                        <PageToolbar
                            animate={false}
                            className="metrics-view-navigation"
                            filterTabs={{
                                activeKey: viewMode,
                                layoutId: "metrics-view-tabs",
                                onChange: (key) =>
                                    setViewMode(key as "users" | "content" | "admin" | "health"),
                                options: [
                                    {
                                        icon: <UsersIcon className="h-4 w-4" />,
                                        key: "users",
                                        label: "Users",
                                    },
                                    {
                                        icon: <PlayIcon className="h-4 w-4" />,
                                        key: "content",
                                        label: "Content",
                                    },
                                    {
                                        icon: <ServerIcon className="h-4 w-4" />,
                                        key: "admin",
                                        label: "Admin",
                                    },
                                    {
                                        icon: <HeartIcon className="h-4 w-4" />,
                                        key: "health",
                                        label: "Health",
                                    },
                                ],
                            }}
                        />
                    </PageSection>

                    {/* Users tab.
            Rebuilt around what the page is actually for: how much the
            household watched, and who. It used to open with a full-height
            Year in Review - a once-a-year artefact at the top of a page
            people open weekly - then four cards holding one number each,
            then a leaderboard and a streaks panel side by side, each
            half-empty with a single member in it. At real household size
            (one to five people) that is mostly whitespace, and no amount of
            styling fixes a layout whose shape assumes data it will never
            have. So: one hero that carries the headline number AND the
            chart, one dense members block that merges the leaderboard with
            streaks, and the recap demoted to a line you can open. */}
                    {viewMode === "users" && (
                        <div className="space-y-6">
                            {/* Hero: the period's total, its trend, and the shape of it. */}
                            <PageSection className="mb-6">
                                <Card className="metrics-overview-hero" padding="lg">
                                    <div className="mb-5 flex flex-wrap items-end justify-between gap-4">
                                        <div className="min-w-0">
                                            <p className="mb-1 text-muted text-xs uppercase tracking-wider">
                                                Watch time · last{" "}
                                                {period === "7d"
                                                    ? "7 days"
                                                    : period === "30d"
                                                      ? "30 days"
                                                      : period === "90d"
                                                        ? "90 days"
                                                        : "all time"}
                                            </p>
                                            <div className="flex flex-wrap items-end gap-3">
                                                <p className="metrics-watch-time interface-stat-value font-semibold text-default leading-none">
                                                    {isLoading
                                                        ? "…"
                                                        : formatMinutes(
                                                              Math.round(
                                                                  watchTimeChartData.reduce(
                                                                      (sum, d) =>
                                                                          sum + (d.hours || 0),
                                                                      0
                                                                  ) * 60
                                                              )
                                                          )}
                                                </p>
                                                {metricsData?.watchTime?.trend &&
                                                    metricsData.watchTime.trend.percentage > 0 && (
                                                        <Badge variant="primary">
                                                            {metricsData.watchTime.trend
                                                                .direction === "up" ? (
                                                                <ArrowTrendingUpIcon className="mr-1 h-4 w-4" />
                                                            ) : (
                                                                <ArrowTrendingDownIcon className="mr-1 h-4 w-4" />
                                                            )}
                                                            {metricsData.watchTime.trend
                                                                .direction === "up"
                                                                ? "+"
                                                                : "-"}
                                                            {metricsData.watchTime.trend.percentage}
                                                            %
                                                        </Badge>
                                                    )}
                                            </div>
                                        </div>

                                        {/* The old four stat cards, as one strip. Same numbers,
                      a quarter of the vertical space, and they read as a
                      sentence about the household rather than four
                      unrelated tiles. */}
                                        <div className="flex items-center gap-5 text-sm">
                                            {[
                                                {
                                                    label: "Watching",
                                                    value: isLoading
                                                        ? "…"
                                                        : String(liveActiveUsersCount),
                                                },
                                                {
                                                    label: "Avg each",
                                                    value: isLoading
                                                        ? "…"
                                                        : formatMinutes(
                                                              Math.round(
                                                                  metricsData?.admin
                                                                      ?.interestingMetrics
                                                                      ?.avgWatchTimePerUser || 0
                                                              )
                                                          ),
                                                },
                                                {
                                                    label: "Best streak",
                                                    value: isLoading
                                                        ? "…"
                                                        : `${topUsersData.reduce((max, u) => Math.max(max, u.streak), 0)}d`,
                                                },
                                            ].map((stat) => (
                                                <div className="text-right" key={stat.label}>
                                                    <p className="whitespace-nowrap text-muted text-xs">
                                                        {stat.label}
                                                    </p>
                                                    <p className="font-semibold text-default text-lg leading-tight">
                                                        {stat.value}
                                                    </p>
                                                </div>
                                            ))}
                                        </div>
                                    </div>

                                    <div className="h-40 md:h-56">
                                        {isLoading ? (
                                            <div className="flex h-full items-center justify-center">
                                                <div className="flex items-center gap-2 text-muted text-sm">
                                                    <div className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
                                                    <span>Loading…</span>
                                                </div>
                                            </div>
                                        ) : watchTimeChartData.length === 0 ? (
                                            <div className="flex h-full items-center justify-center text-muted text-sm">
                                                Nothing watched in this period yet
                                            </div>
                                        ) : (
                                            <WatchTimeChart data={watchTimeChartData} />
                                        )}
                                    </div>
                                </Card>
                            </PageSection>

                            {/* Members: the leaderboard and the streaks panel, merged. Both
                were per-member lists of the same people; two cards to say
                that was the whole problem. */}
                            <PageSection delay={0.15}>
                                <Card padding="lg">
                                    <div className="mb-4 flex items-center justify-between">
                                        <h3 className="font-display font-semibold text-default text-lg">
                                            Members
                                        </h3>
                                        <span className="text-muted text-xs">
                                            {topUsersData.length}{" "}
                                            {topUsersData.length === 1 ? "member" : "members"}
                                        </span>
                                    </div>

                                    {isLoading ? (
                                        <p className="py-6 text-center text-muted text-sm">
                                            Loading…
                                        </p>
                                    ) : topUsersData.length === 0 ? (
                                        <p className="py-6 text-center text-muted text-sm">
                                            No watch activity in this period.
                                        </p>
                                    ) : (
                                        <div className="space-y-1.5">
                                            {topUsersData.map((user, index) => (
                                                <div
                                                    className="flex items-center gap-3 rounded-xl bg-surface-hover px-3 py-2.5"
                                                    key={user.id}
                                                >
                                                    {/* Rank only carries meaning with more than one
                            person in the list. */}
                                                    {topUsersData.length > 1 && (
                                                        <span
                                                            className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-md font-bold text-xs ${index === 0 ? "rank-top-muted" : "rank-rest-muted"}`}
                                                        >
                                                            {index + 1}
                                                        </span>
                                                    )}
                                                    <UserAvatar
                                                        className="shrink-0"
                                                        email={user.email}
                                                        name={user.name}
                                                        size="sm"
                                                        src={
                                                            user.useGravatar
                                                                ? undefined
                                                                : (user.avatarUrl ?? undefined)
                                                        }
                                                        useGravatar={user.useGravatar}
                                                        userId={user.id}
                                                    />
                                                    <div className="min-w-0 flex-1">
                                                        <p className="truncate font-medium text-default leading-tight">
                                                            {user.name}
                                                        </p>
                                                        <div className="mt-0.5 flex items-center gap-3 text-muted text-xs">
                                                            <span className="flex items-center gap-1">
                                                                <FilmIcon className="h-3.5 w-3.5" />
                                                                {user.movies}
                                                            </span>
                                                            <span className="flex items-center gap-1">
                                                                <TvIcon className="h-3.5 w-3.5" />
                                                                {user.series}
                                                            </span>
                                                            <span className="flex items-center gap-1">
                                                                <FireIcon className="h-3.5 w-3.5" />
                                                                {user.streak}d
                                                            </span>
                                                            <span className="flex items-center gap-1">
                                                                {user.trend === "up" ? (
                                                                    <ArrowTrendingUpIcon className="h-3.5 w-3.5 text-primary" />
                                                                ) : (
                                                                    <ArrowTrendingDownIcon className="h-3.5 w-3.5" />
                                                                )}
                                                                {user.trend === "up"
                                                                    ? "rising"
                                                                    : "falling"}
                                                            </span>
                                                        </div>
                                                    </div>
                                                    <p className="shrink-0 font-bold text-base text-default">
                                                        {formatMinutes(user.watchTime)}
                                                    </p>
                                                </div>
                                            ))}
                                        </div>
                                    )}
                                </Card>
                            </PageSection>

                            {/* The recap, out of the way until it is wanted. */}
                            <PageSection delay={0.2}>
                                {yearInReviewOpen ? (
                                    <div>
                                        <button
                                            className="mb-2 text-muted text-xs transition-colors hover:text-default"
                                            onClick={() => setYearInReviewOpen(false)}
                                            type="button"
                                        >
                                            ← Hide year in review
                                        </button>
                                        <YearInReviewCard />
                                    </div>
                                ) : (
                                    <button
                                        className="flex w-full items-center justify-between gap-3 rounded-xl bg-surface-hover px-4 py-3 text-left transition-colors hover:bg-surface"
                                        onClick={() => setYearInReviewOpen(true)}
                                        type="button"
                                    >
                                        <span className="flex min-w-0 items-center gap-2">
                                            <SparklesIcon className="h-4 w-4 shrink-0 text-primary" />
                                            <span className="font-medium text-default text-sm">
                                                Year in Review
                                            </span>
                                            <span className="truncate text-muted text-xs">
                                                everything this household watched this year
                                            </span>
                                        </span>
                                        <ChevronDownIcon className="h-4 w-4 shrink-0 text-muted" />
                                    </button>
                                )}
                            </PageSection>

                            {/* Taste profiles - per-user profile built from real watch data
                (top titles by actual time, movie/series split, genres, and
                closest household match). The richer replacement for the old
                flat overlap list; the overlap "shared favorites" detail stays
                below as a companion. */}
                            {tasteProfiles.length > 0 && (
                                <PageSection delay={0.33}>
                                    <Card padding="lg">
                                        <div className="mb-6 flex items-center gap-3">
                                            <HeartIcon className="h-6 w-6" />
                                            <div>
                                                <h3 className="font-display font-semibold text-default text-lg">
                                                    Taste profiles
                                                </h3>
                                                <p className="text-muted text-sm">
                                                    Each member&apos;s real viewing fingerprint —
                                                    from actual watch-time, not tags
                                                </p>
                                            </div>
                                        </div>
                                        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                                            {tasteProfiles.map((p) => {
                                                const hrs = Math.floor(p.totalSeconds / 3600);
                                                const mins = Math.round(
                                                    (p.totalSeconds % 3600) / 60
                                                );
                                                const timeLabel =
                                                    hrs > 0 ? `${hrs}h ${mins}m` : `${mins}m`;
                                                return (
                                                    <div
                                                        className="flex flex-col gap-3 rounded-xl bg-surface-hover p-4"
                                                        key={p.user.id}
                                                    >
                                                        <div className="flex items-center gap-3">
                                                            <UserAvatar
                                                                email={p.user.email}
                                                                name={p.user.username}
                                                                size="md"
                                                                src={
                                                                    p.user.useGravatar
                                                                        ? undefined
                                                                        : (p.user.avatarUrl ??
                                                                          undefined)
                                                                }
                                                                useGravatar={p.user.useGravatar}
                                                                userId={p.user.id}
                                                            />
                                                            <div className="min-w-0">
                                                                <p className="truncate font-semibold text-default text-sm">
                                                                    {p.user.username}
                                                                </p>
                                                                <p className="text-muted text-xs">
                                                                    {timeLabel} · {p.movieCount}{" "}
                                                                    movies · {p.seriesCount} series
                                                                </p>
                                                            </div>
                                                        </div>

                                                        {p.topGenres.length > 0 && (
                                                            <div className="flex flex-wrap gap-1.5">
                                                                {p.topGenres.map((g) => (
                                                                    <span
                                                                        className="rounded-md bg-primary-muted px-2 py-0.5 font-medium text-[11px] text-primary"
                                                                        key={g.genre}
                                                                    >
                                                                        {g.genre}
                                                                    </span>
                                                                ))}
                                                            </div>
                                                        )}

                                                        {p.topTitles.length > 0 && (
                                                            <ScrollRow className="flex gap-2 pb-1">
                                                                {p.topTitles.map((t) => (
                                                                    <div
                                                                        className="w-14 shrink-0"
                                                                        key={t.key}
                                                                        title={t.name}
                                                                    >
                                                                        <div className="h-20 w-14 overflow-hidden rounded-lg border border-default bg-surface">
                                                                            {t.poster && (
                                                                                <img
                                                                                    alt={t.name}
                                                                                    className="h-full w-full object-cover"
                                                                                    src={t.poster}
                                                                                />
                                                                            )}
                                                                        </div>
                                                                        <p className="mt-1 truncate text-[10px] text-muted">
                                                                            {t.name}
                                                                        </p>
                                                                    </div>
                                                                ))}
                                                            </ScrollRow>
                                                        )}

                                                        {p.tasteTwin && (
                                                            <div className="mt-auto flex items-center gap-2 border-default/50 border-t pt-1">
                                                                <span className="text-muted text-xs">
                                                                    Closest match:
                                                                </span>
                                                                <UserAvatar
                                                                    email={p.tasteTwin.user.email}
                                                                    name={p.tasteTwin.user.username}
                                                                    size="xs"
                                                                    src={
                                                                        p.tasteTwin.user.useGravatar
                                                                            ? undefined
                                                                            : (p.tasteTwin.user
                                                                                  .avatarUrl ??
                                                                              undefined)
                                                                    }
                                                                    useGravatar={
                                                                        p.tasteTwin.user.useGravatar
                                                                    }
                                                                    userId={p.tasteTwin.user.id}
                                                                />
                                                                <span className="truncate font-medium text-default text-xs">
                                                                    {p.tasteTwin.user.username}
                                                                </span>
                                                                <Badge size="sm" variant="primary">
                                                                    {p.tasteTwin.similarity}%
                                                                </Badge>
                                                            </div>
                                                        )}
                                                    </div>
                                                );
                                            })}
                                        </div>
                                    </Card>
                                </PageSection>
                            )}

                            {/* Taste Overlap - real behavioral overlap (actual watch-time
                on shared titles), not genre-tag matching. Hidden entirely
                for a single-user household, where a "pair" can't exist. */}
                            {tasteOverlap.length > 0 && (
                                <PageSection delay={0.35}>
                                    <Card padding="lg">
                                        <div className="mb-6 flex items-center gap-3">
                                            <HeartIcon className="h-6 w-6" />
                                            <div>
                                                <h3 className="font-display font-semibold text-default text-lg">
                                                    Taste overlap
                                                </h3>
                                                <p className="text-muted text-sm">
                                                    Real shared watch-time between household
                                                    members, not genre matching
                                                </p>
                                            </div>
                                        </div>
                                        <div className="space-y-5">
                                            {tasteOverlap.map((pair) => (
                                                <div
                                                    className="rounded-xl bg-surface-hover p-4"
                                                    key={`${pair.userA.id}-${pair.userB.id}`}
                                                >
                                                    <div className="mb-3 flex items-center gap-3">
                                                        <UserAvatar
                                                            email={pair.userA.email}
                                                            name={pair.userA.username}
                                                            size="sm"
                                                            src={
                                                                pair.userA.useGravatar
                                                                    ? undefined
                                                                    : (pair.userA.avatarUrl ??
                                                                      undefined)
                                                            }
                                                            useGravatar={pair.userA.useGravatar}
                                                            userId={pair.userA.id}
                                                        />
                                                        <span className="truncate font-medium text-default text-sm">
                                                            {pair.userA.username}
                                                        </span>
                                                        <Badge variant="primary">
                                                            {pair.similarity}% overlap
                                                        </Badge>
                                                        <span className="truncate font-medium text-default text-sm">
                                                            {pair.userB.username}
                                                        </span>
                                                        <UserAvatar
                                                            email={pair.userB.email}
                                                            name={pair.userB.username}
                                                            size="sm"
                                                            src={
                                                                pair.userB.useGravatar
                                                                    ? undefined
                                                                    : (pair.userB.avatarUrl ??
                                                                      undefined)
                                                            }
                                                            useGravatar={pair.userB.useGravatar}
                                                            userId={pair.userB.id}
                                                        />
                                                    </div>
                                                    <ScrollRow className="flex gap-2 pb-1">
                                                        {pair.shared.map((item) => (
                                                            <div
                                                                className="w-16 shrink-0"
                                                                key={item.key}
                                                                title={item.name || undefined}
                                                            >
                                                                <div className="h-24 w-16 overflow-hidden rounded-lg border border-default bg-surface">
                                                                    {item.poster && (
                                                                        <img
                                                                            alt={item.name || ""}
                                                                            className="h-full w-full object-cover"
                                                                            src={item.poster}
                                                                        />
                                                                    )}
                                                                </div>
                                                                <p className="mt-1 truncate text-muted text-xs">
                                                                    {item.name}
                                                                </p>
                                                            </div>
                                                        ))}
                                                    </ScrollRow>
                                                </div>
                                            ))}
                                        </div>
                                    </Card>
                                </PageSection>
                            )}
                        </div>
                    )}

                    {/* Content Tab - Top Content + Engagement + Top Items + Watch Velocity + Started Playing */}
                    {viewMode === "content" && (
                        <div className="space-y-6">
                            {/* Stats Grid for Content Tab */}
                            <PageSection className="mb-6">
                                <MetricStrip
                                    items={[
                                        {
                                            icon: <FilmIcon className="h-6 w-6" />,
                                            label: "Movies Watched",
                                            value: isLoading
                                                ? "..."
                                                : metricsData?.summary?.totalMovies || 0,
                                        },
                                        {
                                            icon: <TvIcon className="h-6 w-6" />,
                                            label: "Series Watched",
                                            value: isLoading
                                                ? "..."
                                                : metricsData?.summary?.totalShows || 0,
                                        },
                                        {
                                            icon: <TrophyIcon className="h-6 w-6" />,
                                            label: "Most Watched",
                                            value: isLoading
                                                ? "..."
                                                : (() => {
                                                      const name =
                                                          metricsData?.admin?.topItems?.series?.[0]
                                                              ?.name;
                                                      if (!name) {
                                                          return "N/A";
                                                      }
                                                      return name;
                                                  })(),
                                        },
                                        {
                                            icon: <FireIcon className="h-6 w-6" />,
                                            label: "Binge Sessions",
                                            value: isLoading
                                                ? "..."
                                                : metricsData?.admin?.interestingMetrics
                                                      ?.totalBingeSessions || 0,
                                        },
                                    ]}
                                />
                            </PageSection>

                            {/* Top Row: Top Items + Watch Velocity side by side */}
                            <PageSection delay={0.25}>
                                <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
                                    {/* Most Watched Section */}
                                    <Card padding="lg">
                                        <div className="mb-6 flex items-center justify-between">
                                            <div className="flex items-center gap-3">
                                                <TrophyIcon className="h-6 w-6" />
                                                <h3 className="font-display font-semibold text-default text-lg">
                                                    Most Watched
                                                </h3>
                                            </div>
                                        </div>
                                        {metricsData?.admin?.topItems ? (
                                            <TopItemsSection
                                                key={period} // Only force reset when period changes
                                                movies={metricsData.admin.topItems.movies}
                                                series={metricsData.admin.topItems.series}
                                            />
                                        ) : (
                                            <div className="py-8 text-center text-muted text-sm">
                                                No top items data available
                                            </div>
                                        )}
                                    </Card>

                                    {/* Binge Watches Section */}
                                    <Card padding="lg">
                                        <div className="mb-6 flex items-center justify-between">
                                            <div className="flex items-center gap-3">
                                                <FireIcon className="h-6 w-6" />
                                                <h3 className="font-display font-semibold text-default text-lg">
                                                    Binge Watches
                                                </h3>
                                            </div>
                                        </div>
                                        {metricsData?.admin?.watchVelocity ? (
                                            <BingeWatchesSection
                                                items={metricsData.admin.watchVelocity}
                                                key={period}
                                            />
                                        ) : (
                                            <div className="py-8 text-center text-muted text-sm">
                                                No binge watch data available
                                            </div>
                                        )}
                                    </Card>
                                </div>
                            </PageSection>
                            {/* Second Row: Engagement Patterns + Content Breakdown side by side */}
                            <PageSection delay={0.3}>
                                <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
                                    {/* Engagement Patterns */}
                                    <Card padding="lg">
                                        <div className="mb-6 flex items-center justify-between">
                                            <h3 className="font-display font-semibold text-default text-lg">
                                                Engagement Patterns
                                            </h3>
                                            <div className="flex items-center gap-2">
                                                <Badge variant="secondary">
                                                    Avg:{" "}
                                                    {metricsData?.admin?.engagement
                                                        ?.averageSessionMinutes || 0}{" "}
                                                    min
                                                </Badge>
                                                <Badge variant="secondary">
                                                    Binge:{" "}
                                                    {metricsData?.admin?.engagement
                                                        ?.bingeSessions || 0}
                                                </Badge>
                                            </div>
                                        </div>
                                        {metricsData?.admin?.engagement && (
                                            <HourlyHeatmap
                                                hourlyActivity={
                                                    metricsData.admin.engagement.hourlyActivity
                                                }
                                                peakHour={metricsData.admin.engagement.peakHour}
                                            />
                                        )}
                                    </Card>

                                    {/* Content Breakdown */}
                                    <Card className="flex flex-col" padding="lg">
                                        <div className="mb-6 flex items-center justify-between">
                                            <div>
                                                <h3 className="font-display font-semibold text-default text-lg">
                                                    Content Breakdown
                                                </h3>
                                                <p className="text-muted text-sm">
                                                    Movies vs Series
                                                </p>
                                            </div>
                                        </div>
                                        <div className="h-40 md:h-64">
                                            {isLoading ? (
                                                <div className="flex h-full items-center justify-center">
                                                    <div className="flex items-center gap-2 text-muted text-sm">
                                                        <div className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
                                                        <span>Loading...</span>
                                                    </div>
                                                </div>
                                            ) : error ? (
                                                <div className="flex h-full items-center justify-center text-muted text-sm">
                                                    Failed to load data
                                                </div>
                                            ) : contentBreakdownData.length === 0 ? (
                                                <div className="flex h-full flex-col items-center justify-center text-muted text-sm">
                                                    <p className="mb-2">No watch activity data</p>
                                                    <p className="text-xs opacity-70">
                                                        {metricsData?.watchActivity?.byDay
                                                            ? "No activity in selected period"
                                                            : "Loading data..."}
                                                    </p>
                                                </div>
                                            ) : (
                                                <ContentBreakdownChart
                                                    data={contentBreakdownData}
                                                />
                                            )}
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
                                </div>
                            </PageSection>
                        </div>
                    )}

                    {/* Admin Tab - All Admin Sections */}
                    {viewMode === "admin" && (
                        <div className="space-y-6">
                            {/* Stats Grid for Admin Tab */}
                            <PageSection className="mb-6">
                                <MetricStrip
                                    items={[
                                        {
                                            icon: <ClockIcon className="h-6 w-6" />,
                                            label: "Most Active Hour",
                                            value: isLoading
                                                ? "..."
                                                : `${metricsData?.admin?.interestingMetrics?.mostActiveHour || 0}:00`,
                                        },
                                        {
                                            icon: <CalendarIcon className="h-6 w-6" />,
                                            label: "Weekend Watching",
                                            value: isLoading
                                                ? "..."
                                                : `${(metricsData?.admin?.interestingMetrics?.weekendWatchPercentage || 0).toFixed(1)}%`,
                                        },
                                        {
                                            icon: <ChartBarIcon className="h-6 w-6" />,
                                            label: "Completion Rate",
                                            value: isLoading
                                                ? "..."
                                                : `${(metricsData?.admin?.interestingMetrics?.completionRate || 0).toFixed(1)}%`,
                                        },
                                        {
                                            icon: <PlayIcon className="h-6 w-6" />,
                                            label: "Avg Session",
                                            value: isLoading
                                                ? "..."
                                                : formatMinutes(
                                                      Math.round(
                                                          metricsData?.admin?.interestingMetrics
                                                              ?.avgSessionDuration || 0
                                                      )
                                                  ),
                                        },
                                    ]}
                                />
                            </PageSection>

                            {/* User Joins Over Time Chart */}
                            {metricsData?.userJoins?.byDay &&
                                metricsData.userJoins.byDay.length > 0 && (
                                    <PageSection delay={0.22}>
                                        <Card padding="lg">
                                            <div className="mb-6 flex items-center justify-between">
                                                <div>
                                                    <h3 className="font-display font-semibold text-default text-lg">
                                                        User Joins Over Time
                                                    </h3>
                                                    <p className="text-muted text-sm">
                                                        New user signups by day
                                                    </p>
                                                </div>
                                                <Badge variant="primary">
                                                    <UsersIcon className="mr-1 h-4 w-4" />
                                                    {metricsData.userJoins.byDay.reduce(
                                                        (sum, day) => sum + day.count,
                                                        0
                                                    )}{" "}
                                                    Total
                                                </Badge>
                                            </div>
                                            <div className="h-40 md:h-64">
                                                <ResponsiveContainer height="100%" width="100%">
                                                    <AreaChart data={metricsData.userJoins.byDay}>
                                                        <defs>
                                                            <linearGradient
                                                                id="colorUserJoins"
                                                                x1="0"
                                                                x2="0"
                                                                y1="0"
                                                                y2="1"
                                                            >
                                                                <stop
                                                                    offset="5%"
                                                                    stopColor="var(--color-chart-3)"
                                                                    stopOpacity={0.4}
                                                                />
                                                                <stop
                                                                    offset="95%"
                                                                    stopColor="var(--color-chart-3)"
                                                                    stopOpacity={0}
                                                                />
                                                            </linearGradient>
                                                        </defs>
                                                        <CartesianGrid
                                                            stroke="rgba(255,255,255,0.1)"
                                                            strokeDasharray="3 3"
                                                        />
                                                        <XAxis
                                                            dataKey="date"
                                                            fontSize={12}
                                                            stroke="#64748b"
                                                            tickFormatter={(value) => {
                                                                const date = new Date(value);
                                                                return date.toLocaleDateString(
                                                                    "en-US",
                                                                    {
                                                                        day: "numeric",
                                                                        month: "short",
                                                                        timeZone: "UTC",
                                                                    }
                                                                );
                                                            }}
                                                        />
                                                        <YAxis fontSize={12} stroke="#64748b" />
                                                        <Tooltip
                                                            contentStyle={TOOLTIP_STYLE}
                                                            formatter={(value) => [
                                                                `${value} user${Number(value) === 1 ? "" : "s"}`,
                                                                "New Signups",
                                                            ]}
                                                            labelFormatter={(value: any) => {
                                                                const date = new Date(value);
                                                                return date.toLocaleDateString(
                                                                    "en-US",
                                                                    {
                                                                        day: "numeric",
                                                                        month: "short",
                                                                        timeZone: "UTC",
                                                                        year: "numeric",
                                                                    }
                                                                );
                                                            }}
                                                            labelStyle={TOOLTIP_LABEL_STYLE}
                                                        />
                                                        <Area
                                                            dataKey="count"
                                                            fill="url(#colorUserJoins)"
                                                            fillOpacity={1}
                                                            stroke="var(--color-chart-3)"
                                                            strokeWidth={2}
                                                            type="monotone"
                                                        />
                                                    </AreaChart>
                                                </ResponsiveContainer>
                                            </div>
                                        </Card>
                                    </PageSection>
                                )}

                            {/* Top Row: Lifecycle + At-Risk side by side */}
                            <PageSection delay={0.25}>
                                <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
                                    {/* User Lifecycle Section */}
                                    <Card padding="lg">
                                        <div className="mb-6 flex items-center justify-between">
                                            <h3 className="font-display font-semibold text-default text-lg">
                                                User Lifecycle
                                            </h3>
                                            <Badge variant="primary">Retention</Badge>
                                        </div>
                                        {metricsData?.admin?.userLifecycle && (
                                            <UserLifecycleCard
                                                lifecycle={metricsData.admin.userLifecycle}
                                                userJoins={metricsData.userJoins?.byDay || []}
                                            />
                                        )}
                                    </Card>

                                    {/* At-Risk Users Section */}
                                    <Card padding="lg">
                                        <div className="mb-6 flex items-center justify-between">
                                            <div className="flex items-center gap-3">
                                                <ExclamationTriangleIcon className="h-6 w-6" />
                                                <h3 className="font-display font-semibold text-default text-lg">
                                                    At-Risk Users
                                                </h3>
                                            </div>
                                            <Badge>
                                                {metricsData?.admin?.userLifecycle?.criticalRisk
                                                    ?.length || 0}{" "}
                                                Critical,{" "}
                                                {metricsData?.admin?.userLifecycle?.atRisk
                                                    ?.length || 0}{" "}
                                                Warning
                                            </Badge>
                                        </div>
                                        {metricsData?.admin?.userLifecycle && (
                                            <AtRiskUsersTable
                                                atRiskUsers={metricsData.admin.userLifecycle.atRisk}
                                                criticalUsers={
                                                    metricsData.admin.userLifecycle.criticalRisk
                                                }
                                                onUserClick={setSelectedUser}
                                            />
                                        )}
                                    </Card>
                                </div>
                            </PageSection>

                            {/* Server Health Section - Full width */}
                            <PageSection delay={0.3}>
                                <Card padding="lg">
                                    <div className="mb-6 flex items-center justify-between">
                                        <div className="flex items-center gap-3">
                                            <ServerIcon className="h-6 w-6 text-primary" />
                                            <h3 className="font-display font-semibold text-default text-lg">
                                                Server Health
                                            </h3>
                                        </div>
                                        <Badge
                                            variant={
                                                metricsData?.admin?.serverHealth?.status ===
                                                "healthy"
                                                    ? "success"
                                                    : metricsData?.admin?.serverHealth?.status ===
                                                        "warning"
                                                      ? "warning"
                                                      : "error"
                                            }
                                        >
                                            {metricsData?.admin?.serverHealth?.status?.toUpperCase() ||
                                                "UNKNOWN"}
                                        </Badge>
                                    </div>
                                    {metricsData?.admin?.serverHealth && (
                                        <ServerHealthDashboard
                                            checks={metricsData.admin.serverHealth.checks}
                                            metrics={metricsData.admin.serverHealth.metrics}
                                            status={metricsData.admin.serverHealth.status}
                                        />
                                    )}
                                </Card>
                            </PageSection>

                            {/* Addon Performance Section - Full width */}
                            <PageSection delay={0.35}>
                                <Card padding="lg">
                                    <div className="mb-6 flex items-center justify-between">
                                        <div className="flex items-center gap-3">
                                            <PuzzlePieceIcon className="h-6 w-6 text-secondary" />
                                            <h3 className="font-display font-semibold text-default text-lg">
                                                Addon Performance
                                            </h3>
                                        </div>
                                        <Badge variant="secondary">
                                            {metricsData?.admin?.addonAnalytics?.totalAddons || 0}{" "}
                                            Addons
                                        </Badge>
                                    </div>
                                    {metricsData?.admin?.addonAnalytics && (
                                        <AddonPerformanceCard
                                            activeAddons={
                                                metricsData.admin.addonAnalytics.activeAddons
                                            }
                                            byResource={metricsData.admin.addonAnalytics.byResource}
                                            topAddons={metricsData.admin.addonAnalytics.topAddons}
                                            totalAddons={
                                                metricsData.admin.addonAnalytics.totalAddons
                                            }
                                        />
                                    )}
                                </Card>
                            </PageSection>
                        </div>
                    )}

                    {viewMode === "health" &&
                        (healthLoading ? (
                            <PageSection>
                                <div className="mb-6 h-24 animate-pulse rounded-xl bg-surface-hover" />
                                <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                                    {[...new Array(4)].map((_, i) => (
                                        <div
                                            className="h-40 animate-pulse rounded-xl bg-surface-hover"
                                            key={i}
                                        />
                                    ))}
                                </div>
                            </PageSection>
                        ) : healthData ? (
                            <>
                                <PageSection className="mb-6">
                                    <div className="mb-3 flex justify-end">
                                        <Button
                                            disabled={healthRefreshing}
                                            leftIcon={
                                                <ArrowPathIcon
                                                    className={`h-4 w-4 ${healthRefreshing ? "animate-spin" : ""}`}
                                                />
                                            }
                                            onClick={() => loadHealth(true)}
                                            size="sm"
                                            variant="secondary"
                                        >
                                            Refresh
                                        </Button>
                                    </div>
                                    <Card
                                        className={
                                            healthData.overall === "healthy"
                                                ? "health-bg-ok border-success/30"
                                                : "health-bg-warn border-warning/30"
                                        }
                                        padding="lg"
                                    >
                                        <div className="flex items-center gap-4">
                                            <div
                                                className={`flex h-14 w-14 flex-shrink-0 items-center justify-center rounded-2xl ${healthData.overall === "healthy" ? "bg-success/15 text-success" : "bg-warning/15 text-warning"}`}
                                            >
                                                {healthData.overall === "healthy" ? (
                                                    <CheckCircleIcon className="h-8 w-8" />
                                                ) : (
                                                    <ExclamationTriangleIcon className="h-8 w-8" />
                                                )}
                                            </div>
                                            <div className="min-w-0 flex-1">
                                                <h2 className="font-bold font-display text-default text-xl">
                                                    {healthData.overall === "healthy"
                                                        ? "Everything is running smoothly"
                                                        : "Something needs attention"}
                                                </h2>
                                                <p className="text-muted text-sm">
                                                    Last checked{" "}
                                                    {healthTimeAgo(healthData.checkedAt)}
                                                    {healthData.overall !== "healthy" &&
                                                        " — see the cards below for what to fix."}
                                                </p>
                                            </div>
                                        </div>
                                    </Card>
                                </PageSection>

                                <PageSection>
                                    {/* Masonry (CSS columns), not a grid - these cards vary a lot
                    in height (Addons' uptime list, the incident timeline),
                    and a strict 2-col grid sizes every row to its tallest
                    cell, which left large dead gaps under the shorter card
                    in that row. break-inside-avoid-column keeps each card
                    from being split across the column break. */}
                                    <div className="columns-1 gap-4 md:columns-2">
                                        <div className="mb-4 break-inside-avoid-column">
                                            <HealthCheckCard
                                                icon={<TagIcon className="h-5 w-5" />}
                                                ok={!healthData.version.updateAvailable}
                                                summary={`Running ${healthData.version.running}`}
                                                title="Version"
                                            >
                                                {healthData.version.updateAvailable ? (
                                                    <HealthIssueRow
                                                        detail="A newer stable release has been published"
                                                        title={`Update available: ${healthData.version.latestRelease}`}
                                                    />
                                                ) : (
                                                    <p className="text-subtle text-xs">
                                                        {healthData.version.latestRelease
                                                            ? `Up to date with the latest stable release (${healthData.version.latestRelease}).`
                                                            : "Running the latest build - couldn't reach GitHub to check for a newer stable release."}
                                                    </p>
                                                )}
                                            </HealthCheckCard>
                                        </div>

                                        <div className="mb-4 break-inside-avoid-column">
                                            <HealthCheckCard
                                                icon={<ArrowsRightLeftIcon className="h-5 w-5" />}
                                                ok={healthData.sync.driftCount === 0}
                                                summary={`${healthData.sync.usersTracked} user${healthData.sync.usersTracked === 1 ? "" : "s"} tracked`}
                                                title="Sync"
                                            >
                                                {healthData.sync.driftCount > 0 ? (
                                                    <div>
                                                        {healthData.sync.drifted.map((d, i) => (
                                                            <HealthIssueRow
                                                                detail={d.body}
                                                                key={i}
                                                                meta={healthTimeAgo(d.since)}
                                                                onIgnore={() =>
                                                                    toggleSyncIgnored(
                                                                        d.userId,
                                                                        true
                                                                    )
                                                                }
                                                                title={d.title}
                                                            />
                                                        ))}
                                                    </div>
                                                ) : (
                                                    <p className="text-subtle text-xs">
                                                        No accounts have drifted from their
                                                        group&apos;s addons.
                                                    </p>
                                                )}
                                                <HealthIgnoredList
                                                    items={healthData.sync.ignored.map((u) => ({
                                                        id: u.userId,
                                                        name: u.title,
                                                    }))}
                                                    onUnignore={(id) =>
                                                        toggleSyncIgnored(id, false)
                                                    }
                                                />
                                            </HealthCheckCard>
                                        </div>

                                        <div className="mb-4 break-inside-avoid-column">
                                            <HealthCheckCard
                                                icon={<PuzzlePieceIcon className="h-5 w-5" />}
                                                ok={healthData.addons.offlineCount === 0}
                                                summary={`${healthData.addons.checked}/${healthData.addons.total} checked`}
                                                title="Addons"
                                            >
                                                {healthData.addons.offlineCount > 0 ? (
                                                    <div>
                                                        {healthData.addons.offline.map((a) => (
                                                            <HealthIssueRow
                                                                detail={a.error}
                                                                key={a.id}
                                                                meta={healthTimeAgo(a.lastChecked)}
                                                                onIgnore={() =>
                                                                    toggleAddonIgnored(a.id, true)
                                                                }
                                                                title={a.name}
                                                            />
                                                        ))}
                                                    </div>
                                                ) : (
                                                    <p className="text-subtle text-xs">
                                                        All addon manifests are reachable.
                                                    </p>
                                                )}
                                                <HealthIgnoredList
                                                    items={healthData.addons.ignored}
                                                    onUnignore={(id) =>
                                                        toggleAddonIgnored(id, false)
                                                    }
                                                />
                                                {healthData.addons.uptime.length > 0 && (
                                                    <div className="mt-3 border-default border-t pt-3">
                                                        <p className="mb-1.5 text-[10px] text-subtle uppercase tracking-wide">
                                                            Uptime
                                                        </p>
                                                        <div className="space-y-1">
                                                            {healthData.addons.uptime.map((a) => (
                                                                <div
                                                                    className="flex items-center justify-between gap-2 text-xs"
                                                                    key={a.id}
                                                                >
                                                                    <span className="truncate text-default">
                                                                        {a.name}
                                                                    </span>
                                                                    <span
                                                                        className={`flex-shrink-0 font-medium ${a.uptime30d < 99 ? "text-warning" : "text-subtle"}`}
                                                                    >
                                                                        {a.uptime7d.toFixed(1)}%
                                                                        (7d) ·{" "}
                                                                        {a.uptime30d.toFixed(1)}%
                                                                        (30d)
                                                                    </span>
                                                                </div>
                                                            ))}
                                                        </div>
                                                    </div>
                                                )}
                                            </HealthCheckCard>
                                        </div>

                                        <div className="mb-4 break-inside-avoid-column">
                                            <HealthCheckCard
                                                icon={<ShieldCheckIcon className="h-5 w-5" />}
                                                ok={
                                                    healthData.vault.failingCount === 0 &&
                                                    healthData.vault.expiringCount === 0
                                                }
                                                summary={`${healthData.vault.total} credential${healthData.vault.total === 1 ? "" : "s"} tracked`}
                                                title="Vault"
                                            >
                                                {healthData.vault.failingCount > 0 ||
                                                healthData.vault.expiringCount > 0 ? (
                                                    <div>
                                                        {healthData.vault.failing.map((v) => (
                                                            <HealthIssueRow
                                                                detail={v.message || "Check failed"}
                                                                key={`f-${v.id}`}
                                                                meta={healthTimeAgo(v.lastChecked)}
                                                                onIgnore={() =>
                                                                    toggleVaultIgnored(v.id, true)
                                                                }
                                                                title={v.name}
                                                            />
                                                        ))}
                                                        {healthData.vault.expiring.map((v) => (
                                                            <HealthIssueRow
                                                                detail="Expiring soon"
                                                                key={`e-${v.id}`}
                                                                meta={new Date(
                                                                    v.expiresAt
                                                                ).toLocaleDateString()}
                                                                onIgnore={() =>
                                                                    toggleVaultIgnored(v.id, true)
                                                                }
                                                                title={v.name}
                                                            />
                                                        ))}
                                                    </div>
                                                ) : (
                                                    <p className="text-subtle text-xs">
                                                        All credentials are passing checks with no
                                                        upcoming expiry.
                                                    </p>
                                                )}
                                                <HealthIgnoredList
                                                    items={healthData.vault.ignored}
                                                    onUnignore={(id) =>
                                                        toggleVaultIgnored(id, false)
                                                    }
                                                />
                                            </HealthCheckCard>
                                        </div>

                                        {/* Private-mode only - see health.js for why this has no
                      meaning on a public multi-tenant instance. */}
                                        {healthData.proxy && (
                                            <div className="mb-4 break-inside-avoid-column">
                                                <HealthCheckCard
                                                    icon={<SignalIcon className="h-5 w-5" />}
                                                    ok={
                                                        !healthData.proxy.configured ||
                                                        healthData.proxy.healthIgnored
                                                            ? null
                                                            : healthData.proxy.ok
                                                    }
                                                    summary={
                                                        healthData.proxy.configured
                                                            ? `Last poll ${healthTimeAgo(healthData.proxy.at)}`
                                                            : "Not configured"
                                                    }
                                                    title="Proxy"
                                                >
                                                    {healthData.proxy.configured ? (
                                                        healthData.proxy.ok === false &&
                                                        !healthData.proxy.healthIgnored ? (
                                                            <HealthIssueRow
                                                                detail={healthData.proxy.error}
                                                                meta={healthTimeAgo(
                                                                    healthData.proxy.at
                                                                )}
                                                                onIgnore={() =>
                                                                    toggleProxyIgnored(true)
                                                                }
                                                                title="Proxy stats unreachable"
                                                            />
                                                        ) : (
                                                            <p className="text-subtle text-xs">
                                                                Now Playing polling is reaching
                                                                AIOStreams normally.
                                                            </p>
                                                        )
                                                    ) : (
                                                        <p className="text-subtle text-xs">
                                                            AIOStreams proxy isn&apos;t configured
                                                            on this instance.
                                                        </p>
                                                    )}
                                                    {healthData.proxy.configured &&
                                                        healthData.proxy.healthIgnored && (
                                                            <div className="mt-2 border-default border-t pt-2">
                                                                <button
                                                                    className="flex items-center gap-1.5 text-subtle text-xs transition-colors hover:text-default"
                                                                    onClick={() =>
                                                                        toggleProxyIgnored(false)
                                                                    }
                                                                    title="Un-ignore"
                                                                    type="button"
                                                                >
                                                                    <EyeIcon className="h-3.5 w-3.5" />
                                                                    Ignored - proxy connectivity
                                                                    alerts are muted
                                                                </button>
                                                            </div>
                                                        )}
                                                </HealthCheckCard>
                                            </div>
                                        )}

                                        {/* Jellyfin, AIOStreams and AIOMetadata servers people sign
                      in to - from each person's last read, no live calls. */}
                                        {(healthData.servers?.length ?? 0) > 0 && (
                                            <div className="mb-4 break-inside-avoid-column">
                                                <HealthCheckCard
                                                    icon={<ServerIcon className="h-5 w-5" />}
                                                    ok={(healthData.servers ?? []).every(
                                                        (s) => s.status === "up"
                                                    )}
                                                    summary={`${(healthData.servers ?? []).length} server${(healthData.servers ?? []).length === 1 ? "" : "s"} people sign in to`}
                                                    title="Servers"
                                                >
                                                    <div className="space-y-2">
                                                        {(healthData.servers ?? []).map((s) => (
                                                            <div
                                                                className="flex items-start justify-between gap-3 text-xs"
                                                                key={s.key}
                                                            >
                                                                <div className="min-w-0">
                                                                    <p className="truncate text-default text-sm">
                                                                        {s.address}
                                                                    </p>
                                                                    <p className="text-subtle">
                                                                        {s.label}
                                                                        {s.version
                                                                            ? ` ${s.channel === "nightly" ? `nightly${s.commit ? ` ${s.commit.slice(0, 7)}` : ""}` : s.version}`
                                                                            : ""}
                                                                        {s.updateAvailable &&
                                                                        s.latest ? (
                                                                            <span className="text-warning">
                                                                                {" "}
                                                                                · {s.latest} is out
                                                                            </span>
                                                                        ) : null}
                                                                        {" · "}
                                                                        {s.people.length}{" "}
                                                                        {s.people.length === 1
                                                                            ? "person"
                                                                            : "people"}
                                                                        {s.status === "down" &&
                                                                        s.since
                                                                            ? ` · down since ${healthTimeAgo(s.since)}`
                                                                            : ""}
                                                                        {s.status === "partial"
                                                                            ? ` · ${s.people
                                                                                  .filter(
                                                                                      (p) =>
                                                                                          p.state !==
                                                                                          "ok"
                                                                                  )
                                                                                  .map(
                                                                                      (p) =>
                                                                                          `${p.name} ${p.state === "reconnect" ? "needs to reconnect" : "failing"}`
                                                                                  )
                                                                                  .join(", ")}`
                                                                            : ""}
                                                                    </p>
                                                                </div>
                                                                <Badge
                                                                    className="flex-shrink-0"
                                                                    size="sm"
                                                                    variant={
                                                                        s.status === "up"
                                                                            ? "success"
                                                                            : s.status === "down"
                                                                              ? "error"
                                                                              : "warning"
                                                                    }
                                                                >
                                                                    {s.status === "up"
                                                                        ? "Up"
                                                                        : s.status === "down"
                                                                          ? "Down"
                                                                          : "Some failing"}
                                                                </Badge>
                                                            </div>
                                                        ))}
                                                    </div>
                                                </HealthCheckCard>
                                            </div>
                                        )}

                                        {/* The account's LumiereDB (IMDb's data, self-hosted). */}
                                        {healthData.lumiere && (
                                            <div className="mb-4 break-inside-avoid-column">
                                                <HealthCheckCard
                                                    icon={<CircleStackIcon className="h-5 w-5" />}
                                                    ok={
                                                        healthData.lumiere.state === "ready"
                                                            ? true
                                                            : healthData.lumiere.state ===
                                                                "building"
                                                              ? null
                                                              : false
                                                    }
                                                    summary={
                                                        healthData.lumiere.state === "ready"
                                                            ? "Ready"
                                                            : healthData.lumiere.state ===
                                                                "building"
                                                              ? "Building its index"
                                                              : "Not answering"
                                                    }
                                                    title="LumiereDB"
                                                >
                                                    <div className="flex items-start justify-between gap-3 text-xs">
                                                        <div className="min-w-0">
                                                            <p className="truncate text-default text-sm">
                                                                {healthData.lumiere.address}
                                                            </p>
                                                            <p className="text-subtle">
                                                                {healthData.lumiere.state ===
                                                                "ready"
                                                                    ? "Discover search, Trending and Smart Catalogs are answered from IMDb’s data."
                                                                    : healthData.lumiere.message}
                                                            </p>
                                                        </div>
                                                        <Badge
                                                            className="flex-shrink-0"
                                                            size="sm"
                                                            variant={
                                                                healthData.lumiere.state === "ready"
                                                                    ? "success"
                                                                    : healthData.lumiere.state ===
                                                                        "building"
                                                                      ? "warning"
                                                                      : "error"
                                                            }
                                                        >
                                                            {healthData.lumiere.state === "ready"
                                                                ? "Up"
                                                                : healthData.lumiere.state ===
                                                                    "building"
                                                                  ? "Building"
                                                                  : "Down"}
                                                        </Badge>
                                                    </div>
                                                </HealthCheckCard>
                                            </div>
                                        )}

                                        {/* Unified incident timeline: every offline/online addon
                      transition plus every vault/proxy health notification,
                      in one feed - answers "when did this actually start"
                      without digging through three separate places. */}
                                        {healthData.timeline.length > 0 && (
                                            <div className="mb-4 break-inside-avoid-column">
                                                <Card padding="lg">
                                                    <div className="mb-3 flex items-center gap-2.5">
                                                        <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
                                                            <ClockIcon className="h-5 w-5" />
                                                        </div>
                                                        <div>
                                                            <h3 className="font-semibold text-default text-sm">
                                                                Incident timeline
                                                            </h3>
                                                            <p className="text-muted text-xs">
                                                                Addon, Vault, Proxy and server
                                                                health events, most recent first
                                                            </p>
                                                        </div>
                                                    </div>
                                                    <div className="max-h-64 space-y-0 overflow-y-auto">
                                                        {healthData.timeline.map((entry) => (
                                                            <div
                                                                className="flex items-start gap-3 border-default border-t py-2 first:border-t-0 first:pt-0"
                                                                key={entry.id}
                                                            >
                                                                <div
                                                                    className={`mt-1.5 h-2 w-2 flex-shrink-0 rounded-full ${entry.status === "up" ? "bg-success" : "bg-error"}`}
                                                                />
                                                                <div className="min-w-0 flex-1">
                                                                    <div className="flex items-center justify-between gap-2">
                                                                        <p className="truncate text-default text-sm">
                                                                            {entry.title}
                                                                        </p>
                                                                        <span
                                                                            className="flex-shrink-0 text-subtle text-xs"
                                                                            title={new Date(
                                                                                entry.at
                                                                            ).toLocaleString()}
                                                                        >
                                                                            {healthTimeAgo(
                                                                                entry.at
                                                                            )}
                                                                        </span>
                                                                    </div>
                                                                    {entry.detail && (
                                                                        <p className="break-words text-muted text-xs">
                                                                            {entry.detail}
                                                                        </p>
                                                                    )}
                                                                </div>
                                                                <Badge
                                                                    className="flex-shrink-0 capitalize"
                                                                    size="sm"
                                                                    variant="default"
                                                                >
                                                                    {entry.source}
                                                                </Badge>
                                                            </div>
                                                        ))}
                                                    </div>
                                                </Card>
                                            </div>
                                        )}
                                    </div>

                                    {healthData.mismatchCount > 0 && (
                                        <Card className="mt-4 border-warning/30" padding="md">
                                            <div className="flex items-center gap-2">
                                                <ExclamationTriangleIcon className="h-4 w-4 flex-shrink-0 text-warning" />
                                                <p className="text-default text-sm">
                                                    {healthData.mismatchCount} title
                                                    {healthData.mismatchCount === 1 ? "" : "s"}{" "}
                                                    streamed but not recorded by any connected
                                                    account — see the notification bell for details.
                                                </p>
                                            </div>
                                        </Card>
                                    )}
                                </PageSection>

                                {/* Database storage - renders nothing in public/Postgres mode
                  or before there's enough history to chart, see
                  DbStorageCard. Lives here rather than Tasks since it's
                  monitoring-only, same as the rest of this tab. */}
                                <PageSection delay={0.4}>
                                    <DbStorageCard />
                                </PageSection>
                            </>
                        ) : (
                            <PageSection>
                                <Card className="text-center" padding="lg">
                                    <ExclamationTriangleIcon className="mx-auto mb-3 h-10 w-10 text-warning" />
                                    <p className="text-muted text-sm">
                                        Couldn&apos;t load health status.
                                    </p>
                                </Card>
                            </PageSection>
                        ))}
                </div>
            </div>
        </Wrapper>
    );
}
