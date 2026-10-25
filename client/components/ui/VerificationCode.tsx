"use client";

import { CheckIcon, ClipboardIcon } from "@heroicons/react/24/outline";

/** Device approval codes can be long tokens rather than short PINs. */
export function VerificationCode({
    code,
    copied,
    onCopy,
}: {
    code: string;
    copied: boolean;
    onCopy: () => void;
}) {
    const shortCode = /^[a-z0-9-]{1,8}$/i.test(code);

    return (
        <button
            aria-label="Copy verification code"
            className="verification-code grid min-h-16 w-full min-w-0 grid-cols-[1.25rem_minmax(0,1fr)_1.25rem] items-center gap-3 rounded-xl border border-default bg-bg p-4 transition-colors hover:bg-surface-hover disabled:opacity-50"
            disabled={!code}
            onClick={onCopy}
            type="button"
        >
            <span aria-hidden="true" className="w-5" />
            <code
                className={`min-w-0 whitespace-normal text-center text-default ${shortCode ? "pl-[0.2em] font-medium text-2xl tracking-[0.2em]" : "break-all text-sm leading-relaxed"}`}
            >
                {code || "Preparing your code..."}
            </code>
            <span aria-hidden="true" className="shrink-0 pt-0.5">
                {copied ? (
                    <CheckIcon className="h-4 w-4 text-success" />
                ) : (
                    <ClipboardIcon className="h-4 w-4 text-muted" />
                )}
            </span>
            <span className="sr-only" role="status">
                {copied ? "Code copied" : ""}
            </span>
        </button>
    );
}
