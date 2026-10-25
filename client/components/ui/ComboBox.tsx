"use client";

import { ChevronDownIcon } from "@heroicons/react/24/outline";
import { useEffect, useRef, useState } from "react";

export interface ComboBoxOption {
    label: string;
    value: string;
}

interface ComboBoxProps {
    className?: string;
    onBlur?: () => void;
    onChange: (value: string) => void;
    options: ComboBoxOption[];
    placeholder?: string;
    value: string;
}

// A text input that's still freely typable (a fixed list would go stale the
// moment a provider ships a new model, or someone points at a custom
// endpoint) but LOOKS like it has a dropdown - a plain <input list="...">
// bound to a <datalist> technically works, but gives no visible sign a list
// exists until you start typing, and rendering varies enough across
// browsers that it often just looks like a bare text field. This adds the
// same explicit chevron + click-to-open panel every <select> in this app
// already uses (see FilterTabs.tsx), so "there's a dropdown here" is obvious
// on sight, while still accepting arbitrary text typed directly.
export function ComboBox({
    value,
    onChange,
    onBlur,
    options,
    placeholder,
    className,
}: ComboBoxProps) {
    const [isOpen, setIsOpen] = useState(false);
    const containerRef = useRef<HTMLDivElement>(null);

    // Clicking a dropdown option also blurs the input (focus moves to the
    // option button) - firing onBlur immediately would save whatever the
    // input held BEFORE that click's onChange lands. Deferring one tick lets
    // the option's own click handler (which calls onChange) run first, same
    // "blur-then-microtask" ordering issue every custom combobox needs to
    // account for since there's no single native element wrapping both parts.
    const handleBlur = () => {
        if (!onBlur) {
            return;
        }
        setTimeout(onBlur, 150);
    };

    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
                setIsOpen(false);
            }
        };
        document.addEventListener("mousedown", handleClickOutside);
        return () => document.removeEventListener("mousedown", handleClickOutside);
    }, []);

    return (
        <div className="relative" ref={containerRef}>
            <input
                autoComplete="off"
                className={`${className || "input-base w-full px-3 py-2 text-sm"} pr-9`}
                onBlur={handleBlur}
                onChange={(e) => onChange(e.target.value)}
                onFocus={() => setIsOpen(true)}
                placeholder={placeholder}
                spellCheck={false}
                type="text"
                value={value}
            />
            <button
                aria-label="Show options"
                className="absolute top-0 right-0 flex h-full items-center px-2.5"
                onClick={() => setIsOpen((v) => !v)}
                tabIndex={-1}
                type="button"
            >
                <ChevronDownIcon
                    className={`h-4 w-4 text-subtle transition-transform duration-200 ${isOpen ? "rotate-180" : ""}`}
                />
            </button>

            {isOpen && options.length > 0 && (
                <div
                    className="absolute z-20 mt-1 max-h-56 w-full overflow-y-auto rounded-lg py-1 shadow-lg"
                    style={{
                        background: "var(--color-surface)",
                        border: "1px solid var(--color-surface-border)",
                    }}
                >
                    {options.map((opt) => (
                        <button
                            className="w-full truncate px-3 py-1.5 text-left text-sm transition-colors hover:bg-surface-hover"
                            key={opt.value}
                            onClick={() => {
                                onChange(opt.value);
                                setIsOpen(false);
                            }}
                            style={{ color: "var(--color-text)" }}
                            type="button"
                        >
                            {opt.label}
                        </button>
                    ))}
                </div>
            )}
        </div>
    );
}
