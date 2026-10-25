"use client";

// The AIOSync card on Tasks: one link to the AIOSync page (the person is
// picked there, with For), and under it who is synced with whom - one line
// per person whose sign-ins or profiles are kept in step.

import { ArrowsRightLeftIcon, ChevronRightIcon } from "@heroicons/react/24/outline";
import Link from "next/link";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";

interface Synced {
    name: string;
    places: string[];
    userId: string;
}

const joinNames = (names: string[]) =>
    names.length <= 1 ? names.join("") : `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;

export function WatchSyncCard() {
    const [synced, setSynced] = useState<Synced[]>([]);
    useEffect(() => {
        api.getWatchSyncOverview()
            .then((r) => setSynced(r.synced || []))
            .catch(() => undefined);
    }, []);

    return (
        <Link
            className="mb-6 flex items-center gap-3 rounded-2xl border p-5 transition-colors hover:border-[color:var(--color-secondary)]"
            href="/tasks/aiosync"
            style={{
                background: "color-mix(in srgb, var(--color-surface) 55%, transparent)",
                borderColor:
                    "color-mix(in srgb, var(--color-secondary) 40%, var(--color-surface-border))",
            }}
        >
            <span
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl"
                style={{
                    background: "color-mix(in srgb, var(--color-secondary) 18%, transparent)",
                }}
            >
                <ArrowsRightLeftIcon
                    className="h-5 w-5"
                    style={{ color: "var(--color-secondary)" }}
                />
            </span>
            <span className="min-w-0 flex-1">
                <span className="block font-display font-semibold text-base text-default">
                    AIOSync
                </span>
                <span className="block text-muted text-xs">
                    Copy watched titles and resume points between any sign-ins and profiles, or keep
                    them in step
                </span>
                {synced.length > 0 && (
                    <span className="mt-2 flex flex-wrap gap-1.5">
                        {synced.map((s) => (
                            <span
                                className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-semibold text-[11px]"
                                key={s.userId}
                                style={{
                                    background:
                                        "color-mix(in srgb, var(--color-success) 15%, transparent)",
                                    color: "var(--color-success)",
                                }}
                            >
                                ⇄ {s.name}: {s.places[0]} synced with {joinNames(s.places.slice(1))}
                            </span>
                        ))}
                    </span>
                )}
            </span>
            <ChevronRightIcon className="h-5 w-5 shrink-0 text-muted" />
        </Link>
    );
}
