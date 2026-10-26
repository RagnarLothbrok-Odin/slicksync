const { getAccountDateString, dayBoundsInTimezone } = require("./dateUtils");

// Reduce pages as they arrive so large histories do not retain full API responses.
function createHomeHistory(timeZone, now = new Date()) {
    const days = new Map();
    const titles = new Map();
    const binges = new Map();
    const seen = new Set();
    let missingRuntime = false;
    let plays = 0;
    let seconds = 0;
    const today = getAccountDateString(now, timeZone);
    const calendarIndex = (date) =>
        Math.floor(Date.parse(`${getAccountDateString(date, timeZone)}T00:00:00Z`) / 86_400_000);
    const todayNumber = calendarIndex(now);
    function add(entries) {
        for (const entry of entries) {
            const content = entry.type === "episode" ? entry.show : entry.movie;
            const id = content?.ids?.trakt;
            const watched = new Date(entry.watched_at);
            if (
                !(id && entry.id && Number.isFinite(watched.getTime())) ||
                watched > now ||
                seen.has(String(entry.id))
            ) {
                continue;
            }
            seen.add(String(entry.id));
            const type = entry.type === "episode" ? "series" : "movie";
            const key = `${type}:${id}`;
            const day = getAccountDateString(watched, timeZone);
            const runtime = entry.type === "episode" ? entry.episode?.runtime : content.runtime;
            const duration = Number.isFinite(runtime) && runtime > 0 ? runtime * 60 : 0;
            missingRuntime ||= !duration;
            plays++;
            seconds += duration;
            const bucket = days.get(day) || {
                date: day,
                dayNumber: calendarIndex(watched),
                movies: 0,
                seconds: 0,
                series: 0,
                total: 0,
            };
            bucket[type === "movie" ? "movies" : "series"]++;
            bucket.seconds += duration;
            bucket.total++;
            days.set(day, bucket);
            const title = titles.get(key) || {
                count: 0,
                id: content.ids.imdb || `trakt:${id}`,
                name: content.title || "Unknown title",
                totalDuration: 0,
                type,
            };
            title.count++;
            title.totalDuration += duration;
            titles.set(key, title);
            if (type === "series") {
                const bingeKey = `${day}:${id}`;
                const binge = binges.get(bingeKey) || {
                    date: day,
                    episodeCount: 0,
                    episodes: new Set(),
                    id: title.id,
                    name: title.name,
                    totalDuration: 0,
                    type: "series",
                };
                binge.episodes.add(
                    entry.episode?.ids?.trakt || `${entry.episode?.season}:${entry.episode?.number}`
                );
                binge.episodeCount = binge.episodes.size;
                binge.totalDuration += duration;
                binges.set(bingeKey, binge);
            }
        }
    }
    function finish() {
        const orderedDays = [...days.values()].sort((a, b) => a.dayNumber - b.dayNumber);
        let longestStreak = 0;
        let run = 0;
        let previous = Number.NEGATIVE_INFINITY;
        for (const day of orderedDays) {
            run = day.dayNumber === previous + 1 ? run + 1 : 1;
            longestStreak = Math.max(longestStreak, run);
            previous = day.dayNumber;
        }
        const dayNumbers = new Set(orderedDays.map((day) => day.dayNumber));
        let cursor = dayNumbers.has(todayNumber) ? todayNumber : todayNumber - 1;
        let currentStreak = 0;
        while (dayNumbers.has(cursor--)) {
            currentStreak++;
        }
        const todayData = days.get(today);
        const allTitles = [...titles.values()];
        return {
            bingeWatches: [...binges.values()]
                .filter((binge) => binge.episodeCount >= 3)
                .sort((a, b) => b.date.localeCompare(a.date))
                .slice(0, 5)
                .map(({ episodes, ...binge }) => binge),
            episodeHistory: [],
            mostWatched:
                allTitles.sort(
                    (a, b) => b.count - a.count || b.totalDuration - a.totalDuration
                )[0] || null,
            nowPlaying: [],
            sessions: [],
            source: "trakt",
            sourceNote: `From Trakt watch history. Watch times are runtime estimates${missingRuntime ? "; titles without a runtime are excluded from time totals" : ""}. Days use ${timeZone}.`,
            stats: {
                avgWatchTimeHours: plays ? seconds / plays / 3600 : 0,
                avgWatchTimeSeconds: plays ? seconds / plays : 0,
                currentStreak,
                longestStreak,
                moviesCount: allTitles.filter((title) => title.type === "movie").length,
                recentItemsCount: plays,
                seriesCount: allTitles.filter((title) => title.type === "series").length,
                totalSessions: plays,
                totalWatchTimeHours: seconds / 3600,
                totalWatchTimeSeconds: seconds,
                watchedTodayCount: todayData?.total || 0,
                watchTimeTodayHours: (todayData?.seconds || 0) / 3600,
                watchTimeTodaySeconds: todayData?.seconds || 0,
            },
            watchTimeByDay: orderedDays
                .slice(-30)
                .map(({ dayNumber, seconds: duration, ...day }) => ({
                    ...day,
                    hours: duration / 3600,
                    minutes: duration / 60,
                })),
        };
    }
    return { add, finish };
}

// Aggregate endpoints own all-time numbers. Only today's events are read;
// lifetime history is never enumerated to render Home.
async function loadHomeHistory(get, timeZone, now = new Date()) {
    const day = getAccountDateString(now, timeZone);
    const { start } = dayBoundsInTimezone(now, timeZone);
    const params = new URLSearchParams({
        end_at: now.toISOString(),
        extended: "full",
        limit: "250",
        start_at: start.toISOString(),
    });
    async function summary(path) {
        const rows = [];
        const separator = path.includes("?") ? "&" : "?";
        const first = await get(`${path}${separator}page=1&limit=250`);
        if (!(Array.isArray(first.data) && Number.isInteger(first.pages)) || first.pages > 40) {
            throw new Error("Trakt title summaries are unavailable.");
        }
        rows.push(...first.data);
        for (let page = 2; page <= first.pages; page++) {
            const result = await get(`${path}${separator}page=${page}&limit=250`);
            if (!Array.isArray(result.data) || result.pages !== first.pages) {
                throw new Error("Trakt title summaries changed while loading.");
            }
            rows.push(...result.data);
        }
        return rows;
    }
    const [totalsResult, todayResult, titlesResult] = await Promise.allSettled([
        get("/users/me/stats"),
        get(`/sync/history?${params}&page=1`),
        Promise.all([
            summary("/sync/watched/movies"),
            summary("/sync/watched/shows?extended=noseasons"),
        ]),
    ]);
    if (totalsResult.status !== "fulfilled") {
        throw totalsResult.reason;
    }
    const totals = totalsResult.value.data;
    for (const value of [
        totals?.movies?.watched,
        totals?.shows?.watched,
        totals?.episodes?.watched,
        totals?.movies?.minutes,
        totals?.episodes?.minutes,
        totals?.movies?.plays,
        totals?.episodes?.plays,
    ]) {
        if (!Number.isFinite(value) || value < 0) {
            throw new Error("Invalid Trakt statistics response.");
        }
    }
    const history = createHomeHistory(timeZone, now);
    let todayAvailable =
        todayResult.status === "fulfilled" &&
        Array.isArray(todayResult.value.data) &&
        Number.isInteger(todayResult.value.pages) &&
        todayResult.value.pages <= 2;
    if (todayAvailable) {
        history.add(todayResult.value.data);
        if (todayResult.value.pages === 2) {
            try {
                const second = await get(`/sync/history?${params}&page=2`);
                if (!Array.isArray(second.data) || second.pages !== 2) {
                    todayAvailable = false;
                } else {
                    history.add(second.data);
                }
            } catch {
                todayAvailable = false;
            }
        }
    }
    const data = history.finish();
    const seconds = (totals.movies.minutes + totals.episodes.minutes) * 60;
    const plays = totals.movies.plays + totals.episodes.plays;
    Object.assign(data.stats, {
        avgWatchTimeHours: plays ? seconds / plays / 3600 : 0,
        avgWatchTimeSeconds: plays ? seconds / plays : 0,
        episodesCount: totals.episodes.watched,
        episodesTodayCount: data.watchTimeByDay.find((bucket) => bucket.date === day)?.series || 0,
        moviesCount: totals.movies.watched,
        seriesCount: totals.shows.watched,
        totalSessions: plays,
        totalWatchTimeHours: seconds / 3600,
        totalWatchTimeSeconds: seconds,
    });
    delete data.stats.currentStreak;
    delete data.stats.longestStreak;
    data.todayAvailable = todayAvailable;
    data.bingeWatches = [];
    data.mostWatched = null;
    data.mostWatchedItems = [];
    if (titlesResult.status === "fulfilled") {
        const [movies, shows] = titlesResult.value;
        for (const entry of [...movies, ...shows]) {
            const content = entry.movie || entry.show;
            if (!(content?.title && Number.isFinite(entry.plays)) || entry.plays <= 0) {
                continue;
            }
            data.mostWatchedItems.push({
                count: entry.plays,
                id: content.ids?.imdb || `trakt:${content.ids?.trakt}`,
                name: content.title,
                totalDuration: 0,
                type: entry.movie ? "movie" : "series",
            });
        }
    }
    data.mostWatchedItems.sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
    data.mostWatchedItems = data.mostWatchedItems.slice(0, 5);
    data.mostWatched = data.mostWatchedItems[0] || null;
    data.sourceNote = `From Trakt statistics and title play counts. Watch times use runtimes. Days use ${timeZone}.${todayAvailable ? "" : " Today’s activity is temporarily unavailable."}${titlesResult.status === "fulfilled" ? "" : " Most Watched is temporarily unavailable."}`;
    return enrichArtwork(data);
}

async function enrichArtwork(data) {
    const items = [...(data.mostWatchedItems || [data.mostWatched]), ...data.bingeWatches].filter(
        Boolean
    );
    await Promise.all(
        items.map(async (item) => {
            if (!item.id?.startsWith("tt")) {
                return;
            }
            let timer;
            try {
                // Artwork is optional and must not hold the statistics response open.
                const metadata = await Promise.race([
                    require("./notify").fetchMetadata(item.id, item.type || "series"),
                    new Promise((resolve) => {
                        timer = setTimeout(() => resolve(null), 2000);
                    }),
                ]);
                if (metadata?.poster) {
                    item.poster = metadata.poster;
                }
            } catch {
                // A missing poster must not hide otherwise valid viewing statistics.
            } finally {
                clearTimeout(timer);
            }
        })
    );
    return data;
}
module.exports = { createHomeHistory, loadHomeHistory };
