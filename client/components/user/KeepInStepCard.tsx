"use client";

// Keep in step (server/utils/watchCopy/keepInStep.js), at the bottom of Sync
// watch history: one switch per person, and for each of their sign-ins and
// profiles whether it sends and receives, only receives, or is left out -
// chosen from a small popup anchored to that row. "Recently moved" lists what
// it carried across.

import { CheckIcon, ChevronDownIcon } from "@heroicons/react/24/outline";
import { useCallback, useEffect, useRef, useState } from "react";
import { ToggleSwitch } from "@/components/ui";
import { toast } from "@/components/ui/Toast";
import { api, type KeepInStep, type KeepInStepMode } from "@/lib/api";

const MODE_LABEL: Record<KeepInStepMode, string> = {
    both: "⇄ Sends and receives",
    off: "Left out",
    receive: "← Only receives",
};

const LOOK: Record<string, string> = {
    aiometadata: "linear-gradient(135deg,#14b8a6,#0e7490)",
    aiostreams: "linear-gradient(135deg,#9f92ff,#5b4fd6)",
    jellyfin: "linear-gradient(135deg,#aa5cc3,#00a4dc)",
    nuvio: "linear-gradient(135deg,#38599e,#ff9800)",
    stremio: "linear-gradient(135deg,#8a5cf6,#5b3fd6)",
};

function ago(at: string) {
    const s = Math.max(0, (Date.now() - new Date(at).getTime()) / 1000);
    if (s < 3600) {
        return `${Math.max(1, Math.round(s / 60))}m ago`;
    }
    if (s < 86_400) {
        return `${Math.round(s / 3600)}h ago`;
    }
    return `${Math.round(s / 86_400)}d ago`;
}

function ModePicker({
    mode,
    onPick,
}: {
    mode: KeepInStepMode;
    onPick: (m: KeepInStepMode) => void;
}) {
    const [open, setOpen] = useState(false);
    const ref = useRef<HTMLDivElement>(null);
    useEffect(() => {
        if (!open) {
            return;
        }
        const down = (e: PointerEvent) => {
            if (ref.current && !ref.current.contains(e.target as Node)) {
                setOpen(false);
            }
        };
        const key = (e: KeyboardEvent) => {
            if (e.key === "Escape") {
                setOpen(false);
            }
        };
        document.addEventListener("pointerdown", down);
        document.addEventListener("keydown", key);
        return () => {
            document.removeEventListener("pointerdown", down);
            document.removeEventListener("keydown", key);
        };
    }, [open]);
    return (
        <div className="relative ml-auto shrink-0" ref={ref}>
            <button
                aria-expanded={open}
                className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border border-default px-2.5 py-1 text-xs ${mode === "off" ? "text-muted" : "text-default"}`}
                onClick={() => setOpen((o) => !o)}
                type="button"
            >
                {MODE_LABEL[mode]}
                <ChevronDownIcon className="h-3 w-3 opacity-60" />
            </button>
            {open && (
                <div
                    className="absolute right-0 z-30 mt-2 w-56 rounded-xl border border-default p-1.5 shadow-2xl"
                    style={{ background: "var(--color-surface)" }}
                >
                    {(["both", "receive", "off"] as KeepInStepMode[]).map((m) => (
                        <button
                            className="flex w-full items-center justify-between gap-2 rounded-lg px-3 py-2 text-left text-default text-sm hover:bg-surface-hover"
                            key={m}
                            onClick={() => {
                                setOpen(false);
                                onPick(m);
                            }}
                            type="button"
                        >
                            {MODE_LABEL[m]}
                            {m === mode && <CheckIcon className="h-4 w-4 text-primary" />}
                        </button>
                    ))}
                </div>
            )}
        </div>
    );
}

export function KeepInStepCard({ userId }: { userId: string }) {
    const [data, setData] = useState<KeepInStep | null>(null);
    const [saving, setSaving] = useState(false);

    const load = useCallback(() => {
        api.getKeepInStep(userId)
            .then(setData)
            .catch(() => setData(null));
    }, [userId]);
    useEffect(() => {
        load();
    }, [load]);

    const save = async (patch: {
        enabled?: boolean;
        members?: { side: string; mode: KeepInStepMode }[];
    }) => {
        setSaving(true);
        try {
            setData(await api.saveKeepInStep(userId, patch));
        } catch (e) {
            toast.error((e as Error)?.message || "Could not change Keep in step");
        } finally {
            setSaving(false);
        }
    };

    if (!data || data.places.length < 2) {
        return null;
    }
    const setMode = (side: string, mode: KeepInStepMode) =>
        save({
            members: data.places.map((p) => ({
                mode: p.side === side ? mode : p.mode,
                side: p.side,
            })),
        });

    return (
        <div
            className="relative overflow-hidden rounded-2xl"
            style={{
                backdropFilter: "blur(18px)",
                background: "color-mix(in srgb, var(--color-surface) 55%, transparent)",
                border: "1px solid var(--color-surface-border)",
            }}
        >
            <div
                aria-hidden="true"
                className="absolute top-0 right-0 left-0 h-[3px]"
                style={{
                    background:
                        "linear-gradient(90deg, var(--color-primary), var(--color-secondary))",
                }}
            />
            <div className="p-4">
                <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                        <div className="font-semibold text-default">Keep in step</div>
                        <div className="mt-0.5 text-muted text-sm">
                            From now on, whatever they finish or stop part-way on one sign-in shows
                            up on the others within a few minutes.
                        </div>
                    </div>
                    <div className="shrink-0 pt-0.5">
                        <ToggleSwitch
                            checked={data.enabled}
                            disabled={saving}
                            onChange={() => save({ enabled: !data.enabled })}
                            title={data.enabled ? "Turn Keep in step off" : "Turn Keep in step on"}
                        />
                    </div>
                </div>

                <div className="mt-3">
                    {data.places.map((p) => (
                        <div
                            className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5 border-default border-t py-2"
                            key={p.side}
                        >
                            <span
                                className="flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-lg font-bold text-white text-xs"
                                style={{ background: LOOK[p.kind] || LOOK.jellyfin }}
                            >
                                {p.name.slice(0, 1).toUpperCase()}
                            </span>
                            <span
                                className={`min-w-[8rem] flex-1 text-sm ${p.mode === "off" ? "text-muted" : "text-default"}`}
                            >
                                {p.name}
                                {p.profile && p.profile !== p.name ? ` · ${p.profile}` : ""}
                            </span>
                            <ModePicker mode={p.mode} onPick={(m) => setMode(p.side, m)} />
                        </div>
                    ))}
                </div>

                {data.enabled && (
                    <div className="mt-3 rounded-xl bg-surface-hover px-3 py-2.5">
                        <div className="mb-1 text-subtle text-xs">Recently moved</div>
                        {data.moves.length === 0 && (
                            <div className="py-1 text-muted text-xs">
                                Nothing yet - it checks every few minutes.
                            </div>
                        )}
                        {data.moves.slice(0, 8).map((m, i) => (
                            <div className="py-1 text-xs" key={`${m.at}-${i}`}>
                                <div className="flex gap-2">
                                    <span className="w-12 shrink-0 text-subtle">{ago(m.at)}</span>
                                    <span className="min-w-0 text-default">
                                        {m.title} — {m.what}
                                    </span>
                                </div>
                                <div className="pl-14 text-muted">
                                    {m.from} → {m.to.join(", ")}
                                </div>
                            </div>
                        ))}
                    </div>
                )}
                {data.enabled && data.lastError && (
                    <div className="mt-2 text-xs" style={{ color: "#f5a524" }}>
                        Last check: {data.lastError}
                    </div>
                )}
                <div className="mt-2.5 text-subtle text-xs">
                    Never moves anything backwards: a title further along on one side stays as it
                    is.
                </div>
            </div>
        </div>
    );
}
