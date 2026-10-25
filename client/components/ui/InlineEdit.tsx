"use client";

import { PencilIcon } from "@heroicons/react/24/outline";
import { useEffect, useRef, useState } from "react";

interface InlineEditProps {
    className?: string;
    disabled?: boolean;
    maxLength?: number;
    onSave: (newValue: string) => Promise<void>;
    placeholder?: string;
    value: string | undefined;
}

export function InlineEdit({
    value,
    onSave,
    placeholder = "Enter value...",
    className = "",
    maxLength,
    disabled = false,
}: InlineEditProps) {
    const [isEditing, setIsEditing] = useState(false);
    const [editValue, setEditValue] = useState(value);
    const [isSaving, setIsSaving] = useState(false);
    const inputRef = useRef<HTMLInputElement>(null);
    const triggerRef = useRef<HTMLButtonElement>(null);
    const cancelledRef = useRef(false);
    const savingRef = useRef(false);
    const restoreFocusRef = useRef(false);

    useEffect(() => {
        if (!isEditing && restoreFocusRef.current) {
            triggerRef.current?.focus();
            restoreFocusRef.current = false;
        }
    }, [isEditing]);

    useEffect(() => {
        if (isEditing && inputRef.current) {
            inputRef.current.focus();
            const length = inputRef.current.value.length;
            inputRef.current.setSelectionRange(length, length);
        }
    }, [isEditing]);

    useEffect(() => {
        setEditValue(value || "");
    }, [value]);

    const handleStartEdit = () => {
        if (disabled) {
            return;
        }
        cancelledRef.current = false;
        setIsEditing(true);
        setEditValue(value || "");
    };

    const handleCancel = () => {
        cancelledRef.current = true;
        setIsEditing(false);
        setEditValue(value || "");
    };

    const handleSave = async () => {
        if (cancelledRef.current || savingRef.current) {
            return;
        }
        const currentVal = editValue || "";
        const originalVal = value || "";

        if (currentVal.trim() === originalVal.trim() || !currentVal.trim()) {
            handleCancel();
            return;
        }

        savingRef.current = true;
        setIsSaving(true);
        try {
            await onSave(currentVal.trim());
            setIsEditing(false);
        } catch (error) {
            console.error("Failed to save:", error);
        } finally {
            savingRef.current = false;
            setIsSaving(false);
        }
    };

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === "Enter") {
            restoreFocusRef.current = true;
            e.preventDefault();
            handleSave();
        } else if (e.key === "Escape") {
            restoreFocusRef.current = true;
            e.preventDefault();
            handleCancel();
        }
    };

    const handleBlur = () => {
        handleSave();
    };

    if (isEditing) {
        return (
            <input
                aria-label={placeholder}
                className={`m-0 w-full min-w-[100px] border-primary border-b-2 bg-transparent p-0 font-inherit text-inherit outline-none focus:ring-0 ${isSaving ? "opacity-50" : ""} ${className}`}
                disabled={isSaving}
                maxLength={maxLength}
                onBlur={handleBlur}
                onChange={(e) => setEditValue(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder={placeholder}
                ref={inputRef}
                type="text"
                value={editValue}
            />
        );
    }

    return (
        <button
            aria-label={`Edit ${value || placeholder}`}
            className={`group -ml-1 flex cursor-pointer items-center gap-2 rounded px-1 text-left transition-colors hover:bg-surface-hover ${disabled ? "cursor-default" : ""} ${className}`}
            disabled={disabled}
            onClick={handleStartEdit}
            ref={triggerRef}
            title={disabled ? "" : "Click to edit"}
            type="button"
        >
            <span className="max-w-full truncate font-inherit text-inherit">
                {value || placeholder || "Click to edit"}
            </span>
            {!disabled && (
                <PencilIcon className="h-4 w-4 shrink-0 text-muted opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100" />
            )}
        </button>
    );
}
