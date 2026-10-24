'use client';

import { memo, useRef } from 'react';
import { PlayIcon, InformationCircleIcon, XCircleIcon } from '@heroicons/react/24/outline';
import { Badge } from './Badge';
import { ContextMenu, useContextMenu } from './ContextMenu';
import { toast } from './Toast';
import type { ContinueWatchingItem } from '@/lib/api';
import { providerTypeLabel, providerBadgeVariant } from '@/lib/providers';
import { cachedImageUrl } from '@/lib/posterUrl';

// Continue Watching card - right-click to remove, and guards its own click
// against firing right after a drag-to-scroll gesture on the parent row
// (checked via a shared ref rather than local state, since the drag
// happens on the scroll container, not the card itself).
//
// Navigation is a plain native <a href> with no JS in the way - confirmed
// working for Stremio's app link (a real click opened the app). An earlier
// attempt to add a JS-driven fallback (intercepting the click, setting
// location.href programmatically, timing a fallback) broke that working
// case: browsers treat a direct anchor click far more reliably for
// custom-scheme navigation than a script-driven location.href assignment,
// even from inside a genuine click handler. So: appUrl (Stremio only - see
// continueWatching.js) opens natively in the same tab; webUrl (everyone
// else, or Stremio's own fallback if no appUrl) opens as an ordinary link
// in a new tab. The only JS involved is the drag-cancel.
export const ContinueWatchingCard = memo(function ContinueWatchingCard({
  item,
  wasDraggedRef,
  onRemove,
  onOpenDetails,
  isMenuOpen,
  onMenuOpenChange,
  priority = false,
  cacheImages = true,
  removalMessage,
}: {
  item: ContinueWatchingItem;
  /** The first cards in the row: fetched at once rather than when seen. */
  priority?: boolean;
  cacheImages?: boolean;
  removalMessage?: string | null;
  wasDraggedRef: React.RefObject<boolean>;
  onRemove: (item: ContinueWatchingItem) => void;
  onOpenDetails: (item: ContinueWatchingItem) => void;
  isMenuOpen: boolean;
  // Receives this card's own composite key so the parent can use ONE stable
  // useCallback for every card instead of a fresh
  // `(open) => setOpenMenuKey(open ? key : null)` closure per card per
  // render - a new function identity every render silently defeats this
  // component's own React.memo below, which is exactly what was happening at
  // both call sites (Continue Watching appears twice on this page).
  onMenuOpenChange: (open: boolean, key: string) => void;
}) {
  // position/preventDefault still come from the hook, but which card's menu
  // is actually rendered open is driven by isMenuOpen (lifted to the parent)
  // rather than this hook's own isOpen - each card had its own independent
  // isOpen before, and right-clicking a second card's own stopPropagation
  // (needed to suppress the native menu) blocked the FIRST card's "close on
  // outside click" listener from ever firing, orphaning it open. A single
  // shared "which card owns the open menu" value fixes that by construction.
  const { position, handleContextMenu, setExternalClose } = useContextMenu();
  // Registers the REAL close (onClose below) for cross-section/cross-page
  // closing - onMenuOpenChange is the lifted state that actually drives
  // isOpen here, so this hook's own internal close wouldn't hide anything.
  setExternalClose(() => onMenuOpenChange(false, `${item.userId}-${item.showId}`));

  // Long-press → context menu for touch devices. onContextMenu alone (below)
  // only reliably fires from an actual right-click; mobile browsers don't
  // consistently synthesize it from a long-press on an arbitrary div/anchor
  // the way they sometimes do for plain text/images, so it was silently
  // never opening on phones. Same pattern AddonCard and UpcomingRow already
  // use: a 500ms timer, cancelled on move/scroll (parent row's drag-to-scroll
  // shouldn't also trigger this) so a scroll gesture isn't hijacked into a
  // menu open. Cleared with a longer than typical 10px threshold makes sense
  // here since this row scrolls horizontally right where you'd press.
  const pressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const startPos = useRef<{ x: number; y: number } | null>(null);
  const clearPress = () => {
    if (pressTimer.current) { clearTimeout(pressTimer.current); pressTimer.current = null; }
    startPos.current = null;
  };
  const handleTouchStart = (e: React.TouchEvent) => {
    const t = e.touches[0];
    if (!t) return;
    startPos.current = { x: t.clientX, y: t.clientY };
    pressTimer.current = setTimeout(() => {
      handleContextMenu(e as unknown as Event, t.clientX, t.clientY);
      onMenuOpenChange(true, `${item.userId}-${item.showId}`);
      pressTimer.current = null;
    }, 500);
  };
  const handleTouchMove = (e: React.TouchEvent) => {
    if (!startPos.current || !pressTimer.current) return;
    const t = e.touches[0];
    if (!t) return;
    const dx = Math.abs(t.clientX - startPos.current.x);
    const dy = Math.abs(t.clientY - startPos.current.y);
    if (dx > 10 || dy > 10) clearPress();
  };

  return (
    <div
      onContextMenu={(e) => {
        handleContextMenu(e);
        onMenuOpenChange(true, `${item.userId}-${item.showId}`);
      }}
      onTouchStart={handleTouchStart}
      onTouchEnd={clearPress}
      onTouchCancel={clearPress}
      onTouchMove={handleTouchMove}
      className="shrink-0 relative"
    >
      <div
        onClick={() => {
          // Suppress the click that fires immediately after a long-press
          // opens the menu - otherwise a long-press both opens the menu AND
          // the detail modal as soon as the finger lifts.
          if (wasDraggedRef.current || isMenuOpen) return;
          onOpenDetails(item);
        }}
        draggable={false}
        onDragStart={(e) => e.preventDefault()}
        className="group relative block w-40 rounded-xl overflow-hidden bg-slate-800 shadow-lg select-none cursor-pointer tap-card"
      >
        <div className="relative aspect-video">
          {/* Image priority for this landscape (16:9) frame: episode still
              first (already 16:9), then the show/movie's landscape backdrop,
              and only then the portrait poster as a last resort - a portrait
              poster forced into a 16:9 frame is what caused the "too zoomed
              in" hard crop. */}
          {(item.nextEpisode?.thumbnail || item.background || item.poster) ? (
            <img
              // Through the server's image cache at the card's size, like
              // every poster grid - not the full-size original each launch.
              src={(cacheImages ? cachedImageUrl(item.nextEpisode?.thumbnail || item.background || item.poster) : item.nextEpisode?.thumbnail || item.background || item.poster) || ''}
              alt={item.showName}
              draggable={false}
              loading={priority ? 'eager' : 'lazy'}
              fetchPriority={priority ? 'high' : undefined}
              decoding="async"
              className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-105 pointer-events-none"
            />
          ) : (
            <div className="w-full h-full flex items-center justify-center bg-slate-800">
              <PlayIcon className="w-8 h-8 text-slate-600" />
            </div>
          )}
          {/* ONLY this play button navigates straight to the app/web link -
              everywhere else on the card opens the detail modal instead
              (onClick above). Previously the whole card was one <a>, so
              clicking anywhere - poster art, title, anywhere - launched the
              app link; only the small (i) button below opened the modal.
              stopPropagation keeps this click from also bubbling to the
              card's own onClick and opening the modal right behind it. */}
          <a
            href={item.appUrl || item.webUrl}
            target={item.appUrl ? undefined : '_blank'}
            rel={item.appUrl ? undefined : 'noopener noreferrer'}
            onClick={(e) => {
              e.stopPropagation();
              if (wasDraggedRef.current || isMenuOpen) e.preventDefault();
            }}
            aria-label={`Resume ${item.showName}`}
            className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
            style={{ background: 'rgba(0,0,0,0.4)' }}
          >
            <PlayIcon className="w-8 h-8 text-white" />
          </a>
          {/* Netflix-style progress bar for partway-through items - only on
              resume entries, where progressPercent is real position data from
              WatchSession (not shown for next-episode cards, which by
              definition start from 0). Ratings deliberately not shown on this
              card - they're in the detail modal the info button opens.
              Fill defaults to the theme's primary→secondary accent gradient
              (so it re-colors with every theme, not just one) plus a matching
              glow, but --color-progress (Settings → Themes → Build your own
              theme → "Progress bar") overrides both with a flat color when
              set. Over a dark track, so it stays clearly visible against any
              poster art. Sits in its own thin strip below the thumbnail
              rather than overlaid on it, so nothing covers it. */}
          {item.resume && item.progressPercent != null && (
            <div className="absolute bottom-0 left-0 right-0 h-1.5 pointer-events-none" style={{ background: 'rgba(0,0,0,0.55)' }}>
              <div
                className="h-full rounded-r-full"
                style={{
                  width: `${Math.min(100, Math.max(3, item.progressPercent))}%`,
                  background: 'var(--color-progress, linear-gradient(90deg, var(--color-primary), var(--color-secondary)))',
                  boxShadow: '0 0 6px var(--color-progress, var(--color-primary))',
                }}
              />
            </div>
          )}
        </div>
        <div className="p-2">
          <p className="text-xs font-medium text-default truncate">{item.showName}</p>
          <p className="text-[11px] text-muted truncate">
            {item.nextEpisode
              ? `${item.resume ? 'Resume ' : ''}S${String(item.nextEpisode.season).padStart(2, '0')}E${String(item.nextEpisode.episode).padStart(2, '0')}${item.nextEpisode.title ? ` · ${item.nextEpisode.title}` : ''}`
              : `Resume${item.progressPercent != null ? ` · ${item.progressPercent}% watched` : ''}`}
          </p>
          <div className="flex items-center gap-1 mt-0.5">
            <p className="text-[10px] text-subtle truncate">{item.username}</p>
            {item.providerType && (
              <Badge variant={providerBadgeVariant(item)} size="sm" className="shrink-0">
                {providerTypeLabel(item.providerType)}
              </Badge>
            )}
          </div>
        </div>
      </div>

      {/* Now redundant with the card's own default click (which opens this
          same modal), since only the play button navigates away - kept as a
          visible, explicit affordance for "view details" rather than
          removing it, and still useful as the one spot that works even if
          the play button's target changes. stopPropagation avoids also
          re-firing the card's own onClick behind it. */}
      {item.appUrl && (
        <button
          type="button"
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            onOpenDetails(item);
          }}
          title="View details"
          aria-label="View details"
          className="absolute top-1.5 right-1.5 z-10 p-1.5 rounded-md transition-colors"
          style={{ color: 'white', background: 'rgba(0,0,0,0.6)' }}
        >
          <InformationCircleIcon className="w-5 h-5" />
        </button>
      )}

      <ContextMenu isOpen={isMenuOpen} position={position} onClose={() => onMenuOpenChange(false, `${item.userId}-${item.showId}`)}>
        <button
          onClick={() => {
            onMenuOpenChange(false, `${item.userId}-${item.showId}`);
            onRemove(item);
            if (removalMessage !== null) toast.success(removalMessage || `Removed "${item.showName}" - it rests in the Graveyard now (Activity -> Graveyard). Digging it up there brings it back here.`);
          }}
          className="w-full flex items-center gap-2 px-3 py-2 text-sm text-default hover:bg-surface-hover transition-colors"
        >
          <XCircleIcon className="w-4 h-4" />
          Remove from Continue Watching
        </button>
      </ContextMenu>
    </div>
  );
});

