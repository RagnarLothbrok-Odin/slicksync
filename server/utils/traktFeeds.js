const tracking = require("./traktTracking");
const { buildNuvioAppUrl } = require("./appLinks");
const { mapLimit } = require("./mapLimit");

function media(entry) {
    const show = entry?.show;
    const content = show || entry?.movie;
    const id = content?.ids?.imdb;
    if (typeof id !== "string" || !/^tt\d+$/.test(id)) {
        return null;
    }
    if (
        show &&
        (!(Number.isInteger(entry.episode?.season) && Number.isInteger(entry.episode?.number)) ||
            entry.episode.season < 0 ||
            entry.episode.number < 1)
    ) {
        return null;
    }
    return {
        episode: entry.episode?.number ?? null,
        episodeTitle: entry.episode?.title || null,
        id,
        name: content.title || "Unknown title",
        runtime: entry.episode?.runtime || content.runtime,
        season: entry.episode?.season ?? null,
        type: show ? "series" : "movie",
    };
}
async function artwork(item, episodeDetails = false) {
    try {
        const metadata = await require("./notify").fetchMetadata(
            item.id,
            item.type,
            episodeDetails && item.type === "series"
                ? `${item.id}:${item.season}:${item.episode}`
                : null
        );
        return {
            background: metadata?.background || null,
            description: metadata?.episode?.overview || metadata?.description || null,
            poster: metadata?.poster || null,
            thumbnail: metadata?.episode?.thumbnail || null,
        };
    } catch {
        return { background: null, poster: null };
    }
}
async function nowPlaying(prisma, person) {
    const result = await tracking.read(prisma, person, "watching", 15_000);
    const item = media(result.data);
    if (!item) {
        return [];
    }
    const started = Date.parse(result.data.started_at);
    const expires = Date.parse(result.data.expires_at);
    if (
        !Number.isFinite(started) ||
        started > Date.now() + 30_000 ||
        !Number.isFinite(expires) ||
        expires <= Date.now()
    ) {
        return [];
    }
    const duration =
        Number.isFinite(item.runtime) && item.runtime > 0 ? item.runtime * 60_000 : null;
    // Anchor cached timing to its observation so clients can advance it once.
    const position = duration
        ? Math.min(duration, Math.max(0, duration - (expires - Date.parse(result.checkedAt))))
        : null;
    const images = await artwork(item, true);
    return [
        {
            item: {
                ...item,
                ...images,
                description:
                    result.data.episode?.overview ||
                    result.data.movie?.overview ||
                    images.description,
            },
            lastPosition: position,
            nuvioAppUrl: buildNuvioAppUrl(item.type, item.id),
            playback: {
                evidence: "tracker",
                observedAt: result.checkedAt,
                position: "estimated",
                positionUpdatedAt: null,
                state: "playing",
            },
            source: "trakt",
            totalDuration: duration,
            user: {
                avatarUrl: person.avatarUrl || null,
                colorIndex: person.colorIndex || 0,
                email: person.email || "",
                id: person.id,
                useGravatar: person.useGravatar || false,
                username: person.username || "",
            },
            videoId: item.type === "series" ? `${item.id}:${item.season}:${item.episode}` : null,
            watchedAt: new Date(started).toISOString(),
            watchedAtTimestamp: started,
        },
    ];
}
async function continueWatching(prisma, person) {
    const [paused, upcoming] = await Promise.allSettled([
        tracking.read(prisma, person, "progress", 60_000),
        tracking.read(prisma, person, "upNext", 300_000),
    ]);
    const result = paused.status === "fulfilled" ? paused.value : { connected: false, data: [] };
    const next = upcoming.status === "fulfilled" ? upcoming.value : { connected: false, data: [] };
    if (!(result.connected || next.connected)) {
        return [];
    }
    const hidden = await prisma.dismissedContinueWatching.findMany({
        select: { showId: true },
        where: { accountId: person.accountId || "default", userId: person.id },
    });
    const hiddenIds = new Set(hidden.map((row) => row.showId));
    const entries = [
        ...(Array.isArray(result.data) ? result.data : []),
        ...(Array.isArray(next.data) ? next.data.filter((entry) => entry.resume === false) : []),
    ]
        .filter((entry) => {
            const item = media(entry);
            return (
                item &&
                !hiddenIds.has(item.id) &&
                (entry.resume === false ||
                    (Number.isFinite(entry.progress) &&
                        entry.progress > 0 &&
                        entry.progress < 100)) &&
                Number.isFinite(Date.parse(entry.paused_at))
            );
        })
        .sort((a, b) => Date.parse(b.paused_at) - Date.parse(a.paused_at));
    // A paused episode wins over a computed next episode for the same show.
    const unique = new Map();
    for (const entry of entries) {
        const id = media(entry).id;
        if (!unique.has(id) || (unique.get(id).resume === false && entry.resume !== false)) {
            unique.set(id, entry);
        }
    }
    return mapLimit(
        [...unique.values()]
            .sort((a, b) => Date.parse(b.paused_at) - Date.parse(a.paused_at))
            .slice(0, 12),
        3,
        async (entry) => {
            const item = media(entry);
            return {
                contentType: item.type,
                showId: item.id,
                showName: item.name,
                ...(await artwork(item)),
                appUrl: buildNuvioAppUrl(item.type, item.id),
                imdbRating: null,
                lastWatched:
                    item.type === "series" ? { episode: item.episode, season: item.season } : null,
                lastWatchedAt: entry.paused_at,
                metacritic: null,
                nextEpisode:
                    item.type === "series"
                        ? {
                              episode: item.episode,
                              season: item.season,
                              thumbnail: null,
                              title: item.episodeTitle,
                          }
                        : null,
                progressPercent: entry.resume === false ? null : entry.progress,
                providerType: "nuvio",
                resume: entry.resume !== false,
                rottenTomatoes: null,
                trackingService: "Trakt",
                userId: person.id,
                username: person.username || "",
            };
        }
    );
}
async function calendar(prisma, person) {
    const result = await tracking.read(prisma, person, "calendar", 300_000);
    if (!result.connected) {
        return [];
    }
    const entries = (Array.isArray(result.data) ? result.data : [])
        .filter(
            (entry) =>
                media(entry)?.type === "series" && Number.isFinite(Date.parse(entry.first_aired))
        )
        .slice(0, 100);
    const ids = [...new Set(entries.map((entry) => media(entry).id))];
    const [muted, dismissed] = await Promise.all([
        prisma.mutedShow?.findMany({
            select: { showId: true },
            where: { accountId: person.accountId || "default", showId: { in: ids } },
        }) || [],
        prisma.dismissedUpcomingEpisode?.findMany({
            select: { episode: true, season: true, showId: true },
            where: { accountId: person.accountId || "default", showId: { in: ids } },
        }) || [],
    ]);
    const mutedIds = new Set(muted.map((row) => row.showId));
    const hidden = new Set(dismissed.map((row) => `${row.showId}:${row.season}:${row.episode}`));
    const visible = entries.filter((entry) => {
        const item = media(entry);
        return !(mutedIds.has(item.id) || hidden.has(`${item.id}:${item.season}:${item.episode}`));
    });
    return mapLimit(visible, 3, async (entry) => {
        const item = media(entry);
        return {
            airDate: entry.first_aired,
            episode: item.episode,
            poster: (await artwork(item)).poster,
            season: item.season,
            showId: item.id,
            showName: item.name,
            title: item.episodeTitle,
        };
    });
}
function mergeContinue(native, tracked) {
    const items = new Map();
    for (const item of [...native, ...tracked]) {
        const id = `${item.userId}:${item.showId}`;
        const old = items.get(id);
        if (!old || Date.parse(item.lastWatchedAt) > Date.parse(old.lastWatchedAt)) {
            items.set(id, item);
        }
    }
    return [...items.values()]
        .sort((a, b) => Date.parse(b.lastWatchedAt) - Date.parse(a.lastWatchedAt))
        .slice(0, 12);
}
function mergeCalendar(native, tracked) {
    const rows = new Map();
    for (const row of [...native, ...tracked]) {
        rows.set(`${row.showId}:${row.season}:${row.episode}`, row);
    }
    return [...rows.values()].sort((a, b) => Date.parse(a.airDate) - Date.parse(b.airDate));
}
module.exports = { calendar, continueWatching, media, mergeCalendar, mergeContinue, nowPlaying };
