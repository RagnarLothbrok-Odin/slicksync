"use client";
import { readErrorMessage } from "@/lib/errors";

// A household's own Jellyfin server, as shown on Catalogs -> Jellyfin |
// AIOStreams: tap catalogs to switch them on, each becoming a Jellyfin
// collection of the titles that server has, kept in step by
// server/utils/jellyfinServerCollections.js. A Jellyfin collection is
// server-wide, so there is no profile to pick here.

import {
    ArrowPathIcon,
    CheckIcon,
    ServerStackIcon,
    Squares2X2Icon,
} from "@heroicons/react/24/outline";
import { useCallback, useEffect, useState } from "react";
import { Badge, Button, Card } from "@/components/ui";
import { toast } from "@/components/ui/Toast";
import { api, type JellyfinCollectionServer, type JellyfinCollectionsView } from "@/lib/api";
import { usePersonalFeatures } from "@/lib/hooks/usePersonalFeatures";
import { cachedImageUrl, posterUrl } from "@/lib/posterUrl";

function ago(iso: string | null) {
    if (!iso) {
        return null;
    }
    const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60_000);
    if (mins < 1) {
        return "just now";
    }
    if (mins < 60) {
        return `${mins} min ago`;
    }
    const hours = Math.round(mins / 60);
    return hours < 24 ? `${hours} h ago` : `${Math.round(hours / 24)} d ago`;
}

type CatalogRow = JellyfinCollectionsView["catalogs"][number];

function CatalogTile({
    c,
    busy,
    disabled,
    onToggle,
}: {
    c: CatalogRow;
    busy: boolean;
    disabled: boolean;
    onToggle: () => void;
}) {
    const { rpdbEnabled } = usePersonalFeatures();
    const src = c.coverTitleId
        ? posterUrl({ id: c.coverTitleId, poster: c.cover }, rpdbEnabled)
        : cachedImageUrl(c.cover, 342);
    const here = c.onServer;
    return (
        <button
            aria-pressed={c.on}
            className={`group overflow-hidden rounded-2xl border text-left transition-colors disabled:cursor-not-allowed ${
                c.on
                    ? "border-primary ring-2 ring-primary/60"
                    : "border-default hover:border-primary/50"
            } ${disabled && !c.on ? "opacity-60" : ""}`}
            disabled={busy || disabled}
            onClick={onToggle}
            type="button"
        >
            <div className="relative aspect-[2/3] bg-surface-hover">
                {src ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                        alt=""
                        className={`absolute inset-0 h-full w-full object-cover transition-opacity ${c.on ? "" : "opacity-60 group-hover:opacity-90"}`}
                        src={src}
                    />
                ) : (
                    <div className="absolute inset-0 flex items-center justify-center">
                        <Squares2X2Icon className="h-10 w-10 text-muted" />
                    </div>
                )}
                {c.on && (
                    <span className="absolute top-2 right-2 flex h-7 w-7 items-center justify-center rounded-full bg-primary shadow">
                        <CheckIcon className="h-4 w-4 text-white" />
                    </span>
                )}
                {busy && (
                    <span className="absolute inset-0 flex items-center justify-center bg-black/50">
                        <ArrowPathIcon className="h-7 w-7 animate-spin text-white" />
                    </span>
                )}
            </div>
            <div className="p-2.5">
                <p className="truncate font-medium text-default text-sm">{c.name}</p>
                <p className="truncate text-[11px] text-muted">
                    {here === null
                        ? `${c.titles} title${c.titles === 1 ? "" : "s"}`
                        : here === 0
                          ? "None on this server"
                          : `${here} of ${c.titles} on this server`}
                </p>
            </div>
        </button>
    );
}

export function ServerCollections({
    server,
    canSwitch,
    onSwitch,
}: {
    server: JellyfinCollectionServer;
    canSwitch: boolean;
    onSwitch: () => void;
}) {
    const path = api.jellyfinCollectionsPath(server.key);
    const [view, setView] = useState<JellyfinCollectionsView | null>(
        () => api.peekGet<JellyfinCollectionsView>(path) ?? null
    );
    const [busy, setBusy] = useState<string | null>(null);
    const [syncing, setSyncing] = useState(false);

    const load = useCallback(async () => {
        try {
            setView(await api.getJellyfinCollections(server.key));
        } catch (e) {
            toast.error(readErrorMessage(e, "Could not load the collections"));
        }
    }, [server.key]);
    useEffect(() => {
        load();
    }, [load]);

    const toggle = async (c: CatalogRow) => {
        setBusy(c.id);
        try {
            const next = await api.setJellyfinCollection(server.key, c.id, !c.on);
            setView(next);
            const now = next.catalogs.find((x) => x.id === c.id);
            if (next.lastError && next.lastError !== "no-permission") {
                toast.error(`Jellyfin said: ${next.lastError}`);
            } else if (now?.on && !now.inJellyfin) {
                toast.success(
                    `None of ${c.name}'s titles are on this server yet - it shows up once one is`
                );
            } else {
                toast.success(
                    now?.on
                        ? `${c.name} is a collection on ${next.server.name}`
                        : `${c.name} is off ${next.server.name}`
                );
            }
        } catch (e) {
            toast.error(readErrorMessage(e, "Could not change it"));
        } finally {
            setBusy(null);
        }
    };

    const syncNow = async () => {
        setSyncing(true);
        try {
            setView(await api.syncJellyfinCollections(server.key));
        } catch (e) {
            toast.error(readErrorMessage(e, "Could not sync"));
        } finally {
            setSyncing(false);
        }
    };

    const noPermission = !!view && !view.actor;
    const onCount = view?.catalogs.filter((c) => c.on).length || 0;

    return (
        <>
            <Card className="mb-6" padding="lg">
                <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3">
                    <button
                        className="flex min-w-0 items-center gap-3 rounded-xl pr-3 text-left transition-colors hover:bg-surface-hover"
                        onClick={() => (canSwitch ? onSwitch() : undefined)}
                        title={canSwitch ? "Switch server" : undefined}
                        type="button"
                    >
                        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-surface-hover">
                            <ServerStackIcon className="h-5 w-5 text-muted" />
                        </span>
                        <div className="min-w-0">
                            <div className="flex min-w-0 items-center gap-2">
                                <p className="truncate font-medium text-default text-sm">
                                    {view?.server.name || server.name}
                                </p>
                                <Badge className="shrink-0" size="sm" variant="jellyfin">
                                    Jellyfin
                                </Badge>
                            </div>
                            <p className="truncate text-subtle text-xs">
                                {server.people.map((p) => p.username).join(", ")}
                            </p>
                            {canSwitch && <p className="text-primary text-xs">Switch server</p>}
                        </div>
                    </button>
                    {view?.actor && (
                        <div className="flex items-center gap-3">
                            <p className="text-muted text-xs">
                                {onCount > 0 && view.lastSyncAt
                                    ? `Synced ${ago(view.lastSyncAt)}`
                                    : "Kept in step every 30 minutes"}
                            </p>
                            <Button
                                disabled={syncing || onCount === 0}
                                leftIcon={
                                    <ArrowPathIcon
                                        className={`h-4 w-4 ${syncing ? "animate-spin" : ""}`}
                                    />
                                }
                                onClick={syncNow}
                                size="sm"
                                variant="ghost"
                            >
                                Sync now
                            </Button>
                        </div>
                    )}
                </div>
            </Card>

            {view && (
                <Card className="mb-4" padding="md">
                    {noPermission ? (
                        <p className="text-default text-sm">
                            To make collections, SlickSync needs a sign-in on this server that may
                            manage them, and {view.people.map((p) => p.username).join(", ")}{" "}
                            can&rsquo;t. In Jellyfin, open Dashboard &rarr; Users, pick one of them
                            and allow them to manage collections &ndash; or add the server&rsquo;s
                            administrator to SlickSync.
                        </p>
                    ) : (
                        <p className="text-default text-sm">
                            Tap a catalog to make it a collection on this server &ndash; it holds
                            the catalog&rsquo;s titles the server has, under the catalog&rsquo;s
                            name. Everyone on {view.server.name} who can see those titles sees it.
                            Changes are made as {view.actor?.username}.
                            {view.actor && !view.actor.admin && (
                                <span className="mt-1 block text-muted">
                                    Catalog covers need an administrator&rsquo;s sign-in on this
                                    server &ndash; {view.actor.username} isn&rsquo;t one, so
                                    Jellyfin picks the pictures.
                                </span>
                            )}
                            {view.lastError && view.lastError !== "no-permission" && (
                                <span className="mt-1 block text-error">
                                    The last sync didn&rsquo;t finish: {view.lastError}
                                </span>
                            )}
                        </p>
                    )}
                </Card>
            )}

            {view ? (
                view.catalogs.length === 0 ? (
                    <Card padding="lg">
                        <p className="text-center text-muted text-sm">
                            No catalogs yet. Make one on the Catalogs page.
                        </p>
                    </Card>
                ) : (
                    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
                        {view.catalogs.map((c) => (
                            <CatalogTile
                                busy={busy === c.id}
                                c={c}
                                disabled={noPermission || (busy !== null && busy !== c.id)}
                                key={c.id}
                                onToggle={() => toggle(c)}
                            />
                        ))}
                    </div>
                )
            ) : (
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
                    {Array.from({ length: 6 }).map((_, i) => (
                        <div
                            className="aspect-[2/3] animate-pulse rounded-2xl bg-surface-hover"
                            key={i}
                        />
                    ))}
                </div>
            )}
        </>
    );
}
