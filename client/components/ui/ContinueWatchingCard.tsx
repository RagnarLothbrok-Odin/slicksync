"use client";

import { InformationCircleIcon, PlayIcon, XCircleIcon } from "@heroicons/react/24/outline";
import { memo, useRef, useState } from "react";
import type { ContinueWatchingItem } from "@/lib/api";
import { cachedImageUrl } from "@/lib/posterUrl";
import { providerBadgeVariant, providerTypeLabel } from "@/lib/providers";
import { Badge } from "./Badge";
import { ContextMenu, useContextMenu } from "./ContextMenu";
import { toast } from "./Toast";

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
export const ContinueWatchingCard = memo(function ContinueWatchingCardLocal({
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
    const artwork = [
        ...new Set(
            [item.nextEpisode?.thumbnail, item.background, item.poster].filter(
                (url): url is string => !!url
            )
        ),
    ];
    const artworkKey = artwork.join("|");
    const [failedArtwork, setFailedArtwork] = useState<{ key: string; count: number }>({
        count: 0,
        key: "",
    });
    const artworkIndex = failedArtwork.key === artworkKey ? failedArtwork.count : 0;
    const artworkUrl = artwork[artworkIndex];
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
        if (pressTimer.current) {
            clearTimeout(pressTimer.current);
            pressTimer.current = null;
        }
        startPos.current = null;
    };
    const handleTouchStart = (e: React.TouchEvent) => {
        const t = e.touches[0];
        if (!t) {
            return;
        }
        startPos.current = { x: t.clientX, y: t.clientY };
        pressTimer.current = setTimeout(() => {
            handleContextMenu(e as unknown as Event, t.clientX, t.clientY);
            onMenuOpenChange(true, `${item.userId}-${item.showId}`);
            pressTimer.current = null;
        }, 500);
    };
    const handleTouchMove = (e: React.TouchEvent) => {
        if (!(startPos.current && pressTimer.current)) {
            return;
        }
        const t = e.touches[0];
        if (!t) {
            return;
        }
        const dx = Math.abs(t.clientX - startPos.current.x);
        const dy = Math.abs(t.clientY - startPos.current.y);
        if (dx > 10 || dy > 10) {
            clearPress();
        }
    };

    return (
        <div
            className="relative shrink-0"
            onContextMenu={(e) => {
                handleContextMenu(e);
                onMenuOpenChange(true, `${item.userId}-${item.showId}`);
            }}
            onTouchCancel={clearPress}
            onTouchEnd={clearPress}
            onTouchMove={handleTouchMove}
            onTouchStart={handleTouchStart}
        >
            <div
                className="group tap-card relative block w-40 cursor-pointer select-none overflow-hidden rounded-xl bg-slate-800 shadow-lg"
                draggable={false}
                onClick={() => {
                    // Suppress the click that fires immediately after a long-press
                    // opens the menu - otherwise a long-press both opens the menu AND
                    // the detail modal as soon as the finger lifts.
                    if (wasDraggedRef.current || isMenuOpen) {
                        return;
                    }
                    onOpenDetails(item);
                }}
                onDragStart={(e) => e.preventDefault()}
            >
                <div className="relative aspect-video">
                    {/* Image priority for this landscape (16:9) frame: episode still
              first (already 16:9), then the show/movie's landscape backdrop,
              and only then the portrait poster as a last resort - a portrait
              poster forced into a 16:9 frame is what caused the "too zoomed
              in" hard crop. */}
                    {artworkUrl ? (
                        <img
                            alt={item.showName}
                            className="pointer-events-none h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
                            decoding="async"
                            draggable={false}
                            fetchPriority={priority ? "high" : undefined}
                            height={360}
                            loading={priority ? "eager" : "lazy"}
                            onError={() =>
                                setFailedArtwork({ count: artworkIndex + 1, key: artworkKey })
                            }
                            // Through the server's image cache at the card's size, like
                            // every poster grid - not the full-size original each launch.
                            src={(cacheImages ? cachedImageUrl(artworkUrl) : artworkUrl) || ""}
                            width={640}
                        />
                    ) : (
                        <div className="flex h-full w-full items-center justify-center bg-slate-800">
                            <PlayIcon className="h-8 w-8 text-slate-600" />
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
                        aria-label={`Resume ${item.showName}`}
                        className="absolute inset-0 flex items-center justify-center opacity-0 transition-opacity group-hover:opacity-100"
                        href={item.appUrl || item.webUrl}
                        onClick={(e) => {
                            e.stopPropagation();
                            if (wasDraggedRef.current || isMenuOpen) {
                                e.preventDefault();
                            }
                        }}
                        rel={item.appUrl ? undefined : "noopener noreferrer"}
                        style={{ background: "rgba(0,0,0,0.4)" }}
                        target={item.appUrl ? undefined : "_blank"}
                    >
                        <PlayIcon className="h-8 w-8 text-white" />
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
                        <div
                            className="pointer-events-none absolute right-0 bottom-0 left-0 h-1.5"
                            style={{ background: "rgba(0,0,0,0.55)" }}
                        >
                            <div
                                className="h-full rounded-r-full"
                                style={{
                                    background:
                                        "var(--color-progress, linear-gradient(90deg, var(--color-primary), var(--color-secondary)))",
                                    boxShadow:
                                        "0 0 6px var(--color-progress, var(--color-primary))",
                                    width: `${Math.min(100, Math.max(3, item.progressPercent))}%`,
                                }}
                            />
                        </div>
                    )}
                </div>
                <div className="p-2">
                    <p className="truncate font-medium text-default text-xs">{item.showName}</p>
                    <p className="truncate text-[11px] text-muted">
                        {item.nextEpisode
                            ? `${item.resume ? "Resume " : ""}S${String(item.nextEpisode.season).padStart(2, "0")}E${String(item.nextEpisode.episode).padStart(2, "0")}${item.nextEpisode.title ? ` · ${item.nextEpisode.title}` : ""}`
                            : `Resume${item.progressPercent === null ? "" : ` · ${item.progressPercent}% watched`}`}
                    </p>
                    <div className="mt-0.5 flex items-center gap-1">
                        <p className="truncate text-[10px] text-subtle">{item.username}</p>
                        {item.providerType && (
                            <Badge
                                className="shrink-0"
                                size="sm"
                                variant={providerBadgeVariant(item)}
                            >
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
                    aria-label="View details"
                    className="absolute top-1.5 right-1.5 z-10 rounded-md p-1.5 transition-colors"
                    onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        onOpenDetails(item);
                    }}
                    style={{ background: "rgba(0,0,0,0.6)", color: "white" }}
                    title="View details"
                    type="button"
                >
                    <InformationCircleIcon className="h-5 w-5" />
                </button>
            )}

            <ContextMenu
                isOpen={isMenuOpen}
                onClose={() => onMenuOpenChange(false, `${item.userId}-${item.showId}`)}
                position={position}
            >
                <button
                    className="flex w-full items-center gap-2 px-3 py-2 text-default text-sm transition-colors hover:bg-surface-hover"
                    onClick={() => {
                        onMenuOpenChange(false, `${item.userId}-${item.showId}`);
                        onRemove(item);
                        if (removalMessage !== null) {
                            toast.success(
                                removalMessage ||
                                    `Removed "${item.showName}" - it rests in the Graveyard now (Activity -> Graveyard). Digging it up there brings it back here.`
                            );
                        }
                    }}
                    type="button"
                >
                    <XCircleIcon className="h-4 w-4" />
                    Remove from Continue Watching
                </button>
            </ContextMenu>
        </div>
    );
});
