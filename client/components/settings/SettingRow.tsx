"use client";

import { motion } from "framer-motion";
import { cloneElement, isValidElement } from "react";

export function ToggleSwitch({
    enabled,
    onChange,
    label,
    disabled,
}: {
    enabled: boolean;
    onChange: (value: boolean) => void;
    label?: string;
    disabled?: boolean;
}) {
    return (
        <button
            aria-checked={enabled}
            aria-label={label}
            className={`flex items-center gap-3 ${disabled ? "cursor-not-allowed opacity-50" : ""}`}
            disabled={disabled}
            onClick={() => !disabled && onChange(!enabled)}
            role="switch"
        >
            <div
                className={`relative h-5 w-10 rounded-full transition-colors ${
                    enabled ? "bg-primary" : "bg-muted"
                }`}
            >
                <motion.div
                    animate={{ x: enabled ? 20 : 2 }}
                    className="absolute top-0.5 h-4 w-4 rounded-full bg-surface shadow-md"
                    initial={false}
                    style={{ backgroundColor: "var(--color-text)" }}
                    transition={{ damping: 30, stiffness: 500, type: "spring" }}
                />
            </div>
        </button>
    );
}

// Setting row component
export function SettingRow({
    label,
    description,
    children,
    disabled,
}: {
    label: string;
    description: React.ReactNode;
    children: React.ReactNode;
    disabled?: boolean;
}) {
    return (
        // data-setting carries the visible label verbatim so the command
        // palette's settings deep-search (lib/settingsIndex.ts) can scroll to
        // and flash this exact row via /settings?highlight=<label>.
        <div
            className={`settings-row flex items-center justify-between gap-6 rounded-lg bg-subtle p-4 ${disabled ? "pointer-events-none opacity-50" : ""}`}
            data-setting={label}
        >
            <div className="min-w-0 flex-1">
                <p className="font-medium text-default text-sm">{label}</p>
                <div className="text-muted text-xs">{description}</div>
            </div>
            {isValidElement<{ label?: string }>(children) && children.type === ToggleSwitch
                ? cloneElement(children, { label })
                : children}
        </div>
    );
}
