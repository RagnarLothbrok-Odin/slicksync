"use client";

import type { DragEndEvent } from "@dnd-kit/core";
import {
    rectSortingStrategy,
    SortableContext,
    verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import {
    ArrowDownTrayIcon,
    ArrowPathIcon,
    Bars3Icon,
    CheckIcon,
    ClockIcon,
    ExclamationTriangleIcon,
    EyeIcon,
    PlusIcon,
    PuzzlePieceIcon,
    TrashIcon,
    UserGroupIcon,
    UsersIcon,
    XMarkIcon,
} from "@heroicons/react/24/outline";
import { AnimatePresence, LayoutGroup, motion } from "framer-motion";
import Head from "next/head";
import Link from "next/link";
import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { HouseholdsCard } from "@/components/jellyfin/HouseholdCard";
import { Header } from "@/components/layout/Header";
import {
    NebulaCompactStatCard,
    NebulaGlassStripe,
    NebulaPageHeading,
} from "@/components/layout/NebulaTopbar";
import { StaggerContainer, StaggerItem } from "@/components/layout/PageContainer";
import { CreateUserModal } from "@/components/modals/CreateUserModal";
import { useVaultDrag } from "@/components/providers/VaultDragContext";
import { TVFocusable } from "@/components/tv/TVFocusable";
import { TVLink } from "@/components/tv/TVLink";
import { TVPageProvider } from "@/components/tv/TVPageProvider";
import {
    Badge,
    Button,
    Card,
    ConfirmModal,
    ContextMenu,
    PageToolbar,
    SelectionCheckbox,
    StatusBadge,
    SyncBadge,
    ToggleSwitch,
    UserAvatar,
    useContextMenu,
} from "@/components/ui";
import { useSortableDragState } from "@/components/ui/DragSortable";
import { toast } from "@/components/ui/Toast";
import { CatchUpButton } from "@/components/user/CatchUpButton";
import { LimitsButton } from "@/components/user/LimitsButton";
import { ProfilesCard } from "@/components/user/ProfilesCard";
import { api, type Group, type LimitsSummary, type MetricsData, type User } from "@/lib/api";
import { useIsTV } from "@/lib/hooks/useIsTV";
import { useLastKnown } from "@/lib/hooks/useLastKnown";
import { useLongPress } from "@/lib/hooks/useLongPress";
import { useLayoutMode } from "@/lib/layout-mode";
import {
    displayEmail,
    hasAddonList,
    providerBadgeVariant,
    providerLabel,
    providerTypeLabel,
} from "@/lib/providers";
import { formatLastSync, formatRelativeTime } from "@/lib/relativeTime";
import { useTheme } from "@/lib/theme";
import { useDefaultViewMode } from "@/lib/viewMode";

// User type for display
interface UserDisplay {
    addonCount: number;
    avatarUrl?: string | null;
    colorIndex?: number;
    /** Not seen watching for DORMANT_DAYS (or never, and added longer ago than that). */
    dormant: boolean;
    email?: string;
    groups: string[];
    id: string;
    jellyfinServer?: string | null;
    jellyfinServerKind?: "jellyfin" | "aiostreams" | "aiometadata";
    jellyfinServerLabel?: string;
    /** "2h ago", or 'Never' - see server/utils/lastSeen.js. */
    lastSeen: string;
    lastSync: string;
    name: string;
    /** Which Nuvio profile's addons this user manages; 1 is the primary. */
    nuvioProfileId?: number;
    providerConnectionError?: string | null;
    providerType?: "stremio" | "nuvio" | "jellyfin";
    secondaryProviderType?: "stremio" | "nuvio" | "jellyfin" | null;
    status: "active" | "expired" | "pending";
    useGravatar?: boolean;
    watchTime: number;
}

// Same 30 days Metrics uses for "at risk".
const DORMANT_DAYS = 30;

function isDormant(lastActive?: string | null, createdAt?: string | null): boolean {
    const since = lastActive || createdAt;
    if (!since) {
        return false;
    }
    const t = new Date(since).getTime();
    return Number.isFinite(t) && Date.now() - t >= DORMANT_DAYS * 86_400_000;
}

function formatWatchTime(minutes: number): string {
    if (minutes < 60) {
        return `${minutes}m`;
    }
    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;
    if (hours < 24) {
        return `${hours}h ${mins}m`;
    }
    const days = Math.floor(hours / 24);
    const remainingHours = hours % 24;
    return `${days}d ${remainingHours}h`;
}

export default function UsersPage() {
    const { layoutMode } = useLayoutMode();
    const isTV = useIsTV();
    const Wrapper = isTV ? TVPageProvider : Fragment;
    const { hideSensitive } = useTheme();
    const [searchQuery, setSearchQuery] = useState("");
    const [peopleFilter, setPeopleFilter] = useState<"all" | "dormant">("all");
    const { viewMode, setViewMode } = useDefaultViewMode();
    const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);

    // Data state
    const [users, setUsers] = useState<User[]>([]);
    // Who has a daily limit, bedtime, age limit or pause - one read for every
    // Limits pill on the page (people, profiles and household users).
    const [limits, setLimits] = useState<Record<string, LimitsSummary>>({});
    const [groups, setGroups] = useState<Group[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<Error | null>(null);
    // Live nowPlaying feed, for the "Active" stat below - see its own comment
    // for why this is a separate fetch from users/groups.
    const [nowPlaying, setNowPlaying] = useState<MetricsData["nowPlaying"]>([]);
    useEffect(() => {
        if (!users.length) {
            return;
        }
        api.getLimitsOverview()
            .then(setLimits)
            .catch(() => undefined);
    }, [users.length]);

    // Multi-select state
    const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
    const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);
    const [isReconnectModalOpen, setIsReconnectModalOpen] = useState(false);
    const [reconnectUserId, setReconnectUserId] = useState<string | null>(null);
    const [reconnectUserName, setReconnectUserName] = useState<string>("");
    const [reconnectProvider, setReconnectProvider] = useState<string>("stremio");
    const [isSyncing, setIsSyncing] = useState(false);
    const [syncingUserIds, setSyncingUserIds] = useState<Set<string>>(new Set());
    // Account Guard actions (see server/utils/accountGuard.js). Re-assert is a
    // normal sync - syncing records a fresh baseline, which IS the all-clear;
    // Accept adopts the outside change as the new baseline instead.
    const [guardBusyId, setGuardBusyId] = useState<string | null>(null);
    const [isDeleting, setIsDeleting] = useState(false);

    // Single item delete state (for quick action menu)
    const [deleteTarget, setDeleteTarget] = useState<UserDisplay | null>(null);

    // Fetch users and groups
    // Instant navigation: show the last-known users/groups immediately while
    // the fetch below refreshes them - see useLastKnown's own comment.
    useLastKnown<User[]>("/users", (cached) => {
        setUsers(cached);
        setIsLoading(false);
    });
    useLastKnown<Group[]>("/groups", (cached) => setGroups(cached));

    useEffect(() => {
        const fetchData = async () => {
            setIsLoading(true);
            setError(null);
            try {
                const [usersData, groupsData] = await Promise.all([
                    api.getUsers(),
                    api.getGroups(),
                ]);
                setUsers(usersData);
                setGroups(groupsData);
            } catch (err) {
                setError(err as Error);
                toast.error("Failed to load users");
            } finally {
                setIsLoading(false);
            }
        };

        fetchData();
    }, []);

    // Live nowPlaying, for the "Active" stat below - separate from the
    // users/groups fetch above so a metrics-endpoint hiccup can't block the
    // page's main data from loading. Period value doesn't matter (nowPlaying
    // is live, not period-filtered), 30d just matches what the rest of the
    // app already requests so responses share the server-side cache.
    useEffect(() => {
        api.getMetrics("30d")
            .then((data) => setNowPlaying(data.nowPlaying || []))
            .catch(() => undefined);
    }, []);

    // Transform users for display
    const usersDisplay = useMemo<UserDisplay[]>(() => {
        const groupMap = new Map(groups.map((g) => [g.id, g]));

        return users.map((user) => {
            // Get group names from groupIds or groups array (handle undefined)
            let userGroups: string[] = [];
            if (user.groups && Array.isArray(user.groups)) {
                // If groups is already an array of names
                userGroups = user.groups;
            } else if (user.groupIds && Array.isArray(user.groupIds)) {
                // Map groupIds to group names
                userGroups = user.groupIds
                    .map((id) => groupMap.get(id)?.name)
                    .filter(Boolean) as string[];
            } else if (user.groupId) {
                // Single groupId (legacy)
                const group = groupMap.get(user.groupId);
                if (group) {
                    userGroups = [group.name];
                }
            }

            // Determine status
            let status: "active" | "expired" | "pending" = "active";
            if (user.status) {
                status = user.status === "inactive" ? "expired" : (user.status as any);
            } else if (user.expiresAt) {
                const expiresAt = new Date(user.expiresAt);
                if (expiresAt < new Date()) {
                    status = "expired";
                }
            } else if (user.isActive === false) {
                status = "expired";
            }
            // TODO: Determine pending status based on actual user state

            // Real value off the user's lastSyncedAt column. This used to be the
            // literal string 'Unknown', so the Last sync column showed 'Unknown' for
            // every user on every instance - the data was there, the API response
            // just wasn't carrying it.
            const lastSync = formatLastSync(user.lastSyncedAt);

            // Get username (prefer username over name)
            const userName = user.username || user.name || "Unnamed User";

            return {
                addonCount: user.stremioAddonsCount || user.addons || 0,
                avatarUrl: (user as any).avatarUrl,
                colorIndex: user.colorIndex,
                dormant: isDormant(user.lastActive, user.createdAt),
                email: user.email,
                groups: userGroups,
                id: user.id,
                jellyfinServer: user.jellyfinServer,
                jellyfinServerKind: user.jellyfinServerKind,
                jellyfinServerLabel: user.jellyfinServerLabel,
                lastSeen: formatRelativeTime(user.lastActive) ?? "Never",
                lastSync,
                name: userName,
                nuvioProfileId: user.nuvioProfileId ?? 1,
                providerConnectionError: (user as any).providerConnectionError || null,
                providerType: user.providerType || "stremio",
                secondaryProviderType: (user as any).secondaryProviderType || null,
                status,
                useGravatar: user.useGravatar,
                watchTime: (user as any).watchTime || 0, // Use watchTime from API
            };
        });
    }, [users, groups]);

    const dormantCount = usersDisplay.filter((u) => u.dormant).length;
    const filteredUsers = usersDisplay.filter(
        (user) =>
            (peopleFilter === "all" || user.dormant) &&
            ((user.name || "").toLowerCase().includes(searchQuery.toLowerCase()) ||
                (user.email || "").toLowerCase().includes(searchQuery.toLowerCase()))
    );

    // Register this page's drag-end logic with the layout-level DndContext,
    // same shared mechanism Addons/Vault already use - only one page is ever
    // mounted at a time, so there's no cross-page collision despite the
    // "currently registered handler" being a single shared ref.
    const { registerDragEndHandler } = useVaultDrag();
    useEffect(() => {
        const handleDragEnd = (event: DragEndEvent) => {
            const { active, over } = event;
            if (!over || active.id === over.id) {
                return;
            }
            const oldIndex = filteredUsers.findIndex((u) => u.id === active.id);
            const newIndex = filteredUsers.findIndex((u) => u.id === over.id);
            if (oldIndex === -1 || newIndex === -1) {
                return;
            }
            const reorderedIds = filteredUsers.map((u) => u.id);
            const [movedId] = reorderedIds.splice(oldIndex, 1);
            reorderedIds.splice(newIndex, 0, movedId);
            setUsers((prev) => {
                const byId = new Map(prev.map((u) => [u.id, u]));
                const reorderedUsers = reorderedIds
                    .map((id) => byId.get(id))
                    .filter((u): u is User => !!u);
                const rest = prev.filter((u) => !reorderedIds.includes(u.id));
                return [...reorderedUsers, ...rest];
            });
            api.reorderUsers(reorderedIds).catch((err: any) => {
                toast.error(err.message || "Failed to save new order");
            });
        };
        return registerDragEndHandler(handleDragEnd);
    }, [filteredUsers, registerDragEndHandler]);

    // Nebula's stat row - real counts from the same usersDisplay data the
    // grid/table already render, not a new fetch.
    // "Active" here is who's watching right now (live nowPlaying, deduped by
    // user id) - same fix as Dashboard/Activity/Metrics' "Active Users",
    // applied here per explicit request despite this stat previously meaning
    // account status (not expired) paired with the "Expired" stat next to it.
    // That account-status breakdown is deliberately NOT removed - "Expired"
    // stays as-is, and each user row's own status badge still shows it - only
    // this one stat's own meaning changed. The two no longer sum to Total
    // Users as a result (they measure different things now); that's expected.
    const activeCount = new Set(nowPlaying.map((np) => np.user.id)).size;
    const expiredCount = usersDisplay.filter((u) => u.status === "expired").length;

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
        setSelectedIds(new Set(filteredUsers.map((u) => u.id)));
    }, [filteredUsers]);

    const deselectAll = useCallback(() => {
        setSelectedIds(new Set());
    }, []);

    const refreshUsersQuietly = useCallback(async () => {
        try {
            setUsers(await api.getUsers());
        } catch {
            /* keep last known list */
        }
    }, []);

    // People signed in to an AIOStreams or AIOMetadata configuration, whose
    // household may have come along as profiles.
    const householdOwners = useMemo(
        () =>
            users.filter(
                (u) =>
                    u.providerType === "jellyfin" &&
                    (u.jellyfinServerKind === "aiostreams" ||
                        u.jellyfinServerKind === "aiometadata")
            ),
        [users]
    );

    // The Nuvio profiles and household cards under the list load their own
    // data. Fetched here first, alongside the list, so the whole page appears
    // at once instead of the cards popping in one after another; on a return
    // visit they start from what this browser last saw and nothing waits.
    const [extrasReady, setExtrasReady] = useState(false);

    // One entry per Nuvio login: everyone on it shares its email, and the
    // person on its lowest profile - normally the main one - stands for it.
    const nuvioLogins = useMemo(() => {
        const byLogin = new Map<string, User[]>();
        for (const u of users) {
            if (u.providerType !== "nuvio") {
                continue;
            }
            const key = (u.email || u.id).toLowerCase();
            if (!byLogin.has(key)) {
                byLogin.set(key, []);
            }
            byLogin.get(key)!.push(u);
        }
        return [...byLogin.values()].map((people) => {
            const anchor = [...people].sort(
                (a, b) => (a.nuvioProfileId ?? 1) - (b.nuvioProfileId ?? 1)
            )[0];
            return { anchorId: anchor.id, label: `${anchor.username}'s login` };
        });
    }, [users]);

    useEffect(() => {
        if (isLoading) {
            return;
        }
        const endpoints = [
            ...nuvioLogins.map((l) => `/users/${encodeURIComponent(l.anchorId)}/profiles`),
            ...householdOwners.map((o) => `/jellyfin/users/${encodeURIComponent(o.id)}/household`),
        ];
        if (endpoints.every((e) => api.peekGet(e) !== undefined)) {
            setExtrasReady(true);
            return;
        }
        let cancelled = false;
        Promise.allSettled([
            ...nuvioLogins.map((l) => api.getProfiles(l.anchorId)),
            ...householdOwners.map((o) => api.getHousehold(o.id)),
        ]).then(() => {
            if (!cancelled) {
                setExtrasReady(true);
            }
        });
        return () => {
            cancelled = true;
        };
    }, [isLoading, nuvioLogins, householdOwners]);

    const handleGuardReassert = useCallback(
        async (id: string, name: string) => {
            setGuardBusyId(id);
            try {
                await api.syncUser(id);
                await refreshUsersQuietly();
                toast.success(`${name} re-synced - SlickSync's setup is back on the account`);
            } catch (err) {
                toast.error(err instanceof Error ? err.message : `Failed to sync ${name}`);
            } finally {
                setGuardBusyId(null);
            }
        },
        [refreshUsersQuietly]
    );

    const handleGuardAccept = useCallback(
        async (id: string, name: string) => {
            setGuardBusyId(id);
            try {
                await api.acceptGuardChange(id);
                await refreshUsersQuietly();
                toast.success(`Kept the outside change to ${name}'s account`);
            } catch (err) {
                toast.error(err instanceof Error ? err.message : "Failed to accept the change");
            } finally {
                setGuardBusyId(null);
            }
        },
        [refreshUsersQuietly]
    );

    const handleSyncSelected = useCallback(async () => {
        setIsSyncing(true);
        const ids = Array.from(selectedIds);
        let success = 0;

        for (const id of ids) {
            try {
                await api.syncUser(id);
                success++;
            } catch (err) {
                console.error("Failed to sync user:", err);
            }
        }

        setIsSyncing(false);
        if (success > 0) {
            toast.success(`Synced ${success} user${success === 1 ? "" : "s"} successfully`);
        }
        setSelectedIds(new Set());
        // Refresh users
        try {
            const usersData = await api.getUsers();
            setUsers(usersData);
        } catch (err) {
            console.error("Failed to refresh users:", err);
        }
    }, [selectedIds]);

    const handleDeleteSelected = useCallback(async () => {
        setIsDeleting(true);
        const ids = Array.from(selectedIds);
        let success = 0;

        for (const id of ids) {
            try {
                await api.deleteUser(id);
                success++;
            } catch (err) {
                console.error("Failed to delete user:", err);
            }
        }

        setIsDeleting(false);
        setIsDeleteModalOpen(false);
        if (success > 0) {
            toast.success(`Deleted ${success} user${success === 1 ? "" : "s"} successfully`);
            // Refresh users
            try {
                const usersData = await api.getUsers();
                setUsers(usersData);
            } catch (err) {
                console.error("Failed to refresh users:", err);
            }
        }
        setSelectedIds(new Set());
    }, [selectedIds]);

    // Delete single user (from quick action menu)
    const handleDeleteSingle = useCallback(async () => {
        if (!deleteTarget) {
            return;
        }
        setIsDeleting(true);
        try {
            await api.deleteUser(deleteTarget.id);
            toast.success(`${deleteTarget.name} deleted successfully`);
            // Refresh users
            try {
                const usersData = await api.getUsers();
                setUsers(usersData);
            } catch (err) {
                console.error("Failed to refresh users:", err);
            }
        } catch (err) {
            toast.error(`Failed to delete ${deleteTarget.name}`);
            console.error("Failed to delete user:", err);
        } finally {
            setIsDeleting(false);
            setDeleteTarget(null);
        }
    }, [deleteTarget]);

    const hasSelection = selectedIds.size > 0;

    const handleSyncStart = useCallback((userId: string) => {
        setSyncingUserIds((prev) => {
            const newSet = new Set(prev);
            newSet.add(userId);
            return newSet;
        });
    }, []);

    const handleSyncEnd = useCallback((userId: string) => {
        setSyncingUserIds((prev) => {
            const nextSet = new Set(prev);
            nextSet.delete(userId);
            return nextSet;
        });
    }, []);

    const handleSyncAll = async () => {
        setIsSyncing(true);
        setSyncingUserIds(new Set(users.map((u) => u.id)));
        try {
            const userIds = users.map((u) => u.id);
            let success = 0;
            for (const id of userIds) {
                try {
                    await api.syncUser(id);
                    success++;
                } catch (err) {
                    console.error("Failed to sync user:", err);
                }
                // Remove from syncing set as each completes - this triggers the badge to refetch status
                setSyncingUserIds((prev) => {
                    const nextSet = new Set(prev);
                    nextSet.delete(id);
                    return nextSet;
                });
            }
            if (success > 0) {
                toast.success(`Synced ${success} user${success === 1 ? "" : "s"} successfully`);
            }
            const usersData = await api.getUsers();
            setUsers(usersData);
        } catch (err: any) {
            toast.error(err.message || "Failed to sync all users");
        } finally {
            setIsSyncing(false);
            setSyncingUserIds(new Set());
        }
    };

    const syncAllButtonInner = (
        <Button
            disabled={isSyncing}
            leftIcon={<ArrowPathIcon className={`h-5 w-5 ${isSyncing ? "animate-spin" : ""}`} />}
            onClick={handleSyncAll}
            variant="secondary"
        >
            {isSyncing ? "Syncing..." : "Sync All"}
        </Button>
    );
    const syncAllButton = isTV ? (
        <TVFocusable onEnterPress={handleSyncAll}>{syncAllButtonInner}</TVFocusable>
    ) : (
        syncAllButtonInner
    );

    return (
        <Wrapper>
            <Head>
                <title>SlickSync - Users</title>
            </Head>
            {layoutMode !== "nebula" && (
                <Header
                    actions={syncAllButton}
                    subtitle={
                        isLoading
                            ? "Loading..."
                            : `${users.length} total user${users.length === 1 ? "" : "s"}`
                    }
                    title="Users"
                />
            )}

            {/* Nebula: same 72rem centered column as Dashboard/Activity (inline
          style, not a max-w-* class - see PageContainer.tsx for why), with
          the stat row + toolbar + grid/list all inside one glass panel.
          Current has no such enclosing panel at all - each card just floats
          on the page background - so this is a real structural addition,
          not a recolor. UserCard itself is completely unchanged either way. */}
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
                            actions={syncAllButton}
                            subtitle={
                                isLoading
                                    ? "Loading..."
                                    : `${users.length} total user${users.length === 1 ? "" : "s"}`
                            }
                            title="Users"
                        />
                    )}
                    {layoutMode === "nebula" && (
                        <div className="mb-5 grid grid-cols-3 gap-2 sm:gap-4">
                            <NebulaCompactStatCard
                                colorIndex={0}
                                icon={<UsersIcon className="h-4 w-4 md:h-6 md:w-6" />}
                                label="Total Users"
                                value={isLoading ? "..." : users.length}
                            />
                            <NebulaCompactStatCard
                                colorIndex={1}
                                icon={<CheckIcon className="h-4 w-4 md:h-6 md:w-6" />}
                                label="Watching now"
                                value={isLoading ? "..." : activeCount}
                            />
                            <NebulaCompactStatCard
                                colorIndex={0}
                                icon={<XMarkIcon className="h-4 w-4 md:h-6 md:w-6" />}
                                label="Expired"
                                value={isLoading ? "..." : expiredCount}
                            />
                        </div>
                    )}
                    {/* Account Guard: a provider account was changed outside SlickSync.
          One banner per affected user, gone the moment it's re-asserted or
          accepted - it lives up here, not inside a detail page, because the
          entire point of the guard is being impossible to miss. */}
                    {users
                        .filter((u) => u.guardExternal)
                        .map((u) => {
                            const ext = u.guardExternal!;
                            const name = u.username || "User";
                            const bits: string[] = [];
                            if (ext.added.length) {
                                bits.push(
                                    `${ext.added.length} addon${ext.added.length === 1 ? "" : "s"} added`
                                );
                            }
                            if (ext.removed.length) {
                                bits.push(`${ext.removed.length} removed`);
                            }
                            const names = [...ext.added, ...ext.removed]
                                .map((a) => a.name)
                                .filter(Boolean)
                                .slice(0, 3);
                            const total = ext.added.length + ext.removed.length;
                            return (
                                <div
                                    className="mb-4 flex flex-wrap items-center gap-3 rounded-2xl border px-4 py-3"
                                    key={`guard-${u.id}`}
                                    style={{
                                        background:
                                            "color-mix(in srgb, var(--color-warning) 10%, transparent)",
                                        borderColor:
                                            "color-mix(in srgb, var(--color-warning) 45%, transparent)",
                                    }}
                                >
                                    <ExclamationTriangleIcon className="h-5 w-5 shrink-0 text-warning" />
                                    <div className="min-w-0 flex-1">
                                        <p className="font-medium text-default text-sm">
                                            {name}&apos;s{" "}
                                            {ext.provider === "nuvio" ? "Nuvio" : "Stremio"} account
                                            was changed outside SlickSync
                                        </p>
                                        <p className="mt-0.5 text-muted text-xs">
                                            {bits.join(", ") || "The addon set changed"}
                                            {names.length
                                                ? ` (${names.join(", ")}${total > 3 ? ", ..." : ""})`
                                                : ""}{" "}
                                            - most likely another logged-in session. Re-assert to
                                            put SlickSync&apos;s setup back, or accept it as the new
                                            normal.
                                        </p>
                                    </div>
                                    <div className="flex shrink-0 items-center gap-2">
                                        <Button
                                            isLoading={guardBusyId === u.id}
                                            onClick={() => handleGuardReassert(u.id, name)}
                                            size="sm"
                                            variant="primary"
                                        >
                                            Re-assert
                                        </Button>
                                        <Button
                                            disabled={guardBusyId === u.id}
                                            onClick={() => handleGuardAccept(u.id, name)}
                                            size="sm"
                                            variant="ghost"
                                        >
                                            Accept change
                                        </Button>
                                    </div>
                                </div>
                            );
                        })}
                    <div className="interface-management-content">
                        {layoutMode === "nebula" && <NebulaGlassStripe />}
                        {/* Filters and controls */}
                        <PageToolbar
                            filterTabs={{
                                activeKey: peopleFilter,
                                layoutId: "users-people-filter",
                                onChange: (key) =>
                                    setPeopleFilter(key === "dormant" ? "dormant" : "all"),
                                options: [
                                    { key: "all", label: "All" },
                                    { count: dormantCount, key: "dormant", label: "Dormant" },
                                ],
                                visible: peopleFilter === "dormant" || dormantCount > 0,
                            }}
                            primaryAction={(() => {
                                const btn = (
                                    <Button
                                        leftIcon={<PlusIcon className="h-5 w-5" />}
                                        onClick={() => setIsCreateModalOpen(true)}
                                        variant="primary"
                                    >
                                        Add
                                    </Button>
                                );
                                return isTV ? (
                                    <TVFocusable onEnterPress={() => setIsCreateModalOpen(true)}>
                                        {btn}
                                    </TVFocusable>
                                ) : (
                                    btn
                                );
                            })()}
                            searchConfig={{
                                onChange: (value) => setSearchQuery(value),
                                placeholder: "Search users...",
                                value: searchQuery,
                            }}
                            selectionConfig={{
                                onDeselectAll: deselectAll,
                                onSelectAll: selectAll,
                                selectedCount: selectedIds.size,
                                totalCount: filteredUsers.length,
                            }}
                        />

                        {/* Loading state */}
                        {isLoading || !extrasReady ? (
                            <div className="py-16 text-center">
                                <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-surface-hover">
                                    <div className="h-8 w-8 animate-spin rounded-full border-2 border-current border-t-transparent text-primary" />
                                </div>
                                <p className="text-muted">Loading users...</p>
                            </div>
                        ) : error ? (
                            <div className="py-16 text-center">
                                <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-surface-hover">
                                    <XMarkIcon className="h-8 w-8 text-error" />
                                </div>
                                <h3 className="mb-2 font-medium text-default text-lg">
                                    Error Loading Users
                                </h3>
                                <p className="mb-4 text-muted">{error.message}</p>
                                <Button onClick={() => window.location.reload()} variant="primary">
                                    Retry
                                </Button>
                            </div>
                        ) : (
                            <>
                                {/* Users grid/list */}
                                <LayoutGroup>
                                    <AnimatePresence mode="popLayout">
                                        {viewMode === "grid" ? (
                                            <StaggerContainer
                                                className="grid grid-cols-1 gap-6 md:grid-cols-2 xl:grid-cols-3"
                                                key="grid"
                                            >
                                                <AnimatePresence mode="popLayout">
                                                    <SortableContext
                                                        items={filteredUsers.map((u) => u.id)}
                                                        strategy={rectSortingStrategy}
                                                    >
                                                        {filteredUsers.map((user) => (
                                                            <SortableUserWrapper
                                                                id={user.id}
                                                                key={user.id}
                                                            >
                                                                {(dragHandleProps) => (
                                                                    <StaggerItem>
                                                                        <UserCard
                                                                            dragHandleProps={
                                                                                dragHandleProps
                                                                            }
                                                                            focusable={isTV}
                                                                            isSelected={selectedIds.has(
                                                                                user.id
                                                                            )}
                                                                            limits={
                                                                                limits[user.id] ||
                                                                                null
                                                                            }
                                                                            onDelete={() =>
                                                                                setDeleteTarget(
                                                                                    user
                                                                                )
                                                                            }
                                                                            onReconnect={(
                                                                                userId,
                                                                                userName
                                                                            ) => {
                                                                                setReconnectUserId(
                                                                                    userId
                                                                                );
                                                                                setReconnectUserName(
                                                                                    userName
                                                                                );
                                                                                setReconnectProvider(
                                                                                    users.find(
                                                                                        (u) =>
                                                                                            u.id ===
                                                                                            userId
                                                                                    )
                                                                                        ?.providerType ||
                                                                                        "stremio"
                                                                                );
                                                                                setIsReconnectModalOpen(
                                                                                    true
                                                                                );
                                                                            }}
                                                                            onSyncEnd={
                                                                                handleSyncEnd
                                                                            }
                                                                            onSyncStart={
                                                                                handleSyncStart
                                                                            }
                                                                            onToggleSelect={() =>
                                                                                toggleSelect(
                                                                                    user.id
                                                                                )
                                                                            }
                                                                            onToggleStatus={(
                                                                                userId,
                                                                                newStatus
                                                                            ) => {
                                                                                setUsers((prev) =>
                                                                                    prev.map((u) =>
                                                                                        u.id ===
                                                                                        userId
                                                                                            ? {
                                                                                                  ...u,
                                                                                                  status: newStatus
                                                                                                      ? "active"
                                                                                                      : "inactive",
                                                                                              }
                                                                                            : u
                                                                                    )
                                                                                );
                                                                            }}
                                                                            syncingUserIds={
                                                                                syncingUserIds
                                                                            }
                                                                            user={user}
                                                                        />
                                                                    </StaggerItem>
                                                                )}
                                                            </SortableUserWrapper>
                                                        ))}
                                                    </SortableContext>
                                                </AnimatePresence>
                                            </StaggerContainer>
                                        ) : (
                                            <motion.div
                                                animate={{ opacity: 1 }}
                                                className="overflow-hidden overflow-x-auto rounded-2xl border border-default bg-surface"
                                                exit={{ opacity: 0 }}
                                                initial={{ opacity: 0 }}
                                                key="list"
                                                layout
                                            >
                                                <table className="w-full min-w-[600px]">
                                                    <thead>
                                                        <tr className="border-default border-b">
                                                            <th
                                                                aria-hidden="true"
                                                                className="w-8"
                                                            />
                                                            <th className="w-12 px-4 py-4 text-left">
                                                                <div
                                                                    className={`flex h-5 w-5 cursor-pointer items-center justify-center rounded border-2 transition-all ${
                                                                        hasSelection &&
                                                                        selectedIds.size ===
                                                                            filteredUsers.length
                                                                            ? "border-primary bg-primary"
                                                                            : "border-default hover:border-primary"
                                                                    }`}
                                                                    onClick={() =>
                                                                        hasSelection &&
                                                                        selectedIds.size ===
                                                                            filteredUsers.length
                                                                            ? deselectAll()
                                                                            : selectAll()
                                                                    }
                                                                >
                                                                    {hasSelection &&
                                                                        selectedIds.size ===
                                                                            filteredUsers.length && (
                                                                            <CheckIcon className="h-3 w-3 text-white" />
                                                                        )}
                                                                </div>
                                                            </th>
                                                            <th className="px-6 py-4 text-left font-medium text-muted text-sm">
                                                                User
                                                            </th>
                                                            <th className="px-6 py-4 text-left font-medium text-muted text-sm">
                                                                Status
                                                            </th>
                                                            <th className="px-6 py-4 text-left font-medium text-muted text-sm">
                                                                Watch Time
                                                            </th>
                                                            <th className="px-6 py-4 text-left font-medium text-muted text-sm">
                                                                Last Seen
                                                            </th>
                                                            <th className="px-6 py-4 text-left font-medium text-muted text-sm">
                                                                Groups
                                                            </th>
                                                            <th className="px-6 py-4 text-left font-medium text-muted text-sm">
                                                                Last Sync
                                                            </th>
                                                            <th className="px-6 py-4 text-left font-medium text-muted text-sm">
                                                                Actions
                                                            </th>
                                                        </tr>
                                                    </thead>
                                                    <tbody>
                                                        <SortableContext
                                                            items={filteredUsers.map((u) => u.id)}
                                                            strategy={verticalListSortingStrategy}
                                                        >
                                                            <AnimatePresence mode="popLayout">
                                                                {filteredUsers.map((user) => (
                                                                    <SortableUserRow
                                                                        className={`cursor-pointer border-default border-b transition-colors ${
                                                                            selectedIds.has(user.id)
                                                                                ? "bg-primary-muted"
                                                                                : "hover:bg-white/5"
                                                                        }`}
                                                                        id={user.id}
                                                                        key={user.id}
                                                                        onClick={() =>
                                                                            toggleSelect(user.id)
                                                                        }
                                                                    >
                                                                        <td className="px-4 py-4">
                                                                            <div
                                                                                className={`flex h-5 w-5 items-center justify-center rounded border-2 transition-all ${
                                                                                    selectedIds.has(
                                                                                        user.id
                                                                                    )
                                                                                        ? "border-primary bg-primary"
                                                                                        : "border-default"
                                                                                }`}
                                                                            >
                                                                                {selectedIds.has(
                                                                                    user.id
                                                                                ) && (
                                                                                    <CheckIcon className="h-3 w-3 text-white" />
                                                                                )}
                                                                            </div>
                                                                        </td>
                                                                        <td className="px-6 py-4">
                                                                            <TVLink
                                                                                className="group flex items-center gap-3"
                                                                                href={`/users/${user.id}`}
                                                                                onClick={(e) =>
                                                                                    e.stopPropagation()
                                                                                }
                                                                            >
                                                                                <UserAvatar
                                                                                    colorIndex={
                                                                                        user.colorIndex
                                                                                    }
                                                                                    email={
                                                                                        user.email
                                                                                    }
                                                                                    name={user.name}
                                                                                    size="sm"
                                                                                    src={
                                                                                        user.avatarUrl ||
                                                                                        undefined
                                                                                    }
                                                                                    useGravatar={
                                                                                        user.useGravatar
                                                                                    }
                                                                                    userId={user.id}
                                                                                />
                                                                                <div>
                                                                                    <div className="flex items-center gap-2">
                                                                                        <p className="truncate font-medium text-default transition-colors group-hover:text-primary">
                                                                                            {
                                                                                                user.name
                                                                                            }
                                                                                        </p>
                                                                                        <Badge
                                                                                            size="sm"
                                                                                            variant={providerBadgeVariant(
                                                                                                user
                                                                                            )}
                                                                                        >
                                                                                            {providerLabel(
                                                                                                user
                                                                                            )}
                                                                                        </Badge>
                                                                                        {user.providerType ===
                                                                                            "nuvio" &&
                                                                                            (user.nuvioProfileId ??
                                                                                                1) !==
                                                                                                1 && (
                                                                                                <Badge
                                                                                                    size="sm"
                                                                                                    variant="secondary"
                                                                                                >
                                                                                                    Profile{" "}
                                                                                                    {
                                                                                                        user.nuvioProfileId
                                                                                                    }
                                                                                                </Badge>
                                                                                            )}
                                                                                        {user.secondaryProviderType && (
                                                                                            <Badge
                                                                                                size="sm"
                                                                                                variant={providerBadgeVariant(
                                                                                                    {
                                                                                                        providerType:
                                                                                                            user.secondaryProviderType,
                                                                                                    }
                                                                                                )}
                                                                                            >
                                                                                                {providerTypeLabel(
                                                                                                    user.secondaryProviderType
                                                                                                )}
                                                                                            </Badge>
                                                                                        )}
                                                                                        {user.providerConnectionError && (
                                                                                            <ExclamationTriangleIcon
                                                                                                className="h-4 w-4 shrink-0 text-warning"
                                                                                                title={
                                                                                                    user.providerConnectionError
                                                                                                }
                                                                                            />
                                                                                        )}
                                                                                    </div>
                                                                                    <p className="text-sm text-subtle">
                                                                                        {hideSensitive
                                                                                            ? "••••••••"
                                                                                            : displayEmail(
                                                                                                  user.email
                                                                                              )}
                                                                                    </p>
                                                                                </div>
                                                                            </TVLink>
                                                                        </td>
                                                                        <td className="px-6 py-4">
                                                                            <StatusBadge
                                                                                status={user.status}
                                                                            />
                                                                        </td>
                                                                        <td className="px-6 py-4 text-muted">
                                                                            {formatWatchTime(
                                                                                user.watchTime
                                                                            )}
                                                                        </td>
                                                                        <td className="px-6 py-4 text-muted text-sm">
                                                                            {user.lastSeen}
                                                                        </td>
                                                                        <td className="px-6 py-4">
                                                                            <div className="flex gap-1">
                                                                                {user.groups
                                                                                    .slice(0, 2)
                                                                                    .map(
                                                                                        (
                                                                                            group,
                                                                                            i
                                                                                        ) => (
                                                                                            <Badge
                                                                                                key={
                                                                                                    i
                                                                                                }
                                                                                                size="sm"
                                                                                                variant="primary"
                                                                                            >
                                                                                                {
                                                                                                    group
                                                                                                }
                                                                                            </Badge>
                                                                                        )
                                                                                    )}
                                                                                {user.groups
                                                                                    .length > 2 && (
                                                                                    <Badge
                                                                                        size="sm"
                                                                                        variant="neutral"
                                                                                    >
                                                                                        +
                                                                                        {user.groups
                                                                                            .length -
                                                                                            2}
                                                                                    </Badge>
                                                                                )}
                                                                            </div>
                                                                        </td>
                                                                        <td className="px-6 py-4 text-muted text-sm">
                                                                            {user.lastSync}
                                                                        </td>
                                                                        <td className="px-6 py-4">
                                                                            <div className="flex items-center gap-2">
                                                                                <LimitsButton
                                                                                    id={user.id}
                                                                                    name={user.name}
                                                                                    summary={
                                                                                        limits[
                                                                                            user.id
                                                                                        ] || null
                                                                                    }
                                                                                />
                                                                                <Button
                                                                                    leftIcon={
                                                                                        <ArrowPathIcon className="h-4 w-4" />
                                                                                    }
                                                                                    onClick={async (
                                                                                        e
                                                                                    ) => {
                                                                                        e.stopPropagation();
                                                                                        try {
                                                                                            await api.syncUser(
                                                                                                user.id
                                                                                            );
                                                                                            toast.success(
                                                                                                `Synced ${user.name} successfully`
                                                                                            );
                                                                                        } catch (err: any) {
                                                                                            toast.error(
                                                                                                err.message ||
                                                                                                    `Failed to sync ${user.name}`
                                                                                            );
                                                                                        }
                                                                                    }}
                                                                                    size="sm"
                                                                                    variant="secondary"
                                                                                >
                                                                                    Sync
                                                                                </Button>
                                                                            </div>
                                                                        </td>
                                                                    </SortableUserRow>
                                                                ))}
                                                            </AnimatePresence>
                                                        </SortableContext>
                                                    </tbody>
                                                </table>
                                            </motion.div>
                                        )}
                                    </AnimatePresence>
                                </LayoutGroup>

                                {/* Empty state */}
                                {filteredUsers.length === 0 && (
                                    <motion.div
                                        animate={{ opacity: 1, scale: 1 }}
                                        className="py-16 text-center"
                                        initial={{ opacity: 0, scale: 0.95 }}
                                    >
                                        <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-surface-hover">
                                            <svg
                                                className="h-8 w-8 text-subtle"
                                                fill="none"
                                                stroke="currentColor"
                                                viewBox="0 0 24 24"
                                            >
                                                <path
                                                    d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z"
                                                    strokeLinecap="round"
                                                    strokeLinejoin="round"
                                                    strokeWidth={2}
                                                />
                                            </svg>
                                        </div>
                                        <h3 className="mb-2 font-medium text-default text-lg">
                                            No users found
                                        </h3>
                                        <p className="mb-6 text-muted">
                                            {peopleFilter === "dormant"
                                                ? `Everyone has watched something in the last ${DORMANT_DAYS} days`
                                                : searchQuery
                                                  ? "Try adjusting your search"
                                                  : "Get started by adding your first user"}
                                        </p>
                                        {!searchQuery && peopleFilter === "all" && (
                                            <Button
                                                onClick={() => setIsCreateModalOpen(true)}
                                                variant="primary"
                                            >
                                                Add User
                                            </Button>
                                        )}
                                    </motion.div>
                                )}
                            </>
                        )}
                    </div>

                    {/* Nuvio profiles: which profiles of each Nuvio login belong to whom.
          Lives here rather than on a person's page because it decides which
          people exist at all - see components/user/ProfilesCard. */}
                    {!isLoading && extrasReady && nuvioLogins.length > 0 && (
                        <div className="mt-6 flex flex-col gap-4">
                            {nuvioLogins.map((login) => (
                                <ProfilesCard
                                    key={login.anchorId}
                                    limits={limits}
                                    loginLabel={nuvioLogins.length > 1 ? login.label : null}
                                    onPeopleChanged={refreshUsersQuietly}
                                    userId={login.anchorId}
                                />
                            ))}
                        </div>
                    )}

                    {/* The same, for everyone else on an AIOStreams or AIOMetadata sign-in:
          its household users count as that person's profiles until separated.
          A card only shows when there is a household - see HouseholdCard. */}
                    {!isLoading && extrasReady && householdOwners.length > 0 && (
                        <div className="mt-4">
                            <HouseholdsCard
                                limits={limits}
                                onPeopleChanged={refreshUsersQuietly}
                                owners={householdOwners.map((owner) => ({
                                    id: owner.id,
                                    kindLabel:
                                        owner.jellyfinServerLabel ||
                                        (owner.jellyfinServerKind === "aiometadata"
                                            ? "AIOMetadata"
                                            : "AIOStreams"),
                                    name:
                                        (owner as { username?: string }).username ||
                                        owner.name ||
                                        "This person",
                                }))}
                            />
                        </div>
                    )}
                </div>
            </div>

            {/* Floating Action Bar */}
            <AnimatePresence>
                {hasSelection && (
                    <motion.div
                        animate={{ opacity: 1, y: 0 }}
                        className="fixed bottom-8 left-1/2 z-50 -translate-x-1/2"
                        exit={{ opacity: 0, y: 100 }}
                        initial={{ opacity: 0, y: 100 }}
                    >
                        <div className="flex items-center gap-4 rounded-2xl border border-default bg-surface px-6 py-4 shadow-2xl backdrop-blur-xl">
                            <div className="flex items-center gap-2 border-default border-r pr-4">
                                <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary-muted">
                                    <span className="font-bold text-primary text-sm">
                                        {selectedIds.size}
                                    </span>
                                </div>
                                <span className="text-muted text-sm">selected</span>
                            </div>

                            <div className="flex items-center gap-2">
                                <Button
                                    isLoading={isSyncing}
                                    leftIcon={
                                        <ArrowPathIcon
                                            className={`h-4 w-4 ${isSyncing ? "animate-spin" : ""}`}
                                        />
                                    }
                                    onClick={handleSyncSelected}
                                    size="sm"
                                    variant="secondary"
                                >
                                    Sync
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
                            >
                                <XMarkIcon className="h-5 w-5" />
                            </button>
                        </div>
                    </motion.div>
                )}
            </AnimatePresence>

            {/* Floating Add Button - Mobile Only */}
            <button
                aria-label="Add user"
                className="nav-item-hover-pill fixed right-4 bottom-4 z-50 flex h-14 w-14 items-center justify-center rounded-full border border-default bg-surface shadow-lg lg:hidden"
                onClick={() => setIsCreateModalOpen(true)}
                style={{
                    boxShadow:
                        "0 10px 25px -5px rgba(0, 0, 0, 0.2), 0 8px 10px -6px rgba(0, 0, 0, 0.1)",
                }}
            >
                <PlusIcon className="h-6 w-6" />
            </button>

            {/* Create User Modal */}
            <CreateUserModal
                isOpen={isCreateModalOpen}
                onClose={() => setIsCreateModalOpen(false)}
            />

            {/* Reconnect Modal - reusing CreateUserModal */}
            {reconnectUserId && (
                <CreateUserModal
                    isOpen={isReconnectModalOpen}
                    mode="reconnect"
                    onClose={() => {
                        setIsReconnectModalOpen(false);
                        setReconnectUserId(null);
                        setReconnectUserName("");
                    }}
                    onReconnectSuccess={() => {
                        setIsReconnectModalOpen(false);
                        setReconnectUserId(null);
                        setReconnectUserName("");
                        window.location.reload();
                    }}
                    providerType={reconnectProvider}
                    userId={reconnectUserId}
                    userName={reconnectUserName}
                />
            )}

            {/* Delete Confirmation Modal (bulk) */}
            <ConfirmModal
                confirmText={isDeleting ? "Deleting..." : "Delete Users"}
                description={`Delete ${selectedIds.size} user${selectedIds.size === 1 ? "" : "s"}? Deleted users go to the Trash on the Tasks page and can be restored for 30 days.`}
                isLoading={isDeleting}
                isOpen={isDeleteModalOpen}
                onClose={() => setIsDeleteModalOpen(false)}
                onConfirm={handleDeleteSelected}
                title="Delete Users"
                variant="danger"
            />

            {/* Delete Confirmation Modal (single) */}
            <ConfirmModal
                confirmText={isDeleting ? "Deleting..." : "Delete User"}
                description={`Delete "${deleteTarget?.name}"? Deleted users go to the Trash on the Tasks page and can be restored for 30 days.`}
                isLoading={isDeleting}
                isOpen={!!deleteTarget}
                onClose={() => setDeleteTarget(null)}
                onConfirm={handleDeleteSingle}
                title="Delete User"
                variant="danger"
            />
        </Wrapper>
    );
}

// Only itemProps (position/transform tracking, no listeners) goes on the
// outer wrapper - dragHandleProps (the actual drag listeners) is threaded
// into UserCard as a prop, rendered there as a small dedicated grab handle.
// Same pattern as Addons' SortableAddonWrapper.
function SortableUserWrapper({
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

// List-view counterpart - renders its own dedicated handle cell rather than
// threading dragHandleProps through every existing <td>. Same pattern as
// Addons' SortableAddonRow.
function SortableUserRow({
    id,
    onClick,
    className,
    children,
}: {
    id: string;
    onClick?: () => void;
    className?: string;
    children: React.ReactNode;
}) {
    const { dragHandleProps, itemProps } = useSortableDragState(id);
    return (
        <motion.tr
            animate={{ opacity: 1 }}
            className={`${className || ""} ${itemProps.className}`}
            exit={{ opacity: 0 }}
            initial={{ opacity: 0 }}
            onClick={onClick}
            ref={itemProps.ref as unknown as React.Ref<HTMLTableRowElement>}
            style={itemProps.style}
        >
            <td className="w-8 py-4 pl-4" onClick={(e) => e.stopPropagation()}>
                <div
                    {...dragHandleProps}
                    className="inline-flex cursor-grab rounded p-1 text-subtle hover:bg-surface-hover hover:text-default active:cursor-grabbing"
                    title="Drag to reorder"
                >
                    <Bars3Icon className="h-4 w-4" />
                </div>
            </td>
            {children}
        </motion.tr>
    );
}

// User Card Component - single click opens, long press/right-click shows menu
function UserCard({
    user,
    isSelected,
    onToggleSelect,
    onDelete,
    onReconnect,
    onToggleStatus,
    syncingUserIds,
    onSyncStart,
    onSyncEnd,
    focusable = false,
    dragHandleProps,
    limits = null,
}: {
    user: UserDisplay;
    isSelected: boolean;
    onToggleSelect: () => void;
    onDelete: () => void;
    onReconnect?: (userId: string, userName: string) => void;
    onToggleStatus?: (userId: string, newStatus: boolean) => void;
    syncingUserIds: Set<string>;
    onSyncStart: (userId: string) => void;
    onSyncEnd: (userId: string) => void;
    /** TV mode: wraps the card in a D-pad-focusable container, Enter/OK opens
     *  the same detail page a click would. */
    focusable?: boolean;
    /** Dedicated grab handle (top-left), same pattern as Addons' AddonCard. */
    dragHandleProps?: Record<string, unknown>;
    /** Their Limits pill's state, from the page's overview. */
    limits?: LimitsSummary | null;
}) {
    const { hideSensitive } = useTheme();
    const { isOpen, position, handleContextMenu, close } = useContextMenu();
    const [showActions, setShowActions] = useState(false);

    // Single click opens detail page
    const handleClick = (_e: React.MouseEvent) => {
        // If it's a long press triggered action, don't navigate
        if (showActions) {
            setShowActions(false);
            return;
        }
        // Navigate to detail page
        window.location.href = `/users/${user.id}`;
    };

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

    const _handleMouseDown = (e: React.MouseEvent) => {
        // Right click handled by onContextMenu
        if (e.button === 2) {
        }
    };

    const [_isSyncing, setIsSyncing] = useState(false);

    const handleSync = async (e: React.MouseEvent) => {
        e.stopPropagation();
        close();
        setIsSyncing(true);
        try {
            await api.syncUser(user.id);
            toast.success(`Synced ${user.name} successfully`);
        } catch (err: any) {
            toast.error(err.message || `Failed to sync ${user.name}`);
        } finally {
            setIsSyncing(false);
        }
    };

    const handleReload = async (e: React.MouseEvent) => {
        e.stopPropagation();
        close();
        toast.success(`Reloading addons for ${user.name}...`);
    };

    const handleImport = async (e: React.MouseEvent) => {
        e.stopPropagation();
        close();
        toast.success(`Importing addons from ${user.name}...`);
        try {
            const result = await api.importUserAddons(user.id);
            toast.success(
                result.message ||
                    `Successfully imported ${result.importedCount} addon${result.importedCount === 1 ? "" : "s"}`
            );
        } catch (err: any) {
            toast.error(err.message || `Failed to import addons from ${user.name}`);
        }
    };

    const handleDelete = (e: React.MouseEvent) => {
        e.stopPropagation();
        close();
        onDelete();
    };

    const cardElement = (
        <Card
            // The switch sits on the name line. The provider and sync badges sit
            // beside the name on a wide card and get a line of their own on a
            // narrow one (see .user-card-head); Limits and Caught up follow the
            // group / addons / time line.
            className={`user-card group tap-card cursor-pointer ${isSelected ? "ring-2 ring-primary" : ""}`}
            onClick={handleClick}
            onContextMenu={handleContextMenu}
            padding="md"
            variant="interactive"
            {...longPress}
        >
            <div className="user-card-head">
                {dragHandleProps && (
                    <div
                        {...dragHandleProps}
                        className="user-card-drag shrink-0 cursor-grab rounded-lg p-1.5 text-subtle hover:bg-surface-hover hover:text-default active:cursor-grabbing"
                        onClick={(e: React.MouseEvent) => e.stopPropagation()}
                        title="Drag to reorder"
                    >
                        <Bars3Icon className="h-4 w-4" />
                    </div>
                )}
                <div className="user-card-avatar">
                    <UserAvatar
                        colorIndex={user.colorIndex}
                        email={user.email}
                        name={user.name}
                        size="lg"
                        src={user.avatarUrl || undefined}
                        useGravatar={user.useGravatar}
                        userId={user.id}
                    />
                </div>
                <div className="user-card-name-cell">
                    <Link
                        className="user-card-name block truncate font-semibold text-default transition-colors hover:text-primary"
                        href={`/users/${user.id}`}
                        onClick={(e) => e.stopPropagation()}
                    >
                        {user.name}
                    </Link>
                </div>
                <div className="user-card-badges">
                    <Badge size="sm" variant={providerBadgeVariant(user)}>
                        {providerLabel(user)}
                    </Badge>
                    {user.providerType === "nuvio" && (user.nuvioProfileId ?? 1) !== 1 && (
                        <Badge size="sm" variant="secondary">
                            Profile {user.nuvioProfileId}
                        </Badge>
                    )}
                    {user.secondaryProviderType && (
                        <Badge
                            size="sm"
                            variant={providerBadgeVariant({
                                providerType: user.secondaryProviderType,
                            })}
                        >
                            {providerTypeLabel(user.secondaryProviderType)}
                        </Badge>
                    )}
                    {user.providerConnectionError && (
                        <ExclamationTriangleIcon
                            className="h-4 w-4 shrink-0 text-warning"
                            title={user.providerConnectionError}
                        />
                    )}
                    <SyncBadge
                        isSyncing={syncingUserIds.has(user.id)}
                        key={`sync-badge-${user.id}`}
                        onReconnect={(_id) => {
                            if (onReconnect) {
                                onReconnect(user.id, user.name);
                            }
                        }}
                        onSync={async (id) => {
                            onSyncStart(id);
                            try {
                                await api.syncUser(id);
                                toast.success(`Synced ${user.name} successfully`);
                            } catch (err: any) {
                                toast.error(err.message || `Failed to sync ${user.name}`);
                            } finally {
                                onSyncEnd(id);
                            }
                        }}
                        size="sm"
                        userId={user.id}
                    />
                </div>
                <div className="user-card-toggle">
                    <ToggleSwitch
                        checked={user.status === "active"}
                        onChange={async () => {
                            try {
                                const newStatus = user.status !== "active";
                                await api.toggleUserStatus(user.id, newStatus);
                                toast.success(`User ${newStatus ? "activated" : "deactivated"}`);
                                onToggleStatus?.(user.id, newStatus);
                            } catch (err: any) {
                                toast.error(err.message || "Failed to toggle user status");
                            }
                        }}
                        title={`Activate ${user.name}`}
                    />
                </div>
            </div>
            {/* Group, addons and time, then Limits and Caught up - no dots, like
            the Groups cards. On a narrow card the time starts a second line
            with the two after it. */}
            <div className="mt-3 flex flex-wrap items-center gap-x-2.5 gap-y-1.5 whitespace-nowrap text-muted text-sm">
                <span className="flex items-center gap-1.5">
                    <UserGroupIcon className="h-4 w-4 text-secondary" />
                    {user.groups.length > 0 ? (
                        <>
                            {user.groups[0]}
                            {user.groups.length > 1 && ` +${user.groups.length - 1}`}
                        </>
                    ) : (
                        "No group"
                    )}
                </span>
                {hasAddonList(user) && (
                    <span className="flex items-center gap-1.5">
                        <PuzzlePieceIcon className="h-4 w-4 text-secondary" />
                        {user.addonCount || 0} addon{user.addonCount === 1 ? "" : "s"}
                    </span>
                )}
                <span aria-hidden="true" className="user-card-break" />
                <span className="flex items-center gap-1.5">
                    <ClockIcon className="h-4 w-4 text-secondary" />
                    {formatWatchTime(user.watchTime)}
                </span>
                <span className="inline-flex items-center gap-1.5">
                    <LimitsButton
                        id={user.id}
                        name={user.name}
                        onReconnect={
                            onReconnect ? () => onReconnect(user.id, user.name) : undefined
                        }
                        summary={limits}
                    />
                    <CatchUpButton
                        hasServer={user.providerType === "jellyfin"}
                        name={user.name}
                        size="sm"
                        userId={user.id}
                    />
                </span>
            </div>
            <div className="mt-1.5 flex items-center justify-between gap-3">
                <p className="text-subtle text-xs">
                    {user.lastSeen === "Never" ? "Never seen" : `Last seen ${user.lastSeen}`}
                </p>
                <SelectionCheckbox checked={isSelected} onChange={onToggleSelect} />
            </div>
        </Card>
    );

    return (
        <>
            {focusable ? (
                <TVFocusable
                    onEnterPress={() => {
                        window.location.href = `/users/${user.id}`;
                    }}
                >
                    {cardElement}
                </TVFocusable>
            ) : (
                cardElement
            )}

            <ContextMenu isOpen={isOpen} onClose={close} position={position}>
                <Link
                    className="flex items-center gap-2 px-3 py-2 text-default text-sm transition-colors hover:bg-surface-hover"
                    href={`/users/${user.id}`}
                    onClick={(e) => {
                        e.stopPropagation();
                        close();
                    }}
                >
                    <EyeIcon className="h-4 w-4" />
                    View Details
                </Link>
                {/* A Jellyfin-compatible server has no addon list to sync or read. */}
                {hasAddonList(user) && (
                    <>
                        <button
                            className="flex w-full items-center gap-2 px-3 py-2 text-default text-sm transition-colors hover:bg-surface-hover"
                            onClick={handleSync}
                        >
                            <ArrowPathIcon className="h-4 w-4" />
                            Sync User
                        </button>
                        <button
                            className="flex w-full items-center gap-2 px-3 py-2 text-default text-sm transition-colors hover:bg-surface-hover"
                            onClick={handleReload}
                        >
                            <ArrowPathIcon className="h-4 w-4" />
                            Reload Addons
                        </button>
                        <button
                            className="flex w-full items-center gap-2 px-3 py-2 text-default text-sm transition-colors hover:bg-surface-hover"
                            onClick={handleImport}
                        >
                            <ArrowDownTrayIcon className="h-4 w-4" />
                            Import Addons
                        </button>
                    </>
                )}
                <div className="my-1 border-default border-t" />
                <button
                    className="flex w-full items-center gap-2 px-3 py-2 text-error text-sm transition-colors hover:bg-error-muted"
                    onClick={handleDelete}
                >
                    <TrashIcon className="h-4 w-4" />
                    Delete
                </button>
            </ContextMenu>
        </>
    );
}
