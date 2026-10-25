"use client";

// Without this, a component throwing during render left the whole page
// blank with no way back except a reload - and on an installed app, no
// address bar to reload from. This keeps the shell and offers the two
// things that actually recover it.
import { useEffect } from "react";

export default function AppError({
    error,
    reset,
}: {
    error: Error & { digest?: string };
    reset: () => void;
}) {
    useEffect(() => {
        // Visible in the browser console for anyone diagnosing a report.
        console.error("[SlickSync] page error:", error);
    }, [error]);

    return (
        <div className="flex min-h-[60vh] items-center justify-center p-6">
            <div
                className="w-full max-w-md rounded-2xl p-6 text-center"
                style={{
                    background: "var(--color-surface)",
                    border: "1px solid var(--color-surface-border)",
                }}
            >
                <h2
                    className="font-display font-semibold text-lg"
                    style={{ color: "var(--color-text)" }}
                >
                    This page hit an error
                </h2>
                <p className="mt-2 text-sm" style={{ color: "var(--color-text-muted)" }}>
                    The rest of SlickSync is still running. Trying again usually clears it.
                </p>
                {error?.message && (
                    <p
                        className="mt-3 break-words font-mono text-xs"
                        style={{ color: "var(--color-text-subtle, var(--color-text-muted))" }}
                    >
                        {error.message}
                    </p>
                )}
                <div className="mt-5 flex items-center justify-center gap-2">
                    <button
                        className="rounded-lg px-4 py-2 font-medium text-sm text-white"
                        onClick={reset}
                        style={{ background: "var(--color-primary)" }}
                        type="button"
                    >
                        Try again
                    </button>
                    <a
                        className="rounded-lg px-4 py-2 font-medium text-sm"
                        href="/"
                        style={{
                            background: "var(--color-surface-hover)",
                            color: "var(--color-text)",
                        }}
                    >
                        Go to the dashboard
                    </a>
                </div>
            </div>
        </div>
    );
}
