"use client";

import { ArrowTopRightOnSquareIcon } from "@heroicons/react/24/outline";
import { useEffect, useState } from "react";
import { Button, Card } from "@/components/ui";
import { DropdownSelect } from "@/components/ui/DropdownSelect";
import { SimklTrackingDisclaimer } from "@/components/user/SimklTrackingDisclaimer";
import { TrackingServiceRow } from "@/components/user/TrackingServiceRow";
import { readErrorMessage } from "@/lib/errors";
import { useUserAuth, useUserAuthHeaders } from "@/lib/hooks/useUserAuth";
import { providerLabel } from "@/lib/providers";
import { personalRequest } from "@/lib/user-api";

interface Service {
    configured: boolean;
    connected: boolean;
    connectedAt: string | null;
    provider: "trakt" | "simkl";
    username: string | null;
}
interface Services {
    services: Service[];
    source: string | null;
    supported: boolean;
}

export function TrackingServicesPanel() {
    const { provider, userInfo } = useUserAuth();
    const nativeValue = provider || "stremio";
    const nativeLabel = providerLabel({ ...userInfo, providerType: provider });
    const { userId, authKey, isReady } = useUserAuthHeaders();
    const [state, setState] = useState<{ userId: string; value: Services } | null>(null);
    const [failure, setFailure] = useState("");
    const [busy, setBusy] = useState(false);
    const [sourceBusy, setSourceBusy] = useState(false);
    const [sourceFailure, setSourceFailure] = useState("");
    const [retry, setRetry] = useState(0);
    useEffect(() => {
        if (!(isReady && userId && authKey)) {
            return;
        }
        let active = true;
        setFailure("");
        personalRequest<Services>(userId, authKey, "/tracking-services")
            .then((value) => {
                if (active) {
                    setState({ userId, value });
                }
            })
            .catch((reason) => {
                if (active) {
                    setFailure(readErrorMessage(reason, "Could not load tracking services."));
                }
            });
        return () => {
            active = false;
        };
    }, [isReady, userId, authKey, provider, retry]);
    const chooseSource = async (source: string) => {
        if (!(userId && authKey) || sourceBusy || busy) {
            return;
        }
        setSourceBusy(true);
        setSourceFailure("");
        try {
            const result = await personalRequest<{ source: string }>(
                userId,
                authKey,
                "/tracking-services/source",
                { body: JSON.stringify({ provider: source }), method: "PATCH" }
            );
            setState((current) =>
                current?.userId === userId
                    ? { ...current, value: { ...current.value, source: result.source } }
                    : current
            );
        } catch (reason) {
            setSourceFailure(readErrorMessage(reason, "Could not save the tracking source."));
        } finally {
            setSourceBusy(false);
        }
    };
    return (
        <>
            {provider === "nuvio" && (
                <Card padding="lg">
                    <div>
                        <TrackingServiceRow
                            disabled={busy || sourceBusy}
                            key={`${userId}:trakt`}
                            onBusyChange={setBusy}
                            onChange={() => setRetry((value) => value + 1)}
                            provider="trakt"
                            service={
                                state?.userId === userId
                                    ? state.value.services.find(
                                          (entry) => entry.provider === "trakt"
                                      )
                                    : undefined
                            }
                        >
                            <div className="mt-4 space-y-3 text-muted text-sm leading-relaxed">
                                <p className="font-medium text-default">
                                    Uses one Trakt connection slot
                                </p>
                                <p className="mt-1">
                                    Free Trakt accounts currently allow{" "}
                                    <strong>2 Community App connections</strong>. Connecting
                                    SlickSync uses one of those slots, in addition to any slot used
                                    by your player.
                                </p>
                                <div className="mt-3 flex flex-wrap gap-x-4 gap-y-2">
                                    <a
                                        className="inline-flex items-center gap-1 text-primary underline-offset-4 hover:underline"
                                        href="https://github.com/trakt/trakt-api/discussions/943"
                                        rel="noreferrer"
                                        target="_blank"
                                    >
                                        Trakt’s limit change
                                        <ArrowTopRightOnSquareIcon
                                            aria-hidden="true"
                                            className="h-3.5 w-3.5"
                                        />
                                    </a>
                                    <a
                                        className="inline-flex items-center gap-1 text-primary underline-offset-4 hover:underline"
                                        href="https://app.trakt.tv/settings/apps/connected"
                                        rel="noreferrer"
                                        target="_blank"
                                    >
                                        Check your connections
                                        <ArrowTopRightOnSquareIcon
                                            aria-hidden="true"
                                            className="h-3.5 w-3.5"
                                        />
                                    </a>
                                </div>
                            </div>
                        </TrackingServiceRow>
                        <TrackingServiceRow
                            disabled={busy || sourceBusy}
                            key={`${userId}:simkl`}
                            onBusyChange={setBusy}
                            onChange={() => setRetry((value) => value + 1)}
                            provider="simkl"
                            service={
                                state?.userId === userId
                                    ? state.value.services.find(
                                          (entry) => entry.provider === "simkl"
                                      )
                                    : undefined
                            }
                        >
                            <SimklTrackingDisclaimer nativeLabel={nativeLabel} />
                        </TrackingServiceRow>
                    </div>
                </Card>
            )}
            {failure && (
                <div
                    className="mt-3 flex flex-wrap items-center justify-between gap-3"
                    role="alert"
                >
                    <p className="text-error text-sm">{failure}</p>
                    <Button
                        onClick={() => setRetry((value) => value + 1)}
                        size="sm"
                        variant="ghost"
                    >
                        Try again
                    </Button>
                </div>
            )}
            <Card className={provider === "nuvio" ? "mt-6" : ""} padding="lg">
                <div className="flex flex-wrap items-center justify-between gap-4">
                    <div className="max-w-md">
                        <h3 className="font-semibold text-base text-default">Use as source</h3>
                        <p className="mt-1 text-muted text-sm">
                            Choose the account used for your Home data.
                        </p>
                    </div>
                    {state?.userId === userId ? (
                        <fieldset disabled={busy || sourceBusy}>
                            <DropdownSelect
                                ariaLabel="Use as source"
                                className="inline-flex min-w-44 items-center justify-between gap-4 whitespace-nowrap rounded-xl border border-default bg-bg px-4 py-2.5 text-default text-sm transition-colors hover:bg-surface-hover disabled:opacity-50"
                                onChange={(value) => void chooseSource(value)}
                                options={[
                                    { label: nativeLabel, value: nativeValue },
                                    ...(state?.userId === userId ? state.value.services : [])
                                        .filter((entry) => entry.connected)
                                        .map((entry) => ({
                                            label: entry.provider === "trakt" ? "Trakt" : "Simkl",
                                            value: entry.provider,
                                        })),
                                ]}
                                value={
                                    state?.userId === userId
                                        ? state.value.source || nativeValue
                                        : ""
                                }
                            />
                        </fieldset>
                    ) : (
                        <p className="text-sm text-subtle">Loading sources…</p>
                    )}
                </div>
                {sourceBusy && (
                    <p className="mt-3 text-muted text-sm" role="status">
                        Saving source…
                    </p>
                )}
                {sourceFailure && (
                    <p className="mt-3 text-error text-sm" role="alert">
                        {sourceFailure}
                    </p>
                )}
            </Card>
        </>
    );
}
