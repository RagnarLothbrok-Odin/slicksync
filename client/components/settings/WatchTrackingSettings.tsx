"use client";

import { useEffect, useState } from "react";
import { toast } from "@/components/ui/Toast";
import { api, type WatchTrackingSettings as Settings } from "@/lib/api";
import { readErrorMessage } from "@/lib/errors";

const FINISHED_CHOICES = [75, 80, 85, 90, 95, 98];
const UNFINISHED_CHOICES = [14, 30, 45, 60, 90, 180];

/**
 * Where "finished" starts, and how long a started show sits untouched before
 * it is offered on the Unfinished shelf. Account-wide; the history poller
 * picks a change up within a minute.
 */
export function WatchTrackingSettings() {
    const [value, setValue] = useState<Settings | null>(null);

    useEffect(() => {
        api.getWatchTrackingSettings()
            .then(setValue)
            .catch(() => undefined);
    }, []);

    const save = async (
        patch: Partial<Pick<Settings, "finishedPercent" | "unfinishedAfterDays">>
    ) => {
        if (!value) {
            return;
        }
        setValue({ ...value, ...patch });
        try {
            setValue(await api.saveWatchTrackingSettings(patch));
            toast.success("Saved");
        } catch (e) {
            toast.error(readErrorMessage(e, "Could not save that"));
            api.getWatchTrackingSettings()
                .then(setValue)
                .catch(() => undefined);
        }
    };

    if (!value) {
        return null;
    }

    // A value set some other way still shows as itself.
    const finished = FINISHED_CHOICES.includes(value.finishedPercent)
        ? FINISHED_CHOICES
        : [...FINISHED_CHOICES, value.finishedPercent].sort((a, b) => a - b);
    const unfinished = UNFINISHED_CHOICES.includes(value.unfinishedAfterDays)
        ? UNFINISHED_CHOICES
        : [...UNFINISHED_CHOICES, value.unfinishedAfterDays].sort((a, b) => a - b);

    return (
        <div className="grid gap-3 sm:grid-cols-2">
            <div className="rounded-lg bg-subtle p-4">
                <label
                    className="mb-2 block font-medium text-default text-sm"
                    htmlFor="finished-percent"
                >
                    Counts as finished at
                </label>
                <select
                    className="input-base w-full px-3 py-2 text-sm"
                    id="finished-percent"
                    onChange={(e) => save({ finishedPercent: Number(e.target.value) })}
                    value={value.finishedPercent}
                >
                    {finished.map((p) => (
                        <option key={p} value={p}>
                            {p}% watched{p === value.defaults.finishedPercent ? " (default)" : ""}
                        </option>
                    ))}
                </select>
                <p className="mt-2 text-muted text-xs">
                    How far into a movie or episode it counts as watched rather than stopped
                    part-way. Lower it if the shows you watch have long end credits.
                </p>
            </div>
            <div className="rounded-lg bg-subtle p-4">
                <label
                    className="mb-2 block font-medium text-default text-sm"
                    htmlFor="unfinished-days"
                >
                    Unfinished shelf after
                </label>
                <select
                    className="input-base w-full px-3 py-2 text-sm"
                    id="unfinished-days"
                    onChange={(e) => save({ unfinishedAfterDays: Number(e.target.value) })}
                    value={value.unfinishedAfterDays}
                >
                    {unfinished.map((d) => (
                        <option key={d} value={d}>
                            {d} days untouched
                            {d === value.defaults.unfinishedAfterDays ? " (default)" : ""}
                        </option>
                    ))}
                </select>
                <p className="mt-2 text-muted text-xs">
                    How long a started show can go untouched before Activity &rarr; Graveyard offers
                    it on the Unfinished shelf.
                </p>
            </div>
        </div>
    );
}
