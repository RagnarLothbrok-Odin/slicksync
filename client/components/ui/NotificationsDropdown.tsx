"use client";

import {
    ArrowPathIcon,
    ArrowUpCircleIcon,
    BellIcon,
    CheckCircleIcon,
    ClockIcon,
    DevicePhoneMobileIcon,
    EnvelopeIcon,
    ExclamationTriangleIcon,
    LockClosedIcon,
    MegaphoneIcon,
    PuzzlePieceIcon,
    SparklesIcon,
    UserPlusIcon,
    UsersIcon,
    XMarkIcon,
} from "@heroicons/react/24/outline";
import { AnimatePresence, motion } from "framer-motion";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Avatar, Button } from "@/components/ui";
import { SwipeToDismiss } from "@/components/ui/SwipeToDismiss";
import { toast } from "@/components/ui/Toast";
import { startAdaptivePoll } from "@/lib/adaptivePoll";
import { api } from "@/lib/api";
import { readErrorMessage } from "@/lib/errors";
import { useCoarsePointer } from "@/lib/hooks/useCoarsePointer";
import { useIsTV } from "@/lib/hooks/useIsTV";

interface NotificationItem {
    data?: any;
    id: string;
    message: string;
    poster?: string;
    read: boolean;
    timestamp: Date;
    title: string;
    type:
        | "activity"
        | "invite"
        | "task"
        | "user"
        | "request"
        | "episode"
        | "addon"
        | "sync"
        | "vault"
        | "mismatch"
        | "update"
        | "announcement"
        | "device";
}

interface NotificationsDropdownProps {
    // Optional - self-fetched real activity/invite data (see the effects
    // below) covers everything today. These stay accepted and merged in
    // case a future caller has cheaper data already in hand (e.g. a page
    // that already fetched metrics for its own use), so nothing needs to
    // change here if that gets wired up later.
    activities?: any[];
    /** While the topbar buttons float over the page: the bell gets its own round
     *  backdrop so it stays readable over posters (see TopbarActions). */
    floating?: boolean;
    inviteHistory?: any[];
    taskHistory?: any[];
}

/** Each floating topbar icon's own round backdrop - shared with TopbarActions. */
export const FLOATING_ICON_STYLE: React.CSSProperties = {
    backdropFilter: "blur(18px)",
    background: "color-mix(in srgb, var(--color-surface) 80%, transparent)",
    border: "1px solid var(--color-surface-border)",
    boxShadow: "0 8px 24px -8px rgba(0,0,0,0.5)",
    WebkitBackdropFilter: "blur(18px)",
};

// The bell remounts with the page header on every navigation, and each of
// its sources arrives on its own schedule (stored notifications after a short
// stagger, alerts straight away). Starting each one empty made the count drop
// to whatever landed first and climb back - 18, then 1, then 18 - on every
// page change. Each source now starts from what it last held this session;
// a sign-out reloads the page, so nothing carries over between accounts.
const lastKnown: Record<string, any[]> = {};
type ListUpdate = any[] | ((prev: any[]) => any[]);
function useRememberedList(key: string): [any[], (next: ListUpdate) => void] {
    const [value, setValue] = useState<any[]>(() => lastKnown[key] || []);
    const set = useCallback(
        (next: ListUpdate) => {
            setValue((prev) => {
                const resolved = typeof next === "function" ? next(prev) : next;
                lastKnown[key] = resolved;
                return resolved;
            });
        },
        [key]
    );
    return [value, set];
}

// When each feed was last fetched. Pages with their own header mount a new
// bell on every visit; one that fetched moments ago shows what it has (above)
// instead of asking again, and its poll carries on from there.
const fetchedAt: Record<string, number> = {};
const fetchedRecently = (key: string, ms = 30_000) => Date.now() - (fetchedAt[key] || 0) < ms;

const DISMISSED_STORAGE_KEY = "notifications-dismissed-ids";
const READ_STORAGE_KEY = "notifications-read-ids";

export function NotificationsDropdown({
    activities = [],
    inviteHistory = [],
    taskHistory = [],
    floating = false,
}: NotificationsDropdownProps) {
    const router = useRouter();
    const [isOpen, setIsOpen] = useState(false);
    const containerRef = useRef<HTMLDivElement | null>(null);
    const buttonRef = useRef<HTMLButtonElement | null>(null);
    const [lastChecked, setLastChecked] = useState<Date>(() => {
        if (typeof window !== "undefined") {
            const stored = localStorage.getItem("notifications-last-checked");
            return stored ? new Date(stored) : new Date(Date.now() - 7 * 24 * 60 * 60 * 1000); // Default to 7 days ago
        }
        return new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    });

    // Phones swipe a row left to dismiss it instead of the X. Not TVs: a remote
    // can't swipe, so they keep the button.
    const coarse = useCoarsePointer();
    const isTV = useIsTV();
    const swipeToDismiss = coarse && !isTV;

    // IDs individually dismissed via the per-row X button (or a swipe) - kept separate
    // from lastChecked (which hides everything at once) so dismissing one
    // notification doesn't also hide unrelated newer ones.
    const [dismissedIds, setDismissedIds] = useState<Set<string>>(() => {
        if (typeof window === "undefined") {
            return new Set();
        }
        try {
            const stored = localStorage.getItem(DISMISSED_STORAGE_KEY);
            return stored ? new Set(JSON.parse(stored)) : new Set();
        } catch {
            return new Set();
        }
    });

    const persistDismissedIds = (next: Set<string>) => {
        setDismissedIds(next);
        if (typeof window !== "undefined") {
            localStorage.setItem(DISMISSED_STORAGE_KEY, JSON.stringify(Array.from(next)));
        }
    };

    const handleDismiss = (e: React.MouseEvent, id: string) => {
        e.stopPropagation();
        dismissOne(id);
    };

    // From the row (state updater, not the rendered set): a swipe finishes its
    // slide-out animation a moment after it starts, and another row may have
    // been dismissed in between.
    const dismissOne = (id: string) => {
        setDismissedIds((prev) => {
            const next = new Set(prev).add(id);
            if (typeof window !== "undefined") {
                localStorage.setItem(DISMISSED_STORAGE_KEY, JSON.stringify(Array.from(next)));
            }
            return next;
        });
        // Persisted bell notifications (id prefixed "stored-") are deleted
        // server-side too, so they don't just reappear on the next poll.
        if (id.startsWith("stored-")) {
            const realId = id.slice("stored-".length);
            api.dismissNotifications([realId]).catch(() => undefined);
        }
    };

    // Which notifications have been marked read - separate from dismissedIds
    // (which removes a row entirely) and from lastChecked (which controls
    // what's in the window at all, not whether something already in it has
    // been seen). "Mark all read" should un-highlight everything currently
    // visible without making it disappear - that needs its own persisted set.
    const [readIds, setReadIds] = useState<Set<string>>(() => {
        if (typeof window === "undefined") {
            return new Set();
        }
        try {
            const stored = localStorage.getItem(READ_STORAGE_KEY);
            return stored ? new Set(JSON.parse(stored)) : new Set();
        } catch {
            return new Set();
        }
    });

    const persistReadIds = (next: Set<string>) => {
        setReadIds(next);
        if (typeof window !== "undefined") {
            localStorage.setItem(READ_STORAGE_KEY, JSON.stringify(Array.from(next)));
        }
    };

    // Where tapping a notification should land. Stored bell notifications
    // (activity/sync/invite/vault/task/proxy/update) already carry a real
    // url from the server (notificationStore.js's createNotification) -
    // episode/addon items are built client-side from their own dedicated
    // tables and never had one, so they get a sensible fixed fallback
    // instead. 'request'/'user' rows have their own Accept/Reject buttons
    // and navigating away on a stray tap would be actively unhelpful.
    const getNotificationUrl = (n: NotificationItem): string | null => {
        // Rewrites a stale url baked into an already-persisted notification row
        // from before a route moved - the server-side generator was fixed, but
        // that only affects notifications created from here on; anything
        // already in the table (and anyone's local read/dismissed state keyed
        // off it) still has the old value.
        if (n.data?.url === "/health") {
            return "/metrics?tab=health";
        }
        if (n.data?.url) {
            return n.data.url;
        }
        switch (n.type) {
            case "addon":
                return "/addons";
            case "episode":
                return "/";
            case "mismatch":
                return "/activity";
            default:
                return null;
        }
    };

    const handleNotificationClick = (notification: NotificationItem) => {
        const url = getNotificationUrl(notification);
        if (!url) {
            return;
        }
        persistReadIds(new Set(readIds).add(notification.id));
        setIsOpen(false);
        router.push(url);
    };

    const [pendingRequests, setPendingRequests] = useRememberedList("pendingRequests");
    // Accepted invite requests, from the same fetch as pendingRequests below -
    // this IS "real" inviteHistory, no separate endpoint needed. Merged with
    // any inviteHistory passed in via props.
    const [acceptedRequests, setAcceptedRequests] = useRememberedList("acceptedRequests");

    // Persistent bell notifications (notifications table) - the durable event
    // store written from the SAME dispatch path as push/Discord
    // (notificationStore.js). This replaces the old approach of re-deriving
    // watch activity live from the metrics snapshot, which could never
    // represent a discrete "started/finished watching" event and left the bell
    // empty for proxy-only or mismatched-account watches even though push and
    // Discord both fired. Watch, sync, vault, invite and mismatch events all
    // flow through here; episode/addon alerts keep their own sources below.
    const [storedNotifications, setStoredNotifications] = useRememberedList("storedNotifications");
    useEffect(() => {
        const fetchStored = async () => {
            // Skip while the tab isn't the one on screen - a backgrounded Safari
            // tab has no reason to keep firing this every 30s, and the interval
            // itself catches back up on its own next tick once it's visible again.
            if (typeof document !== "undefined" && document.visibilityState !== "visible") {
                return;
            }
            try {
                fetchedAt.stored = Date.now();
                setStoredNotifications(await api.getNotifications());
            } catch {
                // Endpoint may not exist yet on an older backend - stay silent.
            }
        };
        const initialDelay = fetchedRecently("stored")
            ? undefined
            : setTimeout(fetchStored, 200 + Math.random() * 600);
        const stopPoll = startAdaptivePoll(fetchStored, 30_000, 180_000);
        // SSE accelerant: a server-side notification refetches the bell right
        // now instead of on the next tick. Polling above stays as the fallback.
        const onLive = () => {
            fetchStored();
        };
        window.addEventListener("slicksync:live-notification", onLive);
        return () => {
            clearTimeout(initialDelay);
            stopPoll();
            window.removeEventListener("slicksync:live-notification", onLive);
        };
    }, []);

    // Fetch pending + accepted invite requests
    useEffect(() => {
        const fetchRequests = async () => {
            if (typeof document !== "undefined" && document.visibilityState !== "visible") {
                return;
            }
            try {
                // One small read of just the requests the bell shows.
                fetchedAt.requests = Date.now();
                const { pending, accepted } = await api.getInvitationBell();
                setPendingRequests(pending);
                setAcceptedRequests(accepted);
            } catch (e) {
                console.error("Failed to fetch pending requests", e);
            }
        };

        // Small random delay on the very first fetch only (not the recurring
        // poll, to keep the 30s cadence predictable) - this component mounts
        // once per session now (persists across navigation, see NebulaTopbar),
        // so its own initial fetch only ever collides with a page's own mount
        // fetch on first load. Spreads that one moment out a little rather than
        // firing in the exact same tick as everything else - the per-endpoint
        // dedupe/cache in api.ts covers repeat calls to these same two
        // endpoints, but a fresh page load fires plenty of genuinely different
        // endpoints too, which that cache can't help with.
        const initialDelay = fetchedRecently("requests")
            ? undefined
            : setTimeout(fetchRequests, 200 + Math.random() * 600);
        const stopPoll = startAdaptivePoll(fetchRequests, 30_000, 180_000);
        return () => {
            clearTimeout(initialDelay);
            stopPoll();
        };
    }, []);

    // (Watch activity is no longer re-derived from the metrics snapshot here -
    // it now comes through storedNotifications above, as discrete persisted
    // events written at the moment they happen, so a "started/finished
    // watching" event shows in the bell the same way it reaches push/Discord.)

    // New-episode alerts (fired server-side by the episodeAlerts poller when a
    // show someone here watches gets a newly-released episode). Server polls
    // Cinemeta every 6h, so a 5min client refresh is plenty.
    const [episodeAlerts, setEpisodeAlerts] = useRememberedList("episodeAlerts");
    useEffect(() => {
        const fetchAlerts = async () => {
            if (typeof document !== "undefined" && document.visibilityState !== "visible") {
                return;
            }
            try {
                fetchedAt.episodes = Date.now();
                setEpisodeAlerts(await api.getEpisodeAlerts());
            } catch {
                // Endpoint may not exist yet on an older backend - stay silent.
            }
        };
        if (!fetchedRecently("episodes", 5 * 60 * 1000)) {
            fetchAlerts();
        }
        const interval = setInterval(fetchAlerts, 5 * 60 * 1000);
        return () => clearInterval(interval);
    }, []);

    // Addon online<->offline alerts (fired server-side by addonHealthCheck.js
    // when a primary addon goes down - and getGroupAddons silently diverts
    // groups to its backup - or comes back). Same cadence as episode alerts.
    const [addonHealthAlerts, setAddonHealthAlerts] = useRememberedList("addonHealthAlerts");
    useEffect(() => {
        const fetchAddonAlerts = async () => {
            if (typeof document !== "undefined" && document.visibilityState !== "visible") {
                return;
            }
            try {
                fetchedAt.addons = Date.now();
                setAddonHealthAlerts(await api.getAddonHealthAlerts());
            } catch {
                // Endpoint may not exist yet on an older backend - stay silent.
            }
        };
        if (!fetchedRecently("addons", 5 * 60 * 1000)) {
            fetchAddonAlerts();
        }
        const interval = setInterval(fetchAddonAlerts, 5 * 60 * 1000);
        return () => clearInterval(interval);
    }, []);

    const handleAcceptRequest = async (e: React.MouseEvent, reqId: string) => {
        e.stopPropagation();
        try {
            await api.acceptInviteRequest(reqId);
            toast.success("Request accepted");
            setPendingRequests((prev) => prev.filter((r) => r.id !== reqId));
        } catch (err) {
            toast.error(readErrorMessage(err, "Failed to accept request"));
        }
    };

    const handleRejectRequest = async (e: React.MouseEvent, reqId: string) => {
        e.stopPropagation();
        try {
            await api.rejectInviteRequest(reqId);
            toast.success("Request rejected");
            setPendingRequests((prev) => prev.filter((r) => r.id !== reqId));
        } catch (err) {
            toast.error(readErrorMessage(err, "Failed to reject request"));
        }
    };

    // Only the optional `activities` prop now (empty by default) - real watch
    // activity comes through storedNotifications instead. Kept so a future
    // caller passing pre-fetched activity data still works unchanged.
    const combinedActivities = useMemo(() => [...activities], [activities]);

    const combinedInviteHistory = useMemo(() => {
        const fromAccepted = acceptedRequests.map((req) => ({
            action: "used",
            groupName: req.groupName || "a group",
            id: req.id,
            timestamp: req.respondedAt || req.createdAt,
            userName: req.username || req.email,
        }));
        return [...inviteHistory, ...fromAccepted];
    }, [inviteHistory, acceptedRequests]);

    // Generate notifications from activities, invites, and tasks since last checked
    const notifications = useMemo(() => {
        const items: NotificationItem[] = [];

        // Add pending requests (ALWAYS show these, regardless of last checked)
        pendingRequests.forEach((req) => {
            items.push({
                data: req,
                id: `req-${req.id}`,
                message: `${req.username} requested access via ${req.invitationName}`,
                read: false,
                timestamp: new Date(req.createdAt),
                title: "Access Request",
                type: "request",
            });
        });

        // Persistent bell notifications (watch/sync/vault/invite/mismatch). These
        // carry server-side read state; readIds is layered on top only as an
        // optimistic client override so "Mark all read" reflects instantly before
        // the next poll. The lastChecked window doesn't apply - these are already
        // time-bounded by the server query and cleared via server-side delete.
        storedNotifications.forEach((n) => {
            const id = `stored-${n.id}`;
            items.push({
                data: { url: n.url },
                id,
                message: n.body,
                poster: n.poster || undefined,
                read: n.read || readIds.has(id),
                timestamp: new Date(n.createdAt),
                title: n.title,
                type: n.type,
            });
        });

        // Add recent activities
        combinedActivities
            .filter((activity) => new Date(activity.timestamp) > lastChecked)
            .slice(0, 5)
            .forEach((activity) => {
                const id = `activity-${activity.id}`;
                items.push({
                    id,
                    message: activity.contentName,
                    poster: activity.poster,
                    read: readIds.has(id),
                    timestamp: new Date(activity.timestamp),
                    title: `${activity.userName} ${activity.type === "watch" ? "is watching" : activity.type === "complete" ? "completed" : "synced"}`,
                    type: "activity",
                });
            });

        // Add recent invite uses
        combinedInviteHistory
            .filter(
                (invite) => invite.action === "used" && new Date(invite.timestamp) > lastChecked
            )
            .slice(0, 3)
            .forEach((invite) => {
                const id = `invite-${invite.id}`;
                items.push({
                    id,
                    message: `${invite.userName || "Someone"} joined ${invite.groupName}`,
                    read: readIds.has(id),
                    timestamp: new Date(invite.timestamp),
                    title: "Invite used",
                    type: "invite",
                });
            });

        // Add recent task completions
        taskHistory
            .filter((task) => new Date(task.timestamp) > lastChecked && task.status === "success")
            .slice(0, 3)
            .forEach((task) => {
                const id = `task-${task.id}`;
                items.push({
                    id,
                    message: `${task.type.replace("_", " ")} completed successfully`,
                    read: readIds.has(id),
                    timestamp: new Date(task.timestamp),
                    title: "Task completed",
                    type: "task",
                });
            });

        // New-episode alerts - a show someone here watches got a new episode
        episodeAlerts
            .filter((alert) => new Date(alert.createdAt) > lastChecked)
            .slice(0, 5)
            .forEach((alert) => {
                const epLabel = `S${String(alert.season).padStart(2, "0")}E${String(alert.episode).padStart(2, "0")}`;
                const id = `episode-${alert.id}`;
                items.push({
                    id,
                    message: `${epLabel}${alert.title ? ` · ${alert.title}` : ""} is out`,
                    poster: alert.poster || undefined,
                    read: readIds.has(id),
                    timestamp: new Date(alert.createdAt),
                    title: `New episode: ${alert.showName}`,
                    type: "episode",
                });
            });

        // Addon health alerts - a primary addon went offline (backup took over)
        // or came back.
        addonHealthAlerts
            .filter((alert) => new Date(alert.createdAt) > lastChecked)
            .slice(0, 5)
            .forEach((alert) => {
                const groupsLabel = `${alert.groupCount} group${alert.groupCount === 1 ? "" : "s"}`;
                const message =
                    alert.event === "online"
                        ? alert.backupAddonName && alert.groupCount > 0
                            ? `Switched ${groupsLabel} back to ${alert.addonName}`
                            : `${alert.addonName} is reachable again`
                        : alert.backupAddonName && alert.groupCount > 0
                          ? `Switched ${groupsLabel} to backup ${alert.backupAddonName}`
                          : `${alert.groupCount > 0 ? `${groupsLabel} affected` : "Not assigned to any group"}, no backup configured`;
                const id = `addon-health-${alert.id}`;
                items.push({
                    id,
                    message,
                    read: readIds.has(id),
                    timestamp: new Date(alert.createdAt),
                    title:
                        alert.event === "online"
                            ? `✅ ${alert.addonName} is back online`
                            : `⚠️ ${alert.addonName} went offline`,
                    type: "addon",
                    // Deep-link to the addon the alert is actually about. Without this
                    // it fell through to the generic `case 'addon'` below and dropped
                    // you on the full Addons list, which doesn't say which addon went
                    // down or why - you had to find it yourself.
                    ...(alert.addonId ? { data: { url: `/addons/${alert.addonId}` } } : {}),
                });
            });

        // Sort by timestamp, most recent first, then drop anything individually
        // dismissed via the per-row X button or a swipe.
        return items
            .sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime())
            .filter((item) => !dismissedIds.has(item.id));
    }, [
        combinedActivities,
        combinedInviteHistory,
        taskHistory,
        episodeAlerts,
        addonHealthAlerts,
        storedNotifications,
        lastChecked,
        pendingRequests,
        dismissedIds,
        readIds,
    ]);

    const unreadCount = notifications.filter((n) => !n.read).length;

    // Mirror the unread count onto the installed app's icon (OS Badging API,
    // Chromium + iOS 16.4+ installed PWAs). Browsers without it just skip -
    // the accessor itself can throw on some, hence the try/catch rather than
    // a plain feature check. The service worker sets a bare dot when a push
    // arrives while the app is closed; this corrects it to the real number
    // the moment the app opens.
    useEffect(() => {
        try {
            const nav = navigator as Navigator & {
                setAppBadge?: (n?: number) => Promise<void>;
                clearAppBadge?: () => Promise<void>;
            };
            if (unreadCount > 0) {
                nav.setAppBadge?.(unreadCount)?.catch(() => undefined);
            } else {
                nav.clearAppBadge?.()?.catch(() => undefined);
            }
        } catch {
            /* badging unsupported */
        }
    }, [unreadCount]);

    // Un-highlights every currently-visible notification without removing it -
    // rows stay in the list (still scrollable/readable), just lose the unread
    // styling and no longer count toward the bell's dot. Distinct from Clear,
    // which actually empties the list.
    const handleMarkAllRead = () => {
        const next = new Set(readIds);
        notifications.forEach((n) => {
            next.add(n.id);
        });
        persistReadIds(next);
        // Persist read state server-side for the stored subset so it stays read
        // across devices / reloads, not just in this browser's localStorage.
        api.markNotificationsRead().catch(() => undefined);
    };

    const handleClearAll = () => {
        const now = new Date();
        setLastChecked(now);
        if (typeof window !== "undefined") {
            localStorage.setItem("notifications-last-checked", now.toISOString());
        }
        // Nothing before `now` will ever be shown again anyway (see the
        // lastChecked filter above), so the individually-dismissed and
        // marked-read sets can both be reset too instead of accumulating
        // indefinitely.
        persistDismissedIds(new Set());
        persistReadIds(new Set());
        // The lastChecked window hides the derived sources (episode/addon/etc.);
        // stored bell notifications aren't windowed, so Clear deletes them
        // server-side (and locally) to actually empty them.
        setStoredNotifications([]);
        api.dismissNotifications().catch(() => undefined);
        setIsOpen(false);
    };

    const getNotificationIcon = (type: NotificationItem["type"]) => {
        switch (type) {
            case "activity":
                return <ClockIcon className="h-4 w-4" />;
            case "invite":
                return <EnvelopeIcon className="h-4 w-4" />;
            case "task":
                return <CheckCircleIcon className="h-4 w-4" />;
            case "user":
                return <UsersIcon className="h-4 w-4" />;
            case "request":
                return <UserPlusIcon className="h-4 w-4" />;
            case "episode":
                return <SparklesIcon className="h-4 w-4" />;
            case "addon":
                return <PuzzlePieceIcon className="h-4 w-4" />;
            case "sync":
                return <ArrowPathIcon className="h-4 w-4" />;
            case "vault":
                return <LockClosedIcon className="h-4 w-4" />;
            case "mismatch":
                return <ExclamationTriangleIcon className="h-4 w-4" />;
            case "update":
                return <ArrowUpCircleIcon className="h-4 w-4" />;
            case "announcement":
                return <MegaphoneIcon className="h-4 w-4" />;
            case "device":
                return <DevicePhoneMobileIcon className="h-4 w-4" />;
        }
    };

    const formatNotificationTime = (date: Date) => {
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
        return `${diffDays}d ago`;
    };

    // Close on click outside + Escape
    useEffect(() => {
        if (!isOpen) {
            return;
        }

        const onPointerDown = (e: MouseEvent | TouchEvent) => {
            const target = e.target as Node | null;
            if (!target) {
                return;
            }
            const withinDropdown = containerRef.current?.contains(target);
            const withinButton = buttonRef.current?.contains(target);
            if (!(withinDropdown || withinButton)) {
                setIsOpen(false);
            }
        };

        const onKeyDown = (e: KeyboardEvent) => {
            if (e.key === "Escape") {
                setIsOpen(false);
            }
        };

        document.addEventListener("mousedown", onPointerDown, true);
        document.addEventListener("touchstart", onPointerDown, true);
        document.addEventListener("keydown", onKeyDown, true);
        return () => {
            document.removeEventListener("mousedown", onPointerDown, true);
            document.removeEventListener("touchstart", onPointerDown, true);
            document.removeEventListener("keydown", onKeyDown, true);
        };
    }, [isOpen]);

    return (
        <div className="relative" ref={containerRef}>
            <motion.button
                aria-label="Notifications"
                className={`relative p-2 transition-colors ${floating ? "rounded-full" : "hov-surface rounded-lg"}`}
                onClick={() => setIsOpen(!isOpen)}
                ref={buttonRef}
                style={{
                    color: "var(--color-text-muted)",
                    ...(floating ? FLOATING_ICON_STYLE : {}),
                }}
                whileHover={{ scale: 1.05 }}
                whileTap={{ scale: 0.95 }}
            >
                <BellIcon className="h-5 w-5" />
                {unreadCount > 0 && (
                    // Count badge, not just a presence dot - "something's waiting" and
                    // "eleven things are waiting" are different amounts of urgency.
                    <span
                        className="absolute -top-0.5 -right-0.5 flex h-4 min-w-[16px] items-center justify-center rounded-full px-1 font-bold text-[9px] leading-none"
                        style={{ background: "var(--color-primary)", color: "#fff" }}
                    >
                        {unreadCount > 99 ? "99+" : unreadCount}
                    </span>
                )}
            </motion.button>

            <AnimatePresence>
                {isOpen && (
                    <>
                        {/* Backdrop */}
                        <button
                            aria-label="Close popup"
                            className="fixed inset-0 z-40 border-0 bg-transparent p-0"
                            onClick={() => setIsOpen(false)}
                            tabIndex={-1}
                            type="button"
                        />

                        {/* Dropdown */}
                        <motion.div
                            animate={{ opacity: 1, scale: 1, y: 0 }}
                            className="absolute top-full right-0 z-50 mt-2 w-80"
                            exit={{ opacity: 0, scale: 0.95, y: -10 }}
                            initial={{ opacity: 0, scale: 0.95, y: -10 }}
                            style={{ maxWidth: "calc(100vw - 2rem)" }}
                            transition={{ duration: 0.15 }}
                        >
                            {/* Small caret pointing up at the bell that opened this, so
                  the panel reads unambiguously as "a popup from that
                  button" rather than something else on the page having
                  changed. It can't avoid overlapping nearby page content on
                  some pages (e.g. Activity's centered Watch/Tasks/Invites/
                  Proxy tab row sits right where this needs to drop, and a
                  320px-wide panel has nowhere to go that dodges it) - same
                  transient-overlay behavior most notification bells have
                  (closes on outside click, nothing underneath is altered),
                  but making the connection to its trigger obvious matters
                  more here than it would if there were room to avoid the
                  overlap entirely. Rendered before the panel div (not
                  after) so the panel's own background naturally covers its
                  bottom half, same trick as any CSS speech-bubble tail. */}
                            <div
                                className="absolute -top-1 right-4 h-3 w-3 rotate-45 border-default border-t border-l"
                                style={{ background: "var(--color-surface)" }}
                            />
                            {/* Plain div, not <Card> - Card's Nebula mode auto-applies a
                  55%-opacity translucent background meant for content
                  sitting on the page's own background. That reads fine
                  embedded in page content, but this panel is a floating
                  overlay that can sit on top of anything (poster grids,
                  colorful content) - 55% opacity there was hard to read,
                  worst on mobile where it's now fixed over live page
                  content. Solid, high-opacity background regardless of
                  layout mode - a floating overlay always needs strong
                  contrast, that's not a Nebula-vs-Current distinction. */}
                            <div
                                className="flex max-h-[500px] flex-col overflow-hidden rounded-2xl border border-default shadow-xl"
                                style={{
                                    backdropFilter: "blur(8px)",
                                    background: "var(--color-surface)",
                                    WebkitBackdropFilter: "blur(8px)",
                                }}
                            >
                                {/* Header */}
                                <div className="flex items-center justify-between border-default border-b p-4">
                                    <h3 className="font-semibold text-default text-sm">
                                        Notifications
                                    </h3>
                                    {notifications.length > 0 && (
                                        <div className="flex items-center gap-2">
                                            <Button
                                                className="text-xs"
                                                onClick={handleMarkAllRead}
                                                size="sm"
                                                variant="ghost"
                                            >
                                                Mark all read
                                            </Button>
                                            <Button
                                                className="text-xs"
                                                onClick={handleClearAll}
                                                size="sm"
                                                variant="ghost"
                                            >
                                                Clear
                                            </Button>
                                        </div>
                                    )}
                                </div>

                                {/* Notifications list */}
                                <div className="max-h-[400px] overflow-y-auto">
                                    {notifications.length === 0 ? (
                                        <div className="p-8 text-center">
                                            <BellIcon className="mx-auto mb-2 h-8 w-8 text-subtle" />
                                            <p className="text-muted text-sm">
                                                No new notifications
                                            </p>
                                        </div>
                                    ) : (
                                        <div className="divide-y divide-default">
                                            {notifications.map((notification) => (
                                                <SwipeToDismiss
                                                    enabled={
                                                        swipeToDismiss &&
                                                        notification.type !== "request"
                                                    }
                                                    key={notification.id}
                                                    onDismiss={() => dismissOne(notification.id)}
                                                >
                                                    <motion.div
                                                        animate={{ opacity: 1, x: 0 }}
                                                        className={`p-4 transition-colors duration-500 hover:bg-surface-hover ${getNotificationUrl(notification) ? "cursor-pointer" : ""} ${notification.read ? "notif-read" : "notif-lit"}`}
                                                        initial={{ opacity: 0, x: -10 }}
                                                        onClick={() =>
                                                            handleNotificationClick(notification)
                                                        }
                                                        // Lit/read look is a class pair (see globals.css) so it
                                                        // fades via transition-colors and survives recolouring extensions.
                                                    >
                                                        <div className="flex flex-col gap-3">
                                                            <div className="flex items-start gap-3">
                                                                <span
                                                                    aria-hidden="true"
                                                                    className={`mt-2 h-1.5 w-1.5 shrink-0 rounded-full transition-colors duration-500 ${notification.read ? "notif-dot-read" : "notif-dot-lit"}`}
                                                                />
                                                                {notification.poster ? (
                                                                    <div className="h-14 w-10 shrink-0 overflow-hidden rounded-lg border border-default bg-surface">
                                                                        {/* biome-ignore lint/a11y/noNoninteractiveElementInteractions: Image load failures choose fallback artwork; this is not a user action. */}
                                                                        <img
                                                                            alt={
                                                                                notification.message
                                                                            }
                                                                            className="h-full w-full object-cover"
                                                                            height={56}
                                                                            onError={(e) => {
                                                                                // If image fails, just hide it (we'll fall back to icon)
                                                                                (
                                                                                    e.currentTarget
                                                                                        .parentElement as HTMLElement | null
                                                                                )?.remove();
                                                                            }}
                                                                            src={
                                                                                notification.poster
                                                                            }
                                                                            width={40}
                                                                        />
                                                                    </div>
                                                                ) : notification.type ===
                                                                      "request" &&
                                                                  notification.data ? (
                                                                    <Avatar
                                                                        email={
                                                                            notification.data.email
                                                                        }
                                                                        name={
                                                                            notification.data
                                                                                .username ||
                                                                            notification.data
                                                                                .email ||
                                                                            "User"
                                                                        }
                                                                        size="sm"
                                                                    />
                                                                ) : (
                                                                    <div
                                                                        className={`flex-shrink-0 rounded-lg p-1.5 ${
                                                                            notification.type ===
                                                                            "request"
                                                                                ? "bg-primary/10 text-primary"
                                                                                : "bg-primary-muted text-primary"
                                                                        }`}
                                                                    >
                                                                        {getNotificationIcon(
                                                                            notification.type
                                                                        )}
                                                                    </div>
                                                                )}
                                                                <div className="min-w-0 flex-1">
                                                                    {/* line-clamp, not truncate. This panel is
                                    w-80, and after the unread dot, the icon
                                    and the dismiss button, a single-line
                                    ellipsis cut most titles mid-word - an
                                    addon alert read "AIOMetadata (slicknsli..."
                                    with the actual event (went offline / back
                                    online) never visible. Wrapping to two
                                    lines fits the whole thing while still
                                    bounding how tall one row can get.
                                    Three, not two: at 2 an unusually long
                                    addon name pushed the event itself
                                    ('went offline') onto a third line and
                                    clipped it - measured cutting the last
                                    two characters off a 44-character name,
                                    which loses the one word that matters.
                                    Short titles are unaffected; the clamp
                                    only caps, it doesn't reserve height. */}
                                                                    <p className="line-clamp-3 break-words font-medium text-default text-sm">
                                                                        {notification.title}
                                                                    </p>
                                                                    <p className="mt-0.5 line-clamp-2 break-words text-muted text-xs">
                                                                        {notification.message}
                                                                    </p>
                                                                    <p className="mt-1 text-subtle text-xs">
                                                                        {formatNotificationTime(
                                                                            notification.timestamp
                                                                        )}
                                                                    </p>
                                                                </div>
                                                                {/* Pending requests already clear themselves
                                  from the list via Accept/Reject below - an
                                  extra dismiss button there would let one
                                  get hidden without ever being acted on.
                                  On a phone the row is swiped away instead. */}
                                                                {notification.type !== "request" &&
                                                                    !swipeToDismiss && (
                                                                        <button
                                                                            aria-label="Dismiss notification"
                                                                            className="shrink-0 rounded-md p-1 text-subtle transition-colors hover:bg-surface hover:text-default"
                                                                            onClick={(e) =>
                                                                                handleDismiss(
                                                                                    e,
                                                                                    notification.id
                                                                                )
                                                                            }
                                                                            title="Dismiss"
                                                                            type="button"
                                                                        >
                                                                            <XMarkIcon className="h-4 w-4" />
                                                                        </button>
                                                                    )}
                                                            </div>

                                                            {/* Actions for requests */}
                                                            {notification.type === "request" &&
                                                                notification.data && (
                                                                    <div className="flex items-center gap-2 pl-10">
                                                                        <Button
                                                                            className="h-7 px-3 text-xs"
                                                                            onClick={(e) =>
                                                                                handleAcceptRequest(
                                                                                    e,
                                                                                    notification
                                                                                        .data.id
                                                                                )
                                                                            }
                                                                            size="sm"
                                                                            variant="primary"
                                                                        >
                                                                            Accept
                                                                        </Button>
                                                                        <Button
                                                                            className="h-7 px-3 text-xs"
                                                                            onClick={(e) =>
                                                                                handleRejectRequest(
                                                                                    e,
                                                                                    notification
                                                                                        .data.id
                                                                                )
                                                                            }
                                                                            size="sm"
                                                                            variant="secondary"
                                                                        >
                                                                            Reject
                                                                        </Button>
                                                                    </div>
                                                                )}
                                                        </div>
                                                    </motion.div>
                                                </SwipeToDismiss>
                                            ))}
                                        </div>
                                    )}
                                </div>
                            </div>
                        </motion.div>
                    </>
                )}
            </AnimatePresence>
        </div>
    );
}
