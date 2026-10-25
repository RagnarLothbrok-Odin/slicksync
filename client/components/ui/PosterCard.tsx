"use client";

import {
    BookmarkIcon as BookmarkOutlineIcon,
    CheckBadgeIcon,
    EyeIcon,
    EyeSlashIcon,
    FilmIcon,
    HandThumbDownIcon,
    RectangleStackIcon,
    TrashIcon,
    TvIcon,
    XCircleIcon,
} from "@heroicons/react/24/outline";
import { BookmarkIcon as BookmarkSolidIcon } from "@heroicons/react/24/solid";
import { memo, useEffect, useRef, useState } from "react";
import { TVFocusable } from "@/components/tv/TVFocusable";
import { api, type RatingsBatchEntry } from "@/lib/api";
import { useLongPress } from "@/lib/hooks/useLongPress";
import { usePersonalFeatures } from "@/lib/hooks/usePersonalFeatures";
import { isRpdbPoster, posterSrcSet, posterUrl } from "@/lib/posterUrl";
import { CatalogPickerMenu } from "./AddToListButton";
import { ContextMenu, useContextMenu } from "./ContextMenu";
import { RatingBadges } from "./RatingBadges";

// Extracted from Discover's own poster card (originally local/un-exported)
// so Catalogs can share the same watched/watchlist badges + right-click
// quick-action menu instead of duplicating them. Only needs the fields it
// actually renders - callers with a richer item type (Discover's own
// DiscoverItem) pass straight through structurally, no adapter needed.
export interface PosterCardItem {
    id: string;
    imdbRating?: string | null;
    name: string;
    poster: string | null;
    releaseInfo?: string | null;
    type: "movie" | "series";
}

export interface PosterCardProps {
    /** Personal sessions cannot use the admin-authenticated image cache. */
    cacheImages?: boolean;
    /** TV mode: wraps the card in a D-pad-focusable container with a visible
     *  focus ring, Enter/OK opens details the same way a click does. */
    focusable?: boolean;
    /** True when this item is currently saved to the account's watchlist. */
    inWatchlist?: boolean;
    /** Only-one-menu-open-at-a-time state, lifted to the parent so opening
     *  a second card's menu closes the previous card's. */
    isMenuOpen?: boolean;
    item: PosterCardItem;
    /** Identity reported through onMenuOpenChange - defaults to item.id.
     *  Parents rendering the SAME title in multiple sections (For You rows
     *  regularly repeat items, trending overlaps the grid) must scope this
     *  (e.g. `${rowId}:${item.id}`): with a bare item.id, every card sharing
     *  the id believed the menu was ITS OWN open menu, and the duplicates -
     *  having never received click coordinates - rendered a ghost copy of the
     *  menu at the viewport origin. */
    menuKey?: string;
    onMarkNotInterested?: (item: PosterCardItem) => void;
    // Receives this card's own item id as a second argument so the parent can
    // use ONE stable useCallback for every card. Passing an inline
    // `(open) => setOpenMenuKey(open ? item.id : null)` gives each card a fresh
    // function identity on every parent render, which silently defeats the
    // React.memo below - every card in the grid then re-renders on any state
    // change at all, including simply closing a modal.
    onMenuOpenChange?: (open: boolean, itemId: string) => void;
    onOpenDetails: (item: PosterCardItem) => void;
    /** Personal panels supply their own data loader and omit household catalog actions. */
    onPrefetchDetails?: (item: PosterCardItem) => void;
    /** Catalogs-only "remove from this catalog" menu entry - opt-in (undefined
     *  on every other caller, e.g. Discover), so this stays out of the menu
     *  everywhere it isn't relevant. Replaced an always-visible X button that
     *  sat in the same top-right corner as the watched badge above, reading as
     *  a confusing double-icon; long-press/right-click already opens this
     *  same menu, so removal lives there instead. */
    onRemoveFromCatalog?: (item: PosterCardItem) => void;
    /** Flips the watched marker between true and false. */
    onToggleWatched: (item: PosterCardItem, nextWatched: boolean) => void;
    /** Adds or removes from the watchlist based on current state. */
    onToggleWatchlist: (item: PosterCardItem, next: boolean) => void;
    /** One of the first posters on screen: fetched at once, ahead of the rest,
     *  instead of waiting for the browser to work out it is visible. */
    priority?: boolean;
    ratings?: RatingsBatchEntry;
    /** The menu wording for onRemoveFromCatalog - an AIOStreams collection says "Remove from collection". */
    removeLabel?: string;
    showCatalogMenu?: boolean;
    /** SlickTrax feedback - only meaningful on recommendation-style rows. */
    showNotInterested?: boolean;
    showWatchedBadge?: boolean;
    showWatchedMenu?: boolean;
    showWatchlistBadge?: boolean;
    /** When false, hides the corresponding context-menu item + card badge. */
    showWatchlistMenu?: boolean;
    /** True when this account has watch history for this item's id. */
    watched?: boolean;
}

export const PosterCard = memo(function PosterCardLocal({
    item,
    ratings,
    watched,
    inWatchlist,
    onOpenDetails,
    onToggleWatchlist,
    onToggleWatched,
    showWatchlistMenu = true,
    showWatchedMenu = true,
    showWatchedBadge = true,
    showWatchlistBadge = true,
    showNotInterested = false,
    onMarkNotInterested,
    onRemoveFromCatalog,
    removeLabel = "Remove from catalog",
    isMenuOpen,
    onMenuOpenChange,
    menuKey,
    focusable = false,
    priority = false,
    onPrefetchDetails,
    showCatalogMenu = true,
    cacheImages = true,
}: PosterCardProps) {
    const [imageError, setImageError] = useState(false);
    // Timer for the hover prefetch below; cleared on leave and on unmount so
    // a grid that re-renders mid-hover cannot leave one running.
    const prefetchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
    useEffect(
        () => () => {
            if (prefetchTimer.current) {
                clearTimeout(prefetchTimer.current);
            }
        },
        []
    );
    const { rpdbEnabled, enablePosterRatings } = usePersonalFeatures();
    // Right-click menu's "Add to Catalogs" swaps the menu's own content to the
    // catalog picker in place (single-panel nav with a Back row) rather than
    // opening a second flyout - simplest way to fit a multi-catalog picker
    // into a menu that's otherwise plain one-tap toggle buttons.
    const [catalogView, setCatalogView] = useState(false);
    // useContextMenu still owns the position calc + preventDefault, but the
    // OPEN state is driven by the parent's isMenuOpen prop so only one card's
    // menu is visible at a time across the whole grid.
    const {
        position,
        handleContextMenu,
        close: closeInternal,
        setExternalClose,
    } = useContextMenu();
    const controlledOpen = isMenuOpen === true;
    const close = () => {
        closeInternal();
        onMenuOpenChange?.(false, menuKey ?? item.id);
        setCatalogView(false);
    };
    // Registers the REAL close (above) for cross-page/cross-section closing -
    // this card's own isMenuOpen is lifted, so closeInternal alone (this hook's
    // unused-for-rendering internal state) wouldn't actually hide anything.
    setExternalClose(close);
    // onContextMenu alone covers a real desktop right-click, but iOS Safari
    // doesn't reliably synthesize a `contextmenu` DOM event from a touch
    // long-press - this card's Add to Watchlist/Mark as Watched/Not Interested
    // menu was effectively unreachable by holding on iPhone before. See
    // useLongPress's own comment for why this needs a plain JS timer instead.
    const longPress = useLongPress({
        onLongPress: (e, x, y) => {
            handleContextMenu(e, x, y);
            onMenuOpenChange?.(true, menuKey ?? item.id);
        },
    });

    const card = (
        <button
            aria-label={`Details for ${item.name}`}
            className="group tap-card relative w-full cursor-pointer border-0 bg-transparent p-0 text-left"
            onClick={() => {
                // Suppress the click that fires immediately after a long-press
                // opens the menu - otherwise a long-press both opens the menu AND
                // the detail modal as soon as the finger lifts.
                if (controlledOpen) {
                    return;
                }
                onOpenDetails(item);
            }}
            onContextMenu={(e) => {
                handleContextMenu(e);
                onMenuOpenChange?.(true, menuKey ?? item.id);
            }}
            // Hovering a poster starts its detail fetch, so the click that
            // usually follows opens on content instead of a spinner. Mouse only
            // and after a short pause: sweeping the pointer across a grid on the
            // way somewhere else is not interest, and on touch there is no hover
            // at all - firing there would spend someone's data on titles they
            // only scrolled past.
            onPointerEnter={(e) => {
                if (e.pointerType !== "mouse") {
                    return;
                }
                if (prefetchTimer.current) {
                    clearTimeout(prefetchTimer.current);
                }
                prefetchTimer.current = setTimeout(() => {
                    if (onPrefetchDetails) {
                        onPrefetchDetails(item);
                    } else {
                        api.prefetchMediaDetails(item.id, item.type);
                    }
                }, 140);
            }}
            onPointerLeave={() => {
                if (prefetchTimer.current) {
                    clearTimeout(prefetchTimer.current);
                    prefetchTimer.current = null;
                }
            }}
            type="button"
            {...longPress}
        >
            <div className="relative aspect-[2/3] overflow-hidden rounded-xl bg-slate-800 shadow-xl">
                {item.poster && !imageError ? (
                    <>
                        {/* biome-ignore lint/a11y/noNoninteractiveElementInteractions: Image load failures choose fallback artwork; this is not a user action. */}
                        <img
                            alt={item.name}
                            className="h-full w-full object-cover transition-transform duration-700 group-hover:scale-110"
                            decoding="async"
                            fetchPriority={priority ? "high" : undefined}
                            height={450}
                            loading={priority ? "eager" : "lazy"}
                            onError={() => setImageError(true)}
                            sizes="(max-width: 640px) 33vw, (max-width: 1024px) 22vw, 170px"
                            src={
                                cacheImages
                                    ? posterUrl(item, rpdbEnabled)
                                    : item.poster || undefined
                            }
                            // Lets the browser take the 154px file where a card renders
                            // small (most phone grids) instead of always the 342 - fewer
                            // bytes and less decode work per scroll, which is a real part
                            // of scroll cost on phones. `sizes` describes the card's own
                            // rendered width at each breakpoint, matching the grid.
                            srcSet={cacheImages ? posterSrcSet(item, rpdbEnabled) : undefined}
                            width={300}
                        />
                        <div className="absolute inset-0 bg-gradient-to-t from-slate-950/50 to-transparent opacity-40 transition-opacity group-hover:opacity-60" />
                    </>
                ) : (
                    <div className="flex h-full w-full items-center justify-center bg-slate-800">
                        {item.type === "movie" ? (
                            <FilmIcon className="h-12 w-12 text-slate-600" />
                        ) : (
                            <TvIcon className="h-12 w-12 text-slate-600" />
                        )}
                    </div>
                )}

                {/* Watched-status corner badge — subtle checkmark on the top-right so
            you can see at a glance while browsing what you've already seen.
            Layered above the poster's dark gradient so it stays visible on
            both light and dark posters. */}
                {watched && showWatchedBadge && (
                    <div
                        className="absolute top-1.5 right-1.5 flex items-center justify-center rounded-full bg-emerald-500/90 text-white shadow-lg backdrop-blur-sm"
                        style={{ height: 24, width: 24 }}
                        title="You've watched this"
                    >
                        <CheckBadgeIcon className="h-4 w-4" />
                    </div>
                )}

                {/* Watchlist bookmark indicator — smaller than the watched badge and
            in the opposite corner so both can coexist on the same card. */}
                {inWatchlist && showWatchlistBadge && !(watched && showWatchedBadge) && (
                    <div
                        className="absolute top-1.5 left-1.5 flex items-center justify-center rounded-full bg-primary/90 text-white shadow-lg backdrop-blur-sm"
                        style={{ height: 22, width: 22 }}
                        title="In your watchlist"
                    >
                        <BookmarkSolidIcon className="h-3.5 w-3.5" />
                    </div>
                )}

                {enablePosterRatings && !isRpdbPoster(item, rpdbEnabled) && (
                    <div className="absolute right-1.5 bottom-1.5 left-1.5">
                        <RatingBadges
                            imdbRating={item.imdbRating}
                            metacritic={ratings?.metacritic}
                            rottenTomatoes={ratings?.rottenTomatoes}
                        />
                    </div>
                )}
            </div>

            <div className="mt-2 space-y-0.5 text-center">
                <h4 className="line-clamp-2 font-semibold text-slate-300 text-sm leading-tight">
                    {item.name}
                </h4>
                {item.releaseInfo && <p className="text-slate-500 text-xs">{item.releaseInfo}</p>}
            </div>

            {(showWatchlistMenu || showWatchedMenu || showNotInterested || onRemoveFromCatalog) && (
                <ContextMenu isOpen={controlledOpen} onClose={close} position={position}>
                    {catalogView ? (
                        <CatalogPickerMenu
                            item={{
                                id: item.id,
                                name: item.name,
                                poster: item.poster,
                                type: item.type,
                            }}
                            onBack={() => setCatalogView(false)}
                            onDone={close}
                        />
                    ) : (
                        <>
                            {showWatchlistMenu && (
                                <button
                                    className="flex w-full items-center gap-2 px-3 py-2 text-default text-sm transition-colors hover:bg-surface-hover"
                                    onClick={() => {
                                        close();
                                        onToggleWatchlist(item, !inWatchlist);
                                    }}
                                    type="button"
                                >
                                    {inWatchlist ? (
                                        <>
                                            <XCircleIcon className="h-4 w-4" /> Remove from
                                            Watchlist
                                        </>
                                    ) : (
                                        <>
                                            <BookmarkOutlineIcon className="h-4 w-4" /> Add to
                                            Watchlist
                                        </>
                                    )}
                                </button>
                            )}
                            {showCatalogMenu && (
                                <button
                                    className="flex w-full items-center gap-2 px-3 py-2 text-default text-sm transition-colors hover:bg-surface-hover"
                                    onClick={() => setCatalogView(true)}
                                    type="button"
                                >
                                    <RectangleStackIcon className="h-4 w-4" /> Add to Catalogs
                                </button>
                            )}
                            {showWatchedMenu && (
                                <button
                                    className="flex w-full items-center gap-2 px-3 py-2 text-default text-sm transition-colors hover:bg-surface-hover"
                                    onClick={() => {
                                        close();
                                        onToggleWatched(item, !watched);
                                    }}
                                    type="button"
                                >
                                    {watched ? (
                                        <>
                                            <EyeSlashIcon className="h-4 w-4" /> Mark as unwatched
                                        </>
                                    ) : (
                                        <>
                                            <EyeIcon className="h-4 w-4" /> Mark as watched
                                        </>
                                    )}
                                </button>
                            )}
                            {showNotInterested && (
                                <button
                                    className="flex w-full items-center gap-2 px-3 py-2 text-default text-sm transition-colors hover:bg-surface-hover"
                                    onClick={() => {
                                        close();
                                        onMarkNotInterested?.(item);
                                    }}
                                    type="button"
                                >
                                    <HandThumbDownIcon className="h-4 w-4" /> Not interested
                                </button>
                            )}
                            {onRemoveFromCatalog && (
                                <button
                                    className="flex w-full items-center gap-2 px-3 py-2 text-error text-sm transition-colors hover:bg-surface-hover"
                                    onClick={() => {
                                        close();
                                        onRemoveFromCatalog(item);
                                    }}
                                    type="button"
                                >
                                    <TrashIcon className="h-4 w-4" /> {removeLabel}
                                </button>
                            )}
                        </>
                    )}
                </ContextMenu>
            )}
        </button>
    );

    if (!focusable) {
        return card;
    }
    return <TVFocusable onEnterPress={() => onOpenDetails(item)}>{card}</TVFocusable>;
});
