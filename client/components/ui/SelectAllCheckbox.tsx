"use client";

import { CheckIcon, MinusIcon } from "@heroicons/react/24/outline";
import clsx from "clsx";

interface SelectAllCheckboxProps {
    className?: string;
    onDeselectAll: () => void;
    onSelectAll: () => void;
    selectedCount: number;
    title?: string;
    totalCount: number;
}

export function SelectAllCheckbox({
    totalCount,
    selectedCount,
    onSelectAll,
    onDeselectAll,
    className = "",
    title,
}: SelectAllCheckboxProps) {
    const allSelected = totalCount > 0 && selectedCount === totalCount;
    const mixed = selectedCount > 0 && !allSelected;
    const selected = allSelected || mixed;
    const label =
        totalCount === 0
            ? "No items to select"
            : selected
              ? "Deselect all items"
              : `Select all ${totalCount} items`;
    return (
        <button
            aria-checked={mixed ? "mixed" : allSelected}
            aria-label={label}
            className={clsx(
                "interface-checkbox relative flex h-6 w-6 shrink-0 items-center justify-center",
                selected && "interface-checkbox-checked",
                className
            )}
            disabled={totalCount === 0}
            onClick={selected ? onDeselectAll : onSelectAll}
            role="checkbox"
            title={title || label}
            type="button"
        >
            {mixed ? (
                <MinusIcon aria-hidden className="h-4 w-4" strokeWidth={2.5} />
            ) : allSelected ? (
                <CheckIcon aria-hidden className="h-4 w-4" strokeWidth={2.5} />
            ) : null}
        </button>
    );
}
