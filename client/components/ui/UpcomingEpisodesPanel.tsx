"use client";

import {
    CalendarDaysIcon,
    ChevronLeftIcon,
    ChevronRightIcon,
    SpeakerWaveIcon,
    SpeakerXMarkIcon,
    TvIcon,
    XCircleIcon,
} from "@heroicons/react/24/outline";
import type { KeyboardEvent, ReactNode } from "react";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
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

// Both dashboards share this inline calendar. The poller supplies each tracked
// show's next episode, not a complete season schedule. Hide and mute remain
// household controls; personal calendars only read their own scoped data.

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

// Use local calendar dates, matching the episode labels. Building days with
// the Date constructor also handles month boundaries and daylight-saving time.
function dayKey(date: Date): string {
    return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
}

function monthStart(date: Date): Date {
    return new Date(date.getFullYear(), date.getMonth(), 1);
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
                            height={56}
                            src={
                                cacheImages
                                    ? posterUrl(
                                          { id: item.showId, poster: item.poster },
                                          rpdbEnabled
                                      )
                                    : item.poster
                            }
                            width={40}
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
    const [selectedDate, setSelectedDate] = useState(() => new Date());
    const [visibleMonth, setVisibleMonth] = useState(() => monthStart(new Date()));
    const [loadError, setLoadError] = useState(false);
    const [retry, setRetry] = useState(0);
    const calendarRef = useRef<HTMLDivElement>(null);
    const focusDay = useRef(false);

    const sortedItems = useMemo(
        () =>
            items
                .filter((item) => Number.isFinite(Date.parse(item.airDate)))
                .sort((a, b) => Date.parse(a.airDate) - Date.parse(b.airDate)),
        [items]
    );
    const episodesByDay = useMemo(() => {
        const grouped = new Map<string, UpcomingEpisode[]>();
        for (const item of sortedItems) {
            const key = dayKey(new Date(item.airDate));
            grouped.set(key, [...(grouped.get(key) || []), item]);
        }
        return grouped;
    }, [sortedItems]);
    const days = useMemo(() => {
        const offset = (visibleMonth.getDay() + 6) % 7;
        return Array.from(
            { length: 42 },
            (_, index) =>
                new Date(visibleMonth.getFullYear(), visibleMonth.getMonth(), 1 - offset + index)
        );
    }, [visibleMonth]);
    const selectedItems = episodesByDay.get(dayKey(selectedDate)) || [];
    const nextItem = sortedItems.find((item) => {
        const date = new Date(item.airDate);
        return (
            new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime() >
            new Date(
                selectedDate.getFullYear(),
                selectedDate.getMonth(),
                selectedDate.getDate()
            ).getTime()
        );
    });
    const monthCount = sortedItems.filter((item) => {
        const date = new Date(item.airDate);
        return (
            date.getFullYear() === visibleMonth.getFullYear() &&
            date.getMonth() === visibleMonth.getMonth()
        );
    }).length;

    const selectDate = (date: Date) => {
        setSelectedDate(date);
        setVisibleMonth(monthStart(date));
    };
    const changeMonth = (offset: number) => {
        selectDate(new Date(visibleMonth.getFullYear(), visibleMonth.getMonth() + offset, 1));
    };
    const handleDayKey = (event: KeyboardEvent<HTMLButtonElement>, date: Date) => {
        const weekday = (date.getDay() + 6) % 7;
        const offsets: Record<string, number> = {
            ArrowDown: 7,
            ArrowLeft: -1,
            ArrowRight: 1,
            ArrowUp: -7,
            End: 6 - weekday,
            Home: -weekday,
        };
        const offset = offsets[event.key];
        if (offset === undefined) {
            return;
        }
        event.preventDefault();
        focusDay.current = true;
        selectDate(new Date(date.getFullYear(), date.getMonth(), date.getDate() + offset));
    };

    useEffect(() => {
        if (focusDay.current) {
            calendarRef.current
                ?.querySelector<HTMLButtonElement>(`[data-date="${dayKey(selectedDate)}"]`)
                ?.focus();
            focusDay.current = false;
        }
    }, [selectedDate]);

    useEffect(() => {
        let cancelled = false;
        setLoadError(false);
        client
            .getUpcomingEpisodes()
            .then((result) => {
                if (!cancelled) {
                    setItems(Array.isArray(result) ? result : []);
                }
            })
            .catch(() => {
                if (!cancelled) {
                    setLoadError(true);
                }
            })
            .finally(() => {
                if (!cancelled) {
                    setLoaded(true);
                }
            });
        return () => {
            cancelled = true;
        };
    }, [client, retry]);

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

    const today = new Date();
    const selectedLabel = selectedDate.toLocaleDateString(undefined, {
        day: "numeric",
        month: "long",
        weekday: "long",
        year: "numeric",
    });

    return (
        <>
            <section aria-label="Episode calendar" className="mb-6">
                <Card padding="none">
                    <div className="flex items-center justify-between gap-3 px-5 pt-5 sm:px-6">
                        <div className="flex min-w-0 items-center gap-3">
                            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
                                <CalendarDaysIcon className="h-5 w-5" />
                            </div>
                            <div>
                                <h2 className="font-display font-semibold text-default text-lg tracking-tight">
                                    Calendar
                                </h2>
                                <p className="mt-0.5 text-muted text-xs">
                                    Next episodes for the series you’re watching.
                                </p>
                            </div>
                        </div>
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
                    {loadError ? (
                        <div className="flex flex-wrap items-center gap-3 p-6" role="status">
                            <p className="text-muted text-sm">
                                Calendar couldn’t load. Please try again.
                            </p>
                            <Button
                                onClick={() => setRetry((value) => value + 1)}
                                size="sm"
                                variant="secondary"
                            >
                                Retry
                            </Button>
                        </div>
                    ) : (
                        <div className="grid gap-6 p-3 sm:p-6 lg:grid-cols-2 lg:gap-8">
                            <div className="min-w-0" ref={calendarRef}>
                                <div className="mb-4 flex flex-wrap items-center justify-between gap-x-4 gap-y-3">
                                    <div aria-live="polite">
                                        <h3 className="font-display font-semibold text-default text-lg tracking-tight">
                                            {visibleMonth.toLocaleDateString(undefined, {
                                                month: "long",
                                                year: "numeric",
                                            })}
                                        </h3>
                                        <p className="mt-0.5 text-subtle text-xs">
                                            {monthCount} episode{monthCount === 1 ? "" : "s"} this
                                            month
                                        </p>
                                    </div>
                                    <div className="flex shrink-0 items-center gap-1">
                                        <Button
                                            onClick={() => selectDate(new Date())}
                                            size="sm"
                                            variant="secondary"
                                        >
                                            Today
                                        </Button>
                                        <Button
                                            aria-label="Previous month"
                                            onClick={() => changeMonth(-1)}
                                            size="sm"
                                            variant="ghost"
                                        >
                                            <ChevronLeftIcon className="h-4 w-4" />
                                        </Button>
                                        <Button
                                            aria-label="Next month"
                                            onClick={() => changeMonth(1)}
                                            size="sm"
                                            variant="ghost"
                                        >
                                            <ChevronRightIcon className="h-4 w-4" />
                                        </Button>
                                    </div>
                                </div>
                                <fieldset className="grid min-w-0 grid-cols-7 gap-y-1">
                                    <legend className="sr-only">Choose a date</legend>
                                    {Array.from({ length: 7 }, (_, index) => {
                                        const day = new Date(2024, 0, 1 + index);
                                        return (
                                            <span
                                                className="py-2 text-center font-medium text-subtle text-xs"
                                                key={index}
                                            >
                                                {day.toLocaleDateString(undefined, {
                                                    weekday: "short",
                                                })}
                                            </span>
                                        );
                                    })}
                                    {days.map((date) => {
                                        const key = dayKey(date);
                                        const count = episodesByDay.get(key)?.length || 0;
                                        const selected = key === dayKey(selectedDate);
                                        const isToday = key === dayKey(today);
                                        const inMonth = date.getMonth() === visibleMonth.getMonth();
                                        return (
                                            <button
                                                aria-current={isToday ? "date" : undefined}
                                                aria-label={`${date.toLocaleDateString(undefined, { day: "numeric", month: "long", weekday: "long", year: "numeric" })}, ${count} episode${count === 1 ? "" : "s"}`}
                                                aria-pressed={selected}
                                                className={`flex min-h-12 flex-col items-center justify-center gap-1 rounded-xl py-1 text-sm transition-colors hover:bg-surface-hover focus-visible:outline-2 focus-visible:outline-primary focus-visible:outline-offset-2 ${inMonth ? "text-default" : "text-subtle"}`}
                                                data-date={key}
                                                key={key}
                                                onClick={() => selectDate(date)}
                                                onKeyDown={(event) => handleDayKey(event, date)}
                                                tabIndex={selected ? 0 : -1}
                                                type="button"
                                            >
                                                <span
                                                    className={`flex h-8 w-8 items-center justify-center rounded-full ${selected ? "bg-primary font-semibold" : ""}`}
                                                    style={
                                                        selected
                                                            ? { color: "var(--color-bg)" }
                                                            : isToday
                                                              ? {
                                                                    boxShadow:
                                                                        "inset 0 0 0 1px var(--color-primary)",
                                                                    color: "var(--color-primary)",
                                                                }
                                                              : undefined
                                                    }
                                                >
                                                    {date.getDate()}
                                                </span>
                                                <span
                                                    aria-hidden="true"
                                                    className={`h-1 w-1 rounded-full bg-primary ${count ? "" : "invisible"}`}
                                                />
                                            </button>
                                        );
                                    })}
                                </fieldset>
                                <p className="mt-3 text-center text-subtle text-xs">
                                    A dot marks a scheduled episode.
                                </p>
                            </div>
                            <div className="flex min-w-0 flex-col rounded-2xl bg-surface-hover/40 p-4 sm:p-5">
                                <div aria-live="polite" className="mb-4">
                                    <p className="font-medium text-primary text-xs">
                                        {dayKey(selectedDate) === dayKey(today)
                                            ? "Today"
                                            : "Selected day"}
                                    </p>
                                    <h3 className="mt-1 font-display font-semibold text-default text-lg tracking-tight">
                                        {selectedLabel}
                                    </h3>
                                </div>
                                {selectedItems.length ? (
                                    <div className="max-h-80 space-y-2 overflow-y-auto">
                                        {selectedItems.map((item) => (
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
                                ) : (
                                    <div className="flex flex-1 flex-col items-center justify-center px-2 py-8 text-center">
                                        <CalendarDaysIcon className="mb-3 h-8 w-8 text-subtle" />
                                        <p className="font-medium text-default text-sm">
                                            A quiet day.
                                        </p>
                                        <p className="mt-1 max-w-64 text-muted text-sm">
                                            {sortedItems.length
                                                ? "No tracked episodes are scheduled for this date."
                                                : "Upcoming episodes will appear as your tracked series announce new dates."}
                                        </p>
                                    </div>
                                )}
                                {nextItem && (
                                    <button
                                        className="mt-4 flex min-h-11 w-full items-center justify-between gap-3 rounded-xl p-2 text-left text-primary text-xs transition-colors hover:bg-surface-hover focus-visible:outline-2 focus-visible:outline-primary"
                                        onClick={() => selectDate(new Date(nextItem.airDate))}
                                        type="button"
                                    >
                                        <span className="min-w-0">
                                            <span className="block font-medium">
                                                Next episode · {airLabel(nextItem.airDate).text}
                                            </span>
                                            <span className="mt-1 block truncate text-muted">
                                                {nextItem.showName || "Upcoming episode"}
                                            </span>
                                        </span>
                                        <ChevronRightIcon className="h-4 w-4 shrink-0" />
                                    </button>
                                )}
                                {householdActions && (
                                    <p className="mt-3 text-subtle text-xs">
                                        Right-click or long-press an episode to hide it or stop
                                        tracking.
                                    </p>
                                )}
                            </div>
                        </div>
                    )}
                </Card>
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
                        itemType="series"
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
                        No muted shows. "Stop tracking this series" on any calendar entry adds it
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
