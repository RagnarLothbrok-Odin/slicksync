"use client";

// Watch-tracking row: what this person finishes in Stremio, Nuvio or
// AIOStreams is marked played on their real Jellyfin server too
// (server/utils/jellyfinMarkPlayed.js). Renders nothing for anyone without a
// real Jellyfin sign-in - their own, or one merged into them.

import { CheckBadgeIcon } from "@heroicons/react/24/outline";
import { useEffect, useState } from "react";
import { ToggleSwitch } from "@/components/ui";
import { toast } from "@/components/ui/Toast";
import { api } from "@/lib/api";

export function MarkPlayedRow({ userId }: { userId: string }) {
    const [state, setState] = useState<{
        available: boolean;
        enabled: boolean;
        lists: boolean;
    } | null>(null);
    const [saving, setSaving] = useState(false);

    useEffect(() => {
        api.getJellyfinMarkPlayed(userId)
            .then(setState)
            .catch(() => setState(null));
    }, [userId]);

    if (!state?.available) {
        return null;
    }

    const toggle = async (change: { enabled?: boolean; lists?: boolean }) => {
        setSaving(true);
        try {
            setState(await api.setJellyfinMarkPlayed(userId, change));
        } catch (e) {
            toast.error((e as Error)?.message || "Could not change that");
        } finally {
            setSaving(false);
        }
    };

    return (
        <>
            <div className="border-t" style={{ borderColor: "var(--color-surface-border)" }} />
            <div className="flex items-center justify-between gap-4 py-3">
                <div className="flex min-w-0 items-center gap-3">
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary-muted">
                        <CheckBadgeIcon className="h-5 w-5 text-primary" />
                    </div>
                    <div className="min-w-0">
                        <h4 className="font-semibold text-default">Keep Jellyfin in step</h4>
                        <p className="text-muted text-sm">
                            What they finish anywhere else is marked played on their Jellyfin
                            server, and what they stop part-way picks up at the same spot there.
                            Checked every 10 minutes.
                        </p>
                    </div>
                </div>
                <ToggleSwitch
                    checked={state.enabled}
                    disabled={saving}
                    onChange={() => toggle({ enabled: !state.enabled })}
                    title="Keep Jellyfin in step"
                />
            </div>
            {/* Their own favourites are filled from it, so it's off unless chosen. */}
            {state.enabled && (
                <div className="flex items-center justify-between gap-4 pb-3 pl-[52px]">
                    <div className="min-w-0">
                        <p className="font-medium text-default text-sm">
                            Watchlist and ratings too
                        </p>
                        <p className="text-muted text-xs">
                            The household watchlist becomes their Jellyfin favourites, and ratings
                            their ratings. Only what SlickSync adds is ever taken away again.
                        </p>
                    </div>
                    <ToggleSwitch
                        checked={state.lists}
                        disabled={saving}
                        onChange={() => toggle({ lists: !state.lists })}
                        title="Watchlist and ratings too"
                    />
                </div>
            )}
        </>
    );
}
