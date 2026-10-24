// AIOStreams health on a person's page (server/utils/aioHealth.js). Shapes
// follow AIOStreams 2.35's own routes, read from a running instance - its
// rates come as percentages (a real run answered errorRate: 50 for one
// failure in two).
const test = require("node:test");
const assert = require("node:assert/strict");
const aio = require("../server/utils/aioHealth");

const person = (extra = {}) => ({
    accountId: "acc",
    aioConfigId: "cfg-uuid",
    aioConfigPassword: "enc",
    id: "p1",
    jellyfinServerKind: "aiostreams",
    jellyfinServerUrl: "https://aio.example.com/jellyfin/u/family",
    providerType: "jellyfin",
    username: "Sam",
    ...extra,
});
const prismaFor = (p) => ({
    episodeWatchHistory: {
        findMany: async () => [
            {
                episode: 2,
                season: 1,
                showId: "tt0903747",
                showName: "Breaking Bad",
                videoId: "tt0903747:1:2",
            },
        ],
    },
    movieWatchHistory: { findMany: async () => [{ itemId: "tt0133093", itemName: "The Matrix" }] },
    user: { findFirst: async () => p },
});
const decrypt = () => "secret";

function fakeAio(routes) {
    const calls = [];
    const original = global.fetch;
    global.fetch = async (url, opts = {}) => {
        const u = new URL(url);
        calls.push({ auth: opts.headers?.Authorization || null, path: u.pathname + u.search });
        const key = Object.keys(routes).find((k) => (u.pathname + u.search).startsWith(k));
        const [status, data] = key ? routes[key](u) : [404, null];
        return {
            json: async () =>
                status < 400
                    ? { data, success: true }
                    : { error: { message: data }, success: false },
            ok: status < 400,
            status,
        };
    };
    return {
        calls,
        restore: () => {
            global.fetch = original;
        },
    };
}

const status = (userAnalyticsEnabled) => () => [
    200,
    { settings: { analyticsEnabled: true, searchApiDisabled: false, userAnalyticsEnabled } },
];

test("analytics off on the instance: says so, and never asks for them", async () => {
    const s = fakeAio({
        "/api/v1/status": status(false),
        "/api/v1/user/client-agents": () => [200, []],
    });
    try {
        const h = await aio.healthFor(prismaFor(person()), decrypt, "acc", "p1");
        assert.equal(h.canRead, true);
        assert.equal(h.analyticsEnabled, false);
        assert.equal(
            s.calls.some((c) => c.path.startsWith("/api/v1/user/analytics")),
            false
        );
        assert.equal(s.calls[0].path, "/api/v1/status", "the instance, not the /jellyfin address");
        assert.deepEqual(
            h.recent.map((r) => r.id),
            ["tt0133093", "tt0903747:1:2"]
        );
    } finally {
        s.restore();
    }
});

test("analytics on: AIOStreams' own flags, worst addon first, its basic auth", async () => {
    const s = fakeAio({
        "/api/v1/status": status(true),
        "/api/v1/user/analytics": (u) => [
            200,
            {
                perAddon: [
                    {
                        addonName: "Good",
                        avgLatencyMs: 900,
                        emptyRate: 5,
                        errorRate: 0,
                        finalShare: 70,
                        presetType: "torrentio",
                        redundant: false,
                        requests: 40,
                        slow: false,
                    },
                    {
                        addonName: "Flaky",
                        avgLatencyMs: 4100,
                        emptyRate: 10,
                        errorRate: 45,
                        finalShare: 10,
                        presetType: "custom",
                        redundant: false,
                        requests: 40,
                        slow: true,
                    },
                    {
                        addonName: "Echo",
                        avgLatencyMs: 1200,
                        emptyRate: 0,
                        errorRate: 0,
                        finalShare: 0.5,
                        presetType: "comet",
                        redundant: true,
                        requests: 40,
                        slow: false,
                    },
                ],
                perService: [{ cachedShare: 90, finalCount: 30, serviceId: "realdebrid" }],
                range: u.searchParams.get("range"),
                totals: { errorRate: 10, requests: 40 },
            },
        ],
        "/api/v1/user/client-agents": () => [
            200,
            [
                {
                    lastSeen: 1_791_178_970_745,
                    requests: 2,
                    userAgent: "Bun/1.4.2 SlickSync/1.91.0 (SlickSync)",
                },
                { lastSeen: 1_791_178_500_000, requests: 5, userAgent: "Bun/1.4.2" },
                { lastSeen: 1_791_178_000_000, requests: 40, userAgent: "Infuse/8.0" },
            ],
        ],
    });
    try {
        const h = await aio.healthFor(prismaFor(person()), decrypt, "acc", "p1", { range: "7d" });
        assert.equal(h.analytics.range, "7d");
        assert.deepEqual(
            h.analytics.addons.map((a) => a.name),
            ["Flaky", "Echo", "Good"]
        );
        assert.equal(h.analytics.addons[0].errorRate, 45);
        assert.equal(h.analytics.addons[0].slow, true);
        assert.equal(h.analytics.addons[1].redundant, true);
        assert.equal(h.analytics.errorRate, 10);
        assert.equal(h.analytics.services[0].cachedShare, 90);
        assert.deepEqual(
            h.apps,
            [{ lastSeen: new Date(1_791_178_000_000).toISOString(), name: "Infuse/8.0" }],
            "SlickSync’s own searches are not an app"
        );
        const auth = s.calls.find((c) => c.path.startsWith("/api/v1/user/analytics")).auth;
        assert.equal(
            Buffer.from(auth.replace("Basic ", ""), "base64").toString(),
            "cfg-uuid:secret"
        );
    } finally {
        s.restore();
    }
});

test("someone added without the configuration password is told why, and nothing is asked", async () => {
    const s = fakeAio({});
    try {
        const h = await aio.healthFor(
            prismaFor(person({ aioConfigPassword: null })),
            decrypt,
            "acc",
            "p1"
        );
        assert.equal(h.canRead, false);
        assert.match(h.reason, /without the configuration password/);
        assert.equal(s.calls.length, 0);
        assert.deepEqual(
            await aio.healthFor(
                prismaFor(person({ jellyfinServerKind: "jellyfin" })),
                decrypt,
                "acc",
                "p1"
            ),
            { available: false }
        );
    } finally {
        s.restore();
    }
});

test("test search: a summary, never the links; one at a time; a pause between runs", async () => {
    aio.forgetForTests();
    const s = fakeAio({
        "/api/v1/search": (u) => {
            assert.equal(u.searchParams.get("type"), "movie");
            assert.equal(u.searchParams.get("id"), "tt0133093");
            return [
                200,
                {
                    errors: [{ description: "timed out", title: "[❌] Comet" }],
                    results: [
                        {
                            addon: "Torrentio",
                            cached: true,
                            service: "realdebrid",
                            type: "debrid",
                            url: "https://secret.example.com/a",
                        },
                        {
                            addon: "Torrentio",
                            cached: false,
                            service: "realdebrid",
                            type: "debrid",
                            url: "https://secret.example.com/b",
                        },
                        {
                            addon: "Usenet",
                            cached: null,
                            nzbUrl: "https://secret.example.com/c",
                            type: "usenet",
                        },
                    ],
                },
            ];
        },
    });
    try {
        const r = await aio.testSearch(prismaFor(person()), decrypt, "acc", "p1", {
            id: "tt0133093",
            type: "movie",
        });
        assert.equal(r.streams, 3);
        assert.equal(r.cached, 1);
        assert.equal(r.usenet, 1);
        assert.deepEqual(
            r.addons.map((a) => [a.name, a.streams]),
            [
                ["Torrentio", 2],
                ["Usenet", 1],
            ]
        );
        assert.equal(r.errors[0].description, "timed out");
        assert.equal(
            JSON.stringify(r).includes("secret.example.com"),
            false,
            "no stream links leave the server"
        );
        await assert.rejects(
            aio.testSearch(prismaFor(person()), decrypt, "acc", "p1", {
                id: "tt0133093",
                type: "movie",
            }),
            /Wait \d+ seconds/
        );
        const later = await aio.testSearch(
            prismaFor(person()),
            decrypt,
            "acc",
            "p1",
            { id: "tt0133093", type: "movie" },
            { now: Date.now() + aio.SEARCH_COOLDOWN_MS + 1 }
        );
        assert.equal(later.streams, 3, "after the pause it runs again");
    } finally {
        s.restore();
        aio.forgetForTests();
    }
});

test("test search ids: an episode needs its season and episode; nothing odd gets through", () => {
    assert.equal(aio.cleanId("movie", "tt0133093"), "tt0133093");
    assert.equal(aio.cleanId("series", "tt0903747:1:2"), "tt0903747:1:2");
    assert.equal(aio.cleanId("series", "kitsu:46676:1"), "kitsu:46676:1");
    assert.throws(() => aio.cleanId("series", "tt0903747"), /pick an episode/);
    assert.throws(() => aio.cleanId("movie", "tt1&type=x"), /isn’t a title id/);
});
