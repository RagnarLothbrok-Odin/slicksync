"use client";

import {
    ArrowsUpDownIcon,
    CheckCircleIcon,
    MinusIcon,
    PlusIcon,
} from "@heroicons/react/24/outline";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { api } from "@/lib/api";

// "Show me what this will do before it does it" for a user sync.
//
// Syncing rewrites a real Stremio/Nuvio account's addon list. Until now the
// button just did it, so the only way to find out what changed was to compare
// before and after from memory. This turns it into a decision: exactly which
// addons get added, removed, or reordered, then an explicit confirm.
//
// Deliberately built on the EXISTING /users/:id/sync-plan endpoint rather
// than a new one - that route already computes current vs desired using the
// same comparator the sync badge uses, so the preview can never disagree with
// what the sync actually does. The diff below is purely a presentation of
// that response.

interface SyncPreviewDialogProps {
    isOpen: boolean;
    onClose: () => void;
    /** Runs the real sync. The dialog closes itself first. */
    onConfirm: () => void | Promise<void>;
    userId: string;
    userName: string;
}

interface PlanEntry {
    fingerprint: string;
    name: string;
    transportUrl: string;
}

export function SyncPreviewDialog({
    isOpen,
    onClose,
    userId,
    userName,
    onConfirm,
}: SyncPreviewDialogProps) {
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [plan, setPlan] = useState<{
        alreadySynced: boolean;
        current: PlanEntry[];
        desired: PlanEntry[];
    } | null>(null);
    const [confirming, setConfirming] = useState(false);

    useEffect(() => {
        if (!isOpen) {
            setPlan(null);
            setError(null);
            return;
        }
        let cancelled = false;
        setLoading(true);
        api.getUserSyncPlan(userId)
            .then((p) => {
                if (!cancelled) {
                    setPlan(p);
                }
            })
            .catch((e) => {
                if (!cancelled) {
                    setError(
                        e instanceof Error ? e.message : "Could not work out what would change"
                    );
                }
            })
            .finally(() => {
                if (!cancelled) {
                    setLoading(false);
                }
            });
        return () => {
            cancelled = true;
        };
    }, [isOpen, userId]);

    // Matched on transportUrl rather than fingerprint: fingerprint folds in
    // position, so a pure reorder would otherwise read as "remove everything,
    // add everything back" - which is exactly the panic this dialog exists to
    // prevent.
    const currentUrls = new Set((plan?.current || []).map((a) => a.transportUrl));
    const desiredUrls = new Set((plan?.desired || []).map((a) => a.transportUrl));
    const added = (plan?.desired || []).filter((a) => !currentUrls.has(a.transportUrl));
    const removed = (plan?.current || []).filter((a) => !desiredUrls.has(a.transportUrl));
    // Same set on both sides but a different order = reorder only.
    const keptCurrent = (plan?.current || [])
        .filter((a) => desiredUrls.has(a.transportUrl))
        .map((a) => a.transportUrl);
    const keptDesired = (plan?.desired || [])
        .filter((a) => currentUrls.has(a.transportUrl))
        .map((a) => a.transportUrl);
    const reordered =
        keptCurrent.length === keptDesired.length &&
        keptCurrent.some((url, i) => url !== keptDesired[i]);

    const nothingToDo = !!plan && added.length === 0 && removed.length === 0 && !reordered;

    const handleConfirm = async () => {
        setConfirming(true);
        try {
            await onConfirm();
            onClose();
        } finally {
            setConfirming(false);
        }
    };

    return (
        <Modal isOpen={isOpen} onClose={onClose} size="lg" title={`Sync ${userName}`}>
            <div className="space-y-4">
                {loading && (
                    <p className="py-4 text-center text-muted text-sm">
                        Working out what would change...
                    </p>
                )}

                {error && (
                    <div
                        className="rounded-lg p-3 text-sm"
                        style={{
                            background: "color-mix(in srgb, var(--color-error) 12%, transparent)",
                            color: "var(--color-text)",
                        }}
                    >
                        {error}
                        <p className="mt-1 text-muted text-xs">
                            You can still sync - this preview just could not be built.
                        </p>
                    </div>
                )}

                {plan && nothingToDo && (
                    <div
                        className="flex items-center gap-2 rounded-lg p-3"
                        style={{ background: "var(--color-surface-hover)" }}
                    >
                        <CheckCircleIcon
                            className="h-5 w-5 shrink-0"
                            style={{ color: "var(--color-success)" }}
                        />
                        <p className="text-default text-sm">
                            Already up to date - syncing would not change anything.
                        </p>
                    </div>
                )}

                {plan && !nothingToDo && (
                    <>
                        <p className="text-muted text-sm">
                            This will change {userName}&apos;s addons on their actual Stremio/Nuvio
                            account:
                        </p>
                        <div className="max-h-72 space-y-3 overflow-y-auto pr-1">
                            {added.length > 0 && (
                                <div>
                                    <p
                                        className="mb-1.5 font-semibold text-xs"
                                        style={{ color: "var(--color-success)" }}
                                    >
                                        <PlusIcon className="mr-1 inline h-3.5 w-3.5" />
                                        {added.length} to add
                                    </p>
                                    <ul className="space-y-1">
                                        {added.map((a) => (
                                            <li
                                                className="truncate pl-5 text-default text-sm"
                                                key={a.transportUrl}
                                            >
                                                {a.name}
                                            </li>
                                        ))}
                                    </ul>
                                </div>
                            )}
                            {removed.length > 0 && (
                                <div>
                                    <p
                                        className="mb-1.5 font-semibold text-xs"
                                        style={{ color: "var(--color-error)" }}
                                    >
                                        <MinusIcon className="mr-1 inline h-3.5 w-3.5" />
                                        {removed.length} to remove
                                    </p>
                                    <ul className="space-y-1">
                                        {removed.map((a) => (
                                            <li
                                                className="truncate pl-5 text-default text-sm"
                                                key={a.transportUrl}
                                            >
                                                {a.name}
                                            </li>
                                        ))}
                                    </ul>
                                </div>
                            )}
                            {reordered && (
                                <div>
                                    <p className="mb-1.5 font-semibold text-muted text-xs">
                                        <ArrowsUpDownIcon className="mr-1 inline h-3.5 w-3.5" />
                                        Addon order will change
                                    </p>
                                    <p className="pl-5 text-muted text-xs">
                                        The same addons, in a different order.
                                    </p>
                                </div>
                            )}
                        </div>
                    </>
                )}

                <div className="flex justify-end gap-2 pt-1">
                    <Button disabled={confirming} onClick={onClose} size="sm" variant="ghost">
                        Cancel
                    </Button>
                    <Button
                        disabled={loading}
                        isLoading={confirming}
                        onClick={handleConfirm}
                        size="sm"
                        variant="primary"
                    >
                        {nothingToDo ? "Sync anyway" : "Sync now"}
                    </Button>
                </div>
            </div>
        </Modal>
    );
}
