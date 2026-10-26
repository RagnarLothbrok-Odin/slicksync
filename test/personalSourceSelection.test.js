const test = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");
const makeRouter = require("../server/routes/portalFeatures");
const tracking = require("../server/utils/traktTracking");
const feeds = require("../server/utils/traktFeeds");
const native = require("../server/utils/continueWatching");
const metrics = require("../server/utils/metricsBuilder");
const calendar = require("../server/utils/episodeAlerts");

test("personal feeds use one selected source and never substitute native data during a tracker failure", async () => {
    const originals = [
        tracking.source,
        feeds.continueWatching,
        feeds.nowPlaying,
        feeds.calendar,
        native.getContinueWatching,
        metrics.liveNowPlaying,
        calendar.getUpcomingEpisodes,
    ];
    let source = "trakt";
    let unavailable = false;
    const calls = [];
    const row = (name) => ({ item: { id: name }, showId: name, user: { id: "mine" } });
    const reader = (name) => async () => {
        calls.push(name);
        if (unavailable && name === "trakt") {
            throw Object.assign(new Error("Unavailable"), { status: 503 });
        }
        return [row(name)];
    };
    tracking.source = async () => source;
    feeds.continueWatching = reader("trakt");
    feeds.nowPlaying = reader("trakt");
    feeds.calendar = reader("trakt");
    native.getContinueWatching = reader("native");
    metrics.liveNowPlaying = reader("native");
    calendar.getUpcomingEpisodes = reader("native");
    const app = express();
    app.use(
        makeRouter({
            personAsking: async () => ({ accountId: "home", id: "mine", providerType: "nuvio" }),
            prisma: {},
        })
    );
    const server = await new Promise((resolve) => {
        const listening = app.listen(0, "127.0.0.1", () => resolve(listening));
    });
    try {
        const base = `http://127.0.0.1:${server.address().port}`;
        for (const selected of ["trakt", "nuvio"]) {
            source = selected;
            calls.length = 0;
            for (const endpoint of ["continue-watching", "now-playing", "upcoming-episodes"]) {
                const response = await fetch(`${base}/${endpoint}`);
                assert.equal(response.status, 200);
                const body = await response.json();
                const items = Array.isArray(body) ? body : body.items;
                assert.equal(items.length, 1);
                assert.equal(
                    items[0].showId || items[0].item.id,
                    selected === "trakt" ? "trakt" : "native"
                );
            }
            assert.deepEqual(calls, new Array(3).fill(selected === "trakt" ? "trakt" : "native"));
        }
        source = "trakt";
        unavailable = true;
        calls.length = 0;
        for (const endpoint of ["continue-watching", "now-playing", "upcoming-episodes"]) {
            assert.equal((await fetch(`${base}/${endpoint}`)).status, 503);
        }
        assert.deepEqual(calls, ["trakt", "trakt", "trakt"]);
    } finally {
        [
            tracking.source,
            feeds.continueWatching,
            feeds.nowPlaying,
            feeds.calendar,
            native.getContinueWatching,
            metrics.liveNowPlaying,
            calendar.getUpcomingEpisodes,
        ] = originals;
        server.closeAllConnections();
        await new Promise((resolve) => server.close(resolve));
    }
});
