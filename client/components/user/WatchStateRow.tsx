"use client";

import { ArrowsRightLeftIcon } from "@heroicons/react/24/outline";
import { useCallback, useEffect, useState } from "react";
import { Badge, Button } from "@/components/ui";
import { toast } from "@/components/ui/Toast";
import { api, type WatchStateView } from "@/lib/api";
import { copyToClipboard } from "@/lib/clipboard";
import { readErrorMessage } from "@/lib/errors";

/**
 * The AIOStreams half of watch tracking. People watching through AIOStreams'
 * Jellyfin apps (Odin, Infuse, Swiftfin, its desktop app) never touch a
 * Stremio or Nuvio library, so nothing they watch there reached SlickSync.
 * This turns on the exchange for one person and adds the link to their
 * AIOStreams configuration when SlickSync has its password (otherwise hands
 * the link over to add by hand); it also lists the AIOStreams profiles that
 * have shown up, so each can be linked to the right person instead of guessed,
 * and what the 30-minute check found wrong (server/utils/aioSlickTrax.js).
 */

const ISSUE_TEXT: Record<string, string> = {
    libraries:
        "SlickSync’s collections didn’t make AIOStreams’ library limit - turn on “Keep SlickSync’s collections first” below, or move “SlickSync catalogs” higher in their catalog order yourself.",
    missing:
        "SlickTrax isn’t in their AIOStreams configuration any more, or is switched off - what they watch there isn’t arriving.",
    quiet: "Nothing has arrived from AIOStreams for a week.",
    trackers:
        "A household user’s tracker list in AIOStreams leaves SlickTrax out - add it back there.",
};
export function WatchStateRow({ userId }: { userId: string }) {
    const [view, setView] = useState<WatchStateView | null>(null);
    const [busy, setBusy] = useState(false);
    const [installing, setInstalling] = useState(false);
    const [movingFirst, setMovingFirst] = useState(false);

    const load = useCallback(async () => {
        try {
            setView(await api.getWatchState(userId));
        } catch {
            // A failed read leaves the row in its "off" shape rather than vanishing.
        }
    }, [userId]);

    useEffect(() => {
        load();
    }, [load]);

    const toggle = async () => {
        if (!view) {
            return;
        }
        setBusy(true);
        try {
            const next = await api.setWatchState(userId, !view.enabled);
            setView(next);
            if (next.install === "failed") {
                toast.error(next.installError || "Couldn’t add it to AIOStreams");
            } else {
                toast.success(
                    next.enabled
                        ? next.install === "added"
                            ? "On, and added to their AIOStreams"
                            : "AIOStreams watch history on"
                        : "AIOStreams watch history off"
                );
            }
        } catch (err) {
            toast.error(readErrorMessage(err, "Could not change that"));
        } finally {
            setBusy(false);
        }
    };

    const install = async () => {
        setInstalling(true);
        try {
            const next = await api.installWatchStateIntoAio(userId);
            setView(next);
            if (next.install === "failed") {
                toast.error(next.installError || "Couldn’t add it to AIOStreams");
            } else {
                toast.success(
                    next.install === "added"
                        ? "Added to their AIOStreams"
                        : "It’s already in their AIOStreams"
                );
            }
        } catch (err) {
            toast.error(readErrorMessage(err, "Couldn’t add it to AIOStreams"));
        } finally {
            setInstalling(false);
        }
    };

    // Their AIOStreams, their order: only moved when this is on.
    const setFirst = async (on: boolean) => {
        setMovingFirst(true);
        try {
            const next = await api.setWatchStateCollectionsFirst(userId, on);
            setView(next);
            if (next.firstError) {
                toast.error(`Kept the choice, but couldn’t move it yet: ${next.firstError}`);
            } else {
                toast.success(
                    on
                        ? "SlickSync’s collections are first in their AIOStreams"
                        : "Their AIOStreams catalog order is left as they set it"
                );
            }
        } catch (err) {
            toast.error(readErrorMessage(err, "Could not change that"));
        } finally {
            setMovingFirst(false);
        }
    };

    const link = async (viewer: string, target: string) => {
        try {
            setView(await api.linkWatchStateViewer(userId, viewer, target || null));
            toast.success(
                target === "skip"
                    ? "Profile no longer tracked"
                    : target
                      ? "Profile linked"
                      : "Profile unlinked"
            );
        } catch (err) {
            toast.error(readErrorMessage(err, "Could not link that profile"));
        }
    };

    const enabled = !!view?.enabled;

    return (
        <div className="py-3">
            <div className="flex flex-wrap items-center justify-between gap-4">
                <div className="flex min-w-0 items-center gap-3">
                    <div
                        className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${enabled ? "bg-success-muted" : "bg-primary-muted"}`}
                    >
                        <ArrowsRightLeftIcon
                            className={`h-5 w-5 ${enabled ? "text-success" : "text-primary"}`}
                        />
                    </div>
                    <div className="min-w-0">
                        <div className="flex items-center gap-2">
                            <h4 className="font-semibold text-default">AIOStreams watch history</h4>
                            {enabled && (
                                <Badge size="sm" variant="success">
                                    On
                                </Badge>
                            )}
                        </div>
                        <p className="text-muted text-sm">
                            {enabled
                                ? "What they watch on AIOStreams in a Jellyfin app is recorded here, and what they watched anywhere else shows up there."
                                : "For anyone watching AIOStreams in a Jellyfin app - Infuse, Swiftfin, Odin or AIOStreams' desktop app."}
                        </p>
                        {enabled && view?.canInstall && (
                            <div className="mt-2 flex flex-col gap-1.5">
                                <p className="text-muted text-xs">
                                    {view.install === "failed" ? (
                                        <span className="text-warning">{view.installError}</span>
                                    ) : (
                                        "SlickSync adds it to their AIOStreams configuration itself."
                                    )}
                                </p>
                                {(view.install === "failed" ||
                                    (view.issues || []).includes("missing")) && (
                                    <Button
                                        className="self-start"
                                        isLoading={installing}
                                        onClick={install}
                                        size="sm"
                                        variant="secondary"
                                    >
                                        Add it to AIOStreams again
                                    </Button>
                                )}
                                <label className="mt-1 flex cursor-pointer items-start gap-2 text-default text-xs">
                                    <input
                                        checked={!!view.collectionsFirst}
                                        className="mt-0.5"
                                        disabled={movingFirst}
                                        onChange={(e) => setFirst(e.target.checked)}
                                        type="checkbox"
                                    />
                                    <span>
                                        Keep SlickSync’s collections first
                                        <span className="block text-muted">
                                            Moves “SlickSync catalogs” to the top of their
                                            AIOStreams catalogs so it’s never past the library
                                            limit. Nothing else in their order changes. Off:
                                            SlickSync never reorders their catalogs.
                                        </span>
                                    </span>
                                </label>
                            </div>
                        )}
                        {enabled && (view?.issues?.length ?? 0) > 0 && (
                            <ul className="mt-2 space-y-1">
                                {(view.issues ?? []).map((k) => (
                                    <li className="text-warning text-xs" key={k}>
                                        {ISSUE_TEXT[k] || k}
                                    </li>
                                ))}
                            </ul>
                        )}
                        {enabled && view?.manifestUrl && !view.canInstall && (
                            <>
                                <p className="mt-2 text-muted text-xs">
                                    Add this to the AIOStreams configuration as an addon by URL:
                                </p>
                                <button
                                    className="mt-1 break-all text-left text-muted text-xs underline underline-offset-2 hover:text-default"
                                    onClick={async () => {
                                        if (
                                            view.manifestUrl &&
                                            (await copyToClipboard(view.manifestUrl))
                                        ) {
                                            toast.success("Link copied");
                                        } else {
                                            toast.error(
                                                "Copy failed - select and copy the link text directly"
                                            );
                                        }
                                    }}
                                    title="Copy link"
                                    type="button"
                                >
                                    {view.manifestUrl}
                                </button>
                            </>
                        )}
                        {enabled && view && !view.baseKnown && (
                            <p className="mt-2 text-warning text-xs">
                                SlickSync doesn’t know the address AIOStreams can reach it at yet.
                                Open SlickSync once from the address your devices use, then turn
                                this off and on again.
                            </p>
                        )}
                    </div>
                </div>
                <Button
                    disabled={!view}
                    isLoading={busy}
                    onClick={toggle}
                    size="sm"
                    variant={enabled ? "ghost" : "primary"}
                >
                    {enabled ? "Turn off" : "Turn on"}
                </Button>
            </div>

            {enabled && view && view.viewers.length > 0 && (
                <div className="mt-4 ml-13 flex flex-col gap-2">
                    <p className="text-muted text-xs">
                        The AIOStreams users watching through this link, and who each one is here.
                        Nothing is recorded for a user until they are matched to someone with this
                        turned on.
                    </p>
                    {view.viewers.map((v) => (
                        <div
                            className="flex flex-wrap items-center justify-between gap-3 rounded-lg px-3 py-2"
                            key={v.viewer}
                            style={{ background: "var(--color-surface-hover)" }}
                        >
                            <span className="font-mono text-sm">{v.viewer}</span>
                            <div className="flex items-center gap-2">
                                {v.userId && v.userEnabled === false && (
                                    <span className="text-warning text-xs">
                                        turned off for that person
                                    </span>
                                )}
                                {!(v.userId || v.skipped) && (
                                    <span className="text-warning text-xs">
                                        not linked - its viewing is not recorded
                                    </span>
                                )}
                                {v.skipped && (
                                    <span className="text-muted text-xs">not tracked</span>
                                )}
                                <select
                                    aria-label={`Who is ${v.viewer}`}
                                    className="rounded-md border px-2 py-1 text-sm"
                                    onChange={(e) => link(v.viewer, e.target.value)}
                                    style={{
                                        backgroundColor: "var(--color-bg-subtle)",
                                        borderColor: "var(--color-surface-border)",
                                        color: "var(--color-text)",
                                    }}
                                    value={v.skipped ? "skip" : v.userId || ""}
                                >
                                    <option
                                        disabled={!!v.userId || v.skipped}
                                        style={{ backgroundColor: "var(--color-surface)" }}
                                        value=""
                                    >
                                        Choose who this is
                                    </option>
                                    {view.people.map((p) => (
                                        <option
                                            key={p.id}
                                            style={{ backgroundColor: "var(--color-surface)" }}
                                            value={p.id}
                                        >
                                            {p.username}
                                        </option>
                                    ))}
                                    <option
                                        style={{ backgroundColor: "var(--color-surface)" }}
                                        value="skip"
                                    >
                                        Don&apos;t track it
                                    </option>
                                </select>
                            </div>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}
