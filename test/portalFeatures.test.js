const test = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");
const { previewHistory } = require("../server/utils/portalHistory");
const makeRouter = require("../server/routes/portalFeatures");

test("history preview excludes duplicates, undated watchlists and episode rows", () => {
    const csv =
        "imdbID,Title,Watched Date\ntt1,First,2025-01-01\ntt1,Again,2025-01-02\ntt2,Existing,2025-01-01\ntt3,Watchlist,\ntt4,Valid,2025-02-01";
    const result = previewHistory(csv, ["tt2"]);
    assert.deepEqual(
        result.rows.map((row) => row.itemId),
        ["tt1", "tt4"]
    );
    assert.equal(result.duplicates, 2);
    assert.equal(result.skipped, 1);
});
test("ratings-only exports cannot create watched history", () => {
    const result = previewHistory("imdbID,Title,Rating\ntt1,A movie,8");
    assert.equal(result.rows.length, 0);
});
test("personal endpoints require ownership and scope writes, never return push secrets", async () => {
    const calls = [];
    const prisma = {
        personPushSubscription: {
            deleteMany: async (args) => {
                calls.push(args);
                return { count: 0 };
            },
            findMany: async (args) => {
                calls.push(args);
                return [];
            },
            updateMany: async (args) => {
                calls.push(args);
                return { count: 0 };
            },
        },
        user: {
            findUnique: async () => ({ portalPreferences: null }),
            update: async (args) => calls.push(args),
        },
    };
    const app = express();
    app.use(express.json());
    app.use(
        makeRouter({
            personAsking: async (req, id) => {
                if (req.headers["x-stremio-auth"] !== "own" || id !== "me") {
                    throw new Error("wrong person");
                }
                return { accountId: "house", id: "me" };
            },
            prisma,
        })
    );
    const server = app.listen(0, "127.0.0.1");
    await new Promise((resolve) => server.once("listening", resolve));
    const base = `http://127.0.0.1:${server.address().port}`;
    const request = (path, options = {}) =>
        fetch(base + path, {
            ...options,
            headers: { "Content-Type": "application/json", "x-stremio-auth": "own" },
        });
    try {
        assert.equal((await request("/devices?userId=someone-else")).status, 401);
        assert.equal((await request("/devices?userId=me")).status, 200);
        assert.equal(calls[0].where.userId, "me");
        assert.equal(calls[0].select.endpoint, undefined);
        assert.equal(calls[0].select.auth, undefined);
        assert.equal(
            (await request("/devices/theirs?userId=me", { method: "DELETE" })).status,
            404
        );
        assert.deepEqual(calls[1].where, { accountId: "house", id: "theirs", userId: "me" });
        assert.equal(
            (
                await request("/preferences?userId=me", {
                    body: JSON.stringify({ preferences: { safe: false } }),
                    method: "PATCH",
                })
            ).status,
            400
        );
        assert.equal(
            (await request("/discover/react?userId=me", { body: "{}", method: "POST" })).status,
            404
        );
    } finally {
        server.closeAllConnections();
        await new Promise((resolve) => server.close(resolve));
    }
});
