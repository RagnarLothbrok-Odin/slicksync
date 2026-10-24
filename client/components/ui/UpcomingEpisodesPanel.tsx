"use client";

import {
    CalendarDaysIcon,
    SpeakerWaveIcon,
    SpeakerXMarkIcon,
    TvIcon,
    XCircleIcon,
} from "@heroicons/react/24/outline";
import type { ReactNode } from "react";
import { memo, useCallback, useEffect, useRef, useState } from "react";
import {
    Button,
    Card,
    ContextMenu,
    MediaDetailModal,
    Modal,
    useContextMenu,
} from "@/components/ui";
import { toast } from "@/components/ui/Toast";
import { api, type MutedShow, type UpcomingEpisode } from "@/lib/api";
import { usePersonalFeatures } from "@/lib/hooks/usePersonalFeatures";
import { posterUrl } from "@/lib/posterUrl";

// Dashboard "Coming up" calendar: the next upcoming episode for every show
// someone here is mid-season on. Data is precomputed server-side by the
// episode-alerts poller (utils/episodeAlerts.js) and read straight from the
// DB — no Cinemeta call on page load. Renders nothing when there's nothing
// upcoming, so it never shows an empty shell.
//
// Right-click (desktop) or long-press (touch) any row to hide it. Dismissals
// are keyed by (showId, season, episode) and persisted server-side, so a hide
// carries across devices AND automatically clears itself when the poller
// advances the show to a new next episode (that new one isn't in the dismiss
// list, so it re-appears without any manual reset).

const LONG_PRESS_MS = 500;

function epLabel(season: number, episode: number) {
    return `S${String(season).padStart(2, "0")}E${String(episode).padStart(2, "0")}`;
}

// "Today" / "Tomorrow" / weekday within a week / short date beyond that.
function airLabel(iso: string): { text: string; soon: boolean } {
    const now = new Date();
    const air = new Date(iso);
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const startOfAir = new Date(air.getFullYear(), air.getMonth(), air.getDate()).getTime();
    const days = Math.round((startOfAir - startOfToday) / (24 * 60 * 60 * 1000));
    if (days <= 0) {
        return { soon: true, text: "Today" };
    }
    if (days === 1) {
        return { soon: true, text: "Tomorrow" };
    }
    if (days < 7) {
        return { soon: false, text: air.toLocaleDateString(undefined, { weekday: "long" }) };
    }
    return {
        soon: false,
        text: air.toLocaleDateString(undefined, {
            day: "numeric",
            month: "short",
            weekday: "short",
        }),
    };
}

// Day-header label for the full-calendar agenda: relative word (Today/Tomorrow/
// weekday) plus the concrete date, so scanning down the list still reads like a
// calendar rather than a pile of "Monday"s across different weeks.
function dayHeaderLabel(iso: string): { text: string; soon: boolean } {
    const now = new Date();
    const air = new Date(iso);
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const startOfAir = new Date(air.getFullYear(), air.getMonth(), air.getDate()).getTime();
    const days = Math.round((startOfAir - startOfToday) / (24 * 60 * 60 * 1000));
    const date = air.toLocaleDateString(undefined, {
        day: "numeric",
        month: "short",
        weekday: "short",
    });
    if (days <= 0) {
        return { soon: true, text: `Today · ${date}` };
    }
    if (days === 1) {
        return { soon: true, text: `Tomorrow · ${date}` };
    }
    return { soon: days < 7, text: date };
}

// Bucket already-air-date-sorted items into per-calendar-day groups (stable
// order preserved within each day). Keyed on local Y/M/D so "airs today" and
// "airs tomorrow" split cleanly regardless of the wall-clock time of day.
function groupByDay(
    items: UpcomingEpisode[]
): { key: string; ts: number; items: UpcomingEpisode[] }[] {
    const groups = new Map<string, { key: string; ts: number; items: UpcomingEpisode[] }>();
    for (const it of items) {
        const air = new Date(it.airDate);
        const ts = new Date(air.getFullYear(), air.getMonth(), air.getDate()).getTime();
        const key = String(ts);
        if (!groups.has(key)) {
            groups.set(key, { items: [], key, ts });
        }
        groups.get(key)!.items.push(it);
    }
    return [...groups.values()].sort((a, b) => a.ts - b.ts);
}

// A single row. Extracted so each has its own context-menu hook, otherwise the
// menu's shared position would jump to whichever row was right-clicked last.
const UpcomingRow = memo(function UpcomingRow({
    item,
    onOpen,
    onDismiss,
    onMute,
    householdActions = true,
    cacheImages = true,
}: {
    householdActions?: boolean;
    cacheImages?: boolean;
    item: UpcomingEpisode;
    onOpen: (item: UpcomingEpisode) => void;
    onDismiss: (item: UpcomingEpisode) => void;
    onMute: (item: UpcomingEpisode) => void;
}) {
    const { isOpen, position, handleContextMenu, close } = useContextMenu();
    const label = airLabel(item.airDate);
    const { rpdbEnabled } = usePersonalFeatures();

    // Long-press → context menu for touch devices. Cancel on move/scroll so a
    // scroll gesture doesn't get hijacked into a menu open. Track start position
    // so tiny finger jitter still counts as a press, not a scroll.
    const pressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
    const startPos = useRef<{ x: number; y: number } | null>(null);
    const clearPress = () => {
        if (pressTimer.current) {
            clearTimeout(pressTimer.current);
            pressTimer.current = null;
        }
        startPos.current = null;
    };
    const handleTouchStart = (e: React.TouchEvent) => {
        const t = e.touches[0];
        if (!t) {
            return;
        }
        startPos.current = { x: t.clientX, y: t.clientY };
        pressTimer.current = setTimeout(() => {
            // Manually invoke the hook's opener — position from the initial touch,
            // then a synthetic preventDefault to keep the click from also firing.
            handleContextMenu(e as unknown as Event, t.clientX, t.clientY);
            pressTimer.current = null;
        }, LONG_PRESS_MS);
    };
    const handleTouchMove = (e: React.TouchEvent) => {
        if (!(startPos.current && pressTimer.current)) {
            return;
        }
        const t = e.touches[0];
        if (!t) {
            return;
        }
        const dx = Math.abs(t.clientX - startPos.current.x);
        const dy = Math.abs(t.clientY - startPos.current.y);
        if (dx > 10 || dy > 10) {
            clearPress();
        }
    };

    return (
        <div className="relative">
            <button
                className="tap-card flex w-full items-center gap-3 rounded-lg p-2 text-left transition-colors hover:bg-surface-hover"
                onClick={() => {
                    // Suppress the click that fires immediately after a long-press.
                    if (isOpen) {
                        return;
                    }
                    onOpen(item);
                }}
                onContextMenu={householdActions ? handleContextMenu : undefined}
                onTouchCancel={clearPress}
                onTouchEnd={clearPress}
                onTouchMove={handleTouchMove}
                onTouchStart={householdActions ? handleTouchStart : undefined}
                type="button"
            >
                <div className="flex h-14 w-10 flex-shrink-0 items-center justify-center overflow-hidden rounded-md bg-surface-hover">
                    {item.poster ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                            alt=""
                            className="h-full w-full object-cover"
                            src={
                                cacheImages
                                    ? posterUrl(
                                          { id: item.showId, poster: item.poster },
                                          rpdbEnabled
                                      )
                                    : item.poster
                            }
                        />
                    ) : (
                        <TvIcon className="h-5 w-5 text-subtle" />
                    )}
                </div>
                <div className="min-w-0 flex-1">
                    <span
                        className={`mb-1 inline-block rounded-full px-2 py-0.5 font-medium text-xs ${
                            label.soon
                                ? "bg-primary/15 text-primary"
                                : "bg-surface-hover text-muted"
                        }`}
                    >
                        {label.text}
                    </span>
                    <p className="truncate font-medium text-default text-sm">
                        {item.showName || "Unknown show"}
                    </p>
                    <p className="truncate text-muted text-xs">
                        {epLabel(item.season, item.episode)}
                        {item.title ? ` · ${item.title}` : ""}
                    </p>
                </div>
            </button>

            <ContextMenu isOpen={householdActions && isOpen} onClose={close} position={position}>
                <button
                    className="flex w-full items-center gap-2 px-3 py-2 text-default text-sm transition-colors hover:bg-surface-hover"
                    onClick={() => {
                        close();
                        onDismiss(item);
                    }}
                    type="button"
                >
                    <XCircleIcon className="h-4 w-4" />
                    Hide this episode
                </button>
                <button
                    className="flex w-full items-center gap-2 px-3 py-2 text-default text-sm transition-colors hover:bg-surface-hover"
                    onClick={() => {
                        close();
                        onMute(item);
                    }}
                    type="button"
                >
                    <SpeakerXMarkIcon className="h-4 w-4" />
                    Stop tracking this series
                </button>
            </ContextMenu>
        </div>
    );
});

type CalendarClient = Pick<
    typeof api,
    "getUpcomingEpisodes" | "dismissUpcomingEpisode" | "muteShow" | "getMutedShows" | "unmuteShow"
>;

export const UpcomingEpisodesPanel = memo(function UpcomingEpisodesPanel({
    client = api,
    householdActions = true,
    renderDetail,
}: {
    client?: CalendarClient;
    householdActions?: boolean;
    renderDetail?: (item: UpcomingEpisode, onClose: () => void) => ReactNode;
} = {}) {
    const [items, setItems] = useState<UpcomingEpisode[]>([]);
    const [loaded, setLoaded] = useState(false);
    const [detail, setDetail] = useState<UpcomingEpisode | null>(null);
    const [mutedShows, setMutedShows] = useState<MutedShow[]>([]);
    const [isMutedModalOpen, setIsMutedModalOpen] = useState(false);
    const [isCalendarOpen, setIsCalendarOpen] = useState(false);

    useEffect(() => {
        client
            .getUpcomingEpisodes()
            .then((r) => setItems(Array.isArray(r) ? r : []))
            .catch(() => setItems([]))
            .finally(() => setLoaded(true));
    }, [client]);

    // Optimistically removes the row, but only keeps it gone (and only tells
    // the user it worked) once the server call actually confirms it - a
    // silently-swallowed failure here used to still show a success toast and
    // hide the row for the rest of this session, so a real (if rare) failure
    // read as "I hid it but it came back" on the next visit, with no error
    // ever shown.
    const handleDismiss = useCallback(
        async (item: UpcomingEpisode) => {
            setItems((prev) =>
                prev.filter(
                    (i) =>
                        !(
                            i.showId === item.showId &&
                            i.season === item.season &&
                            i.episode === item.episode
                        )
                )
            );
            try {
                await client.dismissUpcomingEpisode(item.showId, item.season, item.episode);
                toast.success(
                    `Hidden ${item.showName || "episode"} ${epLabel(item.season, item.episode)}`
                );
            } catch {
                setItems((prev) => [...prev, item]);
                toast.error(`Failed to hide ${item.showName || "that episode"} - try again`);
            }
        },
        [client]
    );

    // Mutes the whole show, not just this one episode - removes every row for
    // it (there's only ever one per show anyway) and stops future new-episode
    // alerts server-side too. See utils/episodeAlerts.js's muteShow. Same
    // confirm-before-celebrating pattern as handleDismiss above.
    const handleMute = useCallback(
        async (item: UpcomingEpisode) => {
            setItems((prev) => prev.filter((i) => i.showId !== item.showId));
            try {
                await client.muteShow(
                    item.showId,
                    item.showName || undefined,
                    item.poster || undefined
                );
                toast.success(
                    `Won't track new episodes for ${item.showName || "this show"} anymore`
                );
            } catch {
                setItems((prev) => [...prev, item]);
                toast.error(`Failed to stop tracking ${item.showName || "that show"} - try again`);
            }
        },
        [client]
    );

    const openMutedModal = useCallback(() => {
        client
            .getMutedShows()
            .then(setMutedShows)
            .catch(() => setMutedShows([]));
        setIsMutedModalOpen(true);
    }, [client]);

    const handleUnmute = useCallback(
        async (show: MutedShow) => {
            setMutedShows((prev) => prev.filter((s) => s.id !== show.id));
            try {
                await client.unmuteShow(show.showId);
                toast.success(
                    `${show.showName || "Show"} will show up again once it has a new episode`
                );
            } catch {
                setMutedShows((prev) => [...prev, show]);
                toast.error(`Failed to unmute ${show.showName || "that show"} - try again`);
            }
        },
        [client]
    );

    if (!loaded) {
        return null;
    }

    // The full card (with the episode grid) only makes sense when there's
    // something to show - but the Airing Calendar modal below handles an
    // empty list fine on its own ("Nothing on the calendar right now"), and
    // previously had NO way to be reached at all once the card vanished
    // (confirmed real case: a household not currently mid-season on anything
    // had literally no path to the calendar). A minimal always-visible link
    // keeps it reachable regardless.
    const hasItems = items.length > 0;

    return (
        <>
            {hasItems ? (
                <div className="mb-6">
                    <Card padding="lg">
                        <div className="mb-4 flex items-center gap-2">
                            <CalendarDaysIcon className="h-5 w-5 text-primary" />
                            <h3 className="font-display font-semibold text-base text-default">
                                Coming up
                            </h3>
                            {householdActions && (
                                <span className="hidden text-muted text-xs sm:inline">
                                    New episodes for shows you&apos;re watching · right-click or
                                    long-press to hide
                                </span>
                            )}
                            {householdActions && (
                                <span className="text-muted text-xs sm:hidden">
                                    Long-press to hide
                                </span>
                            )}
                            <button
                                className="ml-auto font-medium text-primary text-xs hover:underline"
                                onClick={() => setIsCalendarOpen(true)}
                                type="button"
                            >
                                Full calendar
                            </button>
                            {householdActions && (
                                <button
                                    className="rounded-lg p-1.5 text-muted transition-colors hover:bg-surface-hover hover:text-default"
                                    onClick={openMutedModal}
                                    title="Manage muted shows"
                                    type="button"
                                >
                                    <SpeakerXMarkIcon className="h-4 w-4" />
                                </button>
                            )}
                        </div>

                        {/* Grid on desktop (two columns from md up) so a healthy watchlist
            doesn't turn into a long vertical rail; single column on mobile
            where narrow rows already read cleanly. */}
                        <div className="grid grid-cols-1 gap-x-6 gap-y-1.5 md:grid-cols-2">
                            {items.slice(0, 8).map((item) => (
                                <UpcomingRow
                                    cacheImages={householdActions}
                                    householdActions={householdActions}
                                    item={item}
                                    key={`${item.showId}-${item.season}-${item.episode}`}
                                    onDismiss={handleDismiss}
                                    onMute={handleMute}
                                    onOpen={setDetail}
                                />
                            ))}
                        </div>
                    </Card>
                </div>
            ) : (
                <button
                    className="mb-6 flex items-center gap-1.5 font-medium text-muted text-xs transition-colors hover:text-primary"
                    onClick={() => setIsCalendarOpen(true)}
                    type="button"
                >
                    <CalendarDaysIcon className="h-4 w-4" />
                    Airing Calendar
                </button>
            )}

            {detail &&
                (renderDetail ? (
                    renderDetail(detail, () => setDetail(null))
                ) : (
                    <MediaDetailModal
                        fallbackPoster={detail.poster}
                        fallbackTitle={detail.showName || "Upcoming episode"}
                        isOpen={!!detail}
                        itemId={detail.showId}
                        itemType="series"
                        onClose={() => setDetail(null)}
                    />
                ))}

            {/* Full airing calendar: every tracked show's next episode, grouped by
          the day it airs. Reuses the same rows (open detail, hide, mute) as the
          compact dashboard card, but shows the whole agenda rather than the
          first eight. */}
            <Modal
                isOpen={isCalendarOpen}
                onClose={() => setIsCalendarOpen(false)}
                size="lg"
                title="Airing Calendar"
            >
                {items.length === 0 ? (
                    <p className="py-4 text-center text-muted text-sm">
                        Nothing on the calendar right now.
                    </p>
                ) : (
                    <div className="max-h-[70vh] space-y-5 overflow-y-auto pr-1">
                        {groupByDay(items).map((group) => {
                            const header = dayHeaderLabel(group.items[0].airDate);
                            return (
                                <div key={group.key}>
                                    <div className="sticky top-0 z-10 mb-1.5 flex items-center gap-2 bg-surface py-1">
                                        <CalendarDaysIcon
                                            className={`h-4 w-4 ${header.soon ? "text-primary" : "text-muted"}`}
                                        />
                                        <h4
                                            className={`font-semibold text-sm ${header.soon ? "text-primary" : "text-default"}`}
                                        >
                                            {header.text}
                                        </h4>
                                        <span className="text-subtle text-xs">
                                            {group.items.length} episode
                                            {group.items.length === 1 ? "" : "s"}
                                        </span>
                                    </div>
                                    <div className="grid grid-cols-1 gap-x-6 gap-y-1 sm:grid-cols-2">
                                        {group.items.map((item) => (
                                            <UpcomingRow
                                                cacheImages={householdActions}
                                                householdActions={householdActions}
                                                item={item}
                                                key={`${item.showId}-${item.season}-${item.episode}`}
                                                onDismiss={handleDismiss}
                                                onMute={handleMute}
                                                onOpen={(it) => {
                                                    setIsCalendarOpen(false);
                                                    setDetail(it);
                                                }}
                                            />
                                        ))}
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                )}
            </Modal>

            <Modal
                isOpen={isMutedModalOpen}
                onClose={() => setIsMutedModalOpen(false)}
                size="md"
                title="Muted Shows"
            >
                {mutedShows.length === 0 ? (
                    <p className="py-4 text-center text-muted text-sm">
                        No muted shows — "Stop tracking this series" on any Coming Up entry adds it
                        here.
                    </p>
                ) : (
                    <div className="space-y-2">
                        {mutedShows.map((show) => (
                            <div
                                className="flex items-center gap-3 rounded-lg bg-surface-hover p-2"
                                key={show.id}
                            >
                                <div className="flex h-11 w-8 flex-shrink-0 items-center justify-center overflow-hidden rounded-md bg-surface">
                                    {show.poster ? (
                                        // eslint-disable-next-line @next/next/no-img-element
                                        <img
                                            alt=""
                                            className="h-full w-full object-cover"
                                            src={show.poster}
                                        />
                                    ) : (
                                        <TvIcon className="h-4 w-4 text-subtle" />
                                    )}
                                </div>
                                <p className="min-w-0 flex-1 truncate font-medium text-default text-sm">
                                    {show.showName || "Unknown show"}
                                </p>
                                <Button
                                    leftIcon={<SpeakerWaveIcon className="h-4 w-4" />}
                                    onClick={() => handleUnmute(show)}
                                    size="sm"
                                    variant="secondary"
                                >
                                    Unmute
                                </Button>
                            </div>
                        ))}
                    </div>
                )}
            </Modal>
        </>
    );
});
