"use client";

import { useMemo } from "react";
import { type MediaDetailClient, MediaDetailModal } from "@/components/ui/MediaDetailModal";
import type { PosterCardItem } from "@/components/ui/PosterCard";
import type { MediaDetails, RatingsBatchEntry, WatchlistItem } from "@/lib/api";
import { personalRequest } from "@/lib/user-api";

interface TitleState {
    itemId: string;
    itemType: "movie" | "series";
    name: string;
    poster: string | null;
    saved: boolean;
    reaction: "like" | "dislike" | null;
    createdAt?: string;
}

export function PersonalMediaDetailModal({
    item,
    ratings,
    userId,
    authKey,
    onClose,
    onChange,
}: {
    item: PosterCardItem;
    ratings?: RatingsBatchEntry;
    userId: string;
    authKey: string;
    onClose: () => void;
    onChange: () => void;
}) {
    const client = useMemo<MediaDetailClient>(() => {
        const read = (id: string, type: string = item.type) =>
            personalRequest<{ metadata: MediaDetails | null; state: TitleState | null }>(
                userId,
                authKey,
                `/discover/titles/${id}?type=${type}`
            );
        const write = async (id: string, patch: Partial<TitleState>, type: string = item.type) => {
            const { metadata, state } = await read(id, type);
            const next = {
                itemType: type,
                name: metadata?.title || item.name,
                poster: metadata?.poster || item.poster,
                reaction: null,
                saved: false,
                ...state,
                ...patch,
            };
            const result = await personalRequest<TitleState>(
                userId,
                authKey,
                `/discover/titles/${id}`,
                { body: JSON.stringify(next), method: "PUT" }
            );
            onChange();
            return result;
        };
        const watchlistRow = (row: TitleState): WatchlistItem => ({
            addedAt: row.createdAt || new Date().toISOString(),
            id: row.itemId,
            itemId: row.itemId,
            itemType: row.itemType,
            name: row.name,
            poster: row.poster,
            sortOrder: null,
        });
        const unavailable = async (): Promise<never> => {
            throw new Error("This action is managed by your household administrator.");
        };
        return {
            addToWatchlist: async (title) =>
                watchlistRow(
                    await write(
                        title.itemId,
                        { name: title.name, poster: title.poster || null, saved: true },
                        title.itemType
                    )
                ),
            clearReaction: async (id) => {
                await write(id, { reaction: null });
                return { success: true };
            },
            deleteWatchTogether: unavailable,
            followSubject: unavailable,
            getAnimeWatchOrder: unavailable,
            getFollows: async () => [],
            getMediaDetails: async (id, type) => {
                const { metadata } = await read(id, type).catch(() => ({ metadata: null }));
                return metadata
                    ? {
                          ...metadata,
                          cast: metadata.cast.map((person) => ({ ...person, tmdbId: null })),
                      }
                    : null;
            },
            getMediaEpisodes: async (id) =>
                personalRequest(userId, authKey, `/discover/episodes/${id}`),
            getPersonCredits: unavailable,
            getReactions: async (ids) => {
                const reactions: Record<string, "happy" | "sad"> = {};
                await Promise.all(
                    ids.map(async (id) => {
                        const { state } = await read(id);
                        if (state?.reaction) {
                            reactions[id] = state.reaction === "like" ? "happy" : "sad";
                        }
                    })
                );
                return { reactions };
            },
            getSimilarItems: async () => ({ hasRealSignal: false, items: [] }),
            getUsers: unavailable,
            getWatchedStatus: async () => ({}),
            getWatchlist: async () =>
                (
                    await personalRequest<{ items: TitleState[] }>(
                        userId,
                        authKey,
                        "/discover/saved"
                    )
                ).items.map(watchlistRow),
            getWatchTogether: unavailable,
            lookupAnime: async () => ({ found: false }),
            markWatched: unavailable,
            muteFollow: unavailable,
            removeFromWatchlist: async (id) => {
                await write(id, { saved: false });
                return { success: true };
            },
            resolveImdbId: unavailable,
            saveWatchTogether: unavailable,
            setReaction: async (id, type, reaction) => {
                await write(id, { reaction: reaction === "happy" ? "like" : "dislike" }, type);
                return { reaction };
            },
        };
    }, [userId, authKey, item, onChange]);
    return (
        <MediaDetailModal
            cacheImages={false}
            client={client}
            fallbackMetacritic={ratings?.metacritic}
            fallbackPoster={item.poster}
            fallbackRating={item.imdbRating}
            fallbackReleaseInfo={item.releaseInfo}
            fallbackRottenTomatoes={ratings?.rottenTomatoes}
            fallbackTitle={item.name}
            householdActions={false}
            isOpen
            itemId={item.id}
            itemType={item.type}
            onClose={onClose}
        />
    );
}
