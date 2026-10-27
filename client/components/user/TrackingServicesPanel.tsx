"use client";

import { useEffect, useState } from "react";
import { Button, Card } from "@/components/ui";
import { DropdownSelect } from "@/components/ui/DropdownSelect";
import { TrackingServiceRow } from "@/components/user/TrackingServiceRow";
import { readErrorMessage } from "@/lib/errors";
import { useUserAuth, useUserAuthHeaders } from "@/lib/hooks/useUserAuth";
import { providerLabel } from "@/lib/providers";
import { personalRequest } from "@/lib/user-api";

interface Service {
    configured: boolean;
    connected: boolean;
    connectedAt: string | null;
    provider: "trakt" | "simkl" | "mdblist";
    username: string | null;
}
interface Services {
    services: Service[];
    source: string | null;
    supported: boolean;
}

// This describes implemented tracker data, independent of connection or temporary API errors.
const trackingFeatures = [
    { name: "Playback activity", support: [true, false, true] },
    { name: "Continue Watching", support: [true, true, true] },
    { name: "Next episodes", support: [true, true, true] },
    { name: "TV calendar", support: [true, true, true] },
    { name: "Movie calendar", support: [true, false, true] },
    { name: "All-time watch time", support: [true, true, true] },
    { name: "Movies watched", support: [true, true, true] },
    { name: "Series watched", support: [true, false, true] },
    { name: "Episodes watched", support: [true, true, true] },
    { name: "Today’s activity", support: [true, false, false] },
    { name: "Average runtime", support: [true, false, false] },
    { name: "Most Watched", support: [true, false, false] },
    { name: "Recent History", support: [true, false, false] },
    { name: "Viewing streaks", support: [false, false, true] },
    { name: "Binge history", support: [false, false, false] },
];

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
                        />
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
                        />
                        <TrackingServiceRow
                            disabled={busy || sourceBusy}
                            key={`${userId}:mdblist`}
                            onBusyChange={setBusy}
                            onChange={() => setRetry((value) => value + 1)}
                            provider="mdblist"
                            service={
                                state?.userId === userId
                                    ? state.value.services.find(
                                          (entry) => entry.provider === "mdblist"
                                      )
                                    : undefined
                            }
                        />
                    </div>
                    <div className="mt-5 overflow-x-auto border-default border-t pt-5">
                        <table className="w-full text-left text-sm">
                            <caption className="mb-4 text-left font-semibold text-default">
                                Feature support in SlickSync
                            </caption>
                            <thead>
                                <tr className="text-muted">
                                    <th className="py-3 pr-4 font-medium" scope="col">
                                        Feature
                                    </th>
                                    {["Trakt", "Simkl", "MDBList"].map((name) => (
                                        <th
                                            className="px-3 py-3 text-center font-medium"
                                            key={name}
                                            scope="col"
                                        >
                                            {name}
                                        </th>
                                    ))}
                                </tr>
                            </thead>
                            <tbody>
                                {trackingFeatures.map(({ name, support }) => (
                                    <tr className="border-default border-t" key={name}>
                                        <th
                                            className="py-3 pr-4 font-normal text-default"
                                            scope="row"
                                        >
                                            {name}
                                        </th>
                                        {support.map((supported, index) => (
                                            <td
                                                className={`px-3 py-3 text-center ${supported ? "text-success" : "text-subtle"}`}
                                                key={["trakt", "simkl", "mdblist"][index]}
                                            >
                                                {supported ? "Supported" : "Unsupported"}
                                            </td>
                                        ))}
                                    </tr>
                                ))}
                            </tbody>
                        </table>
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
                                            label:
                                                entry.provider === "trakt"
                                                    ? "Trakt"
                                                    : entry.provider === "simkl"
                                                      ? "Simkl"
                                                      : "MDBList",
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
