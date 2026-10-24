// Addons whose install links lead to the same saved configuration.
//
// AIOStreams and AIOMetadata keep a configuration on their own server and
// put its id in every install link: https://<host>/stremio/<config id>/...
// Two links can look different (each install gets its own encrypted part)
// and still open the very same settings, so changing one changes the other.
// SlickSync only matched identical links before, which is how a Stremio
// addon and a Nuvio addon sharing one configuration went unnoticed.

const CONFIG_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** host|config id for a link that names a saved configuration, else null. */
export function configKeyOf(url?: string | null): string | null {
    if (!url) {
        return null;
    }
    try {
        const parsed = new URL(url);
        const parts = parsed.pathname.split("/").filter(Boolean);
        const at = parts.indexOf("stremio");
        const id = at >= 0 ? parts[at + 1] : undefined;
        if (!(id && CONFIG_ID.test(id))) {
            return null;
        }
        return `${parsed.host.toLowerCase()}|${id.toLowerCase()}`;
    } catch {
        return null;
    }
}

/** What to call the configuration: the app it lives on, when that's clear. */
export function configKindOf(url?: string | null, name?: string | null): string {
    const text = `${url || ""} ${name || ""}`.toLowerCase();
    if (text.includes("aiometadata")) {
        return "AIOMetadata";
    }
    if (text.includes("aiostreams")) {
        return "AIOStreams";
    }
    return "";
}

export interface SharedPeer {
    id: string;
    name: string;
}

interface AddonLike {
    id: string;
    manifestUrl?: string | null;
    name: string;
    transportUrl?: string | null;
    url?: string | null;
}

/** For each addon sharing its configuration with others: those others. */
export function sharedConfigPeers(addons: AddonLike[]): Map<string, SharedPeer[]> {
    const byKey = new Map<string, AddonLike[]>();
    for (const addon of addons) {
        const key = configKeyOf(addon.manifestUrl || addon.transportUrl || addon.url);
        if (!key) {
            continue;
        }
        const list = byKey.get(key) || [];
        list.push(addon);
        byKey.set(key, list);
    }
    const peers = new Map<string, SharedPeer[]>();
    for (const list of byKey.values()) {
        if (list.length < 2) {
            continue;
        }
        for (const addon of list) {
            peers.set(
                addon.id,
                list
                    .filter((other) => other.id !== addon.id)
                    .map((other) => ({ id: other.id, name: other.name }))
            );
        }
    }
    return peers;
}

/** "A", "A and B", "A, B and C". */
export function joinNames(names: string[]): string {
    if (names.length <= 1) {
        return names[0] || "";
    }
    return `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;
}
