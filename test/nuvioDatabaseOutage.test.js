const test = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");
const jwt = require("jsonwebtoken");
const makeRouter = require("../server/routes/publicLibrary");

test("Nuvio database outages return service errors without labelling valid sessions expired", async () => {
    const secret = "fixture-session-signing-key";
    let code = "P1001";
    let reads = 0;
    const app = express();
    app.use(express.json());
    app.use(
        makeRouter({
            DEFAULT_ACCOUNT_ID: "default",
            decrypt: (value) => value,
            encrypt: (value) => value,
            JWT_SECRET: secret,
            prisma: {
                user: {
                    findUnique: async () => {
                        reads++;
                        throw Object.assign(new Error("private database address"), { code });
                    },
                },
            },
        })
    );
    const server = await new Promise((resolve) => {
        const listening = app.listen(0, "127.0.0.1", () => resolve(listening));
    });
    const base = `http://127.0.0.1:${server.address().port}`;
    const token = jwt.sign({ provider: "nuvio", sub: "mine" }, secret, { expiresIn: "1h" });
    try {
        for (const failure of ["P1001", "P2024", "P2021"]) {
            code = failure;
            const response = await fetch(`${base}/validate-nuvio`, {
                body: JSON.stringify({ userId: "mine" }),
                headers: { "content-type": "application/json", "x-stremio-auth": token },
                method: "POST",
            });
            assert.equal(response.status, failure === "P2021" ? 500 : 503);
            const payload = await response.json();
            assert.equal(payload.error, "SERVICE_UNAVAILABLE");
            assert.ok(!JSON.stringify(payload).includes("private database address"));
        }
        const before = reads;
        const denied = await fetch(`${base}/validate-nuvio`, {
            body: JSON.stringify({ userId: "mine" }),
            headers: { "content-type": "application/json", "x-stremio-auth": "invalid" },
            method: "POST",
        });
        assert.equal(denied.status, 401);
        assert.equal(reads, before);
    } finally {
        server.closeAllConnections();
        await new Promise((resolve) => server.close(resolve));
    }
});
