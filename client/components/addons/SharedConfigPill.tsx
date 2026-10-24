"use client";

import { LinkIcon } from "@heroicons/react/24/outline";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { joinNames, type SharedPeer } from "@/lib/sharedConfig";

const POPUP_WIDTH = 288; // px
const EDGE = 8; // px kept clear of the screen edge

/**
 * "Shared settings" on an addon whose install link opens the same saved
 * configuration as another addon's (lib/sharedConfig.ts). Clicking it opens
 * a small popup at the pill naming the others. The popup is drawn on its own
 * layer so a card's clipping can't cut it, kept inside the screen, and opens
 * upward when there's no room below. On TV it is a plain label - the addon's
 * own page says the same thing in full.
 */
export function SharedConfigPill({
    peers,
    kind = "",
    isTV = false,
    className = "",
}: {
    peers: SharedPeer[];
    kind?: string;
    isTV?: boolean;
    className?: string;
}) {
    const [open, setOpen] = useState(false);
    const [place, setPlace] = useState<{
        left: number;
        width: number;
        top?: number;
        bottom?: number;
    } | null>(null);
    const buttonRef = useRef<HTMLButtonElement>(null);
    const popupRef = useRef<HTMLDivElement>(null);

    // Placed from the pill when it opens; scrolling or resizing closes it.
    const toggle = () => {
        if (open || !buttonRef.current) {
            setOpen(false);
            return;
        }
        const r = buttonRef.current.getBoundingClientRect();
        const width = Math.min(POPUP_WIDTH, window.innerWidth - EDGE * 2);
        const left = Math.min(Math.max(r.left, EDGE), window.innerWidth - width - EDGE);
        const roomBelow = window.innerHeight - r.bottom;
        setPlace(
            roomBelow > 220 || roomBelow > r.top
                ? { left, top: r.bottom + 8, width }
                : { bottom: window.innerHeight - r.top + 8, left, width }
        );
        setOpen(true);
    };

    useEffect(() => {
        if (!open) {
            return;
        }
        const close = (e: Event) => {
            const t = e.target as Node;
            if (buttonRef.current?.contains(t) || popupRef.current?.contains(t)) {
                return;
            }
            setOpen(false);
        };
        const shut = () => setOpen(false);
        const onKey = (e: KeyboardEvent) => {
            if (e.key === "Escape") {
                setOpen(false);
            }
        };
        document.addEventListener("mousedown", close);
        document.addEventListener("touchstart", close);
        document.addEventListener("keydown", onKey);
        window.addEventListener("resize", shut);
        window.addEventListener("scroll", shut, true);
        return () => {
            document.removeEventListener("mousedown", close);
            document.removeEventListener("touchstart", close);
            document.removeEventListener("keydown", onKey);
            window.removeEventListener("resize", shut);
            window.removeEventListener("scroll", shut, true);
        };
    }, [open]);

    if (!peers.length) {
        return null;
    }
    const names = joinNames(peers.map((p) => p.name));
    const pillClass =
        "inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium text-warning hover:brightness-125";
    // Faded amber is mixed inline: the /15 shorthand doesn't render with this theme's colour variables.
    const pillStyle = { background: "color-mix(in srgb, var(--color-warning) 15%, transparent)" };

    if (isTV) {
        return (
            <span
                className={`${pillClass} ${className}`}
                style={pillStyle}
                title={`Same settings as ${names}`}
            >
                <LinkIcon className="h-3 w-3" />
                Shared settings
            </span>
        );
    }

    // The card around this opens the addon on click and starts drags on
    // press, so the pill and its popup keep their own clicks.
    const keep = (e: React.SyntheticEvent) => e.stopPropagation();

    return (
        <span
            className={`inline-flex ${className}`}
            onClick={keep}
            onContextMenu={keep}
            onMouseDown={keep}
            onPointerDown={keep}
        >
            <button
                aria-expanded={open}
                aria-haspopup="dialog"
                className={`${pillClass} transition`}
                onClick={(e) => {
                    e.preventDefault();
                    toggle();
                }}
                ref={buttonRef}
                style={pillStyle}
                type="button"
            >
                <LinkIcon className="h-3 w-3" />
                Shared settings
            </button>
            {open &&
                place &&
                typeof document !== "undefined" &&
                createPortal(
                    <div
                        className="rounded-xl border bg-surface p-3 text-left text-default text-xs leading-relaxed shadow-lg"
                        onClick={keep}
                        onMouseDown={keep}
                        onPointerDown={keep}
                        ref={popupRef}
                        role="dialog"
                        style={{
                            borderColor:
                                "color-mix(in srgb, var(--color-warning) 45%, transparent)",
                            bottom: place.bottom,
                            left: place.left,
                            position: "fixed",
                            top: place.top,
                            width: place.width,
                            zIndex: 60,
                        }}
                    >
                        <p>
                            <span className="font-semibold">
                                Same {kind ? `${kind} ` : ""}configuration as {names}.
                            </span>{" "}
                            Changing its settings changes{" "}
                            {peers.length > 1 ? "all of them" : "both"}.
                        </p>
                        <div className="mt-2 flex flex-wrap gap-1.5">
                            {peers.map((p) => (
                                <Link
                                    className="rounded-lg bg-surface-hover px-2 py-1 transition-colors hover:text-primary"
                                    href={`/addons/${p.id}`}
                                    key={p.id}
                                    onClick={() => setOpen(false)}
                                >
                                    Open {p.name}
                                </Link>
                            ))}
                        </div>
                        <p className="mt-2 text-muted">
                            To keep them apart, save it as a new configuration and paste the new
                            link under Manifest URL on one of them.
                        </p>
                    </div>,
                    document.body
                )}
        </span>
    );
}
