"use client";

import { ListBulletIcon, Squares2X2Icon } from "@heroicons/react/24/outline";
import { motion } from "framer-motion";

interface ViewModeToggleProps {
    mode: "grid" | "list";
    onChange: (mode: "grid" | "list") => void;
    showLabels?: boolean;
}

export function ViewModeToggle({ mode, onChange, showLabels = true }: ViewModeToggleProps) {
    return (
        <div className="relative flex rounded-xl border border-default bg-surface p-1">
            {/* Sliding background indicator */}
            <motion.div
                animate={{
                    left: mode === "grid" ? "4px" : "calc(50% + 0px)",
                    width: "calc(50% - 4px)",
                }}
                className="absolute top-1 h-[calc(100%-8px)] rounded-lg bg-primary-muted"
                initial={false}
                transition={{ damping: 30, stiffness: 300, type: "spring" }}
            />

            {/* Grid button */}
            <button
                className={`relative z-10 flex items-center gap-1.5 rounded-lg p-2 transition-all ${
                    mode === "grid" ? "text-primary" : "text-muted"
                }`}
                onClick={() => onChange("grid")}
                title="Grid view"
            >
                <Squares2X2Icon className="h-5 w-5" />
                {showLabels && <span className="hidden font-medium text-sm sm:inline">Grid</span>}
            </button>

            {/* List button */}
            <button
                className={`relative z-10 flex items-center gap-1.5 rounded-lg p-2 transition-all ${
                    mode === "list" ? "text-primary" : "text-muted"
                }`}
                onClick={() => onChange("list")}
                title="List view"
            >
                <ListBulletIcon className="h-5 w-5" />
                {showLabels && <span className="hidden font-medium text-sm sm:inline">List</span>}
            </button>
        </div>
    );
}
