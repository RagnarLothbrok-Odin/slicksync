"use client";

import { FilmIcon, PlayIcon, TvIcon } from "@heroicons/react/24/outline";
import { motion } from "framer-motion";
import Link from "next/link";
import { Badge, UserAvatar } from "@/components/ui";
import { type PlaybackEvidence, playbackPresentation } from "@/lib/playback";

interface NowPlayingItem {
    device?: { name: string | null; client: string | null } | null;
    /** True once the proxy has stopped reconfirming the stream - the figure
     *  above is then final and must not be counted past. */
    elapsedFrozen?: boolean;
    // Proxy-sourced entries only - real elapsed time we can stand behind,
    // frozen once proxy traffic goes quiet instead of climbing forever off
    // raw wall-clock (see server/utils/proxyNowPlaying.js). Prefer this over
    // watchedAtTimestamp whenever present.
    elapsedSeconds?: number;
    item: {
        id: string;
        name: string;
        type: string;
        year?: number;
        poster?: string;
        season?: number;
        episode?: number;
    };
    // Where playback stood at the provider's last checkpoint, and the links
    // that open the title in each app - the same fields the Activity page's
    // card shows, so the two read the same.
    lastPosition?: number | null;
    nuvioAppUrl?: string | null;
    playback?: PlaybackEvidence | null;
    source?: string;
    stremioAppUrl?: string | null;
    totalDuration?: number | null;
    user: {
        id: string;
        username: string;
        email?: string;
        colorIndex?: number;
        avatarUrl?: string | null;
        useGravatar?: boolean;
    };
    watchedAt: string;
    watchedAtTimestamp?: number;
}

/** "Living room TV · Infuse" - the device and app a viewing is on, when known. */
function deviceLabel(device?: { name: string | null; client: string | null } | null) {
    return device ? [device.name, device.client].filter(Boolean).join(" · ") : "";
}

// How many people's cards the dashboard shows before pointing at Activity.
const MAX_SHOWN = 8;

interface NowPlayingSectionProps {
    fetchedAt?: number;
    items: NowPlayingItem[];
    /** Current time and when `items` was fetched - the elapsed counter shown
     *  per row is the server's figure plus the time since, so it keeps moving
     *  between polls without a fetch. Both optional; without them the
     *  server's figure is shown as-is. */
    now?: number;
}

export function NowPlayingSection({ items, now }: NowPlayingSectionProps) {
    if (items.length === 0) {
        return (
            <div className="py-8 text-center text-muted text-sm">No one is currently watching</div>
        );
    }

    // 3725 -> "1:02:05", 48 -> "0:48"
    const formatClock = (totalSeconds: number) => {
        const t = Math.max(0, Math.floor(totalSeconds));
        const h = Math.floor(t / 3600);
        const m = Math.floor((t % 3600) / 60);
        const sec = String(t % 60).padStart(2, "0");
        return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${sec}` : `${m}:${sec}`;
    };

    // Connection age describes the proxy session, not time spent watching.
    // Native checkpoints have no reliable live elapsed time.
    const watchingFor = (item: NowPlayingItem): string | null => {
        const startMs =
            typeof item.watchedAtTimestamp === "number" ? item.watchedAtTimestamp : null;
        if (item.source === "aiostreams-proxy" && typeof item.elapsedSeconds === "number") {
            const live =
                !item.elapsedFrozen && startMs && now
                    ? Math.max(0, Math.floor((now - startMs) / 1000))
                    : item.elapsedSeconds;
            return formatElapsed(Math.max(live, 0));
        }
        return null;
    };

    const formatElapsed = (seconds: number) => {
        const minutes = Math.floor(seconds / 60);
        if (minutes < 1) {
            return "<1m";
        }
        if (minutes < 60) {
            return `${minutes}m`;
        }
        const hours = Math.floor(minutes / 60);
        return `${hours}h ${minutes % 60}m`;
    };

    return (
        // One card per person watching. With several people they sit side by
        // side on a wide screen instead of pushing the rest of the page down, and
        // past a screenful the rest are a tap away on the Activity page rather
        // than silently missing.
        <div className={items.length > 1 ? "grid grid-cols-1 gap-3 lg:grid-cols-2" : "space-y-3"}>
            {items.slice(0, MAX_SHOWN).map((item, index) => (
                <motion.div
                    animate={{ opacity: 1, x: 0 }}
                    className="flex items-start gap-4 rounded-xl bg-surface-hover p-3"
                    initial={false}
                    key={`${item.user.id}-${item.item.id}-${item.item.season ?? ""}-${item.item.episode ?? ""}-${index}`}
                    transition={{ delay: index * 0.1 }}
                >
                    {/* User Avatar */}
                    <div className="flex-shrink-0">
                        <UserAvatar
                            colorIndex={item.user.colorIndex}
                            email={item.user.email}
                            name={item.user.username}
                            size="md"
                            src={
                                item.user.useGravatar
                                    ? undefined
                                    : (item.user.avatarUrl ?? undefined)
                            }
                            useGravatar={item.user.useGravatar}
                            userId={item.user.id}
                        />
                    </div>

                    {/* Item Poster */}
                    <div className="h-16 w-12 flex-shrink-0 overflow-hidden rounded-lg bg-surface">
                        {item.item.poster ? (
                            <img
                                alt={item.item.name}
                                className="h-full w-full object-cover"
                                height={64}
                                src={item.item.poster}
                                width={48}
                            />
                        ) : (
                            <div className="flex h-full w-full items-center justify-center">
                                {item.item.type === "movie" ? (
                                    <FilmIcon className="h-6 w-6 text-muted" />
                                ) : (
                                    <TvIcon className="h-6 w-6 text-muted" />
                                )}
                            </div>
                        )}
                    </div>

                    {/* Content */}
                    <div className="min-w-0 flex-1">
                        <p className="truncate font-medium text-default">{item.item.name}</p>
                        <div className="flex items-center gap-2 text-muted text-sm">
                            <span className="truncate">{item.user.username}</span>
                            {item.item.type === "series" &&
                                item.item.season &&
                                item.item.episode && (
                                    <>
                                        <span>•</span>
                                        <Badge size="sm" variant="default">
                                            S{item.item.season.toString().padStart(2, "0")}E
                                            {item.item.episode.toString().padStart(2, "0")}
                                        </Badge>
                                    </>
                                )}
                            {deviceLabel(item.device) && (
                                <span
                                    className="truncate"
                                    title={`Playing on ${deviceLabel(item.device)}`}
                                >
                                    • {deviceLabel(item.device)}
                                </span>
                            )}
                        </div>
                        <p className="mt-0.5 text-muted text-xs">
                            {playbackPresentation(item.playback).status}
                        </p>
                        {watchingFor(item) && (
                            <p className="mt-0.5 text-subtle text-xs">
                                Connection open for {watchingFor(item)}
                            </p>
                        )}
                        {typeof item.lastPosition === "number" &&
                            typeof item.totalDuration === "number" &&
                            item.totalDuration > 0 && (
                                <div className="mt-1.5 flex flex-wrap items-center gap-2">
                                    <span className="text-subtle text-xs">
                                        {playbackPresentation(item.playback).positionLabel}{" "}
                                        {formatClock(item.lastPosition / 1000)} of{" "}
                                        {formatClock(item.totalDuration / 1000)} (
                                        {Math.round((item.lastPosition / item.totalDuration) * 100)}
                                        %)
                                    </span>
                                    {item.stremioAppUrl && (
                                        <a
                                            className="flex items-center gap-1 rounded-md px-2 py-0.5 font-medium text-xs transition-colors"
                                            href={item.stremioAppUrl}
                                            style={{
                                                background: "rgba(167, 139, 250, 0.15)",
                                                border: "1px solid rgba(167, 139, 250, 0.25)",
                                                color: "rgb(196, 181, 253)",
                                            }}
                                        >
                                            <PlayIcon className="h-3 w-3" />
                                            Resume in Stremio
                                        </a>
                                    )}
                                    {item.nuvioAppUrl && (
                                        <a
                                            className="flex items-center gap-1 rounded-md px-2 py-0.5 font-medium text-xs transition-colors"
                                            href={item.nuvioAppUrl}
                                            style={{
                                                background:
                                                    "linear-gradient(115deg, rgba(56, 89, 158, 0.22) 0%, rgba(56, 89, 158, 0.22) 50%, rgba(255, 152, 0, 0.10) 50%, rgba(255, 152, 0, 0.10) 100%)",
                                                border: "1px solid rgba(255, 152, 0, 0.18)",
                                                color: "rgb(186, 208, 240)",
                                            }}
                                        >
                                            <PlayIcon className="h-3 w-3" />
                                            Resume in Nuvio
                                        </a>
                                    )}
                                </div>
                            )}
                    </div>

                    {/* Live indicator and Time Ago */}
                    <div className="flex-shrink-0 self-center">
                        <div
                            aria-hidden="true"
                            className={`h-2 w-2 rounded-full ${playbackPresentation(item.playback).playing ? "bg-success" : "bg-muted"}`}
                        />
                    </div>
                </motion.div>
            ))}
            {items.length > MAX_SHOWN && (
                <Link
                    className="py-1 text-center text-muted text-sm transition-colors hover:text-default lg:col-span-2"
                    href="/activity"
                >
                    +{items.length - MAX_SHOWN} more watching - see Activity
                </Link>
            )}
        </div>
    );
}
