"use client";
import { readErrorMessage } from "@/lib/errors";

// Opt-in, per AIOStreams person: when a debrid key changes in the Vault
// (rotated, a backup taking over, or swapped back), SlickSync also swaps it
// inside this person's AIOStreams configuration (server/utils/aioServiceKeys.js).
// Off by default - it is a write to their AIOStreams setup. Renders nothing
// for anyone who doesn't sign in with AIOStreams.

import { KeyIcon } from "@heroicons/react/24/outline";
import { useEffect, useState } from "react";
import { ToggleSwitch } from "@/components/ui";
import { toast } from "@/components/ui/Toast";
import { api } from "@/lib/api";

export function AioRotateKeysRow({ userId, name }: { userId: string; name: string }) {
    const [state, setState] = useState<{
        available: boolean;
        canWrite?: boolean;
        enabled?: boolean;
    } | null>(null);
    const [saving, setSaving] = useState(false);

    useEffect(() => {
        api.getAioRotateKeys(userId)
            .then(setState)
            .catch(() => setState(null));
    }, [userId]);

    if (!state?.available) {
        return null;
    }

    const toggle = async () => {
        setSaving(true);
        try {
            const next = await api.setAioRotateKeys(userId, !state.enabled);
            setState(next);
            toast.success(
                next.enabled
                    ? `Vault key changes will update ${name}'s AIOStreams`
                    : `Vault key changes leave ${name}'s AIOStreams alone`
            );
        } catch (e) {
            toast.error(readErrorMessage(e, "Could not change that"));
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
                        <KeyIcon className="h-5 w-5 text-primary" />
                    </div>
                    <div className="min-w-0">
                        <h4 className="font-semibold text-default">
                            Update debrid keys in AIOStreams
                        </h4>
                        <p className="text-muted text-sm">
                            {state.canWrite
                                ? `When a debrid key changes in the Vault - rotated, or a backup taking over - swap it inside ${name}'s AIOStreams setup too. Nothing else there is touched.`
                                : `Needs ${name}'s AIOStreams configuration password - sign them in again with it to use this.`}
                        </p>
                    </div>
                </div>
                <ToggleSwitch
                    checked={!!state.enabled}
                    disabled={saving || !state.canWrite}
                    onChange={toggle}
                    title="Update debrid keys in AIOStreams"
                />
            </div>
        </>
    );
}
