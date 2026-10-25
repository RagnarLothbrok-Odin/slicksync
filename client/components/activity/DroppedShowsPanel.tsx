"use client";

import { ArchiveBoxIcon } from "@heroicons/react/24/outline";
import { useCallback, useEffect, useState } from "react";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { SelectionCheckbox } from "@/components/ui/SelectionCheckbox";
import { toast } from "@/components/ui/Toast";
import { api } from "@/lib/api";

// The Graveyard (renamed from "Dropped" - the user's own word for it, and a
// better one: bury implied a place, and for a while there wasn't one).
//
// Two shelves in one panel:
//  - Unfinished: shows someone genuinely started and then stopped. Continue
//    Watching only looks back 120 days, so anything older used to disappear
//    from the app completely - never resumed, never acknowledged, just gone.
//  - The graveyard itself: what burying produced. Burying reuses the same
//    dismissal Continue Watching uses ("done with this show" means the same
//    thing in both places), so shows dismissed there rest here too - and
//    every one of them can be dug back up, or wiped permanently.
//
// Both shelves support multi-select: a household purge is dozens of shows,
// and one-at-a-time was the entire cost of doing it. Bulk operations loop
// the same single-item endpoints - at household scale that is a handful of
// fast requests, and it keeps one code path per operation (wipes, notably,
// each land their own Trash entry so each show stays individually undoable).

type Dropped = Awaited<ReturnType<typeof api.getAbandonedShows>>[number];
type Buried = Awaited<ReturnType<typeof api.getBuriedShows>>[number];

const keyOf = (item: { userId: string; showId: string }) => `${item.userId}:${item.showId}`;

export function DroppedShowsPanel() {
    const [items, setItems] = useState<Dropped[] | null>(null);
    const [buried, setBuried] = useState<Buried[] | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [working, setWorking] = useState<string | null>(null);
    const [graveOpen, setGraveOpen] = useState(false);

    // Multi-select, one set per shelf. Keys are `${userId}:${showId}` - the
    // same identity every row action already uses.
    const [selUnfinished, setSelUnfinished] = useState<Set<string>>(new Set());
    const [selBuried, setSelBuried] = useState<Set<string>>(new Set());
    const [bulkBusy, setBulkBusy] = useState(false);

    const load = useCallback(async () => {
        try {
            const [abandoned, graves] = await Promise.all([
                api.getAbandonedShows(),
                api.getBuriedShows(),
            ]);
            setItems(abandoned);
            setBuried(graves);
        } catch (e) {
            setError(e instanceof Error ? e.message : "Could not load the graveyard");
        }
    }, []);

    useEffect(() => {
        load();
    }, [load]);

    // The account's own Unfinished cutoff, set in Settings.
    const [unfinishedDays, setUnfinishedDays] = useState(45);
    useEffect(() => {
        api.getWatchTrackingSettings()
            .then((s) => setUnfinishedDays(s.unfinishedAfterDays))
            .catch(() => undefined);
    }, []);

    const toggleSel = (set: React.Dispatch<React.SetStateAction<Set<string>>>, key: string) => {
        set((prev) => {
            const next = new Set(prev);
            if (next.has(key)) {
                next.delete(key);
            } else {
                next.add(key);
            }
            return next;
        });
    };

    const bury = async (item: Dropped) => {
        const key = keyOf(item);
        setWorking(key);
        try {
            await api.dismissContinueWatching(item.userId, item.showId);
            setItems((prev) => (prev || []).filter((i) => keyOf(i) !== key));
            setSelUnfinished((prev) => {
                const n = new Set(prev);
                n.delete(key);
                return n;
            });
            // Appears in the graveyard immediately, without a refetch flashing the
            // whole panel - buriedAt is "now" by definition.
            setBuried((prev) => [
                {
                    buriedAt: new Date().toISOString(),
                    episodesWatched: item.episodesWatched,
                    lastEpisode: item.lastEpisode,
                    lastSeason: item.lastSeason,
                    lastWatchedAt: item.lastWatchedAt,
                    poster: item.poster,
                    showId: item.showId,
                    showName: item.showName,
                    userId: item.userId,
                    username: item.username,
                },
                ...(prev || []),
            ]);
            toast.success(`Buried ${item.showName}`);
        } catch (e) {
            toast.error(e instanceof Error ? e.message : "Could not bury that show");
        } finally {
            setWorking(null);
        }
    };

    const unbury = async (item: Buried) => {
        const key = keyOf(item);
        setWorking(key);
        try {
            await api.unburyShow(item.userId, item.showId);
            setBuried((prev) => (prev || []).filter((i) => keyOf(i) !== key));
            setSelBuried((prev) => {
                const n = new Set(prev);
                n.delete(key);
                return n;
            });
            toast.success(
                `${item.showName} dug back up - it returns to Continue Watching or the unfinished list`
            );
            // The unfinished list may now contain it again - refresh just that half.
            api.getAbandonedShows()
                .then(setItems)
                .catch(() => undefined);
        } catch (e) {
            toast.error(e instanceof Error ? e.message : "Could not unbury that show");
        } finally {
            setWorking(null);
        }
    };

    // The permanent exit. Two-step on purpose: Wipe arms a confirmation state
    // on the row itself (button turns into "Erase N episodes forever?"), so
    // the destructive click is never the first click and the count of what
    // dies is in the button text. No modal - the row IS the context.
    const [wipeArmed, setWipeArmed] = useState<string | null>(null);

    // Panel-level option applied to every wipe (single and bulk): also drop
    // the title from the provider account's own library, so it leaves the
    // device's home screen too - the wipe alone only erases SlickSync's
    // record while the provider keeps showing it on-device. Persisted per
    // browser; the server skips it gracefully on providers whose libraries
    // are read-only (Nuvio), so it's safe to leave on for a mixed household.
    const [wipeOnDevice, setWipeOnDevice] = useState(false);
    useEffect(() => {
        try {
            setWipeOnDevice(localStorage.getItem("graveyard-wipe-on-device") === "1");
        } catch {
            /* fresh browser */
        }
    }, []);
    const toggleWipeOnDevice = (v: boolean) => {
        setWipeOnDevice(v);
        try {
            localStorage.setItem("graveyard-wipe-on-device", v ? "1" : "0");
        } catch {
            /* private window */
        }
    };

    const wipe = async (item: Buried) => {
        const key = keyOf(item);
        if (wipeArmed !== key) {
            setWipeArmed(key);
            setTimeout(() => setWipeArmed((cur) => (cur === key ? null : cur)), 5000);
            return;
        }
        setWipeArmed(null);
        setWorking(key);
        try {
            const r = await api.wipeBuriedShow(item.userId, item.showId, wipeOnDevice);
            setBuried((prev) => (prev || []).filter((i) => keyOf(i) !== key));
            setSelBuried((prev) => {
                const n = new Set(prev);
                n.delete(key);
                return n;
            });
            const erased =
                r.episodesDeleted > 0
                    ? `${r.episodesDeleted} episode${r.episodesDeleted === 1 ? "" : "s"} of history erased`
                    : "its watch history erased";
            const device = r.deviceRemoved ? ", removed from the account library" : "";
            toast.success(
                `${item.showName} wiped - ${erased}${device} (undoable for 30 days in the Trash)`
            );
        } catch (e) {
            toast.error(e instanceof Error ? e.message : "Could not wipe that show");
        } finally {
            setWorking(null);
        }
    };

    // ---- Bulk operations: loop the single-item calls, then reconcile once.

    const buryBulk = async () => {
        const targets = (items || []).filter((i) => selUnfinished.has(keyOf(i)));
        if (targets.length === 0) {
            return;
        }
        setBulkBusy(true);
        let ok = 0;
        for (const item of targets) {
            try {
                await api.dismissContinueWatching(item.userId, item.showId);
                ok++;
            } catch {
                /* counted below */
            }
        }
        setBulkBusy(false);
        setSelUnfinished(new Set());
        await load();
        if (ok === targets.length) {
            toast.success(`Buried ${ok} show${ok === 1 ? "" : "s"}`);
        } else {
            toast.error(`Buried ${ok} of ${targets.length} - the rest failed, try them again`);
        }
    };

    const unburyBulk = async () => {
        const targets = (buried || []).filter((i) => selBuried.has(keyOf(i)));
        if (targets.length === 0) {
            return;
        }
        setBulkBusy(true);
        let ok = 0;
        for (const item of targets) {
            try {
                await api.unburyShow(item.userId, item.showId);
                ok++;
            } catch {
                /* counted below */
            }
        }
        setBulkBusy(false);
        setSelBuried(new Set());
        await load();
        if (ok === targets.length) {
            toast.success(`Dug up ${ok} show${ok === 1 ? "" : "s"}`);
        } else {
            toast.error(`Dug up ${ok} of ${targets.length} - the rest failed, try them again`);
        }
    };

    // Bulk wipe gets the same two-step arming as a single wipe, with the
    // grand total of episodes named before anything is erased.
    const [bulkWipeArmed, setBulkWipeArmed] = useState(false);
    const wipeBulk = async () => {
        const targets = (buried || []).filter((i) => selBuried.has(keyOf(i)));
        if (targets.length === 0) {
            return;
        }
        if (!bulkWipeArmed) {
            setBulkWipeArmed(true);
            setTimeout(() => setBulkWipeArmed(false), 6000);
            return;
        }
        setBulkWipeArmed(false);
        setBulkBusy(true);
        let ok = 0;
        let episodes = 0;
        for (const item of targets) {
            try {
                const r = await api.wipeBuriedShow(item.userId, item.showId, wipeOnDevice);
                episodes += r.episodesDeleted;
                ok++;
            } catch {
                /* counted below */
            }
        }
        setBulkBusy(false);
        setSelBuried(new Set());
        await load();
        if (ok === targets.length) {
            toast.success(
                `Wiped ${ok} show${ok === 1 ? "" : "s"} - ${episodes} episode${episodes === 1 ? "" : "s"} of history erased (each undoable for 30 days in the Trash)`
            );
        } else {
            toast.error(`Wiped ${ok} of ${targets.length} - the rest failed, try them again`);
        }
    };

    if (error) {
        return (
            <Card padding="lg">
                <p className="text-error text-sm">{error}</p>
                <Button className="mt-2" onClick={load} size="sm" variant="ghost">
                    Retry
                </Button>
            </Card>
        );
    }

    if (!(items && buried)) {
        return (
            <Card padding="lg">
                <p className="text-muted text-sm">Visiting the graveyard...</p>
            </Card>
        );
    }

    const selBuriedEpisodes = buried
        .filter((i) => selBuried.has(keyOf(i)))
        .reduce((n, i) => n + (i.episodesWatched || 0), 0);

    return (
        <div className="space-y-4">
            <Card padding="lg">
                <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
                    <div>
                        <h3 className="font-semibold text-default text-lg">Unfinished</h3>
                        <p className="mt-0.5 text-muted text-sm">
                            Started, then not touched in over {unfinishedDays} days. Pick one back
                            up, or bury it.
                        </p>
                    </div>
                    {items.length > 1 && (
                        <div className="flex items-center gap-2">
                            <button
                                className="text-muted text-xs transition-colors hover:text-default"
                                onClick={() =>
                                    setSelUnfinished(
                                        selUnfinished.size === items.length
                                            ? new Set()
                                            : new Set(items.map(keyOf))
                                    )
                                }
                                type="button"
                            >
                                {selUnfinished.size === items.length ? "Select none" : "Select all"}
                            </button>
                            {selUnfinished.size > 0 && (
                                <Button
                                    isLoading={bulkBusy}
                                    onClick={buryBulk}
                                    size="sm"
                                    variant="secondary"
                                >
                                    Bury {selUnfinished.size} selected
                                </Button>
                            )}
                        </div>
                    )}
                </div>
                {items.length === 0 ? (
                    <div className="py-6 text-center">
                        <ArchiveBoxIcon className="mx-auto mb-3 h-10 w-10 text-subtle" />
                        <p className="mb-1 font-medium text-default">Nothing abandoned</p>
                        <p className="text-muted text-sm">
                            Every show anyone started has either been finished or watched recently.
                        </p>
                    </div>
                ) : (
                    <div className="space-y-2">
                        {items.map((item) => {
                            const key = keyOf(item);
                            return (
                                <div
                                    className="flex items-center gap-3 rounded-xl p-3"
                                    key={key}
                                    style={{ background: "var(--color-surface-hover)" }}
                                >
                                    <SelectionCheckbox
                                        checked={selUnfinished.has(key)}
                                        onChange={() => toggleSel(setSelUnfinished, key)}
                                    />
                                    {item.poster ? (
                                        // eslint-disable-next-line @next/next/no-img-element
                                        <img
                                            alt=""
                                            className="w-10 shrink-0 rounded object-cover"
                                            height={60}
                                            src={item.poster}
                                            style={{ height: "3.75rem" }}
                                            width={40}
                                        />
                                    ) : (
                                        <div
                                            className="w-10 shrink-0 rounded"
                                            style={{
                                                background: "var(--color-bg-subtle)",
                                                height: "3.75rem",
                                            }}
                                        />
                                    )}
                                    <div className="min-w-0 flex-1">
                                        <div className="flex flex-wrap items-center gap-2">
                                            <span className="truncate font-medium text-default">
                                                {item.showName}
                                            </span>
                                            <Badge size="sm" variant="muted">
                                                {item.username}
                                            </Badge>
                                        </div>
                                        <p className="mt-0.5 text-muted text-xs">
                                            Stopped at S{item.lastSeason}E{item.lastEpisode} ·{" "}
                                            {item.episodesWatched} episode
                                            {item.episodesWatched === 1 ? "" : "s"} watched ·{" "}
                                            {item.daysSince} days ago
                                        </p>
                                    </div>
                                    <Button
                                        className="shrink-0"
                                        isLoading={working === key}
                                        onClick={() => bury(item)}
                                        size="sm"
                                        variant="ghost"
                                    >
                                        Bury
                                    </Button>
                                </div>
                            );
                        })}
                    </div>
                )}
            </Card>

            {buried.length > 0 && (
                <Card padding="lg">
                    <button
                        className="flex w-full items-center justify-between gap-2 text-left"
                        onClick={() => setGraveOpen((v) => !v)}
                        type="button"
                    >
                        <div>
                            <h3 className="font-semibold text-default text-lg">The Graveyard</h3>
                            <p className="mt-0.5 text-muted text-sm">
                                {buried.length} buried show{buried.length === 1 ? "" : "s"} resting
                                here. Dig one back up any time - or Wipe it to erase its watch
                                history permanently.
                            </p>
                        </div>
                        <span className="shrink-0 text-muted text-xs">
                            {graveOpen ? "Hide" : "Show"}
                        </span>
                    </button>
                    {graveOpen && (
                        <>
                            <label className="mt-3 flex cursor-pointer select-none items-start gap-2 text-muted text-xs">
                                <input
                                    checked={wipeOnDevice}
                                    className="mt-0.5"
                                    onChange={(e) => toggleWipeOnDevice(e.target.checked)}
                                    type="checkbox"
                                />
                                <span>
                                    When wiping, also remove the title from the account&apos;s own
                                    library - so it disappears from the device&apos;s home screen
                                    too, not just from SlickSync. Skipped automatically for accounts
                                    whose library can&apos;t be edited.
                                </span>
                            </label>
                            {buried.length > 1 && (
                                <div className="mt-3 flex flex-wrap items-center justify-end gap-2">
                                    <button
                                        className="text-muted text-xs transition-colors hover:text-default"
                                        onClick={() => {
                                            setBulkWipeArmed(false);
                                            setSelBuried(
                                                selBuried.size === buried.length
                                                    ? new Set()
                                                    : new Set(buried.map(keyOf))
                                            );
                                        }}
                                        type="button"
                                    >
                                        {selBuried.size === buried.length
                                            ? "Select none"
                                            : "Select all"}
                                    </button>
                                    {selBuried.size > 0 && (
                                        <>
                                            <Button
                                                isLoading={bulkBusy && !bulkWipeArmed}
                                                onClick={unburyBulk}
                                                size="sm"
                                                variant="secondary"
                                            >
                                                Dig up {selBuried.size} selected
                                            </Button>
                                            <Button
                                                isLoading={bulkBusy && bulkWipeArmed}
                                                onClick={wipeBulk}
                                                size="sm"
                                                variant={bulkWipeArmed ? "danger" : "ghost"}
                                            >
                                                {bulkWipeArmed
                                                    ? selBuriedEpisodes > 0
                                                        ? `Erase ${selBuriedEpisodes} episode${selBuriedEpisodes === 1 ? "" : "s"} across ${selBuried.size} title${selBuried.size === 1 ? "" : "s"} forever?`
                                                        : `Erase ${selBuried.size} title${selBuried.size === 1 ? "" : "s"} and their watch history forever?`
                                                    : `Wipe ${selBuried.size} selected`}
                                            </Button>
                                        </>
                                    )}
                                </div>
                            )}
                            <div className="mt-4 space-y-2">
                                {buried.map((item) => {
                                    const key = keyOf(item);
                                    return (
                                        <div
                                            className="flex items-center gap-3 rounded-xl p-3"
                                            key={key}
                                            style={{
                                                background: "var(--color-surface-hover)",
                                                opacity: 0.85,
                                            }}
                                        >
                                            <SelectionCheckbox
                                                checked={selBuried.has(key)}
                                                onChange={() => toggleSel(setSelBuried, key)}
                                            />
                                            {item.poster ? (
                                                // eslint-disable-next-line @next/next/no-img-element
                                                <img
                                                    alt=""
                                                    className="w-10 shrink-0 rounded object-cover grayscale"
                                                    height={60}
                                                    src={item.poster}
                                                    style={{ height: "3.75rem" }}
                                                    width={40}
                                                />
                                            ) : (
                                                <div
                                                    className="w-10 shrink-0 rounded"
                                                    style={{
                                                        background: "var(--color-bg-subtle)",
                                                        height: "3.75rem",
                                                    }}
                                                />
                                            )}
                                            <div className="min-w-0 flex-1">
                                                <div className="flex flex-wrap items-center gap-2">
                                                    <span className="truncate font-medium text-default">
                                                        {item.showName}
                                                    </span>
                                                    <Badge size="sm" variant="muted">
                                                        {item.username}
                                                    </Badge>
                                                </div>
                                                <p className="mt-0.5 text-muted text-xs">
                                                    {item.lastSeason != null &&
                                                    item.lastEpisode != null
                                                        ? `Rested at S${item.lastSeason}E${item.lastEpisode} · `
                                                        : ""}
                                                    Buried{" "}
                                                    {new Date(item.buriedAt).toLocaleDateString()}
                                                </p>
                                            </div>
                                            <div className="flex shrink-0 items-center gap-1.5">
                                                <Button
                                                    isLoading={working === key}
                                                    onClick={() => unbury(item)}
                                                    size="sm"
                                                    variant="ghost"
                                                >
                                                    Dig up
                                                </Button>
                                                <Button
                                                    isLoading={
                                                        working === key && wipeArmed === null
                                                    }
                                                    onClick={() => wipe(item)}
                                                    size="sm"
                                                    variant={wipeArmed === key ? "danger" : "ghost"}
                                                >
                                                    {wipeArmed === key
                                                        ? item.episodesWatched > 0
                                                            ? `Erase ${item.episodesWatched} episode${item.episodesWatched === 1 ? "" : "s"} forever?`
                                                            : "Erase its watch history forever?"
                                                        : "Wipe"}
                                                </Button>
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        </>
                    )}
                </Card>
            )}
        </div>
    );
}
