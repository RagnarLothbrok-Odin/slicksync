const test = require("node:test");
const assert = require("node:assert/strict");
const { buildNowPlaying } = require("../server/utils/metricsBuilder");
const jellyfin = require("../server/utils/jellyfinLive");
const { mergeProxyNowPlaying } = require("../server/utils/proxyNowPlaying");

const user = { id: "evidence-user", providerType: "nuvio", username: "viewer" };
function database() {
    return {
        proxyStreamSession: { findMany: async () => [] },
        watchSession: {
            findMany: async () => [
                {
                    episode: 2,
                    itemId: "tt123",
                    itemName: "Example",
                    itemType: "series",
                    lastPosition: 10_000,
                    season: 1,
                    startTime: new Date(),
                    totalDuration: 600_000,
                    userId: user.id,
                    videoId: "tt123:1:2",
                },
            ],
        },
        watchStateCursor: { findMany: async () => [] },
    };
}

test("native checkpoints never claim a player state or fresh observation", async () => {
    const rows = await buildNowPlaying(database(), "evidence-account", [user]);
    assert.equal(rows.length, 1);
    assert.deepEqual(rows[0].playback, {
        evidence: "history",
        observedAt: null,
        position: "checkpoint",
        positionUpdatedAt: null,
        state: "unknown",
    });
});

test("a paused player replaces a stale native checkpoint and preserves pause and position", async () => {
    jellyfin.recordLive(user.id, [
        {
            durationMs: 600_000,
            itemId: "tt123",
            itemName: "Example",
            itemType: "series",
            paused: true,
            positionMs: 240_000,
            videoId: "tt123:1:2",
        },
    ]);
    try {
        const rows = await buildNowPlaying(database(), "evidence-account", [user]);
        assert.equal(rows.length, 1);
        assert.equal(rows[0].lastPosition, 240_000);
        assert.equal(rows[0].playback.state, "paused");
        assert.equal(rows[0].playback.evidence, "player");
        assert.equal(rows[0].playback.position, "reported");
        assert.ok(Number.isFinite(Date.parse(rows[0].playback.observedAt)));
    } finally {
        jellyfin.recordLive(user.id, []);
    }
});

test("active and recently closed proxy connections cannot displace direct pause reports", async () => {
    const report = {
        item: { id: "tt123", name: "Example", type: "movie" },
        lastPosition: 240_000,
        playback: {
            evidence: "player",
            observedAt: new Date().toISOString(),
            position: "reported",
            state: "paused",
        },
        user,
    };
    const proxy = {
        aiostreamsUser: "viewer",
        displayName: "Example",
        id: "proxy",
        lastSeenAt: new Date(),
        metadataItemId: "tt123",
        requestCount: 30,
        startTime: new Date(Date.now() - 120_000),
        updatedAt: new Date(),
    };
    for (const active of [true, false]) {
        const prisma = {
            proxyStreamSession: {
                findMany: async ({ where }) => (where.isActive === active ? [proxy] : []),
            },
        };
        const rows = await mergeProxyNowPlaying(prisma, "evidence-account", [user], [report], {
            isConfirming: () => true,
        });
        assert.equal(rows.length, 1);
        assert.equal(rows[0], report);
    }
});

test("transition events replace native checkpoints but keep another episode separate", async () => {
    const prisma = database();
    const startedAt = new Date(Date.now() - 10_000);
    prisma.watchStateCursor.findMany = async () => [
        {
            createdAt: startedAt,
            durationMs: 600_000,
            itemId: "tt123",
            itemName: "Example",
            itemType: "series",
            startAt: startedAt,
            startPositionMs: 100_000,
            userId: user.id,
            videoId: "tt123:1:2",
        },
    ];
    let rows = await buildNowPlaying(prisma, "evidence-account", [user]);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].playback.evidence, "event");
    assert.equal(rows[0].playback.position, "estimated");
    assert.equal(rows[0].playback.state, "playing");
    assert.ok(rows[0].lastPosition >= 110_000);
    prisma.watchStateCursor.findMany = async () => [
        {
            createdAt: startedAt,
            durationMs: 600_000,
            itemId: "tt123",
            itemName: "Example",
            itemType: "series",
            startAt: startedAt,
            startPositionMs: 100_000,
            userId: user.id,
            videoId: "tt123:1:3",
        },
    ];
    rows = await buildNowPlaying(prisma, "evidence-account", [user]);
    assert.equal(rows.length, 2);
    assert.deepEqual(new Set(rows.map((row) => row.videoId)), new Set(["tt123:1:2", "tt123:1:3"]));
});
