"use client";

import { motion, useReducedMotion } from "framer-motion";

interface ToggleSwitchProps {
    checked: boolean;
    className?: string;
    disabled?: boolean;
    onChange: () => void;
    size?: "sm" | "md";
    title?: string;
}

export function ToggleSwitch({
    checked,
    onChange,
    size = "md",
    title,
    disabled = false,
    className = "",
}: ToggleSwitchProps) {
    const reduceMotion = useReducedMotion();
    const trackBase = size === "sm" ? "h-5 w-9" : "h-6 w-11";
    const knobBase = size === "sm" ? "h-4 w-4" : "h-5 w-5";

    return (
        <button
            aria-checked={checked}
            aria-label={title}
            className={`interface-toggle relative inline-flex items-center rounded-full transition-colors ${trackBase} disabled:opacity-50 ${checked ? "tgl-on" : "tgl-off"} ${className}`}
            disabled={disabled}
            onClick={(e) => {
                e.stopPropagation();
                if (!disabled) {
                    onChange();
                }
            }}
            role="switch"
            title={title}
            type="button"
        >
            <motion.span
                animate={{
                    x: checked ? (size === "sm" ? 16 : 20) : size === "sm" ? 2 : 4,
                }}
                className={`inline-block rounded-full ${knobBase} ${checked ? "tgl-knob-on" : "tgl-knob-off"}`}
                transition={
                    reduceMotion ? { duration: 0 } : { bounce: 0, duration: 0.25, type: "spring" }
                }
            />
        </button>
    );
}
