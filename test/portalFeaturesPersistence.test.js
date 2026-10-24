const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const express = require("express");
const { PrismaClient } = require("@prisma/client");
const makeRouter = require("../server/routes/portalFeatures");

test(
    "personal tools persist independently and history previews are owner-bound and repeat-safe",
    async () => {
        const directory = fs.mkdtempSync(path.join(os.tmpdir(), "personal-tools-"));
        const databaseUrl = `file:${path.join(directory, "test.db")}`;
        fs.writeFileSync(path.join(directory, "test.db"), "");
        execFileSync(
            "node",
            [
                require.resolve("prisma/build/index.js"),
                "db",
                "push",
                "--schema",
                path.resolve(
                    require("node:path").dirname(module.filename),
                    "../prisma/schema.sqlite.prisma"
                ),
                "--skip-generate",
            ],
            { env: { ...process.env, DATABASE_URL: databaseUrl }, stdio: "pipe" }
        );
        const prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
        await prisma.appAccount.create({
            data: { id: "home", sync: JSON.stringify({ enablePosterRatings: false }) },
        });
        for (const id of ["alice", "bob"]) {
            await prisma.user.create({
                data: { accountId: "home", email: `${id}@example.test`, id, username: id },
            });
        }
        await prisma.personPushSubscription.create({
            data: {
                accountId: "home",
                auth: "secret",
                endpoint: "https://push.example.test/secret",
                id: "bob-device",
                p256dh: "secret",
                userId: "bob",
            },
        });
        await prisma.movieWatchHistory.create({
            data: {
                accountId: "home",
                completed: false,
                itemId: "tt1",
                itemName: "Original",
                userId: "alice",
                watchedAt: new Date("2025-01-01"),
            },
        });
        const app = express();
        app.use(express.json());
        app.use(
            makeRouter({
                JWT_SECRET: "disposable-test-signing-key",
                personAsking: async (req, id) => {
                    if (req.headers["x-stremio-auth"] !== `credential-${id}`) {
                        throw new Error("wrong owner");
                    }
                    return { accountId: "home", id };
                },
                prisma,
            })
        );
        const server = app.listen(0, "127.0.0.1");
        await new Promise((resolve) => server.once("listening", resolve));
        const base = `http://127.0.0.1:${server.address().port}`;
        const request = (owner, endpoint, method = "GET", body) =>
            fetch(`${base}${endpoint}${endpoint.includes("?") ? "&" : "?"}userId=${owner}`, {
                headers: {
                    "Content-Type": "application/json",
                    "x-stremio-auth": `credential-${owner}`,
                },
                method,
                ...(body ? { body: JSON.stringify(body) } : {}),
            });
        try {
            const preferences = {
                autoplayTrailer: false,
                beginnerMode: true,
                hideSensitive: true,
                posterRatings: true,
                trailerSound: false,
            };
            assert.equal(
                (await request("alice", "/preferences", "PATCH", { preferences })).status,
                200
            );
            assert.deepEqual(await (await request("alice", "/preferences")).json(), preferences);
            assert.equal(
                (await (await request("bob", "/preferences")).json()).hideSensitive,
                false
            );
            assert.equal(
                JSON.parse((await prisma.appAccount.findUnique({ where: { id: "home" } })).sync)
                    .enablePosterRatings,
                false
            );
            await prisma.appAccount.update({
                data: { sync: JSON.stringify({ enablePosterRatings: true }) },
                where: { id: "home" },
            });
            assert.equal((await (await request("bob", "/preferences")).json()).posterRatings, true);
            await request("bob", "/preferences", "PATCH", {
                preferences: { ...preferences, posterRatings: false },
            });
            assert.equal(
                (await (await request("bob", "/preferences")).json()).posterRatings,
                false
            );
            assert.equal(
                (await request("alice", "/discover/ratings", "POST", { imdbIds: ["not-an-id"] }))
                    .status,
                400
            );
            assert.equal((await request("alice", "/devices/bob-device", "DELETE")).status, 404);
            assert.equal(
                (await request("alice", "/devices/bob-device", "PATCH", { label: "Taken over" }))
                    .status,
                404
            );
            assert.equal((await (await request("alice", "/devices")).json()).devices.length, 0);
            assert.equal(
                (await request("bob", "/devices/bob-device", "PATCH", { label: "My phone" }))
                    .status,
                200
            );
            const devices = await (await request("bob", "/devices")).json();
            assert.equal(devices.devices[0].label, "My phone");
            assert.equal(devices.devices[0].endpoint, undefined);
            const choice = {
                itemType: "movie",
                name: "A movie",
                poster: null,
                reaction: "like",
                saved: true,
            };
            assert.equal(
                (await request("alice", "/discover/titles/tt10", "PUT", choice)).status,
                200
            );
            assert.equal(
                (await (await request("alice", "/discover/saved")).json()).items.length,
                1
            );
            assert.equal((await (await request("bob", "/discover/saved")).json()).items.length, 0);
            assert.equal(await prisma.watchlistItem.count(), 0);
            assert.equal(await prisma.titleReaction.count(), 0);
            const previewResponse = await request("alice", "/history/preview", "POST", {
                text: "imdbID,Title,Watched Date\ntt1,Do not replace,2025-01-01\ntt2,New movie,2025-02-01\ntt2,Duplicate,2025-02-02\ntt3,Undated,",
            });
            assert.equal(previewResponse.status, 200);
            const preview = await previewResponse.json();
            assert.equal(preview.rows.length, 1);
            assert.equal(preview.duplicates, 2);
            assert.equal(preview.skipped, 1);
            assert.equal(
                (await request("bob", "/history/import", "POST", { token: preview.token })).status,
                403
            );
            assert.equal(
                (
                    await request("alice", "/history/import", "POST", {
                        token: `${preview.token}tampered`,
                    })
                ).status,
                400
            );
            assert.equal(
                (
                    await (
                        await request("alice", "/history/import", "POST", { token: preview.token })
                    ).json()
                ).imported,
                1
            );
            assert.equal(
                (
                    await (
                        await request("alice", "/history/import", "POST", { token: preview.token })
                    ).json()
                ).imported,
                0
            );
            assert.equal(await prisma.movieWatchHistory.count({ where: { userId: "bob" } }), 0);
            const original = await prisma.movieWatchHistory.findFirst({
                where: { itemId: "tt1", userId: "alice" },
            });
            assert.equal(original.itemName, "Original");
            assert.equal(original.completed, false);
            assert.equal(await prisma.titleRating.count(), 0);
        } finally {
            server.closeAllConnections();
            await new Promise((resolve) => server.close(resolve));
            await prisma.$disconnect();
            // Keep disposable databases in the system temp directory for diagnosis.
        }
    },
    { timeout: 20_000 }
);
