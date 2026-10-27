const tracking = require("./mdblistTracking");
const { createTrackingFeeds, media } = require("./traktFeeds");
const { buildNuvioAppUrl } = require("./appLinks");
const { mapLimit } = require("./mapLimit");

function image(value) {
    if (typeof value !== "string" || !value) {
        return null;
    }
    if (value.startsWith("/") && !value.startsWith("//")) {
        return `https://image.tmdb.org/t/p/w780${value}`;
    }
    try {
        return new URL(value).protocol === "https:" ? value : null;
    } catch {
        return null;
    }
}
function normalize(row, { next = false } = {}) {
    const content = row.show || row.movie;
    if (!/^tt\d+$/.test(content?.ids?.imdb || "")) {
        return null;
    }
    const episode = next ? row.next_episode : row.episode;
    const season = episode?.season ?? content?.season?.number;
    const number = episode?.number ?? episode?.episode ?? content?.season?.episode?.number;
    if (
        !(
            row.movie ||
            (Number.isInteger(season) && season >= 0 && Number.isInteger(number) && number > 0)
        )
    ) {
        return null;
    }
    const images = {
        fanart: [image(content.backdrop || content.background)].filter(Boolean),
        poster: [image(content.poster)].filter(Boolean),
    };
    return {
        ...(row.movie
            ? { movie: { ...content, images, runtime: row.runtime } }
            : { show: { ...content, images, runtime: row.runtime } }),
        episode: row.movie
            ? null
            : {
                  images: { screenshot: [image(episode?.still)].filter(Boolean) },
                  number,
                  runtime: row.runtime || episode?.runtime,
                  season,
                  title: episode?.title || episode?.name || null,
              },
        paused_at: next ? row.last_watched_at : row.paused_at || row.updated_at,
        progress:
            typeof row.progress === "number"
                ? row.progress
                : typeof row.progress === "string" && /^\d+(?:\.\d+)?$/.test(row.progress)
                  ? Number(row.progress)
                  : null,
        ...(next ? { resume: false } : {}),
    };
}
function createMdblistFeeds({ client = tracking } = {}) {
    const cache = new Map();
    async function cached(prisma, person, resource, ttl, load) {
        return client.withAccess(prisma, person, async (get, externalId, connectedAt) => {
            const key = `${person.accountId || "default"}:${person.id}:${externalId}:${new Date(connectedAt).getTime()}:${resource}`;
            const hit = cache.get(key);
            if (hit && hit.until > Date.now()) {
                return hit.promise;
            }
            const promise = load(get).then((data) => ({
                checkedAt: new Date().toISOString(),
                connected: true,
                data,
            }));
            cache.set(key, { promise, until: Date.now() + ttl });
            try {
                return await promise;
            } catch (error) {
                if (cache.get(key)?.promise === promise) {
                    cache.delete(key);
                }
                throw error;
            }
        });
    }
    async function mappedContent(get, content, type) {
        if (!content || /^tt\d+$/.test(content.ids?.imdb || "")) {
            return content;
        }
        const id = content.ids?.tmdb;
        if (!Number.isSafeInteger(id) || id < 1) {
            return content;
        }
        // Calendar entries have TMDb IDs only. Cache the public identity lookup
        // across episodes instead of repeating it for each airing or poll.
        const key = `identity:${type}:${id}`;
        let hit = cache.get(key);
        if (!hit || hit.until <= Date.now()) {
            const promise = get(`/tmdb/${type}/${id}/`).then((result) => result?.imdb_id || null);
            hit = { promise, until: Date.now() + 24 * 3_600_000 };
            cache.set(key, hit);
        }
        try {
            const imdb = await hit.promise;
            return { ...content, ids: { ...content.ids, imdb } };
        } catch (error) {
            cache.delete(key);
            throw error;
        }
    }
    async function pages(get, path) {
        const rows = [];
        for (let offset = 0; offset < 10_000; offset += 100) {
            const result = await get(`${path}&limit=100&offset=${offset}`);
            if (!Array.isArray(result?.items) || typeof result.has_more !== "boolean") {
                throw new Error("MDBList returned an invalid episode summary.");
            }
            rows.push(...result.items);
            if (!result.has_more) {
                return rows;
            }
            if (result.items.length === 0) {
                throw new Error("MDBList episode pagination did not advance.");
            }
        }
        throw new Error("The MDBList episode list exceeds the supported summary limit.");
    }
    const adapter = {
        async read(prisma, person, resource) {
            const ttl =
                resource === "watching" ? 60_000 : resource === "calendar" ? 3_600_000 : 5 * 60_000;
            return cached(prisma, person, resource, ttl, async (get) => {
                if (resource === "watching" || resource === "progress") {
                    const result = await get(
                        resource === "watching" ? "/sync/now-playing" : "/sync/playback"
                    );
                    if (!Array.isArray(result)) {
                        throw new Error("MDBList returned invalid playback data.");
                    }
                    return result;
                }
                if (resource === "upNext") {
                    const rows = await pages(
                        get,
                        "/upnext?hide_unreleased=true&air_date_format=instant"
                    );
                    return rows
                        .filter((row) => {
                            const date = row.next_episode?.air_date;
                            return (
                                typeof date === "string" &&
                                /^\d{4}-\d{2}-\d{2}/.test(date) &&
                                Date.parse(date) <= Date.now()
                            );
                        })
                        .map((row) => normalize(row, { next: true }))
                        .filter(Boolean);
                }
                if (resource === "calendar") {
                    const start = new Date().toISOString().slice(0, 10);
                    const end = new Date(Date.now() + 33 * 86_400_000).toISOString().slice(0, 10);
                    const result = await get(
                        `/calendar/events?start=${start}&end=${end}&limit=1000`
                    );
                    if (!Array.isArray(result?.events)) {
                        throw new Error("MDBList returned an invalid calendar.");
                    }
                    if (result.events.length >= 1000) {
                        throw new Error(
                            "MDBList’s calendar response reached its event limit. Narrow the calendar settings in MDBList."
                        );
                    }
                    const episodes = result.events.filter(
                        (row) =>
                            row.type === "episode" && /^\d{4}-\d{2}-\d{2}$/.test(row.start || "")
                    );
                    return mapLimit(episodes, 3, async (row) => ({
                        episode: {
                            number: row.episode_number,
                            season: row.season_number,
                            title: row.episode_title,
                        },
                        first_aired: row.start,
                        show: await mappedContent(
                            get,
                            { ids: { tmdb: row.show_tmdb }, title: row.title },
                            "show"
                        ),
                    }));
                }
                if (resource === "statistics") {
                    return get("/user/stats");
                }
                throw new Error("Unsupported MDBList resource.");
            });
        },
    };
    const shared = createTrackingFeeds(
        {
            read: async (prisma, person, resource) => {
                const result = await adapter.read(prisma, person, resource);
                if (resource !== "progress") {
                    return result;
                }
                return client.withAccess(prisma, person, async (get) => ({
                    ...result,
                    data: (
                        await mapLimit(result.data, 3, async (row) => {
                            const mapped = await mappedContent(
                                get,
                                row.show || row.movie,
                                row.movie ? "movie" : "show"
                            );
                            return normalize({
                                ...row,
                                ...(row.movie ? { movie: mapped } : { show: mapped }),
                            });
                        })
                    ).filter(Boolean),
                }));
            },
        },
        "MDBList"
    );
    async function nowPlaying(prisma, person) {
        const result = await adapter.read(prisma, person, "watching");
        return client.withAccess(prisma, person, async (get) => {
            const rows = await mapLimit(result.data, 3, async (row) => {
                if (row.paused_at) {
                    return null;
                }
                const content = row.show || row.movie;
                const mapped = await mappedContent(get, content, row.movie ? "movie" : "show");
                const entry = normalize({
                    ...row,
                    ...(row.movie ? { movie: mapped } : { show: mapped }),
                });
                const item = media(entry);
                const updated = Date.parse(row.updated_at);
                const observed = Date.parse(result.checkedAt);
                const expires = row.expires_at ? Date.parse(row.expires_at) : null;
                const rawProgress = row.progress_at_update ?? row.progress;
                const progress =
                    typeof rawProgress === "number"
                        ? rawProgress
                        : typeof rawProgress === "string" && /^\d+(?:\.\d+)?$/.test(rawProgress)
                          ? Number(rawProgress)
                          : null;
                if (
                    !(item && Number.isFinite(updated)) ||
                    updated > Date.now() + 30_000 ||
                    (expires !== null && (!Number.isFinite(expires) || expires <= Date.now())) ||
                    !Number.isFinite(progress) ||
                    progress < 0 ||
                    progress >= 100
                ) {
                    return null;
                }
                const duration =
                    Number.isFinite(row.runtime) && row.runtime > 0 ? row.runtime * 60_000 : null;
                const position = duration
                    ? Math.min(
                          duration,
                          (duration * progress) / 100 + Math.max(0, observed - updated)
                      )
                    : null;
                if (duration && position >= duration) {
                    return null;
                }
                const metadata = await require("./notify")
                    .fetchMetadata(
                        item.id,
                        item.type,
                        item.type === "series" ? `${item.id}:${item.season}:${item.episode}` : null
                    )
                    .catch(() => null);
                return {
                    item: {
                        ...item,
                        background: metadata?.background || null,
                        description: metadata?.episode?.overview || metadata?.description || null,
                        poster: metadata?.poster || null,
                        thumbnail: metadata?.episode?.thumbnail || null,
                    },
                    lastPosition: position,
                    nuvioAppUrl: buildNuvioAppUrl(item.type, item.id),
                    playback: {
                        evidence: "tracker",
                        observedAt: result.checkedAt,
                        position: "estimated",
                        positionUpdatedAt: row.updated_at,
                        provider: "mdblist",
                        state: "playing",
                    },
                    source: "mdblist",
                    totalDuration: duration,
                    user: {
                        avatarUrl: person.avatarUrl || null,
                        colorIndex: person.colorIndex || 0,
                        id: person.id,
                        username: person.username || "",
                    },
                    videoId:
                        item.type === "series" ? `${item.id}:${item.season}:${item.episode}` : null,
                    watchedAt: row.updated_at,
                    watchedAtTimestamp: updated,
                };
            });
            return rows.filter(Boolean);
        });
    }
    async function homeStats(prisma, person) {
        const result = await adapter.read(prisma, person, "statistics");
        return require("./mdblistHome").mapMdblistStats(result.data);
    }
    return {
        calendar: shared.calendar,
        continueWatching: shared.continueWatching,
        homeStats,
        nowPlaying,
        read: adapter.read,
    };
}
module.exports = { ...createMdblistFeeds(), createMdblistFeeds, normalize };
