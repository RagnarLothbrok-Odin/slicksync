'use client';

import { useEffect, useState } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { ArrowLeftIcon, ArrowPathIcon, CheckIcon, MagnifyingGlassIcon } from '@heroicons/react/24/outline';
import md5 from 'crypto-js/md5';
import { Button } from '@/components/ui/Button';
import { DICEBEAR_BASE, DICEBEAR_STYLES, diceBearSelection, diceBearUrl, styleName } from '@/lib/dicebear';

const COLORS = ['e8ecff', 'd5f2e8', 'fce7d5', 'f6dfe9', 'dceafa', 'fff0ba', 'c7c9d1', '20232d'];

export function DiceBearPicker({ name, initialUrl, onChange }: {
  name: string;
  initialUrl?: string | null;
  onChange: (url: string) => void;
}) {
  const saved = diceBearSelection(initialUrl);
  const [styles, setStyles] = useState<string[]>([...DICEBEAR_STYLES]);
  const [style, setStyle] = useState(saved?.style || 'voxel-bot');
  const [seed, setSeed] = useState(saved?.seed || md5(`slicksync-picker:${name}`).toString());
  const [anchorSeed, setAnchorSeed] = useState(seed);
  const [background, setBackground] = useState(saved?.background || '');
  const [choosingStyle, setChoosingStyle] = useState(!saved);
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(0);
  const [capabilities, setCapabilities] = useState<{ style: string; background: boolean } | null>(null);
  const supportsBackground = capabilities?.style === style && capabilities.background;
  const reduceMotion = useReducedMotion();

  useEffect(() => {
    const controller = new AbortController();
    fetch(DICEBEAR_BASE, { signal: controller.signal }).then(response => response.json()).then(data => {
      if (Array.isArray(data.styles)) {
        const valid = data.styles.filter((value: unknown): value is string => typeof value === 'string' && /^[a-z0-9-]+$/.test(value));
        if (valid.length) setStyles(valid);
      }
    }).catch(() => { /* The bundled index keeps the picker usable offline. */ });
    return () => controller.abort();
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    fetch(`${DICEBEAR_BASE}/${style}/options.json`, { signal: controller.signal }).then(response => response.json()).then(options => {
      setCapabilities({ style, background: !!options.backgroundColor });
    }).catch(() => { /* Keep unsupported controls hidden until capabilities are known. */ });
    return () => controller.abort();
  }, [style]);

  useEffect(() => { onChange(diceBearUrl(style, seed, supportsBackground ? background : undefined)); }, [style, seed, background, supportsBackground, onChange]);

  const variants = Array.from({ length: 12 }, (_, index) => md5(`${name}:${style}:${page}:${index}`).toString());
  const checker = { backgroundColor: 'var(--color-surface)', backgroundImage: 'conic-gradient(var(--color-surface-hover) 25%, transparent 0 50%, var(--color-surface-hover) 0 75%, transparent 0)', backgroundSize: '12px 12px' };

  return (
    <div className="space-y-5">
      {choosingStyle ? (
        <>
          <div className="flex items-start justify-between gap-3">
            <div><h3 className="text-base font-semibold text-default">Find your style</h3><p className="text-sm text-muted mt-1">Faces, robots, pixels, patterns. All {styles.length} sets.</p></div>
            <Button size="sm" variant="ghost" onClick={() => setChoosingStyle(false)}>Back to avatar</Button>
          </div>
          <label className="flex items-center gap-2 rounded-xl border border-default bg-surface-hover px-3 py-2.5">
            <MagnifyingGlassIcon className="w-4 h-4 text-muted" />
            <input aria-label="Search avatar styles" placeholder="Search styles" value={query} onChange={event => setQuery(event.target.value)} className="w-full min-w-0 bg-transparent text-sm text-default outline-none" />
          </label>
          <div className="grid grid-cols-3 sm:grid-cols-4 gap-2" role="group" aria-label="Avatar styles">
            {styles.filter(value => styleName(value).toLowerCase().includes(query.toLowerCase())).map(value => (
              <button key={value} type="button" aria-pressed={value === style} onClick={() => { setStyle(value); setPage(0); setChoosingStyle(false); }} className={`rounded-2xl border p-2 text-center transition-colors ${value === style ? 'border-primary bg-primary/10' : 'border-default hover:bg-surface-hover'}`}>
                <img src={diceBearUrl(value, 'style-preview')} alt="" loading="lazy" decoding="async" referrerPolicy="no-referrer" className="w-14 h-14 mx-auto rounded-xl bg-surface-hover" />
                <span className="block text-xs font-medium text-default mt-2 leading-snug">{styleName(value)}</span>
              </button>
            ))}
          </div>
          {!styles.some(value => styleName(value).toLowerCase().includes(query.toLowerCase())) && <p role="status" className="text-sm text-muted py-4 text-center">No styles match your search.</p>}
        </>
      ) : (
        <>
          <div className="flex items-center justify-between gap-2">
            <Button variant="ghost" size="sm" leftIcon={<ArrowLeftIcon className="w-4 h-4" />} onClick={() => setChoosingStyle(true)}>Styles</Button>
            <h3 className="text-base font-semibold text-default">{styleName(style)}</h3>
            <Button variant="ghost" size="sm" leftIcon={<ArrowPathIcon className="w-4 h-4" />} onClick={() => { setAnchorSeed(seed); setPage(value => value + 1); }}>More</Button>
          </div>
          <motion.div key={`${style}:${page}`} initial={reduceMotion ? false : { opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.15 }} className="grid grid-cols-4 gap-2" role="group" aria-label="Avatar characters">
            {[anchorSeed, ...variants.filter(value => value !== anchorSeed)].slice(0, 12).map((value, index) => (
              <button key={value} type="button" aria-label={`Choose avatar ${index + 1}`} aria-pressed={seed === value} onClick={() => setSeed(value)} className={`relative aspect-square rounded-2xl border-2 p-1 transition-colors ${seed === value ? 'border-primary bg-primary/10' : 'border-transparent hover:bg-surface-hover'}`}>
                <img src={diceBearUrl(style, value)} alt="" loading="lazy" referrerPolicy="no-referrer" className="w-full h-full rounded-xl" style={background && background !== 'ffffff00' ? { backgroundColor: `#${background}` } : checker} />
                {seed === value && <span className="absolute bottom-0 right-0 rounded-full bg-primary p-0.5 text-on-primary"><CheckIcon className="w-3.5 h-3.5" /></span>}
              </button>
            ))}
          </motion.div>
          {supportsBackground && (
            <fieldset className="space-y-3">
              <legend className="text-sm font-semibold text-default">Background</legend>
              <div className="flex flex-wrap gap-2">
                <Button variant={background === '' ? 'primary' : 'secondary'} size="sm" aria-pressed={background === ''} onClick={() => setBackground('')}>Original</Button>
                <Button variant={background === 'ffffff00' ? 'primary' : 'secondary'} size="sm" aria-pressed={background === 'ffffff00'} onClick={() => setBackground('ffffff00')}>Clear</Button>
                {COLORS.map(color => <button key={color} type="button" aria-label={`Background #${color}`} aria-pressed={background === color} onClick={() => setBackground(color)} className={`w-9 h-9 rounded-full border-2 ${background === color ? 'border-primary ring-2 ring-primary/30' : 'border-default'}`} style={{ backgroundColor: `#${color}` }} />)}
                <label className="relative w-9 h-9 rounded-full overflow-hidden border border-default cursor-pointer" title="Custom background colour"><span className="absolute inset-0 flex items-center justify-center text-default bg-surface-hover text-lg">+</span><input type="color" aria-label="Custom background colour" value={`#${background.length === 6 ? background : 'e8ecff'}`} onChange={event => setBackground(event.target.value.slice(1))} className="absolute inset-0 w-full h-full opacity-0 cursor-pointer" /></label>
              </div>
              <p className="text-xs text-muted">Clear removes the outer background. Some styles include colour inside the artwork.</p>
            </fieldset>
          )}
          <a href={`https://www.dicebear.com/styles/${style}/`} target="_blank" rel="noreferrer" className="inline-block text-xs text-muted underline underline-offset-4">About this style and its artist</a>
        </>
      )}
    </div>
  );
}
