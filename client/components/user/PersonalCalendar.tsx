'use client';

import { useMemo } from 'react';
import { UpcomingEpisodesPanel } from '@/components/ui/UpcomingEpisodesPanel';
import { PersonalMediaDetailModal } from './PersonalMediaDetailModal';
import { useUserAuthHeaders } from '@/lib/hooks/useUserAuth';
import { personalRequest } from '@/lib/user-api';
import type { UpcomingEpisode } from '@/lib/api';

const unchanged = () => {};

export function PersonalCalendar() {
  const { userId, authKey, isReady } = useUserAuthHeaders();
  const client = useMemo(() => {
    const unavailable = async (): Promise<never> => { throw new Error('Calendar tracking is managed by your household administrator.'); };
    return {
      getUpcomingEpisodes: () => personalRequest<UpcomingEpisode[]>(userId || '', authKey || '', '/upcoming-episodes'),
      dismissUpcomingEpisode: unavailable, muteShow: unavailable, getMutedShows: unavailable, unmuteShow: unavailable,
    };
  }, [userId, authKey]);
  if (!isReady || !userId || !authKey) return null;
  return <UpcomingEpisodesPanel key={userId} client={client} householdActions={false} renderDetail={(item, onClose) => <PersonalMediaDetailModal item={{ id: item.showId, type: 'series', name: item.showName || 'Upcoming episode', poster: item.poster }} userId={userId} authKey={authKey} onClose={onClose} onChange={unchanged} />} />;
}
