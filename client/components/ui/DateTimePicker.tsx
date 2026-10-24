"use client";

import { CalendarIcon, XMarkIcon } from "@heroicons/react/24/outline";
import { format } from "date-fns";
import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useRef, useState } from "react";

interface DateTimePickerProps {
    className?: string;
    min?: Date;
    onChange: (value: string) => void;
    placeholder?: string;
    value: string; // ISO datetime string (YYYY-MM-DDTHH:mm format)
}

export function DateTimePicker({
    value,
    onChange,
    min,
    className = "",
    placeholder = "Select date and time",
}: DateTimePickerProps) {
    const [isOpen, setIsOpen] = useState(false);
    const [dateValue, setDateValue] = useState("");
    const [timeValue, setTimeValue] = useState("");
    const containerRef = useRef<HTMLDivElement>(null);

    // Parse value into date and time
    useEffect(() => {
        if (value) {
            try {
                const date = new Date(value);
                if (!Number.isNaN(date.getTime())) {
                    setDateValue(format(date, "yyyy-MM-dd"));
                    setTimeValue(format(date, "HH:mm"));
                }
            } catch {
                setDateValue("");
                setTimeValue("");
            }
        } else {
            setDateValue("");
            setTimeValue("");
        }
    }, [value]);

    // Close on outside click
    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
                setIsOpen(false);
            }
        };

        if (isOpen) {
            document.addEventListener("mousedown", handleClickOutside);
            return () => document.removeEventListener("mousedown", handleClickOutside);
        }
    }, [isOpen]);

    const handleDateChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const newDate = e.target.value;
        setDateValue(newDate);
        if (newDate && timeValue) {
            const combined = `${newDate}T${timeValue}`;
            onChange(combined);
        }
    };

    const handleTimeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const newTime = e.target.value;
        setTimeValue(newTime);
        if (dateValue && newTime) {
            const combined = `${dateValue}T${newTime}`;
            onChange(combined);
        }
    };

    const handleClear = () => {
        setDateValue("");
        setTimeValue("");
        onChange("");
        setIsOpen(false);
    };

    const displayValue = value ? format(new Date(value), "MMM dd, yyyy 'at' HH:mm") : placeholder;

    const minDate = min ? format(min, "yyyy-MM-dd") : format(new Date(), "yyyy-MM-dd");
    const minTime = min ? format(min, "HH:mm") : "00:00";

    return (
        <div className={`relative ${className}`} ref={containerRef}>
            <button
                className={`flex w-full items-center justify-between gap-2 rounded-xl border border-theme-surface-border px-4 py-3 transition-all duration-300 focus:border-theme-secondary focus:outline-none ${value ? "text-default" : "text-subtle"}`}
                onClick={() => setIsOpen(!isOpen)}
                style={{
                    background: "var(--color-bg-subtle)",
                }}
                type="button"
            >
                <div className="flex items-center gap-2">
                    <CalendarIcon className="h-5 w-5" />
                    <span>{displayValue}</span>
                </div>
                {value && (
                    <button
                        className="rounded p-1 hover:bg-surface-hover"
                        onClick={(e) => {
                            e.stopPropagation();
                            handleClear();
                        }}
                        type="button"
                    >
                        <XMarkIcon className="h-4 w-4" />
                    </button>
                )}
            </button>

            <AnimatePresence>
                {isOpen && (
                    <motion.div
                        animate={{ opacity: 1, y: 0 }}
                        className="absolute top-full left-0 z-50 mt-2 rounded-xl border border-default p-4 shadow-xl"
                        exit={{ opacity: 0, y: -10 }}
                        initial={{ opacity: 0, y: -10 }}
                        style={{
                            background: "var(--color-surface)",
                            minWidth: "300px",
                        }}
                    >
                        <div className="space-y-4">
                            <div>
                                <label className="mb-2 block font-medium text-muted text-sm">
                                    Date
                                </label>
                                <input
                                    className="w-full rounded-lg border border-theme-surface-border px-4 py-2 transition-all focus:border-theme-secondary focus:outline-none"
                                    min={minDate}
                                    onChange={handleDateChange}
                                    style={{
                                        background: "var(--color-bg-subtle)",
                                        color: "var(--color-text)",
                                    }}
                                    type="date"
                                    value={dateValue}
                                />
                            </div>
                            <div>
                                <label className="mb-2 block font-medium text-muted text-sm">
                                    Time
                                </label>
                                <input
                                    className="w-full rounded-lg border border-theme-surface-border px-4 py-2 transition-all focus:border-theme-secondary focus:outline-none"
                                    min={dateValue === minDate ? minTime : undefined}
                                    onChange={handleTimeChange}
                                    style={{
                                        background: "var(--color-bg-subtle)",
                                        color: "var(--color-text)",
                                    }}
                                    type="time"
                                    value={timeValue}
                                />
                            </div>
                            <div className="flex gap-2">
                                <button
                                    className="flex-1 rounded-lg px-4 py-2 font-medium text-sm transition-colors"
                                    onClick={() => setIsOpen(false)}
                                    style={{
                                        background: "var(--color-surface-hover)",
                                        color: "var(--color-text)",
                                    }}
                                    type="button"
                                >
                                    Done
                                </button>
                                {value && (
                                    <button
                                        className="rounded-lg px-4 py-2 font-medium text-sm transition-colors"
                                        onClick={handleClear}
                                        style={{
                                            background: "var(--color-error-muted)",
                                            color: "var(--color-error)",
                                        }}
                                        type="button"
                                    >
                                        Clear
                                    </button>
                                )}
                            </div>
                        </div>
                    </motion.div>
                )}
            </AnimatePresence>
        </div>
    );
}
