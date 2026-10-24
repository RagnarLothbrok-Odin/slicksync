"use client";

import { ChevronDownIcon } from "@heroicons/react/24/outline";
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

export interface DropdownSelectOption {
    label: string;
    value: string;
}

interface DropdownSelectProps {
    /** Accessible name, since these rarely have a visible <label>. */
    ariaLabel?: string;
    /** Styling for the trigger button - matches whatever the native <select>
     * it replaces was using, so callers keep their existing look. */
    className?: string;
    onChange: (value: string) => void;
    options: DropdownSelectOption[];
    /** Shown when `value` matches no option (rare - most callers include an
     * explicit "all"/empty option in `options` instead). */
    placeholder?: string;
    value: string;
}

// Compact inline picker (a filter pill, a toolbar control) that replaces a
// native <select> with one rendered in the page instead of by the OS.
//
// Distinct from the form-field `Select` in Input.tsx, which is a full-width
// labelled field with error states for use inside forms. That one still
// wraps a native <select> and has the same OS-popup behavior described
// below; it can be migrated onto this component later, which would fix
// every form dropdown in the app at once.
//
// Why this exists: a native <select> popup is an OS-level window whose
// position the page cannot influence. Confirmed live in Firefox on this app -
// the genre picker's popup alternated between opening below the trigger and
// floating up near the top of the window, because the trigger sits inside a
// framer-motion section (a transform ancestor creates a containing block) on
// a page whose height was changing underneath it. Native popups also ignore
// the app's theming, which previously rendered options white-on-white.
//
// The panel is portaled to <body> and positioned `fixed` from the trigger's
// own rect, for two independent reasons: the trigger sits inside a glass
// panel with `overflow-hidden` (an absolutely-positioned panel would be
// clipped by it), and transform ancestors would otherwise shift a plain
// absolute panel too.
//
// It ONLY ever opens downward - never flipping above the trigger, which is
// the behavior being replaced. When there isn't room below, the panel is
// capped to the space available and scrolls internally instead, so a long
// list stays fully reachable without the panel ever moving somewhere
// unexpected.
const VIEWPORT_MARGIN = 8;
const MIN_PANEL_HEIGHT = 120;
const MAX_PANEL_HEIGHT = 320;
const MIN_PANEL_WIDTH = 180;

interface PanelRect {
    left: number;
    maxHeight: number;
    top: number;
    width: number;
}

export function DropdownSelect({
    value,
    onChange,
    options,
    ariaLabel,
    className,
    placeholder,
}: DropdownSelectProps) {
    const [isOpen, setIsOpen] = useState(false);
    const [rect, setRect] = useState<PanelRect | null>(null);
    const [activeIndex, setActiveIndex] = useState(-1);
    const triggerRef = useRef<HTMLButtonElement>(null);
    const panelRef = useRef<HTMLDivElement>(null);

    const selected = options.find((o) => o.value === value);

    const measure = useCallback(() => {
        const el = triggerRef.current;
        if (!el) {
            return null;
        }
        const r = el.getBoundingClientRect();
        // Space between the trigger's bottom edge and the viewport bottom is the
        // entire budget - opening upward is deliberately not an option.
        const available = window.innerHeight - r.bottom - VIEWPORT_MARGIN * 2;
        const width = Math.max(r.width, MIN_PANEL_WIDTH);
        return {
            left: Math.min(
                Math.max(VIEWPORT_MARGIN, r.left),
                window.innerWidth - width - VIEWPORT_MARGIN
            ),
            maxHeight: Math.max(MIN_PANEL_HEIGHT, Math.min(MAX_PANEL_HEIGHT, available)),
            top: r.bottom + 4,
            width,
        };
    }, []);

    useEffect(() => {
        if (!isOpen) {
            return;
        }

        // Stay glued to the trigger while the page moves. rAF-throttled: scroll
        // fires far more often than the panel can usefully move, and doing layout
        // reads on every event is what makes this kind of component janky.
        let raf = 0;
        const reposition = () => {
            cancelAnimationFrame(raf);
            raf = requestAnimationFrame(() => {
                const el = triggerRef.current;
                if (!el) {
                    return;
                }
                const r = el.getBoundingClientRect();
                // Trigger scrolled out of view - keeping a floating panel anchored to
                // an invisible element is exactly the "menu in the wrong place" this
                // component exists to prevent.
                if (r.bottom < 0 || r.top > window.innerHeight) {
                    setIsOpen(false);
                    return;
                }
                setRect(measure());
            });
        };

        const onPointerDown = (e: Event) => {
            const t = e.target as Node;
            if (triggerRef.current?.contains(t) || panelRef.current?.contains(t)) {
                return;
            }
            setIsOpen(false);
        };

        const onKey = (e: KeyboardEvent) => {
            if (e.key === "Escape") {
                setIsOpen(false);
                triggerRef.current?.focus();
            }
        };

        window.addEventListener("scroll", reposition, true);
        window.addEventListener("resize", reposition);
        document.addEventListener("mousedown", onPointerDown);
        document.addEventListener("touchstart", onPointerDown);
        document.addEventListener("keydown", onKey);
        return () => {
            cancelAnimationFrame(raf);
            window.removeEventListener("scroll", reposition, true);
            window.removeEventListener("resize", reposition);
            document.removeEventListener("mousedown", onPointerDown);
            document.removeEventListener("touchstart", onPointerDown);
            document.removeEventListener("keydown", onKey);
        };
    }, [isOpen, measure]);

    // Keep the highlighted row in view when arrowing through a capped-height
    // list (and when opening straight onto a selection far down the list).
    useEffect(() => {
        if (!isOpen || activeIndex < 0) {
            return;
        }
        const node = panelRef.current?.querySelector<HTMLElement>(`[data-index="${activeIndex}"]`);
        node?.scrollIntoView({ block: "nearest" });
    }, [isOpen, activeIndex]);

    const commit = (v: string) => {
        onChange(v);
        setIsOpen(false);
        triggerRef.current?.focus();
    };

    // Position is measured here rather than in an effect after opening: the
    // trigger's rect is already available at click time, so the panel's first
    // painted frame is its final one - no reflow, and no state written from
    // inside an effect.
    const open = () => {
        setRect(measure());
        setActiveIndex(
            Math.max(
                0,
                options.findIndex((o) => o.value === value)
            )
        );
        setIsOpen(true);
    };

    const onTriggerKeyDown = (e: React.KeyboardEvent) => {
        if (!isOpen) {
            if (e.key === "ArrowDown" || e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                open();
            }
            return;
        }
        if (e.key === "ArrowDown") {
            e.preventDefault();
            setActiveIndex((i) => Math.min(options.length - 1, i + 1));
        } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setActiveIndex((i) => Math.max(0, i - 1));
        } else if (e.key === "Home") {
            e.preventDefault();
            setActiveIndex(0);
        } else if (e.key === "End") {
            e.preventDefault();
            setActiveIndex(options.length - 1);
        } else if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            if (options[activeIndex]) {
                commit(options[activeIndex].value);
            }
        }
    };

    return (
        <>
            <button
                aria-expanded={isOpen}
                aria-haspopup="listbox"
                aria-label={ariaLabel}
                className={className}
                onClick={() => (isOpen ? setIsOpen(false) : open())}
                onKeyDown={onTriggerKeyDown}
                ref={triggerRef}
                type="button"
            >
                <span className="truncate">{selected?.label ?? placeholder ?? ""}</span>
                <ChevronDownIcon
                    aria-hidden="true"
                    className={`h-4 w-4 shrink-0 transition-transform duration-200 ${isOpen ? "rotate-180" : ""}`}
                />
            </button>

            {isOpen &&
                rect &&
                typeof document !== "undefined" &&
                createPortal(
                    <div
                        aria-label={ariaLabel}
                        className="overflow-y-auto overscroll-contain rounded-lg py-1 shadow-xl"
                        ref={panelRef}
                        role="listbox"
                        style={{
                            background: "var(--color-surface)",
                            border: "1px solid var(--color-surface-border)",
                            left: rect.left,
                            maxHeight: rect.maxHeight,
                            position: "fixed",
                            top: rect.top,
                            width: rect.width,
                            // Above the app's own layered chrome (modals sit at z-50).
                            zIndex: 60,
                        }}
                    >
                        {options.map((opt, i) => {
                            const isSelected = opt.value === value;
                            const isActive = i === activeIndex;
                            return (
                                <button
                                    aria-selected={isSelected}
                                    className={`w-full truncate px-3 py-2 text-left text-sm transition-colors ${isActive ? "row-hl" : ""}`}
                                    data-index={i}
                                    key={opt.value}
                                    onClick={() => commit(opt.value)}
                                    onMouseEnter={() => setActiveIndex(i)}
                                    role="option"
                                    style={{
                                        color: isSelected
                                            ? "var(--color-primary)"
                                            : "var(--color-text)",
                                        fontWeight: isSelected ? 600 : 400,
                                    }}
                                    type="button"
                                >
                                    {opt.label}
                                </button>
                            );
                        })}
                    </div>,
                    document.body
                )}
        </>
    );
}
