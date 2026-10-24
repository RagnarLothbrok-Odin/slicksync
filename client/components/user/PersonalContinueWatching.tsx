'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { ContinueWatchingSection } from '@/components/ui/ContinueWatchingSection';
import { ContinueWatchingCard } from '@/components/ui/ContinueWatchingCard';
import { PersonalMediaDetailModal } from './PersonalMediaDetailModal';
import { useUserAuthHeaders } from '@/lib/hooks/useUserAuth';
import { useDragScroll } from '@/lib/hooks/useDragScroll';
import { personalRequest } from '@/lib/user-api';
import { toast } from '@/components/ui/Toast';
import type { ContinueWatchingItem } from '@/lib/api';

export function PersonalContinueWatching() {
  const { userId, authKey, isReady } = useUserAuthHeaders();
  const [items, setItems] = useState<ContinueWatchingItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [menu, setMenu] = useState<string | null>(null);
  const [selected, setSelected] = useState<ContinueWatchingItem | null>(null);
  const wasDraggedRef = useRef(false);
  const drag = useDragScroll();
  const unchanged = useCallback(() => {}, []);

  useEffect(() => {
    if (!isReady || !userId || !authKey) return;
    let active = true;
    setItems([]);
    setSelected(null);
    setMenu(null);
    setLoading(true);
    const load = async () => {
      try {
        const result = await personalRequest<{ items: ContinueWatchingItem[] }>(userId, authKey, '/continue-watching');
        if (active) { setItems(result.items); setError(false); }
      } catch { if (active) setError(true); }
      finally { if (active) setLoading(false); }
    };
    void load();
    const timer = window.setInterval(() => { if (!document.hidden) void load(); }, 30000);
    return () => { active = false; window.clearInterval(timer); };
  }, [userId, authKey, isReady]);

  const dismiss = async (item: ContinueWatchingItem) => {
    if (!userId || !authKey) return;
    try {
      await personalRequest(userId, authKey, '/continue-watching/dismiss', { method: 'POST', body: JSON.stringify({ showId: item.showId }) });
      setItems(current => current.filter(row => row.showId !== item.showId));
      toast.success('Removed from Continue Watching. Your watch history is kept.');
    } catch { toast.error('Could not remove this title. Please try again.'); }
  };


  // Match the household dashboard: only show the section when titles exist.
  if (loading || error || items.length === 0) return null;

  return (
    <ContinueWatchingSection>
      <div ref={drag.ref} {...drag.handlers} className="flex gap-3 overflow-x-auto pb-1 cursor-grab active:cursor-grabbing no-scrollbar paint-isolated">
          {items.map((item, index) => <ContinueWatchingCard key={`${item.userId}-${item.showId}`} item={item} priority={index < 6} cacheImages={false} removalMessage={null} wasDraggedRef={wasDraggedRef} onRemove={dismiss} onOpenDetails={setSelected} isMenuOpen={menu === `${item.userId}-${item.showId}`} onMenuOpenChange={(open, key) => setMenu(open ? key : null)} />)}
      </div>
      {selected && userId && authKey && <PersonalMediaDetailModal item={{ id: selected.showId, type: selected.contentType, name: selected.showName, poster: selected.poster, imdbRating: selected.imdbRating }} userId={userId} authKey={authKey} onClose={() => setSelected(null)} onChange={unchanged} />}
    </ContinueWatchingSection>
  );
}
