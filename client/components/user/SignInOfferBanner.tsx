"use client";

// "Chris just added Nuvio - bring the titles they've watched on Stremio over
// to it?" (server/utils/watchCopy/offer.js). On the person page while their
// newest sign-in is new and nearly empty. "Show me what copies" opens Sync
// watch history with both boxes filled in; "Not now" hides it for that
// sign-in for good.

import Link from "next/link";
import { useEffect, useState } from "react";
import { api, type WatchCopyOffer } from "@/lib/api";

const LOOK: Record<string, string> = {
    aiometadata: "linear-gradient(135deg,#14b8a6,#0e7490)",
    aiostreams: "linear-gradient(135deg,#9f92ff,#5b4fd6)",
    jellyfin: "linear-gradient(135deg,#aa5cc3,#00a4dc)",
    nuvio: "linear-gradient(135deg,#38599e,#ff9800)",
    stremio: "linear-gradient(135deg,#8a5cf6,#5b3fd6)",
};

export function SignInOfferBanner({ userId }: { userId: string }) {
    const [offer, setOffer] = useState<WatchCopyOffer | null>(null);
    useEffect(() => {
        api.getWatchCopyOffer(userId)
            .then((r) => setOffer(r.offer))
            .catch(() => setOffer(null));
    }, [userId]);
    if (!offer) {
        return null;
    }

    const notNow = () => {
        setOffer(null);
        api.dismissWatchCopyOffer(userId, offer.to.provider).catch(() => undefined);
    };
    const href = `/users/${encodeURIComponent(userId)}/copy-history?from=${encodeURIComponent(offer.from.side)}&to=${encodeURIComponent(offer.to.side)}`;

    return (
        <div
            className="mt-3.5 flex flex-wrap items-center gap-3 rounded-2xl border px-3.5 py-3"
            style={{
                background: "color-mix(in srgb, var(--color-primary) 8%, var(--color-surface))",
                borderColor:
                    "color-mix(in srgb, var(--color-primary) 45%, var(--color-surface-border))",
            }}
        >
            <span
                aria-hidden="true"
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[10px] font-bold text-sm text-white"
                style={{ background: LOOK[offer.to.kind] || LOOK.jellyfin }}
            >
                {offer.to.label.slice(0, 1)}
            </span>
            <div className="min-w-0 flex-1 basis-[12rem]">
                <div className="font-semibold text-default text-sm">
                    {offer.name} just added {offer.to.label}
                </div>
                <div className="text-muted text-xs">
                    Bring the {offer.from.count.toLocaleString()} title
                    {offer.from.count === 1 ? "" : "s"} they&apos;ve watched on {offer.from.label}{" "}
                    over to it?
                </div>
            </div>
            <div className="ml-auto flex gap-2">
                <button
                    className="whitespace-nowrap rounded-lg border border-default px-3 py-1.5 text-default text-sm"
                    onClick={notNow}
                    type="button"
                >
                    Not now
                </button>
                <Link
                    className="whitespace-nowrap rounded-lg px-3 py-1.5 font-semibold text-sm text-white"
                    href={href}
                    style={{ background: "var(--color-primary)" }}
                >
                    Show me what copies
                </Link>
            </div>
        </div>
    );
}
