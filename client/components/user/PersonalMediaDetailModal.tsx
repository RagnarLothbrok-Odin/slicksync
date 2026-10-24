'use client';

import { useMemo } from 'react';
import { MediaDetailModal, type MediaDetailClient } from '@/components/ui/MediaDetailModal';
import type { MediaDetails, WatchlistItem, RatingsBatchEntry } from '@/lib/api';
import type { PosterCardItem } from '@/components/ui/PosterCard';
import { personalRequest } from '@/lib/user-api';

type TitleState = { itemId: string; itemType: 'movie' | 'series'; name: string; poster: string | null; saved: boolean; reaction: 'like' | 'dislike' | null; createdAt?: string };

export function PersonalMediaDetailModal({ item, ratings, userId, authKey, onClose, onChange }: { item: PosterCardItem; ratings?: RatingsBatchEntry; userId: string; authKey: string; onClose: () => void; onChange: () => void }) {
  const client = useMemo<MediaDetailClient>(() => {
    const read = (id: string, type: string = item.type) => personalRequest<{ metadata: MediaDetails | null; state: TitleState | null }>(userId, authKey, `/discover/titles/${id}?type=${type}`);
    const write = async (id: string, patch: Partial<TitleState>, type: string = item.type) => {
      const { metadata, state } = await read(id, type);
      const next = { itemType: type, name: metadata?.title || item.name, poster: metadata?.poster || item.poster, saved: false, reaction: null, ...state, ...patch };
      const result = await personalRequest<TitleState>(userId, authKey, `/discover/titles/${id}`, { method: 'PUT', body: JSON.stringify(next) });
      onChange();
      return result;
    };
    const watchlistRow = (row: TitleState): WatchlistItem => ({ id: row.itemId, itemId: row.itemId, itemType: row.itemType, name: row.name, poster: row.poster, addedAt: row.createdAt || new Date().toISOString(), sortOrder: null });
    const unavailable = async (): Promise<never> => { throw new Error('This action is managed by your household administrator.'); };
    return {
      getMediaDetails: async (id, type) => {
        const { metadata } = await read(id, type).catch(() => ({ metadata: null }));
        return metadata ? { ...metadata, cast: metadata.cast.map(person => ({ ...person, tmdbId: null })) } : null;
      },
      getWatchlist: async () => (await personalRequest<{ items: TitleState[] }>(userId, authKey, '/discover/saved')).items.map(watchlistRow),
      addToWatchlist: async title => watchlistRow(await write(title.itemId, { name: title.name, poster: title.poster || null, saved: true }, title.itemType)),
      removeFromWatchlist: async id => { await write(id, { saved: false }); return { success: true }; },
      getReactions: async ids => {
        const reactions: Record<string, 'happy' | 'sad'> = {};
        await Promise.all(ids.map(async id => { const { state } = await read(id); if (state?.reaction) reactions[id] = state.reaction === 'like' ? 'happy' : 'sad'; }));
        return { reactions };
      },
      setReaction: async (id, type, reaction) => { await write(id, { reaction: reaction === 'happy' ? 'like' : 'dislike' }, type); return { reaction }; },
      clearReaction: async id => { await write(id, { reaction: null }); return { success: true }; },
      getSimilarItems: async () => ({ items: [], hasRealSignal: false }),
      getFollows: async () => [],
      lookupAnime: async () => ({ found: false }),
      getWatchedStatus: async () => ({}),
      getMediaEpisodes: async id => personalRequest(userId, authKey, `/discover/episodes/${id}`),
      followSubject: unavailable, muteFollow: unavailable, getPersonCredits: unavailable, resolveImdbId: unavailable,
      getAnimeWatchOrder: unavailable, markWatched: unavailable, getUsers: unavailable, getWatchTogether: unavailable,
      saveWatchTogether: unavailable, deleteWatchTogether: unavailable,
    };
  }, [userId, authKey, item, onChange]);
  return <MediaDetailModal isOpen onClose={onClose} itemId={item.id} itemType={item.type} fallbackTitle={item.name} fallbackPoster={item.poster} fallbackRating={item.imdbRating} fallbackReleaseInfo={item.releaseInfo} fallbackRottenTomatoes={ratings?.rottenTomatoes} fallbackMetacritic={ratings?.metacritic} client={client} householdActions={false} cacheImages={false} />;
}
