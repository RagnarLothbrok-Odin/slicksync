"use client";

// What you can do with one cast member, from holding them (phone) or
// right-clicking them (computer): a bubble above and to the right of their
// photo, like a message, with a tail pointing back at them. Kept on screen:
// near the right edge it moves left (the tail still points at the photo),
// and without room above it opens below instead.

import {
    BellIcon,
    BellSlashIcon,
    ChevronDownIcon,
    ChevronUpIcon,
    RectangleStackIcon,
} from "@heroicons/react/24/outline";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

export interface CastMenuTarget {
    /** The held photo's box on screen. */
    anchor: DOMRect;
    character: string | null;
    id: string;
    name: string;
    photo: string | null;
}

export function CastMenu({
    target,
    title,
    follow,
    titlesOpen,
    onClose,
    onSeeEverything,
    onShowHere,
    onFollow,
}: {
    target: CastMenuTarget;
    title: string | null;
    /** Their titles are already showing under the cast: the option hides them. */
    titlesOpen: boolean;
    follow: { muted: boolean } | null;
    onClose: () => void;
    onSeeEverything: () => void;
    onShowHere: () => void;
    onFollow: () => void;
}) {
    const ref = useRef<HTMLDivElement>(null);
    const [place, setPlace] = useState<{
        left: number;
        top: number;
        tail: number;
        below: boolean;
    } | null>(null);

    const fit = useCallback(() => {
        const el = ref.current;
        if (!el) {
            return;
        }
        const pad = 12;
        const vw = document.documentElement.clientWidth || window.innerWidth;
        const vh = window.innerHeight;
        const a = target.anchor;
        const w = el.offsetWidth;
        const h = el.offsetHeight;
        const left = Math.max(pad, Math.min(a.right - 12, vw - w - pad));
        const below = a.top - h - 10 < pad;
        const top = below ? Math.min(a.bottom + 10, vh - h - pad) : a.top - h - 10;
        // The tail aims at the photo's top-right, wherever the bubble ended up.
        const tail = Math.max(14, Math.min(a.right - 22 - left, w - 28));
        setPlace({ below, left, tail, top });
    }, [target.anchor]);
    useLayoutEffect(() => {
        fit();
    }, [fit]);

    useEffect(() => {
        const down = (e: PointerEvent) => {
            if (ref.current && !ref.current.contains(e.target as Node)) {
                onClose();
            }
        };
        const key = (e: KeyboardEvent) => {
            if (e.key === "Escape") {
                onClose();
            }
        };
        // The finger that opened it is still down: listen from the next tick.
        const t = setTimeout(() => {
            document.addEventListener("pointerdown", down);
            window.addEventListener("scroll", onClose, true);
        }, 0);
        document.addEventListener("keydown", key);
        return () => {
            clearTimeout(t);
            document.removeEventListener("pointerdown", down);
            window.removeEventListener("scroll", onClose, true);
            document.removeEventListener("keydown", key);
        };
    }, [onClose]);

    const item =
        "w-full flex items-center gap-3 px-3.5 py-2.5 text-[15px] text-left text-default hover:bg-surface-hover transition-colors";
    const icon = "w-[18px] h-[18px] shrink-0 text-muted";

    return createPortal(
        <div
            className="fixed z-[10000] w-[min(300px,calc(100vw-1.5rem))] select-none rounded-2xl border border-default bg-surface py-1.5 shadow-2xl"
            onContextMenu={(e) => e.preventDefault()}
            ref={ref}
            role="menu"
            style={{
                left: place?.left ?? -9999,
                top: place?.top ?? -9999,
                WebkitTouchCallout: "none",
            }}
        >
            <span
                aria-hidden
                className="absolute h-3.5 w-3.5 border-default bg-surface"
                style={
                    place?.below
                        ? {
                              borderLeftWidth: 1,
                              borderTopWidth: 1,
                              left: place.tail,
                              top: -8,
                              transform: "rotate(45deg)",
                          }
                        : {
                              borderBottomWidth: 1,
                              borderLeftWidth: 1,
                              bottom: -8,
                              left: place?.tail ?? 14,
                              transform: "rotate(-45deg)",
                          }
                }
            />
            <div className="mb-1 flex items-center gap-2.5 border-default border-b px-3.5 pt-2 pb-2.5">
                {target.photo ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                        alt=""
                        className="h-[30px] w-[30px] shrink-0 rounded-full object-cover"
                        height={30}
                        src={target.photo}
                        width={30}
                    />
                ) : (
                    <span className="flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-full bg-surface-hover font-semibold text-muted text-sm">
                        {target.name.charAt(0)}
                    </span>
                )}
                <span className="min-w-0">
                    <span
                        className="block truncate font-semibold text-[14px]"
                        style={{ color: "color-mix(in srgb, var(--color-primary) 45%, #ffffff)" }}
                    >
                        {target.name}
                    </span>
                    {target.character && (
                        <span
                            className="block truncate text-[13px]"
                            style={{
                                color: "color-mix(in srgb, var(--color-text) 78%, transparent)",
                            }}
                        >
                            plays {target.character}
                            {title ? ` in ${title}` : ""}
                        </span>
                    )}
                </span>
            </div>
            <button
                className={item}
                onClick={() => {
                    onClose();
                    onSeeEverything();
                }}
                role="menuitem"
                type="button"
            >
                <RectangleStackIcon className={icon} />
                <span className="min-w-0 truncate">See more about {target.name}</span>
            </button>
            <button
                className={item}
                onClick={() => {
                    onClose();
                    onShowHere();
                }}
                role="menuitem"
                type="button"
            >
                {titlesOpen ? (
                    <ChevronUpIcon className={icon} />
                ) : (
                    <ChevronDownIcon className={icon} />
                )}
                {titlesOpen ? "Hide their titles" : "Show their titles here"}
            </button>
            <div className="my-1 h-px bg-[var(--color-surface-border)]" />
            <button
                className={item}
                onClick={() => {
                    onClose();
                    onFollow();
                }}
                role="menuitem"
                type="button"
            >
                {follow && !follow.muted ? (
                    <BellSlashIcon className={icon} />
                ) : (
                    <BellIcon className={icon} />
                )}
                {/* The name is at the top already, so the options don't repeat it. */}
                <span className="min-w-0">
                    {follow ? (follow.muted ? "Turn alerts back on" : "Mute alerts") : "Follow"}
                    {!follow && (
                        <span className="block text-[12.5px] text-muted leading-snug">
                            Hear when they have something new out
                        </span>
                    )}
                </span>
            </button>
        </div>,
        document.body
    );
}
