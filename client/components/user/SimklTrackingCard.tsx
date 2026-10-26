"use client";

import { useState } from "react";
import { Button, Card } from "@/components/ui";
import { readErrorMessage } from "@/lib/errors";
import { useUserAuthHeaders } from "@/lib/hooks/useUserAuth";
import { personalRequest } from "@/lib/user-api";

interface SimklService {
    configured: boolean;
    connected: boolean;
    username: string | null;
}
export function SimklTrackingCard({
    service,
    nativeLabel,
    onChange,
}: {
    service: SimklService | undefined;
    nativeLabel: string;
    onChange: () => void;
}) {
    const { userId, authKey } = useUserAuthHeaders();
    const [busy, setBusy] = useState(false);
    const [failure, setFailure] = useState("");
    async function act(disconnect: boolean) {
        if (!(userId && authKey) || busy) {
            return;
        }
        setBusy(true);
        setFailure("");
        try {
            if (disconnect) {
                await personalRequest(userId, authKey, "/tracking-services/simkl", {
                    method: "DELETE",
                });
                onChange();
            } else {
                const result = await personalRequest<{ url: string }>(
                    userId,
                    authKey,
                    "/tracking-services/simkl/authorize",
                    { body: "{}", method: "POST" }
                );
                window.location.assign(result.url);
            }
        } catch (reason) {
            setFailure(readErrorMessage(reason, "Could not update the Simkl connection."));
        } finally {
            setBusy(false);
        }
    }
    return (
        <Card className="mt-6" padding="lg">
            <div className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-default bg-bg p-4">
                <div className="min-w-0">
                    <h4 className="font-semibold text-default">Simkl</h4>
                    <p className="mt-1 text-muted text-sm">
                        {service?.connected ? `Connected as ${service.username}` : "Not connected"}
                    </p>
                </div>
                <Button
                    disabled={busy || !(service?.connected || service?.configured)}
                    isLoading={busy}
                    onClick={() => void act(!!service?.connected)}
                    size="sm"
                    variant={service?.connected ? "secondary" : "primary"}
                >
                    {service?.connected ? "Disconnect" : "Connect"}
                </Button>
            </div>
            <p className="mt-3 text-muted text-sm">
                Use the same Simkl account connected in {nativeLabel} for this profile. SlickSync
                reads your saved progress, upcoming TV episodes and all-time totals without changing
                your Simkl history.
            </p>
            {service && !service.configured && !service.connected && (
                <p className="mt-3 text-muted text-sm">
                    Your administrator needs to configure the Simkl tracking app before you can
                    connect.
                </p>
            )}
            <div className="mt-4 rounded-xl border border-default bg-surface-hover p-4 text-muted text-sm">
                <h5 className="font-medium text-default">When Simkl is your source</h5>
                <ul className="mt-2 list-disc space-y-2 pl-5">
                    <li>
                        Live playback uses {nativeLabel} data. Unlike Trakt, Simkl’s API has no read
                        endpoint for currently watching; its playback endpoint returns paused
                        sessions.
                    </li>
                    <li>
                        Today’s activity, average session time, streaks, series counts, Most Watched
                        and binge history use {nativeLabel} data. Simkl’s API does not provide
                        equivalent personal summaries, and SlickSync does not download every watched
                        episode to calculate them.
                    </li>
                    <li>
                        Continue Watching uses Simkl’s paused progress and next aired episodes.
                        Saved pauses expire after 7 days on Free, 30 days on PRO or 90 days on VIP.
                    </li>
                    <li>
                        The calendar uses Simkl’s Watching list and its TV schedule, refreshed every
                        6 hours. Titles need an IMDb ID and mapped season and episode numbers; anime
                        without those mappings cannot be shown.
                    </li>
                    <li>
                        All-time watch time, movies and episodes use Simkl’s statistics endpoint
                        when you open Home. These totals are cached for 5 minutes and never polled
                        in the background.
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
            {failure && (
                <p className="mt-3 text-error text-sm" role="alert">
                    {failure}
                </p>
            )}
        </Card>
    );
}
