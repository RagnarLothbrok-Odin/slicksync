"use client";

import {
    CalendarDaysIcon,
    ChevronRightIcon,
    SpeakerWaveIcon,
    SpeakerXMarkIcon,
    TvIcon,
    XCircleIcon,
} from "@heroicons/react/24/outline";
import type { ReactNode } from "react";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
    Button,
    ContextMenu,
    FilterTabs,
    MediaDetailModal,
    Modal,
    useContextMenu,
} from "@/components/ui";
import { toast } from "@/components/ui/Toast";
import { api, type MutedShow, type UpcomingEpisode } from "@/lib/api";
import { usePersonalFeatures } from "@/lib/hooks/usePersonalFeatures";
import { posterUrl } from "@/lib/posterUrl";

// Shared airing agenda for admin and personal dashboards. Only dates containing
// a tracked release appear in the date strip; there are no empty
// calendar cells. Household hide/mute permissions stay with the calling panel.

const LONG_PRESS_MS = 500;

function epLabel(season: number, episode: number) {
    return `S${String(season).padStart(2, "0")}E${String(episode).padStart(2, "0")}`;
}

// Date-only calendar events have no air time. Keep their provided day local
// rather than interpreting midnight as UTC and shifting it in western zones.
function calendarDate(value: string) {
    return new Date(/^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T00:00:00` : value);
}

// "Today" / "Tomorrow" / weekday within a week / short date beyond that.
function airLabel(iso: string): { text: string; soon: boolean } {
    const now = new Date();
    const air = calendarDate(iso);
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
            year: air.getFullYear() === now.getFullYear() ? undefined : "numeric",
        }),
    };
}

// Label for the selected airing date: relative word (Today/Tomorrow/
// weekday) plus the concrete date, so scanning down the list still reads like a
// calendar rather than a pile of "Monday"s across different weeks.
function dayHeaderLabel(iso: string): { text: string; soon: boolean } {
    const now = new Date();
    const air = calendarDate(iso);
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const startOfAir = new Date(air.getFullYear(), air.getMonth(), air.getDate()).getTime();
    const days = Math.round((startOfAir - startOfToday) / (24 * 60 * 60 * 1000));
    const date = air.toLocaleDateString(undefined, {
        day: "numeric",
        month: "short",
        weekday: "short",
        year: air.getFullYear() === now.getFullYear() ? undefined : "numeric",
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
        const air = calendarDate(it.airDate);
        const ts = new Date(air.getFullYear(), air.getMonth(), air.getDate()).getTime();
        const key = String(ts);
        const group = groups.get(key);
        if (group) {
            group.items.push(it);
        } else {
            groups.set(key, { items: [it], key, ts });
        }
    }
    return [...groups.values()].sort((a, b) => a.ts - b.ts);
}

// A single row. Extracted so each has its own context-menu hook, otherwise the
// menu's shared position would jump to whichever row was right-clicked last.
const UpcomingRow = memo(function UpcomingRowLocal({
    item,
    onOpen,
    onDismiss,
    onMute,
    householdActions = true,
    cacheImages = true,
    showAirDate = true,
}: {
    householdActions?: boolean;
    cacheImages?: boolean;
    showAirDate?: boolean;
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
        <div className="relative w-64 shrink-0 snap-start">
            <button
                className="tap-card flex h-full min-h-36 w-full items-stretch gap-4 rounded-2xl border border-default bg-surface p-4 text-left transition-colors hover:border-primary/40 hover:bg-surface-hover focus-visible:outline-2 focus-visible:outline-primary active:bg-surface-hover"
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
                <div className="flex h-28 w-18 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-surface-hover">
                    {item.poster ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                            alt=""
                            className="h-full w-full object-cover"
                            height={112}
                            src={
                                cacheImages
                                    ? posterUrl(
                                          { id: item.showId, poster: item.poster },
                                          rpdbEnabled
                                      )
                                    : item.poster
                            }
                            width={72}
                        />
                    ) : (
                        <TvIcon className="h-5 w-5 text-subtle" />
                    )}
                </div>
                <div className="flex min-w-0 flex-1 flex-col items-start">
                    {showAirDate && (
                        <span
                            className={`mb-2 inline-block font-medium text-xs ${
                                label.soon ? "text-primary" : "text-muted"
                            }`}
                        >
                            {label.text}
                        </span>
                    )}
                    <p className="truncate font-medium text-default text-sm">
                        {item.showName || "Unknown show"}
                    </p>
                    <p className="truncate text-muted text-xs">
                        {item.mediaType === "movie"
                            ? item.releaseType === "digital"
                                ? "Digital release"
                                : "Movie release"
                            : epLabel(item.season, item.episode)}
                    </p>
                    {item.title && (
                        <p className="mt-1 line-clamp-2 text-muted text-xs">{item.title}</p>
                    )}
                    {!/^\d{4}-\d{2}-\d{2}$/.test(item.airDate) && (
                        <p className="mt-auto pt-3 text-muted text-xs tabular-nums">
                            {calendarDate(item.airDate).toLocaleTimeString(undefined, {
                                hour: "2-digit",
                                minute: "2-digit",
                            })}
                        </p>
                    )}
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

export const UpcomingEpisodesPanel = memo(function UpcomingEpisodesPanelLocal({
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
    const [selectedDay, setSelectedDay] = useState("all");
    const [mediaFilter, setMediaFilter] = useState("all");
    const dateStrip = useRef<HTMLFieldSetElement>(null);
    const groups = useMemo(
        () =>
            groupByDay(
                items.filter(
                    (item) =>
                        Number.isFinite(Date.parse(item.airDate)) &&
                        (mediaFilter === "all" || (item.mediaType || "series") === mediaFilter)
                )
            ),
        [items, mediaFilter]
    );
    // If a day's final episode is hidden, move to the next available date.
    const activeDay =
        selectedDay === "all"
            ? "all"
            : groups.some((group) => group.key === selectedDay)
              ? selectedDay
              : groups[0]?.key;
    const activeGroup = groups.find((group) => group.key === activeDay);
    const visibleItems =
        activeDay === "all" ? groups.flatMap((group) => group.items) : activeGroup?.items || [];

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

    return (
        <>
            <section aria-label="Upcoming episodes" className="mb-6">
                <div>
                    <div className="mb-4 flex items-center justify-between gap-3">
                        <div className="flex min-w-0 items-center gap-2">
                            <CalendarDaysIcon className="h-5 w-5 shrink-0 text-primary" />
                            <h2 className="font-display font-semibold text-base text-default">
                                Upcoming
                            </h2>
                        </div>
                        <div className="flex flex-wrap items-center justify-end gap-2">
                            <FilterTabs
                                activeKey={mediaFilter}
                                onChange={(value) => {
                                    setMediaFilter(value);
                                    setSelectedDay("all");
                                }}
                                options={[
                                    { key: "all", label: "All" },
                                    { key: "series", label: "TV Shows" },
                                    { key: "movie", label: "Movies" },
                                ]}
                                size="sm"
                            />
                            {householdActions && (
                                <Button
                                    aria-label="Manage muted shows"
                                    leftIcon={<SpeakerXMarkIcon className="h-4 w-4" />}
                                    onClick={openMutedModal}
                                    size="sm"
                                    variant="ghost"
                                >
                                    <span className="hidden sm:inline">Muted shows</span>
                                </Button>
                            )}
                        </div>
                    </div>
                    {groups.length ? (
                        <>
                            <div className="relative">
                                <fieldset
                                    className="flex min-w-0 snap-x snap-proximity gap-3 overflow-x-auto p-1 pr-14 pb-3"
                                    ref={dateStrip}
                                >
                                    <legend className="sr-only">Choose an airing date</legend>
                                    <button
                                        aria-pressed={activeDay === "all"}
                                        className="airing-date flex min-h-28 min-w-28 shrink-0 flex-col items-center justify-center gap-1 rounded-2xl px-3"
                                        onClick={() => setSelectedDay("all")}
                                        type="button"
                                    >
                                        <CalendarDaysIcon className="h-5 w-5" />
                                        <span className="font-medium text-xs">All upcoming</span>
                                    </button>
                                    {groups.map((group) => {
                                        const date = new Date(group.ts);
                                        const selected = activeDay === group.key;
                                        const label = dayHeaderLabel(group.items[0].airDate);
                                        return (
                                            <button
                                                aria-label={`${label.text}, ${group.items.length} release${group.items.length === 1 ? "" : "s"}`}
                                                aria-pressed={selected}
                                                className="airing-date flex min-h-28 min-w-28 shrink-0 flex-col items-center justify-center rounded-2xl px-3 py-2"
                                                key={group.key}
                                                onClick={() => setSelectedDay(group.key)}
                                                type="button"
                                            >
                                                <span className="font-medium text-xs">
                                                    {date.toLocaleDateString(undefined, {
                                                        weekday: "short",
                                                    })}
                                                </span>
                                                <span className="font-display font-semibold text-2xl leading-tight tracking-tight">
                                                    {date.getDate()}
                                                </span>
                                                <span className="text-xs">
                                                    {date.toLocaleDateString(undefined, {
                                                        month: "short",
                                                        ...(date.getFullYear() ===
                                                        new Date().getFullYear()
                                                            ? {}
                                                            : { year: "numeric" as const }),
                                                    })}
                                                </span>
                                            </button>
                                        );
                                    })}
                                </fieldset>
                                <button
                                    aria-label="Show later dates"
                                    className="absolute top-1 right-0 flex h-28 w-11 items-center justify-center rounded-2xl border border-default bg-surface text-muted transition-colors hover:bg-surface-hover hover:text-primary focus-visible:outline-2 focus-visible:outline-primary"
                                    onClick={() =>
                                        dateStrip.current?.scrollBy({
                                            behavior: window.matchMedia(
                                                "(prefers-reduced-motion: reduce)"
                                            ).matches
                                                ? "instant"
                                                : "smooth",
                                            left: dateStrip.current.clientWidth * 0.7,
                                        })
                                    }
                                    type="button"
                                >
                                    <ChevronRightIcon aria-hidden="true" className="h-5 w-5" />
                                </button>
                            </div>
                            <div
                                aria-live="polite"
                                className="mt-2 mb-2 flex flex-wrap items-baseline gap-x-2 gap-y-1"
                            >
                                <h3 className="font-semibold text-default text-sm">
                                    {activeGroup
                                        ? dayHeaderLabel(activeGroup.items[0].airDate).text
                                        : "All upcoming"}
                                </h3>
                                <span className="text-subtle text-xs">
                                    {visibleItems.length} release
                                    {visibleItems.length === 1 ? "" : "s"}
                                </span>
                            </div>
                            <div className="flex snap-x snap-proximity items-stretch gap-3 overflow-x-auto pb-3">
                                {visibleItems.map((item) => (
                                    <UpcomingRow
                                        cacheImages={householdActions}
                                        householdActions={
                                            householdActions && item.mediaType !== "movie"
                                        }
                                        item={item}
                                        key={
                                            item.eventId ||
                                            `${item.showId}-${item.season}-${item.episode}`
                                        }
                                        onDismiss={handleDismiss}
                                        onMute={handleMute}
                                        onOpen={setDetail}
                                        showAirDate
                                    />
                                ))}
                            </div>
                        </>
                    ) : (
                        <p className="py-2 text-muted text-sm">
                            {mediaFilter === "movie"
                                ? "No upcoming movie releases from your calendar source."
                                : "No upcoming episodes scheduled for your tracked series."}
                        </p>
                    )}
                </div>
            </section>

            {detail &&
                (renderDetail ? (
                    renderDetail(detail, () => setDetail(null))
                ) : (
                    <MediaDetailModal
                        fallbackPoster={detail.poster}
                        fallbackTitle={detail.showName || "Upcoming episode"}
                        isOpen={!!detail}
                        itemId={detail.showId}
                        itemType={detail.mediaType || "series"}
                        onClose={() => setDetail(null)}
                    />
                ))}

            <Modal
                isOpen={isMutedModalOpen}
                onClose={() => setIsMutedModalOpen(false)}
                size="md"
                title="Muted Shows"
            >
                {mutedShows.length === 0 ? (
                    <p className="py-4 text-center text-muted text-sm">
                        No muted shows. "Stop tracking this series" on any Coming Up entry adds it
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
                                            height={44}
                                            src={show.poster}
                                            width={32}
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
