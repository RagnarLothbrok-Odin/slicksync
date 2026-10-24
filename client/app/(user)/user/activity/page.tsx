"use client";

import {
    CalendarIcon,
    CheckCircleIcon,
    ClockIcon,
    FilmIcon,
    MagnifyingGlassIcon,
    TvIcon,
} from "@heroicons/react/24/outline";
import { motion } from "framer-motion";
import { memo, useCallback, useEffect, useMemo, useState } from "react";
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
import { Avatar, Card, ViewModeToggle } from "@/components/ui";
import { UserPageHeader } from "@/components/user/UserPageContainer";
import { startAdaptivePoll } from "@/lib/adaptivePoll";
import { readErrorMessage } from "@/lib/errors";
import { useUserAuth, useUserAuthHeaders } from "@/lib/hooks/useUserAuth";
import { providerTypeLabel } from "@/lib/providers";
import { type UserActivityData, userActivity, type WatchSession } from "@/lib/user-api";

// Helper to format duration in a human-readable way
function formatDuration(seconds: number): string {
    if (seconds < 60) {
        return `${seconds}s`;
    }
    if (seconds < 3600) {
        return `${Math.round(seconds / 60)}m`;
    }
    const hours = Math.floor(seconds / 3600);
    const mins = Math.round((seconds % 3600) / 60);
    return mins > 0 ? `${hours}h ${mins}m` : `${hours}h`;
}

// Format fractional hours in a human-readable way (Xh Xm)
function formatHours(hours: number): string {
    if (hours === 0) {
        return "0h";
    }
    const h = Math.floor(hours);
    const m = Math.round((hours - h) * 60);

    if (h === 0) {
        return `${m}m`;
    }
    if (m === 0) {
        return `${h}h`;
    }
    return `${h}h ${m}m`;
}

// Format time for display (e.g., "2:30 PM")
function formatTime(date: Date): string {
    return date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

// Format timestamp relative
function formatTimestamp(date: Date): string {
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / (1000 * 60));
    const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

    if (diffMins < 1) {
        return "Just now";
    }
    if (diffMins < 60) {
        return `${diffMins}m ago`;
    }
    if (diffHours < 24) {
        return `${diffHours}h ago`;
    }
    if (diffDays === 1) {
        return "Yesterday";
    }
    return `${diffDays} days ago`;
}

// Helper to get date key for grouping (YYYY-MM-DD format)
function getDateKey(date: Date): string {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
}

// Helper to format date header (Today, Yesterday, or formatted date)
function formatDateHeader(dateKey: string): string {
    const today = new Date();
    const todayKey = getDateKey(today);
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayKey = getDateKey(yesterday);

    if (dateKey === todayKey) {
        return "Today";
    }
    if (dateKey === yesterdayKey) {
        return "Yesterday";
    }

    const date = new Date(`${dateKey}T00:00:00`);
    return date.toLocaleDateString("en-US", {
        day: "numeric",
        month: "long",
        weekday: "long",
        year: "numeric",
    });
}

// Memoized tooltip style
const TOOLTIP_STYLE = {
    backdropFilter: "blur(12px)",
    backgroundColor: "rgba(30, 30, 56, 0.95)",
    border: "1px solid rgba(255,255,255,0.1)",
    borderRadius: "12px",
} as const;

const TOOLTIP_LABEL_STYLE = { color: "#fff" } as const;

// Stat Card Component
function StatCard({
    label,
    value,
    icon,
    color = "var(--color-primary)",
    delay = 0,
}: {
    label: string;
    value: string | number;
    icon: React.ReactNode;
    color?: string;
    delay?: number;
}) {
    return (
        <motion.div
            animate={{ opacity: 1, y: 0 }}
            className="rounded-xl p-5"
            initial={{ opacity: 0, y: 20 }}
            style={{
                background: "var(--color-surface)",
                border: "1px solid var(--color-surface-border)",
            }}
            transition={{ delay }}
        >
            <div className="mb-3 flex items-start justify-between">
                <div
                    className="flex h-10 w-10 items-center justify-center rounded-lg"
                    style={{ background: `${color}20`, color }}
                >
                    {icon}
                </div>
            </div>
            <div className="mb-1 font-bold text-2xl" style={{ color: "var(--color-text)" }}>
                {value}
            </div>
            <div className="text-sm" style={{ color: "var(--color-text-muted)" }}>
                {label}
            </div>
        </motion.div>
    );
}

// Watch Time Chart Component
const WatchTimeChart = memo(function WatchTimeChart({
    data,
}: {
    data: Array<{ date: string; minutes: number }>;
}) {
    return (
        <motion.div
            animate={{ opacity: 1, y: 0 }}
            className="rounded-xl p-6"
            initial={{ opacity: 0, y: 20 }}
            style={{
                background: "var(--color-surface)",
                border: "1px solid var(--color-surface-border)",
            }}
            transition={{ delay: 0.2 }}
        >
            <div className="mb-6 flex items-center justify-between">
                <h3 className="font-semibold text-lg" style={{ color: "var(--color-text)" }}>
                    Watch Time
                </h3>
                <div
                    className="rounded-lg px-3 py-1 text-sm"
                    style={{
                        background: "var(--color-surface-elevated)",
                        color: "var(--color-text-muted)",
                    }}
                >
                    Last 7 Days
                </div>
            </div>

            <div className="h-64">
                <ResponsiveContainer height="100%" width="100%">
                    <AreaChart data={data}>
                        <defs>
                            <linearGradient id="colorMinutes" x1="0" x2="0" y1="0" y2="1">
                                <stop
                                    offset="5%"
                                    stopColor="var(--color-primary)"
                                    stopOpacity={0.4}
                                />
                                <stop
                                    offset="95%"
                                    stopColor="var(--color-primary)"
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
                        />
                        <Tooltip
                            contentStyle={TOOLTIP_STYLE}
                            formatter={(value: any) => [formatDuration(value * 60), "Watch Time"]}
                            labelStyle={TOOLTIP_LABEL_STYLE}
                        />
                        <Area
                            dataKey="minutes"
                            fill="url(#colorMinutes)"
                            fillOpacity={1}
                            stroke="var(--color-primary)"
                            strokeWidth={2}
                            type="monotone"
                        />
                    </AreaChart>
                </ResponsiveContainer>
            </div>
        </motion.div>
    );
});

// Content Breakdown Chart Component
const ContentBreakdownChart = memo(function ContentBreakdownChart({
    data,
}: {
    data: Array<{ date: string; movies: number; series: number }>;
}) {
    return (
        <motion.div
            animate={{ opacity: 1, y: 0 }}
            className="rounded-xl p-6"
            initial={{ opacity: 0, y: 20 }}
            style={{
                background: "var(--color-surface)",
                border: "1px solid var(--color-surface-border)",
            }}
            transition={{ delay: 0.25 }}
        >
            <div className="mb-6 flex items-center justify-between">
                <h3 className="font-semibold text-lg" style={{ color: "var(--color-text)" }}>
                    Content Breakdown
                </h3>
            </div>

            <div className="h-64">
                <ResponsiveContainer height="100%" width="100%">
                    <BarChart data={data}>
                        <CartesianGrid stroke="rgba(255,255,255,0.1)" strokeDasharray="3 3" />
                        <XAxis dataKey="date" fontSize={12} stroke="#64748b" />
                        <YAxis fontSize={12} stroke="#64748b" />
                        <Tooltip contentStyle={TOOLTIP_STYLE} labelStyle={TOOLTIP_LABEL_STYLE} />
                        <Bar
                            dataKey="movies"
                            fill="var(--color-primary)"
                            name="Movies"
                            radius={[4, 4, 0, 0]}
                        />
                        <Bar
                            dataKey="series"
                            fill="var(--color-secondary)"
                            name="Series"
                            radius={[4, 4, 0, 0]}
                        />
                    </BarChart>
                </ResponsiveContainer>
            </div>

            {/* Legend */}
            <div
                className="mt-4 flex items-center justify-center gap-6 border-t pt-4"
                style={{ borderColor: "var(--color-surface-border)" }}
            >
                <div className="flex items-center gap-2">
                    <span
                        className="h-3 w-3 rounded-full"
                        style={{ background: "var(--color-primary)" }}
                    />
                    <span className="text-sm" style={{ color: "var(--color-text-muted)" }}>
                        Movies
                    </span>
                </div>
                <div className="flex items-center gap-2">
                    <span
                        className="h-3 w-3 rounded-full"
                        style={{ background: "var(--color-secondary)" }}
                    />
                    <span className="text-sm" style={{ color: "var(--color-text-muted)" }}>
                        Series
                    </span>
                </div>
            </div>
        </motion.div>
    );
});

// Activity Card Component - matches admin design
const ActivityCard = memo(function ActivityCard({
    session,
    userInfo,
    onFilterByContent,
}: {
    session: WatchSession;
    userInfo: any;
    onFilterByContent?: (name: string) => void;
}) {
    const [imageError, setImageError] = useState(false);
    const timestamp = new Date(session.startTime);
    const endTime = session.endTime ? new Date(session.endTime) : undefined;

    return (
        <motion.div
            className="flex items-start gap-4 rounded-xl p-4 transition-colors"
            style={{
                background: "var(--color-surface)",
                border: "1px solid var(--color-surface-border)",
            }}
            whileHover={{ x: 4 }}
        >
            {/* Poster or icon */}
            {session.poster && !imageError ? (
                <button
                    className="h-16 w-12 shrink-0 overflow-hidden rounded-lg"
                    onClick={() => onFilterByContent?.(session.itemName)}
                    style={{
                        background: "var(--color-surface-elevated)",
                        border: "1px solid var(--color-surface-border)",
                    }}
                    type="button"
                >
                    <img
                        alt={session.itemName}
                        className="h-full w-full object-cover"
                        onError={() => setImageError(true)}
                        src={session.poster}
                    />
                </button>
            ) : (
                <button
                    className="rounded-lg p-2"
                    onClick={() => onFilterByContent?.(session.itemName)}
                    style={{
                        background: "var(--color-primary-muted)",
                        color: "var(--color-primary)",
                    }}
                    type="button"
                >
                    {session.itemType === "movie" ? (
                        <FilmIcon className="h-4 w-4" />
                    ) : (
                        <TvIcon className="h-4 w-4" />
                    )}
                </button>
            )}

            {/* User avatar */}
            <Avatar
                colorIndex={userInfo?.colorIndex || 0}
                email={userInfo?.email}
                name={userInfo?.username || "You"}
                size="sm"
                src={userInfo?.avatarUrl || undefined}
                useGravatar={userInfo?.useGravatar}
            />

            {/* Activity details */}
            <div className="min-w-0 flex-1">
                <p className="text-sm" style={{ color: "var(--color-text-muted)" }}>
                    <span className="font-medium" style={{ color: "var(--color-text)" }}>
                        {userInfo?.username || "You"}
                    </span>{" "}
                    watched
                </p>

                {/* Content info */}
                <div className="mt-1 flex items-center gap-2">
                    {session.itemType === "movie" ? (
                        <FilmIcon className="h-4 w-4" style={{ color: "var(--color-primary)" }} />
                    ) : (
                        <TvIcon className="h-4 w-4" style={{ color: "#10b981" }} />
                    )}
                    <button
                        className="text-left font-medium transition-colors hover:opacity-80"
                        onClick={() => onFilterByContent?.(session.itemName)}
                        style={{ color: "var(--color-text)" }}
                        type="button"
                    >
                        {session.itemName}
                        {session.itemType === "series" &&
                            session.episode !== undefined &&
                            session.episode > 0 && (
                                <span className="ml-1" style={{ color: "var(--color-text-muted)" }}>
                                    {session.season !== undefined && session.season > 0
                                        ? `S${String(session.season).padStart(2, "0")}E`
                                        : "E"}
                                    {String(session.episode).padStart(2, "0")}
                                </span>
                            )}
                    </button>
                </div>

                {/* Session meta: duration & start/end time */}
                <div
                    className="mt-3 flex items-center gap-1 text-xs"
                    style={{ color: "var(--color-text-muted)" }}
                >
                    <ClockIcon className="h-3 w-3" />
                    {!session.isSynthetic && session.durationSeconds !== undefined && (
                        <span>
                            {session.durationSeconds > 0
                                ? formatDuration(session.durationSeconds)
                                : "<1m"}
                        </span>
                    )}
                    {!session.isSynthetic && session.durationSeconds !== undefined && (
                        <span className="mx-1">•</span>
                    )}
                    <span>{formatTime(timestamp)}</span>
                    {endTime && !session.isSynthetic && (
                        <>
                            <span className="mx-1">→</span>
                            <span>{formatTime(endTime)}</span>
                        </>
                    )}
                </div>
            </div>

            {/* Timestamp */}
            <div className="text-right">
                <p className="text-xs" style={{ color: "var(--color-text-subtle)" }}>
                    {formatTimestamp(timestamp)}
                </p>
            </div>
        </motion.div>
    );
});

// Grid view activity card - Cinematic poster design (matches admin)
const ActivityCardGrid = memo(function ActivityCardGrid({
    session,
    onFilterByContent,
}: {
    session: WatchSession;
    onFilterByContent?: (name: string) => void;
}) {
    const [imageError, setImageError] = useState(false);
    const timestamp = new Date(session.startTime);

    return (
        <motion.div
            animate={{ opacity: 1, scale: 1 }}
            className="group relative cursor-pointer"
            initial={{ opacity: 0, scale: 0.9 }}
            whileHover={{ y: -4 }}
        >
            {/* Poster Card */}
            <div
                className="relative aspect-[2/3] overflow-hidden rounded-xl shadow-xl"
                style={{ background: "var(--color-surface-elevated)" }}
            >
                {session.poster && !imageError ? (
                    <>
                        <img
                            alt={session.itemName}
                            className="h-full w-full object-cover transition-all duration-700 group-hover:scale-110"
                            onError={() => setImageError(true)}
                            src={session.poster}
                        />
                        {/* Gradient overlay */}
                        <div className="absolute inset-0 bg-gradient-to-t from-black/50 to-transparent opacity-40 transition-opacity group-hover:opacity-60" />
                    </>
                ) : (
                    <div className="flex h-full w-full items-center justify-center">
                        {session.itemType === "movie" ? (
                            <FilmIcon
                                className="h-12 w-12"
                                style={{ color: "var(--color-text-subtle)" }}
                            />
                        ) : (
                            <TvIcon
                                className="h-12 w-12"
                                style={{ color: "var(--color-text-subtle)" }}
                            />
                        )}
                    </div>
                )}

                {/* Session duration badge - top left */}
                {!session.isSynthetic &&
                    session.durationSeconds !== undefined &&
                    session.durationSeconds > 0 && (
                        <div className="absolute top-2 left-2">
                            <div
                                className="rounded-md px-2 py-1 font-medium text-xs shadow-lg"
                                style={{
                                    background: "var(--color-primary-muted)",
                                    color: "var(--color-primary)",
                                }}
                            >
                                {formatDuration(session.durationSeconds)}
                            </div>
                        </div>
                    )}
            </div>

            {/* Content Info - Below the poster */}
            <div className="mt-2 space-y-0.5 text-center">
                {/* Content title */}
                <button
                    className="block w-full"
                    onClick={() => onFilterByContent?.(session.itemName)}
                    type="button"
                >
                    <h4
                        className="line-clamp-2 font-semibold text-sm leading-tight"
                        style={{ color: "var(--color-text-muted)" }}
                    >
                        {session.itemName}
                    </h4>
                </button>

                {/* Episode info for series */}
                {session.itemType === "series" &&
                    session.episode !== undefined &&
                    session.episode > 0 && (
                        <p
                            className="font-medium text-xs"
                            style={{ color: "var(--color-text-subtle)" }}
                        >
                            {session.season !== undefined && session.season > 0
                                ? `Season ${session.season}, `
                                : ""}
                            Episode {session.episode}
                        </p>
                    )}

                {/* Timestamp */}
                <div
                    className="flex items-center justify-center text-xs"
                    style={{ color: "var(--color-text-subtle)" }}
                >
                    <span>
                        {timestamp
                            .toLocaleDateString("en-GB", {
                                day: "2-digit",
                                month: "short",
                                year: "numeric",
                            })
                            .replace(/ /g, " ")}{" "}
                        {formatTime(timestamp)}
                    </span>
                </div>
            </div>
        </motion.div>
    );
});

export default function UserActivityPage() {
    const { userId, userInfo, provider } = useUserAuth();
    const providerLabel = providerTypeLabel(provider);
    const { authKey, isReady } = useUserAuthHeaders();
    const [activityData, setActivityData] = useState<UserActivityData | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [searchQuery, setSearchQuery] = useState("");
    const [viewMode, setViewMode] = useState<"list" | "grid">("list");
    const [isLoaded, setIsLoaded] = useState(false);
    const [nowTick, setNowTick] = useState(Date.now());

    // Load view mode preference
    useEffect(() => {
        const saved = localStorage.getItem("user-activity-view-mode");
        if (saved === "list" || saved === "grid") {
            setViewMode(saved);
        }
        setIsLoaded(true);
    }, []);

    // Save view mode preference
    useEffect(() => {
        if (isLoaded) {
            localStorage.setItem("user-activity-view-mode", viewMode);
        }
    }, [viewMode, isLoaded]);

    // Fetch activity data with polling
    useEffect(() => {
        if (!(isReady && userId)) {
            return;
        }

        const fetchData = async (isPolling = false) => {
            // Only show loading on initial fetch
            if (!isPolling) {
                setLoading(true);
            }
            setError(null);
            try {
                const result = await userActivity.getActivity(userId, authKey || undefined, 200);
                setActivityData(result);
            } catch (err) {
                console.error("Failed to load activity data:", err);
                // Only set error if we don't have data yet
                if (!isPolling) {
                    setError(readErrorMessage(err, "Failed to load activity"));
                }
            } finally {
                if (!isPolling) {
                    setLoading(false);
                }
            }
        };

        fetchData(false);

        // Every 30 seconds while the tab is on screen; not at all while hidden.
        return startAdaptivePoll(() => fetchData(true), 30_000, 120_000);
    }, [userId, authKey, isReady]);

    // Filter sessions by search
    const filteredSessions = useMemo(() => {
        if (!activityData?.sessions) {
            return [];
        }

        // Filter out active sessions (show only completed) and sessions with no duration
        let sessions = activityData.sessions.filter(
            (s) => !s.isActive && s.endTime && (s.durationSeconds || 0) > 0
        );

        if (searchQuery) {
            const query = searchQuery.toLowerCase();
            sessions = sessions.filter(
                (s) =>
                    s.itemName.toLowerCase().includes(query) ||
                    s.username.toLowerCase().includes(query)
            );
        }

        return sessions;
    }, [activityData, searchQuery]);

    // Group sessions by date
    const groupedSessions = useMemo(() => {
        const groups = new Map<string, WatchSession[]>();

        for (const session of filteredSessions) {
            const dateKey = getDateKey(new Date(session.startTime));
            const bucket = groups.get(dateKey);
            if (bucket) {
                bucket.push(session);
            } else {
                groups.set(dateKey, [session]);
            }
        }

        const today = new Date();
        const todayKey = getDateKey(today);
        const yesterday = new Date(today);
        yesterday.setDate(yesterday.getDate() - 1);
        const yesterdayKey = getDateKey(yesterday);

        return Array.from(groups.entries())
            .sort(([a], [b]) => b.localeCompare(a))
            .map(([dateKey, sessions]) => {
                const totalDuration = sessions.reduce(
                    (sum, s) => sum + (s.durationSeconds || 0),
                    0
                );
                return {
                    dateKey,
                    isToday: dateKey === todayKey,
                    isYesterday: dateKey === yesterdayKey,
                    label: formatDateHeader(dateKey),
                    sessions,
                    totalDuration,
                };
            });
    }, [filteredSessions]);

    // Stats from API
    const stats = activityData?.stats;
    const chartData = activityData?.watchTimeByDay || [];
    const nowPlaying = activityData?.nowPlaying || [];

    // Advances the "Watching for" counters and the live watch-time total.
    // Every fifteen seconds, only while something is playing, never while the
    // tab is hidden - it used to be once a second for the life of the page,
    // and each tick re-rendered the whole activity list.
    const hasLivePlayback = nowPlaying.length > 0;
    useEffect(() => {
        if (!hasLivePlayback) {
            return;
        }
        const id = setInterval(() => {
            if (document.visibilityState === "visible") {
                setNowTick(Date.now());
            }
        }, 15_000);
        return () => clearInterval(id);
    }, [hasLivePlayback]);

    // Live total watch time: completed sessions + elapsed now-playing time
    const liveTotalWatchTimeHours = useMemo(() => {
        let totalSeconds = stats?.totalWatchTimeSeconds || 0;
        for (const np of nowPlaying) {
            if (np.startTime) {
                const startMs = new Date(np.startTime).getTime();
                if (!Number.isNaN(startMs)) {
                    totalSeconds += Math.max(0, (nowTick - startMs) / 1000);
                }
            }
        }
        return totalSeconds / 3600;
    }, [stats, nowPlaying, nowTick]);

    const handleFilterByContent = useCallback((name: string) => {
        setSearchQuery(name);
    }, []);

    return (
        <div className="p-4 sm:p-8">
            <UserPageHeader subtitle="Your watch history and statistics" title="Activity" />

            {/* Loading */}
            {loading && (
                <div className="flex items-center justify-center py-20">
                    <div
                        className="h-8 w-8 animate-spin rounded-full border-2 border-t-transparent"
                        style={{
                            borderColor: "var(--color-primary)",
                            borderTopColor: "transparent",
                        }}
                    />
                </div>
            )}

            {/* Error */}
            {error && (
                <motion.div
                    animate={{ opacity: 1 }}
                    className="mb-6 rounded-xl p-4 text-center"
                    initial={{ opacity: 0 }}
                    style={{
                        background: "var(--color-error-muted)",
                        color: "var(--color-error)",
                    }}
                >
                    {error}
                </motion.div>
            )}

            {!(loading || error) && (
                <>
                    {/* Stats Cards */}
                    <div className="mb-8 grid grid-cols-2 gap-4 lg:grid-cols-4">
                        <StatCard
                            color="var(--color-primary)"
                            delay={0}
                            icon={<ClockIcon className="h-5 w-5" />}
                            label="Total Watch Time"
                            value={formatHours(liveTotalWatchTimeHours)}
                        />
                        <StatCard
                            color="#8b5cf6"
                            delay={0.05}
                            icon={<FilmIcon className="h-5 w-5" />}
                            label="Movies Watched"
                            value={stats?.moviesCount || 0}
                        />
                        <StatCard
                            color="#10b981"
                            delay={0.1}
                            icon={<TvIcon className="h-5 w-5" />}
                            label="Series Watching"
                            value={stats?.seriesCount || 0}
                        />
                        <StatCard
                            color="#f59e0b"
                            delay={0.15}
                            icon={<CheckCircleIcon className="h-5 w-5" />}
                            label="Watched Today"
                            value={stats?.watchedTodayCount || 0}
                        />
                    </div>

                    {/* Now Playing Section */}
                    {nowPlaying.length > 0 && (
                        <motion.div
                            animate={{ opacity: 1, y: 0 }}
                            className="mb-6"
                            initial={{ opacity: 0, y: 20 }}
                        >
                            <Card className="border-2 border-primary/30 bg-primary/5" padding="md">
                                <div className="mb-4 flex items-center justify-between">
                                    <div className="flex items-center gap-3">
                                        <div className="flex items-center justify-center rounded-full bg-primary/10 p-2">
                                            <div className="h-2.5 w-2.5 animate-pulse rounded-full bg-primary" />
                                        </div>
                                        <h2 className="font-display font-semibold text-default text-lg">
                                            Now Playing
                                        </h2>
                                    </div>
                                    <div className="flex items-center gap-2 text-muted text-xs">
                                        <div className="h-2 w-2 animate-pulse rounded-full bg-primary" />
                                        <span>Live</span>
                                    </div>
                                </div>
                                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                                    {nowPlaying.map((np, idx) => (
                                        <motion.div
                                            className="flex items-center gap-3 rounded-xl border border-default bg-surface-hover p-3 transition-colors hover:border-primary/50 hover:bg-surface"
                                            key={`now-${idx}`}
                                        >
                                            {/* Poster */}
                                            {np.item.poster ? (
                                                <div className="h-14 w-10 shrink-0 overflow-hidden rounded-lg bg-surface-hover">
                                                    <img
                                                        alt={np.item.name}
                                                        className="h-full w-full object-cover"
                                                        src={np.item.poster}
                                                    />
                                                </div>
                                            ) : (
                                                <div className="flex h-14 w-10 shrink-0 items-center justify-center rounded-lg bg-surface-hover">
                                                    {np.item.type === "movie" ? (
                                                        <FilmIcon className="h-5 w-5 text-muted" />
                                                    ) : (
                                                        <TvIcon className="h-5 w-5 text-muted" />
                                                    )}
                                                </div>
                                            )}
                                            <div className="min-w-0 flex-1">
                                                <p className="truncate font-medium text-default text-sm">
                                                    {np.item.name}
                                                </p>
                                                <div className="truncate text-muted text-xs">
                                                    {np.item.type === "series" &&
                                                    np.item.episode !== undefined &&
                                                    np.item.episode > 0 ? (
                                                        <span>
                                                            {np.item.season !== undefined &&
                                                            np.item.season > 0
                                                                ? `S${String(np.item.season).padStart(2, "0")}E`
                                                                : "E"}
                                                            {String(np.item.episode).padStart(
                                                                2,
                                                                "0"
                                                            )}
                                                        </span>
                                                    ) : (
                                                        <span className="capitalize">
                                                            {np.item.type}
                                                        </span>
                                                    )}
                                                </div>
                                                {/* Live duration calculation */}
                                                {(() => {
                                                    if (np.startTime) {
                                                        const startMs = new Date(
                                                            np.startTime
                                                        ).getTime();
                                                        if (!Number.isNaN(startMs)) {
                                                            const elapsedSeconds = Math.max(
                                                                0,
                                                                Math.floor(
                                                                    (nowTick - startMs) / 1000
                                                                )
                                                            );
                                                            if (elapsedSeconds > 0) {
                                                                return (
                                                                    <p className="mt-0.5 text-subtle text-xs">
                                                                        Watching for{" "}
                                                                        {formatDuration(
                                                                            elapsedSeconds
                                                                        )}
                                                                    </p>
                                                                );
                                                            }
                                                        }
                                                    }
                                                    return null;
                                                })()}
                                            </div>
                                        </motion.div>
                                    ))}
                                </div>
                            </Card>{" "}
                        </motion.div>
                    )}

                    {/* Charts */}
                    <div className="mb-8 grid grid-cols-1 gap-6 lg:grid-cols-2">
                        <WatchTimeChart data={chartData} />
                        <ContentBreakdownChart data={chartData} />
                    </div>

                    {/* Search and View Toggle */}
                    <motion.div
                        animate={{ opacity: 1, y: 0 }}
                        className="mb-6 flex items-center justify-between gap-4"
                        initial={{ opacity: 0, y: 20 }}
                        transition={{ delay: 0.25 }}
                    >
                        <div className="relative flex-1" style={{ maxWidth: "384px" }}>
                            <MagnifyingGlassIcon
                                className="absolute top-1/2 left-3 h-5 w-5 -translate-y-1/2"
                                style={{ color: "var(--color-text-muted)" }}
                            />
                            <input
                                className="w-full rounded-xl py-2.5 pr-4 pl-10 text-sm"
                                onChange={(e) => setSearchQuery(e.target.value)}
                                placeholder="Search content..."
                                style={{
                                    background: "var(--color-surface)",
                                    border: "1px solid var(--color-surface-border)",
                                    color: "var(--color-text)",
                                }}
                                type="text"
                                value={searchQuery}
                            />
                        </div>
                        <ViewModeToggle mode={viewMode} onChange={(mode) => setViewMode(mode)} />
                    </motion.div>

                    {/* Activity Feed - Grouped by Date */}
                    <div className="space-y-6">
                        {groupedSessions.map((group, groupIndex) => (
                            <motion.div
                                animate={{ opacity: 1, y: 0 }}
                                initial={{ opacity: 0, y: 20 }}
                                key={group.dateKey}
                                transition={{ delay: 0.3 + groupIndex * 0.02 }}
                            >
                                <div className="mb-4 flex items-center gap-3">
                                    <CalendarIcon
                                        className="h-5 w-5"
                                        style={{
                                            color: group.isToday
                                                ? "#10b981"
                                                : group.isYesterday
                                                  ? "var(--color-text-muted)"
                                                  : "var(--color-text-subtle)",
                                        }}
                                    />
                                    <div className="flex items-baseline gap-2">
                                        <h2
                                            className="font-semibold text-lg"
                                            style={{ color: "var(--color-text)" }}
                                        >
                                            {group.label}
                                        </h2>
                                        <span
                                            className="text-sm"
                                            style={{ color: "var(--color-text-muted)" }}
                                        >
                                            • {formatHours(group.totalDuration / 3600)}
                                            <span className="ml-1 opacity-70">
                                                ({group.sessions.length})
                                            </span>
                                        </span>
                                    </div>
                                </div>

                                {viewMode === "grid" ? (
                                    <div className="grid grid-cols-3 gap-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 xl:grid-cols-7">
                                        {group.sessions.map((session) => (
                                            <ActivityCardGrid
                                                key={session.id}
                                                onFilterByContent={handleFilterByContent}
                                                session={session}
                                            />
                                        ))}
                                    </div>
                                ) : (
                                    <div className="space-y-3">
                                        {group.sessions.map((session) => (
                                            <ActivityCard
                                                key={session.id}
                                                onFilterByContent={handleFilterByContent}
                                                session={session}
                                                userInfo={userInfo}
                                            />
                                        ))}
                                    </div>
                                )}
                            </motion.div>
                        ))}

                        {/* Empty state */}
                        {filteredSessions.length === 0 && (
                            <motion.div
                                animate={{ opacity: 1, y: 0 }}
                                className="rounded-xl py-16 text-center"
                                initial={{ opacity: 0, y: 20 }}
                                style={{
                                    background: "var(--color-surface)",
                                    border: "1px solid var(--color-surface-border)",
                                }}
                            >
                                <ClockIcon
                                    className="mx-auto mb-4 h-16 w-16"
                                    style={{ color: "var(--color-text-subtle)" }}
                                />
                                <h3
                                    className="mb-2 font-semibold text-lg"
                                    style={{ color: "var(--color-text)" }}
                                >
                                    {searchQuery ? "No matching activity" : "No activity yet"}
                                </h3>
                                <p style={{ color: "var(--color-text-muted)" }}>
                                    {searchQuery
                                        ? `No activity matches "${searchQuery}". Try a different search term.`
                                        : `Start watching content on ${providerLabel} to see activity here`}
                                </p>
                            </motion.div>
                        )}
                    </div>
                </>
            )}
        </div>
    );
}
