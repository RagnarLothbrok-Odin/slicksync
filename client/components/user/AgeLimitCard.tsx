"use client";

// "Age limit": the highest rating someone may play (server/utils/ageLimits.js),
// as a card with its own switch under Daily limit and Bedtime in the Limits
// popup (LimitsButton). On a real Jellyfin server it is the server's own age
// limit, from the server's own rating list, so every Jellyfin app keeps to it
// (it needs an administrator's sign-in there). On Stremio, Nuvio, a Nuvio
// profile and AIOMetadata, SlickSync keeps it and its stream gate has nothing
// to play for a title rated above it. Where it can't be set - AIOStreams, a
// Nuvio profile on the main profile's addons - the card says why.

import { ShieldCheckIcon } from "@heroicons/react/24/outline";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { toast } from "@/components/ui/Toast";
import { chipClass, MiniSwitch } from "@/components/user/ScreenTimePanel";
import { type AgeLimitView, api } from "@/lib/api";

/** "PG, TV-PG" for the level set, or null for none. */
export function ageLimitLabel(state: AgeLimitView | null): string | null {
    if (state?.current == null) {
        return null;
    }
    return state.levels?.find((l) => l.value === state.current)?.label?.split(" · ")[0] || null;
}

export function AgeLimitCard({
    userId,
    name,
    onChange,
    onClose,
}: {
    userId: string;
    name: string;
    onChange?: (state: AgeLimitView) => void;
    onClose?: () => void;
}) {
    const [state, setState] = useState<AgeLimitView | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [saving, setSaving] = useState(false);
    // The level switched off last, so switching back on restores it.
    const lastLevel = useRef<number | null>(null);

    useEffect(() => {
        api.getAgeLimit(userId)
            .then(setState)
            .catch((e: any) => setError(e?.message || "Could not read the age limit"));
    }, [userId]);
    useEffect(() => {
        if (!state) {
            return;
        }
        if (state.current != null) {
            lastLevel.current = state.current;
        }
        onChange?.(state);
    }, [state]);

    const save = async (value: number | null, blockUnrated?: boolean) => {
        setSaving(true);
        try {
            setState(await api.setAgeLimit(userId, value, blockUnrated));
        } catch (e: any) {
            toast.error(e?.message || "Could not set the age limit");
        } finally {
            setSaving(false);
        }
    };

    const levels = state?.levels || [];
    const on = state?.current != null;
    const label = ageLimitLabel(state);
    // Switched on: the last level, or PG - the middle of the list - the first time.
    const startLevel = () =>
        lastLevel.current ?? levels.find((l) => l.value >= 10)?.value ?? levels[0]?.value ?? null;
    const settable = !!state?.available && !state.needsAdmin;
    const streams = state?.source === "streams";

    return (
        <div className="space-y-3 rounded-xl border border-default p-3">
            <div className="flex items-start justify-between gap-3">
                <div className="flex min-w-0 items-start gap-2">
                    <ShieldCheckIcon
                        className={`mt-0.5 h-4 w-4 shrink-0 ${on ? "text-primary" : "text-subtle"}`}
                    />
                    <div className="min-w-0">
                        <p className="font-medium text-default text-xs">Age limit</p>
                        <p className="text-muted text-xs leading-snug">
                            {on && label
                                ? `Nothing rated above ${label}`
                                : "The highest rating they may play"}
                        </p>
                    </div>
                </div>
                <MiniSwitch
                    checked={on}
                    disabled={!(state && settable) || saving}
                    label={on ? "Turn the age limit off" : "Turn the age limit on"}
                    onChange={(next) => save(next ? startLevel() : null)}
                />
            </div>

            {error && <p className="text-error text-xs">{error}</p>}
            {state && !state.available && (
                <p className="text-muted text-xs leading-snug">
                    {state.reason || "An age limit can’t be set here."}
                </p>
            )}
            {state?.needsAdmin && (
                <p className="text-muted text-xs leading-snug">
                    Jellyfin lets only administrators set this - add someone here who signs in to
                    that server as one.
                </p>
            )}

            {on && settable && (
                <>
                    <div>
                        <p className="mb-1 text-muted text-xs">Highest rating</p>
                        <div className="flex flex-wrap gap-1.5">
                            {levels.map((l) => (
                                <button
                                    aria-pressed={state?.current === l.value}
                                    className={chipClass(state?.current === l.value)}
                                    disabled={saving}
                                    key={l.value}
                                    onClick={() => save(l.value)}
                                    type="button"
                                >
                                    {l.label}
                                </button>
                            ))}
                        </div>
                    </div>
                    <label className="flex items-start gap-2 text-default text-xs">
                        <input
                            checked={!!state?.blockUnrated}
                            className="mt-0.5"
                            disabled={saving}
                            onChange={(e) => save(state?.current ?? null, e.target.checked)}
                            type="checkbox"
                        />
                        <span>
                            {streams
                                ? "Also block films and shows with no rating"
                                : "Hide films and shows with no rating"}
                        </span>
                    </label>
                    {streams && state?.needsKey && (
                        <p className="text-warning text-xs leading-snug">
                            Ratings come from OMDb, and there’s no OMDb key yet - until one is
                            added, every title counts as unrated.{" "}
                            <Link
                                className="underline"
                                href="/settings?highlight=OMDb%20API%20key"
                                onClick={onClose}
                            >
                                Add a key
                            </Link>
                        </p>
                    )}
                    {streams && state?.needsAddress && (
                        <p className="text-warning text-xs leading-snug">
                            It takes hold once phones and TVs can reach SlickSync.{" "}
                            {state?.addressProblem || ""}
                        </p>
                    )}
                    {streams && !state?.needsAddress && (
                        <p className="text-muted text-xs leading-snug">
                            {name}’s app needs reopening once, the first time a limit is set for
                            them. Catalogs stay; only playing is stopped.
                        </p>
                    )}
                </>
            )}
        </div>
    );
}
