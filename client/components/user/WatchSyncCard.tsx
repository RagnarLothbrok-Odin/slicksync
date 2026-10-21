'use client';

// The AIOSync card on Tasks: one link to the AIOSync page (the person is
// picked there, with For), and under it who is synced with whom - one line
// per person whose sign-ins or profiles are kept in step.

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowsRightLeftIcon, ChevronRightIcon } from '@heroicons/react/24/outline';
import { api } from '@/lib/api';

type Synced = { userId: string; name: string; places: string[] };

const joinNames = (names: string[]) => (names.length <= 1 ? names.join('') : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`);

export function WatchSyncCard() {
  const [synced, setSynced] = useState<Synced[]>([]);
  useEffect(() => {
    api.getWatchSyncOverview().then((r) => setSynced(r.synced || [])).catch(() => {});
  }, []);

  return (
    <Link
      href="/tasks/aiosync"
      className="mb-6 flex items-center gap-3 p-5 rounded-2xl border transition-colors hover:border-[color:var(--color-secondary)]"
      style={{ borderColor: 'color-mix(in srgb, var(--color-secondary) 40%, var(--color-surface-border))', background: 'color-mix(in srgb, var(--color-surface) 55%, transparent)' }}
    >
      <span className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0" style={{ background: 'color-mix(in srgb, var(--color-secondary) 18%, transparent)' }}>
        <ArrowsRightLeftIcon className="w-5 h-5" style={{ color: 'var(--color-secondary)' }} />
      </span>
      <span className="flex-1 min-w-0">
        <span className="block text-base font-semibold font-display text-default">AIOSync</span>
        <span className="block text-xs text-muted">Copy watched titles and resume points between any sign-ins and profiles, or keep them in step</span>
        {synced.length > 0 && (
          <span className="flex flex-wrap gap-1.5 mt-2">
            {synced.map((s) => (
              <span
                key={s.userId}
                className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold"
                style={{ color: 'var(--color-success)', background: 'color-mix(in srgb, var(--color-success) 15%, transparent)' }}
              >
                ⇄ {s.name}: {s.places[0]} synced with {joinNames(s.places.slice(1))}
              </span>
            ))}
          </span>
        )}
      </span>
      <ChevronRightIcon className="w-5 h-5 text-muted shrink-0" />
    </Link>
  );
}
