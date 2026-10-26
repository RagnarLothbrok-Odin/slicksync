"use client";

import { ArrowTopRightOnSquareIcon, LinkIcon } from "@heroicons/react/24/outline";
import { useEffect, useState } from "react";
import { Button, Card, ConfirmModal } from "@/components/ui";
import { DropdownSelect } from "@/components/ui/DropdownSelect";
import { readErrorMessage } from "@/lib/errors";
import { useUserAuth, useUserAuthHeaders } from "@/lib/hooks/useUserAuth";
import { providerLabel } from "@/lib/providers";
import { personalRequest } from "@/lib/user-api";

interface Service {
    configured: boolean;
    connected: boolean;
    connectedAt: string | null;
    provider: "trakt";
    username: string | null;
}
interface Feature {
    available: boolean;
    error: string | null;
    key: string;
    label: string;
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
    const [features, setFeatures] = useState<{ userId: string; items: Feature[] } | null>(null);
    const [confirm, setConfirm] = useState(false);
    const [retry, setRetry] = useState(0);
    const service = state?.userId === userId ? state.value.services[0] : null;
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
    useEffect(() => {
        if (!(service?.connected && userId && authKey)) {
            return;
        }
        let active = true;
        setFeatures(null);
        personalRequest<{ features: Feature[] }>(userId, authKey, "/tracking-services/trakt/check")
            .then((result) => {
                if (active) {
                    setFeatures({ items: result.features, userId });
                }
            })
            .catch(() => {
                if (active) {
                    setFailure("Could not check the tracking data sources. Try again.");
                }
            });
        return () => {
            active = false;
        };
    }, [service?.connected, userId, authKey, retry]);
    const connect = async () => {
        if (!(userId && authKey)) {
            return;
        }
        setBusy(true);
        setFailure("");
        try {
            const result = await personalRequest<{ url: string }>(
                userId,
                authKey,
                "/tracking-services/trakt/authorize",
                { body: "{}", method: "POST" }
            );
            window.location.assign(result.url);
        } catch (reason) {
            setFailure(readErrorMessage(reason, "Could not start sign-in."));
            setBusy(false);
        }
    };
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
    const disconnect = async () => {
        if (!(userId && authKey)) {
            return;
        }
        setBusy(true);
        setFailure("");
        try {
            await personalRequest(userId, authKey, "/tracking-services/trakt", {
                method: "DELETE",
            });
            setConfirm(false);
            setRetry((value) => value + 1);
        } catch (reason) {
            setFailure(readErrorMessage(reason, "Could not disconnect this service."));
        } finally {
            setBusy(false);
        }
    };
    return (
        <>
            {provider === "nuvio" && (
                <Card padding="lg">
                    <div className="mb-5 flex items-start gap-3">
                        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                            <LinkIcon aria-hidden="true" className="h-5 w-5" />
                        </span>
                        <div>
                            <h3 className="font-semibold text-base text-default">
                                Tracking services
                            </h3>
                            <p className="mt-1 text-muted text-sm">
                                Bring playback activity, saved progress, and upcoming episodes into
                                this profile.
                            </p>
                        </div>
                    </div>
                    <div className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-default bg-bg p-4">
                        <div className="min-w-0">
                            <h4 className="font-semibold text-default">Trakt</h4>
                            <p className="mt-1 text-muted text-sm">
                                {service?.connected
                                    ? `Connected as ${service.username}`
                                    : "Not connected"}
                            </p>
                        </div>
                        {service?.connected ? (
                            <Button
                                disabled={busy}
                                onClick={() => setConfirm(true)}
                                size="sm"
                                variant="secondary"
                            >
                                Disconnect
                            </Button>
                        ) : (
                            <Button
                                disabled={!service?.configured || busy}
                                isLoading={busy}
                                onClick={() => void connect()}
                                size="sm"
                            >
                                Connect
                            </Button>
                        )}
                    </div>
                    <p className="mt-3 text-muted text-sm">
                        Use the same Trakt account that you connect in Nuvio for{" "}
                        {userInfo?.username || "this profile"}. Activity from that Trakt account
                        belongs only to this SlickSync profile.
                    </p>
                    {!service?.connected && (
                        <div className="mt-4 rounded-xl border border-default bg-surface-hover p-4 text-muted text-sm">
                            <p className="font-medium text-default">
                                Uses one Trakt connection slot
                            </p>
                            <p className="mt-1">
                                Free Trakt accounts currently allow{" "}
                                <strong>2 Community App connections</strong>. Connecting SlickSync
                                uses one of those slots, in addition to any slot used by your
                                player.
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
                    )}
                    {service && !service.configured && !service.connected && (
                        <p className="mt-3 text-muted text-sm">
                            Your administrator needs to configure the Trakt tracking app before you
                            can connect.
                        </p>
                    )}
                    {service?.connected && (
                        <div className="mt-4 space-y-2 text-sm">
                            {features?.userId === userId ? (
                                features.items.map((feature) => (
                                    <div
                                        className="flex flex-wrap justify-between gap-2"
                                        key={feature.key}
                                    >
                                        <span className="text-muted">{feature.label}</span>
                                        <span
                                            className={
                                                feature.available ? "text-success" : "text-muted"
                                            }
                                        >
                                            {feature.available ? "Ready" : feature.error}
                                        </span>
                                    </div>
                                ))
                            ) : (
                                <p className="text-muted" role="status">
                                    Checking tracking sources…
                                </p>
                            )}
                        </div>
                    )}
                    {service?.connected && (
                        <p className="mt-3 text-subtle text-xs">
                            SlickSync reads Trakt activity. It does not write playback or watched
                            status back to Trakt or Nuvio. Tracker availability and the player’s
                            scrobbling determine how current the data is.
                        </p>
                    )}
                    {failure && (
                        <div className="mt-3" role="alert">
                            <p className="text-error text-sm">{failure}</p>
                            <Button
                                className="mt-2"
                                onClick={() => setRetry((value) => value + 1)}
                                size="sm"
                                variant="ghost"
                            >
                                Try again
                            </Button>
                        </div>
                    )}
                </Card>
            )}
            <Card className={provider === "nuvio" ? "mt-6" : ""} padding="lg">
                <div className="flex flex-wrap items-center justify-between gap-4">
                    <div className="max-w-md">
                        <h3 className="font-semibold text-base text-default">Use as source</h3>
                        <p className="mt-1 text-muted text-sm">
                            Choose your account’s app or a connected tracker for playback, Continue
                            Watching, calendar and statistics.
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
                                                    : entry.provider,
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
                {provider !== "nuvio" && failure && (
                    <p className="mt-3 text-error text-sm" role="alert">
                        {failure}
                    </p>
                )}
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
            <ConfirmModal
                confirmText="Disconnect"
                description="This stops SlickSync reading this profile’s Trakt data. Existing Nuvio history stays here. Remove SlickSync from Trakt’s Connected Apps as well to revoke access and free its connection slot."
                isLoading={busy}
                isOpen={confirm}
                onClose={() => setConfirm(false)}
                onConfirm={() => void disconnect()}
                title="Disconnect tracking service?"
                variant="danger"
            />
        </>
    );
}
