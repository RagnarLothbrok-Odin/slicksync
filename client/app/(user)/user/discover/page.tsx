'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Button, Card, Modal, PosterCard, type PosterCardItem } from '@/components/ui';
import { DiscoverControls, DiscoverFilters, DiscoverHeading } from '@/components/ui/DiscoverControls';
import { useUserAuthHeaders } from '@/lib/hooks/useUserAuth';
import { personalRequest } from '@/lib/user-api';
import { usePersonalPreferences } from '@/components/user/PersonalPreferences';
import { GENRES, DECADES, RATINGS, LENGTHS, SORTS, type Kind, type SortKey } from '@/lib/discoverWords';
import { toast } from '@/components/ui/Toast';
import { BookmarkIcon, HandThumbUpIcon, HandThumbDownIcon } from '@heroicons/react/24/outline';

type Title = { id: string; type: 'movie' | 'series'; name: string; poster: string | null; releaseInfo?: string; imdbRating?: string };
type TitleState = { itemId: string; itemType: 'movie' | 'series'; name: string; poster: string | null; saved: boolean; reaction: 'like' | 'dislike' | null };
type Details = { title: string; description: string | null; runtime: string | null; imdbRating: string | null; genres: string[]; cast: Array<{ name: string; character: string | null }>; trailers: string[] };
type Page = { items: Title[]; nextSkip: number | null };

export default function PersonalDiscoverPage() {
  const { userId, authKey, isReady, provider } = useUserAuthHeaders();
  const { preferences } = usePersonalPreferences();
  const [openMenuKey, setOpenMenuKey] = useState<string | null>(null);
  const [savedIds, setSavedIds] = useState<Set<string>>(new Set());
  const [query, setQuery] = useState('');
  const [search, setSearch] = useState('');
  const [kind, setKind] = useState<Kind>('both');
  const [sort, setSort] = useState<SortKey>('popular');
  const [genre, setGenre] = useState('');
  const [decade, setDecade] = useState('');
  const [minRating, setMinRating] = useState('');
  const [length, setLength] = useState('');
  const [lens, setLens] = useState<'titles' | 'watchlist'>('titles');
  const [items, setItems] = useState<Title[]>([]);
  const [next, setNext] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [revision, setRevision] = useState(0);
  const [selected, setSelected] = useState<Title | null>(null);
  const [details, setDetails] = useState<Details | null>(null);
  const [state, setState] = useState<TitleState | null>(null);
  const [detailError, setDetailError] = useState('');
  const [saving, setSaving] = useState(false);
  const [trailer, setTrailer] = useState(false);
  const [explicitTrailer, setExplicitTrailer] = useState(false);
  const [attribution, setAttribution] = useState('');
  // A generation pins pagination to its filters. Late pages never append to
  // a newer search, and double taps cannot request the same cursor twice.
  const generation = useRef(0);
  const paging = useRef(false);
  const selectedRef = useRef<Title | null>(null);
  selectedRef.current = selected;
  const params = useMemo(() => new URLSearchParams({ type: kind, catalog: SORTS.find(item => item.key === sort)?.catalog || 'top', ...(search ? { query: search } : {}), ...(genre ? { genre } : {}), ...(decade ? { decade } : {}), ...(minRating ? { minRating } : {}), ...(length ? { length } : {}), paged: '1' }).toString(), [kind, sort, search, genre, decade, minRating, length]);
  useEffect(() => { const timer = setTimeout(() => setSearch(query.trim()), 300); return () => clearTimeout(timer); }, [query]);
  useEffect(() => {
    let active = true;
    if (isReady && userId && authKey) personalRequest<{ attribution: string }>(userId, authKey, '/discover/lumiere').then(data => { if (active) setAttribution(data.attribution); }).catch(() => {});
    return () => { active = false; };
  }, [isReady, userId, authKey]);
  useEffect(() => {
    const version = ++generation.current;
    paging.current = false; setItems([]); setNext(null); setError('');
    if (!isReady || !userId || !authKey) return;
    setBusy(true);
    const load = async () => {
      if (lens === 'watchlist') {
        const data = await personalRequest<{ items: TitleState[] }>(userId, authKey, '/discover/saved');
        return { items: data.items.map(item => ({ id: item.itemId, type: item.itemType, name: item.name, poster: item.poster })), nextSkip: null } as Page;
      }
      return personalRequest<Page>(userId, authKey, `/discover/${search ? 'search' : 'browse'}?${params}`);
    };
    load().then(data => { if (version === generation.current) { setItems(data.items); setNext(data.nextSkip); } }).catch(error => { if (version === generation.current) setError(error instanceof Error ? error.message : 'Could not load titles'); }).finally(() => { if (version === generation.current) setBusy(false); });
    return () => { generation.current = version + 1; };
  }, [isReady, userId, authKey, lens, search, params, revision]);
  const loadMore = async () => {
    if (!userId || !authKey || next === null || paging.current) return;
    const version = generation.current; paging.current = true; setBusy(true); setError('');
    try {
      const data = await personalRequest<Page>(userId, authKey, `/discover/browse?${params}&skip=${next}`);
      if (version === generation.current) { setItems(previous => { const ids = new Set(previous.map(item => item.id)); return [...previous, ...data.items.filter(item => !ids.has(item.id))]; }); setNext(data.nextSkip === next ? null : data.nextSkip); }
    } catch { if (version === generation.current) setError('Could not load more titles. Please try again.'); }
    finally { if (version === generation.current) { paging.current = false; setBusy(false); } }
  };
  useEffect(() => {
    let active = true; setDetails(null); setState(null); setDetailError(''); setTrailer(false); setExplicitTrailer(false);
    if (selected && userId && authKey) personalRequest<{ metadata: Details | null; state: TitleState | null }>(userId, authKey, `/discover/titles/${selected.id}?type=${selected.type}`)
      .then(data => { if (active) { setDetails(data.metadata); setState(data.state || { itemId: selected.id, itemType: selected.type, name: selected.name, poster: selected.poster, saved: false, reaction: null }); if (!data.metadata) setDetailError('Details are unavailable right now.'); setTrailer(preferences.autoplayTrailer); } })
      .catch(() => { if (active) setDetailError('Could not load this title. Close it and try again.'); });
    return () => { active = false; };
  }, [selected, userId, authKey, preferences.autoplayTrailer]);
  const change = async (patch: Partial<Pick<TitleState, 'saved' | 'reaction'>>) => {
    if (!selected || !state || !userId || !authKey || saving) return;
    const target = selected;
    setSaving(true);
    try {
      const next = await personalRequest<TitleState>(userId, authKey, `/discover/titles/${target.id}`, { method: 'PUT', body: JSON.stringify({ ...state, ...patch }) });
      if (selectedRef.current?.id === target.id) setState(next);
      setRevision(value => value + 1);
    } catch { toast.error('Could not save your choice'); }
    finally { setSaving(false); }
  };
  useEffect(() => { let active = true; if (isReady && userId && authKey) personalRequest<{ items: TitleState[] }>(userId, authKey, '/discover/saved').then(data => { if (active) setSavedIds(new Set(data.items.map(item => item.itemId))); }).catch(() => {}); return () => { active = false; }; }, [isReady, userId, authKey, revision]);
  const prefetch = (item: PosterCardItem) => { if (userId && authKey) void personalRequest(userId, authKey, `/discover/titles/${item.id}?type=${item.type}`).catch(() => {}); };
  const toggleSaved = async (item: PosterCardItem, saved: boolean) => {
    if (!userId || !authKey) return;
    try {
      const { state } = await personalRequest<{ state: TitleState | null }>(userId, authKey, `/discover/titles/${item.id}?type=${item.type}`);
      await personalRequest(userId, authKey, `/discover/titles/${item.id}`, { method: 'PUT', body: JSON.stringify({ name: item.name, itemType: item.type, poster: item.poster, saved, reaction: state?.reaction || null }) });
      setRevision(value => value + 1);
    } catch { toast.error('Could not update your watchlist'); }
  };
  const sorted = useMemo(() => {
    const result = items.filter(item => lens !== 'watchlist' || ((!search || item.name.toLowerCase().includes(search.toLowerCase())) && (kind === 'both' || item.type === kind)));
    if (sort === 'az') result.sort((a, b) => a.name.localeCompare(b.name));
    if (sort === 'rated') {
      const score = (value?: string) => { const number = Number.parseFloat(value || ''); return Number.isFinite(number) ? number : -1; };
      result.sort((a, b) => score(b.imdbRating) - score(a.imdbRating));
    }
    if (sort === 'newest') result.sort((a, b) => (Number.parseInt(b.releaseInfo || '') || 0) - (Number.parseInt(a.releaseInfo || '') || 0));
    return result;
  }, [items, sort, lens, search, kind]);
  const trailerId = details?.trailers.find(id => /^[\w-]{11}$/.test(id));
  const clearFilters = () => { setGenre(''); setDecade(''); setMinRating(''); setLength(''); };
  const groups = [
    { label: 'Genre', value: genre, onChange: setGenre, options: GENRES.map(value => ({ value, label: value })) },
    { label: 'Decade', value: decade, onChange: setDecade, options: DECADES.map(item => ({ value: item.key, label: item.label })) },
    { label: 'Rating', value: minRating, onChange: setMinRating, options: RATINGS.map(value => ({ value: String(value), label: `${value}+` })) },
    { label: 'Length', value: length, onChange: setLength, options: LENGTHS.map(item => ({ value: item.key, label: item.label })) },
  ];
  const applied = lens === 'titles' ? groups.filter(group => group.value).map(group => ({ key: group.label, label: group.options.find(option => option.value === group.value)?.label || group.value, clear: () => group.onChange('') })) : [];
  return <div className="pt-6 pb-8"><DiscoverHeading />
    <DiscoverControls searchQuery={query} setSearchQuery={setQuery} searchPlaceholder={lens === 'watchlist' ? 'Search your watchlist' : 'Search a title'} kind={kind} setKind={setKind} surprise={() => { const item = sorted[Math.floor(Math.random() * sorted.length)]; if (item) setSelected(item); }} lens={lens} setLens={setLens} lenses={[{ key: 'titles', label: 'Titles' }, { key: 'watchlist', label: 'Watchlist', count: savedIds.size }]} sortOptions={SORTS.filter(item => item.key !== 'trending')} sortValue={sort} pickSort={value => setSort(value as SortKey)} hasFilters={lens === 'titles'} filterCount={applied.length} filtersBody={close => <DiscoverFilters groups={groups} count={applied.length} clear={clearFilters} close={close} />} applied={applied} />
    <h2 className="text-lg sm:text-xl font-semibold font-display text-default mb-4">{lens === 'watchlist' ? 'Your watchlist' : search ? `Results for “${search}”` : SORTS.find(item => item.key === sort)?.label}</h2>
    {error && <div role="alert" className="flex gap-3 items-center text-sm text-error mb-5"><p>{error}</p><Button variant="secondary" size="sm" onClick={() => next !== null ? loadMore() : setRevision(value => value + 1)}>Try again</Button></div>}
    {!busy && !error && !items.length && <Card padding="lg"><p className="text-sm text-muted">{lens === 'watchlist' ? 'Your watchlist is empty. Open a title and save it for later.' : 'No titles match these filters. Try another search or reset your filters.'}</p></Card>}
    <div className="discovery-poster-grid">{sorted.map((item, index) => <PosterCard key={item.id} item={item} priority={index < 16} onOpenDetails={item => setSelected({ ...item, releaseInfo: item.releaseInfo || undefined, imdbRating: item.imdbRating || undefined })} onToggleWatchlist={toggleSaved} onToggleWatched={() => {}} showWatchedMenu={false} showWatchedBadge={false} showCatalogMenu={false} inWatchlist={savedIds.has(item.id)} onPrefetchDetails={prefetch} isMenuOpen={openMenuKey === item.id} onMenuOpenChange={(open, key) => setOpenMenuKey(open ? key : null)} />)}</div>
    {busy && <p role="status" className="text-sm text-muted py-6">Loading titles...</p>}
    {next !== null && !search && lens === 'titles' && <div className="flex justify-center mt-6"><Button variant="secondary" disabled={busy} onClick={loadMore}>Load more</Button></div>}
    {attribution && <p className="text-xs text-muted mt-8">{attribution}</p>}
    <Modal isOpen={!!selected} onClose={() => setSelected(null)} title={selected?.name || 'Title details'} size="lg"><div className="space-y-5">
      {detailError && <p role="alert" className="text-sm text-muted">{detailError}</p>}
      {!details && !detailError && <p role="status" className="text-sm text-muted">Loading details...</p>}
      {details && <><p className="text-xs text-muted">{[details.runtime, details.imdbRating ? `IMDb ${details.imdbRating}` : null, ...details.genres].filter(Boolean).join(' · ')}</p><p className="text-sm text-default leading-relaxed">{details.description || 'No description available.'}</p>
        {details.cast.length > 0 && <div><h3 className="text-sm font-medium text-default mb-2">Cast</h3><p className="text-sm text-muted">{details.cast.slice(0, 12).map(person => person.character ? `${person.name} (${person.character})` : person.name).join(', ')}</p></div>}
        {trailerId && <div>{trailer ? <iframe title={`${selected?.name} trailer`} className="w-full aspect-video rounded-xl" src={`https://www.youtube-nocookie.com/embed/${trailerId}?autoplay=1&mute=${explicitTrailer || preferences.trailerSound ? 0 : 1}`} allow="autoplay; encrypted-media; picture-in-picture" allowFullScreen /> : <Button variant="secondary" size="sm" onClick={() => { setExplicitTrailer(true); setTrailer(true); }}>Play trailer</Button>}</div>}
      </>}
      {state && <div className="flex flex-wrap gap-2 pt-4 border-t border-default"><Button size="sm" variant={state.saved ? 'primary' : 'secondary'} disabled={saving} onClick={() => change({ saved: !state.saved })} leftIcon={<BookmarkIcon className="w-4 h-4" />}>{state.saved ? 'Saved to watchlist' : 'Save to watchlist'}</Button><Button size="sm" variant={state.reaction === 'like' ? 'primary' : 'secondary'} disabled={saving} aria-pressed={state.reaction === 'like'} onClick={() => change({ reaction: state.reaction === 'like' ? null : 'like' })} leftIcon={<HandThumbUpIcon className="w-4 h-4" />}>Like</Button><Button size="sm" variant={state.reaction === 'dislike' ? 'primary' : 'secondary'} disabled={saving} aria-pressed={state.reaction === 'dislike'} onClick={() => change({ reaction: state.reaction === 'dislike' ? null : 'dislike' })} leftIcon={<HandThumbDownIcon className="w-4 h-4" />}>Dislike</Button></div>}
      {provider === 'stremio' && selected && <a href={`stremio:///detail/${selected.type}/${selected.id}`} className="inline-block text-sm text-primary">Open in Stremio</a>}
    </div></Modal>
  </div>;
}
