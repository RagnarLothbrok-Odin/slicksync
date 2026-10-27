const test = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");
const makeRouter = require("../server/routes/portalFeatures");
const tracking = require("../server/utils/traktTracking");
const feeds = require("../server/utils/traktFeeds");
const mdblist = require("../server/utils/mdblistFeeds");
const simkl = require("../server/utils/simklFeeds");
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
        simkl.continueWatching,
        simkl.calendar,
        mdblist.calendar,
        mdblist.continueWatching,
        mdblist.nowPlaying,
    ];
    let source = "trakt";
    let unavailable = false;
    const calls = [];
    const row = (name) => ({ item: { id: name }, showId: name, user: { id: "mine" } });
    const reader = (name) => async () => {
        calls.push(name);
        if (unavailable && ["trakt", "simkl", "mdblist"].includes(name)) {
            throw Object.assign(new Error("Unavailable"), { status: 503 });
        }
        return [row(name)];
    };
    tracking.source = async () => source;
    feeds.continueWatching = reader("trakt");
    feeds.nowPlaying = reader("trakt");
    feeds.calendar = reader("trakt");
    simkl.calendar = reader("simkl");
    simkl.continueWatching = reader("simkl");
    mdblist.calendar = reader("mdblist");
    mdblist.continueWatching = reader("mdblist");
    mdblist.nowPlaying = reader("mdblist");
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
        source = "mdblist";
        calls.length = 0;
        for (const endpoint of ["continue-watching", "now-playing", "upcoming-episodes"]) {
            assert.equal((await fetch(`${base}/${endpoint}`)).status, 200);
        }
        assert.deepEqual(calls, ["mdblist", "mdblist", "mdblist"]);
        source = "simkl";
        calls.length = 0;
        for (const endpoint of ["continue-watching", "now-playing", "upcoming-episodes"]) {
            assert.equal((await fetch(`${base}/${endpoint}`)).status, 200);
        }
        assert.deepEqual(calls, ["simkl", "native", "simkl"]);
        const fallbackPlayback = await fetch(`${base}/now-playing`);
        assert.equal((await fallbackPlayback.json()).trackingWarnings, undefined);
        unavailable = true;
        calls.length = 0;
        for (const endpoint of ["continue-watching", "upcoming-episodes"]) {
            assert.equal((await fetch(`${base}/${endpoint}`)).status, 503);
        }
        assert.deepEqual(calls, ["simkl", "simkl"]);
        source = "trakt";
        unavailable = true;
        calls.length = 0;
        for (const endpoint of ["continue-watching", "now-playing", "upcoming-episodes"]) {
            assert.equal((await fetch(`${base}/${endpoint}`)).status, 503);
        }
        assert.deepEqual(calls, ["trakt", "trakt", "trakt"]);
        source = "mdblist";
        calls.length = 0;
        for (const endpoint of ["continue-watching", "now-playing", "upcoming-episodes"]) {
            assert.equal((await fetch(`${base}/${endpoint}`)).status, 503);
        }
        assert.deepEqual(calls, ["mdblist", "mdblist", "mdblist"]);
    } finally {
        [
            tracking.source,
            feeds.continueWatching,
            feeds.nowPlaying,
            feeds.calendar,
            native.getContinueWatching,
            metrics.liveNowPlaying,
            calendar.getUpcomingEpisodes,
            simkl.continueWatching,
            simkl.calendar,
            mdblist.calendar,
            mdblist.continueWatching,
            mdblist.nowPlaying,
        ] = originals;
        server.closeAllConnections();
        await new Promise((resolve) => server.close(resolve));
    }
});
