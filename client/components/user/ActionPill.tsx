"use client";

// The buttons in a person's header row that open a popup - Daily limit,
// Caught up to, Devices, Age limit and the rest. Shaped as buttons (an icon
// in its own disc, a filled face, a chevron saying it opens something) so
// they stand apart from the plain status badges beside them, and coloured
// by state: neutral, "on" when the thing it controls is in use, and warning
// when it needs a look.

import { ChevronDownIcon } from "@heroicons/react/24/outline";
import { type ComponentType, forwardRef, type ReactNode, type SVGProps } from "react";

export type ActionPillTone = "neutral" | "on" | "warn";

const FACE: Record<ActionPillTone, string> = {
    neutral: "border-default bg-surface-hover text-default hover:border-primary/40",
    on: "border-primary/50 bg-primary/15 text-default hover:border-primary",
    warn: "border-warning/50 bg-warning/10 text-warning hover:border-warning",
};

const DISC: Record<ActionPillTone, string> = {
    neutral: "bg-primary/15 text-primary",
    on: "bg-primary text-white",
    warn: "bg-warning text-black",
};

export const ActionPill = forwardRef<
    HTMLButtonElement,
    {
        icon: ComponentType<SVGProps<SVGSVGElement>>;
        tone?: ActionPillTone;
        open: boolean;
        onClick: () => void;
        children: ReactNode;
        /** 'sm' sits beside the small status badges on a card or tile. */
        size?: "md" | "sm";
        title?: string;
    }
>(function ActionPill(
    { icon: Icon, tone = "neutral", open, onClick, children, size = "md", title },
    ref
) {
    const sm = size === "sm";
    return (
        <button
            aria-expanded={open}
            className={`inline-flex min-w-0 max-w-full items-center rounded-full border font-medium shadow-sm transition-colors ${sm ? "gap-1 py-0.5 pr-1.5 pl-0.5 text-[11px]" : "gap-1.5 py-1 pr-2 pl-1 text-xs"} ${FACE[tone]}`}
            onClick={onClick}
            ref={ref}
            title={title}
            type="button"
        >
            <span
                className={`flex shrink-0 items-center justify-center rounded-full ${sm ? "h-4 w-4" : "h-5 w-5"} ${DISC[tone]}`}
            >
                <Icon className={sm ? "h-2.5 w-2.5" : "h-3 w-3"} />
            </span>
            <span className="truncate">{children}</span>
            <ChevronDownIcon
                className={`h-3 w-3 shrink-0 opacity-60 transition-transform ${open ? "rotate-180" : ""}`}
            />
        </button>
    );
});
