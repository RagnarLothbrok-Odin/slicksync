'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Card } from '@/components/ui/Card';
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
  const [retry, setRetry] = useState(0);
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
  }, [userId, authKey, isReady, retry]);

  const dismiss = async (item: ContinueWatchingItem) => {
    if (!userId || !authKey) return;
    try {
      await personalRequest(userId, authKey, '/continue-watching/dismiss', { method: 'POST', body: JSON.stringify({ showId: item.showId }) });
      setItems(current => current.filter(row => row.showId !== item.showId));
      toast.success('Removed from Continue Watching. Your watch history is kept.');
    } catch { toast.error('Could not remove this title. Please try again.'); }
  };

  return (
    <Card padding="lg">
      <h2 className="text-base font-semibold font-display text-default mb-4">Continue Watching</h2>
      {loading ? <p className="text-sm text-muted" role="status">Finding where you left off…</p>
        : error ? <p className="text-sm text-muted" role="alert">Could not load Continue Watching. <button className="text-primary underline" onClick={() => setRetry(value => value + 1)}>Try again</button></p>
        : items.length === 0 ? <p className="text-sm text-muted">Your unfinished movies and next episodes will appear here.</p>
        : <div ref={drag.ref} {...drag.handlers} className="flex gap-3 overflow-x-auto pb-1 cursor-grab active:cursor-grabbing no-scrollbar paint-isolated">
          {items.map((item, index) => <div className="shrink-0" key={`${item.userId}-${item.showId}`}>
            <ContinueWatchingCard item={item} priority={index < 4} cacheImages={false} removalMessage={null} wasDraggedRef={wasDraggedRef} onRemove={dismiss} onOpenDetails={setSelected} isMenuOpen={menu === `${item.userId}-${item.showId}`} onMenuOpenChange={(open, key) => setMenu(open ? key : null)} />
          </div>)}
        </div>}
      {selected && userId && authKey && <PersonalMediaDetailModal item={{ id: selected.showId, type: selected.contentType, name: selected.showName, poster: selected.poster, imdbRating: selected.imdbRating }} userId={userId} authKey={authKey} onClose={() => setSelected(null)} onChange={unchanged} />}
    </Card>
  );
}
