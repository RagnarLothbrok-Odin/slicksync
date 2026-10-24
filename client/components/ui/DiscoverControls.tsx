'use client';

import { useState, useLayoutEffect, useEffect, useRef, type ReactNode, type RefObject } from 'react';
import { MagnifyingGlassIcon, XMarkIcon, ArrowsRightLeftIcon, ChevronDownIcon, CheckIcon, AdjustmentsHorizontalIcon } from '@heroicons/react/24/outline';
import { TVFocusable } from '@/components/tv/TVFocusable';
import { GENRES, KINDS, type Kind, type SortKey } from '@/lib/discoverWords';

export function usePopover() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);
  const panel = useRef<HTMLDivElement | null>(null);
  useLayoutEffect(() => {
    const el = panel.current;
    if (!open || !el) return;
    el.style.maxHeight = `${Math.max(220, window.innerHeight - el.getBoundingClientRect().top - 16)}px`;
  }, [open]);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('pointerdown', onDown); document.removeEventListener('keydown', onKey); };
  }, [open]);
  return { open, setOpen, ref, fit: panel };
}

/** D-pad reachable in TV mode, a plain element everywhere else. */
export function Focus({ tv, onEnter, children }: { tv: boolean; onEnter: () => void; children: React.ReactElement }) {
  return tv ? <TVFocusable onEnterPress={onEnter}>{children}</TVFocusable> : children;
}

export function Pill({ on, onClick, children, tv = false }: { on: boolean; onClick: () => void; children: React.ReactNode; tv?: boolean }) {
  return (
    <Focus tv={tv} onEnter={onClick}>
      <button
        type="button"
        onClick={onClick}
        aria-pressed={on}
        className={`h-8 px-3 rounded-full text-[13px] font-medium transition-colors ${on ? 'text-default disc-pill-on' : 'text-muted hover:text-default disc-pill-off'}`}
      >
        {children}
      </button>
    </Focus>
  );
}

const panelStyle: React.CSSProperties = { background: 'var(--color-surface)', border: '1px solid var(--color-surface-border)', boxShadow: '0 24px 60px rgba(0,0,0,0.5)' };

interface DiscoverControlsProps<Lens extends string> {
  isTV?: boolean;
  searchRef?: RefObject<HTMLInputElement | null>;
  searchQuery: string;
  setSearchQuery: (value: string) => void;
  searchPlaceholder: string;
  onDescribe?: () => void;
  kind: Kind;
  setKind: (value: Kind) => void;
  surprise: () => void | Promise<void>;
  lens: Lens;
  setLens: (value: Lens) => void;
  lenses: Array<{ key: Lens; label: string; count?: number }>;
  sortOptions: Array<{ key: string; label: string }> | null;
  sortValue: string;
  pickSort: (key: string) => void;
  hasFilters: boolean;
  filterCount: number;
  filtersBody: (close: () => void) => ReactNode;
  applied: Array<{ key: string; label: string; clear: () => void }>;
  sorts?: Array<{ key: SortKey; label: string }>;
  sort?: SortKey;
  setSort?: (value: SortKey) => void;
  genre?: string;
  setGenre?: (value: string) => void;
}
export function DiscoverHeading() {
  return <div className="discovery-heading mb-7"><p className="text-xs font-semibold text-primary mb-3 tracking-wide">A little inspiration</p><h1 className="font-display font-bold text-default">Find your next favorite.</h1><p className="text-sm text-muted mt-3">Explore a title, follow a familiar face, or find something unexpected.</p></div>;
}
export function DiscoverControls<Lens extends string>({ isTV = false, searchRef, searchQuery, setSearchQuery, searchPlaceholder, onDescribe, kind, setKind, surprise, lens, setLens, lenses, sortOptions, sortValue, pickSort, hasFilters, filterCount, filtersBody, applied, sorts = [], sort, setSort, genre, setGenre }: DiscoverControlsProps<Lens>) {
  const sortPop = usePopover();
  const filtersPop = usePopover();
  const sortLabel = sortOptions?.find(option => option.key === sortValue)?.label || '';
  const lensSpan = (index: number) => lenses.length === 5 ? (index < 3 ? 2 : 3) : lenses.length === 4 ? 3 : 6 / Math.max(1, lenses.length);
  return (
<div className="discovery-controls interface-panel rounded-2xl p-4 md:p-5 mb-7">
          {/* The search, what kind, and Surprise me. TV has no search - typing on a remote isn't worth it. */}
          <div className="flex flex-wrap items-center gap-3">
            {!isTV && (
              <label className="flex-1 min-w-0 sm:min-w-[16rem] basis-full sm:basis-auto h-[52px] flex items-center gap-3 pl-4 pr-3 rounded-2xl" style={{ background: 'var(--color-surface)', border: '1px solid var(--color-surface-border)' }}>
                <MagnifyingGlassIcon className="w-5 h-5 text-muted shrink-0" />
                <input
                  ref={searchRef}
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  onKeyDown={(e) => {
                    // A sentence rather than a title is a description: Enter
                    // looks for what it describes.
                    if (e.key === 'Enter' && onDescribe && lens === 'titles' && searchQuery.trim().split(/\s+/).length >= 4) { e.preventDefault(); onDescribe(); }
                  }}
                  placeholder={searchPlaceholder}
                  aria-label="Search"
                  className="flex-1 min-w-0 bg-transparent outline-none text-default text-base"
                />
                {searchQuery ? (
                  <button type="button" onClick={() => setSearchQuery('')} aria-label="Clear search" className="p-1 rounded-md text-muted hover:text-default">
                    <XMarkIcon className="w-4 h-4" />
                  </button>
                ) : (
                  <kbd className="h-[22px] min-w-[22px] px-1.5 rounded-md text-xs text-muted hidden sm:inline-flex items-center justify-center" style={{ border: '1px solid var(--color-surface-border)' }}>/</kbd>
                )}
              </label>
            )}
            <div role="group" aria-label="Kind" className="flex w-full sm:w-auto p-1 rounded-xl" style={{ background: 'var(--color-surface-hover)' }}>
              {KINDS.map((k) => (
                <Focus key={k.key} tv={isTV} onEnter={() => setKind(k.key)}>
                  <button
                    type="button"
                    onClick={() => setKind(k.key)}
                    aria-pressed={kind === k.key}
                    className={`h-10 px-4 flex-1 sm:flex-none rounded-[10px] text-sm font-medium transition-colors ${kind === k.key ? 'text-default disc-choice-on' : 'text-muted hover:text-default'}`}
                  >
                    {k.label}
                  </button>
                </Focus>
              ))}
            </div>
            <Focus tv={isTV} onEnter={() => { void surprise(); }}>
              <button type="button" onClick={() => { void surprise(); }} className="h-10 px-3.5 rounded-xl text-sm font-medium text-default hidden sm:inline-flex items-center gap-2" style={{ background: 'var(--color-surface)', border: '1px solid var(--color-surface-border)' }}>
                <ArrowsRightLeftIcon className="w-4 h-4" />
                Surprise me
              </button>
            </Focus>
          </div>

          {/* What you are looking through, and in what order and with what filters. */}
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <div className="grid grid-cols-6 gap-1.5 w-full sm:w-auto sm:flex sm:flex-wrap sm:gap-2">
              {lenses.map((l, i) => (
                <Focus key={l.key} tv={isTV} onEnter={() => setLens(l.key)}>
                  <button
                    type="button"
                    onClick={() => setLens(l.key)}
                    aria-pressed={lens === l.key}
                    className={`px-1.5 sm:px-4 py-2 sm:py-1.5 rounded-full text-[14px] sm:text-[15px] font-medium text-center whitespace-nowrap transition-colors ${lens === l.key ? 'text-default disc-choice-on' : 'text-muted hover:text-default'}`}
                    style={{ gridColumn: `span ${lensSpan(i)}` }}
                  >
                    {l.label}
                    {l.count ? <span className="ml-1.5 text-[11px] px-1.5 py-px rounded-full" style={{ background: 'rgba(255,255,255,.08)' }}>{l.count}</span> : null}
                  </button>
                </Focus>
              ))}
            </div>

            {!isTV && (sortOptions || hasFilters) && (
              <div className="relative flex items-center gap-2 w-full sm:w-auto sm:ml-auto">
                {sortOptions && (
                  <div ref={sortPop.ref} className="flex-1 sm:flex-none sm:relative">
                    <button
                      type="button"
                      onClick={() => sortPop.setOpen(!sortPop.open)}
                      aria-expanded={sortPop.open}
                      className="w-full h-10 sm:h-9 px-3.5 sm:px-3 rounded-xl sm:rounded-[10px] text-sm font-medium text-default inline-flex items-center justify-between sm:justify-start gap-1.5"
                      style={{ background: 'var(--color-surface-hover)' }}
                    >
                      <span><span className="text-muted">Sort</span> {sortLabel}</span>
                      <ChevronDownIcon className="w-3.5 h-3.5" />
                    </button>
                    {sortPop.open && (
                      <div ref={sortPop.fit} className="absolute left-0 right-0 sm:left-auto sm:right-0 top-full mt-2 z-30 sm:w-52 p-1.5 rounded-2xl overflow-y-auto" style={panelStyle}>
                        {sortOptions.map((o) => (
                          <button
                            key={o.key}
                            type="button"
                            onClick={() => { pickSort(o.key); sortPop.setOpen(false); }}
                            className={`w-full h-10 px-3 rounded-lg text-sm text-left flex items-center justify-between ${sortValue === o.key ? 'text-default' : 'text-muted hover:text-default hover:bg-surface-hover'}`}
                          >
                            {o.label}
                            {sortValue === o.key && <CheckIcon className="w-4 h-4" style={{ color: 'var(--color-primary)' }} />}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                )}
                {hasFilters && (
                  <div ref={filtersPop.ref} className={sortOptions ? 'sm:relative' : 'flex-1 sm:flex-none sm:relative'}>
                    <button
                      type="button"
                      onClick={() => filtersPop.setOpen(!filtersPop.open)}
                      aria-expanded={filtersPop.open}
                      aria-label={filterCount > 0 ? `Filters, ${filterCount} on` : 'Filters'}
                      className={`relative h-10 sm:h-9 ${sortOptions ? 'w-10 sm:w-auto justify-center' : 'w-full sm:w-auto justify-between sm:justify-start'} sm:pl-3 sm:pr-2 px-3 rounded-xl sm:rounded-[10px] text-sm font-medium text-default inline-flex items-center gap-2 disc-filters-btn ${filtersPop.open ? 'is-open' : ''}`}
                      data-open={filtersPop.open || undefined}
                    >
                      <AdjustmentsHorizontalIcon className="w-5 h-5 sm:w-4 sm:h-4" />
                      <span className={sortOptions ? 'hidden sm:inline' : ''}>Filters</span>
                      {filterCount > 0 && (
                        <span className={`min-w-5 h-5 px-1.5 rounded-full text-[11px] font-bold inline-flex items-center justify-center text-white ${sortOptions ? 'absolute -top-1.5 -right-1.5 sm:static' : ''}`} style={{ background: 'var(--color-primary)' }}>{filterCount}</span>
                      )}
                    </button>
                    {filtersPop.open && (
                      <div ref={filtersPop.fit} data-filters-panel className="absolute left-0 right-0 sm:left-auto sm:right-0 top-full mt-2 z-30 sm:w-[min(560px,92vw)] p-5 rounded-2xl flex flex-col gap-4 overflow-y-auto overscroll-contain" style={panelStyle}>
                        {filtersBody(() => filtersPop.setOpen(false))}
                      </div>
                    )}
                  </div>
                )}
                <button type="button" onClick={() => { void surprise(); }} aria-label="Surprise me" className="sm:hidden h-10 w-10 shrink-0 rounded-xl inline-flex items-center justify-center text-default" style={{ background: 'var(--color-surface-hover)' }}>
                  <ArrowsRightLeftIcon className="w-5 h-5" />
                </button>
              </div>
            )}
          </div>

          {/* TV: the order and genre as rows of pills - a remote can't drive a popup. */}
          {isTV && lens === 'titles' && (
            <div className="mt-3 flex flex-col gap-2">
              <div className="flex flex-wrap gap-2">{sorts.map((o) => <Pill key={o.key} tv on={sort === o.key} onClick={() => setSort?.(o.key)}>{o.label}</Pill>)}</div>
              <div className="flex flex-wrap gap-2">
                <Pill tv on={!genre} onClick={() => setGenre?.('')}>All genres</Pill>
                {GENRES.map((g) => <Pill key={g} tv on={genre === g} onClick={() => setGenre?.(g)}>{g}</Pill>)}
              </div>
            </div>
          )}

          {applied.length > 0 && (
            <div className="mt-4 flex flex-wrap gap-1.5">
              {applied.map((a) => (
                <button key={a.key} type="button" onClick={a.clear} aria-label={`Remove ${a.label}`} className="h-7 pl-3 pr-1.5 rounded-full text-[13px] inline-flex items-center gap-1" style={{ background: 'color-mix(in srgb, var(--color-primary) 16%, transparent)', color: 'color-mix(in srgb, var(--color-primary) 40%, #ffffff)' }}>
                  {a.label}
                  <XMarkIcon className="w-3.5 h-3.5" />
                </button>
              ))}
            </div>
          )}

          </div>
  );
}

export function DiscoverFilters({ groups, count, clear, close, children }: {
  groups: Array<{ label: string; value: string; options: Array<{ value: string; label: string }>; onChange: (value: string) => void }>;
  count: number;
  clear: () => void;
  close: () => void;
  children?: ReactNode;
}) {
  return <>{groups.map(group => <div key={group.label} className="flex flex-col gap-2"><span className="text-xs font-semibold uppercase tracking-[0.08em] text-muted">{group.label}</span><div className="flex flex-wrap gap-1.5"><Pill on={!group.value} onClick={() => group.onChange('')}>Any</Pill>{group.options.map(option => <Pill key={option.value} on={group.value === option.value} onClick={() => group.onChange(option.value)}>{option.label}</Pill>)}</div></div>)}{children}<div className="flex items-center justify-between pt-3" style={{ borderTop: '1px solid var(--color-surface-border)' }}><button type="button" onClick={clear} disabled={!count} className="text-sm font-medium disabled:opacity-40" style={{ color: 'var(--color-primary)' }}>Clear all</button><button type="button" onClick={close} className="px-4 py-1.5 rounded-lg text-sm font-semibold text-white" style={{ background: 'var(--color-primary)' }}>Done</button></div></>;
}
