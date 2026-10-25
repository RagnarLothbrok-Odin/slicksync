"use client";

import { XMarkIcon } from "@heroicons/react/24/outline";
import { animate, motion, type PanInfo, useMotionValue, useTransform } from "framer-motion";
import { type ReactNode, useRef } from "react";

// How far (share of the row's width) or how hard a row has to be pushed
// left before letting go dismisses it; anything less springs back.
const DISMISS_SHARE = 0.35;
const FLICK_SPEED = 500;
const FLICK_MIN_DISTANCE = 40;

// A row that a phone user drags left to dismiss, the way phone notifications
// work. Disabled, it renders its children untouched, so a computer or TV
// keeps whatever button the row already has.
export function SwipeToDismiss({
    enabled,
    onDismiss,
    children,
}: {
    enabled: boolean;
    onDismiss: () => void;
    children: ReactNode;
}) {
    const x = useMotionValue(0);
    const rowRef = useRef<HTMLDivElement>(null);
    const dragged = useRef(false);
    const leaving = useRef(false);
    // The "Dismiss" label underneath fades in as the row moves aside.
    const revealOpacity = useTransform(x, [-72, -12, 0], [1, 0, 0]);

    if (!enabled) {
        return <>{children}</>;
    }

    const onDragEnd = async (_e: unknown, info: PanInfo) => {
        const row = rowRef.current;
        const width = row?.offsetWidth || 320;
        const far = info.offset.x < -width * DISMISS_SHARE;
        const flicked = info.velocity.x < -FLICK_SPEED && info.offset.x < -FLICK_MIN_DISTANCE;
        if (!(row && (far || flicked))) {
            animate(x, 0, { damping: 40, stiffness: 500, type: "spring" });
            return;
        }
        leaving.current = true;
        // Slide out, then close the gap, so the rows below move up rather than
        // jumping into the space.
        await animate(x, -width, { duration: 0.18, ease: "easeOut" });
        await animate(row, { height: [row.offsetHeight, 0] }, { duration: 0.16, ease: "easeOut" });
        onDismiss();
    };

    return (
        <div className="relative overflow-hidden" ref={rowRef}>
            <motion.div
                aria-hidden="true"
                className="absolute inset-0 flex items-center justify-end gap-1.5 pr-5 font-medium text-xs"
                style={{
                    background: "var(--color-error-muted)",
                    color: "var(--color-error)",
                    opacity: revealOpacity,
                }}
            >
                <XMarkIcon className="h-4 w-4" />
                Dismiss
            </motion.div>
            <motion.div
                className="relative"
                drag="x"
                // Left is unbounded so the row follows the finger; it can't be
                // pushed right at all.
                dragConstraints={{ right: 0 }}
                dragDirectionLock
                dragElastic={0}
                dragMomentum={false}
                // A swipe that ends over the row mustn't also count as a tap on it.
                onClickCapture={(e) => {
                    if (dragged.current || leaving.current) {
                        e.stopPropagation();
                        e.preventDefault();
                    }
                }}
                onDragEnd={onDragEnd}
                onDragStart={() => {
                    dragged.current = true;
                }}
                onPointerDown={() => {
                    dragged.current = false;
                }}
                // Solid underneath, so a read row (transparent background) doesn't
                // show the label through it. Vertical swipes still scroll the list.
                style={{ background: "var(--color-surface)", touchAction: "pan-y", x }}
            >
                {children}
            </motion.div>
        </div>
    );
}
