'use client';

// The Watch Sync card on Tasks: a tile per person (with whether Keep in step
// is on for them) that opens Watch Sync for that person. The page itself is
// components/user/WatchSyncView.tsx.

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowsRightLeftIcon, ChevronRightIcon } from '@heroicons/react/24/outline';
import { Card, UserAvatar } from '@/components/ui';
import { api, User } from '@/lib/api';
import { providerTypeLabel } from '@/lib/providers';

export function WatchSyncCard() {
  const [people, setPeople] = useState<User[] | null>(null);
  const [inStep, setInStep] = useState<Set<string>>(new Set());

  useEffect(() => {
    api.getUsers().then(setPeople).catch(() => setPeople([]));
    api.getWatchSyncOverview().then((r) => setInStep(new Set(r.keepInStep))).catch(() => {});
  }, []);

  return (
    <Card padding="lg" className="mb-6">
      <div className="flex items-center gap-3 mb-4">
        <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ background: 'color-mix(in srgb, var(--color-secondary) 18%, transparent)' }}>
          <ArrowsRightLeftIcon className="w-5 h-5" style={{ color: 'var(--color-secondary)' }} />
        </div>
        <div>
          <h3 className="text-base font-semibold font-display text-default">Watch Sync</h3>
          <p className="text-xs text-muted">Copy watched titles and resume points between any sign-ins and profiles, or keep them in step</p>
        </div>
      </div>
      {people && people.length === 0 && <p className="text-sm text-muted">Add people first - Watch Sync works between their sign-ins.</p>}
      <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(230px, 1fr))' }}>
        {(people || []).map((p) => {
          const on = inStep.has(p.id);
          return (
            <Link
              key={p.id}
              href={`/tasks/watch-sync?person=${encodeURIComponent(p.id)}`}
              className="flex items-center gap-3 p-3 rounded-2xl border border-default bg-surface-hover hover:border-[color:var(--color-secondary)] transition-colors"
            >
              <UserAvatar userId={p.id} name={p.username} email={p.email} src={p.avatarUrl || undefined} useGravatar={p.useGravatar} colorIndex={p.colorIndex} size="md" />
              <span className="min-w-0 flex-1">
                <span className="block font-semibold text-sm text-default truncate">{p.username}</span>
                <span className="block text-xs text-muted truncate">{providerTypeLabel(p.providerType)}</span>
                <span
                  className="inline-flex items-center gap-1 mt-1 px-2 py-0.5 rounded-full text-[11px] font-semibold"
                  style={on
                    ? { color: 'var(--color-success)', background: 'color-mix(in srgb, var(--color-success) 15%, transparent)' }
                    : { color: 'var(--color-text-muted)', background: 'color-mix(in srgb, var(--color-text-muted) 15%, transparent)' }}
                >
                  {on ? '● Keep in step: on' : 'Keep in step: off'}
                </span>
              </span>
              <ChevronRightIcon className="w-4 h-4 text-muted shrink-0" />
            </Link>
          );
        })}
      </div>
    </Card>
  );
}
