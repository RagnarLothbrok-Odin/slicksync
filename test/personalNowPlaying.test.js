const test = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");
const makeRouter = require("../server/routes/portalFeatures");

test("personal live playback authenticates before loading and returns only the selected profile", async () => {
    const metrics = require("../server/utils/metricsBuilder");
    const original = metrics.liveNowPlaying;
    const accounts = [];
    metrics.liveNowPlaying = async (_prisma, accountId) => {
        accounts.push(accountId);
        return [
            {
                item: {
                    episode: 3,
                    id: "tt1",
                    name: "My series",
                    poster: "poster.jpg",
                    providerToken: "secret",
                    season: 2,
                    type: "series",
                },
                lastPosition: 120,
                playback: {
                    evidence: "player",
                    observedAt: "2026-10-25T12:00:00Z",
                    position: "reported",
                    providerToken: "secret",
                    state: "paused",
                },
                streamUrl: "secret",
                totalDuration: 600,
                user: { email: "private@example.test", id: "mine" },
                watchedAt: "2026-10-25T12:00:00Z",
            },
            { item: { id: "tt2", name: "Someone else's title" }, user: { id: "other" } },
        ];
    };
    const app = express();
    app.use(
        makeRouter({
            personAsking: async (req, id) => {
                if (req.headers["x-stremio-auth"] !== "credential" || id !== "mine") {
                    throw new Error("Wrong owner");
                }
                return { accountId: "household", id: "mine" };
            },
            prisma: {},
        })
    );
    const server = await new Promise((resolve) => {
        const s = app.listen(0, "127.0.0.1", () => resolve(s));
    });
    try {
        const base = `http://127.0.0.1:${server.address().port}/now-playing`;
        assert.equal((await fetch(`${base}?userId=mine`)).status, 401);
        assert.equal(
            (await fetch(`${base}?userId=other`, { headers: { "x-stremio-auth": "credential" } }))
                .status,
            401
        );
        assert.equal(accounts.length, 0);
        const result = await fetch(`${base}?userId=mine`, {
            headers: { "x-stremio-auth": "credential" },
        });
        assert.equal(result.status, 200);
        assert.equal(result.headers.get("cache-control"), "no-store");
        const body = await result.json();
        assert.deepEqual(accounts, ["household"]);
        assert.equal(body.items.length, 1);
        assert.equal(body.items[0].item.name, "My series");
        assert.equal(body.items[0].startTime, "2026-10-25T12:00:00Z");
        assert.equal(body.items[0].lastPosition, 120);
        assert.deepEqual(body.items[0].playback, {
            evidence: "player",
            observedAt: "2026-10-25T12:00:00Z",
            position: "reported",
            positionUpdatedAt: null,
            state: "paused",
        });
        assert.equal(body.items[0].totalDuration, 600);
        assert.equal(body.items[0].user, undefined);
        assert.ok(!JSON.stringify(body).includes("secret"));
        assert.ok(!JSON.stringify(body).includes("Someone else"));
    } finally {
        metrics.liveNowPlaying = original;
        server.closeAllConnections();
        await new Promise((resolve) => server.close(resolve));
    }
});
