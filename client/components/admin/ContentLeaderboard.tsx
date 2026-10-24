"use client";

import { FilmIcon, FireIcon, TvIcon } from "@heroicons/react/24/outline";
import { motion } from "framer-motion";
import { useState } from "react";
import type { TopContentItem } from "@/lib/api";

interface ContentLeaderboardProps {
    movies: TopContentItem[];
    series: TopContentItem[];
    trending: TopContentItem[];
}

export function ContentLeaderboard({ movies, series, trending }: ContentLeaderboardProps) {
    const [activeTab, setActiveTab] = useState<"movies" | "series" | "trending">("movies");

    const items = activeTab === "movies" ? movies : activeTab === "series" ? series : trending;

    return (
        <div className="space-y-4">
            <div className="flex w-fit items-center gap-2 rounded-xl border border-default bg-surface p-1">
                {[
                    { icon: FilmIcon, key: "movies", label: "Movies" },
                    { icon: TvIcon, key: "series", label: "Series" },
                    { icon: FireIcon, key: "trending", label: "Trending" },
                ].map(({ key, label, icon: Icon }) => (
                    <button
                        className={`rounded-lg px-4 py-2 font-medium transition-all ${
                            activeTab === key ? "bg-primary-muted text-primary" : "text-muted"
                        }`}
                        key={key}
                        onClick={() => setActiveTab(key as "movies" | "series" | "trending")}
                    >
                        <Icon className="mr-2 inline h-4 w-4" />
                        {label}
                    </button>
                ))}
            </div>

            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
                {items.map((item, index) => (
                    <motion.div
                        animate={{ opacity: 1, y: 0 }}
                        className="flex gap-4 overflow-hidden rounded-xl bg-surface-hover p-4"
                        initial={{ opacity: 0, y: 10 }}
                        key={item.id}
                        transition={{ delay: index * 0.1 }}
                    >
                        <div className="relative h-28 w-20 flex-shrink-0 overflow-hidden rounded-lg bg-surface">
                            {item.poster ? (
                                <img
                                    alt={item.name}
                                    className="h-full w-full object-cover"
                                    src={item.poster}
                                />
                            ) : (
                                <div className="flex h-full w-full items-center justify-center text-muted">
                                    <FilmIcon className="h-8 w-8" />
                                </div>
                            )}
                        </div>
                        <div className="min-w-0 flex-1">
                            <div className="flex items-start justify-between">
                                <h4 className="truncate pr-2 font-medium text-default">
                                    {item.name}
                                </h4>
                                <span className="font-bold text-lg text-primary">#{index + 1}</span>
                            </div>
                            <div className="mt-2 space-y-1 text-muted text-sm">
                                <p>{item.watchCount} viewers</p>
                                <p>{item.completionRate}% completion rate</p>
                                <p>{item.avgWatchTimeMinutes} min avg watch time</p>
                            </div>
                        </div>
                    </motion.div>
                ))}
            </div>
        </div>
    );
}
