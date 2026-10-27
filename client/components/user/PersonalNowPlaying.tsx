"use client";

import { ArrowPathIcon, InformationCircleIcon, PlayIcon } from "@heroicons/react/24/outline";
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
        <article className="relative isolate overflow-hidden rounded-3xl border border-white/15 bg-slate-950 text-white">
            {artwork && (
                /* biome-ignore lint/a11y/noNoninteractiveElementInteractions: Failed artwork advances to the next available image. */
                <img
                    alt=""
                    className="pointer-events-none absolute inset-0 -z-20 h-full w-full object-cover object-[70%_center]"
                    height={900}
                    onError={() => setArtworkIndex((index) => index + 1)}
                    src={artwork}
                    width={1600}
                />
            )}
            <div className="pointer-events-none absolute inset-0 -z-10 bg-[linear-gradient(90deg,rgba(8,15,26,0.98)_0%,rgba(8,15,26,0.9)_30%,rgba(8,15,26,0.55)_58%,rgba(8,15,26,0.08)_100%)]" />
            <div className="pointer-events-none absolute inset-0 -z-10 bg-[linear-gradient(0deg,rgba(8,15,26,0.65),transparent_65%)]" />
            <div className="flex min-h-64 items-center p-6 sm:min-h-72 sm:p-8 lg:min-h-80 lg:px-10">
                <div className="w-full min-w-0 sm:max-w-[65%] lg:max-w-[58%]">
                    <p className="mb-3 flex items-center gap-2 font-medium text-sm text-white/75">
                        <span
                            aria-hidden="true"
                            className={`h-2 w-2 rounded-full ${presentation.playing ? "bg-success" : "bg-white/50"}`}
                        />
                        {presentation.status}
                    </p>
                    <h3 className="text-balance font-semibold text-2xl leading-tight tracking-tight sm:text-3xl lg:text-4xl">
                        {title}
                    </h3>
                    <p className="mt-2 text-sm text-white/65 sm:text-base">
                        {episode}
                        {item.item.episodeTitle && ` · ${item.item.episodeTitle}`}
                    </p>
                    {!tracker && <PlaybackFreshness playback={item.playback} />}
                    {progress !== null && (
                        <div className="mt-5 flex flex-wrap items-center gap-x-3 gap-y-2">
                            <div
                                aria-label="Playback progress"
                                aria-valuemax={100}
                                aria-valuemin={0}
                                aria-valuenow={Math.round(progress)}
                                className="h-1.5 min-w-24 flex-1 overflow-hidden rounded-full bg-white/15"
                                role="progressbar"
                            >
                                <div
                                    className="h-full rounded-full"
                                    style={{
                                        background: "var(--color-progress, var(--color-primary))",
                                        width: `${progress}%`,
                                    }}
                                />
                            </div>
                            <span className="text-white/65 text-xs tabular-nums">
                                {Math.round(progress)}%
                            </span>
                            {tracker && knownProgress && (
                                <span className="ml-3 text-white/65 text-xs tabular-nums">
                                    {Math.max(0, Math.ceil((duration - position) / 60_000))} min
                                    left
                                </span>
                            )}
                        </div>
                    )}
                    <div className="mt-5 flex flex-wrap gap-3">
                        <Button
                            aria-label={`View details for ${title}`}
                            className="playback-details"
                            leftIcon={
                                <InformationCircleIcon aria-hidden="true" className="h-5 w-5" />
                            }
                            onClick={onOpen}
                            variant="secondary"
                        >
                            Details
                        </Button>
                    </div>
                </div>
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
                }>(userId, authKey, "/now-playing");
                if (active) {
                    setState({
                        error: false,
                        items: result.items,
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
