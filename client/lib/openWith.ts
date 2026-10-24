// "Open in …" on a title: which app it opens, chosen per device (this
// browser's storage - a phone can open Swiftfin while the TV opens Wholphin),
// and the link each app understands. Only apps that open straight to a title
// are listed; the item ids come from the server (/jellyfin/open-targets).

export type OpenWithAppId =
    | "aiostreams"
    | "swiftfin"
    | "streamyfin"
    | "infuse"
    | "web"
    | "shortcut";

export interface OpenTargetServer {
    address: string;
    itemId: string | null;
    kind: "jellyfin" | "aiostreams" | "aiometadata" | string;
    people: { name: string; userId: string | null }[];
    serverId: string | null;
}
export interface OpenTargetDevice {
    address: string;
    client: string | null;
    credentialId: string | null;
    device: string;
    itemId: string;
    person: string;
    personId: string;
    sessionId: string;
}
export interface OpenTargets {
    devices: OpenTargetDevice[];
    servers: OpenTargetServer[];
    tmdbId: string | null;
}

export interface OpenWithApp {
    color: string;
    id: OpenWithAppId;
    letter: string;
    name: string;
    platforms: string;
}

export const OPEN_WITH_APPS: OpenWithApp[] = [
    {
        color: "#7c6ff0",
        id: "aiostreams",
        letter: "A",
        name: "AIOStreams",
        platforms: "Android, desktop · AIOStreams servers",
    },
    {
        color: "#2a6df4",
        id: "swiftfin",
        letter: "S",
        name: "Swiftfin",
        platforms: "iPhone, iPad, Apple TV",
    },
    {
        color: "#9b3fd1",
        id: "streamyfin",
        letter: "S",
        name: "Streamyfin",
        platforms: "iPhone, Android",
    },
    {
        color: "#e46a2a",
        id: "infuse",
        letter: "I",
        name: "Infuse",
        platforms: "iPhone, Apple TV, Mac · titles in its own library",
    },
];
// Any app at all on iPhone, iPad or Mac: a Shortcut the person made once
// ("Open App -> Odin") is run by its name. It opens the app, not the title.
export const SHORTCUT_APP: OpenWithApp = {
    color: "#5b5b66",
    id: "shortcut",
    letter: "⌘",
    name: "Any app (through a Shortcut)",
    platforms: "iPhone, iPad, Mac · opens the app, not the title",
};
export const WEB_APP: OpenWithApp = {
    color: "#00a4dc",
    id: "web",
    letter: "J",
    name: "The server’s own page",
    platforms: "In a browser · works on any device",
};

const STORAGE_KEY = "slicksync-open-with";
export function rememberedApp(): OpenWithAppId | null {
    try {
        return (localStorage.getItem(STORAGE_KEY) as OpenWithAppId | null) || null;
    } catch {
        return null;
    }
}
export function rememberApp(id: OpenWithAppId) {
    try {
        localStorage.setItem(STORAGE_KEY, id);
    } catch {
        /* private mode: this visit only */
    }
}

const SHORTCUT_KEY = "slicksync-open-with-shortcut";
export interface ShortcutChoice {
    app: string;
    shortcut: string;
}
export function rememberedShortcut(): ShortcutChoice | null {
    try {
        const v = JSON.parse(localStorage.getItem(SHORTCUT_KEY) || "null");
        return v && typeof v.app === "string" && typeof v.shortcut === "string" && v.shortcut.trim()
            ? v
            : null;
    } catch {
        return null;
    }
}
export function rememberShortcut(choice: ShortcutChoice) {
    try {
        localStorage.setItem(SHORTCUT_KEY, JSON.stringify(choice));
    } catch {
        /* this visit only */
    }
}

const plainId = (id: string | null) => (id ? id.replace(/-/g, "") : "");

/**
 * The links an app gets for a title, one per server it can reach (several
 * people on one server share it; Swiftfin's link names the user, so it gets
 * one per person there).
 */
export function linksFor(
    app: OpenWithAppId,
    t: OpenTargets,
    type: "movie" | "series"
): { label: string; detail: string; url: string }[] {
    const out: { label: string; detail: string; url: string }[] = [];
    const host = (a: string) => a.replace(/^https?:\/\//, "");
    const names = (s: OpenTargetServer) => s.people.map((p) => p.name).join(", ");
    if (app === "shortcut") {
        const sc = rememberedShortcut();
        if (sc && t.servers.length) {
            out.push({
                detail: `Runs your Shortcut “${sc.shortcut}”`,
                label: sc.app || "Your app",
                url: `shortcuts://run-shortcut?name=${encodeURIComponent(sc.shortcut)}`,
            });
        }
        return out;
    }
    if (app === "infuse") {
        if (t.tmdbId && t.servers.length) {
            out.push({
                detail: "Opens it in your Infuse library",
                label: "Infuse",
                url: `infuse://${type === "movie" ? "movie" : "series"}/${t.tmdbId}`,
            });
        }
        return out;
    }
    for (const s of t.servers) {
        if (!s.itemId) {
            continue;
        }
        const id = s.itemId;
        if (app === "aiostreams") {
            if (s.kind === "aiostreams") {
                out.push({
                    detail: host(s.address),
                    label: names(s) || "AIOStreams",
                    url: `aiostreams://item/${id}?server=${encodeURIComponent(s.address)}`,
                });
            }
        } else if (app === "swiftfin") {
            if (!s.serverId) {
                continue;
            }
            for (const p of s.people) {
                if (p.userId) {
                    out.push({
                        detail: host(s.address),
                        label: p.name,
                        url: `swiftfin://${plainId(s.serverId)}/${plainId(p.userId)}/item/${plainId(id)}`,
                    });
                }
            }
        } else if (app === "streamyfin") {
            out.push({
                detail: host(s.address),
                label: names(s),
                url: `streamyfin://items/page?id=${encodeURIComponent(id)}`,
            });
        } else if (app === "web") {
            // Only a real Jellyfin has a web app; AIOStreams and AIOMetadata don't.
            if (s.kind === "jellyfin") {
                out.push({
                    detail: host(s.address),
                    label: names(s),
                    url: `${s.address}/web/#/details?id=${encodeURIComponent(id)}${s.serverId ? `&serverId=${encodeURIComponent(s.serverId)}` : ""}`,
                });
            }
        }
    }
    return out;
}

/** Apps that can open this title here at all, in list order. */
export function availableApps(t: OpenTargets, type: "movie" | "series"): OpenWithApp[] {
    return [...OPEN_WITH_APPS, WEB_APP, SHORTCUT_APP].filter(
        (a) => linksFor(a.id, t, type).length > 0
    );
}
