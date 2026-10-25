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
        <span
            className={clsx(
                "interface-checkbox relative flex h-6 w-6 shrink-0 items-center justify-center focus-within:ring-2 focus-within:ring-primary focus-within:ring-offset-2",
                selected && "interface-checkbox-checked",
                className
            )}
            title={title || label}
        >
            <input
                aria-label={label}
                checked={allSelected}
                className="absolute inset-0 z-10 m-0 h-full w-full cursor-pointer opacity-0 disabled:cursor-default"
                disabled={totalCount === 0}
                onChange={selected ? onDeselectAll : onSelectAll}
                onClick={(event) => event.stopPropagation()}
                ref={(input) => {
                    if (input) {
                        input.indeterminate = mixed;
                    }
                }}
                type="checkbox"
            />
            {mixed ? (
                <MinusIcon aria-hidden className="h-4 w-4" strokeWidth={2.5} />
            ) : allSelected ? (
                <CheckIcon aria-hidden className="h-4 w-4" strokeWidth={2.5} />
            ) : null}
        </span>
    );
}
