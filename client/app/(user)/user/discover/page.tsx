'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Button, Card, Modal } from '@/components/ui';
import { UserPageHeader } from '@/components/user/UserPageContainer';
import { useUserAuthHeaders } from '@/lib/hooks/useUserAuth';
import { personalRequest } from '@/lib/user-api';
import { usePersonalPreferences } from '@/components/user/PersonalPreferences';
import { GENRES, DECADES, RATINGS, LENGTHS, SORTS } from '@/lib/discoverWords';
import { toast } from '@/components/ui/Toast';
import { BookmarkIcon, HandThumbUpIcon, HandThumbDownIcon, FilmIcon } from '@heroicons/react/24/outline';

type Title = { id: string; type: 'movie' | 'series'; name: string; poster: string | null; releaseInfo?: string; imdbRating?: string };
type TitleState = { itemId: string; itemType: 'movie' | 'series'; name: string; poster: string | null; saved: boolean; reaction: 'like' | 'dislike' | null };
type Details = { title: string; description: string | null; runtime: string | null; imdbRating: string | null; genres: string[]; cast: Array<{ name: string; character: string | null }>; trailers: string[] };
type Page = { items: Title[]; nextSkip: number | null };

export default function PersonalDiscoverPage() {
  const { userId, authKey, isReady, provider } = useUserAuthHeaders();
  const { preferences } = usePersonalPreferences();
  const [query, setQuery] = useState('');
  const [search, setSearch] = useState('');
  const [kind, setKind] = useState('both');
  const [sort, setSort] = useState('popular');
  const [genre, setGenre] = useState('');
  const [decade, setDecade] = useState('');
  const [minRating, setMinRating] = useState('');
  const [length, setLength] = useState('');
  const [lens, setLens] = useState<'browse' | 'saved'>('browse');
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
      if (lens === 'saved') {
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
    let active = true; setDetails(null); setState(null); setDetailError(''); setTrailer(false);
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
      if (lens === 'saved') setRevision(value => value + 1);
    } catch { toast.error('Could not save your choice'); }
    finally { setSaving(false); }
  };
  const sorted = useMemo(() => {
    const result = [...items];
    if (sort === 'az') result.sort((a, b) => a.name.localeCompare(b.name));
    if (sort === 'rated') {
      const score = (value?: string) => { const number = Number.parseFloat(value || ''); return Number.isFinite(number) ? number : -1; };
      result.sort((a, b) => score(b.imdbRating) - score(a.imdbRating));
    }
    if (sort === 'newest') result.sort((a, b) => (Number.parseInt(b.releaseInfo || '') || 0) - (Number.parseInt(a.releaseInfo || '') || 0));
    return result;
  }, [items, sort]);
  const trailerId = details?.trailers.find(id => /^[\w-]{11}$/.test(id));
  return <div className="pt-6 pb-8"><UserPageHeader title="Discover" subtitle="Find your next favourite." />
    {preferences.beginnerMode && <Card padding="md" className="mb-5"><p className="text-sm text-muted">Browse or search, then open a poster for details. Save titles to your personal watchlist. Your likes and dislikes are private to this account.</p></Card>}
    <div className="flex gap-2 mb-5" role="group" aria-label="Discover view"><Button size="sm" variant={lens === 'browse' ? 'primary' : 'secondary'} onClick={() => setLens('browse')}>Browse</Button><Button size="sm" variant={lens === 'saved' ? 'primary' : 'secondary'} onClick={() => setLens('saved')}>My watchlist</Button></div>
    {lens === 'browse' && <Card padding="lg" className="mb-6"><label className="sr-only" htmlFor="discover-search">Search titles</label><input id="discover-search" className="input-base w-full px-4 py-3 text-sm mb-4" placeholder="Search movies and shows" value={query} onChange={event => setQuery(event.target.value)} />
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">{[
        { label: 'Type', value: kind, set: setKind, options: [['both', 'Movies & shows'], ['movie', 'Movies'], ['series', 'Shows']] },
        { label: 'Sort by', value: sort, set: setSort, options: SORTS.filter(item => item.key !== 'trending').map(item => [item.key, item.label]) },
        { label: 'Genre', value: genre, set: setGenre, options: [['', 'All genres'], ...GENRES.map(item => [item, item])] },
        { label: 'Decade', value: decade, set: setDecade, options: [['', 'Any decade'], ...DECADES.map(item => [item.key, item.label])] },
        { label: 'Minimum rating', value: minRating, set: setMinRating, options: [['', 'Any rating'], ...RATINGS.map(item => [String(item), `${item}+`])] },
        { label: 'Length', value: length, set: setLength, options: [['', 'Any length'], ...LENGTHS.map(item => [item.key, item.label])] },
      ].map(filter => <label key={filter.label} className="text-xs text-muted min-w-0">{filter.label}<select aria-label={filter.label} className="input-base w-full mt-1 px-2 py-2 text-sm" value={filter.value} onChange={event => filter.set(event.target.value)}>{filter.options.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>)}</div>
      <Button variant="ghost" size="sm" className="mt-3" onClick={() => { setQuery(''); setKind('both'); setSort('popular'); setGenre(''); setDecade(''); setMinRating(''); setLength(''); }}>Reset filters</Button>
    </Card>}
    {error && <div role="alert" className="flex gap-3 items-center text-sm text-error mb-5"><p>{error}</p><Button variant="secondary" size="sm" onClick={() => next !== null ? loadMore() : setRevision(value => value + 1)}>Try again</Button></div>}
    {!busy && !error && !items.length && <Card padding="lg"><p className="text-sm text-muted">{lens === 'saved' ? 'Your watchlist is empty. Open a title and save it for later.' : 'No titles match these filters. Try another search or reset your filters.'}</p></Card>}
    <div className="discovery-poster-grid">{sorted.map(item => <button key={item.id} type="button" className="text-left min-w-0 group rounded-2xl focus-visible:ring-2 focus-visible:ring-primary" onClick={() => setSelected(item)} aria-label={`Details for ${item.name}`}><div className="aspect-[2/3] rounded-2xl overflow-hidden bg-subtle relative">{item.poster ? <img src={item.poster} alt="" loading="lazy" className="w-full h-full object-cover" /> : <div className="h-full grid place-items-center"><FilmIcon className="w-10 h-10 text-muted" /></div>}{preferences.posterRatings && item.imdbRating && <span className="absolute bottom-2 left-2 rounded-lg bg-black/80 text-white px-2 py-1 text-xs">IMDb {item.imdbRating}</span>}</div><p className="text-sm font-medium text-default mt-3 truncate">{item.name}</p><p className="text-xs text-muted mt-1">{item.releaseInfo || (item.type === 'series' ? 'Series' : 'Movie')}</p></button>)}</div>
    {busy && <p role="status" className="text-sm text-muted py-6">Loading titles...</p>}
    {next !== null && !search && lens === 'browse' && <div className="flex justify-center mt-6"><Button variant="secondary" disabled={busy} onClick={loadMore}>Load more</Button></div>}
    {attribution && <p className="text-xs text-muted mt-8">{attribution}</p>}
    <Modal isOpen={!!selected} onClose={() => setSelected(null)} title={selected?.name || 'Title details'} size="lg"><div className="space-y-5">
      {detailError && <p role="alert" className="text-sm text-muted">{detailError}</p>}
      {!details && !detailError && <p role="status" className="text-sm text-muted">Loading details...</p>}
      {details && <><p className="text-xs text-muted">{[details.runtime, details.imdbRating ? `IMDb ${details.imdbRating}` : null, ...details.genres].filter(Boolean).join(' · ')}</p><p className="text-sm text-default leading-relaxed">{details.description || 'No description available.'}</p>
        {details.cast.length > 0 && <div><h3 className="text-sm font-medium text-default mb-2">Cast</h3><p className="text-sm text-muted">{details.cast.slice(0, 12).map(person => person.character ? `${person.name} (${person.character})` : person.name).join(', ')}</p></div>}
        {trailerId && <div>{trailer ? <iframe title={`${selected?.name} trailer`} className="w-full aspect-video rounded-xl" src={`https://www.youtube-nocookie.com/embed/${trailerId}?autoplay=1&mute=${preferences.trailerSound ? 0 : 1}`} allow="autoplay; encrypted-media; picture-in-picture" allowFullScreen /> : <Button variant="secondary" size="sm" onClick={() => setTrailer(true)}>Play trailer</Button>}</div>}
      </>}
      {state && <div className="flex flex-wrap gap-2 pt-4 border-t border-default"><Button size="sm" variant={state.saved ? 'primary' : 'secondary'} disabled={saving} onClick={() => change({ saved: !state.saved })} leftIcon={<BookmarkIcon className="w-4 h-4" />}>{state.saved ? 'Saved to watchlist' : 'Save to watchlist'}</Button><Button size="sm" variant={state.reaction === 'like' ? 'primary' : 'secondary'} disabled={saving} aria-pressed={state.reaction === 'like'} onClick={() => change({ reaction: state.reaction === 'like' ? null : 'like' })} leftIcon={<HandThumbUpIcon className="w-4 h-4" />}>Like</Button><Button size="sm" variant={state.reaction === 'dislike' ? 'primary' : 'secondary'} disabled={saving} aria-pressed={state.reaction === 'dislike'} onClick={() => change({ reaction: state.reaction === 'dislike' ? null : 'dislike' })} leftIcon={<HandThumbDownIcon className="w-4 h-4" />}>Dislike</Button></div>}
      {provider === 'stremio' && selected && <a href={`stremio:///detail/${selected.type}/${selected.id}`} className="inline-block text-sm text-primary">Open in Stremio</a>}
    </div></Modal>
  </div>;
}
