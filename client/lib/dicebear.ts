// Snapshot of the public style index, used while the live list loads.
export const DICEBEAR_STYLES = [
    "adventurer",
    "adventurer-neutral",
    "avataaars",
    "avataaars-neutral",
    "big-ears",
    "big-ears-neutral",
    "big-smile",
    "blobs",
    "bottts",
    "bottts-neutral",
    "clay",
    "constellation",
    "critters",
    "croodles",
    "croodles-neutral",
    "disco",
    "dylan",
    "fun-emoji",
    "glass",
    "glyphs",
    "icons",
    "identicon",
    "initial-face",
    "initials",
    "landscape",
    "loops",
    "lorelei",
    "lorelei-neutral",
    "micah",
    "miniavs",
    "moods",
    "notionists",
    "notionists-neutral",
    "open-peeps",
    "personas",
    "pixel-art",
    "pixel-art-neutral",
    "pixelbot",
    "planets",
    "rings",
    "shape-grid",
    "shapes",
    "sprouts",
    "squircles",
    "stripes",
    "thumbs",
    "toon-head",
    "triangles",
    "voxel-art",
    "voxel-bot",
    "waves",
    "weave",
] as const;

export const DICEBEAR_BASE = "https://api.dicebear.com/10.x";
export function diceBearUrl(style: string, seed: string, background?: string) {
    const query = new URLSearchParams({ seed });
    if (background) {
        query.set("backgroundColor", background);
    }
    return `${DICEBEAR_BASE}/${encodeURIComponent(style)}/svg?${query}`;
}
export function diceBearSelection(src?: string | null) {
    if (!src) {
        return null;
    }
    try {
        const url = new URL(src);
        const match = /^\/10\.x\/([a-z0-9-]+)\/svg$/.exec(url.pathname);
        if (url.origin !== "https://api.dicebear.com" || !match) {
            return null;
        }
        return {
            background: url.searchParams.get("backgroundColor") || "",
            seed: url.searchParams.get("seed") || "profile",
            style: match[1],
        };
    } catch {
        return null;
    }
}
export const styleName = (style: string) =>
    style
        .split("-")
        .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
        .join(" ");
