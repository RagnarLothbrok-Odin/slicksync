"use client";

// "Sign in a TV": a Jellyfin app on a TV (or anywhere) offers Quick Connect
// and shows a short code. Typed here, SlickSync approves it with the chosen
// person's or household profile's sign-in, and the server signs the device in
// as them - no password typed on a remote. An anchored popup, like the rest
// of SlickSync's small menus; closes on a tap outside or Escape, and follows
// its button on scroll and resize rather than closing - on a phone, the
// keyboard opening for the code box is a resize.

import { TvIcon } from "@heroicons/react/24/outline";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Button } from "@/components/ui";
import { toast } from "@/components/ui/Toast";
import { ActionPill } from "@/components/user/ActionPill";
import { type PopupPlacement, placePopup, popupStyle, useFitPopup } from "@/lib/anchoredPopup";
import { api, type HouseholdProfile } from "@/lib/api";

interface Who {
    id: string | null;
    name: string;
    ready: boolean;
    hint?: string;
}

export function SignInTvButton({ userId, name }: { userId: string; name: string }) {
    const button = useRef<HTMLButtonElement>(null);
    const panel = useRef<HTMLDivElement>(null);
    const [anchor, setAnchor] = useState<PopupPlacement | null>(null);
    const [profiles, setProfiles] = useState<HouseholdProfile[] | null>(null);
    const [who, setWho] = useState<string | null>(null);
    const [code, setCode] = useState("");
    const [busy, setBusy] = useState(false);

    const open = !!anchor;
    const close = () => {
        setAnchor(null);
        setCode("");
    };

    const place = () => {
        const r = button.current?.getBoundingClientRect();
        if (!r) {
            return null;
        }
        return placePopup(r, 320, panel.current?.scrollHeight);
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
        if (profiles === null) {
            api.getHousehold(userId)
                .then((h) => setProfiles(h.profiles || []))
                .catch(() => setProfiles([]));
        }
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

    // The person, then their household profiles. A profile SlickSync has no
    // sign-in for yet can't approve a code - shown, but not pickable.
    const choices: Who[] = [
        { id: null, name, ready: true },
        ...(profiles || [])
            .filter((p) => p.status !== "own")
            .map((p) => ({
                hint:
                    p.status === "needs-pin"
                        ? "Sign in with their PIN on the Users page first"
                        : p.status === "needs-sign-in"
                          ? "Sign them in on the Users page first"
                          : undefined,
                id: p.id,
                name: p.name,
                ready: p.status === "tracked" || p.status === "untracked",
            })),
    ];
    const chosen = choices.find((c) => c.id === who) || choices[0];

    const submit = async () => {
        const digits = code.replace(/\D/g, "");
        if (digits.length < 4) {
            toast.error("Type the code the TV shows");
            return;
        }
        setBusy(true);
        try {
            const r = await api.authorizeQuickConnect(userId, digits, chosen.id);
            toast.success(`The TV is signing in as ${r.who}`);
            close();
        } catch (e: any) {
            toast.error(e?.message || "That didn't work");
        } finally {
            setBusy(false);
        }
    };

    return (
        <>
            <ActionPill icon={TvIcon} onClick={toggle} open={open} ref={button}>
                Sign in a TV
            </ActionPill>
            {open &&
                anchor &&
                typeof document !== "undefined" &&
                createPortal(
                    <>
                        <div className="fixed inset-0 z-[9998]" onClick={close} />
                        <div
                            aria-label="Sign in a TV"
                            className="fixed z-[9999] space-y-3 rounded-2xl border border-default p-4 shadow-2xl"
                            ref={panel}
                            role="dialog"
                            style={{ ...popupStyle(anchor), background: "var(--color-surface)" }}
                        >
                            <div>
                                <p className="font-semibold text-default text-sm">Sign in a TV</p>
                                <p className="mt-0.5 text-muted text-xs">
                                    On the TV, choose Quick Connect &ndash; it shows a code. Type it
                                    here.
                                </p>
                            </div>
                            {choices.length > 1 && (
                                <div className="flex flex-wrap gap-1.5">
                                    {choices.map((c) => {
                                        const on = c.id === chosen.id;
                                        return (
                                            <button
                                                aria-pressed={on}
                                                className={`rounded-lg border px-2.5 py-1 text-xs transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
                                                    on
                                                        ? "border-primary bg-primary/10 text-default"
                                                        : "border-default text-subtle hover:bg-surface-hover hover:text-default"
                                                }`}
                                                disabled={!c.ready}
                                                key={c.id || "self"}
                                                onClick={() => setWho(c.id)}
                                                title={c.hint}
                                                type="button"
                                            >
                                                {c.name}
                                            </button>
                                        );
                                    })}
                                </div>
                            )}
                            <input
                                aria-label="Code on the TV"
                                autoComplete="one-time-code"
                                autoFocus
                                className="w-full rounded-xl px-4 py-3 text-center font-mono text-2xl tracking-[0.3em]"
                                inputMode="numeric"
                                onChange={(e) =>
                                    setCode(e.target.value.replace(/[^\d\s-]/g, "").slice(0, 12))
                                }
                                onKeyDown={(e) => {
                                    if (e.key === "Enter") {
                                        submit();
                                    }
                                }}
                                placeholder="123456"
                                style={{
                                    background: "var(--color-bg)",
                                    border: "1px solid var(--color-surface-border)",
                                    color: "var(--color-text)",
                                }}
                                value={code}
                            />
                            <Button
                                className="w-full"
                                isLoading={busy}
                                onClick={submit}
                                size="sm"
                                variant="primary"
                            >
                                Sign in as {chosen.name}
                            </Button>
                        </div>
                    </>,
                    document.body
                )}
        </>
    );
}
