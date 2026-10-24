"use client";

import { ClockIcon, FilmIcon, TvIcon, UsersIcon, XMarkIcon } from "@heroicons/react/24/outline";
import { AnimatePresence, motion } from "framer-motion";
import { memo, useState } from "react";
import { UserAvatar } from "@/components/ui";

interface TopItem {
    itemId: string;
    name: string;
    poster?: string;
    totalWatchTimeHours: number;
    totalWatchTimeSeconds: number;
    type: "movie" | "series";
    userCount: number;
    users?: Array<{
        userId: string;
        username: string;
        email?: string;
        avatarUrl?: string | null;
        useGravatar?: boolean;
        colorIndex?: number;
        watchTimeSeconds: number;
        watchTimeHours: number;
        episodesWatched?: number;
    }>;
}

interface TopItemsSectionProps {
    movies: TopItem[];
    series: TopItem[];
}

export const TopItemsSection = memo(function TopItemsSectionLocal({
    movies,
    series,
}: TopItemsSectionProps) {
    const [selectedItem, setSelectedItem] = useState<TopItem | null>(null);

    const formatDuration = (seconds: number) => {
        const hours = Math.floor(seconds / 3600);
        const minutes = Math.floor((seconds % 3600) / 60);
        if (hours > 0) {
            return `${hours}h ${minutes}m`;
        }
        return `${minutes}m`;
    };

    const ItemCard = ({ item, rank }: { item: TopItem; rank: number }) => (
        <div
            className="flex cursor-pointer gap-4 rounded-xl bg-surface-hover p-4 transition-colors hover:bg-surface"
            onClick={() => setSelectedItem(item)}
        >
            <div className="relative h-24 w-16 flex-shrink-0 overflow-hidden rounded-lg bg-surface">
                {item.poster ? (
                    <img alt={item.name} className="h-full w-full object-cover" src={item.poster} />
                ) : (
                    <div className="flex h-full w-full items-center justify-center">
                        {item.type === "movie" ? (
                            <FilmIcon className="h-8 w-8 text-muted" />
                        ) : (
                            <TvIcon className="h-8 w-8 text-muted" />
                        )}
                    </div>
                )}
                <div className="absolute top-1 left-1 flex h-6 w-6 items-center justify-center rounded-full bg-primary font-bold text-white text-xs">
                    #{rank}
                </div>
            </div>

            <div className="min-w-0 flex-1">
                <h4 className="truncate font-medium text-default">{item.name}</h4>
                <div className="mt-2 space-y-1 text-muted text-sm">
                    <div className="flex items-center gap-2">
                        <ClockIcon className="h-4 w-4" />
                        <span>{formatDuration(item.totalWatchTimeSeconds)}</span>
                    </div>
                    <div className="flex items-center gap-2">
                        <UsersIcon className="h-4 w-4" />
                        <span>
                            {item.userCount} viewer{item.userCount === 1 ? "" : "s"}
                        </span>
                    </div>
                </div>
            </div>
        </div>
    );

    return (
        <div className="space-y-6">
            {/* Movies Section */}
            <div>
                <h4 className="mb-3 flex items-center gap-2 font-medium text-muted text-sm">
                    <FilmIcon className="h-4 w-4" />
                    Top Movies
                </h4>
                <div className="space-y-3">
                    {movies.slice(0, 3).map((movie, index) => (
                        <ItemCard item={movie} key={movie.itemId} rank={index + 1} />
                    ))}
                </div>
            </div>

            {/* Series Section */}
            <div>
                <h4 className="mb-3 flex items-center gap-2 font-medium text-muted text-sm">
                    <TvIcon className="h-4 w-4" />
                    Top Series
                </h4>
                <div className="space-y-3">
                    {series.slice(0, 3).map((show, index) => (
                        <ItemCard item={show} key={show.itemId} rank={index + 1} />
                    ))}
                </div>
            </div>

            {/* Modal for User Details */}
            <AnimatePresence>
                {selectedItem && (
                    <motion.div
                        animate={{ opacity: 1 }}
                        className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
                        exit={{ opacity: 0 }}
                        initial={{ opacity: 0 }}
                        onClick={() => setSelectedItem(null)}
                    >
                        <motion.div
                            animate={{ opacity: 1, scale: 1 }}
                            className="max-h-[80vh] w-full overflow-y-auto rounded-xl bg-surface p-6"
                            exit={{ opacity: 0, scale: 0.9 }}
                            initial={{ opacity: 0, scale: 0.9 }}
                            onClick={(e) => e.stopPropagation()}
                            style={{ maxWidth: "448px" }}
                        >
                            <div className="mb-4 flex items-center justify-between">
                                <h3 className="font-semibold text-lg">{selectedItem.name}</h3>
                                <button
                                    className="rounded-lg p-1 hover:bg-surface-hover"
                                    onClick={() => setSelectedItem(null)}
                                    type="button"
                                >
                                    <XMarkIcon className="h-5 w-5" />
                                </button>
                            </div>

                            <div className="space-y-3">
                                <p className="text-muted text-sm">
                                    Total: {formatDuration(selectedItem.totalWatchTimeSeconds)} •{" "}
                                    {selectedItem.userCount} viewers
                                </p>

                                {selectedItem.users && selectedItem.users.length > 0 && (
                                    <div className="space-y-2">
                                        <h4 className="font-medium text-sm">Viewers:</h4>
                                        {selectedItem.users.map((user) => (
                                            <div
                                                className="flex items-center justify-between rounded-lg bg-surface-hover p-2"
                                                key={user.userId}
                                            >
                                                <div className="flex items-center gap-2">
                                                    <UserAvatar
                                                        colorIndex={user.colorIndex}
                                                        email={user.email}
                                                        name={user.username}
                                                        size="sm"
                                                        src={user.avatarUrl ?? undefined}
                                                        useGravatar={user.useGravatar}
                                                        userId={user.userId}
                                                    />
                                                    <span className="text-sm">{user.username}</span>
                                                </div>
                                                <span className="text-muted text-sm">
                                                    {selectedItem.type === "series" &&
                                                    user.episodesWatched &&
                                                    user.episodesWatched > 0
                                                        ? `${user.episodesWatched} ${user.episodesWatched === 1 ? "episode" : "episodes"} • ${formatDuration(user.watchTimeSeconds)}`
                                                        : formatDuration(user.watchTimeSeconds)}
                                                </span>
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>
                        </motion.div>
                    </motion.div>
                )}
            </AnimatePresence>
        </div>
    );
});
