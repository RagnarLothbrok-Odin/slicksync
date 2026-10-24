// Discover's choices - kinds, orders, filters, genres - and describeGrid,
// which reads them back as the one line over the posters: "Popular 1990s
// comedy movies rated 7+". The server applies the filters
// (server/utils/discoverFacets.js, whose keys these are).

import type { DiscoverKind } from "./api";

export type Kind = DiscoverKind;
export type SortKey = "popular" | "trending" | "newest" | "rated" | "az";
export type Decade = "2020s" | "2010s" | "2000s" | "1990s" | "1980s" | "older";
export type Length = "short" | "mid" | "long";
export type WatchedFilter = "all" | "hide" | "only";

// Cinemeta's catalogs accept these genre extras verbatim (the v3-cinemeta
// manifest's genres). Kept flat rather than fetched on every visit.
export const GENRES = [
    "Action",
    "Adventure",
    "Animation",
    "Comedy",
    "Crime",
    "Documentary",
    "Drama",
    "Family",
    "Fantasy",
    "History",
    "Horror",
    "Music",
    "Mystery",
    "Romance",
    "Sci-Fi",
    "Thriller",
    "War",
    "Western",
];

// Each order is a catalog of its own; A to Z reorders what has arrived.
// Trending needs a LumiereDB, so the page leaves it out without one.
export const SORTS: Array<{
    key: SortKey;
    label: string;
    catalog: "top" | "trending" | "year" | "imdbRating";
    about: string;
}> = [
    {
        about: "What most people are watching",
        catalog: "top",
        key: "popular",
        label: "Most popular",
    },
    {
        about: "What’s being watched most right now",
        catalog: "trending",
        key: "trending",
        label: "Trending",
    },
    { about: "The newest releases first", catalog: "year", key: "newest", label: "Newest" },
    {
        about: "The best rated on IMDb first",
        catalog: "imdbRating",
        key: "rated",
        label: "Highest rated",
    },
    { about: "Popular titles, A to Z", catalog: "top", key: "az", label: "A to Z" },
];

// The watchlist keeps the order things were added in unless asked otherwise.
export type WatchlistSort = "added" | "first" | "az";
export const WATCHLIST_SORTS: Array<{ key: WatchlistSort; label: string }> = [
    { key: "added", label: "Recently added" },
    { key: "first", label: "Added longest ago" },
    { key: "az", label: "A to Z" },
];

export const DECADES: Array<{ key: Decade; label: string }> = [
    { key: "2020s", label: "2020s" },
    { key: "2010s", label: "2010s" },
    { key: "2000s", label: "2000s" },
    { key: "1990s", label: "1990s" },
    { key: "1980s", label: "1980s" },
    { key: "older", label: "Older" },
];

export const RATINGS = [6, 7, 8];

export const LENGTHS: Array<{ key: Length; label: string; phrase: string }> = [
    { key: "short", label: "Under 90 min", phrase: "under 90 minutes" },
    { key: "mid", label: "90 min – 2 h", phrase: "90 minutes to 2 hours" },
    { key: "long", label: "Over 2 h", phrase: "over 2 hours" },
];

export const KINDS: Array<{ key: Kind; label: string }> = [
    { key: "movie", label: "Movies" },
    { key: "series", label: "Shows" },
    { key: "both", label: "Both" },
];

/** What the grid holds, in words: "Popular 1990s comedy movies rated 7+". */
export function describeGrid(o: {
    sort: SortKey;
    kind: Kind;
    genre: string | null;
    decade: Decade | null;
    minRating: number | null;
    length: Length | null;
    query: string;
}): string {
    const noun = o.kind === "movie" ? "movies" : o.kind === "series" ? "shows" : "movies and shows";
    const lead = o.query
        ? ""
        : {
              az: "",
              newest: "Newest",
              popular: "Popular",
              rated: "Top rated",
              trending: "Trending",
          }[o.sort];
    const parts = [
        lead,
        o.decade ? (o.decade === "older" ? "pre-1980" : o.decade) : "",
        o.genre ? o.genre.toLowerCase() : "",
        noun,
    ].filter(Boolean);
    let text = parts.join(" ");
    text = text.charAt(0).toUpperCase() + text.slice(1);
    if (o.query) {
        text += ` matching “${o.query}”`;
    }
    if (o.minRating) {
        text += ` rated ${o.minRating}+`;
    }
    if (o.length) {
        text += `, ${LENGTHS.find((l) => l.key === o.length)?.phrase}`;
    }
    if (o.sort === "az" && !o.query) {
        text += ", A to Z";
    }
    return text;
}

/** A list arriving a page at a time: each title once, in the order sent. */
export function uniqueById<T extends { id: string }>(items: readonly T[]): T[] {
    return mergeNew([], items);
}

/** What a later page adds - titles the list doesn't hold yet, each once. */
export function mergeNew<T extends { id: string }>(held: readonly T[], page: readonly T[]): T[] {
    const seen = new Set(held.map((item) => item.id));
    const additions: T[] = [];
    for (const item of page) {
        if (seen.has(item.id)) {
            continue;
        }
        seen.add(item.id);
        additions.push(item);
    }
    return additions;
}

/** How long to wait before asking again for a page that failed, or null to stop. */
export function retryDelay(attempt: number): number | null {
    const waits = [1500, 4000, 8000];
    return attempt < waits.length ? waits[attempt] : null;
}

/** A random title from `pool` not in `seen`, or null when there is none. */
export function pickSurprise<T extends { id: string }>(
    pool: readonly T[],
    seen: ReadonlySet<string>
): T | null {
    const fresh = pool.filter((p) => !seen.has(p.id));
    if (fresh.length === 0) {
        return null;
    }
    return fresh[Math.floor(Math.random() * fresh.length)];
}
