"use client";
import { readErrorMessage } from "@/lib/errors";

// "AIOStreams health": what AIOStreams itself says about this person's
// configuration - which addons it sees failing, coming back empty, slow or
// redundant (its own words), and which apps use it - plus a one-off "test
// this title" search (server/utils/aioHealth.js). Same anchored popup as
// Devices and Age limit beside it. Read-only.

import { HeartIcon } from "@heroicons/react/24/outline";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { toast } from "@/components/ui/Toast";
import { ActionPill } from "@/components/user/ActionPill";
import { type PopupPlacement, placePopup, popupStyle, useFitPopup } from "@/lib/anchoredPopup";
import { type AioHealth, type AioTestSearch, api } from "@/lib/api";

export function AioHealthButton({ userId, name }: { userId: string; name: string }) {
    const button = useRef<HTMLButtonElement>(null);
    const panel = useRef<HTMLDivElement>(null);
    const [anchor, setAnchor] = useState<PopupPlacement | null>(null);
    const [range, setRange] = useState<"24h" | "7d">("24h");
    const [state, setState] = useState<AioHealth | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [testId, setTestId] = useState("");
    const [testType, setTestType] = useState<"movie" | "series">("movie");
    const [testing, setTesting] = useState(false);
    const [result, setResult] = useState<{ label: string; data: AioTestSearch } | null>(null);

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

    // Read when opened (and when the range changes) - it asks AIOStreams.
    useEffect(() => {
        if (!open) {
            return;
        }
        setError(null);
        api.getAioHealth(userId, range)
            .then(setState)
            .catch((e: any) => setError(e?.message || "Could not read AIOStreams"));
    }, [open, range, userId]);

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

    const runTest = async (type: "movie" | "series", id: string, label: string) => {
        setTesting(true);
        setResult(null);
        try {
            setResult({ data: await api.runAioTestSearch(userId, type, id), label });
        } catch (e) {
            toast.error(readErrorMessage(e, "Could not run the search"));
        } finally {
            setTesting(false);
        }
    };

    const a = state?.analytics;

    return (
        <>
            <ActionPill icon={HeartIcon} onClick={toggle} open={open} ref={button}>
                AIOStreams health
            </ActionPill>
            {open &&
                anchor &&
                typeof document !== "undefined" &&
                createPortal(
                    <>
                        <div className="fixed inset-0 z-[9998]" onClick={close} />
                        <div
                            aria-label={`AIOStreams health for ${name}`}
                            className="fixed z-[9999] space-y-3 rounded-2xl border border-default p-4 shadow-2xl"
                            ref={panel}
                            role="dialog"
                            style={{ ...popupStyle(anchor), background: "var(--color-surface)" }}
                        >
                            <div>
                                <p className="font-semibold text-default text-sm">
                                    AIOStreams health for {name}
                                </p>
                                <p className="mt-0.5 text-muted text-xs">
                                    What AIOStreams itself reports about their configuration.
                                </p>
                            </div>

                            {error ? (
                                <p className="text-error text-xs">{error}</p>
                            ) : state ? (
                                state.canRead ? (
                                    <>
                                        {/* Addons, as AIOStreams sees them. */}
                                        <div className="space-y-2">
                                            <div className="flex items-center justify-between gap-2">
                                                <p className="font-semibold text-default text-xs">
                                                    Addons
                                                </p>
                                                {state.analyticsEnabled && (
                                                    <div className="flex gap-1">
                                                        {(["24h", "7d"] as const).map((r) => (
                                                            <button
                                                                aria-pressed={range === r}
                                                                className={`rounded-md border px-2 py-0.5 text-[11px] ${range === r ? "border-primary bg-primary/10 text-default" : "border-default text-subtle hover:bg-surface-hover"}`}
                                                                key={r}
                                                                onClick={() => setRange(r)}
                                                                type="button"
                                                            >
                                                                {r === "24h"
                                                                    ? "Last day"
                                                                    : "Last week"}
                                                            </button>
                                                        ))}
                                                    </div>
                                                )}
                                            </div>
                                            {state.analyticsEnabled ? (
                                                state.analyticsError ? (
                                                    <p className="text-error text-xs">
                                                        {state.analyticsError}
                                                    </p>
                                                ) : !a || a.addons.length === 0 ? (
                                                    <p className="text-subtle text-xs">
                                                        Nothing searched through it in this time
                                                        yet.
                                                    </p>
                                                ) : (
                                                    <>
                                                        <p className="text-subtle text-xs">
                                                            {a.requests} search
                                                            {a.requests === 1 ? "" : "es"} ·{" "}
                                                            {a.errorRate}% failed
                                                        </p>
                                                        <div className="space-y-1.5">
                                                            {a.addons.map((x) => (
                                                                <div
                                                                    className="flex items-start justify-between gap-2 text-xs"
                                                                    key={`${x.name}-${x.preset}`}
                                                                >
                                                                    <div className="min-w-0">
                                                                        <p className="truncate text-default">
                                                                            {x.name}
                                                                        </p>
                                                                        <p className="text-subtle">
                                                                            {x.requests} search
                                                                            {x.requests === 1
                                                                                ? ""
                                                                                : "es"}{" "}
                                                                            · {x.errorRate}% errors
                                                                            · {x.emptyRate}% empty
                                                                            {x.avgLatencyMs === null
                                                                                ? ""
                                                                                : ` · ${(x.avgLatencyMs / 1000).toFixed(1)}s`}
                                                                        </p>
                                                                    </div>
                                                                    <div className="flex flex-shrink-0 flex-wrap justify-end gap-1">
                                                                        {x.errorRate >= 20 && (
                                                                            <span className="rounded-md bg-error/15 px-1.5 py-0.5 text-[10px] text-error">
                                                                                Failing
                                                                            </span>
                                                                        )}
                                                                        {x.slow && (
                                                                            <span
                                                                                className="rounded-md bg-warning/15 px-1.5 py-0.5 text-[10px] text-warning"
                                                                                title="AIOStreams’ own label: cut off for taking too long on many searches"
                                                                            >
                                                                                Slow
                                                                            </span>
                                                                        )}
                                                                        {x.redundant && (
                                                                            <span
                                                                                className="rounded-md bg-surface-hover px-1.5 py-0.5 text-[10px] text-subtle"
                                                                                title="AIOStreams’ own label: its results are almost always cut or duplicated by other addons"
                                                                            >
                                                                                Redundant
                                                                            </span>
                                                                        )}
                                                                    </div>
                                                                </div>
                                                            ))}
                                                        </div>
                                                        <p className="text-[11px] text-subtle">
                                                            Slow and Redundant are AIOStreams’ own
                                                            labels.
                                                        </p>
                                                    </>
                                                )
                                            ) : (
                                                <p className="text-subtle text-xs">
                                                    This AIOStreams doesn’t share per-addon stats -
                                                    its owner has user analytics turned off. A test
                                                    search below still shows what each addon finds.
                                                </p>
                                            )}
                                        </div>

                                        {(state.apps?.length ?? 0) > 0 && (
                                            <div>
                                                <p className="mb-1 font-semibold text-default text-xs">
                                                    Apps using it
                                                </p>
                                                <p className="text-subtle text-xs">
                                                    {(state.apps ?? [])
                                                        .map((x) => x.name)
                                                        .join(" · ")}
                                                </p>
                                            </div>
                                        )}

                                        {/* A real search through every addon and debrid service. */}
                                        {state.searchAvailable !== false && (
                                            <div className="space-y-2 border-default border-t pt-2">
                                                <p className="font-semibold text-default text-xs">
                                                    Test a title
                                                </p>
                                                <p className="text-[11px] text-subtle">
                                                    Searches every addon and debrid service the way
                                                    playing would - one at a time.
                                                </p>
                                                {(state.recent?.length ?? 0) > 0 && (
                                                    <div className="flex flex-wrap gap-1.5">
                                                        {(state.recent ?? []).map((t) => (
                                                            <button
                                                                className="rounded-lg border border-default px-2.5 py-1 text-subtle text-xs hover:bg-surface-hover hover:text-default disabled:opacity-50"
                                                                disabled={testing}
                                                                key={t.id}
                                                                onClick={() =>
                                                                    runTest(t.type, t.id, t.name)
                                                                }
                                                                type="button"
                                                            >
                                                                {t.name}
                                                            </button>
                                                        ))}
                                                    </div>
                                                )}
                                                <form
                                                    className="flex gap-1.5"
                                                    onSubmit={(e) => {
                                                        e.preventDefault();
                                                        if (testId.trim()) {
                                                            runTest(
                                                                testType,
                                                                testId.trim(),
                                                                testId.trim()
                                                            );
                                                        }
                                                    }}
                                                >
                                                    <select
                                                        className="rounded-lg border border-default bg-surface-hover px-2 py-1.5 text-default text-xs"
                                                        onChange={(e) =>
                                                            setTestType(
                                                                e.target.value === "series"
                                                                    ? "series"
                                                                    : "movie"
                                                            )
                                                        }
                                                        value={testType}
                                                    >
                                                        <option value="movie">Film</option>
                                                        <option value="series">Episode</option>
                                                    </select>
                                                    <input
                                                        className="min-w-0 flex-1 rounded-lg border border-default bg-surface-hover px-2.5 py-1.5 text-default text-xs"
                                                        onChange={(e) => setTestId(e.target.value)}
                                                        placeholder={
                                                            testType === "series"
                                                                ? "tt0903747:1:1"
                                                                : "tt0133093"
                                                        }
                                                        value={testId}
                                                    />
                                                    <button
                                                        className="rounded-lg border border-default px-2.5 py-1.5 text-default text-xs hover:bg-surface-hover disabled:opacity-50"
                                                        disabled={testing || !testId.trim()}
                                                        type="submit"
                                                    >
                                                        {testing ? "Searching…" : "Test"}
                                                    </button>
                                                </form>
                                                {testing && (
                                                    <div className="h-10 animate-pulse rounded-xl bg-surface-hover" />
                                                )}
                                                {result && (
                                                    <div className="space-y-1 text-xs">
                                                        <p className="text-default">
                                                            {result.label}:{" "}
                                                            {result.data.streams === 0
                                                                ? "nothing found"
                                                                : `${result.data.streams} stream${result.data.streams === 1 ? "" : "s"}`}
                                                            {result.data.streams > 0
                                                                ? ` · ${result.data.cached} cached`
                                                                : ""}
                                                            {result.data.usenet > 0
                                                                ? ` · ${result.data.usenet} usenet`
                                                                : ""}
                                                            <span className="text-subtle">
                                                                {" "}
                                                                ·{" "}
                                                                {(
                                                                    result.data.tookMs / 1000
                                                                ).toFixed(1)}
                                                                s
                                                            </span>
                                                        </p>
                                                        {result.data.addons.map((x) => (
                                                            <p className="text-subtle" key={x.name}>
                                                                {x.name}: {x.streams}
                                                                {x.cached
                                                                    ? ` (${x.cached} cached)`
                                                                    : ""}
                                                            </p>
                                                        ))}
                                                        {result.data.errors.map((e, i) => (
                                                            <p className="text-error" key={i}>
                                                                {e.title}
                                                                {e.description
                                                                    ? ` - ${e.description}`
                                                                    : ""}
                                                            </p>
                                                        ))}
                                                    </div>
                                                )}
                                            </div>
                                        )}
                                    </>
                                ) : (
                                    <p className="text-default text-xs">{state.reason}</p>
                                )
                            ) : (
                                <div className="h-24 animate-pulse rounded-xl bg-surface-hover" />
                            )}
                        </div>
                    </>,
                    document.body
                )}
        </>
    );
}
