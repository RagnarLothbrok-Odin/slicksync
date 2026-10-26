"use client";

export function SimklTrackingDisclaimer({ nativeLabel }: { nativeLabel: string }) {
    return (
        <div className="mt-4 space-y-3 text-muted text-sm leading-relaxed">
            <h5 className="font-medium text-default">When Simkl is your source</h5>
            <ul className="mt-2 list-disc space-y-2 pl-5">
                <li>
                    Live playback uses {nativeLabel} data. Unlike Trakt, Simkl’s API has no read
                    endpoint for currently watching; its playback endpoint returns paused sessions.
                </li>
                <li>
                    Today’s activity, average session time, streaks, series counts, Most Watched and
                    binge history use {nativeLabel} data. Simkl’s API does not provide equivalent
                    personal summaries, and SlickSync does not download every watched episode to
                    calculate them.
                </li>
                <li>
                    Continue Watching uses Simkl’s paused progress and next aired episodes. Saved
                    pauses expire after 7 days on Free, 30 days on PRO or 90 days on VIP.
                </li>
                <li>
                    The calendar uses Simkl’s Watching list and its TV schedule, refreshed every 6
                    hours. Titles need an IMDb ID and mapped season and episode numbers; anime
                    without those mappings cannot be shown.
                </li>
                <li>
                    All-time watch time, movies and episodes use Simkl’s statistics endpoint when
                    you open Home. These totals are cached for 5 minutes and never polled in the
                    background.
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
