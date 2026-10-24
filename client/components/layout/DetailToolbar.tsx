"use client";

import { ChevronLeftIcon } from "@heroicons/react/24/outline";
import Link from "next/link";
import type { ReactNode } from "react";
import { TopbarActions } from "./TopbarActions";

interface DetailToolbarProps {
    actions?: ReactNode;
    backHref: string;
    backLabel: string;
    title: string;
}

/** Detail pages let the editable identity lead instead of repeating a title. */
export function DetailToolbar({ title, backHref, backLabel, actions }: DetailToolbarProps) {
    return (
        <div className="detail-toolbar mb-6 flex flex-wrap items-center justify-between gap-4">
            <h1 className="sr-only">{title}</h1>
            <Link
                className="detail-back-link inline-flex items-center gap-1.5 rounded-xl py-2.5 pr-3 font-medium text-muted text-sm"
                href={backHref}
            >
                <ChevronLeftIcon className="h-4 w-4" />
                {backLabel}
            </Link>
            <div className="detail-toolbar-controls ml-auto flex min-w-0 flex-wrap items-center justify-end gap-3">
                <div className="detail-actions min-w-0">{actions}</div>
                <div className="detail-toolbar-utilities">
                    <TopbarActions />
                </div>
            </div>
        </div>
    );
}
