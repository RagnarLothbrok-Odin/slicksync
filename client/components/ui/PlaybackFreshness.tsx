"use client";

import { useEffect, useState } from "react";
import { type PlaybackEvidence, playbackUpdates } from "@/lib/playback";

/** Refresh only the relative labels; this does not invent newer provider data. */
export function PlaybackFreshness({ playback }: { playback?: PlaybackEvidence | null }) {
    const [now, setNow] = useState<number | null>(null);
    useEffect(() => {
        const update = () => {
            if (!document.hidden) {
                setNow(Date.now());
            }
        };
        update();
        const timer = window.setInterval(update, 15_000);
        document.addEventListener("visibilitychange", update);
        return () => {
            window.clearInterval(timer);
            document.removeEventListener("visibilitychange", update);
        };
    }, []);
    if (now === null) {
        return null;
    }
    const updates = playbackUpdates(playback, now);
    return (
        <span className="mt-1 block text-subtle text-xs">
            {updates.length
                ? updates.map((update, index) => (
                      <span key={update.label}>
                          {index > 0 && " · "}
                          {update.label}{" "}
                          <time dateTime={update.at} title={new Date(update.at).toLocaleString()}>
                              {update.age}
                          </time>
                      </span>
                  ))
                : "Update time unavailable"}
        </span>
    );
}
