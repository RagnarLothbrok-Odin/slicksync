"use client";

import type { DragEndEvent } from "@dnd-kit/core";
import { arrayMove } from "@dnd-kit/sortable";
import {
    ArrowPathIcon,
    Bars3Icon,
    CalendarIcon,
    ChartBarIcon,
    CheckIcon,
    ClockIcon,
    PencilIcon,
    PlusIcon,
    PuzzlePieceIcon,
    TrashIcon,
    UserMinusIcon,
    UserPlusIcon,
    UsersIcon,
    XMarkIcon,
} from "@heroicons/react/24/outline";
import { motion } from "framer-motion";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import React, { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
    Bar,
    BarChart,
    CartesianGrid,
    LabelList,
    Line,
    LineChart,
    ResponsiveContainer,
    Tooltip,
    XAxis,
    YAxis,
} from "recharts";
import { DetailToolbar } from "@/components/layout/DetailToolbar";
import { Breadcrumbs, Header } from "@/components/layout/Header";
import { PageSection, StaggerContainer, StaggerItem } from "@/components/layout/PageContainer";
import { AvatarPickerModal } from "@/components/modals/AvatarPickerModal";
import {
    Avatar,
    AvatarColorSwatches,
    AvatarGroup,
    Badge,
    Button,
    Card,
    ConfirmModal,
    InlineEdit,
    Input,
    Modal,
    ResourceBadge,
    SelectionCheckbox,
    SyncBadge,
    ToggleSwitch,
    UserAvatar,
    VersionBadge,
} from "@/components/ui";
import { DraggableList } from "@/components/ui/DragSortable";
import { toast } from "@/components/ui/Toast";
import { type Addon, api, type Group, type User } from "@/lib/api";
import { readErrorMessage } from "@/lib/errors";
import { useLastKnown } from "@/lib/hooks/useLastKnown";
import { useLayoutMode } from "@/lib/layout-mode";
import { displayEmail } from "@/lib/providers";
import { formatLastSync } from "@/lib/relativeTime";

// Chart color palette for users - theme-aware colors
const USER_COLORS = [
    "var(--color-chart-1)", // Primary chart color
    "var(--color-chart-2)", // Secondary chart color
    "#22d3ee", // cyan-400
    "#a78bfa", // violet-400
    "#fb923c", // orange-400
    "#4ade80", // green-400
    "#f472b6", // pink-400
    "#facc15", // yellow-400
    "#38bdf8", // sky-400
    "#c084fc", // purple-400
];

// Types for per-user watch time data
interface AggregatedWatchTimeData {
    date: string;
    [userId: string]: number | string; // userId -> minutes, plus 'date' string
}

interface AggregatedContentData {
    date: string;
    [key: string]: number | string; // 'date' + user movies/series keys
}

// Memoized tooltip style (same as UserDetailsPage)
const TOOLTIP_STYLE = {
    backdropFilter: "blur(12px)",
    backgroundColor: "rgba(30, 30, 56, 0.9)",
    border: "1px solid rgba(255,255,255,0.1)",
    borderRadius: "12px",
} as const;

const TOOLTIP_LABEL_STYLE = { color: "#fff" } as const;

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

// Group Watch Time Chart - shows per-user lines
const GroupWatchTimeChart = memo(function GroupWatchTimeChart({
    data,
    users,
}: {
    data: AggregatedWatchTimeData[];
    users: User[];
}) {
    // Get active users (those with data)
    const activeUsers = useMemo(() => {
        if (!data.length) {
            return [];
        }
        const firstEntry = data[0];
        return users.filter((u) => firstEntry[u.id] !== undefined && firstEntry[u.id] !== 0);
    }, [data, users]);

    // Calculate max minutes for Y-axis ticks
    const maxMinutes = useMemo(() => {
        if (!data.length) {
            return 60;
        }
        let max = 0;
        data.forEach((day) => {
            activeUsers.forEach((user) => {
                const minutes = day[user.id] as number;
                if (minutes > max) {
                    max = minutes;
                }
            });
        });
        return Math.max(max, 60);
    }, [data, activeUsers]);

    const hourTicks = Math.ceil(maxMinutes / 60);
    const ticks = Array.from({ length: hourTicks + 1 }, (_, i) => i * 60);

    if (activeUsers.length === 0 || data.length === 0) {
        return (
            <Card padding="lg">
                <div className="detail-section-header mb-6 flex items-center justify-between">
                    <h3 className="font-display font-semibold text-default text-lg">Watch Time</h3>
                </div>
                <div className="flex h-40 items-center justify-center text-muted md:h-64">
                    No watch time data available
                </div>
            </Card>
        );
    }

    return (
        <Card className="flex h-full flex-col" padding="lg">
            <div className="detail-section-header mb-6 flex items-center justify-between">
                <h3 className="font-display font-semibold text-default text-lg">
                    Watch Time by User
                </h3>
                <div className="flex items-center gap-2">
                    <span className="text-muted text-xs">Per-user activity</span>
                </div>
            </div>

            <div className="h-40 md:h-64">
                <ResponsiveContainer height="100%" width="100%">
                    <LineChart data={data} margin={{ bottom: 40 }}>
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
                            width={60}
                        />
                        <Tooltip
                            contentStyle={TOOLTIP_STYLE}
                            formatter={(value: any, name: any) => {
                                const user = users.find((u) => u.id === name);
                                return [
                                    formatMinutes(value),
                                    user?.username || user?.name || "Unknown",
                                ];
                            }}
                            labelStyle={TOOLTIP_LABEL_STYLE}
                        />
                        {activeUsers.map((user, index) => (
                            <Line
                                dataKey={user.id}
                                dot={false}
                                isAnimationActive={false}
                                key={user.id}
                                stroke={USER_COLORS[index % USER_COLORS.length]}
                                strokeWidth={2}
                                type="monotone"
                            />
                        ))}
                    </LineChart>
                </ResponsiveContainer>
            </div>

            {/* Legend */}
            <div className="mt-auto flex flex-wrap items-center justify-center gap-4 border-default border-t pt-4">
                {activeUsers.map((user, index) => (
                    <div className="flex items-center gap-2" key={user.id}>
                        <span
                            className="h-3 w-3 rounded-full"
                            style={{ backgroundColor: USER_COLORS[index % USER_COLORS.length] }}
                        />
                        <span className="truncate text-muted text-sm" style={{ maxWidth: "120px" }}>
                            {user.username || user.name || "Unknown"}
                        </span>
                    </div>
                ))}
            </div>
        </Card>
    );
});

// Custom label for diagonal user names under bars
const UserLabel = (props: any) => {
    const { x, width, y, height, userName } = props;
    // Calculate baseline y position (y + height is the bottom of the bar)
    // We want to position the text well below the date labels
    const baselineY = y + height;

    return (
        <text
            fill="#64748b" // text-muted
            fontSize={10}
            style={{ pointerEvents: "none" }}
            textAnchor="start"
            transform={`rotate(45, ${x + width / 2}, ${baselineY + 35})`}
            x={x + width / 2}
            y={baselineY + 35}
        >
            {userName}
        </text>
    );
};

// Group Content Breakdown Chart - grouped stacked bars by date per user
const GroupContentBreakdownChart = memo(function GroupContentBreakdownChart({
    data,
    users,
}: {
    data: AggregatedContentData[];
    users: User[];
}) {
    // Get active users and transform data to grouped format
    const { activeUsers, groupedData } = useMemo(() => {
        if (!data.length) {
            return { activeUsers: [], groupedData: [] };
        }

        const activeUsersList = users.filter((u) => {
            const hasData = data.some(
                (day) =>
                    (day[`${u.id}_movies`] as number) > 0 || (day[`${u.id}_series`] as number) > 0
            );
            return hasData;
        });

        // Transform data: each date has stacked bars per user showing movies and series
        const transformedData = data.map((day) => {
            const result: any = { date: day.date };
            activeUsersList.forEach((user) => {
                const movies = (day[`${user.id}_movies`] as number) || 0;
                const series = (day[`${user.id}_series`] as number) || 0;
                // Store individual counts for stacking
                result[`${user.id}_movies`] = movies;
                result[`${user.id}_series`] = series;
                // Store breakdown for tooltip
                result[`${user.id}_breakdown`] = { movies, series };
            });
            return result;
        });

        return { activeUsers: activeUsersList, groupedData: transformedData };
    }, [data, users]);

    if (activeUsers.length === 0 || groupedData.length === 0) {
        return (
            <Card padding="lg">
                <div className="detail-section-header mb-6 flex items-center justify-between">
                    <h3 className="font-display font-semibold text-default text-lg">
                        Content Breakdown
                    </h3>
                </div>
                <div className="flex h-40 items-center justify-center text-muted md:h-64">
                    No content data available
                </div>
            </Card>
        );
    }

    return (
        <Card className="flex h-full flex-col" padding="lg">
            <div className="detail-section-header mb-6 flex items-center justify-between">
                <h3 className="font-display font-semibold text-default text-lg">
                    Content Breakdown by User
                </h3>
                <div className="flex items-center gap-2">
                    <span className="text-muted text-xs">Movies vs Series per user</span>
                </div>
            </div>

            <div className="h-40 md:h-64">
                <ResponsiveContainer height="100%" width="100%">
                    <BarChart
                        barCategoryGap="20%"
                        barGap={2}
                        data={groupedData}
                        margin={{ bottom: 80 }}
                    >
                        <CartesianGrid stroke="rgba(255,255,255,0.1)" strokeDasharray="3 3" />
                        <XAxis dataKey="date" fontSize={12} stroke="#64748b" />
                        <YAxis fontSize={12} stroke="#64748b" width={60} />
                        <Tooltip
                            contentStyle={TOOLTIP_STYLE}
                            cursor={{ fill: "rgba(255,255,255,0.05)" }}
                            formatter={(value: any, name: any, props: any) => {
                                // Parse the dataKey to find the user and type
                                const dataKey = props.dataKey as string;
                                if (!dataKey) {
                                    return [value, name];
                                }

                                const parts = dataKey.split("_");
                                const userId = parts[0];
                                const type = parts[1]; // 'movies' or 'series'

                                const user = users.find((u) => u.id === userId);
                                const userName = user?.username || user?.name || "Unknown";

                                return [`${value} ${type}`, userName];
                            }}
                            labelStyle={TOOLTIP_LABEL_STYLE}
                        />
                        {activeUsers.map((user) => (
                            <React.Fragment key={user.id}>
                                {/* Movies (Bottom) */}
                                <Bar
                                    dataKey={`${user.id}_movies`}
                                    fill="var(--color-primary)"
                                    radius={[0, 0, 0, 0]}
                                    stackId={user.id}
                                >
                                    {/* Show user label under the stack */}
                                    <LabelList
                                        content={(props: any) => (
                                            <UserLabel
                                                {...props}
                                                userName={user.username || user.name || "User"}
                                            />
                                        )}
                                        dataKey={`${user.id}_movies`}
                                    />
                                </Bar>
                                {/* Series (Top) */}
                                <Bar
                                    dataKey={`${user.id}_series`}
                                    fill="var(--color-secondary)"
                                    radius={[4, 4, 0, 0]}
                                    stackId={user.id}
                                />
                            </React.Fragment>
                        ))}
                    </BarChart>
                </ResponsiveContainer>
            </div>

            {/* Legend */}
            <div className="mt-auto flex flex-wrap items-center justify-center gap-6 border-default border-t pt-4">
                <div className="flex items-center gap-2">
                    <span
                        className="h-3 w-3 rounded-full"
                        style={{ backgroundColor: "var(--color-primary)" }}
                    />
                    <span className="text-muted text-sm">Movies</span>
                </div>
                <div className="flex items-center gap-2">
                    <span
                        className="h-3 w-3 rounded-full"
                        style={{ backgroundColor: "var(--color-secondary)" }}
                    />
                    <span className="text-muted text-sm">Series</span>
                </div>
            </div>
        </Card>
    );
});

// Sortable Addon Item Component with clean draggable card design
export default function GroupDetailPage() {
    const { layoutMode } = useLayoutMode();
    const params = useParams();
    const router = useRouter();
    const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);
    const [isEditModalOpen, setIsEditModalOpen] = useState(false);
    const [isAddMemberModalOpen, setIsAddMemberModalOpen] = useState(false);
    const [isAddAddonModalOpen, setIsAddAddonModalOpen] = useState(false);
    const [_showColorPicker, _setShowColorPicker] = useState(false);
    const [showAvatarPicker, setShowAvatarPicker] = useState(false);
    const colorPickerRef = useRef<HTMLDivElement>(null);
    const [isSyncing, setIsSyncing] = useState(false);
    const [isDeleting, setIsDeleting] = useState(false);

    // New state for clear all modals
    const [isClearMembersModalOpen, setIsClearMembersModalOpen] = useState(false);
    const [isClearAddonsModalOpen, setIsClearAddonsModalOpen] = useState(false);
    const [isClearing, setIsClearing] = useState(false);

    // Track syncing users
    const [syncingUsers, setSyncingUsers] = useState<Set<string>>(new Set());

    // Track group sync state for badge refresh
    const [groupSyncing, setGroupSyncing] = useState(false);

    // Track user syncing state for user badge refresh (when group members change)
    const [usersSyncing, setUsersSyncing] = useState(false);

    // Data state
    const [group, setGroup] = useState<(Group & { color?: string; colorIndex?: number }) | null>(
        null
    );
    const [_users, setUsers] = useState<User[]>([]);
    const [groupUsers, setGroupUsers] = useState<User[]>([]);
    const [addons, setAddons] = useState<Addon[]>([]);
    const [allAddons, setAllAddons] = useState<Addon[]>([]);
    const [isLoading, setIsLoading] = useState(true);

    // Instant navigation: the group and its members as last seen, shown at
    // once while fetchData below refreshes everything - see useLastKnown's
    // comment. Membership is derived here the same way fetchData derives it.
    useLastKnown<Group>(`/groups/${params.id}`, (cached) =>
        setGroup(cached as Group & { color?: string; colorIndex?: number })
    );
    useLastKnown<User[]>("/users", (cached) => {
        setUsers(cached);
        const cachedGroup = api.peekGet<Group>(`/groups/${params.id}`);
        if (!cachedGroup) {
            return;
        }
        let ids: string[] = [];
        try {
            const raw = (cachedGroup as { userIds?: string | string[] }).userIds;
            ids = typeof raw === "string" ? JSON.parse(raw) : Array.isArray(raw) ? raw : [];
        } catch {
            ids = [];
        }
        setGroupUsers(cached.filter((u) => ids.includes(u.id)));
        setIsLoading(false);
    });
    const [_error, setError] = useState<Error | null>(null);

    // Watch time data state
    const [watchTimeData, setWatchTimeData] = useState<AggregatedWatchTimeData[]>([]);
    const [contentBreakdownData, setContentBreakdownData] = useState<AggregatedContentData[]>([]);
    const [isLoadingCharts, setIsLoadingCharts] = useState(false);

    // DnD sensors (now handled by DraggableList)

    // Fetch watch time data for all group users
    const fetchWatchTimeData = useCallback(async (userIds: string[]) => {
        if (userIds.length === 0) {
            setWatchTimeData([]);
            setContentBreakdownData([]);
            return;
        }

        setIsLoadingCharts(true);
        try {
            // Fetch watch time for each user
            const userWatchTimePromises = userIds.map(async (userId) => {
                try {
                    const data = await api.getUserWatchTime(userId, "month");
                    return { data, userId };
                } catch {
                    return { data: null, userId };
                }
            });

            const userWatchTimeResults = await Promise.all(userWatchTimePromises);

            // Collect all unique dates
            const allDates = new Set<string>();
            userWatchTimeResults.forEach(({ data }) => {
                if (data?.byDate) {
                    data.byDate.forEach((period) => {
                        allDates.add(period.date);
                    });
                }
            });

            // Sort dates
            const sortedDates = Array.from(allDates).sort();

            // Aggregate data per date per user
            const aggregatedWatchTime: AggregatedWatchTimeData[] = sortedDates.map((date) => {
                const dayData: AggregatedWatchTimeData = { date };
                userWatchTimeResults.forEach(({ userId, data }) => {
                    const userData = data?.byDate?.find((p) => p.date === date);
                    dayData[userId] = userData
                        ? Math.round((userData.watchTimeSeconds || 0) / 60)
                        : 0;
                });
                return dayData;
            });

            // Aggregate content breakdown per date per user
            const aggregatedContent: AggregatedContentData[] = sortedDates.map((date) => {
                const dayData: AggregatedContentData = { date };
                userWatchTimeResults.forEach(({ userId, data }) => {
                    const userData = data?.byDate?.find((p) => p.date === date);
                    dayData[`${userId}_movies`] = userData?.movies || 0;
                    dayData[`${userId}_series`] = userData?.shows || 0;
                });
                return dayData;
            });

            setWatchTimeData(aggregatedWatchTime);
            setContentBreakdownData(aggregatedContent);
        } catch (err) {
            console.error("Failed to fetch watch time data:", err);
            setWatchTimeData([]);
            setContentBreakdownData([]);
        } finally {
            setIsLoadingCharts(false);
        }
    }, []);

    // Fetch group data
    useEffect(() => {
        const fetchData = async () => {
            setIsLoading(true);
            setError(null);
            try {
                // The group is applied the moment it arrives: if one of the other
                // three requests fails, the page still replaces the saved copy it
                // opened on (useLastKnown) instead of leaving a stale one up.
                const [groupData, usersData, groupAddonsData, allAddonsData] = await Promise.all([
                    api.getGroup(params.id as string).then((g) => {
                        setGroup(g as Group & { color?: string; colorIndex?: number });
                        return g;
                    }),
                    api.getUsers(),
                    api.getGroupAddons(params.id as string),
                    api.getAddons(),
                ]);
                setUsers(usersData);
                // Filter out any addons without valid IDs
                const validGroupAddons = (groupAddonsData || []).filter((a: Addon) => {
                    if (!a.id) {
                        console.warn("Addon without ID found during initial fetch:", a);
                        return false;
                    }
                    return true;
                });
                console.log("🟡 Frontend: Loaded group addons:", {
                    addonIds: validGroupAddons.map((a) => ({
                        id: a.id,
                        idType: typeof a.id,
                        name: a.name,
                    })),
                    total: groupAddonsData?.length || 0,
                    valid: validGroupAddons.length,
                });
                setAddons(validGroupAddons);
                setAllAddons(allAddonsData);

                // Filter users that belong to this group
                // userIds can be a JSON string or an array
                let groupUserIds: string[] = [];
                if (groupData?.userIds) {
                    try {
                        if (typeof groupData.userIds === "string") {
                            groupUserIds = JSON.parse(groupData.userIds);
                        } else if (Array.isArray(groupData.userIds)) {
                            groupUserIds = groupData.userIds;
                        }
                    } catch (e) {
                        console.error("Error parsing group userIds:", e);
                        groupUserIds = [];
                    }
                }
                const filtered = usersData.filter((u) => groupUserIds.includes(u.id));
                setGroupUsers(filtered);

                // Fetch watch time data for group users
                await fetchWatchTimeData(groupUserIds);
            } catch (err) {
                setError(err as Error);
            } finally {
                setIsLoading(false);
            }
        };

        if (params.id) {
            fetchData();
        }
    }, [params.id, fetchWatchTimeData]);

    useEffect(() => {
        if (group) {
            document.title = `SlickSync - ${group.name || "Group Detail"}`;
        }
    }, [group]);

    const refetchData = useCallback(async () => {
        try {
            const [groupData, usersData, groupAddonsData, allAddonsData] = await Promise.all([
                api.getGroup(params.id as string),
                api.getUsers(),
                api.getGroupAddons(params.id as string),
                api.getAddons(),
            ]);
            setGroup(groupData as Group & { color?: string });
            setUsers(usersData);
            // Filter out any addons without valid IDs and ensure all have IDs
            const validGroupAddons = (groupAddonsData || []).filter((a: Addon) => {
                if (!a.id) {
                    console.warn("Addon without ID found:", a);
                    return false;
                }
                return true;
            });
            setAddons(validGroupAddons);
            setAllAddons(allAddonsData);

            // userIds can be a JSON string or an array
            let groupUserIds: string[] = [];
            if (groupData?.userIds) {
                try {
                    if (typeof groupData.userIds === "string") {
                        groupUserIds = JSON.parse(groupData.userIds);
                    } else if (Array.isArray(groupData.userIds)) {
                        groupUserIds = groupData.userIds;
                    }
                } catch (e) {
                    console.error("Error parsing group userIds:", e);
                    groupUserIds = [];
                }
            }
            const filtered = usersData.filter((u) => groupUserIds.includes(u.id));
            setGroupUsers(filtered);

            // Refresh watch time data
            await fetchWatchTimeData(groupUserIds);

            // Debug: log addon IDs to help troubleshoot
            if (groupAddonsData && groupAddonsData.length > 0) {
                console.log("🟡 Frontend: Refetched group addons:", {
                    addonIds: groupAddonsData.map((a) => ({
                        id: a.id,
                        idType: typeof a.id,
                        name: a.name,
                    })),
                    total: groupAddonsData.length,
                });
            }
        } catch (err) {
            console.error("Failed to refresh data:", err);
        }
    }, [params.id, fetchWatchTimeData]);

    const handleSync = useCallback(async () => {
        // Warning if no addons
        if (addons.length === 0) {
            toast.error("Cannot sync group: No addons assigned. Add addons before syncing.");
            return;
        }

        setIsSyncing(true);
        try {
            await api.syncGroup(params.id as string);
            toast.success("Group synced successfully");
            await refetchData();
        } catch (err) {
            toast.error(readErrorMessage(err, "Failed to sync group"));
        } finally {
            setIsSyncing(false);
        }
    }, [params.id, refetchData, addons.length]);

    const handleDelete = useCallback(async () => {
        setIsDeleting(true);
        try {
            await api.deleteGroup(params.id as string);
            toast.success("Group deleted successfully");
            router.push("/groups");
        } catch (err) {
            toast.error(readErrorMessage(err, "Failed to delete group"));
        } finally {
            setIsDeleting(false);
            setIsDeleteModalOpen(false);
        }
    }, [params.id, router]);

    const handleRemoveUser = useCallback(
        async (userId: string, userName: string) => {
            setUsersSyncing(true);
            try {
                await api.removeUserFromGroup(params.id as string, userId);
                toast.success(`${userName} removed from group`);
                await refetchData();
            } catch (err) {
                toast.error(readErrorMessage(err, `Failed to remove ${userName}`));
            } finally {
                setUsersSyncing(false);
            }
        },
        [params.id, refetchData]
    );

    // Sync individual user
    const handleSyncUser = useCallback(async (userId: string, userName: string) => {
        setSyncingUsers((prev) => new Set(prev).add(userId));
        setGroupSyncing(true);
        try {
            await api.syncUser(userId);
            toast.success(`${userName} synced successfully`);
        } catch (err) {
            toast.error(readErrorMessage(err, `Failed to sync ${userName}`));
        } finally {
            setSyncingUsers((prev) => {
                const next = new Set(prev);
                next.delete(userId);
                return next;
            });
            setGroupSyncing(false);
        }
    }, []);

    // Clear all members
    const handleClearAllMembers = useCallback(async () => {
        setIsClearing(true);
        setUsersSyncing(true);
        try {
            // Remove all users from group
            for (const user of groupUsers) {
                await api.removeUserFromGroup(params.id as string, user.id);
            }
            toast.success(`Removed ${groupUsers.length} members from group`);
            await refetchData();
            setIsClearMembersModalOpen(false);
        } catch (err) {
            toast.error(readErrorMessage(err, "Failed to clear members"));
        } finally {
            setIsClearing(false);
            setUsersSyncing(false);
        }
    }, [params.id, groupUsers, refetchData]);

    // Clear all addons
    const handleClearAllAddons = useCallback(async () => {
        setIsClearing(true);
        setGroupSyncing(true);
        setUsersSyncing(true);
        try {
            // Remove all addons from group
            for (const addon of addons) {
                await api.removeAddonFromGroup(params.id as string, addon.id);
            }
            toast.success(
                `Removed ${addons.length} addon${addons.length === 1 ? "" : "s"} from group`
            );
            await refetchData();
            setIsClearAddonsModalOpen(false);
        } catch (err) {
            toast.error(readErrorMessage(err, "Failed to clear addons"));
        } finally {
            setIsClearing(false);
            setGroupSyncing(false);
            setUsersSyncing(false);
        }
    }, [params.id, addons, refetchData]);

    // Handle adding addon to group
    const handleAddAddon = useCallback(
        async (addonIds: string[], addonNames: string[]) => {
            setGroupSyncing(true);
            setUsersSyncing(true);
            try {
                for (const addonId of addonIds) {
                    await api.addAddonToGroup(params.id as string, addonId);
                }
                toast.success(
                    `${addonNames.length} addon${addonNames.length > 1 ? "s" : ""} added to group`
                );
                await refetchData();
                setIsAddAddonModalOpen(false);
            } catch (err) {
                toast.error(readErrorMessage(err, "Failed to add addons"));
            } finally {
                setGroupSyncing(false);
                setUsersSyncing(false);
            }
        },
        [params.id, refetchData]
    );

    // Handle removing addon from group
    const handleRemoveAddon = useCallback(
        async (addonId: string) => {
            const addon = addons.find((a) => a.id === addonId);
            setGroupSyncing(true);
            setUsersSyncing(true);
            try {
                await api.removeAddonFromGroup(params.id as string, addonId);
                toast.success(`${addon?.name || "Addon"} removed from group`);
                await refetchData();
            } catch (err) {
                toast.error(readErrorMessage(err, "Failed to remove addon"));
            } finally {
                setGroupSyncing(false);
                setUsersSyncing(false);
            }
        },
        [params.id, addons, refetchData]
    );

    // Handle avatar change (color, URL, or uploaded image)
    const handleAvatarSave = useCallback(
        async (data: { avatarUrl?: string | null; colorIndex?: number }) => {
            setGroup((prev) => (prev ? { ...prev, ...data } : null));
            await api.updateGroup(params.id as string, data);
            await refetchData();
        },
        [params.id, refetchData]
    );

    // Handle color change
    const _handleColorChange = useCallback(
        async (colorIndex: number) => {
            // Optimistic update
            setGroup((prev) => (prev ? { ...prev, colorIndex } : null));

            try {
                await api.updateGroup(params.id as string, { colorIndex });
                toast.success("Group color updated");
                await refetchData();
            } catch (err) {
                toast.error(readErrorMessage(err, "Failed to update group color"));
                await refetchData();
            }
        },
        [params.id, refetchData]
    );

    // Handle name update
    const handleNameUpdate = useCallback(
        async (newName: string) => {
            try {
                await api.updateGroup(params.id as string, { name: newName });
                toast.success("Group name updated");
                await refetchData();
            } catch (err) {
                toast.error(readErrorMessage(err, "Failed to update group name"));
            }
        },
        [params.id, refetchData]
    );

    // Handle description update
    const handleDescriptionUpdate = useCallback(
        async (newDescription: string) => {
            try {
                await api.updateGroup(params.id as string, {
                    description: newDescription || undefined,
                });
                toast.success("Group description updated");
                await refetchData();
            } catch (err) {
                toast.error(readErrorMessage(err, "Failed to update group description"));
            }
        },
        [params.id, refetchData]
    );

    // Handle toggle active status
    const handleToggleActive = useCallback(async () => {
        try {
            const currentGroup = await api.getGroup(params.id as string);
            // Same reading the switch uses, so a missing value means "active" in
            // both places instead of active on screen and inactive in the maths.
            const newStatus = !(currentGroup.isActive !== false);
            await api.toggleGroupStatus(params.id as string, newStatus);
            toast.success(`Group ${newStatus ? "activated" : "deactivated"}`);
            await refetchData();
        } catch (err) {
            toast.error(readErrorMessage(err, "Failed to toggle group status"));
        }
    }, [params.id, refetchData]);

    // Handle addon drag end for reordering
    const handleDragEnd = useCallback(
        async (event: DragEndEvent) => {
            const { active, over } = event;
            if (!over || active.id === over.id) {
                return;
            }

            const activeId = String(active.id);
            const overId = String(over.id);

            const oldIndex = addons.findIndex((a) => String(a.id) === activeId);
            const newIndex = addons.findIndex((a) => String(a.id) === overId);

            if (oldIndex === -1 || newIndex === -1) {
                console.warn("Could not find addon indices:", {
                    activeId,
                    addons: addons.map((a) => ({ id: a.id, name: a.name })),
                    overId,
                });
                return;
            }

            // Optimistic update
            const newAddons = arrayMove(addons, oldIndex, newIndex);
            setAddons(newAddons);
            setGroupSyncing(true);
            setUsersSyncing(true);

            try {
                const stringIds = newAddons
                    .map((a) => String(a.id).trim())
                    .filter((id) => id && id !== "undefined" && id !== "null");

                if (stringIds.length === 0) {
                    throw new Error("No valid addon IDs to reorder");
                }

                console.log("🟢 Reordering addons:", stringIds);
                await api.reorderGroupAddons(params.id as string, stringIds);
                toast.success("Addon order updated");
                // Refetch to ensure we have the latest data
                await refetchData();
            } catch (err: any) {
                // Revert on error
                setAddons(addons);
                console.error("❌ Failed to reorder addons:", err);
                if (err?.response?.data) {
                    console.error("📦 Error response details:", err.response.data);
                }
                const errorMessage =
                    err?.response?.data?.message || err?.message || "Failed to update addon order";
                toast.error(errorMessage);
            } finally {
                setGroupSyncing(false);
                setUsersSyncing(false);
            }
        },
        [params.id, addons, refetchData]
    );

    // Get color index from color hex (for color picker)
    const _getColorIndex = (color?: string) => {
        // Standard group color list for matching hex back to index if needed
        const standardColors = [
            "#7c3aed",
            "#06b6d4",
            "#10b981",
            "#f59e0b",
            "#f43f5e",
            "#8b5cf6",
            "#ec4899",
            "#14b8a6",
        ];
        if (group?.colorIndex !== undefined) {
            return group.colorIndex;
        }
        if (!color) {
            return 0;
        }
        const index = standardColors.findIndex((c) => c.toLowerCase() === color.toLowerCase());
        return index >= 0 ? index : 0;
    };

    // Get addons not yet in this group
    const availableAddons = allAddons.filter(
        (addon) => !addons.some((groupAddon) => groupAddon.id === addon.id)
    );

    const detailActions = (
        <div className="flex flex-wrap items-center justify-end gap-3">
            <div className="flex items-center gap-2">
                <span className="text-muted text-sm">Active</span>
                <ToggleSwitch
                    checked={group?.isActive !== false}
                    onChange={handleToggleActive}
                    size="sm"
                    title="Activate group"
                />
            </div>
            <Button
                isLoading={isSyncing}
                leftIcon={
                    <ArrowPathIcon className={`h-5 w-5 ${isSyncing ? "animate-spin" : ""}`} />
                }
                onClick={handleSync}
                variant="glass"
            >
                Sync Group
            </Button>
            <Button
                leftIcon={<PencilIcon className="h-5 w-5" />}
                onClick={() => setIsEditModalOpen(true)}
                variant="glass"
            >
                Edit
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
                    subtitle={isLoading ? "" : group?.description || ""}
                    title={
                        <Breadcrumbs
                            className="font-semibold text-xl"
                            items={[
                                { href: "/groups", label: "Groups" },
                                { label: isLoading ? "Loading..." : group?.name || "Group" },
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
                            backHref="/groups"
                            backLabel="Groups"
                            title={isLoading ? "Loading group" : group?.name || "Group"}
                        />
                    )}
                    {/* Group Hero Section */}
                    <PageSection className="mb-8">
                        <Card className="profile-hero" padding="lg">
                            <div className="relative">
                                <div className="profile-hero-layout flex flex-col items-start gap-4 sm:flex-row">
                                    {/* Group Icon with Color Picker */}
                                    <motion.div
                                        animate={{ opacity: 1, scale: 1 }}
                                        className="profile-hero-avatar relative shrink-0"
                                        initial={false}
                                        ref={colorPickerRef}
                                        transition={{ stiffness: 200, type: "spring" }}
                                    >
                                        <button
                                            aria-label="Change profile picture"
                                            className="cursor-pointer transition-transform hover:scale-105"
                                            onClick={() => setShowAvatarPicker(true)}
                                            type="button"
                                        >
                                            <Avatar
                                                className="shadow-lg ring-4 ring-[var(--color-bg)]"
                                                colorIndex={group?.colorIndex ?? 0}
                                                name={group?.name || "G"}
                                                size="2xl"
                                                src={group?.avatarUrl || undefined}
                                            />
                                        </button>
                                        <AvatarPickerModal
                                            currentAvatarUrl={group?.avatarUrl}
                                            currentColorIndex={group?.colorIndex ?? 0}
                                            isOpen={showAvatarPicker}
                                            name={group?.name || "Group"}
                                            onClose={() => setShowAvatarPicker(false)}
                                            onSave={handleAvatarSave}
                                        />
                                    </motion.div>

                                    {/* Info */}
                                    <div className="min-w-0 flex-1">
                                        {/* Name with sync badge */}
                                        <div className="mb-1 flex flex-wrap items-center gap-2">
                                            <InlineEdit
                                                className="inline-flex font-bold text-2xl"
                                                maxLength={50}
                                                onSave={handleNameUpdate}
                                                placeholder="Enter group name..."
                                                value={group?.name || "Group"}
                                            />
                                            <SyncBadge
                                                groupId={group?.id || ""}
                                                isSyncing={groupSyncing}
                                                key={`group-sync-${group?.id}-${groupSyncing}`}
                                                onSync={async (id) => {
                                                    setGroupSyncing(true);
                                                    setUsersSyncing(true);
                                                    try {
                                                        await api.syncGroup(id);
                                                        toast.success(
                                                            `Synced ${group?.name} successfully`
                                                        );
                                                    } catch (err) {
                                                        toast.error(
                                                            readErrorMessage(
                                                                err,
                                                                `Failed to sync ${group?.name}`
                                                            )
                                                        );
                                                    }
                                                    setTimeout(() => {
                                                        setGroupSyncing(false);
                                                        setUsersSyncing(false);
                                                    }, 300);
                                                }}
                                                size="sm"
                                            />
                                        </div>
                                        <div className="mb-4">
                                            <InlineEdit
                                                className="profile-description text-muted"
                                                maxLength={200}
                                                onSave={handleDescriptionUpdate}
                                                placeholder="Enter description..."
                                                value={group?.description || undefined}
                                            />
                                        </div>

                                        {/* Quick stats row */}
                                        <div className="flex flex-wrap items-center gap-6">
                                            <div className="flex items-center gap-2">
                                                <UsersIcon className="h-5 w-5 text-secondary" />
                                                <span className="font-medium text-default">
                                                    {groupUsers.length}
                                                </span>
                                                <span className="text-muted">
                                                    member{groupUsers.length === 1 ? "" : "s"}
                                                </span>
                                            </div>
                                            <div className="flex items-center gap-2">
                                                <PuzzlePieceIcon className="h-5 w-5 text-secondary" />
                                                <span className="font-medium text-default">
                                                    {addons.length}
                                                </span>
                                                <span className="text-muted">
                                                    addon{addons.length === 1 ? "" : "s"}
                                                </span>
                                            </div>
                                            <div className="flex items-center gap-2">
                                                <ClockIcon className="h-5 w-5 text-secondary" />
                                                {/* Was hardcoded to "Last sync: Unknown" - a string
                          literal with no data behind it, shown for every group
                          forever. Now the newest sync among the group's
                          members, or Never if none of them has synced. */}
                                                <span className="text-muted">
                                                    Last sync: {formatLastSync(group?.lastSyncedAt)}
                                                </span>
                                            </div>
                                            <div className="flex items-center gap-2">
                                                <CalendarIcon className="h-5 w-5 text-secondary" />
                                                <span className="text-muted">
                                                    Created:{" "}
                                                    {group?.createdAt
                                                        ? new Date(
                                                              group.createdAt
                                                          ).toLocaleDateString()
                                                        : "Unknown"}
                                                </span>
                                            </div>
                                        </div>
                                    </div>

                                    {/* Avatar stack - show on mobile too */}
                                    <div className="mt-4 hidden shrink-0 items-start sm:flex md:mt-0">
                                        <AvatarGroup
                                            max={5}
                                            size="md"
                                            users={groupUsers.map((u) => ({
                                                email: u.email,
                                                id: u.id,
                                                name: u.name || u.username || "Unknown",
                                                src: u.avatarUrl ?? undefined,
                                                useGravatar: u.useGravatar,
                                            }))}
                                        />
                                    </div>
                                </div>
                            </div>
                        </Card>
                    </PageSection>

                    {/* Members Section */}
                    <PageSection className="mb-8" delay={0.1}>
                        <Card padding="lg">
                            <div className="detail-section-header mb-6 flex items-center justify-between">
                                <div className="flex items-center gap-3">
                                    <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-500/20">
                                        <UsersIcon className="h-5 w-5 text-blue-400" />
                                    </div>
                                    <div>
                                        <h3 className="font-semibold text-default text-lg">
                                            Members
                                        </h3>
                                        <p className="text-muted text-sm">
                                            {groupUsers.length} user
                                            {groupUsers.length === 1 ? "" : "s"} in this group
                                        </p>
                                    </div>
                                </div>
                                <div className="flex items-center gap-2">
                                    {groupUsers.length > 0 && (
                                        <Button
                                            className="text-error hover:bg-error-muted"
                                            onClick={() => setIsClearMembersModalOpen(true)}
                                            size="sm"
                                            variant="ghost"
                                        >
                                            <TrashIcon className="mr-1 h-4 w-4" />
                                            Clear All
                                        </Button>
                                    )}
                                    <Button
                                        leftIcon={<UserPlusIcon className="h-4 w-4" />}
                                        onClick={() => setIsAddMemberModalOpen(true)}
                                        size="sm"
                                        variant="primary"
                                    >
                                        Add Member
                                    </Button>
                                </div>
                            </div>

                            <StaggerContainer className="space-y-3">
                                {isLoading ? (
                                    <div className="py-8 text-center text-muted text-sm">
                                        Loading...
                                    </div>
                                ) : groupUsers.length > 0 ? (
                                    groupUsers.map((user) => {
                                        const displayName = user.name || user.username || "Unknown";
                                        const isUserSyncing =
                                            syncingUsers.has(user.id) || usersSyncing;
                                        return (
                                            <StaggerItem key={user.id}>
                                                <motion.div
                                                    className="detail-member-row group flex items-center gap-4 overflow-hidden rounded-xl bg-surface-hover p-4 transition-colors hover:bg-surface"
                                                    whileHover={{ x: 4 }}
                                                >
                                                    <UserAvatar
                                                        colorIndex={user.colorIndex}
                                                        email={user.email}
                                                        name={displayName}
                                                        size="md"
                                                        src={user.avatarUrl ?? undefined}
                                                        useGravatar={user.useGravatar}
                                                        userId={user.id}
                                                    />

                                                    <div className="min-w-0 flex-1">
                                                        <div className="flex items-center gap-2">
                                                            <Link
                                                                className="truncate font-medium text-default transition-colors hover:text-primary"
                                                                href={`/users/${user.id}`}
                                                            >
                                                                {displayName}
                                                            </Link>
                                                            <SyncBadge
                                                                isSyncing={isUserSyncing}
                                                                key={`user-sync-${user.id}-${isUserSyncing}`}
                                                                onSync={() =>
                                                                    handleSyncUser(
                                                                        user.id,
                                                                        displayName
                                                                    )
                                                                }
                                                                size="sm"
                                                                userId={user.id}
                                                            />
                                                        </div>
                                                        <p className="truncate text-muted text-sm">
                                                            {displayEmail(user.email)}
                                                        </p>
                                                    </div>

                                                    <div className="flex items-center gap-2 opacity-100 transition-opacity md:opacity-0 md:group-hover:opacity-100 md:focus-within:opacity-100">
                                                        <Button
                                                            disabled={isUserSyncing}
                                                            leftIcon={
                                                                <ArrowPathIcon
                                                                    className={`h-4 w-4 ${isUserSyncing ? "animate-spin" : ""}`}
                                                                />
                                                            }
                                                            onClick={() =>
                                                                handleSyncUser(user.id, displayName)
                                                            }
                                                            size="sm"
                                                            variant="ghost"
                                                        >
                                                            Sync
                                                        </Button>
                                                        <Button
                                                            className="text-error hover:bg-error-muted"
                                                            leftIcon={
                                                                <UserMinusIcon className="h-4 w-4" />
                                                            }
                                                            onClick={() =>
                                                                handleRemoveUser(
                                                                    user.id,
                                                                    displayName
                                                                )
                                                            }
                                                            size="sm"
                                                            variant="ghost"
                                                        >
                                                            Remove
                                                        </Button>
                                                    </div>
                                                </motion.div>
                                            </StaggerItem>
                                        );
                                    })
                                ) : (
                                    <div className="py-8 text-center text-muted text-sm">
                                        No members in this group
                                    </div>
                                )}
                            </StaggerContainer>
                        </Card>
                    </PageSection>

                    {/* Addons Section */}
                    <PageSection delay={0.2}>
                        <Card padding="lg">
                            <div className="detail-section-header mb-6 flex items-center justify-between">
                                <div className="flex items-center gap-3">
                                    <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-purple-500/20">
                                        <PuzzlePieceIcon className="h-5 w-5 text-purple-400" />
                                    </div>
                                    <div>
                                        <h3 className="font-semibold text-default text-lg">
                                            Assigned Addons
                                        </h3>
                                        <p className="text-muted text-sm">
                                            {addons.length} addon{addons.length === 1 ? "" : "s"}{" "}
                                            shared with this group
                                            {addons.length > 0 && (
                                                <span className="ml-2 inline-flex items-center gap-1.5 rounded-md border border-primary/25 bg-primary-muted/15 px-2 py-0.5 font-medium text-primary text-xs">
                                                    <Bars3Icon className="h-3.5 w-3.5" />
                                                    Drag cards to reorder
                                                </span>
                                            )}
                                        </p>
                                    </div>
                                </div>
                                <div className="flex items-center gap-2">
                                    {addons.length > 0 && (
                                        <Button
                                            className="text-error hover:bg-error-muted"
                                            onClick={() => setIsClearAddonsModalOpen(true)}
                                            size="sm"
                                            variant="ghost"
                                        >
                                            <TrashIcon className="mr-1 h-4 w-4" />
                                            Clear All
                                        </Button>
                                    )}
                                    <Button
                                        leftIcon={<PlusIcon className="h-4 w-4" />}
                                        onClick={() => setIsAddAddonModalOpen(true)}
                                        size="sm"
                                        variant="primary"
                                    >
                                        Add Addon
                                    </Button>
                                </div>
                            </div>

                            {isLoading ? (
                                <div className="py-8 text-center text-muted text-sm">
                                    Loading...
                                </div>
                            ) : addons.length > 0 ? (
                                (() => {
                                    const addonIds = addons
                                        .filter((addon) => addon.id)
                                        .map((addon) => String(addon.id));
                                    return (
                                        <DraggableList
                                            items={addonIds}
                                            onDragEnd={handleDragEnd}
                                            renderItem={({
                                                id,
                                                dragHandleProps,
                                                itemProps,
                                                isDragging,
                                            }) => {
                                                const addon = addons.find(
                                                    (a) => String(a.id) === id
                                                );
                                                if (!addon) {
                                                    return null;
                                                }
                                                const anyAddon = addon;
                                                const logo =
                                                    anyAddon.customLogo ||
                                                    anyAddon.manifest?.logo ||
                                                    addon.logo ||
                                                    anyAddon.iconUrl;
                                                return (
                                                    <motion.div
                                                        className={`group flex items-center gap-4 overflow-hidden rounded-xl border bg-surface-hover p-4 transition-all hover:bg-surface ${
                                                            isDragging
                                                                ? "scale-[1.01] border-primary shadow-lg shadow-primary/25"
                                                                : "border-default hover:border-primary hover:shadow-md"
                                                        }`}
                                                        ref={itemProps.ref}
                                                        style={itemProps.style}
                                                    >
                                                        <div
                                                            {...dragHandleProps}
                                                            className="shrink-0 cursor-grab rounded p-1 hover:bg-surface-hover active:cursor-grabbing"
                                                        >
                                                            <Bars3Icon className="h-5 w-5 text-subtle" />
                                                        </div>
                                                        <Link
                                                            className="flex min-w-0 flex-1 cursor-pointer items-center gap-4"
                                                            href={`/addons/${addon.id}`}
                                                            onClick={(e) => e.stopPropagation()}
                                                        >
                                                            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-surface-hover">
                                                                {logo ? (
                                                                    <img
                                                                        alt={addon.name}
                                                                        className="h-8 w-8 object-contain"
                                                                        src={logo}
                                                                    />
                                                                ) : (
                                                                    <PuzzlePieceIcon className="h-6 w-6 text-primary" />
                                                                )}
                                                            </div>
                                                            <div className="min-w-0 flex-1">
                                                                <div className="mb-1 flex items-center gap-2">
                                                                    <h4 className="min-w-0 flex-1 truncate font-semibold text-base text-default">
                                                                        {addon.name ||
                                                                            "Unnamed Addon"}
                                                                    </h4>
                                                                    {addon.version && (
                                                                        <VersionBadge
                                                                            size="sm"
                                                                            version={addon.version}
                                                                        />
                                                                    )}
                                                                </div>
                                                                {addon.description && (
                                                                    <p className="mb-2 truncate text-muted text-sm">
                                                                        {addon.description}
                                                                    </p>
                                                                )}
                                                                {(addon.resources || []).length >
                                                                    0 && (
                                                                    <div className="mt-1 flex flex-wrap gap-1.5">
                                                                        {(addon.resources || [])
                                                                            .slice(0, 4)
                                                                            .map((res: string) => (
                                                                                <ResourceBadge
                                                                                    key={res}
                                                                                    resource={res}
                                                                                />
                                                                            ))}
                                                                        {(addon.resources || [])
                                                                            .length > 4 && (
                                                                            <Badge
                                                                                size="sm"
                                                                                variant="muted"
                                                                            >
                                                                                +
                                                                                {(
                                                                                    addon.resources ||
                                                                                    []
                                                                                ).length - 4}
                                                                            </Badge>
                                                                        )}
                                                                    </div>
                                                                )}
                                                            </div>
                                                        </Link>
                                                        <div className="flex shrink-0 items-center gap-2 opacity-100 transition-opacity md:opacity-0 md:group-hover:opacity-100 md:focus-within:opacity-100">
                                                            <Button
                                                                aria-label={`Remove ${addon.name} from group`}
                                                                className="rounded-lg text-error hover:bg-error-muted"
                                                                onClick={() => {
                                                                    if (addon.id) {
                                                                        handleRemoveAddon(addon.id);
                                                                    }
                                                                }}
                                                                onMouseDown={(e) =>
                                                                    e.stopPropagation()
                                                                }
                                                                onTouchStart={(e) =>
                                                                    e.stopPropagation()
                                                                }
                                                                size="sm"
                                                                variant="ghost"
                                                            >
                                                                <XMarkIcon className="h-5 w-5" />
                                                            </Button>
                                                        </div>
                                                    </motion.div>
                                                );
                                            }}
                                        />
                                    );
                                })()
                            ) : (
                                <div className="py-8 text-center">
                                    <PuzzlePieceIcon className="mx-auto mb-4 h-12 w-12 text-muted opacity-50" />
                                    <p className="mb-4 text-muted">No addons in this group</p>
                                    <Button
                                        leftIcon={<PlusIcon className="h-4 w-4" />}
                                        onClick={() => setIsAddAddonModalOpen(true)}
                                        size="sm"
                                        variant="secondary"
                                    >
                                        Add First Addon
                                    </Button>
                                </div>
                            )}
                        </Card>
                    </PageSection>

                    {/* Charts Section */}
                    <PageSection className="mt-8 mb-8" delay={0.3}>
                        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
                            {isLoadingCharts ? (
                                <div className="col-span-2 py-16 text-center">
                                    <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-surface-hover">
                                        <div className="h-8 w-8 animate-spin rounded-full border-2 border-current border-t-transparent text-primary" />
                                    </div>
                                    <p className="text-muted">Loading chart data...</p>
                                </div>
                            ) : watchTimeData.length > 0 && groupUsers.length > 0 ? (
                                <>
                                    <GroupWatchTimeChart data={watchTimeData} users={groupUsers} />
                                    <GroupContentBreakdownChart
                                        data={contentBreakdownData}
                                        users={groupUsers}
                                    />
                                </>
                            ) : (
                                <div className="col-span-2 py-16 text-center">
                                    <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-surface-hover">
                                        <ChartBarIcon className="h-8 w-8 text-muted" />
                                    </div>
                                    <h3 className="mb-2 font-medium text-default text-lg">
                                        No Activity Data
                                    </h3>
                                    <p className="text-muted">
                                        Watch time data will appear once users start streaming
                                        content.
                                    </p>
                                </div>
                            )}
                        </div>
                    </PageSection>
                </div>
            </div>

            {/* Delete Confirmation Modal */}
            <ConfirmModal
                confirmText={isDeleting ? "Deleting..." : "Delete Group"}
                description={`Are you sure you want to delete "${group?.name || "this group"}"? This will remove all member associations but won't delete the users themselves.`}
                isLoading={isDeleting}
                isOpen={isDeleteModalOpen}
                onClose={() => setIsDeleteModalOpen(false)}
                onConfirm={handleDelete}
                title="Delete Group"
                variant="danger"
            />

            {/* Edit Group Modal */}
            <Modal
                description="Update group details"
                isOpen={isEditModalOpen}
                onClose={() => setIsEditModalOpen(false)}
                size="md"
                title="Edit Group"
            >
                <EditGroupForm group={group} onClose={() => setIsEditModalOpen(false)} />
            </Modal>

            {/* Add Member Modal */}
            <Modal
                description="Add a user to this group"
                isOpen={isAddMemberModalOpen}
                onClose={() => setIsAddMemberModalOpen(false)}
                size="md"
                title="Add Member"
            >
                <AddMemberForm
                    existingUserIds={groupUsers.map((u) => u.id)}
                    groupId={params.id as string}
                    onClose={() => setIsAddMemberModalOpen(false)}
                    onUsersChanged={async () => {
                        setUsersSyncing(true);
                        await refetchData();
                        setUsersSyncing(false);
                    }}
                />
            </Modal>

            {/* Add Addon Modal */}
            <Modal
                description="Add an addon to this group"
                isOpen={isAddAddonModalOpen}
                onClose={() => setIsAddAddonModalOpen(false)}
                size="md"
                title="Add Addon"
            >
                <AddAddonForm
                    availableAddons={availableAddons}
                    onAdd={handleAddAddon}
                    onClose={() => setIsAddAddonModalOpen(false)}
                />
            </Modal>

            {/* Clear All Members Confirmation Modal */}
            <ConfirmModal
                confirmText={isClearing ? "Clearing..." : "Clear All Members"}
                description={`Are you sure you want to remove all ${groupUsers.length} members from this group? This will not delete the users, only remove them from the group.`}
                isLoading={isClearing}
                isOpen={isClearMembersModalOpen}
                onClose={() => setIsClearMembersModalOpen(false)}
                onConfirm={handleClearAllMembers}
                title="Clear All Members"
                variant="danger"
            />

            {/* Clear All Addons Confirmation Modal */}
            <ConfirmModal
                confirmText={isClearing ? "Clearing..." : "Clear All Addons"}
                description={`Are you sure you want to remove all ${addons.length} addon${addons.length === 1 ? "" : "s"} from this group? Users will need to be re-synced after this.`}
                isLoading={isClearing}
                isOpen={isClearAddonsModalOpen}
                onClose={() => setIsClearAddonsModalOpen(false)}
                onConfirm={handleClearAllAddons}
                title="Clear All Addons"
                variant="danger"
            />
        </>
    );
}

// Edit Group Form Component
function EditGroupForm({ group, onClose }: { group: Group | null; onClose: () => void }) {
    const [isLoading, setIsLoading] = useState(false);
    const [name, setName] = useState(group?.name || "");
    const [description, setDescription] = useState(group?.description || "");
    const [selectedColorIndex, setSelectedColorIndex] = useState(group?.colorIndex ?? 0);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!group?.id) {
            return;
        }
        setIsLoading(true);
        try {
            await api.updateGroup(group.id, { colorIndex: selectedColorIndex, description, name });
            toast.success("Group updated successfully");
            onClose();
            window.location.reload();
        } catch (err) {
            toast.error(readErrorMessage(err, "Failed to update group"));
        } finally {
            setIsLoading(false);
        }
    };

    return (
        <form className="space-y-6" onSubmit={handleSubmit}>
            <Input
                label="Group Name"
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g., Family, Premium, Movies"
                required
                value={name}
            />

            <Input
                label="Description"
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Brief description of this group"
                value={description}
            />

            <div>
                <label className="mb-3 block font-medium text-muted text-sm">Group Color</label>
                <AvatarColorSwatches onChange={setSelectedColorIndex} value={selectedColorIndex} />
            </div>

            <div className="flex justify-end gap-3 pt-4">
                <Button onClick={onClose} type="button" variant="secondary">
                    Cancel
                </Button>
                <Button isLoading={isLoading} type="submit" variant="primary">
                    Save Changes
                </Button>
            </div>
        </form>
    );
}

// Add Member Form Component
function AddMemberForm({
    groupId,
    existingUserIds,
    onClose,
    onUsersChanged,
}: {
    groupId: string;
    existingUserIds: string[];
    onClose: () => void;
    onUsersChanged?: () => void;
}) {
    const [isLoading, setIsLoading] = useState(false);
    const [searchQuery, setSearchQuery] = useState("");
    const [selectedUserIds, setSelectedUserIds] = useState<Set<string>>(new Set());

    // Fetch available users
    const [availableUsers, setAvailableUsers] = useState<User[]>([]);

    useEffect(() => {
        api.getUsers().then(setAvailableUsers).catch(console.error);
    }, []);

    // Filter out users already in the group
    const existingUserSet = new Set(existingUserIds);
    const filteredUsers = availableUsers.filter((user) => {
        // Exclude users already in the group
        if (existingUserSet.has(user.id)) {
            return false;
        }
        const name = user.name || user.username || "";
        return (
            name.toLowerCase().includes(searchQuery.toLowerCase()) ||
            user.email?.toLowerCase().includes(searchQuery.toLowerCase())
        );
    });

    const toggleUser = (userId: string) => {
        setSelectedUserIds((prev) => {
            const next = new Set(prev);
            if (next.has(userId)) {
                next.delete(userId);
            } else {
                next.add(userId);
            }
            return next;
        });
    };

    const handleAddSelected = async () => {
        if (selectedUserIds.size === 0) {
            return;
        }

        setIsLoading(true);
        try {
            const _usersToAdd = availableUsers.filter((u) => selectedUserIds.has(u.id));
            for (const userId of selectedUserIds) {
                await api.addUserToGroup(groupId, userId);
            }
            const count = selectedUserIds.size;
            toast.success(`${count} user${count > 1 ? "s" : ""} added to group`);
            onClose();
            if (onUsersChanged) {
                onUsersChanged();
            }
        } catch (err) {
            toast.error(readErrorMessage(err, "Failed to add users to group"));
        } finally {
            setIsLoading(false);
        }
    };

    return (
        <div className="space-y-4">
            <Input
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search users..."
                value={searchQuery}
            />

            <div className="max-h-64 space-y-2 overflow-y-auto">
                {filteredUsers.map((user) => {
                    const displayName = user.name || user.username || "Unknown";
                    const isSelected = selectedUserIds.has(user.id);
                    return (
                        <motion.div
                            className={`flex cursor-pointer items-center gap-3 rounded-xl p-3 transition-colors ${
                                isSelected
                                    ? "border border-primary bg-primary/10"
                                    : "bg-surface-hover hover:bg-surface"
                            }`}
                            key={user.id}
                            onClick={() => toggleUser(user.id)}
                        >
                            <SelectionCheckbox
                                checked={isSelected}
                                onChange={() => toggleUser(user.id)}
                            />
                            <UserAvatar
                                colorIndex={user.colorIndex}
                                email={user.email}
                                name={displayName}
                                size="sm"
                                src={user.avatarUrl ?? undefined}
                                useGravatar={user.useGravatar}
                                userId={user.id}
                            />
                            <div className="min-w-0 flex-1">
                                <p className="truncate font-medium text-default">{displayName}</p>
                                <p className="truncate text-muted text-sm">
                                    {displayEmail(user.email)}
                                </p>
                            </div>
                        </motion.div>
                    );
                })}

                {filteredUsers.length === 0 && (
                    <div className="py-8 text-center text-muted">
                        <UsersIcon className="mx-auto mb-2 h-8 w-8 opacity-50" />
                        <p>No users found</p>
                    </div>
                )}
            </div>

            <div className="flex justify-between pt-4">
                <Button onClick={onClose} variant="secondary">
                    Cancel
                </Button>
                <Button
                    disabled={selectedUserIds.size === 0}
                    isLoading={isLoading}
                    onClick={handleAddSelected}
                    variant="primary"
                >
                    Add {selectedUserIds.size > 0 ? `(${selectedUserIds.size})` : ""}
                </Button>
            </div>
        </div>
    );
}

// Add Addon Form Component
interface AddAddonFormProps {
    availableAddons: Addon[];
    onAdd: (addonIds: string[], addonNames: string[]) => void;
    onClose: () => void;
}

function AddAddonForm({ availableAddons, onAdd, onClose }: AddAddonFormProps) {
    const [searchQuery, setSearchQuery] = useState("");
    const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

    const filteredAddons = availableAddons.filter(
        (addon) =>
            addon.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
            addon.description?.toLowerCase().includes(searchQuery.toLowerCase())
    );

    const toggleSelect = (addonId: string) => {
        setSelectedIds((prev) => {
            const next = new Set(prev);
            if (next.has(addonId)) {
                next.delete(addonId);
            } else {
                next.add(addonId);
            }
            return next;
        });
    };

    const handleAdd = () => {
        const selectedAddons = availableAddons.filter((a) => selectedIds.has(a.id));
        onAdd(
            selectedAddons.map((a) => a.id),
            selectedAddons.map((a) => a.name)
        );
    };

    return (
        <div className="space-y-4">
            <Input
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search addons..."
                value={searchQuery}
            />

            <div className="max-h-64 space-y-2 overflow-y-auto">
                {filteredAddons.map((addon) => {
                    // Extract logo from various sources: customLogo > manifest.logo > logo > iconUrl
                    const anyAddon = addon;
                    const logo =
                        anyAddon.customLogo ||
                        anyAddon.manifest?.logo ||
                        addon.logo ||
                        anyAddon.iconUrl;
                    const isSelected = selectedIds.has(addon.id);
                    return (
                        <motion.div
                            className={`flex cursor-pointer items-center gap-3 rounded-xl p-3 transition-colors ${
                                isSelected
                                    ? "border border-primary bg-primary-muted"
                                    : "bg-surface-hover hover:bg-surface"
                            }`}
                            key={addon.id}
                            onClick={() => toggleSelect(addon.id)}
                            whileHover={{ x: 4 }}
                        >
                            <div className="flex shrink-0 items-center justify-center">
                                <div
                                    className={`flex h-5 w-5 items-center justify-center rounded border-2 ${
                                        isSelected ? "border-primary bg-primary" : "border-default"
                                    }`}
                                >
                                    {isSelected && <CheckIcon className="h-3 w-3 text-white" />}
                                </div>
                            </div>
                            <div className="shrink-0">
                                {logo ? (
                                    <img
                                        alt={addon.name}
                                        className="h-8 w-8 rounded-md object-contain"
                                        src={logo}
                                    />
                                ) : (
                                    <PuzzlePieceIcon className="h-6 w-6 text-primary" />
                                )}
                            </div>
                            <div className="min-w-0 flex-1">
                                <div className="mb-0.5 flex items-center gap-2">
                                    <p className="truncate font-medium text-default">
                                        {addon.name}
                                    </p>
                                    {addon.version && (
                                        <VersionBadge size="sm" version={addon.version} />
                                    )}
                                </div>
                                {addon.description && (
                                    <p className="truncate text-muted text-xs">
                                        {addon.description}
                                    </p>
                                )}
                                {addon.resources && addon.resources.length > 0 && (
                                    <div className="mt-1 flex flex-wrap gap-1">
                                        {addon.resources.slice(0, 3).map((res: string) => (
                                            <ResourceBadge key={res} resource={res} />
                                        ))}
                                    </div>
                                )}
                            </div>
                        </motion.div>
                    );
                })}

                {filteredAddons.length === 0 && (
                    <div className="py-8 text-center text-muted">
                        <PuzzlePieceIcon className="mx-auto mb-2 h-8 w-8 opacity-50" />
                        {/* Pasting a URL here is a natural mistake - the box looks like
                somewhere a manifest URL should go, but it only filters the
                addons this account already has. Say so, instead of the
                misleading "no addons found". */}
                        {/\/trax\//.test(searchQuery) ? (
                            <div className="mx-auto max-w-sm space-y-1">
                                <p className="font-medium text-default">
                                    SlickTrax can&apos;t be added to a group
                                </p>
                                <p className="text-xs">
                                    Its manifest URL contains one person&apos;s private token -
                                    handing it to a group would give everyone that user&apos;s
                                    watchlist and history, and let them change it. It is enabled per
                                    user instead: Addons → Browse → SlickTrax → Configure, or the
                                    toggle on the user&apos;s own page.
                                </p>
                            </div>
                        ) : /^https?:\/\//i.test(searchQuery.trim()) ? (
                            <div className="mx-auto max-w-sm space-y-1">
                                <p className="font-medium text-default">
                                    This box searches, it doesn&apos;t import
                                </p>
                                <p className="text-xs">
                                    It only filters addons this account already has. To bring a new
                                    addon in from a URL, add it on the Addons page first - then it
                                    appears here to assign.
                                </p>
                            </div>
                        ) : (
                            <p>
                                {availableAddons.length === 0
                                    ? "All addons are already in this group"
                                    : "No addons found"}
                            </p>
                        )}
                    </div>
                )}
            </div>

            <div className="flex justify-between pt-4">
                <Button onClick={onClose} variant="ghost">
                    Cancel
                </Button>
                <Button disabled={selectedIds.size === 0} onClick={handleAdd} variant="primary">
                    Add {selectedIds.size > 0 ? `(${selectedIds.size})` : ""}
                </Button>
            </div>
        </div>
    );
}
