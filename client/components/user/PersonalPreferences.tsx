'use client';

import { createContext, useContext, useEffect, useState, useCallback, ReactNode } from 'react';
import { useUserAuthHeaders } from '@/lib/hooks/useUserAuth';
import { personalRequest, type PersonalPreferences } from '@/lib/user-api';
import { toast } from '@/components/ui/Toast';

const defaults: PersonalPreferences = { beginnerMode: false, hideSensitive: false, posterRatings: false, autoplayTrailer: false, trailerSound: false };
const Context = createContext<{ preferences: PersonalPreferences; ready: boolean; saving: boolean; error: string | null; reload: () => void; save: (patch: Partial<PersonalPreferences>) => Promise<void> }>({ preferences: defaults, ready: false, saving: false, error: null, reload: () => {}, save: async () => {} });

export function PersonalPreferencesProvider({ children }: { children: ReactNode }) {
  const { userId, authKey, isReady } = useUserAuthHeaders();
  const [preferences, setPreferences] = useState(defaults);
  const [ready, setReady] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    let active = true;
    setReady(false); setPreferences(defaults); setError(null);
    if (isReady && userId && authKey) personalRequest<PersonalPreferences>(userId, authKey, '/preferences')
      .then(value => { if (active) { setPreferences(value); setReady(true); } })
      .catch(() => { if (active) setError('Could not load your display preferences.'); });
    return () => { active = false; };
  }, [userId, authKey, isReady, revision]);
  const save = useCallback(async (patch: Partial<PersonalPreferences>) => {
    if (!ready || saving || !userId || !authKey) return;
    setSaving(true);
    try {
      const next = await personalRequest<PersonalPreferences>(userId, authKey, '/preferences', { method: 'PATCH', body: JSON.stringify({ preferences: { ...preferences, ...patch } }) });
      setPreferences(next);
      toast.success('Saved');
    } catch { toast.error('Could not save your display preferences'); }
    finally { setSaving(false); }
  }, [ready, saving, userId, authKey, preferences]);
  return <Context.Provider value={{ preferences, ready, saving, error, reload: () => setRevision(value => value + 1), save }}>{children}</Context.Provider>;
}
export const usePersonalPreferences = () => useContext(Context);
