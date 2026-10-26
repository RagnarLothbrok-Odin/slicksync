"use client";

import { ArrowPathIcon, ChevronRightIcon, FilmIcon, PlayIcon } from "@heroicons/react/24/outline";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { PlaybackFreshness } from "@/components/ui/PlaybackFreshness";
import { useUserAuth, useUserAuthHeaders } from "@/lib/hooks/useUserAuth";
import { playbackPresentation } from "@/lib/playback";
import { type NowPlayingItem, personalRequest } from "@/lib/user-api";
import { PersonalMediaDetailModal } from "./PersonalMediaDetailModal";

function PlaybackCard({ item, onOpen }: { item: NowPlayingItem; onOpen: () => void }) {
    const [failedArtwork, setFailedArtwork] = useState(false);
    const title =
        item.item.name && item.item.name !== item.item.id ? item.item.name : "Your current title";
    const presentation = playbackPresentation(item.playback);
    const duration = item.totalDuration;
    const position = item.lastPosition;
    const knownProgress =
        typeof duration === "number" &&
        duration > 0 &&
        typeof position === "number" &&
        position >= 0;
    const progress = knownProgress ? Math.min(100, Math.max(0, (position / duration) * 100)) : null;
    const remaining = knownProgress ? Math.max(0, Math.ceil((duration - position) / 60_000)) : null;
    const episode =
        item.item.type === "series" && item.item.episode != null
            ? `${item.item.season == null ? "" : `Season ${item.item.season}, `}Episode ${item.item.episode}`
            : item.item.type === "movie"
              ? "Movie"
              : "Series";

    return (
        <button
            aria-label={`View details for ${title}`}
            className="group flex w-full min-w-0 items-center gap-4 rounded-2xl border border-default bg-surface p-4 text-left transition-colors hover:bg-surface-hover focus-visible:outline-2 focus-visible:outline-primary active:bg-surface-hover sm:gap-5 sm:p-5"
            onClick={onOpen}
            onErrorCapture={() => setFailedArtwork(true)}
            type="button"
        >
            <span className="relative flex h-28 w-[4.5rem] shrink-0 items-center justify-center overflow-hidden rounded-xl bg-bg text-subtle">
                {item.item.poster && !failedArtwork ? (
                    <img
                        alt=""
                        className="h-full w-full object-cover"
                        height={112}
                        src={item.item.poster}
                        width={72}
                    />
                ) : (
                    <FilmIcon aria-hidden="true" className="h-7 w-7" />
                )}
            </span>
            <span className="min-w-0 flex-1">
                <span
                    className={`mb-2 inline-flex items-center gap-1.5 text-xs ${presentation.playing ? "text-success" : "text-muted"}`}
                >
                    <span
                        aria-hidden="true"
                        className={`h-1.5 w-1.5 rounded-full ${presentation.playing ? "bg-success" : "bg-current"}`}
                    />
                    {presentation.status}
                </span>
                <span className="line-clamp-2 font-semibold text-default text-lg leading-snug tracking-tight sm:text-xl">
                    {title}
                </span>
                <span className="mt-1 block text-muted text-sm">{episode}</span>
                <PlaybackFreshness playback={item.playback} />
                {progress !== null && (
                    <span
                        aria-label={presentation.positionLabel}
                        aria-valuemax={100}
                        aria-valuemin={0}
                        aria-valuenow={Math.round(progress)}
                        className="mt-3 block"
                        role="progressbar"
                    >
                        <span className="block h-1 overflow-hidden rounded-full bg-primary/15">
                            <span
                                className="block h-full rounded-full bg-primary"
                                style={{ width: `${progress}%` }}
                            />
                        </span>
                        <span className="mt-1.5 block text-subtle text-xs">
                            {presentation.positionLabel} · {Math.round(progress)}%
                            {remaining !== null && ` · ${remaining} min remaining at update`}
                        </span>
                    </span>
                )}
            </span>
            <ChevronRightIcon
                aria-hidden="true"
                className="h-4 w-4 shrink-0 text-subtle transition-colors group-hover:text-default"
            />
        </button>
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
            <div className="mb-3 flex items-center justify-between gap-3">
                <h2
                    className="font-semibold text-default text-lg tracking-tight"
                    id="personal-now-playing-heading"
                >
                    Playback Activity
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
                <div className="grid gap-3 lg:grid-cols-2">
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
