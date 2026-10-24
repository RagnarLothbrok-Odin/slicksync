'use client';

import { createContext, useContext, useEffect, useState, useCallback, useRef, ReactNode } from 'react';
import { useUserAuthHeaders } from '@/lib/hooks/useUserAuth';
import { personalRequest, type PersonalPreferences } from '@/lib/user-api';
import { toast } from '@/components/ui/Toast';

const defaults: PersonalPreferences = { beginnerMode: false, hideSensitive: false, posterRatings: false, autoplayTrailer: false, trailerSound: false };
const Context = createContext<{ preferences: PersonalPreferences; ready: boolean; saving: boolean; error: string | null; reload: () => void; save: (patch: Partial<PersonalPreferences>) => Promise<void> }>({ preferences: defaults, ready: false, saving: false, error: null, reload: () => {}, save: async () => {} });

export function PersonalPreferencesProvider({ children }: { children: ReactNode }) {
  const { userId, authKey, isReady } = useUserAuthHeaders();
  const identity = useRef({ userId, authKey });
  identity.current = { userId, authKey };
  const [preferences, setPreferences] = useState(defaults);
  const [ready, setReady] = useState(false);
  const [loadedUserId, setLoadedUserId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    let active = true;
    setReady(false); setSaving(false); setPreferences(defaults); setError(null);
    if (isReady && userId && authKey) personalRequest<PersonalPreferences>(userId, authKey, '/preferences')
      .then(value => { if (active) { setPreferences(value); setLoadedUserId(userId); setReady(true); } })
      .catch(() => { if (active) setError('Could not load your display preferences.'); });
    return () => { active = false; };
  }, [userId, authKey, isReady, revision]);
  const save = useCallback(async (patch: Partial<PersonalPreferences>) => {
    if (!ready || saving || !userId || !authKey) return;
    setSaving(true);
    try {
      const next = await personalRequest<PersonalPreferences>(userId, authKey, '/preferences', { method: 'PATCH', body: JSON.stringify({ preferences: { ...preferences, ...patch } }) });
      if (identity.current.userId === userId && identity.current.authKey === authKey) { setPreferences(next); toast.success('Saved'); }
    } catch { if (identity.current.userId === userId && identity.current.authKey === authKey) toast.error('Could not save your display preferences'); }
    finally { if (identity.current.userId === userId && identity.current.authKey === authKey) setSaving(false); }
  }, [ready, saving, userId, authKey, preferences]);
  // Keep sensitive fields covered until this person's preferences arrive,
  // including the first render after a reload or an identity switch.
  const resolved = ready && loadedUserId === userId;
  const visiblePreferences = resolved ? preferences : { ...defaults, hideSensitive: true };
  return <Context.Provider value={{ preferences: visiblePreferences, ready: resolved, saving, error, reload: () => setRevision(value => value + 1), save }}>{children}</Context.Provider>;
}
export const usePersonalPreferences = () => useContext(Context);
