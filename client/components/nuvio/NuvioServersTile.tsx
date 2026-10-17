'use client';

// "Their servers in Nuvio": for someone with both a Nuvio sign-in and a
// Jellyfin, AIOStreams or AIOMetadata one, that server is kept in their Nuvio
// profile so every Nuvio app lists it without signing in on the device
// (server/utils/nuvioMediaServers.js). Renders nothing for anyone without
// both. Servers they added in Nuvio themselves are listed and left alone.

import { useEffect, useState } from 'react';
import { ServerStackIcon } from '@heroicons/react/24/outline';
import { Card, ToggleSwitch } from '@/components/ui';
import { toast } from '@/components/ui/Toast';
import { api, type NuvioServersState } from '@/lib/api';

export function NuvioServersTile({ userId }: { userId: string }) {
  const [state, setState] = useState<NuvioServersState | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api.getNuvioMediaServers(userId).then(setState).catch(() => setState(null));
  }, [userId]);

  if (!state?.available) return null;

  const toggle = async () => {
    setSaving(true);
    try {
      const next = await api.setNuvioMediaServers(userId, !state.enabled);
      setState(next);
      toast.success(next.enabled ? `${state.server?.kindLabel || 'Their server'} is in their Nuvio now` : 'Taken out of their Nuvio');
    } catch (e) {
      toast.error((e as Error)?.message || 'Could not change that');
    } finally {
      setSaving(false);
    }
  };

  const label = state.server?.kindLabel || 'Jellyfin';

  return (
    <Card padding="lg">
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-10 h-10 rounded-xl flex items-center justify-center bg-surface-hover shrink-0">
            <ServerStackIcon className="w-5 h-5 text-muted" />
          </div>
          <div className="min-w-0">
            <h3 className="text-base font-semibold text-default">Their servers in Nuvio</h3>
            <p className="text-sm text-muted">
              Their {label} shows up in Nuvio on every device - nobody signs in by hand. Nuvio gets a sign-in of its own, so signing it out there never signs SlickSync out.
            </p>
          </div>
        </div>
        <ToggleSwitch checked={state.enabled} onChange={toggle} disabled={saving} title="Their servers in Nuvio" />
      </div>
      {state.readError ? (
        <p className="mt-3 text-sm text-muted">{state.readError}</p>
      ) : state.servers.length > 0 && (
        <div className="mt-3.5">
          {state.servers.map((s, i) => (
            <div
              key={s.id}
              className={`flex items-center justify-between gap-2.5 py-2.5 text-sm ${i ? 'border-t' : ''}`}
              style={i ? { borderColor: 'var(--color-surface-border)' } : undefined}
            >
              <div className="min-w-0">
                <div className="text-default truncate">{s.name}</div>
                {s.userName && <div className="text-muted truncate">signed in as {s.userName}</div>}
              </div>
              <span
                className="shrink-0 text-[10px] px-2 py-0.5 rounded-full whitespace-nowrap"
                style={s.fromSlickSync
                  ? { background: 'var(--color-primary-muted)', color: 'var(--color-primary-hover)' }
                  : { background: 'var(--color-surface-hover)', color: 'var(--color-text-muted)' }}
              >
                {s.fromSlickSync ? 'from SlickSync' : 'theirs · kept'}
              </span>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}
