"use client";

import { type ReactNode, useState } from "react";
import { Button } from "@/components/ui";
import { readErrorMessage } from "@/lib/errors";
import { useUserAuthHeaders } from "@/lib/hooks/useUserAuth";
import { personalRequest } from "@/lib/user-api";

interface Service {
    configured: boolean;
    connected: boolean;
    username: string | null;
}

export function TrackingServiceRow({
    provider,
    service,
    disabled,
    onBusyChange,
    onChange,
    children,
}: {
    provider: "trakt" | "simkl" | "mdblist";
    service: Service | undefined;
    disabled: boolean;
    onBusyChange: (busy: boolean) => void;
    onChange: () => void;
    children: ReactNode;
}) {
    const { userId, authKey } = useUserAuthHeaders();
    const [busy, setBusy] = useState(false);
    const [failure, setFailure] = useState("");
    const name = provider === "trakt" ? "Trakt" : provider === "simkl" ? "Simkl" : "MDBList";
    async function act() {
        if (!(userId && authKey && service) || disabled || busy) {
            return;
        }
        setBusy(true);
        onBusyChange(true);
        setFailure("");
        try {
            if (service.connected) {
                await personalRequest(userId, authKey, `/tracking-services/${provider}`, {
                    method: "DELETE",
                });
                onChange();
            } else {
                const result = await personalRequest<{ url: string }>(
                    userId,
                    authKey,
                    `/tracking-services/${provider}/authorize`,
                    { body: "{}", method: "POST" }
                );
                window.location.assign(result.url);
            }
        } catch (reason) {
            setFailure(readErrorMessage(reason, `Could not update the ${name} connection.`));
        } finally {
            setBusy(false);
            onBusyChange(false);
        }
    }
    return (
        <div className="settings-row">
            <div className="flex items-center justify-between gap-4">
                <div className="min-w-0">
                    <h3 className="font-semibold text-base text-default tracking-tight">{name}</h3>
                    <p className="mt-1 break-words text-muted text-sm">
                        {service
                            ? service.connected
                                ? service.username || "Connected"
                                : "Not connected"
                            : "Loading…"}
                    </p>
                </div>
                <Button
                    aria-label={`${service?.connected ? "Disconnect" : "Connect"} ${name}`}
                    className="shrink-0"
                    disabled={disabled || !service || !(service.connected || service.configured)}
                    isLoading={busy}
                    onClick={() => void act()}
                    size="sm"
                    variant={service?.connected ? "secondary" : "primary"}
                >
                    {service?.connected ? "Disconnect" : "Connect"}
                </Button>
            </div>
            {service && !service.connected && children}
            {service && !service.connected && !service.configured && (
                <p className="mt-3 text-muted text-sm">
                    Your administrator needs to configure the {name} tracking app before you can
                    connect.
                </p>
            )}
            {failure && (
                <p className="mt-3 text-error text-sm" role="alert">
                    {failure}
                </p>
            )}
        </div>
    );
}
