"use client";

// The way into AIOSync from a person's page (inside the Watch
// History section): their sign-in logos and a plain title. Shown for anyone
// with a sign-in - with a single one they copy to or from someone else's.

import { ChevronRightIcon } from "@heroicons/react/24/outline";
import Link from "next/link";
import { useEffect, useState } from "react";
import { api, type WatchCopySide } from "@/lib/api";

const LOOK: Record<string, { letter: string; bg: string }> = {
    aiometadata: { bg: "linear-gradient(135deg,#14b8a6,#0e7490)", letter: "A" },
    aiostreams: { bg: "linear-gradient(135deg,#9f92ff,#5b4fd6)", letter: "A" },
    jellyfin: { bg: "linear-gradient(135deg,#aa5cc3,#00a4dc)", letter: "J" },
    nuvio: { bg: "linear-gradient(135deg,#38599e,#ff9800)", letter: "N" },
    stremio: { bg: "linear-gradient(135deg,#8a5cf6,#5b3fd6)", letter: "S" },
};

export function CopyHistoryTile({ userId, name }: { userId: string; name: string }) {
    const [sides, setSides] = useState<WatchCopySide[] | null>(null);
    const [inStep, setInStep] = useState(false);
    useEffect(() => {
        api.getWatchCopySides(userId)
            .then((r) => setSides(r.sides))
            .catch(() => setSides([]));
        api.getKeepInStep(userId)
            .then((k) => setInStep(k.enabled))
            .catch(() => undefined);
    }, [userId]);
    if (!sides) {
        return null;
    }
    if (!sides.length) {
        return null;
    }
    const places = sides.reduce((n, s) => n + Math.max(1, s.profiles.length), 0);
    const what =
        places < 2
            ? `Copy to or from someone else’s sign-in · ${name}’s ${sides[0].name}`
            : `Copy once or keep in step · ${name}’s ${sides.length > 1 ? `${sides.length} sign-ins` : `${places} profiles`}`;
    // One sign-in with several profiles: their pictures (colour + initial when none).
    const profilePics = (size: number) => (
        <span className="flex shrink-0 gap-1">
            {sides[0].profiles.slice(0, 6).map((p) =>
                p.avatar ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                        alt=""
                        className="rounded-full object-cover"
                        height={size}
                        key={p.side}
                        src={p.avatar}
                        style={{ background: p.color || undefined, height: size, width: size }}
                        width={size}
                    />
                ) : (
                    <span
                        className="flex items-center justify-center rounded-full font-bold text-white"
                        key={p.side}
                        style={{
                            background: p.color || LOOK[sides[0].kind]?.bg,
                            fontSize: size * 0.45,
                            height: size,
                            width: size,
                        }}
                    >
                        {(p.name || "?").slice(0, 1).toUpperCase()}
                    </span>
                )
            )}
        </span>
    );
    const logos = (size: number) =>
        sides.length === 1 && sides[0].profiles.length ? (
            profilePics(size)
        ) : (
            <span className="flex shrink-0 gap-1">
                {sides.map((s) => (
                    <span
                        className="flex items-center justify-center font-bold text-white"
                        key={s.provider}
                        style={{
                            background: LOOK[s.kind]?.bg,
                            borderRadius: size * 0.3,
                            fontSize: size * 0.42,
                            height: size,
                            width: size,
                        }}
                    >
                        {LOOK[s.kind]?.letter}
                    </span>
                ))}
            </span>
        );
    const chip = (
        <span
            className="whitespace-nowrap rounded-full px-2 py-0.5 text-[10px]"
            style={{
                background: "color-mix(in srgb, var(--color-success) 18%, transparent)",
                color: "var(--color-success)",
            }}
        >
            Keep in step: on
        </span>
    );
    return (
        <Link
            className="mt-3.5 flex w-full items-center gap-3.5 rounded-2xl border p-3.5 transition-colors hover:border-primary"
            href={`/users/${encodeURIComponent(userId)}/copy-history`}
            style={{
                background: "color-mix(in srgb, var(--color-primary) 7%, var(--color-surface))",
                borderColor:
                    "color-mix(in srgb, var(--color-primary) 45%, var(--color-surface-border))",
            }}
        >
            <span className="hidden sm:flex">{logos(30)}</span>
            <span className="min-w-0 flex-1">
                <span className="block whitespace-nowrap font-semibold text-default">AIOSync</span>
                <span className="block text-muted text-sm">{what}</span>
                <span className="mt-2 flex items-center gap-2 sm:hidden">
                    {logos(22)}
                    {inStep && chip}
                </span>
            </span>
            {inStep && <span className="hidden sm:inline">{chip}</span>}
            <ChevronRightIcon className="h-[18px] w-[18px] shrink-0 text-muted" />
        </Link>
    );
}
