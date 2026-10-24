"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "@/components/ui/Toast";
import { api, type WatchlistItem } from "@/lib/api";

export interface WatchlistToggleItem {
    id: string;
    name: string;
    poster: string | null | undefined;
    type: "movie" | "series";
}

/**
 * Extracted from Discover's own inline watchlist state (originally local to
 * that page) so Catalogs can share the same fetch-once + optimistic-toggle
 * behavior instead of duplicating it.
 */
export function useWatchlistState() {
    const [watchlist, setWatchlist] = useState<WatchlistItem[]>([]);
    const [watchlistLoaded, setWatchlistLoaded] = useState(false);

    const refreshWatchlist = useCallback(async () => {
        try {
            const list = await api.getWatchlist();
            setWatchlist(list);
        } finally {
            setWatchlistLoaded(true);
        }
    }, []);
    useEffect(() => {
        refreshWatchlist();
    }, [refreshWatchlist]);

    const inWatchlistIds = useMemo(() => new Set(watchlist.map((w) => w.itemId)), [watchlist]);

    const toggleWatchlist = useCallback(
        async (item: WatchlistToggleItem, next: boolean) => {
            // Optimistic — flip the local set immediately so the badge reacts.
            setWatchlist((prev) =>
                next
                    ? [
                          ...prev,
                          {
                              addedAt: new Date().toISOString(),
                              id: item.id,
                              itemId: item.id,
                              itemType: item.type,
                              name: item.name,
                              poster: item.poster ?? null,
                          },
                      ]
                    : prev.filter((w) => w.itemId !== item.id)
            );
            try {
                if (next) {
                    await api.addToWatchlist({
                        itemId: item.id,
                        itemType: item.type,
                        name: item.name,
                        poster: item.poster,
                    });
                    toast.success(`Added "${item.name}" to Watchlist`);
                } else {
                    await api.removeFromWatchlist(item.id);
                    toast.success(`Removed "${item.name}" from Watchlist`);
                }
            } catch (e: any) {
                // Revert on failure.
                refreshWatchlist();
                toast.error(e?.message || "Failed to update watchlist");
            }
        },
        [refreshWatchlist]
    );

    // MediaDetailModal already makes its own watchlist API call internally and
    // just needs to sync this hook's local list afterward - unlike
    // toggleWatchlist, this doesn't call the API itself.
    const applyWatchlistChange = useCallback(
        (id: string, item: WatchlistToggleItem, next: boolean) => {
            setWatchlist((prev) =>
                next
                    ? prev.some((w) => w.itemId === id)
                        ? prev
                        : [
                              ...prev,
                              {
                                  addedAt: new Date().toISOString(),
                                  id,
                                  itemId: id,
                                  itemType: item.type,
                                  name: item.name,
                                  poster: item.poster ?? null,
                              },
                          ]
                    : prev.filter((w) => w.itemId !== id)
            );
        },
        []
    );

    return {
        applyWatchlistChange,
        inWatchlistIds,
        refreshWatchlist,
        toggleWatchlist,
        watchlist,
        watchlistLoaded,
    };
}
