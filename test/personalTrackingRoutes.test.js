const test = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");
const makeRouter = require("../server/routes/portalFeatures");

test("tracking routes authenticate and gate by provider before exposing connection state", async () => {
    const app = express();
    app.use(express.json());
    const calls = [];
    let connected = true;
    let preferences = { hideSensitive: true };
    app.use(
        makeRouter({
            personAsking: async (req, id) => {
                if (
                    req.headers["x-stremio-auth"] !== "own-credential" ||
                    !["mine", "stremio"].includes(id)
                ) {
                    throw Object.assign(new Error("Denied"), { status: 401 });
                }
                return { accountId: "home", id, providerType: id === "mine" ? "nuvio" : "stremio" };
            },
            prisma: {
                appAccount: { findUnique: async () => ({ sync: {} }) },
                trackingConnection: {
                    findUnique: async ({ where }) => {
                        calls.push(where);
                        return {
                            connectedAt: new Date(),
                            credentials: connected ? "encrypted-private-value" : null,
                            username: "my-tracker",
                        };
                    },
                },
                user: {
                    findUnique: async () => ({ portalPreferences: JSON.stringify(preferences) }),
                    update: async ({ where, data }) => {
                        assert.equal(where.id, "mine");
                        preferences = JSON.parse(data.portalPreferences);
                        return {};
                    },
                },
            },
        })
    );
    const server = await new Promise((resolve) => {
        const listening = app.listen(0, "127.0.0.1", () => resolve(listening));
    });
    const base = `http://127.0.0.1:${server.address().port}`;
    const headers = { "x-stremio-auth": "own-credential" };
    try {
        assert.equal((await fetch(`${base}/tracking-services?userId=mine`)).status, 401);
        assert.equal(
            (await fetch(`${base}/tracking-services?userId=someone-else`, { headers })).status,
            401
        );
        const unsupported = await fetch(`${base}/tracking-services?userId=stremio`, { headers });
        assert.deepEqual(await unsupported.json(), {
            services: [],
            source: "stremio",
            supported: false,
        });
        assert.equal(
            (
                await fetch(`${base}/tracking-services/trakt/authorize?userId=stremio`, {
                    headers,
                    method: "POST",
                })
            ).status,
            403
        );
        const response = await fetch(`${base}/tracking-services?userId=mine`, { headers });
        const body = await response.json();
        assert.equal(body.services[0].connected, true);
        assert.equal(body.source, "trakt");
        assert.ok(!JSON.stringify(body).includes("private-value"));
        assert.deepEqual(
            body.services.map((entry) => entry.provider),
            ["trakt", "simkl"]
        );
        assert.ok(
            calls.every(
                (call) =>
                    call.accountId_userId_provider.accountId === "home" &&
                    call.accountId_userId_provider.userId === "mine"
            )
        );
        const simklChoice = await fetch(`${base}/tracking-services/source?userId=mine`, {
            body: JSON.stringify({ provider: "simkl" }),
            headers: { ...headers, "content-type": "application/json" },
            method: "PATCH",
        });
        assert.equal(simklChoice.status, 200);
        const selectedSimkl = await fetch(`${base}/tracking-services?userId=mine`, { headers });
        assert.equal((await selectedSimkl.json()).source, "simkl");
        const choose = await fetch(`${base}/tracking-services/source?userId=mine`, {
            body: JSON.stringify({ provider: "trakt" }),
            headers: { ...headers, "content-type": "application/json" },
            method: "PATCH",
        });
        assert.equal(choose.status, 200);
        assert.equal(preferences.trackingSource, "trakt");
        assert.equal(preferences.hideSensitive, true);
        assert.equal(
            (
                await fetch(`${base}/tracking-services/source?userId=someone-else`, {
                    body: "{}",
                    headers,
                    method: "PATCH",
                })
            ).status,
            401
        );
        assert.equal(
            (
                await fetch(`${base}/tracking-services/source?userId=mine`, {
                    body: JSON.stringify({ provider: "unknown" }),
                    headers: { ...headers, "content-type": "application/json" },
                    method: "PATCH",
                })
            ).status,
            400
        );
        const display = {
            autoplayTrailer: false,
            beginnerMode: false,
            hideSensitive: false,
            posterRatings: false,
            trailerSound: false,
        };
        const saveDisplay = await fetch(`${base}/preferences?userId=mine`, {
            body: JSON.stringify({ preferences: display }),
            headers: { ...headers, "content-type": "application/json" },
            method: "PATCH",
        });
        assert.equal(saveDisplay.status, 200);
        assert.equal(preferences.trackingSource, "trakt");
        const readDisplay = await fetch(`${base}/preferences?userId=mine`, { headers });
        assert.deepEqual(await readDisplay.json(), display);
        const native = await fetch(`${base}/tracking-services/source?userId=mine`, {
            body: JSON.stringify({ provider: "nuvio" }),
            headers: { ...headers, "content-type": "application/json" },
            method: "PATCH",
        });
        assert.equal(native.status, 200);
        assert.deepEqual(await native.json(), { source: "nuvio" });
        assert.equal(preferences.trackingSource, "nuvio");
        const nativeSelection = await fetch(`${base}/tracking-services?userId=mine`, { headers });
        assert.equal((await nativeSelection.json()).source, "nuvio");
        connected = false;
        const disconnected = await fetch(`${base}/tracking-services?userId=mine`, { headers });
        const available = await disconnected.json();
        assert.equal(available.source, "nuvio");
        assert.equal(available.services.filter((service) => service.connected).length, 0);
        const rejected = await fetch(`${base}/tracking-services/source?userId=mine`, {
            body: JSON.stringify({ provider: "trakt" }),
            headers: { ...headers, "content-type": "application/json" },
            method: "PATCH",
        });
        assert.equal(rejected.status, 400);
    } finally {
        server.closeAllConnections();
        await new Promise((resolve) => server.close(resolve));
    }
});
