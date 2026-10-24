"use client";

import { CheckIcon } from "@heroicons/react/24/outline";
import { motion } from "framer-motion";
import { memo } from "react";
import type { ThemeId, themeMeta } from "@/lib/theme";

// Memoized theme card component
export const ThemeCard = memo(function ThemeCardLocal({
    meta,
    isSelected,
    onSelect,
}: {
    themeId: ThemeId;
    meta: (typeof themeMeta)[ThemeId];
    isSelected: boolean;
    onSelect: () => void;
}) {
    const { colors } = meta;

    return (
        <motion.button
            aria-pressed={isSelected}
            className={`theme-choice relative w-full rounded-2xl border-2 p-4 text-left transition-colors ${
                isSelected ? "border-primary bg-primary-muted" : "border-default"
            }`}
            onClick={onSelect}
            type="button"
            whileHover={undefined}
            whileTap={{ scale: 0.98 }}
        >
            {isSelected && (
                <div className="absolute top-2 right-2 flex h-5 w-5 items-center justify-center rounded-full bg-primary">
                    <CheckIcon
                        className="h-3 w-3 text-default"
                        style={{ color: "var(--color-bg)" }}
                    />
                </div>
            )}

            {/* Theme preview - mini mockup */}
            <div
                className="mb-2 h-20 w-full overflow-hidden rounded-lg border border-default"
                style={{ backgroundColor: colors.bg }}
            >
                {/* Mini sidebar */}
                <div className="flex h-full">
                    <div
                        className="flex h-full w-8 flex-col gap-1 p-1.5"
                        style={{ backgroundColor: colors.surface }}
                    >
                        <div
                            className="h-1.5 w-full rounded-full"
                            style={{ backgroundColor: colors.primary }}
                        />
                        <div
                            className="h-1 w-full rounded-full opacity-30"
                            style={{ backgroundColor: "#fff" }}
                        />
                        <div
                            className="h-1 w-full rounded-full opacity-30"
                            style={{ backgroundColor: "#fff" }}
                        />
                    </div>
                    {/* Mini content area */}
                    <div className="flex flex-1 flex-col gap-1.5 p-2">
                        {/* Header bar */}
                        <div
                            className="h-1.5 w-12 rounded-full opacity-40"
                            style={{ backgroundColor: "#fff" }}
                        />
                        {/* Cards row */}
                        <div className="mt-1 flex gap-1">
                            <div
                                className="h-6 w-6 rounded"
                                style={{ backgroundColor: colors.surface }}
                            />
                            <div
                                className="h-6 w-6 rounded"
                                style={{ backgroundColor: colors.surface }}
                            />
                            <div
                                className="h-6 w-6 rounded"
                                style={{ backgroundColor: colors.primary, opacity: 0.3 }}
                            />
                        </div>
                        {/* Button */}
                        <div
                            className="mt-auto h-2 w-8 rounded"
                            style={{ backgroundColor: colors.primary }}
                        />
                    </div>
                </div>
            </div>

            {/* Color swatches */}
            <div className="mb-2 flex gap-1">
                <div
                    className="h-4 w-4 rounded-full border border-white/10"
                    style={{ backgroundColor: colors.bg }}
                    title="Background"
                />
                <div
                    className="h-4 w-4 rounded-full border border-white/10"
                    style={{ backgroundColor: colors.surface }}
                    title="Surface"
                />
                <div
                    className="h-4 w-4 rounded-full border border-white/10"
                    style={{ backgroundColor: colors.primary }}
                    title="Primary"
                />
                <div
                    className="h-4 w-4 rounded-full border border-white/10"
                    style={{ backgroundColor: colors.secondary }}
                    title="Secondary"
                />
            </div>

            <p className="font-medium text-default text-sm">{meta.name}</p>
            <p className="text-muted text-xs">{meta.description}</p>
        </motion.button>
    );
});
