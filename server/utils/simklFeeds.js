const tracking = require("./simklTracking");
const { createTrackingFeeds } = require("./traktFeeds");

const STATUSES = ["watching", "plantowatch", "hold", "dropped", "completed"];
function episode(value) {
    const season = value?.tvdb_season ?? value?.season;
    const number = value?.tvdb_number ?? value?.number ?? value?.episode;
    return Number.isInteger(season) && season >= 0 && Number.isInteger(number) && number > 0
        ? { number, season, title: value.title || null }
        : null;
}
function normalize(row, next = false) {
    const content = row.show || row.movie || row.anime;
    if (!/^tt\d+$/.test(content?.ids?.imdb || "")) {
        return null;
    }
    const ep = episode(next ? row.next_to_watch_info : row.episode);
    if (!(row.movie || ep)) {
        return null;
    }
    return {
        ...(row.movie ? { movie: content } : { show: content }),
        episode: ep,
        paused_at: next ? row.last_watched_at || row.added_to_watchlist_at : row.paused_at,
        progress: row.progress,
        ...(next ? { resume: false } : {}),
    };
}
function createSimklFeeds({
    client = tracking,
    fetch: transport = (...args) => fetch(...args),
} = {}) {
    const snapshots = new Map();
    const pending = new Map();
    const calendars = new Map();
    const stats = new Map();
    const key = (person) => `${person.accountId || "default"}:${person.id}`;
    async function snapshot(prisma, person) {
        const id = key(person);
        if (pending.has(id)) {
            return pending.get(id);
        }
        const operation = client.withAccess(
            prisma,
            person,
            async (get, externalId, connectedAt) => {
                const generation = `${externalId}:${new Date(connectedAt).getTime()}`;
                const old = snapshots.get(id);
                const previous = old?.generation === generation ? old : null;
                if (previous && previous.until > Date.now()) {
                    return previous;
                }
                // Activities are captured before their anchored reads. Failed reads never
                // advance the snapshot, so the next attempt can recover the same delta.
                const activity = await get("/sync/activities");
                if (!(activity && Object.hasOwn(activity, "all"))) {
                    throw new Error("Simkl returned invalid activity timestamps.");
                }
                const lists = structuredClone(previous?.lists || { anime: [], shows: [] });
                for (const [type, domain] of [
                    ["shows", "tv_shows"],
                    ["anime", "anime"],
                ]) {
                    const changed =
                        !previous ||
                        STATUSES.some(
                            (status) =>
                                activity[domain]?.[status] !== previous.activity[domain]?.[status]
                        ) ||
                        activity[domain]?.removed_from_list !==
                            previous.activity[domain]?.removed_from_list;
                    if (!changed) {
                        continue;
                    }
                    const since = previous?.activity.all;
                    const delta = await get(
                        `/sync/all-items/${type}/watching?next_watch_info=yes${since ? `&date_from=${encodeURIComponent(since)}` : ""}`
                    );
                    const rows = delta?.[type] || [];
                    if (!Array.isArray(rows)) {
                        throw new Error("Simkl returned an invalid watchlist.");
                    }
                    const merged = new Map(
                        lists[type].map((row) => [String(row.show?.ids?.simkl), row])
                    );
                    for (const row of rows) {
                        merged.set(String(row.show?.ids?.simkl), row);
                    }
                    if (previous) {
                        // A filtered delta cannot report deletions or moves out of Watching.
                        // Reconcile inexpensive IDs only after a relevant list change.
                        const membership = await get(
                            `/sync/all-items/${type}/watching?extended=simkl_ids_only`
                        );
                        const current = new Set(
                            (membership?.[type] || []).map((row) => String(row.show?.ids?.simkl))
                        );
                        for (const itemId of merged.keys()) {
                            if (!current.has(itemId)) {
                                merged.delete(itemId);
                            }
                        }
                    }
                    lists[type] = [...merged.values()];
                }
                // Playback expiry does not bump activities, so refresh the small paused
                // list when this minute-long snapshot expires, without reading history.
                const playback = await get("/sync/playback?hide_watched=true");
                if (!Array.isArray(playback)) {
                    throw new Error("Simkl returned invalid saved playback.");
                }
                const result = {
                    activity,
                    generation,
                    lists,
                    playback,
                    until: Date.now() + 60_000,
                };
                return result;
            }
        );
        pending.set(id, operation);
        try {
            const result = await operation;
            snapshots.set(id, result);
            return result;
        } finally {
            if (pending.get(id) === operation) {
                pending.delete(id);
            }
        }
    }
    async function publicCalendar() {
        const hit = calendars.get("tv");
        if (hit && hit.until > Date.now()) {
            return hit.promise;
        }
        const url = new URL("https://data.simkl.in/calendar/v2/tv.json");
        url.searchParams.set("client_id", process.env.SIMKL_TRACKING_CLIENT_ID || "");
        url.searchParams.set("app-name", "slicksync");
        url.searchParams.set("app-version", require("../../package.json").version);
        const promise = (async () => {
            const response = await transport(url.href, {
                headers: { "user-agent": `SlickSync/${require("../../package.json").version}` },
                redirect: "error",
                signal: AbortSignal.timeout(15_000),
            });
            if (!response.ok) {
                throw new Error("Simkl’s calendar is temporarily unavailable.");
            }
            const result = await response.json();
            if (!(Array.isArray(result?.calendar) && result.metadata)) {
                throw new Error("Simkl returned an invalid calendar.");
            }
            return result;
        })();
        calendars.set("tv", { promise, until: Date.now() + 5 * 3_600_000 });
        try {
            return await promise;
        } catch (error) {
            calendars.delete("tv");
            throw error;
        }
    }
    const adapter = {
        async read(prisma, person, resource) {
            const state = await snapshot(prisma, person);
            let data;
            if (resource === "progress") {
                data = state.playback.map((row) => normalize(row)).filter(Boolean);
            } else if (resource === "upNext") {
                data = [...state.lists.shows, ...state.lists.anime]
                    .filter(
                        (row) =>
                            row.next_to_watch &&
                            Date.parse(row.next_to_watch_info?.date) <= Date.now()
                    )
                    .map((row) => normalize(row, true))
                    .filter(Boolean);
            } else if (resource === "calendar") {
                const schedule = await publicCalendar();
                const ids = new Set(state.lists.shows.map((row) => String(row.show?.ids?.simkl)));
                data = schedule.calendar
                    .filter((row) => ids.has(String(row.simkl_id)))
                    .map((row) => ({
                        episode: episode(row.episode),
                        first_aired: row.date,
                        show: schedule.metadata[row.simkl_id],
                    }));
            } else {
                throw new Error("Unsupported Simkl data source.");
            }
            return { connected: true, data };
        },
    };
    const feeds = createTrackingFeeds(adapter, "Simkl");
    // This method is called only by the Home statistics request, never playback
    // polling or readiness checks. Simkl computes these aggregates on demand.
    async function homeStats(prisma, person) {
        return client.withAccess(prisma, person, async (get, externalId, connectedAt) => {
            const id = `${key(person)}:${externalId}:${new Date(connectedAt).getTime()}`;
            const hit = stats.get(id);
            if (hit && hit.until > Date.now()) {
                return hit.promise;
            }
            const promise = get(`/users/${encodeURIComponent(externalId)}/stats`).then((result) => {
                if (
                    !(
                        Number.isFinite(result?.total_mins) &&
                        result.movies &&
                        result.tv &&
                        result.anime
                    )
                ) {
                    throw new Error("Simkl returned incomplete statistics.");
                }
                const categories = [result.tv, result.anime];
                const episodes = categories.reduce(
                    (total, category) =>
                        total +
                        STATUSES.reduce(
                            (sum, status) => sum + (category[status]?.watched_episodes_count || 0),
                            0
                        ),
                    0
                );
                return {
                    episodesCount: episodes,
                    moviesCount: result.movies.completed?.count || 0,
                    totalWatchTimeHours: result.total_mins / 60,
                    totalWatchTimeSeconds: result.total_mins * 60,
                };
            });
            stats.set(id, { promise, until: Date.now() + 5 * 60_000 });
            try {
                return await promise;
            } catch (error) {
                stats.delete(id);
                throw error;
            }
        });
    }
    async function check(prisma, person) {
        const resources = [
            { key: "progress", label: "Continue Watching" },
            { key: "upNext", label: "Next episodes" },
            { key: "calendar", label: "TV calendar" },
        ];
        return Promise.all(
            resources.map(async (resource) => {
                try {
                    await adapter.read(prisma, person, resource.key);
                    return { ...resource, available: true, error: null };
                } catch (failure) {
                    return {
                        ...resource,
                        available: false,
                        error:
                            failure.providerStatus === 403
                                ? "Not available for this account."
                                : "Could not refresh this Simkl source. Please try again.",
                    };
                }
            })
        );
    }
    return {
        calendar: feeds.calendar,
        check,
        continueWatching: feeds.continueWatching,
        homeStats,
        snapshot,
    };
}
module.exports = { ...createSimklFeeds(), createSimklFeeds, normalize };
