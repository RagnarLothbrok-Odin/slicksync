"use client";

export function SimklTrackingDisclaimer({ nativeLabel }: { nativeLabel: string }) {
    return (
        <div className="mt-4 space-y-3 text-muted text-sm leading-relaxed">
            <h5 className="font-medium text-default">When Simkl is your source</h5>
            <ul className="mt-2 list-disc space-y-2 pl-5">
                <li>
                    Playback activity, today’s activity, average session time, streaks, series
                    counts, Most Watched and binge history use {nativeLabel} data. Simkl does not
                    expose live playback or the summaries needed for these features.
                </li>
                <li>
                    Simkl supplies saved progress, next aired episodes and all-time movie, episode
                    and watch-time totals. Saved pauses expire after 7 days on Free, 30 days on PRO
                    or 90 days on VIP.
                </li>
                <li>
                    The calendar shows supported TV titles from your Simkl Watching list. Anime
                    without matching IMDb and episode details cannot be shown.
                </li>
            </ul>
            <a
                className="mt-3 inline-block text-primary underline-offset-4 hover:underline"
                href="https://api.simkl.org/guides/sync"
                rel="noreferrer"
                target="_blank"
            >
                Simkl’s API capabilities
            </a>
        </div>
    );
}
