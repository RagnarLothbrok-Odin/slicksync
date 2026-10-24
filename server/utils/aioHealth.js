// AIOStreams health on a person's page: what AIOStreams itself says about
// their configuration's addons, and a one-off "test this title" search.
// Read-only - nothing here writes to the configuration.
//
// Only for people added with their configuration password (aioConfigId +
// aioConfigPassword): AIOStreams' user API takes nothing else. A Quick
// Connect add has no password, so the card says so instead.
//
// - GET /api/v1/status: whether this instance has per-user analytics on
//   (settings.userAnalyticsEnabled). Off is the default - AIOStreams answers
//   the analytics route with 403 then, so the card says it plainly and asks
//   nothing.
// - GET /api/v1/user/analytics?range=24h|7d (Basic uuid:password): per addon,
//   requests, error and empty rates, speed, and AIOStreams' own "slow" and
//   "redundant" flags - shown as AIOStreams' words, not SlickSync's verdict.
// - GET /api/v1/user/client-agents: the apps seen using the configuration.
// - GET /api/v1/search?type=&id=&format=true: a real search through every
//   addon and debrid service, so it costs what playing would. AIOStreams
//   allows about 5 per 10 seconds per address, so one runs at a time per
//   person, with a short pause between runs, and never on a schedule.

const { instanceBase } = require("./aiostreamsConfig");

const REQUEST_TIMEOUT_MS = 20_000;
const SEARCH_TIMEOUT_MS = 60_000;
const SEARCH_COOLDOWN_MS = 10 * 1000;

function fail(message, status = 400) {
    return Object.assign(new Error(message), { status });
}

function restrictsPrivateAddresses() {
    try {
        return require("./config").INSTANCE_TYPE === "public";
    } catch {
        return false;
    }
}

async function personFor(prisma, accountId, userId) {
    const person = await prisma.user.findFirst({
        select: {
            accountId: true,
            aioConfigId: true,
            aioConfigPassword: true,
            id: true,
            jellyfinServerKind: true,
            jellyfinServerUrl: true,
            providerType: true,
            username: true,
        },
        where: { accountId, id: userId },
    });
    if (!person) {
        throw fail("User not found", 404);
    }
    return person;
}

function isAio(person) {
    return person.providerType === "jellyfin" && person.jellyfinServerKind === "aiostreams";
}

async function call(base, path, { auth, timeoutMs = REQUEST_TIMEOUT_MS } = {}) {
    const strict = restrictsPrivateAddresses();
    if (strict) {
        const { assertSafeUrl } = require("./safeUrl");
        await assertSafeUrl(base);
    }
    let res;
    try {
        const init = {
            headers: { Accept: "application/json", ...(auth ? { Authorization: auth } : {}) },
            signal: AbortSignal.timeout(timeoutMs),
        };
        // The check above vouches for the first address only; on an instance
        // serving strangers a redirect is held to the same rule, hop by hop.
        res = strict
            ? await require("./safeUrl").safeFetch(`${base}${path}`, init, { allowPrivate: false })
            : await fetch(`${base}${path}`, init);
    } catch (e) {
        const timedOut = e?.name === "TimeoutError" || e?.name === "AbortError";
        const refused = /^(blocked host|unsupported protocol|invalid url|too many redirects)$/.test(
            e?.message || ""
        );
        throw fail(
            timedOut
                ? "AIOStreams did not answer in time"
                : refused
                  ? "AIOStreams sent this server to an address it does not connect to"
                  : `Could not reach AIOStreams: ${e?.cause?.code || e?.message || "network error"}`,
            502
        );
    }
    const body = await res.json().catch(() => null);
    if (!res.ok || body?.success === false) {
        const message = body?.error?.message || `AIOStreams answered ${res.status}`;
        throw fail(
            message,
            res.status === 401 || res.status === 403 ? res.status : res.status >= 500 ? 502 : 400
        );
    }
    return body?.data ?? body;
}

function accessFor(person, decrypt) {
    const base = instanceBase(person.jellyfinServerUrl);
    if (!base) {
        throw fail("Not an AIOStreams address");
    }
    const password = decrypt(person.aioConfigPassword, {
        appAccountId: person.accountId || "default",
    });
    return {
        auth: `Basic ${Buffer.from(`${person.aioConfigId}:${password}`).toString("base64")}`,
        base,
    };
}

// AIOStreams sends its rates as percentages already (0-100, one decimal).
const pct = (n) => Math.round((Number(n) || 0) * 10) / 10;

/** The addon list AIOStreams reports, in SlickSync's words, worst first. */
function summarizeAnalytics(data) {
    const addons = (Array.isArray(data?.perAddon) ? data.perAddon : []).map((a) => ({
        avgLatencyMs: a.avgLatencyMs == null ? null : Math.round(a.avgLatencyMs),
        emptyRate: pct(a.emptyRate),
        errorRate: pct(a.errorRate),
        name: a.addonName || a.presetType || "Addon",
        preset: a.presetType || null,
        redundant: a.redundant === true,
        requests: Number(a.requests) || 0,
        share: pct(a.finalShare),
        // AIOStreams' own flags, passed through as its words: slow is "cut off for
        // taking too long on over 30% of searches", redundant "its results nearly
        // always duplicated by other addons".
        slow: a.slow === true,
    }));
    const trouble = (a) => (a.errorRate >= 20 ? 3 : 0) + (a.slow ? 2 : 0) + (a.redundant ? 1 : 0);
    addons.sort(
        (x, y) => trouble(y) - trouble(x) || y.errorRate - x.errorRate || y.requests - x.requests
    );
    return {
        addons,
        errorRate: pct(data?.totals?.errorRate),
        range: data?.range === "24h" ? "24h" : "7d",
        requests: Number(data?.totals?.requests) || 0,
        services: (Array.isArray(data?.perService) ? data.perService : []).map((s) => ({
            cachedShare: pct(s.cachedShare),
            id: s.serviceId,
            streams: Number(s.finalCount) || 0,
        })),
    };
}

/** What they watched lately, to test with one click: films, and each show's latest episode. */
async function recentTitles(prisma, accountId, userId) {
    const [movies, episodes] = await Promise.all([
        prisma.movieWatchHistory.findMany({
            orderBy: { watchedAt: "desc" },
            select: { itemId: true, itemName: true },
            take: 3,
            where: { accountId, userId },
        }),
        prisma.episodeWatchHistory.findMany({
            orderBy: { watchedAt: "desc" },
            select: { episode: true, season: true, showId: true, showName: true, videoId: true },
            take: 12,
            where: { accountId, userId },
        }),
    ]);
    const shows = new Map();
    for (const e of episodes) {
        if (!shows.has(e.showId) && e.videoId) {
            shows.set(e.showId, e);
        }
    }
    return [
        ...movies.map((m) => ({ id: m.itemId, name: m.itemName, type: "movie" })),
        ...[...shows.values()].slice(0, 3).map((e) => ({
            id: e.videoId,
            name:
                e.season != null && e.episode != null
                    ? `${e.showName} S${e.season}E${e.episode}`
                    : e.showName,
            type: "series",
        })),
    ];
}

/** Analytics (when the instance has them on) and the apps seen, for the card. */
async function healthFor(prisma, decrypt, accountId, userId, { range = "24h" } = {}) {
    const person = await personFor(prisma, accountId, userId);
    if (!isAio(person)) {
        return { available: false };
    }
    if (!(person.aioConfigId && person.aioConfigPassword)) {
        return {
            available: true,
            canRead: false,
            reason: `${person.username} was added without the configuration password, so AIOStreams won't share this. Reconnect them with it to see it.`,
        };
    }
    const access = accessFor(person, decrypt);
    const status = await call(access.base, "/api/v1/status").catch(() => null);
    const settings = status?.settings || {};
    const out = {
        analytics: null,
        analyticsEnabled:
            settings.analyticsEnabled !== false && settings.userAnalyticsEnabled === true,
        apps: [],
        available: true,
        canRead: true,
        searchAvailable: settings.searchApiDisabled !== true,
    };
    if (out.analyticsEnabled) {
        try {
            out.analytics = summarizeAnalytics(
                await call(
                    access.base,
                    `/api/v1/user/analytics?range=${range === "7d" ? "7d" : "24h"}`,
                    { auth: access.auth }
                )
            );
        } catch (e) {
            // Turned off since the status read, or the password changed.
            if (e.status === 403) {
                out.analyticsEnabled = false;
            } else {
                out.analyticsError = e.message;
            }
        }
    }
    out.recent = await recentTitles(prisma, accountId, person.id).catch(() => []);
    try {
        const agents = await call(access.base, "/api/v1/user/client-agents", { auth: access.auth });
        // { userAgent, lastSeen (ms), requests } - newest first. SlickSync's own
        // requests are recorded too (its test searches, and its library reads,
        // which go out as the bare runtime "Bun/1.x"); they aren't an app anyone uses.
        out.apps = (Array.isArray(agents) ? agents : [])
            .map((a) =>
                typeof a === "string"
                    ? { lastSeen: null, name: a }
                    : {
                          lastSeen: a.lastSeen ? new Date(a.lastSeen).toISOString() : null,
                          name: a.userAgent || a.name || "App",
                      }
            )
            .filter(
                (a) =>
                    !(/\bSlickSync\//.test(a.name) || /^(Bun|node)\/[\d.]+$/i.test(a.name.trim()))
            )
            .slice(0, 10);
    } catch {
        /* optional */
    }
    return out;
}

// One search at a time per person, and a pause between them.
const running = new Map();

/** What one search found, in a few lines - never the stream links themselves. */
function summarizeSearch(data) {
    const results = Array.isArray(data?.results) ? data.results : [];
    const byAddon = new Map();
    for (const r of results) {
        const name = r.addon || "Unknown addon";
        if (!byAddon.has(name)) {
            byAddon.set(name, { cached: 0, library: 0, name, streams: 0 });
        }
        const row = byAddon.get(name);
        row.streams++;
        if (r.cached === true) {
            row.cached++;
        }
        if (r.library === true) {
            row.library++;
        }
    }
    return {
        addons: [...byAddon.values()].sort((a, b) => b.streams - a.streams),
        cached: results.filter((r) => r.cached === true).length,
        errors: (Array.isArray(data?.errors) ? data.errors : [])
            .map((e) => ({ description: e.description || "", title: e.title || "Error" }))
            .slice(0, 20),
        p2p: results.filter((r) => r.type === "p2p" || (r.infoHash && !r.service)).length,
        streams: results.length,
        usenet: results.filter((r) => r.type === "usenet" || r.nzbUrl).length,
    };
}

/** A Stremio-style id: tt123, tt123:1:2, tmdb:603, kitsu:1. */
function cleanId(type, id) {
    const value = String(id || "").trim();
    if (!/^[a-z0-9]+(:[a-z0-9.-]+)*$/i.test(value) || value.length > 80) {
        throw fail("That isn’t a title id SlickSync can search for");
    }
    if (type === "series" && !/:\d+:\d+$/.test(value)) {
        throw fail("For a show, pick an episode - the id ends in :season:episode");
    }
    return value;
}

async function testSearch(
    prisma,
    decrypt,
    accountId,
    userId,
    { type, id },
    { now = Date.now() } = {}
) {
    const kind = type === "series" ? "series" : type === "movie" ? "movie" : null;
    if (!kind) {
        throw fail("Pick a film or an episode");
    }
    const titleId = cleanId(kind, id);
    const person = await personFor(prisma, accountId, userId);
    if (!isAio(person)) {
        throw fail("Only for someone on AIOStreams");
    }
    if (!(person.aioConfigId && person.aioConfigPassword)) {
        throw fail(
            `${person.username} was added without the configuration password, so AIOStreams won't run this.`,
            409
        );
    }

    const last = running.get(person.id);
    if (last?.busy) {
        throw fail("A test for this person is still running", 429);
    }
    if (last && now - last.at < SEARCH_COOLDOWN_MS) {
        throw fail(
            `Wait ${Math.ceil((SEARCH_COOLDOWN_MS - (now - last.at)) / 1000)} seconds - AIOStreams only allows a few searches at a time`,
            429
        );
    }
    running.set(person.id, { at: now, busy: true });
    const started = Date.now();
    try {
        const access = accessFor(person, decrypt);
        const qs = new URLSearchParams({ format: "true", id: titleId, type: kind });
        const data = await call(access.base, `/api/v1/search?${qs}`, {
            auth: access.auth,
            timeoutMs: SEARCH_TIMEOUT_MS,
        });
        return { ...summarizeSearch(data), tookMs: Date.now() - started };
    } finally {
        running.set(person.id, { at: Date.now(), busy: false });
    }
}

function forgetForTests() {
    running.clear();
}

module.exports = {
    cleanId,
    forgetForTests,
    healthFor,
    SEARCH_COOLDOWN_MS,
    summarizeAnalytics,
    summarizeSearch,
    testSearch,
};
