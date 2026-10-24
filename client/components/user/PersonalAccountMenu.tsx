'use client';

import { useEffect, useState } from 'react';
import { Avatar, Modal } from '@/components/ui';
import { PanelSwitcher } from '@/components/layout/PanelSwitcher';
import { useUserAuth } from '@/lib/hooks/useUserAuth';
import { personalProfiles, userAuth, type PersonalProfile } from '@/lib/user-api';
import { usePersonalPreferences } from './PersonalPreferences';

export function PersonalAccountMenu({ onLogout }: { onLogout: () => void }) {
  const { userInfo, userId, authKey, provider } = useUserAuth();
  const { preferences } = usePersonalPreferences();
  const [profiles, setProfiles] = useState<PersonalProfile[]>([]);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    if (provider !== 'nuvio' || !userId || !authKey) return;
    personalProfiles.list(userId, authKey).then(data => {
      if (!active) return;
      const choices = Array.isArray(data.profiles) ? data.profiles : [];
      setProfiles(choices);
      const stored = JSON.parse(localStorage.getItem('slicksync-user-auth') || '{}');
      if (choices.length > 1 && !stored.profileSelected) setOpen(true);
    }).catch(() => {});
    return () => { active = false; };
  }, [provider, userId, authKey]);
  const select = async (profile: PersonalProfile) => {
    if (!userId || !authKey || busy) return;
    setBusy(true); setError('');
    try {
      const session = await personalProfiles.switch(userId, authKey, profile.id);
      const info = await userAuth.getUserInfo(session.userId, session.sessionToken);
      // Reload every personal view after selecting an identity so no previous
      // profile's in-memory library, history or preferences can carry over.
      localStorage.setItem('slicksync-user-auth', JSON.stringify({ userId: session.userId, authKey: session.sessionToken, provider: 'nuvio', userInfo: info, profileSelected: true }));
      window.location.assign('/user');
    } catch (error) { setError(error instanceof Error ? error.message : 'Could not switch profiles'); setBusy(false); }
  };
  const close = () => {
    if (busy) return;
    const stored = JSON.parse(localStorage.getItem('slicksync-user-auth') || '{}');
    localStorage.setItem('slicksync-user-auth', JSON.stringify({ ...stored, profileSelected: true }));
    setOpen(false);
  };
  return <><PanelSwitcher mode="user" userInfo={preferences.hideSensitive && userInfo ? { ...userInfo, email: '' } : userInfo} onLogout={onLogout} onSwitchProfile={profiles.length > 1 ? () => setOpen(true) : undefined} variant="compact" dropdownPosition="down" align="right" />
    <Modal isOpen={open} onClose={close} title="Who's watching?" description="Choose one of your profiles registered with SlickSync." size="md"><div className="grid grid-cols-2 gap-3">{profiles.map(profile => <button key={profile.id} type="button" disabled={busy} onClick={() => select(profile)} aria-label={`Use ${profile.username} profile`} className="interface-panel rounded-2xl p-5 flex flex-col items-center gap-3 hover:bg-surface-hover transition-colors focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-50"><Avatar name={profile.username} src={profile.avatarUrl || undefined} colorIndex={profile.colorIndex} size="xl" /><span className="text-sm font-semibold text-default break-words">{profile.username}</span><span className="text-xs text-muted">{profile.id === userId ? 'Current profile' : `Profile ${profile.nuvioProfileId}`}</span></button>)}</div>{busy && <p role="status" className="text-sm text-muted mt-4">Opening your profile...</p>}{error && <p role="alert" className="text-sm text-error mt-4">{error}</p>}</Modal></>;
}
