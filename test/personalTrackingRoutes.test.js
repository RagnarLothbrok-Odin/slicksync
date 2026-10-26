const test = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");
const makeRouter = require("../server/routes/portalFeatures");

test("tracking routes authenticate and gate by provider before exposing connection state", async () => {
    const app = express();
    app.use(express.json());
    const calls = [];
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
                trackingConnection: {
                    findUnique: async ({ where }) => {
                        calls.push(where);
                        return {
                            connectedAt: new Date(),
                            credentials: "encrypted-private-value",
                            username: "my-tracker",
                        };
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
        assert.deepEqual(await unsupported.json(), { services: [], supported: false });
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
        assert.ok(!JSON.stringify(body).includes("private-value"));
        assert.deepEqual(calls, [
            { accountId_userId_provider: { accountId: "home", provider: "trakt", userId: "mine" } },
        ]);
    } finally {
        server.closeAllConnections();
        await new Promise((resolve) => server.close(resolve));
    }
});
