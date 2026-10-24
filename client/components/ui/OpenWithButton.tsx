"use client";

// "Open in …" on a title popup, for anyone here on Jellyfin, AIOStreams or
// AIOMetadata: the main part opens the title in the app this device chose
// (lib/openWith.ts), the arrow picks the app - and on a real Jellyfin, "Play
// on a device" starts it on a device that has a Jellyfin app open. The picker
// uses the shared ContextMenu, so it always stays whole on screen.

import { CheckIcon, ChevronDownIcon, PlayIcon } from "@heroicons/react/24/outline";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { ContextMenu } from "@/components/ui/ContextMenu";
import { toast } from "@/components/ui/Toast";
import { api } from "@/lib/api";
import {
    availableApps,
    linksFor,
    OPEN_WITH_APPS,
    type OpenTargets,
    type OpenWithAppId,
    rememberApp,
    rememberedApp,
    rememberedShortcut,
    rememberShortcut,
    SHORTCUT_APP,
    WEB_APP,
} from "@/lib/openWith";

const cache = new Map<string, Promise<OpenTargets>>();
function loadTargets(id: string, type: "movie" | "series") {
    const key = `${type}:${id}`;
    const cached = cache.get(key);
    if (cached) {
        return cached;
    }
    const pending = api
        .getOpenTargets(id, type)
        .catch(() => ({ devices: [], servers: [], tmdbId: null }));
    cache.set(key, pending);
    return pending;
}

const STYLE = {
    background: "linear-gradient(110deg, rgba(212, 208, 255, 0.13), rgba(124, 111, 240, 0.22))",
    border: "1px solid rgba(159, 146, 255, 0.25)",
    color: "rgb(212, 208, 255)",
};

export function OpenWithButton({
    imdbId,
    type,
    isTV = false,
}: {
    imdbId: string;
    type: "movie" | "series";
    isTV?: boolean;
}) {
    const fieldId1 = useId();
    const [targets, setTargets] = useState<OpenTargets | null>(null);
    // Read straight away: nothing renders until the targets load, on the client.
    const [chosen, setChosen] = useState<OpenWithAppId | null>(() =>
        typeof window === "undefined" ? null : rememberedApp()
    );
    const [menu, setMenu] = useState<{
        x: number;
        y: number;
        mode: "apps" | "which" | "setup";
    } | null>(null);
    // The Shortcut's names while they're being typed, and a counter that makes
    // the list re-read them once saved.
    const [scDraft, setScDraft] = useState({ app: "", shortcut: "" });
    const [scSaved, setScSaved] = useState(0);
    const arrowRef = useRef<HTMLButtonElement>(null);
    const mainRef = useRef<HTMLButtonElement>(null);

    useEffect(() => {
        let cancelled = false;
        loadTargets(imdbId, type).then((t) => {
            if (!cancelled) {
                setTargets(t);
            }
        });
        return () => {
            cancelled = true;
        };
    }, [imdbId, type]);

    // eslint-disable-next-line react-hooks/exhaustive-deps -- scSaved re-reads the saved Shortcut
    const apps = useMemo(
        () => (targets ? availableApps(targets, type) : []),
        [targets, type, scSaved]
    );
    if (!(targets && (apps.length || targets.devices.length))) {
        return null;
    }

    // This device's pick when it can open this title; otherwise the first that can.
    const current = apps.find((a) => a.id === chosen) || apps[0] || null;
    const links = current ? linksFor(current.id, targets, type) : [];
    const go = (url: string) => {
        window.location.href = url;
    };
    const openMenuAt = (el: HTMLElement | null, mode: "apps" | "which") => {
        const r = el?.getBoundingClientRect();
        setMenu({ mode, x: r ? r.left : 16, y: r ? r.bottom + 6 : 80 });
    };
    const onMain = () => {
        if (!current) {
            return openMenuAt(arrowRef.current, "apps");
        }
        if (links.length === 1) {
            return go(links[0].url);
        }
        openMenuAt(mainRef.current, "which");
    };
    const pick = (id: OpenWithAppId) => {
        rememberApp(id);
        setChosen(id);
        setMenu(null);
    };
    const startShortcut = () => {
        const sc = rememberedShortcut();
        setScDraft({ app: sc?.app || "", shortcut: sc?.shortcut || "" });
        setMenu((m) => (m ? { ...m, mode: "setup" } : m));
    };
    const saveShortcut = () => {
        const app = scDraft.app.trim();
        const shortcut = scDraft.shortcut.trim() || (app ? `Open ${app}` : "");
        if (!shortcut) {
            return;
        }
        rememberShortcut({ app: app || "your app", shortcut });
        setScSaved((n) => n + 1);
        pick("shortcut");
    };
    const playOn = async (d: OpenTargets["devices"][number]) => {
        setMenu(null);
        try {
            await api.playOnDevice({
                credentialId: d.credentialId,
                itemId: d.itemId,
                personId: d.personId,
                sessionId: d.sessionId,
            });
            toast.success(`Playing on ${d.device}`);
        } catch (e) {
            toast.error((e as Error)?.message || "That device did not answer");
        }
    };

    const label =
        current?.id === "aiostreams" ? (
            <>
                Open in <span style={{ color: "#ffffff", fontWeight: 600 }}>AIO</span>Streams
            </>
        ) : current?.id === "shortcut" ? (
            <>Open in {rememberedShortcut()?.app || "your app"}</>
        ) : current ? (
            <>Open in {current.id === "web" ? "browser" : current.name}</>
        ) : (
            <>Play on…</>
        );

    // TV: Enter opens the first link of this device's pick; no picker on a remote.
    if (isTV) {
        if (!links.length) {
            return null;
        }
        return (
            <a
                className="flex items-center justify-center gap-1.5 rounded-lg px-4 py-2 font-medium text-sm"
                href={links[0].url}
                style={STYLE}
                tabIndex={-1}
            >
                <PlayIcon className="h-4 w-4" />
                <span>{label}</span>
            </a>
        );
    }

    const row =
        "w-full flex items-center gap-2.5 px-2 py-2 rounded-lg hover:bg-surface-hover text-left";
    return (
        <>
            {/* On a phone the button is full width with the arrow laid over its right
          end, so the icon-and-text block centres exactly like Stremio's and
          Nuvio's above it and the play icons line up. */}
            <div className="relative flex w-full rounded-lg sm:w-auto">
                <button
                    className="flex flex-1 items-center justify-center whitespace-nowrap rounded-lg px-4 py-2 font-medium text-sm sm:rounded-r-none sm:pr-3"
                    onClick={onMain}
                    ref={mainRef}
                    style={STYLE}
                    type="button"
                >
                    <span className="inline-flex w-[11rem] items-center gap-1.5 sm:w-auto">
                        <PlayIcon className="h-4 w-4 shrink-0" />
                        <span>{label}</span>
                    </span>
                </button>
                <button
                    aria-label="Choose the app"
                    className="absolute inset-y-0 right-0 flex items-center rounded-r-lg border-l px-3 sm:static"
                    onClick={() => openMenuAt(arrowRef.current, "apps")}
                    ref={arrowRef}
                    style={{ ...STYLE, borderLeft: "1px solid rgba(159, 146, 255, 0.35)" }}
                    type="button"
                >
                    <ChevronDownIcon className="h-4 w-4" />
                </button>
            </div>

            <ContextMenu
                isOpen={!!menu}
                onClose={() => setMenu(null)}
                position={{ x: menu?.x ?? 0, y: menu?.y ?? 0 }}
            >
                <div className="w-[min(320px,calc(100vw-1.5rem))] p-1.5">
                    {menu?.mode === "setup" ? (
                        <div className="px-2 py-1">
                            <div className="font-semibold text-[15px] text-default">
                                Any app (through a Shortcut)
                            </div>
                            <div className="mb-2 text-[13px] text-muted">
                                Remembered on this device only
                            </div>
                            <label
                                className="mb-1 block text-[13px] text-muted"
                                htmlFor={`${fieldId1}-1`}
                            >
                                App name, for the button
                            </label>
                            <input
                                className="input-base mb-2.5 w-full px-3 py-2 text-[15px]"
                                id={`${fieldId1}-1`}
                                onChange={(e) => setScDraft((d) => ({ ...d, app: e.target.value }))}
                                placeholder="Odin"
                                value={scDraft.app}
                            />
                            <label
                                className="mb-1 block text-[13px] text-muted"
                                htmlFor={`${fieldId1}-2`}
                            >
                                Shortcut name
                            </label>
                            <input
                                className="input-base w-full px-3 py-2 text-[15px]"
                                id={`${fieldId1}-2`}
                                onChange={(e) =>
                                    setScDraft((d) => ({ ...d, shortcut: e.target.value }))
                                }
                                placeholder={scDraft.app ? `Open ${scDraft.app}` : "Open Odin"}
                                value={scDraft.shortcut}
                            />
                            <div className="mt-3 text-[13px] text-muted leading-relaxed">
                                <span className="font-medium text-default">
                                    Make the Shortcut once:
                                </span>
                                <br />
                                1. Open the Shortcuts app and tap +.
                                <br />
                                2. Add the action{" "}
                                <span className="font-medium text-default">Open App</span> and
                                choose {scDraft.app.trim() || "the app"}.<br />
                                3. Name it{" "}
                                <span className="font-medium text-default">
                                    {scDraft.shortcut.trim() ||
                                        (scDraft.app.trim()
                                            ? `Open ${scDraft.app.trim()}`
                                            : "Open Odin")}
                                </span>
                                .
                            </div>
                            <div className="mt-3 flex justify-end gap-2">
                                <button
                                    className="rounded-lg px-3 text-default hover:bg-surface-hover"
                                    onClick={() => setMenu((m) => (m ? { ...m, mode: "apps" } : m))}
                                    type="button"
                                >
                                    Back
                                </button>
                                <button
                                    className="rounded-lg px-3 font-semibold text-white disabled:opacity-50"
                                    disabled={!(scDraft.app.trim() || scDraft.shortcut.trim())}
                                    onClick={saveShortcut}
                                    style={{ background: "var(--color-primary)" }}
                                    type="button"
                                >
                                    Use it
                                </button>
                            </div>
                        </div>
                    ) : menu?.mode === "which" && current ? (
                        <>
                            <div className="px-2 pt-1 pb-2 font-semibold text-[15px] text-default">
                                Open in {current.id === "web" ? "a browser" : current.name} on…
                            </div>
                            {links.map((l) => (
                                <button
                                    className={row}
                                    key={l.url}
                                    onClick={() => {
                                        setMenu(null);
                                        go(l.url);
                                    }}
                                    type="button"
                                >
                                    <span className="min-w-0 flex-1">
                                        <span className="block truncate text-[15px] text-default">
                                            {l.label}
                                        </span>
                                        <span className="block truncate text-[13px] text-muted">
                                            {l.detail}
                                        </span>
                                    </span>
                                </button>
                            ))}
                        </>
                    ) : (
                        <>
                            <div className="px-2 pt-1 pb-2">
                                <div className="font-semibold text-[15px] text-default">
                                    Open titles with
                                </div>
                                <div className="text-[13px] text-muted">
                                    Your pick is remembered on this device only - each phone, tablet
                                    or TV keeps its own
                                </div>
                            </div>
                            {[...OPEN_WITH_APPS, WEB_APP]
                                .filter((a) => apps.some((x) => x.id === a.id))
                                .map((a) => (
                                    <button
                                        className={`${row} ${a.id === current?.id ? "bg-surface-hover" : ""}`}
                                        key={a.id}
                                        onClick={() => pick(a.id)}
                                        type="button"
                                    >
                                        <span
                                            className="flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-[7px] font-extrabold text-white text-xs"
                                            style={{ background: a.color }}
                                        >
                                            {a.letter}
                                        </span>
                                        <span className="min-w-0 flex-1">
                                            <span className="block truncate text-[15px] text-default">
                                                {a.name}
                                            </span>
                                            <span className="block truncate text-[13px] text-muted">
                                                {a.platforms}
                                            </span>
                                        </span>
                                        {a.id === current?.id && (
                                            <CheckIcon
                                                className="h-4 w-4 shrink-0"
                                                style={{ color: "var(--color-primary)" }}
                                            />
                                        )}
                                    </button>
                                ))}
                            {targets.servers.length > 0 && (
                                <button
                                    className={`${row} ${current?.id === "shortcut" ? "bg-surface-hover" : ""}`}
                                    onClick={startShortcut}
                                    type="button"
                                >
                                    <span
                                        className="flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-[7px] font-extrabold text-white text-xs"
                                        style={{ background: SHORTCUT_APP.color }}
                                    >
                                        {SHORTCUT_APP.letter}
                                    </span>
                                    <span className="min-w-0 flex-1">
                                        <span className="block truncate text-[15px] text-default">
                                            {current?.id === "shortcut"
                                                ? `${rememberedShortcut()?.app || "Your app"} (through a Shortcut)`
                                                : SHORTCUT_APP.name}
                                        </span>
                                        <span className="block truncate text-[13px] text-muted">
                                            {SHORTCUT_APP.platforms}
                                        </span>
                                    </span>
                                    {current?.id === "shortcut" && (
                                        <CheckIcon
                                            className="h-4 w-4 shrink-0"
                                            style={{ color: "var(--color-primary)" }}
                                        />
                                    )}
                                </button>
                            )}
                            {targets.devices.length > 0 && (
                                <>
                                    <div className="px-2 pt-2.5 pb-1 text-[12px] text-muted tracking-wide">
                                        PLAY ON A DEVICE · JELLYFIN
                                    </div>
                                    {targets.devices.map((d) => (
                                        <button
                                            className={row}
                                            key={`${d.address}|${d.sessionId}`}
                                            onClick={() => playOn(d)}
                                            type="button"
                                        >
                                            <span
                                                className="flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-[7px] text-white"
                                                style={{ background: "var(--color-success)" }}
                                            >
                                                <PlayIcon className="h-3.5 w-3.5" />
                                            </span>
                                            <span className="min-w-0 flex-1">
                                                <span className="block truncate text-[15px] text-default">
                                                    {d.device}
                                                </span>
                                                <span className="block truncate text-[13px] text-muted">
                                                    {[d.client, d.person]
                                                        .filter(Boolean)
                                                        .join(" · ")}
                                                </span>
                                            </span>
                                        </button>
                                    ))}
                                </>
                            )}
                            {apps.some((a) => a.id === "swiftfin" || a.id === "streamyfin") && (
                                <div className="mt-1.5 border-default border-t px-2 pt-2 text-[13px] text-muted">
                                    The app needs to be signed in to that server already.
                                </div>
                            )}
                        </>
                    )}
                </div>
            </ContextMenu>
        </>
    );
}
