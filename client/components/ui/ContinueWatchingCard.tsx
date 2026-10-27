"use client";

import {
    InformationCircleIcon,
    PlayIcon,
    UserIcon,
    XCircleIcon,
} from "@heroicons/react/24/outline";
import { memo, useRef, useState } from "react";
import type { ContinueWatchingItem } from "@/lib/api";
import { cachedImageUrl } from "@/lib/posterUrl";
import { providerTypeLabel } from "@/lib/providers";
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
            role="none"
        >
            <div
                className="group tap-card relative isolate aspect-[5/3] w-72 select-none overflow-hidden rounded-2xl border border-white/10 bg-slate-900 shadow-lg sm:w-80"
                draggable={false}
                onDragStart={(e) => e.preventDefault()}
                role="none"
            >
                {/* Episode stills take priority, with series artwork as a fallback. */}
                {artworkUrl ? (
                    /* biome-ignore lint/a11y/noNoninteractiveElementInteractions: Image failures select fallback artwork. */
                    <img
                        alt=""
                        className="pointer-events-none absolute inset-0 h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.03] motion-reduce:transform-none motion-reduce:transition-none"
                        decoding="async"
                        draggable={false}
                        fetchPriority={priority ? "high" : undefined}
                        height={384}
                        loading={priority ? "eager" : "lazy"}
                        onError={() =>
                            setFailedArtwork({ count: artworkIndex + 1, key: artworkKey })
                        }
                        src={(cacheImages ? cachedImageUrl(artworkUrl) : artworkUrl) || ""}
                        width={640}
                    />
                ) : (
                    <PlayIcon
                        aria-hidden="true"
                        className="absolute top-6 left-6 h-8 w-8 text-white/30"
                    />
                )}
                <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(180deg,transparent_15%,rgba(8,12,20,0.3)_40%,rgba(8,12,20,0.92)_75%,#111827_100%)]" />
                <button
                    aria-label={`Details for ${item.showName}`}
                    className="absolute inset-0 z-10 cursor-pointer rounded-[inherit] border-0 bg-transparent p-0 focus-visible:outline-2 focus-visible:outline-primary focus-visible:-outline-offset-2"
                    onClick={() => {
                        if (!(wasDraggedRef.current || isMenuOpen)) {
                            onOpenDetails(item);
                        }
                    }}
                    type="button"
                />
                {/* A native link preserves reliable app-scheme navigation. */}
                <a
                    aria-label={`Resume ${item.showName}`}
                    className="absolute top-3 left-3 z-20 flex h-11 w-11 items-center justify-center rounded-full border border-white/20 bg-black/40 text-white opacity-0 transition-opacity hover:bg-black/70 focus-visible:opacity-100 focus-visible:outline-2 focus-visible:outline-primary group-hover:opacity-100 motion-reduce:transition-none [@media(hover:none)]:opacity-100"
                    href={item.appUrl || item.webUrl}
                    onClick={(e) => {
                        e.stopPropagation();
                        if (wasDraggedRef.current || isMenuOpen) {
                            e.preventDefault();
                        }
                    }}
                    rel={item.appUrl ? undefined : "noopener noreferrer"}
                    target={item.appUrl ? undefined : "_blank"}
                >
                    <PlayIcon aria-hidden="true" className="h-5 w-5" />
                </a>
                <button
                    aria-label={`View details for ${item.showName}`}
                    className="absolute top-3 right-3 z-20 flex h-9 w-9 items-center justify-center rounded-full border border-white/50 bg-black/35 text-white transition-colors hover:bg-white/20 focus-visible:outline-2 focus-visible:outline-primary active:bg-white/30"
                    onClick={() => {
                        if (!(wasDraggedRef.current || isMenuOpen)) {
                            onOpenDetails(item);
                        }
                    }}
                    type="button"
                >
                    <InformationCircleIcon aria-hidden="true" className="h-6 w-6" />
                </button>
                <div className="pointer-events-none absolute right-4 bottom-3 left-4 text-white">
                    <p className="truncate font-semibold text-base tracking-tight">
                        {item.showName}
                    </p>
                    <p className="mt-0.5 truncate text-white/70 text-xs">
                        {item.nextEpisode
                            ? `S${String(item.nextEpisode.season).padStart(2, "0")}E${String(item.nextEpisode.episode).padStart(2, "0")}${item.nextEpisode.title ? ` · ${item.nextEpisode.title}` : ""}`
                            : "Resume watching"}
                    </p>
                    {/* Only saved playback has a meaningful completion percentage. */}
                    {item.resume &&
                        item.progressPercent != null &&
                        Number.isFinite(item.progressPercent) && (
                            <div className="mt-2 flex items-center gap-3">
                                <div
                                    aria-label="Watched"
                                    aria-valuemax={100}
                                    aria-valuemin={0}
                                    aria-valuenow={Math.round(
                                        Math.min(100, Math.max(0, item.progressPercent))
                                    )}
                                    className="h-1.5 flex-1 overflow-hidden rounded-full bg-white/15"
                                    role="progressbar"
                                >
                                    <div
                                        className="h-full rounded-full"
                                        style={{
                                            background:
                                                "var(--color-progress, var(--color-primary))",
                                            width: `${Math.min(100, Math.max(0, item.progressPercent))}%`,
                                        }}
                                    />
                                </div>
                                <span className="min-w-8 text-right text-white/65 text-xs tabular-nums">
                                    {Math.round(Math.min(100, Math.max(0, item.progressPercent)))}%
                                </span>
                            </div>
                        )}
                    <div className="mt-2 flex min-w-0 items-center gap-2 text-[11px]">
                        {item.username && (
                            <span className="flex min-w-0 items-center gap-1 rounded-full border border-white/15 bg-white/5 px-2.5 py-1 text-white/65">
                                <UserIcon aria-hidden="true" className="h-3 w-3 shrink-0" />
                                <span className="truncate">{item.username}</span>
                            </span>
                        )}
                        {item.providerType && (
                            <span className="shrink-0 rounded-full border border-primary/20 bg-primary/15 px-3 py-1 text-primary">
                                {providerTypeLabel(item.providerType)}
                            </span>
                        )}
                    </div>
                </div>
            </div>

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
