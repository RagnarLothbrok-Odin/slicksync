"use client";

import { ChevronDownIcon, ChevronUpIcon, EyeIcon, EyeSlashIcon } from "@heroicons/react/24/outline";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui";
import { toast } from "@/components/ui/Toast";
import { api, type TraxRow } from "@/lib/api";

/**
 * Which SlickTrax rows this person gets inside Stremio and Nuvio, and in
 * what order - Continue Watching, Watchlist and each Catalog. Saving gives
 * their addon a new address, so their apps pick the change up, and starts a
 * sync for them straight away.
 */
export function TraxRowsEditor({ userId }: { userId: string }) {
    const [open, setOpen] = useState(false);
    const [rows, setRows] = useState<TraxRow[] | null>(null);
    const [saved, setSaved] = useState<string>("");
    const [busy, setBusy] = useState(false);

    useEffect(() => {
        if (!open || rows) {
            return;
        }
        api.getTraxRows(userId)
            .then((v) => {
                setRows(v.rows);
                setSaved(JSON.stringify(v.rows));
            })
            .catch(() => setRows([]));
    }, [open, rows, userId]);

    const move = (i: number, by: number) => {
        if (!rows) {
            return;
        }
        const j = i + by;
        if (j < 0 || j >= rows.length) {
            return;
        }
        const next = [...rows];
        [next[i], next[j]] = [next[j], next[i]];
        setRows(next);
    };
    const toggle = (i: number) => {
        if (!rows) {
            return;
        }
        setRows(rows.map((r, k) => (k === i ? { ...r, hidden: !r.hidden } : r)));
    };

    const save = async () => {
        if (!rows) {
            return;
        }
        setBusy(true);
        try {
            const v = await api.saveTraxRows(
                userId,
                rows.map((r) => r.key),
                rows.filter((r) => r.hidden).map((r) => r.key)
            );
            setRows(v.rows);
            setSaved(JSON.stringify(v.rows));
            toast.success("Rows saved - their apps update with the sync that just started");
        } catch (e: any) {
            toast.error(e?.message || "Could not save the rows");
        } finally {
            setBusy(false);
        }
    };

    const reset = async () => {
        setBusy(true);
        try {
            const v = await api.saveTraxRows(userId, [], []);
            setRows(v.rows);
            setSaved(JSON.stringify(v.rows));
            toast.success("Back to every row, in the usual order");
        } catch (e: any) {
            toast.error(e?.message || "Could not reset the rows");
        } finally {
            setBusy(false);
        }
    };

    const dirty = rows && JSON.stringify(rows) !== saved;
    const shown = rows ? rows.filter((r) => !r.hidden).length : 0;

    return (
        <div className="mt-3">
            <button
                aria-expanded={open}
                className="inline-flex items-center gap-1.5 text-primary text-sm hover:underline"
                onClick={() => setOpen((o) => !o)}
                type="button"
            >
                {open ? "Hide rows" : "Choose rows"}
                <ChevronDownIcon
                    className="h-4 w-4 transition-transform"
                    style={{ transform: open ? "rotate(180deg)" : "none" }}
                />
            </button>

            {open && (
                <div className="mt-3 rounded-xl border border-white/5 bg-white/[0.02] p-2">
                    {rows ? (
                        <>
                            <ol className="flex flex-col gap-1">
                                {rows.map((r, i) => (
                                    <li
                                        className={`flex items-center gap-2 rounded-lg px-2 py-1.5 ${r.hidden ? "opacity-50" : "hover:bg-surface-hover"}`}
                                        key={r.key}
                                    >
                                        <span className="w-5 text-right text-subtle text-xs tabular-nums">
                                            {r.hidden
                                                ? ""
                                                : rows.slice(0, i + 1).filter((x) => !x.hidden)
                                                      .length}
                                        </span>
                                        <span
                                            className={`min-w-0 flex-1 truncate text-sm ${r.hidden ? "text-muted line-through" : "text-default"}`}
                                        >
                                            {r.name}
                                        </span>
                                        <button
                                            aria-label={`Move ${r.name} up`}
                                            className="rounded-md p-1 text-muted hover:bg-surface-hover hover:text-default disabled:opacity-30"
                                            disabled={i === 0 || busy}
                                            onClick={() => move(i, -1)}
                                            title="Move up"
                                            type="button"
                                        >
                                            <ChevronUpIcon className="h-4 w-4" />
                                        </button>
                                        <button
                                            aria-label={`Move ${r.name} down`}
                                            className="rounded-md p-1 text-muted hover:bg-surface-hover hover:text-default disabled:opacity-30"
                                            disabled={i === rows.length - 1 || busy}
                                            onClick={() => move(i, 1)}
                                            title="Move down"
                                            type="button"
                                        >
                                            <ChevronDownIcon className="h-4 w-4" />
                                        </button>
                                        <button
                                            aria-label={`${r.hidden ? "Show" : "Hide"} ${r.name}`}
                                            className="rounded-md p-1 text-muted hover:bg-surface-hover hover:text-default"
                                            disabled={busy}
                                            onClick={() => toggle(i)}
                                            title={r.hidden ? "Show this row" : "Hide this row"}
                                            type="button"
                                        >
                                            {r.hidden ? (
                                                <EyeSlashIcon className="h-4 w-4" />
                                            ) : (
                                                <EyeIcon className="h-4 w-4" />
                                            )}
                                        </button>
                                    </li>
                                ))}
                            </ol>
                            <div className="flex flex-wrap items-center justify-between gap-3 px-2 pt-3 pb-1">
                                <p className="text-muted text-xs">
                                    {shown} of {rows.length} rows shown. Stremio and Nuvio on a
                                    computer follow this order; Nuvio&apos;s phone app groups rows
                                    by movies and shows.
                                </p>
                                <div className="flex items-center gap-2">
                                    <Button
                                        disabled={busy}
                                        onClick={reset}
                                        size="sm"
                                        variant="ghost"
                                    >
                                        Reset
                                    </Button>
                                    <Button
                                        disabled={!dirty || busy}
                                        isLoading={busy}
                                        onClick={save}
                                        size="sm"
                                        variant="primary"
                                    >
                                        Save rows
                                    </Button>
                                </div>
                            </div>
                        </>
                    ) : (
                        <p className="px-2 py-2 text-muted text-sm">Loading rows…</p>
                    )}
                </div>
            )}
        </div>
    );
}
