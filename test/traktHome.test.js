const test = require("node:test");
const assert = require("node:assert/strict");
const { createHomeHistory, loadHomeHistory } = require("../server/utils/traktHome");
function movie(id, at, title = 1, runtime = 90) {
    return {
        id,
        movie: { ids: { trakt: title }, runtime, title: "Movie" },
        type: "movie",
        watched_at: at,
    };
}
test("history counts rewatches once per event and distinct titles separately", () => {
    const history = createHomeHistory("Europe/London", new Date("2026-10-26T12:00:00Z"));
    const first = movie(1, "2026-10-26T10:00:00Z");
    history.add([
        first,
        first,
        movie(2, "2026-10-25T12:00:00Z"),
        movie(3, "2026-10-24T12:00:00Z", 2),
    ]);
    const data = history.finish();
    assert.equal(data.stats.totalSessions, 3);
    assert.equal(data.stats.moviesCount, 2);
    assert.equal(data.stats.totalWatchTimeSeconds, 16_200);
    assert.equal(data.stats.currentStreak, 3);
    assert.equal(data.mostWatched.count, 2);
});
test("streaks cross month boundaries and today uses the account timezone", () => {
    const history = createHomeHistory("Europe/London", new Date("2026-04-01T12:00:00Z"));
    history.add([
        movie(1, "2026-03-31T23:30:00Z"),
        movie(2, "2026-03-31T12:00:00Z"),
        movie(3, "2026-03-30T12:00:00Z"),
    ]);
    assert.equal(history.finish().stats.currentStreak, 3);
    assert.equal(history.finish().stats.watchedTodayCount, 1);
});
test("unknown runtime and future events never inflate estimates", () => {
    const history = createHomeHistory("UTC", new Date("2026-10-26T12:00:00Z"));
    history.add([movie(1, "2026-10-26T10:00:00Z", 1, null), movie(2, "2027-01-01T00:00:00Z")]);
    assert.equal(history.finish().stats.totalSessions, 1);
    assert.equal(history.finish().stats.totalWatchTimeSeconds, 0);
    assert.match(history.finish().sourceNote, /without a runtime/);
});
test("binges count distinct episodes, while rewatches remain separate plays", () => {
    const history = createHomeHistory("UTC", new Date("2026-10-26T12:00:00Z"));
    history.add(
        [1, 2, 3, 3].map((number, index) => ({
            episode: { ids: { trakt: number }, number, runtime: 30, season: 1 },
            id: index + 1,
            show: { ids: { trakt: 10 }, title: "Show" },
            type: "episode",
            watched_at: "2026-10-26T10:00:00Z",
        }))
    );
    assert.equal(history.finish().bingeWatches[0].episodeCount, 3);
    assert.equal(history.finish().stats.seriesCount, 1);
    assert.equal(history.finish().stats.totalSessions, 4);
});

const totals = {
    episodes: { minutes: 1000, plays: 25, watched: 20 },
    movies: { minutes: 800, plays: 8, watched: 5 },
    shows: { watched: 2 },
};
test("Home uses direct stats, paginated title summaries and only date-filtered history", async () => {
    const paths = [];
    const result = await loadHomeHistory(
        async (path) => {
            paths.push(path);
            if (path === "/users/me/stats") {
                return { data: totals };
            }
            if (path.startsWith("/users/me/history?")) {
                return { data: [], pages: 9000 };
            }
            if (path.includes("/sync/history")) {
                const url = new URL(path, "https://example.test");
                assert.equal(url.searchParams.get("start_at"), "2026-10-24T23:00:00.000Z");
                assert.equal(url.searchParams.get("end_at"), "2026-10-25T12:00:00.000Z");
                return { data: [movie(1, "2026-10-25T10:00:00Z")], pages: 1 };
            }
            if (path.includes("/movies")) {
                return {
                    data: [{ movie: { ids: { trakt: 1 }, title: "Film" }, plays: 8 }],
                    pages: 1,
                };
            }
            return { data: [{ plays: 25, show: { ids: { trakt: 2 }, title: "Show" } }], pages: 1 };
        },
        "Europe/London",
        new Date("2026-10-25T12:00:00Z")
    );
    assert.equal(paths.length, 5);
    assert.equal(paths.filter((path) => path.startsWith("/users/me/history?")).length, 1);
    assert.deepEqual(result.recentHistory, []);
    assert.equal(result.stats.totalWatchTimeSeconds, 108_000);
    assert.equal(result.stats.moviesCount, 5);
    assert.equal(result.stats.totalSessions, 33);
    assert.equal(result.stats.watchedTodayCount, 1);
    assert.equal(result.mostWatched.name, "Show");
    assert.equal(result.mostWatched.count, 25);
    assert.equal(result.stats.longestStreak, undefined);
});
test("failed optional sources do not discard direct all-time stats or show partial daily figures", async () => {
    const data = await loadHomeHistory(async (path) => {
        if (path === "/users/me/stats") {
            return { data: totals };
        }
        if (path.includes("/sync/history")) {
            return { data: [], pages: 3 };
        }
        throw new Error("Unavailable");
    }, "UTC");
    assert.equal(data.todayAvailable, false);
    assert.equal(data.stats.totalSessions, 33);
    assert.equal(data.mostWatched, null);
    assert.match(data.sourceNote, /Most Watched is temporarily unavailable/);
});

test("Most Watched returns five titles ranked by plays with a stable top-item fallback", async () => {
    const data = await loadHomeHistory(async (path) => {
        if (path === "/users/me/stats") {
            return { data: totals };
        }
        if (path.includes("/sync/history")) {
            return { data: [], pages: 0 };
        }
        if (path.includes("/movies")) {
            return { data: [], pages: 0 };
        }
        return {
            data: [2, 9, 4, 7, 1, 6, 3].map((plays) => ({
                plays,
                show: { ids: { trakt: plays }, title: `Show ${plays}` },
            })),
            pages: 1,
        };
    }, "UTC");
    assert.deepEqual(
        data.mostWatchedItems.map((item) => item.count),
        [9, 7, 6, 4, 3]
    );
    assert.equal(data.mostWatched, data.mostWatchedItems[0]);
});

test("recent history loads one bounded page without affecting aggregate totals", async () => {
    const notify = require("../server/utils/notify");
    const original = notify.fetchMetadata;
    notify.fetchMetadata = async () => ({ poster: "poster.jpg" });
    const calls = [];
    try {
        const data = await loadHomeHistory(async (path) => {
            calls.push(path);
            if (path === "/users/me/stats") {
                return { data: totals };
            }
            if (path.startsWith("/users/me/history?")) {
                assert.equal(new URL(path, "https://example.test").searchParams.get("limit"), "50");
                return {
                    data: Array.from({ length: 5 }, (_, index) => ({
                        ...movie(index + 1, "2020-01-01T10:00:00Z"),
                        movie: { ids: { imdb: `tt${100 + index}` }, title: "Old film" },
                    })),
                    pages: 9000,
                };
            }
            return { data: [], pages: 0 };
        }, "UTC");
        assert.equal(data.recentHistory.length, 5);
        assert.equal(data.recentHistory[0].poster, "poster.jpg");
        assert.equal(data.stats.totalWatchTimeSeconds, 108_000);
        assert.equal(data.stats.watchedTodayCount, 0);
        assert.equal(calls.filter((path) => path.startsWith("/users/me/history?")).length, 1);
    } finally {
        notify.fetchMetadata = original;
    }
});
