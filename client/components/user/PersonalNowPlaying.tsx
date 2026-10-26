"use client";

import {
    ArrowPathIcon,
    FilmIcon,
    InformationCircleIcon,
    PlayIcon,
} from "@heroicons/react/24/outline";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/Button";
import { PlaybackFreshness } from "@/components/ui/PlaybackFreshness";
import { useUserAuth, useUserAuthHeaders } from "@/lib/hooks/useUserAuth";
import { livePlaybackPosition, playbackPresentation } from "@/lib/playback";
import { type NowPlayingItem, personalRequest } from "@/lib/user-api";
import { PersonalMediaDetailModal } from "./PersonalMediaDetailModal";

function PlaybackCard({ item, onOpen }: { item: NowPlayingItem; onOpen: () => void }) {
    const [artworkIndex, setArtworkIndex] = useState(0);
    const title =
        item.item.name && item.item.name !== item.item.id ? item.item.name : "Your current title";
    const presentation = playbackPresentation(item.playback);
    const duration = item.totalDuration;
    const tracker = item.playback?.evidence === "tracker";
    const [now, setNow] = useState(() => Date.now());
    useEffect(() => {
        if (!tracker) {
            return;
        }
        const timer = window.setInterval(() => setNow(Date.now()), 1000);
        return () => window.clearInterval(timer);
    }, [tracker]);
    const position = livePlaybackPosition(item.playback, item.lastPosition, duration, now);
    const knownProgress =
        typeof duration === "number" &&
        duration > 0 &&
        typeof position === "number" &&
        position >= 0;
    const progress = knownProgress ? Math.min(100, Math.max(0, (position / duration) * 100)) : null;
    const episode =
        item.item.type === "series" && item.item.episode != null
            ? `${item.item.season == null ? "" : `Season ${item.item.season}, `}Episode ${item.item.episode}`
            : item.item.type === "movie"
              ? "Movie"
              : "Series";

    const artwork = [item.item.thumbnail, item.item.background, item.item.poster].filter(
        (source): source is string => typeof source === "string" && source.length > 0
    )[artworkIndex];
    return (
        <article className="relative isolate overflow-hidden rounded-3xl border border-default bg-surface">
            {item.item.background && (
                <img
                    alt=""
                    aria-hidden="true"
                    className="pointer-events-none absolute inset-0 -z-10 h-full w-full scale-110 object-cover opacity-10 blur-2xl"
                    height={900}
                    src={item.item.background}
                    width={1600}
                />
            )}
            <div className="grid items-center gap-4 p-4 sm:gap-5 lg:grid-cols-[12rem_minmax(0,1fr)_auto]">
                <button
                    aria-label={`View details for ${title}`}
                    className="group flex aspect-video w-full max-w-xs items-center justify-center justify-self-center overflow-hidden rounded-2xl bg-bg text-subtle focus-visible:outline-2 focus-visible:outline-primary focus-visible:outline-offset-2 lg:max-w-none"
                    onClick={onOpen}
                    onErrorCapture={() => setArtworkIndex((index) => index + 1)}
                    type="button"
                >
                    {artwork ? (
                        <img
                            alt={title}
                            className="h-full w-full object-cover transition-opacity group-hover:opacity-85 group-active:opacity-70"
                            height={270}
                            src={artwork}
                            width={480}
                        />
                    ) : (
                        <FilmIcon aria-hidden="true" className="h-10 w-10" />
                    )}
                </button>
                <div className="min-w-0 py-1">
                    <p className="mb-2 font-semibold text-primary text-xs uppercase tracking-[0.14em]">
                        {presentation.playing ? "Now Playing" : presentation.status}
                    </p>
                    <h3 className="font-semibold text-default text-xl leading-tight tracking-tight sm:text-2xl">
                        {title}
                    </h3>
                    <p className="mt-1.5 text-muted text-sm">
                        {episode}
                        {item.item.episodeTitle && ` · ${item.item.episodeTitle}`}
                    </p>
                    {item.item.description && (
                        <p className="mt-2 line-clamp-2 text-muted text-sm leading-relaxed">
                            {item.item.description}
                        </p>
                    )}
                    {!tracker && <PlaybackFreshness playback={item.playback} />}
                    {progress !== null && (
                        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2">
                            <div
                                aria-label="Playback progress"
                                aria-valuemax={100}
                                aria-valuemin={0}
                                aria-valuenow={Math.round(progress)}
                                className="h-1.5 min-w-24 flex-1 overflow-hidden rounded-full"
                                role="progressbar"
                                style={{ background: "var(--color-surface-border)" }}
                            >
                                <div
                                    className="h-full rounded-full"
                                    style={{
                                        background: "var(--color-primary)",
                                        width: `${progress}%`,
                                    }}
                                />
                            </div>
                            <span className="text-subtle text-xs tabular-nums">
                                {knownProgress
                                    ? `${Math.floor(position / 60_000)} min / ${Math.round(duration / 60_000)} min`
                                    : ""}{" "}
                                · {Math.round(progress)}%
                            </span>
                        </div>
                    )}
                </div>
                <Button
                    aria-label={`View details for ${title}`}
                    className="playback-details"
                    leftIcon={<InformationCircleIcon aria-hidden="true" className="h-5 w-5" />}
                    onClick={onOpen}
                    variant="secondary"
                >
                    View Details
                </Button>
            </div>
        </article>
    );
}

/** A profile's live playback stays separate from its historical activity request. */
export function PersonalNowPlaying() {
    const { userId, authKey, isReady } = useUserAuthHeaders();
    const { provider } = useUserAuth();
    const [state, setState] = useState<{
        userId: string;
        items: NowPlayingItem[];
        trackingWarnings?: string[];
        error: boolean;
    } | null>(null);
    const [selected, setSelected] = useState<NowPlayingItem | null>(null);
    const [retry, setRetry] = useState(0);
    const unchanged = useCallback(() => undefined, []);
    const current = state?.userId === userId ? state : null;

    useEffect(() => {
        if (!(isReady && userId && authKey)) {
            return;
        }
        let active = true;
        let pending = false;
        setSelected(null);
        const load = async () => {
            if (pending || document.hidden) {
                return;
            }
            pending = true;
            try {
                const result = await personalRequest<{
                    items: NowPlayingItem[];
                    trackingWarnings?: string[];
                }>(userId, authKey, "/now-playing");
                if (active) {
                    setState({
                        error: false,
                        items: result.items,
                        trackingWarnings: result.trackingWarnings || [],
                        userId,
                    });
                }
            } catch {
                // Do not keep showing an old stream as live after a failed refresh.
                if (active) {
                    setState({ error: true, items: [], userId });
                }
            } finally {
                pending = false;
            }
        };
        void load();
        const timer = window.setInterval(() => void load(), 15_000);
        document.addEventListener("visibilitychange", load);
        return () => {
            active = false;
            window.clearInterval(timer);
            document.removeEventListener("visibilitychange", load);
        };
    }, [userId, authKey, isReady, retry]);

    if (!(isReady && userId && authKey)) {
        return null;
    }

    return (
        <section aria-labelledby="personal-now-playing-heading" className="mb-8">
            <div className="mb-3 flex items-center justify-end gap-3">
                <h2
                    className={
                        current?.items.length
                            ? "sr-only"
                            : "font-semibold text-default text-lg tracking-tight"
                    }
                    id="personal-now-playing-heading"
                >
                    {current?.items.length ? "Now Playing" : "Playback Activity"}
                </h2>
                {provider === "nuvio" ? (
                    <Link
                        className="text-primary text-xs underline-offset-4 hover:underline"
                        href="/user/settings?section=tracking"
                    >
                        Tracking services
                    </Link>
                ) : (
                    <span className="text-subtle text-xs">Auto-updating</span>
                )}
            </div>
            {!!current?.trackingWarnings?.length && (
                <p className="mb-3 text-sm text-warning" role="status">
                    Trakt could not refresh {current.trackingWarnings.join(", ")}. Available Nuvio
                    data is shown. Check Tracking services in settings.
                </p>
            )}
            {current?.items.length ? (
                <div className="grid gap-4">
                    {current.items.map((item) => (
                        <PlaybackCard
                            item={item}
                            key={`${item.item.id}-${item.videoId || ""}-${item.startTime}`}
                            onOpen={() => setSelected(item)}
                        />
                    ))}
                </div>
            ) : (
                <div className="flex items-center gap-3 rounded-2xl border border-default px-4 py-4 text-muted text-sm">
                    <PlayIcon aria-hidden="true" className="h-4 w-4 shrink-0 text-subtle" />
                    <p className="flex-1" role="status">
                        {current
                            ? current.error
                                ? "Live activity is unavailable."
                                : "No playback activity detected."
                            : "Checking your playback..."}
                    </p>
                    {current?.error && (
                        <button
                            aria-label="Retry live activity"
                            className="rounded-lg p-2 transition-colors hover:bg-surface-hover focus-visible:outline-2 focus-visible:outline-primary"
                            onClick={() => setRetry((value) => value + 1)}
                            type="button"
                        >
                            <ArrowPathIcon className="h-4 w-4" />
                        </button>
                    )}
                </div>
            )}
            {selected && current && (
                <PersonalMediaDetailModal
                    authKey={authKey}
                    item={{
                        id: selected.item.id,
                        name: selected.item.name,
                        poster: selected.item.poster || null,
                        type: selected.item.type === "movie" ? "movie" : "series",
                    }}
                    onChange={unchanged}
                    onClose={() => setSelected(null)}
                    userId={userId}
                />
            )}
        </section>
    );
}
