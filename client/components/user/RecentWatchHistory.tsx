"use client";

import { ClockIcon, FilmIcon, TvIcon } from "@heroicons/react/24/outline";
import { useState } from "react";
import { useUserAuthHeaders } from "@/lib/hooks/useUserAuth";
import type { RecentHistoryItem, UserActivityData } from "@/lib/user-api";
import { PersonalMediaDetailModal } from "./PersonalMediaDetailModal";

const unchanged = () => undefined;

/** A bounded Home preview. Native records reuse the already-loaded activity response. */
export function RecentWatchHistory({
    data,
    nativeLabel,
}: {
    data: UserActivityData;
    nativeLabel: string;
}) {
    const { userId, authKey } = useUserAuthHeaders();
    const [selected, setSelected] = useState<RecentHistoryItem | null>(null);
    const tracked = data.source === "trakt";
    const items: RecentHistoryItem[] = tracked
        ? data.recentHistory || []
        : data.sessions
              .filter(
                  (item) =>
                      !item.isActive && Number.isFinite(Date.parse(item.endTime || item.startTime))
              )
              .sort(
                  (a, b) =>
                      Date.parse(b.endTime || b.startTime) - Date.parse(a.endTime || a.startTime)
              )
              .slice(0, 5)
              .map((item) => ({
                  episode: item.episode,
                  id: item.itemId.startsWith("kitsu:")
                      ? item.itemId.split(":").slice(0, 2).join(":")
                      : item.itemId.split(":")[0],
                  key: item.id,
                  name: item.itemName,
                  poster: item.poster,
                  season: item.season,
                  type: item.itemType,
                  watchedAt: item.endTime || item.startTime,
              }));
    return (
        <section className="rounded-xl border border-default bg-surface p-5">
            <div className="mb-4 flex items-center justify-between gap-3">
                <h3 className="flex items-center gap-2 font-semibold text-default">
                    <ClockIcon aria-hidden="true" className="h-5 w-5 text-primary" />
                    Recent History
                </h3>
                <span className="text-subtle text-xs">{tracked ? "Trakt" : nativeLabel}</span>
            </div>
            {items.length ? (
                <ol className="space-y-2">
                    {items.map((item) => (
                        <li key={item.key}>
                            <button
                                className="flex w-full items-center gap-4 rounded-lg p-2 text-left transition-colors hover:bg-surface-hover focus-visible:outline-2 focus-visible:outline-primary"
                                onClick={() => setSelected(item)}
                                type="button"
                            >
                                <div className="flex h-14 w-10 shrink-0 items-center justify-center overflow-hidden rounded bg-surface-hover">
                                    {item.poster ? (
                                        <img
                                            alt=""
                                            className="h-full w-full object-cover"
                                            height={56}
                                            loading="lazy"
                                            src={item.poster}
                                            width={40}
                                        />
                                    ) : item.type === "movie" ? (
                                        <FilmIcon
                                            aria-hidden="true"
                                            className="h-5 w-5 text-subtle"
                                        />
                                    ) : (
                                        <TvIcon
                                            aria-hidden="true"
                                            className="h-5 w-5 text-subtle"
                                        />
                                    )}
                                </div>
                                <div className="min-w-0 flex-1">
                                    <p className="truncate font-medium text-default text-sm">
                                        {item.name}
                                    </p>
                                    <p className="mt-1 text-muted text-xs">
                                        {item.type === "series" && item.episode != null
                                            ? `${item.season == null ? "" : `S${String(item.season).padStart(2, "0")} · `}E${String(item.episode).padStart(2, "0")}`
                                            : item.type === "movie"
                                              ? "Movie"
                                              : "Series"}
                                    </p>
                                    <time
                                        className="mt-1 block text-subtle text-xs"
                                        dateTime={item.watchedAt}
                                    >
                                        {new Date(item.watchedAt).toLocaleString(undefined, {
                                            day: "numeric",
                                            hour: "2-digit",
                                            minute: "2-digit",
                                            month: "short",
                                        })}
                                    </time>
                                </div>
                            </button>
                        </li>
                    ))}
                </ol>
            ) : (
                <p className="py-8 text-muted text-sm">
                    {tracked && data.recentHistory == null
                        ? "Recent history is temporarily unavailable."
                        : "No recent watch history yet."}
                </p>
            )}
            {selected && userId && authKey && (
                <PersonalMediaDetailModal
                    authKey={authKey}
                    item={{
                        id: selected.id,
                        name: selected.name,
                        poster: selected.poster || null,
                        type: selected.type,
                    }}
                    onChange={unchanged}
                    onClose={() => setSelected(null)}
                    userId={userId}
                />
            )}
        </section>
    );
}
