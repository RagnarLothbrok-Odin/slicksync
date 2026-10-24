'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { Card, Button, ConfirmModal } from '@/components/ui';
import { SettingRow, ToggleSwitch } from '@/components/settings/SettingRow';
import { useUserAuthHeaders } from '@/lib/hooks/useUserAuth';
import { personalRequest, type PersonalDevice, type PersonalSyncStatus, type PersonalSyncPlan, type HistoryPreview, type PersonalPreferences } from '@/lib/user-api';
import { usePersonalPreferences } from './PersonalPreferences';
import { toast } from '@/components/ui/Toast';
import { AboutPanel } from '@/components/settings/AboutPanel';

function Section({ title, description, children }: { title: string; description: string; children: ReactNode }) {
  return <Card padding="lg"><div className="mb-5"><h3 className="text-base font-semibold font-display text-default">{title}</h3><p className="text-xs text-muted mt-1">{description}</p></div>{children}</Card>;
}
const date = (value: string | null) => value ? new Date(value).toLocaleString() : 'Not yet';
function Failure({ message, retry }: { message: string; retry: () => void }) { return <div role="alert" className="flex flex-wrap items-center gap-3 text-sm text-muted"><p>{message}</p><Button variant="secondary" size="sm" onClick={retry}>Try again</Button></div>; }

export function PersonalDisplayPanel() {
  const { preferences, ready, saving, error, reload, save } = usePersonalPreferences();
  const rows: Array<{ key: keyof PersonalPreferences; label: string; description: string }> = [
    { key: 'beginnerMode', label: 'Beginner Mode', description: 'Show short explanations and help on your pages.' },
    { key: 'hideSensitive', label: 'Private Mode', description: 'Hide your email, group names, and key details while sharing your screen.' },
    { key: 'posterRatings', label: 'Poster ratings', description: 'Show IMDb scores on Discover posters.' },
    { key: 'autoplayTrailer', label: 'Autoplay trailer', description: 'Start a trailer when you open a title in Discover.' },
    { key: 'trailerSound', label: 'Autoplay with sound', description: 'Start autoplayed trailers with sound. Your browser may still require a tap.' },
  ];
  return <Section title="Privacy & Display" description="Your preferences, saved to your account.">
    {error && <Failure message={error} retry={reload} />}
    {!ready && !error && <p role="status" className="text-sm text-muted">Loading preferences...</p>}
    {rows.map(row => <SettingRow key={row.key} label={row.label} description={row.description}><ToggleSwitch label={row.label} enabled={preferences[row.key]} onChange={value => save({ [row.key]: value })} disabled={!ready || saving || (row.key === 'trailerSound' && !preferences.autoplayTrailer)} /></SettingRow>)}
  </Section>;
}

export function PersonalSyncPanel() {
  const { userId, authKey, isReady } = useUserAuthHeaders();
  const [status, setStatus] = useState<PersonalSyncStatus | null>(null);
  const [plan, setPlan] = useState<PersonalSyncPlan | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    let active = true;
    if (!isReady || !userId || !authKey) return;
    const load = () => personalRequest<PersonalSyncStatus>(userId, authKey, '/sync-status').then(value => { if (active) { setStatus(value); setError(''); } }).catch(() => { if (active) setError('Could not load your sync status.'); });
    load(); const timer = setInterval(load, 30000);
    return () => { active = false; clearInterval(timer); };
  }, [userId, authKey, isReady, revision]);
  const preview = async () => {
    if (!userId || !authKey) return;
    setBusy(true); setError(''); setPlan(null);
    try { setPlan(await personalRequest<PersonalSyncPlan>(userId, authKey, '/sync-plan')); }
    catch (error) { setError(error instanceof Error ? error.message : 'Could not load your sync preview.'); }
    finally { setBusy(false); }
  };
  return <Section title="Sync status" description="Your connection and the changes waiting for your next sync.">
    {error && <Failure message={error} retry={() => setRevision(value => value + 1)} />}
    {!status && !error && <p className="text-sm text-muted" role="status">Loading sync status...</p>}
    {status && <><SettingRow label="Last successful sync" description={date(status.lastSyncedAt)}><span className="text-sm text-default capitalize">{status.supported ? status.status : 'Not applicable'}</span></SettingRow>
      {status.error && <p role="status" className="text-sm text-error mb-3">{status.error}</p>}
      {status.connectionProblem && <p className="text-sm text-warning mb-3">Your provider connection needs attention. Sign in again to reconnect.</p>}
      {status.supported ? <Button variant="secondary" size="sm" isLoading={busy} onClick={preview}>Preview next sync</Button> : <p className="text-sm text-muted">Jellyfin manages its libraries on the server; there is no addon list to sync.</p>}
    </>}
    {plan && <div className="mt-5 pt-5 border-t border-default space-y-4" aria-live="polite"><p className="text-sm font-medium text-default">{plan.noGroup ? 'No group supplies addons to your account.' : plan.alreadySynced ? 'You are up to date.' : 'Changes waiting for your next sync'}</p>
      {[['Add', plan.additions], ['Remove', plan.removals]].map(([label, names]) => <div key={String(label)}><h4 className="text-xs font-medium text-muted">{String(label)}</h4><p className="text-sm text-default">{(names as string[]).join(', ') || 'None'}</p></div>)}
      {plan.updates > 0 && <p className="text-sm text-muted">{plan.updates} addon manifests will be refreshed.</p>}
      <details className="text-sm text-muted"><summary className="cursor-pointer">Current and expected addons</summary><p className="mt-2">Current: {plan.current.join(', ') || 'None'}</p><p className="mt-2">Expected: {plan.desired.join(', ') || 'None'}</p></details>
    </div>}
  </Section>;
}

export function PersonalDevicesPanel() {
  const { userId, authKey, isReady } = useUserAuthHeaders();
  const [devices, setDevices] = useState<PersonalDevice[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState('');
  const [revision, setRevision] = useState(0);
  useEffect(() => { const refresh = () => setRevision(value => value + 1); window.addEventListener('personal-devices-changed', refresh); return () => window.removeEventListener('personal-devices-changed', refresh); }, []);
  const [busy, setBusy] = useState(false);
  const [revoke, setRevoke] = useState<PersonalDevice | null>(null);
  useEffect(() => {
    let active = true;
    if (!isReady || !userId || !authKey) return;
    personalRequest<{ devices: PersonalDevice[] }>(userId, authKey, '/devices').then(data => { if (active) { setDevices(data.devices); setLoaded(true); setError(''); } }).catch(() => { if (active) setError('Could not load your devices.'); });
    return () => { active = false; };
  }, [isReady, userId, authKey, revision]);
  const change = async (device: PersonalDevice, method: 'PATCH' | 'DELETE') => {
    if (!userId || !authKey) return;
    setBusy(true);
    try {
      await personalRequest(userId, authKey, `/devices/${encodeURIComponent(device.id)}`, { method, ...(method === 'PATCH' ? { body: JSON.stringify({ label: device.label || '' }) } : {}) });
      setRevision(value => value + 1); setRevoke(null); toast.success(method === 'PATCH' ? 'Device renamed' : 'Notifications revoked');
      window.dispatchEvent(new Event('personal-devices-changed'));
    } catch { toast.error('Could not update that device'); } finally { setBusy(false); }
  };
  return <Section title="Notification devices" description="Only devices registered to your personal account appear here.">
    {error && <Failure message={error} retry={() => setRevision(value => value + 1)} />}
    {!loaded && !error && <p role="status" className="text-sm text-muted">Loading devices...</p>}
    {loaded && !devices.length && <p className="text-sm text-muted">No devices registered. Turn on notifications above to add this device.</p>}
    <div className="space-y-4">{devices.map(device => <div key={device.id} className="settings-row space-y-3"><div><p className="text-sm font-medium text-default break-words">{device.label || device.userAgent || 'Notification device'}</p><p className="text-xs text-muted mt-1">Added {date(device.createdAt)}{device.lastSeenAt ? ` · Last seen ${date(device.lastSeenAt)}` : ''}</p></div><div className="flex gap-2 flex-wrap"><input aria-label="Device name" maxLength={60} className="input-base min-w-0 flex-1 px-3 py-2 text-sm" value={device.label || ''} placeholder="Name this device" onChange={event => setDevices(items => items.map(item => item.id === device.id ? { ...item, label: event.target.value } : item))} /><Button variant="secondary" size="sm" disabled={busy} onClick={() => change(device, 'PATCH')}>Save name</Button><Button variant="ghost" size="sm" disabled={busy} onClick={() => setRevoke(device)}>Revoke</Button></div></div>)}</div>
    <Button variant="ghost" size="sm" className="mt-4" onClick={() => setRevision(value => value + 1)}>Refresh devices</Button>
    <ConfirmModal isOpen={!!revoke} onClose={() => setRevoke(null)} onConfirm={() => revoke ? change(revoke, 'DELETE') : Promise.resolve()} title="Revoke notifications?" description="This device will stop receiving your personal notifications. You can enable them again on that device." confirmText="Revoke" variant="danger" isLoading={busy} />
  </Section>;
}

export function PersonalHistoryPanel({ onExport, exporting }: { onExport: () => void; exporting: boolean }) {
  const { userId, authKey } = useUserAuthHeaders();
  const [preview, setPreview] = useState<HistoryPreview | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState('');
  const choose = async (file?: File) => {
    setPreview(null); setError(''); setResult('');
    if (!file || !userId || !authKey) return;
    if (file.size > 1024 * 1024) { setError('Choose a file smaller than 1 MB.'); return; }
    setBusy(true);
    try { setPreview(await personalRequest<HistoryPreview>(userId, authKey, '/history/preview', { method: 'POST', body: JSON.stringify({ text: await file.text() }) })); }
    catch (error) { setError(error instanceof Error ? error.message : 'Could not read your file'); }
    finally { setBusy(false); }
  };
  const importRows = async () => {
    if (!preview || !userId || !authKey) return;
    setBusy(true); setError('');
    try { const result = await personalRequest<{ imported: number; skipped: number }>(userId, authKey, '/history/import', { method: 'POST', body: JSON.stringify({ token: preview.token }) }); setResult(`Imported ${result.imported} movies. ${result.skipped} already present.`); setPreview(null); }
    catch (error) { setError(error instanceof Error ? error.message : 'Could not import your history'); }
    finally { setBusy(false); }
  };
  return <Section title="Import watch history" description="Preview a CSV or Trakt movie history JSON before adding it to your own account.">
    <div className="mb-5"><Button variant="secondary" size="sm" disabled={exporting} onClick={onExport}>{exporting ? 'Exporting...' : 'Download my data'}</Button></div>
    <p className="text-xs text-muted mb-4">Files need an IMDb ID and watch date. Movie history only, up to 2,000 rows and 1 MB. Existing history stays intact. Ratings and undated watchlists are skipped.</p>
    <label className="block text-sm font-medium text-default mb-2" htmlFor="personal-history-file">History file</label><input id="personal-history-file" className="input-base w-full p-3 text-sm" type="file" accept=".csv,.json,text/csv,application/json" disabled={busy} onChange={event => { const file = event.target.files?.[0]; event.target.value = ''; void choose(file); }} />
    <p className="text-xs text-muted mt-3">CSV example: <code>imdbID,Title,Watched Date</code>, then <code>tt0133093,The Matrix,1999-03-31</code>.</p>
    {busy && <p role="status" className="text-sm text-muted mt-4">Processing your history...</p>}
    {error && <p role="alert" className="text-sm text-error mt-4">{error}</p>}
    {result && <p role="status" className="text-sm text-success mt-4">{result}</p>}
    {preview && <div className="mt-5 pt-5 border-t border-default"><p className="text-sm text-default">{preview.rows.length} new movies · {preview.duplicates} duplicates · {preview.skipped} unsupported or undated entries</p><ul className="text-xs text-muted my-4 space-y-2">{preview.rows.slice(0, 8).map(row => <li key={row.itemId}>{row.itemName} · {new Date(row.watchedAt).toLocaleDateString()}</li>)}</ul>{preview.rows.length > 8 && <p className="text-xs text-muted mb-3">And {preview.rows.length - 8} more.</p>}<div className="flex gap-2"><Button size="sm" disabled={busy || !preview.rows.length} onClick={importRows}>Import {preview.rows.length} movies</Button><Button variant="secondary" size="sm" disabled={busy} onClick={() => setPreview(null)}>Cancel</Button></div></div>}
  </Section>;
}

export function PersonalHelpPanel() {
  const { userId, authKey, isReady } = useUserAuthHeaders();
  const [version, setVersion] = useState('');
  useEffect(() => { let active = true; if (isReady && userId && authKey) personalRequest<{ version: string }>(userId, authKey, '/about').then(data => { if (active) setVersion(data.version); }).catch(() => {}); return () => { active = false; }; }, [isReady, userId, authKey]);
  return <div className="space-y-6"><Section title="Help" description={version ? `SlickSync v${version} · Help for your account` : "Help for your account"}><div className="space-y-5 text-sm text-muted">
    <div><h4 className="font-medium text-default mb-1">Discover and your watchlist</h4><p>Browse movies and shows, open a title for details, and save it to My watchlist. Your saved titles and reactions belong to you.</p></div>
    <div><h4 className="font-medium text-default mb-1">Syncing your addons</h4><p>Use Sync on Home to apply the addons supplied by your groups. Settings → Sync shows the last result and lets you preview additions and removals first. Jellyfin libraries are managed by the server instead.</p></div>
    <div><h4 className="font-medium text-default mb-1">Reconnect your provider</h4><p>If your connection stops working, sign out and sign in again with the same Stremio, Nuvio, or Jellyfin account. Ask your household administrator if it stays disconnected.</p></div>
    <div><h4 className="font-medium text-default mb-1">Your data and privacy</h4><p>Activity Visibility controls what group members see. Public Stats is a separate public link. You can download your data from General, import movie history here, and remove your own account from Security.</p></div>
    <div><h4 className="font-medium text-default mb-1">Phone notifications</h4><p>Install this site to your home screen if your browser requires it, allow notifications, and turn them on in Notifications. You can rename or revoke your devices there.</p></div>
  </div></Section><AboutPanel lumiere={false} shared={false} /><Section title="Your household administrator" description="The person running this instance controls the server."><p className="text-sm text-muted">They can access data stored on it, including provider connections and watch history. Hiding your activity from group members does not hide it from the server administrator.</p></Section></div>;
}
