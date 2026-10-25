"use client";

import {
    ArrowTopRightOnSquareIcon,
    MagnifyingGlassIcon,
    PlusIcon,
    StarIcon,
} from "@heroicons/react/24/outline";
import { useCallback, useEffect, useRef, useState } from "react";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { toast } from "@/components/ui/Toast";
import { api } from "@/lib/api";
import { copyToClipboard } from "@/lib/clipboard";
import { cachedImageUrl } from "@/lib/posterUrl";

// Browse the public Stremio addon directory and add one without ever
// hunting down a manifest URL by hand - previously the only way in was
// pasting a URL you had to find somewhere else first.
//
// Everything here is read-only browsing of someone else's public listing
// (see server/routes/addonDirectory.js). Adding goes through the app's
// normal createAddon path, which re-fetches the manifest from the addon's
// own URL, so nothing the directory says about an addon is trusted as fact.
//
// Addons that require configuration on their own site (configureUrl set -
// Torrentio-style provider/debrid pickers) cannot be meaningfully installed
// from a bare manifest URL: you would get the addon with no settings. Those
// get a "Configure first" link out to the addon's own page instead of an Add
// button, which is the honest option rather than installing something
// half-set-up.

interface AddonDirectoryModalProps {
    isOpen: boolean;
    /** Called after a successful add so the caller can refresh its list. */
    onAdded: () => void;
    onClose: () => void;
}

// Categories the upstream directory actually uses, in rough order of how
// often someone is looking for them. Kept short deliberately - the full list
// runs to dozens and turns the filter row into a wall.
const QUICK_CATEGORIES = [
    "movies",
    "tv shows",
    "anime",
    "torrents",
    "debrid support",
    "live tv",
    "subtitles",
];

// A directory page shows two dozen logos, each from whichever host that
// addon happens to use - seventeen different hosts on a typical page, most
// of them serving a 512px or 1024px image to fill a 40px box. Every one is
// a fresh DNS lookup and TLS handshake on a phone.
//
// So they come through this instance's own image cache instead: one host
// already connected, resized once and reused by everyone afterwards.
//
// With one exception that has to be handled rather than assumed away: a
// good number of addon hosts refuse datacenter addresses while answering a
// home connection perfectly (the same fact the Add button below already
// works around). When the proxy cannot fetch one, the original URL is used
// directly, which is exactly what happened before this existed.
function AddonLogo({ src }: { src: string }) {
    const proxied = cachedImageUrl(src, 64) || src;
    const [current, setCurrent] = useState(proxied);
    // A different addon in the same slot must not keep the previous src.
    useEffect(() => {
        setCurrent(cachedImageUrl(src, 64) || src);
    }, [src]);
    return (
        // eslint-disable-next-line @next/next/no-img-element
        /* biome-ignore lint/a11y/noNoninteractiveElementInteractions: Image load failures choose fallback artwork; this is not a user action. */
        <img
            alt=""
            className="h-10 w-10 shrink-0 rounded-lg bg-black/20 object-contain"
            decoding="async"
            height={40}
            loading="lazy"
            onError={() => {
                if (current !== src) {
                    setCurrent(src);
                }
            }}
            src={current}
            width={40}
        />
    );
}

export function AddonDirectoryModal({ isOpen, onClose, onAdded }: AddonDirectoryModalProps) {
    const [search, setSearch] = useState("");
    const [debouncedSearch, setDebouncedSearch] = useState("");
    const [category, setCategory] = useState("");
    const [page, setPage] = useState(1);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [addingUrl, setAddingUrl] = useState<string | null>(null);
    const [result, setResult] = useState<Awaited<
        ReturnType<typeof api.browseAddonDirectory>
    > | null>(null);

    // Reachability of the addons currently on screen, probed FROM THE BROWSER.
    // Deliberately not server-side: the server is on a VPS, and a large class
    // of popular addons (anything Cloudflare-fronted) refuses datacenter IPs
    // while answering a home connection perfectly - so a server-side probe
    // would wrongly condemn working addons as dead. It also costs the server
    // nothing, since each check runs on the viewer's own connection.
    //
    // Only genuinely unreachable addons are flagged: a failure here means the
    // browser could not reach it either, which is the same position the user
    // would be in.
    const [reachability, setReachability] = useState<Record<string, "ok" | "dead">>({});
    const [checkingReach, setCheckingReach] = useState(false);
    const [hideDead, setHideDead] = useState(false);

    const checkReachability = useCallback(
        async (urls: string[]) => {
            const unknown = urls.filter((u) => !(u in reachability));
            if (unknown.length === 0) {
                return;
            }
            setCheckingReach(true);
            // Small concurrency cap - a page of 24 all at once is a burst nobody
            // benefits from, and some hosts throttle it.
            const CONCURRENCY = 5;
            const found: Record<string, "ok" | "dead"> = {};
            let i = 0;
            await Promise.all(
                Array.from({ length: CONCURRENCY }, async () => {
                    while (i < unknown.length) {
                        const url = unknown[i++];
                        try {
                            const ctrl = new AbortController();
                            const t = setTimeout(() => ctrl.abort(), 8000);
                            const res = await fetch(url, { signal: ctrl.signal });
                            clearTimeout(t);
                            // A 403 is NOT dead - it is the addon refusing this particular
                            // caller. Only a hard failure or a non-manifest response counts.
                            found[url] =
                                res.ok || res.status === 403 || res.status === 401 ? "ok" : "dead";
                        } catch {
                            found[url] = "dead";
                        }
                    }
                })
            );
            setReachability((prev) => ({ ...prev, ...found }));
            setCheckingReach(false);
        },
        [reachability]
    );

    // Debounced so typing doesn't fire a request per keystroke - the server
    // caches, but the upstream directory shouldn't be hammered either.
    useEffect(() => {
        const t = setTimeout(() => {
            setDebouncedSearch(search.trim());
            setPage(1);
        }, 400);
        return () => clearTimeout(t);
    }, [search]);

    // Tracks the newest request so a slow earlier response can never overwrite
    // a newer one (classic search race - type fast, get stale results).
    const requestRef = useRef(0);

    const load = useCallback(async () => {
        const seq = ++requestRef.current;
        setLoading(true);
        setError(null);
        try {
            const res = await api.browseAddonDirectory({
                category: category || undefined,
                page,
                search: debouncedSearch || undefined,
            });
            if (seq !== requestRef.current) {
                return;
            }
            setResult(res);
        } catch (e) {
            if (seq !== requestRef.current) {
                return;
            }
            setError(e instanceof Error ? e.message : "Failed to load the addon directory");
        } finally {
            if (seq === requestRef.current) {
                setLoading(false);
            }
        }
    }, [page, debouncedSearch, category]);

    useEffect(() => {
        if (isOpen) {
            load();
        }
    }, [isOpen, load]);

    // Reset back to a clean browse when reopened, rather than resuming
    // whatever search was left over from last time.
    useEffect(() => {
        if (!isOpen) {
            setSearch("");
            setDebouncedSearch("");
            setCategory("");
            setPage(1);
            setResult(null);
            setError(null);
        }
    }, [isOpen]);

    const handleAdd = async (manifestUrl: string, name: string) => {
        setAddingUrl(manifestUrl);
        try {
            try {
                await api.createAddon({ manifestUrl, name });
            } catch (serverErr) {
                // The server could not fetch the manifest - very often because the
                // addon's host blocks datacenter/VPS IPs. Confirmed live: torrentio
                // and thepiratebay-plus both return 403 to two different VPS hosts
                // while returning 200 to a browser on a home connection.
                //
                // So retry from HERE. The browser is on the user's own connection,
                // which those addons don't block, and Stremio addons must serve
                // permissive CORS headers for Stremio's own web app to work - so
                // this read is allowed. The manifest is then handed to the server,
                // which already accepts a pre-fetched one and skips its own fetch.
                // Costs the server no bandwidth at all: the download happens here.
                let manifestData: unknown = null;
                try {
                    const res = await fetch(manifestUrl);
                    if (res.ok) {
                        manifestData = await res.json();
                    }
                } catch {
                    /* browser can't reach it either - genuinely unreachable */
                }

                if (!manifestData) {
                    throw serverErr; // report the server's own reason
                }
                await api.createAddon({ manifestData, manifestUrl, name });
            }
            toast.success(`Added ${name}`);
            onAdded();
        } catch (e) {
            toast.error(e instanceof Error ? e.message : `Failed to add ${name}`);
        } finally {
            setAddingUrl(null);
        }
    };

    return (
        <Modal isOpen={isOpen} onClose={onClose} size="full" title="Browse addon directory">
            <div className="space-y-4">
                <p className="text-muted text-sm">
                    Public addons from stremio-addons.net. Adding one here brings it into SlickSync
                    - you can then assign it to users or groups like any other addon.
                </p>

                <div className="relative">
                    <MagnifyingGlassIcon className="absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-subtle" />
                    <input
                        autoComplete="off"
                        className="input-base w-full py-2 pr-3 pl-9 text-sm"
                        onChange={(e) => setSearch(e.target.value)}
                        placeholder="Search addons..."
                        spellCheck={false}
                        type="text"
                        value={search}
                    />
                </div>

                <div className="flex flex-wrap gap-2">
                    <button
                        className={`rounded-lg px-3 py-1.5 font-medium text-xs transition-colors ${category ? "nav-item-hover-pill bg-surface-hover text-muted" : "bg-primary text-white"}`}
                        onClick={() => {
                            setCategory("");
                            setPage(1);
                        }}
                        type="button"
                    >
                        All
                    </button>
                    {QUICK_CATEGORIES.map((c) => (
                        <button
                            className={`rounded-lg px-3 py-1.5 font-medium text-xs capitalize transition-colors ${category === c ? "bg-primary text-white" : "nav-item-hover-pill bg-surface-hover text-muted"}`}
                            key={c}
                            onClick={() => {
                                setCategory(category === c ? "" : c);
                                setPage(1);
                            }}
                            type="button"
                        >
                            {c}
                        </button>
                    ))}
                </div>

                <div className="flex flex-wrap items-center justify-between gap-3">
                    <label className="flex cursor-pointer items-center gap-2 text-muted text-xs">
                        <input
                            checked={hideDead}
                            onChange={async (e) => {
                                setHideDead(e.target.checked);
                                if (e.target.checked && result) {
                                    await checkReachability(
                                        result.addons.map((a) => a.manifestUrl)
                                    );
                                }
                            }}
                            type="checkbox"
                        />
                        Hide addons that don&apos;t respond
                    </label>
                    {checkingReach && <span className="text-subtle text-xs">Checking addons…</span>}
                </div>

                {error && (
                    <div
                        className="rounded-lg p-3 text-sm"
                        style={{
                            background: "color-mix(in srgb, var(--color-error) 12%, transparent)",
                            color: "var(--color-text)",
                        }}
                    >
                        {error}
                        <Button className="ml-2" onClick={load} size="sm" variant="ghost">
                            Retry
                        </Button>
                    </div>
                )}

                <div className="max-h-[52vh] space-y-2 overflow-y-auto pr-1">
                    {/* SlickTrax leads the list itself - first row, above Torrentio -
              rather than a separate banner floating over the browse UI
              (user feedback: it belongs IN the list). Page 1 only, and it
              respects the search box like any other entry. */}
                    {page === 1 &&
                        (!search.trim() ||
                            "slicktrax continue watching watchlist catalogs".includes(
                                search.trim().toLowerCase()
                            )) && <SlickTraxRow />}
                    {loading && !result && (
                        <p className="py-6 text-center text-muted text-sm">Loading addons...</p>
                    )}
                    {!loading && result?.addons.length === 0 && (
                        <p className="py-6 text-center text-muted text-sm">
                            No addons match that search.
                        </p>
                    )}
                    {result?.addons
                        .filter((a) => !hideDead || reachability[a.manifestUrl] !== "dead")
                        .map((a) => (
                            <div
                                className="flex items-start gap-3 rounded-xl p-3"
                                key={a.manifestUrl}
                                style={{ background: "var(--color-surface-hover)" }}
                            >
                                {a.logo ? (
                                    // eslint-disable-next-line @next/next/no-img-element
                                    <AddonLogo src={a.logo} />
                                ) : (
                                    <div
                                        className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-subtle text-xs"
                                        style={{ background: "var(--color-bg-subtle)" }}
                                    >
                                        ?
                                    </div>
                                )}
                                <div className="min-w-0 flex-1">
                                    <div className="flex flex-wrap items-center gap-2">
                                        <span className="font-medium text-default">{a.name}</span>
                                        {reachability[a.manifestUrl] === "dead" && (
                                            <Badge size="sm" variant="error">
                                                Not responding
                                            </Badge>
                                        )}
                                        {a.stars > 0 && (
                                            <span className="inline-flex items-center gap-0.5 text-muted text-xs">
                                                <StarIcon className="h-3.5 w-3.5" />
                                                {a.stars}
                                            </span>
                                        )}
                                        {a.resources.slice(0, 4).map((r) => (
                                            <Badge key={r} size="sm" variant="default">
                                                {r}
                                            </Badge>
                                        ))}
                                    </div>
                                    {a.description && (
                                        <p className="mt-1 line-clamp-2 text-muted text-xs">
                                            {a.description}
                                        </p>
                                    )}
                                </div>
                                <div className="shrink-0">
                                    {a.configureUrl ? (
                                        <Button
                                            leftIcon={
                                                <ArrowTopRightOnSquareIcon className="h-4 w-4" />
                                            }
                                            onClick={() =>
                                                window.open(
                                                    a.configureUrl ?? undefined,
                                                    "_blank",
                                                    "noopener,noreferrer"
                                                )
                                            }
                                            size="sm"
                                            title="This addon needs setting up on its own site first - install the URL it gives you afterwards"
                                            variant="secondary"
                                        >
                                            Configure first
                                        </Button>
                                    ) : (
                                        <Button
                                            isLoading={addingUrl === a.manifestUrl}
                                            leftIcon={<PlusIcon className="h-4 w-4" />}
                                            onClick={() => handleAdd(a.manifestUrl, a.name)}
                                            size="sm"
                                            variant="primary"
                                        >
                                            Add
                                        </Button>
                                    )}
                                </div>
                            </div>
                        ))}
                </div>

                {result && result.pagination.totalPages > 1 && (
                    <div className="flex items-center justify-between pt-1">
                        <span className="text-muted text-xs">
                            Page {result.pagination.page} of {result.pagination.totalPages} ·{" "}
                            {result.pagination.total} addons
                        </span>
                        <div className="flex gap-2">
                            <Button
                                disabled={!result.pagination.hasPreviousPage || loading}
                                onClick={() => setPage((p) => Math.max(1, p - 1))}
                                size="sm"
                                variant="ghost"
                            >
                                Previous
                            </Button>
                            <Button
                                disabled={!result.pagination.hasNextPage || loading}
                                onClick={() => setPage((p) => p + 1)}
                                size="sm"
                                variant="ghost"
                            >
                                Next
                            </Button>
                        </div>
                    </div>
                )}
            </div>
        </Modal>
    );
}

// SlickTrax's front door in the place people actually look for addons -
// styled as the FIRST ROW of the directory list (above Torrentio), same
// shape as every other entry. The addon itself is PER-USER (a tokened
// manifest served by this very SlickSync), so instead of an Add button
// it's a picker: choose the person, and either enable-and-sync (the addon
// installs itself onto their account) or copy their manifest URL for a
// manual install anywhere. The per-user toggle on the user's own page
// remains the config home; this is discovery.
function SlickTraxRow() {
    const [users, setUsers] = useState<
        Array<{ id: string; username: string; traxAddonEnabled?: boolean }>
    >([]);
    const [userId, setUserId] = useState("");
    const [busy, setBusy] = useState(false);
    // Collapsed by default: one button, same as every other row (user
    // feedback - no picker sitting open in the list). "Configure" expands
    // the who-is-it-for step inline, because a per-user tokened addon can't
    // be a bare Add: there is no single manifest to add.
    const [open, setOpen] = useState(false);

    useEffect(() => {
        api.getUsers()
            .then((us) => {
                setUsers(
                    us.map((u) => ({
                        id: u.id,
                        traxAddonEnabled: u.traxAddonEnabled,
                        username: u.username || "Unnamed",
                    }))
                );
            })
            .catch(() => undefined);
    }, []);

    const selected = users.find((u) => u.id === userId) || null;

    const enableAndSync = async () => {
        if (!selected) {
            return;
        }
        setBusy(true);
        try {
            await api.setTraxAddon(selected.id, true);
            await api.syncUser(selected.id);
            setUsers((prev) =>
                prev.map((u) => (u.id === selected.id ? { ...u, traxAddonEnabled: true } : u))
            );
            toast.success(
                `SlickTrax enabled and synced onto ${selected.username}'s account - the rows appear on their devices`
            );
        } catch (e) {
            toast.error(e instanceof Error ? e.message : "Could not enable SlickTrax");
        } finally {
            setBusy(false);
        }
    };

    const copyUrl = async () => {
        if (!selected) {
            return;
        }
        setBusy(true);
        try {
            const r = await api.setTraxAddon(selected.id, true); // idempotent - stable token, returns the URL
            const ok = await copyToClipboard(r.manifestUrl);
            if (ok) {
                toast.success("Manifest URL copied - paste it into any Stremio-compatible app");
            } else {
                toast.error(`Copy failed - the URL is: ${r.manifestUrl}`);
            }
        } catch (e) {
            toast.error(e instanceof Error ? e.message : "Could not fetch the URL");
        } finally {
            setBusy(false);
        }
    };

    return (
        // Same row anatomy as the directory entries below (icon / name+badges+
        // description / action on the right); the faint primary border is the
        // only tell that this one is the house addon, not a directory listing.
        <div
            className="flex items-start gap-3 rounded-xl border p-3"
            style={{
                background: "var(--color-surface-hover)",
                borderColor: "color-mix(in srgb, var(--color-primary) 35%, transparent)",
            }}
        >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
                alt=""
                className="h-10 w-10 shrink-0 rounded-lg bg-black/20 object-contain"
                height={40}
                src="/android-chrome-192x192.png"
                width={40}
            />
            <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium text-default">SlickTrax</span>
                    <Badge size="sm" variant="default">
                        catalog
                    </Badge>
                    <span className="text-xs" style={{ color: "var(--color-primary)" }}>
                        this server&apos;s own addon
                    </span>
                </div>
                <p className="mt-1 text-muted text-xs">
                    Continue Watching, Watchlist and your Catalogs as rows inside Stremio and Nuvio
                    - served live by this SlickSync, personal to each user. Pick who, and it
                    installs itself on their next sync.
                </p>
            </div>
            <div className="flex shrink-0 items-center gap-2">
                {open ? (
                    <>
                        <select
                            className="input-base appearance-none px-3 py-2 pr-8 text-sm"
                            onChange={(e) => setUserId(e.target.value)}
                            value={userId}
                        >
                            <option value="">Pick a user...</option>
                            {users.map((u) => (
                                <option key={u.id} value={u.id}>
                                    {u.username}
                                    {u.traxAddonEnabled ? " (enabled)" : ""}
                                </option>
                            ))}
                        </select>
                        {selected && !selected.traxAddonEnabled && (
                            <Button
                                isLoading={busy}
                                onClick={enableAndSync}
                                size="sm"
                                variant="primary"
                            >
                                Add
                            </Button>
                        )}
                        {selected?.traxAddonEnabled && (
                            <Button
                                isLoading={busy}
                                onClick={copyUrl}
                                size="sm"
                                variant="secondary"
                            >
                                Copy manifest URL
                            </Button>
                        )}
                    </>
                ) : (
                    <Button
                        leftIcon={<ArrowTopRightOnSquareIcon className="h-4 w-4" />}
                        onClick={() => setOpen(true)}
                        size="sm"
                        title="SlickTrax is personal to each user - pick who it's for, then it installs itself"
                        variant="secondary"
                    >
                        Configure
                    </Button>
                )}
            </div>
        </div>
    );
}
