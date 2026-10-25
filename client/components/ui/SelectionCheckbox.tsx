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
        <span
            className={clsx(
                "interface-checkbox relative flex h-6 w-6 items-center justify-center focus-within:ring-2 focus-within:ring-primary focus-within:ring-offset-2",
                checked && "interface-checkbox-checked",
                !(visible || checked) && "opacity-0 focus-within:opacity-100",
                className
            )}
        >
            <input
                aria-label={checked ? "Deselect item" : "Select item"}
                checked={checked}
                className="absolute inset-0 z-10 m-0 h-full w-full cursor-pointer opacity-0"
                onChange={() => onChange?.()}
                onClick={(event) => event.stopPropagation()}
                type="checkbox"
            />
            {checked && <CheckIcon aria-hidden className="h-4 w-4" strokeWidth={2.5} />}
        </span>
    );
}
