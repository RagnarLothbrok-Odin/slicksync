"use client";

// "Caught up to…": mark an episode and every aired one before it watched for
// one person - in SlickSync's History (never as watch time) and on their
// Jellyfin or AIOStreams server (server/utils/catchUp.js). Same anchored
// popup as Daily limit beside it; long runs report progress as they go.
//
// Three steps in one popup: pick the show (poster tiles of what they watch,
// or a title search), tap the last episode they have seen in a grid that
// shades everything that will be marked, then watch it run. A run can be
// undone afterwards, and tapping a ticked episode offers to un-tick it.
// Every opening starts again from the show picker.

import {
    ArrowUturnLeftIcon,
    CheckCircleIcon,
    CheckIcon,
    ChevronLeftIcon,
    MagnifyingGlassIcon,
    TvIcon,
} from "@heroicons/react/24/outline";
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { toast } from "@/components/ui/Toast";
import { ActionPill } from "@/components/user/ActionPill";
import { type PopupPlacement, placePopup, popupStyle, useFitPopup } from "@/lib/anchoredPopup";
import { api, type CatchUpEpisodes, type CatchUpJob, type CatchUpShow } from "@/lib/api";
import { usePersonalFeatures } from "@/lib/hooks/usePersonalFeatures";
import { posterUrl } from "@/lib/posterUrl";

interface Picked {
    id: string;
    name: string | null;
    poster: string | null;
}
type Episode = CatchUpEpisodes["episodes"][number];

const SEARCH_DELAY_MS = 350;
// A finished run's card clears itself after this long unless Done or Undo
// is pressed first (hovering it holds the count).
const CLEAR_AFTER_SECONDS = 5;

const upTo = (season: number, episode: number) => (e: { season: number; episode: number }) =>
    e.season < season || (e.season === season && e.episode <= episode);
const isAired = (e: Episode, now: number) =>
    !e.released || Number.isNaN(Date.parse(e.released)) || Date.parse(e.released) <= now;

function Poster({
    item,
    className,
}: {
    item: { id: string; poster: string | null };
    className: string;
}) {
    const { rpdbEnabled } = usePersonalFeatures();
    const src = posterUrl(item, rpdbEnabled);
    const [failed, setFailed] = useState(false);
    return (
        <div
            className={`flex items-center justify-center overflow-hidden border border-default bg-surface-hover ${className}`}
        >
            {src && !failed ? (
                <img
                    alt=""
                    className="h-full w-full object-cover"
                    loading="lazy"
                    onError={() => setFailed(true)}
                    src={src}
                />
            ) : (
                <TvIcon className="h-1/3 w-1/3 text-subtle" />
            )}
        </div>
    );
}

export function CatchUpButton({
    userId,
    name,
    hasServer,
    size = "md",
}: {
    userId: string;
    name: string;
    hasServer: boolean;
    /** 'sm' on a Users card, beside Limits - there it reads "Caught up". */
    size?: "sm" | "md";
}) {
    const button = useRef<HTMLButtonElement>(null);
    const panel = useRef<HTMLDivElement>(null);
    const [anchor, setAnchor] = useState<PopupPlacement | null>(null);
    const [shows, setShows] = useState<CatchUpShow[] | null>(null);
    const [query, setQuery] = useState("");
    const [results, setResults] = useState<Picked[] | null>(null);
    const [picked, setPicked] = useState<Picked | null>(null);
    const [list, setList] = useState<CatchUpEpisodes | null>(null);
    const [listError, setListError] = useState<string | null>(null);
    const [season, setSeason] = useState<number | null>(null);
    const [target, setTarget] = useState<{ season: number; episode: number } | null>(null);
    const [job, setJob] = useState<CatchUpJob | null>(null);
    const [busy, setBusy] = useState(false);
    const [secondsLeft, setSecondsLeft] = useState<number | null>(null);
    const [holding, setHolding] = useState(false);

    const open = !!anchor;
    const close = () => setAnchor(null);
    const place = () => {
        const r = button.current?.getBoundingClientRect();
        if (!r) {
            return null;
        }
        return placePopup(r, 360, panel.current?.scrollHeight);
    };
    // Back to the show picker, as on a first opening.
    const reset = () => {
        setQuery("");
        setResults(null);
        setPicked(null);
        setList(null);
        setListError(null);
        setSeason(null);
        setTarget(null);
    };
    const toggle = () => {
        if (open) {
            close();
            return;
        }
        reset();
        const at = place();
        if (at) {
            setAnchor(at);
        }
    };
    useFitPopup(panel, open, () => {
        const at = place();
        if (at) {
            setAnchor(at);
        }
    });

    useEffect(() => {
        if (!open) {
            return;
        }
        // Re-read each time: a run since the last opening changes what they're on.
        api.getCatchUpShows(userId)
            .then((r) => setShows(r.shows))
            .catch(() => setShows((s) => s || []));
        api.getCatchUpStatus(userId)
            .then((r) => setJob(r.job))
            .catch(() => undefined);
        const onKey = (e: KeyboardEvent) => {
            if (e.key === "Escape") {
                close();
            }
        };
        const onMove = () => {
            const at = place();
            if (at) {
                setAnchor(at);
            }
        };
        window.addEventListener("keydown", onKey);
        window.addEventListener("resize", onMove);
        window.addEventListener("scroll", onMove, true);
        return () => {
            window.removeEventListener("keydown", onKey);
            window.removeEventListener("resize", onMove);
            window.removeEventListener("scroll", onMove, true);
        };
    }, [open]);

    // Title search (Cinemeta, the same search as Discover), after a pause in typing.
    useEffect(() => {
        const q = query.trim();
        if (q.length < 2) {
            setResults(null);
            return;
        }
        let live = true;
        const t = setTimeout(() => {
            api.discoverSearch("series", q).then((items) => {
                if (live) {
                    setResults(
                        items.slice(0, 8).map((i) => ({ id: i.id, name: i.name, poster: i.poster }))
                    );
                }
            });
        }, SEARCH_DELAY_MS);
        return () => {
            live = false;
            clearTimeout(t);
        };
    }, [query]);

    // Progress while a run (or its undo) is going.
    useEffect(() => {
        if (job?.state !== "running" && job?.state !== "undoing") {
            return;
        }
        const t = setInterval(() => {
            api.getCatchUpStatus(userId)
                .then((r) => {
                    setJob(r.job);
                    if (r.job && r.job.state !== "running" && r.job.state !== "undoing") {
                        if (r.job.state === "failed") {
                            toast.error(r.job.error || "Could not finish");
                        } else if (r.job.state === "undone") {
                            toast.success(`Undone - ${r.job.show} is back how it was for ${name}`);
                        } else {
                            toast.success(`${name} is caught up on ${r.job.show} to ${r.job.upTo}`);
                        }
                    }
                })
                .catch(() => undefined);
        }, 1500);
        return () => clearInterval(t);
    }, [job?.state, userId, name]);

    // Done, or the countdown reaching 0: the card goes, here and on the
    // server, so it doesn't come back at the next opening.
    const dismissJob = () => {
        setJob(null);
        setSecondsLeft(null);
        api.dismissCatchUp(userId).catch(() => undefined);
    };

    // Count down while a finished run's card is on screen; a fresh count for
    // each finish (a run, then its undo).
    const finished = !!job && (job.state === "done" || job.state === "undone");
    useEffect(() => {
        setSecondsLeft(open && finished ? CLEAR_AFTER_SECONDS : null);
    }, [open, finished, job?.state, job?.startedAt]);
    useEffect(() => {
        if (secondsLeft == null || holding || busy) {
            return;
        }
        // "0s" shows for a beat before the card goes, so the count visibly ends.
        const t =
            secondsLeft <= 0
                ? setTimeout(dismissJob, 400)
                : setTimeout(() => setSecondsLeft((n) => (n == null ? n : n - 1)), 1000);
        return () => clearTimeout(t);
    }, [secondsLeft, holding, busy]);

    const pick = async (show: Picked) => {
        setPicked(show);
        setList(null);
        setListError(null);
        setTarget(null);
        setSeason(null);
        try {
            const l = await api.getCatchUpEpisodes(userId, show.id);
            setList(l);
            // Open on the season of the first episode they haven't watched.
            const now = Date.now();
            const next = l.episodes.find((e) => !e.watched && isAired(e, now)) || l.episodes.at(-1);
            setSeason(next?.season ?? null);
        } catch (e) {
            setListError((e as Error)?.message || "Could not find that show’s episodes");
        }
    };

    const now = Date.now();
    const seasons = useMemo(
        () => [...new Set((list?.episodes || []).map((e) => e.season))],
        [list]
    );
    const inSeason = useMemo(
        () => (list?.episodes || []).filter((e) => e.season === season),
        [list, season]
    );
    const watchedCount = useMemo(
        () => (list?.episodes || []).filter((e) => e.watched).length,
        [list]
    );
    const seasonDone = (s: number) =>
        (list?.episodes || [])
            .filter((e) => e.season === s && isAired(e, now))
            .every((e) => e.watched);
    const toMark = useMemo(
        () =>
            list && target
                ? list.episodes
                      .filter(upTo(target.season, target.episode))
                      .filter((e) => !e.watched && isAired(e, Date.now()))
                : [],
        [list, target]
    );
    const targetEpisode = target
        ? list?.episodes.find((e) => e.season === target.season && e.episode === target.episode)
        : null;

    const startRun = async () => {
        if (!(list && target)) {
            return;
        }
        setBusy(true);
        try {
            setJob(await api.startCatchUp(userId, list.showId, target.season, target.episode));
            reset();
        } catch (e) {
            toast.error((e as Error)?.message || "Could not mark them caught up");
        } finally {
            setBusy(false);
        }
    };

    const undoRun = async () => {
        setBusy(true);
        try {
            const r = await api.undoCatchUp(userId);
            setJob(r.job);
        } catch (e) {
            toast.error((e as Error)?.message || "Could not undo that");
        } finally {
            setBusy(false);
        }
    };

    const unmarkTarget = async () => {
        if (!(list && targetEpisode)) {
            return;
        }
        const { season: s, episode: ep } = targetEpisode;
        setBusy(true);
        try {
            const r = await api.unmarkEpisode(userId, list.showId, s, ep);
            setList({
                ...list,
                episodes: list.episodes.map((e) =>
                    e.season === s && e.episode === ep ? { ...e, watched: false } : e
                ),
            });
            toast.success(
                `S${s}E${ep} is no longer watched${r.server === "done" ? " here or on their server" : ""}`
            );
        } catch (e) {
            toast.error((e as Error)?.message || "Could not mark it not watched");
        } finally {
            setBusy(false);
        }
    };

    const working = job?.state === "running" || job?.state === "undoing";
    const jobDone = job ? job.recorded + job.alreadyWatched : 0;

    const episodeStyle = (e: Episode) => {
        const isTarget = target && e.season === target.season && e.episode === target.episode;
        const willMark =
            target && !e.watched && isAired(e, now) && upTo(target.season, target.episode)(e);
        if (isTarget) {
            return e.watched
                ? "bg-success/25 border-success text-success ring-2 ring-success/40"
                : "bg-primary border-primary text-white font-semibold";
        }
        if (willMark) {
            return "bg-primary/20 border-primary/40 text-default";
        }
        if (e.watched) {
            return "bg-success/15 border-transparent text-success hover:border-success/50";
        }
        return "border-default text-muted hover:bg-surface-hover hover:text-default";
    };

    const jobLabel = job
        ? job.state === "running"
            ? "Marking…"
            : job.state === "undoing"
              ? "Undoing…"
              : job.state === "undone"
                ? "Undone"
                : job.state === "failed"
                  ? "Stopped"
                  : "Marked"
        : "";

    return (
        // On a Users card the card itself opens the person on a click; nothing
        // done here - in the pill or its popup - reaches it (React passes a
        // portal's events up through the component that rendered it).
        <span
            className="inline-flex min-w-0 max-w-full"
            onClick={(e) => e.stopPropagation()}
            onContextMenu={(e) => e.stopPropagation()}
            onDoubleClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => e.stopPropagation()}
            onMouseDown={(e) => e.stopPropagation()}
            onPointerDown={(e) => e.stopPropagation()}
        >
            <ActionPill
                icon={CheckCircleIcon}
                onClick={toggle}
                open={open}
                ref={button}
                size={size}
                tone={working ? "on" : "neutral"}
            >
                {job?.state === "running"
                    ? "Marking…"
                    : job?.state === "undoing"
                      ? "Undoing…"
                      : size === "sm"
                        ? "Caught up"
                        : "Caught up to…"}
            </ActionPill>
            {open &&
                anchor &&
                typeof document !== "undefined" &&
                createPortal(
                    <>
                        <div className="fixed inset-0 z-[9998]" onClick={close} />
                        <div
                            aria-label={`Mark ${name} caught up`}
                            className="fixed z-[9999] space-y-3 rounded-2xl border border-default p-4 shadow-2xl"
                            ref={panel}
                            role="dialog"
                            style={{ ...popupStyle(anchor), background: "var(--color-surface)" }}
                        >
                            {/* The last or current run, with Undo while it can be taken back. */}
                            {job && !picked && (
                                <div
                                    className="space-y-1.5 rounded-xl px-3 py-2.5"
                                    onMouseEnter={() => setHolding(true)}
                                    onMouseLeave={() => setHolding(false)}
                                    style={{ background: "var(--color-surface-hover)" }}
                                >
                                    <div className="flex items-center justify-between gap-2 text-xs">
                                        <span className="truncate font-medium text-default">
                                            {job.show} · up to {job.upTo}
                                        </span>
                                        <span
                                            className={`shrink-0 ${job.state === "failed" ? "text-error" : job.state === "done" ? "text-success" : "text-muted"}`}
                                        >
                                            {jobLabel}
                                        </span>
                                    </div>
                                    {job.state !== "undone" && (
                                        <div
                                            className="h-1.5 overflow-hidden rounded-full"
                                            style={{ background: "var(--color-bg-subtle)" }}
                                        >
                                            <div
                                                className={`h-full rounded-full transition-all ${job.state === "failed" ? "bg-error" : "bg-primary"}`}
                                                style={{
                                                    width: `${job.total ? Math.max((jobDone / job.total) * 100, 2) : 100}%`,
                                                }}
                                            />
                                        </div>
                                    )}
                                    <div className="flex items-end justify-between gap-2">
                                        <p className="text-[11px] text-subtle">
                                            {job.state === "undone" ? (
                                                "What it marked is back to not watched."
                                            ) : (
                                                <>
                                                    {jobDone} of {job.total} in History
                                                    {job.alreadyWatched
                                                        ? ` (${job.alreadyWatched} already there)`
                                                        : ""}
                                                    {job.server && (
                                                        <>
                                                            {" "}
                                                            · their server:{" "}
                                                            {job.server.state === "not-there"
                                                                ? "show isn’t on it"
                                                                : job.server.state === "failed"
                                                                  ? job.server.error || "failed"
                                                                  : job.server.how ===
                                                                      "played-up-to"
                                                                    ? `${job.server.marked} marked`
                                                                    : job.server.total == null
                                                                      ? "waiting…"
                                                                      : `${job.server.marked} of ${job.server.total}`}
                                                        </>
                                                    )}
                                                </>
                                            )}
                                        </p>
                                        {!working && (
                                            <div className="flex shrink-0 items-center gap-1.5">
                                                {job.canUndo && (
                                                    <button
                                                        className="inline-flex items-center gap-1 rounded-full border border-default px-2.5 py-1 text-[11px] text-default hover:bg-surface disabled:opacity-50"
                                                        disabled={busy}
                                                        onClick={undoRun}
                                                        type="button"
                                                    >
                                                        <ArrowUturnLeftIcon className="h-3 w-3" />
                                                        Undo
                                                    </button>
                                                )}
                                                {/* Clears the card now; on its own it goes when the
                          count inside reaches 0. */}
                                                <button
                                                    aria-label={
                                                        secondsLeft === null
                                                            ? "Done"
                                                            : `Done - clears in ${secondsLeft} seconds`
                                                    }
                                                    className="inline-flex items-center gap-1 rounded-full border border-success/40 bg-success/10 py-1 pr-2.5 pl-2 font-medium text-[11px] text-success transition-colors hover:bg-success/20 disabled:opacity-50"
                                                    disabled={busy}
                                                    onClick={dismissJob}
                                                    type="button"
                                                >
                                                    <CheckIcon className="h-3 w-3" />
                                                    Done
                                                    {secondsLeft != null && (
                                                        <span className="ml-0.5 min-w-[1.25rem] text-right font-normal text-subtle tabular-nums">
                                                            {secondsLeft}s
                                                        </span>
                                                    )}
                                                </button>
                                            </div>
                                        )}
                                    </div>
                                    {job.error && (
                                        <p className="text-[11px] text-error">{job.error}</p>
                                    )}
                                </div>
                            )}

                            {!(working || picked) && (
                                <>
                                    <div>
                                        <p className="font-semibold text-default text-sm">
                                            Caught up to…
                                        </p>
                                        <p className="mt-0.5 text-muted text-xs">
                                            Pick a show, then the last episode {name} has seen.
                                        </p>
                                    </div>
                                    <div className="relative">
                                        <MagnifyingGlassIcon className="pointer-events-none absolute top-1/2 left-2.5 h-4 w-4 -translate-y-1/2 text-subtle" />
                                        <input
                                            aria-label="Search for a show"
                                            className="w-full rounded-xl border border-default bg-surface-hover py-2 pr-2.5 pl-8 text-default text-xs"
                                            onChange={(e) => setQuery(e.target.value)}
                                            placeholder="Search for a show"
                                            value={query}
                                        />
                                    </div>

                                    {query.trim().length >= 2 ? (
                                        <div className="-mx-1 max-h-[300px] space-y-1 overflow-y-auto px-1">
                                            {results === null ? (
                                                [0, 1, 2].map((i) => (
                                                    <div
                                                        className="h-14 animate-pulse rounded-xl bg-surface-hover"
                                                        key={i}
                                                    />
                                                ))
                                            ) : results.length === 0 ? (
                                                <p className="py-3 text-center text-muted text-xs">
                                                    No shows match that.
                                                </p>
                                            ) : (
                                                results.map((r) => (
                                                    <button
                                                        className="flex w-full items-center gap-3 rounded-xl p-1.5 text-left transition-colors hover:bg-surface-hover"
                                                        key={r.id}
                                                        onClick={() => pick(r)}
                                                        type="button"
                                                    >
                                                        <Poster
                                                            className="h-[54px] w-9 shrink-0 rounded-md"
                                                            item={r}
                                                        />
                                                        <span className="line-clamp-2 text-default text-xs">
                                                            {r.name}
                                                        </span>
                                                    </button>
                                                ))
                                            )}
                                        </div>
                                    ) : (
                                        <div>
                                            <p className="mb-1.5 font-medium text-muted text-xs">
                                                {name} is watching
                                            </p>
                                            {shows === null ? (
                                                <div className="grid grid-cols-4 gap-2">
                                                    {[0, 1, 2, 3].map((i) => (
                                                        <div
                                                            className="aspect-[2/3] animate-pulse rounded-lg bg-surface-hover"
                                                            key={i}
                                                        />
                                                    ))}
                                                </div>
                                            ) : shows.length === 0 ? (
                                                <p className="py-2 text-muted text-xs">
                                                    No shows in their History yet - search for one
                                                    above.
                                                </p>
                                            ) : (
                                                <div className="-mx-1 grid max-h-[300px] grid-cols-4 gap-2 overflow-y-auto px-1 pb-1">
                                                    {shows.map((s) => (
                                                        <button
                                                            className="group text-left"
                                                            key={s.id}
                                                            onClick={() => pick(s)}
                                                            title={s.name || s.id}
                                                            type="button"
                                                        >
                                                            <Poster
                                                                className="aspect-[2/3] rounded-lg transition-colors group-hover:border-primary"
                                                                item={s}
                                                            />
                                                            <p className="mt-1 line-clamp-1 text-[11px] text-default leading-tight">
                                                                {s.name || s.id}
                                                            </p>
                                                            {s.last && (
                                                                <p className="text-[10px] text-subtle">
                                                                    Last S{s.last.season}E
                                                                    {s.last.episode}
                                                                </p>
                                                            )}
                                                        </button>
                                                    ))}
                                                </div>
                                            )}
                                        </div>
                                    )}
                                </>
                            )}

                            {!working && picked && (
                                <>
                                    <div className="flex items-center gap-2.5">
                                        <button
                                            aria-label="Back to shows"
                                            className="-ml-1 rounded-lg p-1 text-subtle hover:bg-surface-hover hover:text-default"
                                            onClick={reset}
                                            type="button"
                                        >
                                            <ChevronLeftIcon className="h-4 w-4" />
                                        </button>
                                        <Poster
                                            className="h-12 w-8 shrink-0 rounded-md"
                                            item={{
                                                id: picked.id,
                                                poster: list?.poster || picked.poster,
                                            }}
                                        />
                                        <div className="min-w-0">
                                            <p className="truncate font-semibold text-default text-sm">
                                                {list?.name || picked.name || picked.id}
                                            </p>
                                            {list && (
                                                <p className="text-[11px] text-subtle">
                                                    {watchedCount} of {list.episodes.length}{" "}
                                                    episodes watched
                                                </p>
                                            )}
                                        </div>
                                    </div>

                                    {listError ? (
                                        <p
                                            className="rounded-xl px-3 py-3 text-muted text-xs"
                                            style={{ background: "var(--color-surface-hover)" }}
                                        >
                                            {listError}
                                        </p>
                                    ) : list ? (
                                        <>
                                            {/* Wraps onto more lines rather than scrolling sideways:
                        a long show's later seasons were cut off past the
                        popup's edge with no way to reach them. */}
                                            {seasons.length > 1 && (
                                                <div>
                                                    <p className="mb-1.5 font-medium text-muted text-xs">
                                                        Season
                                                    </p>
                                                    <div className="flex flex-wrap gap-1.5">
                                                        {seasons.map((s) => (
                                                            <button
                                                                aria-label={`Season ${s}${seasonDone(s) ? ", all watched" : ""}`}
                                                                aria-pressed={season === s}
                                                                className={`relative h-7 min-w-[34px] rounded-full border px-2 text-xs tabular-nums transition-colors ${season === s ? "border-primary bg-primary/15 font-medium text-default" : "border-default text-subtle hover:bg-surface-hover hover:text-default"}`}
                                                                key={s}
                                                                onClick={() => setSeason(s)}
                                                                type="button"
                                                            >
                                                                {s}
                                                                {seasonDone(s) && (
                                                                    <CheckIcon className="absolute -top-1 -right-1 h-3.5 w-3.5 rounded-full bg-success p-0.5 text-black" />
                                                                )}
                                                            </button>
                                                        ))}
                                                    </div>
                                                </div>
                                            )}

                                            <div className="grid max-h-[200px] grid-cols-8 gap-1 overflow-y-auto">
                                                {inSeason.map((e) => {
                                                    const aired = isAired(e, now);
                                                    return (
                                                        <button
                                                            aria-label={`Episode ${e.episode}${e.kind ? `, ${e.kind}` : ""}${e.watched ? ", watched" : ""}${aired ? "" : ", not out yet"}`}
                                                            className={`relative aspect-square rounded-lg border text-xs tabular-nums transition-colors disabled:cursor-not-allowed disabled:opacity-30 ${episodeStyle(e)}`}
                                                            disabled={!aired}
                                                            key={e.episode}
                                                            onClick={() =>
                                                                setTarget({
                                                                    episode: e.episode,
                                                                    season: e.season,
                                                                })
                                                            }
                                                            title={`E${e.episode}${e.title ? ` · ${e.title}` : ""}${e.kind === "filler" ? " - filler" : e.kind === "recap" ? " - recap" : ""}${aired ? (e.watched ? " - watched" : "") : " - not out yet"}`}
                                                            type="button"
                                                        >
                                                            {e.watched ? (
                                                                <CheckIcon className="mx-auto h-3.5 w-3.5" />
                                                            ) : (
                                                                e.episode
                                                            )}
                                                            {/* Filler and recap episodes, where the server says so. */}
                                                            {e.kind && (
                                                                <span
                                                                    aria-hidden
                                                                    className="absolute bottom-0.5 left-1/2 -translate-x-1/2 font-semibold text-[8px] text-warning uppercase leading-none"
                                                                >
                                                                    {e.kind === "filler"
                                                                        ? "F"
                                                                        : "R"}
                                                                </span>
                                                            )}
                                                        </button>
                                                    );
                                                })}
                                            </div>

                                            <p className="min-h-[16px] text-[11px] text-subtle">
                                                {targetEpisode ? (
                                                    <>
                                                        S{targetEpisode.season}E
                                                        {targetEpisode.episode}
                                                        {targetEpisode.title ? (
                                                            <span className="text-default">
                                                                {" "}
                                                                · {targetEpisode.title}
                                                            </span>
                                                        ) : null}
                                                    </>
                                                ) : (
                                                    "Tap the last episode they’ve seen. Tap a ticked one to un-tick it."
                                                )}
                                            </p>

                                            {toMark.length > 0 && (
                                                <button
                                                    className="w-full rounded-xl bg-primary px-3 py-2 font-medium text-white text-xs transition-opacity disabled:opacity-40"
                                                    disabled={busy}
                                                    onClick={startRun}
                                                    type="button"
                                                >
                                                    Mark {toMark.length} episode
                                                    {toMark.length === 1 ? "" : "s"} watched, up to
                                                    here
                                                </button>
                                            )}
                                            {targetEpisode?.watched && (
                                                <button
                                                    className="w-full rounded-xl border border-default px-3 py-2 font-medium text-default text-xs transition-colors hover:bg-surface-hover disabled:opacity-40"
                                                    disabled={busy}
                                                    onClick={unmarkTarget}
                                                    type="button"
                                                >
                                                    Mark S{targetEpisode.season}E
                                                    {targetEpisode.episode} not watched
                                                </button>
                                            )}
                                            {!target && (
                                                <div className="w-full rounded-xl border border-default border-dashed px-3 py-2 text-center text-subtle text-xs">
                                                    Pick an episode
                                                </div>
                                            )}
                                            <p className="-mt-1 text-[11px] text-subtle">
                                                Added to their History
                                                {hasServer ? " and their server" : ""}. Not counted
                                                as watch time. A run can be undone.
                                            </p>
                                        </>
                                    ) : (
                                        <div className="space-y-2">
                                            <div className="h-7 animate-pulse rounded-lg bg-surface-hover" />
                                            <div className="h-24 animate-pulse rounded-xl bg-surface-hover" />
                                        </div>
                                    )}
                                </>
                            )}
                        </div>
                    </>,
                    document.body
                )}
        </span>
    );
}
