"use client";

import {
    ArrowPathIcon,
    CheckCircleIcon,
    ClockIcon,
    ExclamationCircleIcon,
    ExclamationTriangleIcon,
    FilmIcon,
    FireIcon,
    PauseCircleIcon as PausedIcon,
    MoonIcon as PausedMoonIcon,
    PlayIcon,
    TrophyIcon,
    TvIcon,
} from "@heroicons/react/24/outline";
import { motion } from "framer-motion";
import { useEffect, useState } from "react";
import { Avatar } from "@/components/ui";
import { PersonalCalendar } from "@/components/user/PersonalCalendar";
import { PersonalContinueWatching } from "@/components/user/PersonalContinueWatching";
import { usePersonalPreferences } from "@/components/user/PersonalPreferences";
import { UserPageHeader } from "@/components/user/UserPageContainer";
import { readErrorMessage } from "@/lib/errors";
import { useUserAuth, useUserAuthHeaders } from "@/lib/hooks/useUserAuth";
import { providerTypeLabel } from "@/lib/providers";
import {
    type AtRiskStatus,
    getOwnScreenTime,
    type UserActivityData,
    userActivity,
    userSync,
} from "@/lib/user-api";

// Format watch time from seconds to human-readable
function formatWatchTime(seconds: number): string {
    if (seconds < 60) {
        return "<1m";
    }
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.round((seconds % 3600) / 60);

    if (hours > 0) {
        return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`;
    }
    return `${minutes}m`;
}

// Format duration in a more compact way for stats
function formatDuration(seconds: number): string {
    if (seconds < 60) {
        return "<1m";
    }
    if (seconds < 3600) {
        return `${Math.round(seconds / 60)}m`;
    }
    const hours = Math.floor(seconds / 3600);
    const mins = Math.round((seconds % 3600) / 60);
    return mins > 0 ? `${hours}h ${mins}m` : `${hours}h`;
}

// Stat Card Component
interface StatCardProps {
    color?: string;
    delay?: number;
    icon: React.ReactNode;
    label: string;
    value: string | number;
}

function StatCard({
    label,
    value,
    icon,
    color = "var(--color-primary)",
    delay = 0,
}: StatCardProps) {
    return (
        <motion.div
            animate={{ opacity: 1, y: 0 }}
            className="rounded-xl p-4"
            initial={{ opacity: 0, y: 20 }}
            style={{
                background: "var(--color-surface)",
                border: "1px solid var(--color-surface-border)",
            }}
            transition={{ delay }}
        >
            <div className="flex items-center gap-3">
                <div
                    className="flex h-10 w-10 items-center justify-center rounded-lg"
                    style={{ background: `color-mix(in srgb, ${color} 14%, transparent)`, color }}
                >
                    {icon}
                </div>
                <div>
                    <p className="font-bold text-2xl" style={{ color: "var(--color-text)" }}>
                        {value}
                    </p>
                    <p className="text-xs" style={{ color: "var(--color-text-muted)" }}>
                        {label}
                    </p>
                </div>
            </div>
        </motion.div>
    );
}

export default function UserHomePage() {
    const { preferences } = usePersonalPreferences();
    const { userId, userInfo, provider } = useUserAuth();
    const providerLabel = providerTypeLabel(provider);
    const { authKey, isReady } = useUserAuthHeaders();
    // Paused by a daily limit or bedtime: said at the top, so an empty stream
    // list in their app has its reason here. Looked at again every minute.
    const [paused, setPaused] = useState<{
        untilLabel: string;
        reason: "limit" | "bedtime";
    } | null>(null);
    useEffect(() => {
        if (!(isReady && userId && authKey)) {
            return;
        }
        let stopped = false;
        const look = () =>
            getOwnScreenTime(userId, authKey)
                .then((r) => {
                    if (!stopped) {
                        setPaused(r.paused);
                    }
                })
                .catch(() => undefined);
        look();
        const timer = setInterval(look, 60 * 1000);
        return () => {
            stopped = true;
            clearInterval(timer);
        };
    }, [userId, authKey, isReady]);

    const [activityData, setActivityData] = useState<UserActivityData | null>(null);
    const [atRiskStatus, setAtRiskStatus] = useState<AtRiskStatus | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [syncing, setSyncing] = useState(false);
    const [syncMessage, setSyncMessage] = useState<string | null>(null);

    // Fetch activity data and at-risk status
    useEffect(() => {
        if (!(isReady && userId)) {
            return;
        }

        const fetchData = async () => {
            setLoading(true);
            setError(null);
            try {
                // Fetch activity and risk status in parallel, but handle failures gracefully
                const [activityResult, riskResult] = await Promise.allSettled([
                    userActivity.getActivity(userId, authKey || undefined),
                    userSync.getAtRiskStatus(userId, authKey || undefined),
                ]);

                if (activityResult.status === "fulfilled") {
                    setActivityData(activityResult.value);
                } else {
                    console.error("Failed to load activity:", activityResult.reason);
                    // Set error only if activity fails - this is the main data
                    setError(activityResult.reason?.message || "Failed to load activity data");
                }

                if (riskResult.status === "fulfilled") {
                    setAtRiskStatus(riskResult.value);
                } else {
                    console.error("Failed to load risk status:", riskResult.reason);
                    // Don't set error for risk status - it's optional
                }
            } catch (err) {
                console.error("Failed to load data:", err);
                setError(readErrorMessage(err, "Failed to load data"));
            } finally {
                setLoading(false);
            }
        };

        fetchData();
    }, [userId, authKey, isReady]);

    // Handle sync
    const handleSync = async () => {
        if (!userId || syncing) {
            return;
        }

        setSyncing(true);
        setSyncMessage(null);
        try {
            const result = await userSync.sync(userId, authKey || undefined);
            setSyncMessage(result.success ? "Sync completed!" : result.message || "Sync failed");

            // Refresh at-risk status after sync
            const riskStatus = await userSync.getAtRiskStatus(userId, authKey || undefined);
            setAtRiskStatus(riskStatus);
        } catch (err) {
            setSyncMessage(readErrorMessage(err, "Sync failed"));
        } finally {
            setSyncing(false);
            // Clear message after 3 seconds
            setTimeout(() => setSyncMessage(null), 3000);
        }
    };

    // Get risk badge color and icon
    const getRiskBadge = () => {
        if (!atRiskStatus) {
            return null;
        }

        if (atRiskStatus.riskLevel === "critical") {
            return {
                bg: "var(--color-error-muted)",
                color: "var(--color-error)",
                icon: <ExclamationCircleIcon className="h-4 w-4" />,
                text: "At Risk",
            };
        }
        if (atRiskStatus.riskLevel === "warning") {
            return {
                bg: "var(--color-warning-muted)",
                color: "var(--color-warning)",
                icon: <ExclamationTriangleIcon className="h-4 w-4" />,
                text: "Warning",
            };
        }
        return {
            bg: "var(--color-success-muted)",
            color: "var(--color-success)",
            icon: <CheckCircleIcon className="h-4 w-4" />,
            text: "Healthy",
        };
    };

    const riskBadge = getRiskBadge();
    const stats = activityData?.stats;

    return (
        <div className="p-4 sm:p-8">
            <UserPageHeader
                subtitle="Your library, your activity, and what’s next."
                title={`Hello, ${userInfo?.username || "User"}.`}
            />

            {/* Profile Card with Sync Button and Risk Badge */}
            <motion.div
                animate={{ opacity: 1, y: 0 }}
                className="mb-8 rounded-xl p-4 sm:p-6"
                initial={{ opacity: 0, y: 20 }}
                style={{
                    background: "var(--color-surface)",
                    border: "1px solid var(--color-surface-border)",
                }}
            >
                {/* Picture and name share a line; on a phone Sync goes underneath
            rather than squeezing the picture into a pill. */}
                <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:gap-6">
                    <div className="flex min-w-0 flex-1 items-center gap-4 sm:gap-6">
                        <Avatar
                            className="h-16 w-16 shrink-0 sm:h-20 sm:w-20"
                            colorIndex={userInfo?.colorIndex || 0}
                            email={preferences.hideSensitive ? "Hidden" : userInfo?.email}
                            name={userInfo?.username || "User"}
                            showRing
                            size="xl"
                            src={userInfo?.avatarUrl || undefined}
                            useGravatar={userInfo?.useGravatar}
                        />
                        <div className="min-w-0 flex-1">
                            <div className="mb-1 flex flex-wrap items-center gap-x-3 gap-y-1">
                                <h2
                                    className="break-words font-bold text-xl"
                                    style={{ color: "var(--color-text)" }}
                                >
                                    {userInfo?.username}
                                </h2>

                                {/* Risk Badge */}
                                {riskBadge && (
                                    <div
                                        className="flex items-center gap-1.5 rounded-full px-2.5 py-1 font-medium text-xs"
                                        style={{ background: riskBadge.bg, color: riskBadge.color }}
                                        title={atRiskStatus?.riskReason || undefined}
                                    >
                                        {riskBadge.icon}
                                        <span>{riskBadge.text}</span>
                                    </div>
                                )}
                            </div>
                            <p
                                className="truncate text-sm"
                                style={{ color: "var(--color-text-muted)" }}
                            >
                                {preferences.hideSensitive ? "Hidden" : userInfo?.email}
                            </p>
                            {!preferences.hideSensitive && userInfo?.groupName && (
                                <p
                                    className="mt-1 text-sm"
                                    style={{ color: "var(--color-text-subtle)" }}
                                >
                                    Group: {userInfo.groupName}
                                </p>
                            )}
                        </div>
                    </div>

                    {/* Sync Button */}
                    <div className="flex shrink-0 flex-row-reverse items-center justify-between gap-2 sm:flex-col sm:items-end">
                        <button
                            className="flex items-center gap-2 whitespace-nowrap rounded-lg px-4 py-2 font-medium transition-all hover:opacity-90 disabled:opacity-50"
                            disabled={syncing}
                            onClick={handleSync}
                            style={{
                                background: "var(--color-primary)",
                                color: "white",
                            }}
                            type="button"
                        >
                            <ArrowPathIcon className={`h-5 w-5 ${syncing ? "animate-spin" : ""}`} />
                            <span>{syncing ? "Syncing..." : "Sync Now"}</span>
                        </button>
                        {syncMessage && (
                            <motion.p
                                animate={{ opacity: 1 }}
                                className={`text-xs ${syncMessage.includes("completed") ? "text-success" : "text-error"}`}
                                initial={{ opacity: 0 }}
                            >
                                {syncMessage}
                            </motion.p>
                        )}
                        {atRiskStatus?.lastSyncedAt && (
                            <p className="text-xs" style={{ color: "var(--color-text-subtle)" }}>
                                Last sync: {new Date(atRiskStatus.lastSyncedAt).toLocaleString()}
                            </p>
                        )}
                    </div>
                </div>
            </motion.div>

            {/* Loading State */}
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

            {/* Error State */}
            {!loading && error && (
                <motion.div
                    animate={{ opacity: 1, y: 0 }}
                    className="rounded-xl p-6 text-center"
                    initial={{ opacity: 0, y: 20 }}
                    style={{
                        background: "var(--color-error-muted)",
                        border: "1px solid var(--color-error)",
                    }}
                >
                    <ExclamationCircleIcon
                        className="mx-auto mb-3 h-12 w-12"
                        style={{ color: "var(--color-error)" }}
                    />
                    <h3
                        className="mb-2 font-semibold text-lg"
                        style={{ color: "var(--color-error)" }}
                    >
                        Failed to load activity data
                    </h3>
                    <p className="mb-4 text-sm" style={{ color: "var(--color-text-muted)" }}>
                        {error}
                    </p>
                    <button
                        className="rounded-lg px-4 py-2 font-medium transition-all hover:opacity-90"
                        onClick={() => window.location.reload()}
                        style={{
                            background: "var(--color-primary)",
                            color: "white",
                        }}
                        type="button"
                    >
                        Try Again
                    </button>
                </motion.div>
            )}

            {paused && (
                <div
                    className="mb-6 flex items-center gap-3 rounded-xl border border-warning/40 px-4 py-3"
                    role="status"
                    style={{ background: "var(--color-warning-muted)" }}
                >
                    {paused.reason === "bedtime" ? (
                        <PausedMoonIcon className="h-5 w-5 shrink-0 text-warning" />
                    ) : (
                        <PausedIcon className="h-5 w-5 shrink-0 text-warning" />
                    )}
                    <p className="min-w-0 text-sm text-warning">
                        {paused.reason === "bedtime"
                            ? `Bedtime - streaming is back at ${paused.untilLabel}.`
                            : `That's today's watching - streaming is back at ${paused.untilLabel}.`}
                    </p>
                </div>
            )}

            <PersonalContinueWatching />
            <PersonalCalendar />

            {/* Stats Grid */}
            {!(loading || error) && stats && (
                <>
                    {/* Now Playing - first, above today's numbers: what is on right now is
              what someone opens this page to see, and at the bottom it sat
              below a phone's whole screen of stat cards. Only there while
              something plays. */}
                    {activityData?.nowPlaying && activityData.nowPlaying.length > 0 && (
                        <motion.div
                            animate={{ opacity: 1, y: 0 }}
                            className="mb-8 rounded-xl p-5"
                            initial={{ opacity: 0, y: 20 }}
                            style={{
                                background: "var(--color-surface)",
                                border: "2px solid var(--color-secondary)",
                            }}
                            transition={{ delay: 0.05 }}
                        >
                            <div className="mb-4 flex items-center gap-2">
                                <div className="h-2.5 w-2.5 animate-pulse rounded-full bg-green-500" />
                                <h3
                                    className="font-semibold"
                                    style={{ color: "var(--color-text)" }}
                                >
                                    Now Playing
                                </h3>
                            </div>
                            <div className="grid gap-3 sm:grid-cols-2">
                                {activityData.nowPlaying.map((np, index) => (
                                    <div
                                        className="flex items-center gap-3 rounded-lg p-3"
                                        key={index}
                                        style={{ background: "var(--color-surface-elevated)" }}
                                    >
                                        {np.item.poster ? (
                                            <img
                                                alt={np.item.name}
                                                className="h-14 w-10 rounded object-cover"
                                                src={np.item.poster}
                                            />
                                        ) : (
                                            <div
                                                className="flex h-14 w-10 items-center justify-center rounded"
                                                style={{ background: "var(--color-surface)" }}
                                            >
                                                {np.item.type === "movie" ? (
                                                    <FilmIcon
                                                        className="h-5 w-5"
                                                        style={{
                                                            color: "var(--color-text-subtle)",
                                                        }}
                                                    />
                                                ) : (
                                                    <TvIcon
                                                        className="h-5 w-5"
                                                        style={{
                                                            color: "var(--color-text-subtle)",
                                                        }}
                                                    />
                                                )}
                                            </div>
                                        )}
                                        <div className="min-w-0 flex-1">
                                            <p
                                                className="truncate font-medium text-sm"
                                                style={{ color: "var(--color-text)" }}
                                            >
                                                {np.item.name}
                                            </p>
                                            {np.item.type === "series" && np.item.episode && (
                                                <p
                                                    className="text-xs"
                                                    style={{ color: "var(--color-text-muted)" }}
                                                >
                                                    {np.item.season
                                                        ? `S${np.item.season}E${np.item.episode}`
                                                        : `E${np.item.episode}`}
                                                </p>
                                            )}
                                        </div>
                                        <div className="h-2 w-2 animate-pulse rounded-full bg-green-500" />
                                    </div>
                                ))}
                            </div>
                        </motion.div>
                    )}

                    <motion.h3
                        animate={{ opacity: 1 }}
                        className="mb-4 font-semibold text-lg"
                        initial={{ opacity: 0 }}
                        style={{ color: "var(--color-text)" }}
                        transition={{ delay: 0.1 }}
                    >
                        Today's Activity
                    </motion.h3>

                    <div className="mb-8 grid grid-cols-2 gap-4 md:grid-cols-4">
                        <StatCard
                            color="var(--color-primary)"
                            delay={0.15}
                            icon={<ClockIcon className="h-5 w-5" />}
                            label="Watch Time Today"
                            value={formatWatchTime(stats.watchTimeTodaySeconds)}
                        />
                        <StatCard
                            color="#3b82f6"
                            delay={0.2}
                            icon={<PlayIcon className="h-5 w-5" />}
                            label="Watched Today"
                            value={stats.watchedTodayCount}
                        />
                        <StatCard
                            color="#f59e0b"
                            delay={0.25}
                            icon={<FireIcon className="h-5 w-5" />}
                            label="Current Streak"
                            value={`${stats.currentStreak} ${stats.currentStreak === 1 ? "day" : "days"}`}
                        />
                        <StatCard
                            color="#10b981"
                            delay={0.3}
                            icon={<ClockIcon className="h-5 w-5" />}
                            label="Avg Watch Time"
                            value={formatWatchTime(stats.avgWatchTimeSeconds)}
                        />
                    </div>

                    <motion.h3
                        animate={{ opacity: 1 }}
                        className="mb-4 font-semibold text-lg"
                        initial={{ opacity: 0 }}
                        style={{ color: "var(--color-text)" }}
                        transition={{ delay: 0.35 }}
                    >
                        All Time Stats
                    </motion.h3>

                    <div className="mb-8 grid grid-cols-2 gap-4 md:grid-cols-4">
                        <StatCard
                            color="#8b5cf6"
                            delay={0.4}
                            icon={<ClockIcon className="h-5 w-5" />}
                            label="Total Watch Time"
                            value={formatWatchTime(stats.totalWatchTimeSeconds)}
                        />
                        <StatCard
                            color="#ec4899"
                            delay={0.45}
                            icon={<FilmIcon className="h-5 w-5" />}
                            label="Movies Watched"
                            value={stats.moviesCount}
                        />
                        <StatCard
                            color="#14b8a6"
                            delay={0.5}
                            icon={<TvIcon className="h-5 w-5" />}
                            label="Series Watched"
                            value={stats.seriesCount}
                        />
                        <StatCard
                            color="#f59e0b"
                            delay={0.55}
                            icon={<TrophyIcon className="h-5 w-5" />}
                            label="Longest Streak"
                            value={`${stats.longestStreak} ${stats.longestStreak === 1 ? "day" : "days"}`}
                        />
                    </div>

                    {/* Most Watched & Binge Watches */}
                    <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
                        {/* Most Watched */}
                        {activityData?.mostWatched && (
                            <motion.div
                                animate={{ opacity: 1, y: 0 }}
                                className="rounded-xl p-5"
                                initial={{ opacity: 0, y: 20 }}
                                style={{
                                    background: "var(--color-surface)",
                                    border: "1px solid var(--color-surface-border)",
                                }}
                                transition={{ delay: 0.6 }}
                            >
                                <div className="mb-4 flex items-center gap-2">
                                    <TrophyIcon
                                        className="h-5 w-5"
                                        style={{ color: "var(--color-warning)" }}
                                    />
                                    <h3
                                        className="font-semibold"
                                        style={{ color: "var(--color-text)" }}
                                    >
                                        Most Watched
                                    </h3>
                                </div>
                                <div className="flex items-center gap-4">
                                    {activityData.mostWatched.poster ? (
                                        <img
                                            alt={activityData.mostWatched.name}
                                            className="h-24 w-16 rounded-lg object-cover"
                                            src={activityData.mostWatched.poster}
                                        />
                                    ) : (
                                        <div
                                            className="flex h-24 w-16 items-center justify-center rounded-lg"
                                            style={{ background: "var(--color-surface-elevated)" }}
                                        >
                                            {activityData.mostWatched.type === "movie" ? (
                                                <FilmIcon
                                                    className="h-8 w-8"
                                                    style={{ color: "var(--color-text-subtle)" }}
                                                />
                                            ) : (
                                                <TvIcon
                                                    className="h-8 w-8"
                                                    style={{ color: "var(--color-text-subtle)" }}
                                                />
                                            )}
                                        </div>
                                    )}
                                    <div>
                                        <p
                                            className="font-medium"
                                            style={{ color: "var(--color-text)" }}
                                        >
                                            {activityData.mostWatched.name}
                                        </p>
                                        <p
                                            className="mt-1 text-sm"
                                            style={{ color: "var(--color-text-muted)" }}
                                        >
                                            {activityData.mostWatched.count}{" "}
                                            {activityData.mostWatched.count === 1
                                                ? "session"
                                                : "sessions"}
                                        </p>
                                        <p
                                            className="text-sm"
                                            style={{ color: "var(--color-text-muted)" }}
                                        >
                                            {formatDuration(activityData.mostWatched.totalDuration)}{" "}
                                            total
                                        </p>
                                    </div>
                                </div>
                            </motion.div>
                        )}

                        {/* Binge Watches */}
                        {activityData?.bingeWatches && activityData.bingeWatches.length > 0 && (
                            <motion.div
                                animate={{ opacity: 1, y: 0 }}
                                className="rounded-xl p-5"
                                initial={{ opacity: 0, y: 20 }}
                                style={{
                                    background: "var(--color-surface)",
                                    border: "1px solid var(--color-surface-border)",
                                }}
                                transition={{ delay: 0.65 }}
                            >
                                <div className="mb-4 flex items-center gap-2">
                                    <FireIcon
                                        className="h-5 w-5"
                                        style={{ color: "var(--color-error)" }}
                                    />
                                    <h3
                                        className="font-semibold"
                                        style={{ color: "var(--color-text)" }}
                                    >
                                        Recent Binge Watches
                                    </h3>
                                </div>
                                <div className="space-y-3">
                                    {activityData.bingeWatches.slice(0, 3).map((binge, index) => (
                                        <div className="flex items-center gap-3" key={index}>
                                            {binge.poster ? (
                                                <img
                                                    alt={binge.name}
                                                    className="h-14 w-10 rounded object-cover"
                                                    src={binge.poster}
                                                />
                                            ) : (
                                                <div
                                                    className="flex h-14 w-10 items-center justify-center rounded"
                                                    style={{
                                                        background: "var(--color-surface-elevated)",
                                                    }}
                                                >
                                                    <TvIcon
                                                        className="h-5 w-5"
                                                        style={{
                                                            color: "var(--color-text-subtle)",
                                                        }}
                                                    />
                                                </div>
                                            )}
                                            <div className="min-w-0 flex-1">
                                                <p
                                                    className="truncate font-medium text-sm"
                                                    style={{ color: "var(--color-text)" }}
                                                >
                                                    {binge.name}
                                                </p>
                                                <p
                                                    className="text-xs"
                                                    style={{ color: "var(--color-text-muted)" }}
                                                >
                                                    {binge.episodeCount} episodes in one day
                                                </p>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </motion.div>
                        )}
                    </div>
                </>
            )}

            {/* Empty state */}
            {!(loading || error || stats) && (
                <motion.div
                    animate={{ opacity: 1, y: 0 }}
                    className="py-20 text-center"
                    initial={{ opacity: 0, y: 20 }}
                >
                    <ClockIcon
                        className="mx-auto mb-4 h-16 w-16"
                        style={{ color: "var(--color-text-subtle)" }}
                    />
                    <h3
                        className="mb-2 font-semibold text-lg"
                        style={{ color: "var(--color-text)" }}
                    >
                        No activity data yet
                    </h3>
                    <p style={{ color: "var(--color-text-muted)" }}>
                        Start watching content on {providerLabel} to see your stats here
                    </p>
                </motion.div>
            )}
        </div>
    );
}
