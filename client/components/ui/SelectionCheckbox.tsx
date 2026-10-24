"use client";

import { CheckIcon } from "@heroicons/react/24/outline";
import clsx from "clsx";

interface SelectionCheckboxProps {
    checked: boolean;
    className?: string;
    onChange?: () => void;
    visible?: boolean;
}

export function SelectionCheckbox({
    checked,
    onChange,
    className = "",
    visible = true,
}: SelectionCheckboxProps) {
    return (
        <button
            aria-checked={checked}
            aria-label={checked ? "Deselect item" : "Select item"}
            className={clsx(
                "interface-checkbox relative flex h-6 w-6 items-center justify-center",
                checked && "interface-checkbox-checked",
                !(visible || checked) && "opacity-0 focus-visible:opacity-100",
                className
            )}
            onClick={(event) => {
                event.stopPropagation();
                onChange?.();
            }}
            role="checkbox"
            type="button"
        >
            {checked && <CheckIcon aria-hidden className="h-4 w-4" strokeWidth={2.5} />}
        </button>
    );
}
