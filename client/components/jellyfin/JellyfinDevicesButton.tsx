"use client";
import { readErrorMessage } from "@/lib/errors";

// "Devices": what is signed in as this person on their Jellyfin server, with
// Sign out next to each - an old TV, one at a friend's. Real Jellyfin servers
// only (AIOStreams and AIOMetadata keep no such list), and it needs an
// administrator's sign-in on that server (server/utils/jellyfinDevices.js).
// The same anchored popup as SignInTvButton beside it.

import { DevicePhoneMobileIcon } from "@heroicons/react/24/outline";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { toast } from "@/components/ui/Toast";
import { ActionPill } from "@/components/user/ActionPill";
import { type PopupPlacement, placePopup, popupStyle, useFitPopup } from "@/lib/anchoredPopup";
import { api, type JellyfinDevice } from "@/lib/api";

function ago(iso: string | null) {
    if (!iso) {
        return null;
    }
    const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60_000);
    if (!Number.isFinite(mins) || mins < 0) {
        return null;
    }
    if (mins < 2) {
        return "active now";
    }
    if (mins < 60) {
        return `${mins} min ago`;
    }
    const hours = Math.round(mins / 60);
    if (hours < 48) {
        return `${hours} h ago`;
    }
    return `${Math.round(hours / 24)} days ago`;
}

export function JellyfinDevicesButton({ userId, name }: { userId: string; name: string }) {
    const button = useRef<HTMLButtonElement>(null);
    const panel = useRef<HTMLDivElement>(null);
    const [anchor, setAnchor] = useState<PopupPlacement | null>(null);
    const [state, setState] = useState<{ needsAdmin: boolean; devices: JellyfinDevice[] } | null>(
        null
    );
    const [error, setError] = useState<string | null>(null);
    const [busy, setBusy] = useState<string | null>(null);

    const open = !!anchor;
    const close = () => setAnchor(null);

    const place = () => {
        const r = button.current?.getBoundingClientRect();
        if (!r) {
            return null;
        }
        return placePopup(r, 340, panel.current?.scrollHeight);
    };

    const load = () => {
        setError(null);
        api.getJellyfinDevices(userId)
            .then(setState)
            .catch((e: unknown) => setError(readErrorMessage(e, "Could not read the devices")));
    };

    const toggle = () => {
        if (open) {
            close();
            return;
        }
        const at = place();
        if (!at) {
            return;
        }
        setAnchor(at);
        load();
    };
    useFitPopup(panel, open, () => {
        const at = place();
        if (at) {
            setAnchor(at);
        }
    });

    useEffect(() => {
        if (!open) {
            return;
        }
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
    }, [open]);

    const signOut = async (d: JellyfinDevice) => {
        setBusy(d.id);
        try {
            await api.signOutJellyfinDevice(userId, d.id);
            toast.success(`${d.name} is signed out`);
            setState((s) => (s ? { ...s, devices: s.devices.filter((x) => x.id !== d.id) } : s));
        } catch (e) {
            toast.error(readErrorMessage(e, "Could not sign that device out"));
        } finally {
            setBusy(null);
        }
    };

    return (
        <>
            <ActionPill icon={DevicePhoneMobileIcon} onClick={toggle} open={open} ref={button}>
                Devices
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
                            aria-label={`Devices signed in as ${name}`}
                            className="fixed z-[9999] space-y-3 rounded-2xl border border-default p-4 shadow-2xl"
                            ref={panel}
                            role="dialog"
                            style={{ ...popupStyle(anchor), background: "var(--color-surface)" }}
                        >
                            <div>
                                <p className="font-semibold text-default text-sm">
                                    Signed in as {name}
                                </p>
                                <p className="mt-0.5 text-muted text-xs">
                                    Everything signed in to their Jellyfin server as them. Sign out
                                    an old or unknown one.
                                </p>
                            </div>
                            {error ? (
                                <p className="text-error text-xs">{error}</p>
                            ) : state ? (
                                state.needsAdmin ? (
                                    <p className="text-default text-xs">
                                        Jellyfin shows this list to administrators only. Add someone
                                        here who signs in to that server as an administrator, and it
                                        appears.
                                    </p>
                                ) : state.devices.length === 0 ? (
                                    <p className="text-muted text-xs">
                                        Nothing is signed in as {name}.
                                    </p>
                                ) : (
                                    <ul className="max-h-80 space-y-1.5 overflow-y-auto">
                                        {state.devices.map((d) => (
                                            <li
                                                className="flex items-center gap-3 rounded-xl bg-subtle p-2.5"
                                                key={d.id}
                                            >
                                                <div className="min-w-0 flex-1">
                                                    <p className="truncate text-default text-sm">
                                                        {d.slicksync ? "SlickSync" : d.name}
                                                    </p>
                                                    <p className="truncate text-[11px] text-muted">
                                                        {d.slicksync
                                                            ? "How SlickSync reads their viewing"
                                                            : [d.app, ago(d.lastActive)]
                                                                  .filter(Boolean)
                                                                  .join(" · ")}
                                                    </p>
                                                </div>
                                                {!d.slicksync && (
                                                    <button
                                                        className="shrink-0 rounded-lg px-2.5 py-1 text-error text-xs transition-colors hover:bg-error/10 disabled:opacity-40"
                                                        disabled={busy === d.id}
                                                        onClick={() => signOut(d)}
                                                        type="button"
                                                    >
                                                        {busy === d.id
                                                            ? "Signing out…"
                                                            : "Sign out"}
                                                    </button>
                                                )}
                                            </li>
                                        ))}
                                    </ul>
                                )
                            ) : (
                                <div className="space-y-2">
                                    {[0, 1].map((i) => (
                                        <div
                                            className="h-11 animate-pulse rounded-xl bg-surface-hover"
                                            key={i}
                                        />
                                    ))}
                                </div>
                            )}
                        </div>
                    </>,
                    document.body
                )}
        </>
    );
}
