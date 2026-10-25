"use client";

import { motion } from "framer-motion";
import { useEffect, useRef } from "react";
import { AvatarColorSwatches } from "./Avatar";

interface ColorPickerProps {
    currentColorIndex: number;
    isOpen: boolean;
    onClose: () => void;
    onColorChange: (colorIndex: number) => void;
    triggerRef: React.RefObject<HTMLElement | HTMLDivElement | null>;
}

// The same colours as the avatar itself (components/ui/Avatar.tsx) - one
// list, so this quick picker and every dialog agree on what each one is.

export function ColorPicker({
    currentColorIndex,
    onColorChange,
    isOpen,
    onClose,
    triggerRef,
}: ColorPickerProps) {
    const pickerRef = useRef<HTMLDivElement>(null);

    // Close picker when clicking outside
    useEffect(() => {
        if (!isOpen) {
            return;
        }

        const handleClickOutside = (event: MouseEvent) => {
            if (
                pickerRef.current &&
                !pickerRef.current.contains(event.target as Node) &&
                triggerRef.current &&
                !triggerRef.current.contains(event.target as Node)
            ) {
                onClose();
            }
        };

        document.addEventListener("mousedown", handleClickOutside);
        return () => document.removeEventListener("mousedown", handleClickOutside);
    }, [isOpen, onClose, triggerRef]);

    if (!isOpen) {
        return null;
    }

    return (
        <motion.div
            animate={{ opacity: 1, y: 0 }}
            className="absolute top-full left-0 z-50 mt-2 rounded-xl border border-default p-3 shadow-xl"
            exit={{ opacity: 0, y: -10 }}
            initial={{ opacity: 0, y: -10 }}
            ref={pickerRef}
            style={{
                background: "var(--color-surface)",
                width: "min(340px, calc(100vw - 32px))",
            }}
        >
            <div className="mb-3 px-1 font-medium text-muted text-xs">Select Color</div>
            <AvatarColorSwatches
                onChange={(index) => {
                    onColorChange(index);
                    onClose();
                }}
                value={currentColorIndex}
            />
        </motion.div>
    );
}
