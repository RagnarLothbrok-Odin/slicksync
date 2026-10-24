"use client";

import { BoltIcon, TvIcon } from "@heroicons/react/24/outline";
import { memo } from "react";

interface BingeWatchItem {
    daysActive: number;
    episodesPerDay: number;
    episodesPerWeek: number;
    estimatedEpisodes: number;
    itemId: string;
    name: string;
    poster?: string;
    totalWatchTimeHours: number;
}

interface BingeWatchesSectionProps {
    items: BingeWatchItem[];
}

export const BingeWatchesSection = memo(function BingeWatchesSection({
    items,
}: BingeWatchesSectionProps) {
    if (items.length === 0) {
        return (
            <div className="py-8 text-center text-muted text-sm">No binge watch data available</div>
        );
    }

    return (
        <div className="space-y-3">
            {items.slice(0, 5).map((item, _index) => (
                <div
                    className="flex items-center gap-4 rounded-xl bg-surface-hover p-4"
                    key={item.itemId}
                >
                    {/* Poster */}
                    <div className="relative h-20 w-14 flex-shrink-0 overflow-hidden rounded-lg bg-surface">
                        {item.poster ? (
                            <img
                                alt={item.name}
                                className="h-full w-full object-cover"
                                src={item.poster}
                            />
                        ) : (
                            <div className="flex h-full w-full items-center justify-center">
                                <TvIcon className="h-6 w-6 text-muted" />
                            </div>
                        )}
                    </div>

                    {/* Content */}
                    <div className="min-w-0 flex-1">
                        <h4 className="truncate font-medium text-default">{item.name}</h4>
                        <div className="mt-1 flex items-center gap-3 text-muted text-sm">
                            <span className="flex items-center gap-1">
                                <BoltIcon className="h-4 w-4" />
                                {item.episodesPerDay.toFixed(1)} ep/day
                            </span>
                            <span>•</span>
                            <span>{item.estimatedEpisodes} episodes</span>
                        </div>
                    </div>

                    {/* Stats */}
                    <div className="flex-shrink-0 text-right">
                        <p className="text-muted text-xs">
                            {item.daysActive} {item.daysActive === 1 ? "day" : "days"} active
                        </p>
                    </div>
                </div>
            ))}
        </div>
    );
});
