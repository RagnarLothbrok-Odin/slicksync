const test = require("node:test");
const assert = require("node:assert/strict");
const { createSimklFeeds, normalize } = require("../server/utils/simklFeeds");
const person = { accountId: "home", id: "mine", providerType: "nuvio" };
const show = (id) => ({ ids: { imdb: `tt${id}`, simkl: id }, title: `Show ${id}` });

test("Simkl reads watching lists once, checks activities, and reconciles moves without fetching history", async () => {
    const calls = [];
    let activity = { all: "2026-10-26T12:00:00Z", anime: {}, tv_shows: { watching: "one" } };
    let rows = [{ next_to_watch: "S01E02", show: show(123) }];
    const client = {
        withAccess: (_prisma, _person, load) =>
            load(
                async (path) => {
                    calls.push(path);
                    if (path === "/sync/activities") {
                        return activity;
                    }
                    if (path.startsWith("/sync/playback")) {
                        return [];
                    }
                    if (path.includes("/anime/")) {
                        return {};
                    }
                    if (path.includes("/shows/")) {
                        return { shows: rows };
                    }
                    throw new Error(`Unexpected request ${path}`);
                },
                "42",
                "2026-10-26T11:00:00Z"
            ),
    };
    const feeds = createSimklFeeds({ client });
    const first = await feeds.snapshot({}, person);
    assert.equal(first.lists.shows.length, 1);
    const before = calls.length;
    await feeds.snapshot({}, person);
    assert.equal(calls.length, before);
    first.until = 0;
    await feeds.snapshot({}, person);
    assert.deepEqual(calls.slice(before), ["/sync/activities", "/sync/playback?hide_watched=true"]);
    const second = await feeds.snapshot({}, person);
    second.until = 0;
    activity = { ...activity, all: "2026-10-26T12:01:00Z", tv_shows: { watching: "two" } };
    rows = [];
    const third = await feeds.snapshot({}, person);
    assert.equal(third.lists.shows.length, 0);
    assert.ok(calls.some((path) => path.includes("date_from=2026-10-26T12%3A00%3A00Z")));
    assert.ok(calls.some((path) => path.endsWith("extended=simkl_ids_only")));
    assert.ok(calls.every((path) => !path.includes("history")));
});

test("Simkl pauses remain paused and unmapped anime cannot masquerade as a television episode", () => {
    assert.equal(normalize({ anime: { ids: { mal: 1 } }, episode: { episode: 4 } }), null);
    const row = normalize({
        episode: { tvdb_number: 3, tvdb_season: 2 },
        paused_at: "2026-10-26T12:00:00Z",
        progress: 45,
        show: show(123),
    });
    assert.equal(row.episode.season, 2);
    assert.equal(row.episode.number, 3);
    assert.equal(row.progress, 45);
    assert.equal(row.started_at, undefined);
});

test("Simkl totals use the aggregate endpoint and cache explicit Home reads without downloading viewing events", async () => {
    const calls = [];
    const client = {
        withAccess: (_prisma, _person, load) =>
            load(
                async (path) => {
                    calls.push(path);
                    return {
                        anime: { completed: { watched_episodes_count: 5 } },
                        movies: { completed: { count: 2 } },
                        total_mins: 300,
                        tv: { watching: { watched_episodes_count: 10 } },
                    };
                },
                "42",
                "2026-10-26T11:00:00Z"
            ),
    };
    const feeds = createSimklFeeds({ client });
    const result = await feeds.homeStats({}, person);
    assert.equal(result.totalWatchTimeSeconds, 18_000);
    assert.equal(result.moviesCount, 2);
    assert.equal(result.episodesCount, 15);
    assert.equal(result.seriesCount, undefined);
    await feeds.homeStats({}, person);
    assert.deepEqual(calls, ["/users/42/stats"]);
});

test("Simkl readiness checks isolate calendar failures and never request expensive statistics", async () => {
    const calls = [];
    const feeds = createSimklFeeds({
        client: {
            withAccess: (_prisma, _person, load) =>
                load(
                    async (path) => {
                        calls.push(path);
                        if (path === "/sync/activities") {
                            return { all: null };
                        }
                        if (path.startsWith("/sync/playback")) {
                            return [];
                        }
                        if (path.startsWith("/sync/all-items/")) {
                            return {};
                        }
                        throw new Error("Unexpected resource");
                    },
                    "42",
                    "2026-10-26T11:00:00Z"
                ),
        },
        fetch: async () => new Response("private upstream message", { status: 503 }),
    });
    const features = await feeds.check({}, person);
    assert.equal(features.find((row) => row.key === "progress").available, true);
    assert.equal(features.find((row) => row.key === "upNext").available, true);
    assert.equal(features.find((row) => row.key === "calendar").available, false);
    assert.ok(calls.every((path) => !path.includes("/stats")));
    assert.ok(!JSON.stringify(features).includes("private upstream message"));
});
