'use client';

// Watch Sync from a person's own page (components/user/WatchSyncView.tsx);
// Tasks opens the same page at /tasks/watch-sync.

import { useParams } from 'next/navigation';
import { WatchSyncView } from '@/components/user/WatchSyncView';

export default function PersonWatchSyncPage() {
  const params = useParams();
  return <WatchSyncView userId={String(params?.id || '')} home="person" />;
}
