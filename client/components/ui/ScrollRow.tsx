"use client";

import { useCallback, useEffect, useState } from "react";
import { useDragScroll } from "@/lib/hooks/useDragScroll";

/**
 * A row that scrolls sideways with no scroll bar: drag it with the mouse,
 * swipe it on touch, and its edges fade wherever there's more to see.
 * Takes the same classes the row's own div had (flex, gap, padding).
 */
export function ScrollRow({
    className = "",
    wrapperClassName = "",
    arrows = false,
    children,
    ...rest
}: React.HTMLAttributes<HTMLDivElement> & {
    /** Small arrow buttons at a faded edge, for a row whose hidden part should
     *  be one click away (tabs). Off for poster and chip rows. */
    arrows?: boolean;
    /** Classes for the box around the row when arrows are on. */
    wrapperClassName?: string;
}) {
    const { ref: rowRef, handlers } = useDragScroll();
    const [edges, setEdges] = useState({ left: false, right: false });

    const measure = useCallback(() => {
        const el = rowRef.current;
        if (!el) {
            return;
        }
        const left = el.scrollLeft > 2;
        const right = el.scrollLeft + el.clientWidth < el.scrollWidth - 2;
        setEdges((prev) => (prev.left === left && prev.right === right ? prev : { left, right }));
    }, [rowRef]);

    useEffect(() => {
        const el = rowRef.current;
        if (!el) {
            return;
        }
        const resize = new ResizeObserver(measure);
        resize.observe(el);
        el.addEventListener("scroll", measure, { passive: true });
        return () => {
            resize.disconnect();
            el.removeEventListener("scroll", measure);
        };
    }, [rowRef, measure]);

    // Children coming and going change how far the row scrolls without
    // resizing it.
    useEffect(measure);

    const slide = (dir: 1 | -1) => {
        const el = rowRef.current;
        if (el) {
            el.scrollBy({ behavior: "smooth", left: dir * Math.max(120, el.clientWidth * 0.6) });
        }
    };

    const row = (
        <div
            {...rest}
            ref={rowRef}
            {...handlers}
            className={`scroll-row ${className}`}
            data-fade-left={edges.left || undefined}
            data-fade-right={edges.right || undefined}
            // A link or poster dragged out of the row would start the browser's
            // own drag-and-drop instead of scrolling it.
            onDragStart={(e) => e.preventDefault()}
        >
            {children}
        </div>
    );

    if (!arrows) {
        return row;
    }

    const arrowClass =
        "absolute top-1/2 -translate-y-1/2 z-20 w-5 h-5 rounded-full flex items-center justify-center bg-primary text-white shadow-sm hover:brightness-110 transition-opacity";
    return (
        <div className={`relative min-w-0 ${wrapperClassName}`}>
            {row}
            {/* tabIndex -1: the tabs themselves are what keyboard and D-pad move
          between, and focusing one scrolls it into view. */}
            <button
                aria-label="Scroll left"
                className={`${arrowClass} left-1 ${edges.left ? "opacity-100" : "pointer-events-none opacity-0"}`}
                onClick={() => slide(-1)}
                tabIndex={-1}
                type="button"
            >
                <svg aria-hidden="true" className="h-2.5 w-2.5" viewBox="0 0 8 8">
                    <path
                        d="M5 1.5 2.5 4 5 6.5"
                        fill="none"
                        stroke="currentColor"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth="1.6"
                    />
                </svg>
            </button>
            <button
                aria-label="Scroll right"
                className={`${arrowClass} right-1 ${edges.right ? "opacity-100" : "pointer-events-none opacity-0"}`}
                onClick={() => slide(1)}
                tabIndex={-1}
                type="button"
            >
                <svg aria-hidden="true" className="h-2.5 w-2.5" viewBox="0 0 8 8">
                    <path
                        d="M3 1.5 5.5 4 3 6.5"
                        fill="none"
                        stroke="currentColor"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth="1.6"
                    />
                </svg>
            </button>
        </div>
    );
}
