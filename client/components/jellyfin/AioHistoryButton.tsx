"use client";
import { readErrorMessage } from "@/lib/errors";

// "AIOStreams history": every version of this person's AIOStreams
// configuration SlickSync has seen, what changed between them, and putting
// an earlier one back (server/utils/aioConfigHistory.js). The change alert
// links here with ?aioHistory=1, which opens it. Same anchored popup as the
// other pills beside it.

import { ArrowUturnLeftIcon } from "@heroicons/react/24/outline";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Button, Modal } from "@/components/ui";
import { toast } from "@/components/ui/Toast";
import { ActionPill } from "@/components/user/ActionPill";
import { type PopupPlacement, placePopup, popupStyle, useFitPopup } from "@/lib/anchoredPopup";
import { type AioHistory, api } from "@/lib/api";

const REASON: Record<string, string> = {
    pause: "Streaming paused by SlickSync",
    restore: "Put back",
    seen: "Seen",
    slicksync: "Changed by SlickSync",
    unpause: "Streaming back on",
};

export function AioHistoryButton({ userId, name }: { userId: string; name: string }) {
    const button = useRef<HTMLButtonElement>(null);
    const panel = useRef<HTMLDivElement>(null);
    const [anchor, setAnchor] = useState<PopupPlacement | null>(null);
    const [state, setState] = useState<AioHistory | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [restoring, setRestoring] = useState<AioHistory["versions"][number] | null>(null);
    const [keep, setKeep] = useState({ apiKeys: true, services: true, users: true });
    const [busy, setBusy] = useState(false);

    const open = !!anchor;
    const close = () => setAnchor(null);
    const place = () => {
        const r = button.current?.getBoundingClientRect();
        if (!r) {
            return null;
        }
        return placePopup(r, 380, panel.current?.scrollHeight);
    };
    const toggle = () => {
        if (open) {
            close();
            return;
        }
        const at = place();
        if (at) {
            setAnchor(at);
        }
    };
    useFitPopup(panel, open, () => {
        const at = place();
        if (at) {
            setAnchor(at);
        }
    });

    // The change alert links here with ?aioHistory=1.
    useEffect(() => {
        if (typeof window === "undefined") {
            return;
        }
        if (new URLSearchParams(window.location.search).get("aioHistory") !== "1") {
            return;
        }
        const t = setTimeout(() => {
            const at = place();
            if (at) {
                setAnchor(at);
            }
        }, 300);
        return () => clearTimeout(t);
    }, []);

    useEffect(() => {
        if (!open) {
            return;
        }
        setError(null);
        api.getAioHistory(userId)
            .then(setState)
            .catch((e: unknown) => setError(readErrorMessage(e, "Could not read the history")));
        const onKey = (e: KeyboardEvent) => {
            if (e.key === "Escape") {
                close();
            }
        };
        const onMove = () => {
            const at = place();
            if (at) {
                setAnchor(at);
            }
        };
        window.addEventListener("keydown", onKey);
        window.addEventListener("resize", onMove);
        window.addEventListener("scroll", onMove, true);
        return () => {
            window.removeEventListener("keydown", onKey);
            window.removeEventListener("resize", onMove);
            window.removeEventListener("scroll", onMove, true);
        };
    }, [open, userId]);

    const doRestore = async () => {
        if (!restoring) {
            return;
        }
        setBusy(true);
        try {
            setState(await api.restoreAioVersion(userId, restoring.id, keep));
            toast.success(`${name}'s AIOStreams configuration is back to how it was`);
            setRestoring(null);
        } catch (e) {
            toast.error(readErrorMessage(e, "Could not put that version back"));
        } finally {
            setBusy(false);
        }
    };

    return (
        <>
            <ActionPill icon={ArrowUturnLeftIcon} onClick={toggle} open={open} ref={button}>
                AIOStreams history
            </ActionPill>
            {open &&
                anchor &&
                typeof document !== "undefined" &&
                createPortal(
                    <>
                        <button
                            aria-label="Close popup"
                            className="fixed inset-0 z-[9998] border-0 bg-transparent p-0"
                            onClick={close}
                            tabIndex={-1}
                            type="button"
                        />
                        <div
                            aria-label={`AIOStreams history for ${name}`}
                            className="fixed z-[9999] space-y-3 rounded-2xl border border-default p-4 shadow-2xl"
                            ref={panel}
                            role="dialog"
                            style={{ ...popupStyle(anchor), background: "var(--color-surface)" }}
                        >
                            <div>
                                <p className="font-semibold text-default text-sm">
                                    AIOStreams history for {name}
                                </p>
                                <p className="mt-0.5 text-muted text-xs">
                                    Every version of their configuration SlickSync has seen, newest
                                    first.
                                </p>
                            </div>
                            {error ? (
                                <p className="text-error text-xs">{error}</p>
                            ) : state ? (
                                state.available ? (
                                    state.versions.length === 0 ? (
                                        <p className="text-subtle text-xs">
                                            Nothing kept yet - the configuration is read every 30
                                            minutes.
                                        </p>
                                    ) : (
                                        <div className="space-y-2">
                                            {state.versions.map((v) => (
                                                <div
                                                    className="space-y-1 rounded-xl px-3 py-2 text-xs"
                                                    key={v.id}
                                                    style={{
                                                        background: "var(--color-surface-hover)",
                                                    }}
                                                >
                                                    <div className="flex items-center justify-between gap-2">
                                                        <span className="text-default">
                                                            {new Date(v.at).toLocaleString(
                                                                undefined,
                                                                {
                                                                    dateStyle: "medium",
                                                                    timeStyle: "short",
                                                                }
                                                            )}{" "}
                                                            · {REASON[v.reason] || v.reason}
                                                            {v.current ? " · now" : ""}
                                                        </span>
                                                        {!v.current && (
                                                            <button
                                                                className="shrink-0 whitespace-nowrap rounded-md border border-default px-2 py-0.5 text-[11px] text-default hover:bg-surface"
                                                                // The confirmation is a dialog of its own; the popup would sit on top of it.
                                                                onClick={() => {
                                                                    setRestoring(v);
                                                                    close();
                                                                }}
                                                                type="button"
                                                            >
                                                                Put back
                                                            </button>
                                                        )}
                                                    </div>
                                                    <p className="text-subtle">
                                                        {v.addons} addons · {v.services} services ·{" "}
                                                        {v.users} household users
                                                    </p>
                                                    {v.changes.length > 0 && (
                                                        <p className="text-muted">
                                                            Since the one before:{" "}
                                                            {v.changes.join(", ")}
                                                        </p>
                                                    )}
                                                </div>
                                            ))}
                                        </div>
                                    )
                                ) : (
                                    <p className="text-default text-xs">
                                        Only for someone added with their AIOStreams configuration
                                        password.
                                    </p>
                                )
                            ) : (
                                <div className="h-24 animate-pulse rounded-xl bg-surface-hover" />
                            )}
                        </div>
                    </>,
                    document.body
                )}

            <Modal
                isOpen={!!restoring}
                onClose={() => {
                    if (!busy) {
                        setRestoring(null);
                    }
                }}
                title={
                    restoring
                        ? `Put ${name}'s configuration back to ${new Date(restoring.at).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}?`
                        : ""
                }
            >
                <div className="space-y-4">
                    <p className="text-muted text-sm">
                        Its addons, filters and settings come back. Keep what is there now for:
                    </p>
                    <div className="space-y-2">
                        {(
                            [
                                ["services", "Debrid services and their keys"],
                                ["users", "Household users and PINs"],
                                ["apiKeys", "API keys"],
                            ] as const
                        ).map(([k, label]) => (
                            <label className="flex items-center gap-2 text-default text-sm" key={k}>
                                <input
                                    checked={keep[k]}
                                    onChange={(e) =>
                                        setKeep((cur) => ({ ...cur, [k]: e.target.checked }))
                                    }
                                    type="checkbox"
                                />
                                {label}
                            </label>
                        ))}
                    </div>
                    <div className="flex justify-end gap-3">
                        <Button
                            disabled={busy}
                            onClick={() => setRestoring(null)}
                            type="button"
                            variant="secondary"
                        >
                            Cancel
                        </Button>
                        <Button
                            isLoading={busy}
                            onClick={doRestore}
                            type="button"
                            variant="primary"
                        >
                            Put it back
                        </Button>
                    </div>
                </div>
            </Modal>
        </>
    );
}
