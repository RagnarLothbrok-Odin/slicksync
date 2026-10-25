const test = require("node:test");
const assert = require("node:assert/strict");

// A Jellyfin server played by global.fetch: method + path -> answer.
function fakeServer(routes) {
    const calls = [];
    const original = global.fetch;
    global.fetch = async (url, opts = {}) => {
        const { pathname, searchParams } = new URL(url);
        const method = (opts.method || "GET").toUpperCase();
        calls.push(`${method} ${pathname}`);
        const key = Object.keys(routes).find((k) =>
            `${method} ${pathname}?${searchParams}`.includes(k)
        );
        const body = key ? routes[key](searchParams) : { Items: [] };
        return {
            ok: true,
            status: 200,
            text: async () => (body === null ? "" : JSON.stringify(body)),
        };
    };
    return {
        calls,
        restore: () => {
            global.fetch = original;
        },
    };
}

test("played marks: what was finished elsewhere is marked, what the server already has is left alone", async () => {
    const { markFor } = require("../server/utils/jellyfinMarkPlayed");
    const server = fakeServer({
        "GET /Shows/s1/Episodes": () => ({
            Items: [
                { Id: "e1", IndexNumber: 1, ParentIndexNumber: 1, UserData: { Played: false } },
                { Id: "e2", IndexNumber: 2, ParentIndexNumber: 1, UserData: { Played: true } },
            ],
        }),
        "IncludeItemTypes=Movie&": () => ({
            Items: [
                { Id: "m1", ProviderIds: { Imdb: "tt0133093" }, UserData: { Played: true } },
                { Id: "m2", ProviderIds: { Imdb: "tt1375666" }, UserData: { Played: false } },
                { Id: "m3", ProviderIds: { Imdb: "tt0113277" }, UserData: { Played: false } },
            ],
        }),
        "IncludeItemTypes=Series": () => ({
            Items: [{ Id: "s1", ProviderIds: { Imdb: "tt0903747" } }],
        }),
        "POST /UserPlayedItems": () => null,
    });
    const prisma = {
        episodeWatchHistory: {
            findMany: async () => [
                { episode: 1, season: 1, showId: "tt0903747" },
                { episode: 2, season: 1, showId: "tt0903747" },
            ],
        },
        movieWatchHistory: {
            findMany: async () => [{ itemId: "tt0133093" }, { itemId: "tt1375666" }],
        },
        watchSession: { findMany: async () => [] },
    };
    try {
        const signIn = {
            jellyfinUserId: "u1",
            person: { id: "p1", username: "Sam" },
            serverUrl: "http://jf.example.com",
        };
        const { marked, resumed } = await markFor(prisma, "acc", signIn, "tok", new Date(0));
        assert.equal(marked, 2);
        assert.equal(resumed, 0);
        const posts = server.calls.filter((c) => c.startsWith("POST"));
        assert.deepEqual(posts.sort(), ["POST /UserPlayedItems/e1", "POST /UserPlayedItems/m2"]);
    } finally {
        server.restore();
    }
});

test("new devices: a person's first device is remembered quietly, a later new one is announced once", async () => {
    const live = require("../server/utils/jellyfinLive");
    const push = require("../server/utils/pushNotifications");
    const originalNotify = push.notifyPushForType;
    const sent = [];
    push.notifyPushForType = async (_p, _a, type, payload) => {
        sent.push({ body: payload.body, type });
    };
    let sync = {};
    const prisma = {
        appAccount: {
            findUnique: async () => ({ sync: JSON.stringify(sync) }),
            update: async ({ data }) => {
                sync = JSON.parse(data.sync);
            },
        },
    };
    const user = { id: "dev-person", username: "Sam" };
    const viewing = (device) => ({
        device,
        durationMs: 1,
        itemId: "tt1",
        itemType: "movie",
        paused: false,
        positionMs: 0,
    });
    try {
        live.recordLive(user.id, [
            viewing({ client: "Infuse", id: "tv-1", name: "Living room TV" }),
        ]);
        await live.noteDevices(prisma, "acc", [user]);
        assert.equal(sent.length, 0, "the first device is not news");
        assert.deepEqual(
            sync.jellyfinDevices[user.id].map((d) => d.key),
            ["tv-1"]
        );

        await live.noteDevices(prisma, "acc", [user]);
        assert.equal(sent.length, 0, "the same device again is not news either");

        live.recordLive(user.id, [
            viewing({ client: "Swiftfin", id: "ipad-1", name: "Kitchen iPad" }),
        ]);
        await live.noteDevices(prisma, "acc", [user]);
        await live.noteDevices(prisma, "acc", [user]);
        assert.equal(sent.length, 1);
        assert.equal(sent[0].type, "notifyOnNewDevice");
        assert.match(sent[0].body, /Kitchen iPad · Swiftfin/);
    } finally {
        push.notifyPushForType = originalNotify;
        live.forgetUser(user.id);
    }
});

test("resume points: a newer viewing elsewhere moves the server spot; an older one or a near one does not", async () => {
    const { markFor } = require("../server/utils/jellyfinMarkPlayed");
    const hourAgo = new Date(Date.now() - 3600e3).toISOString();
    const now = new Date().toISOString();
    const writes = [];
    const original = global.fetch;
    global.fetch = async (url, opts = {}) => {
        const { pathname, searchParams } = new URL(url);
        const method = (opts.method || "GET").toUpperCase();
        let body = { Items: [] };
        if (method === "POST") {
            writes.push({ body: JSON.parse(opts.body || "null"), path: pathname });
            body = null;
        } else if (searchParams.get("IncludeItemTypes") === "Movie") {
            body = {
                Items: [
                    // Watched elsewhere more recently, far from the server's spot: moved.
                    {
                        Id: "a",
                        ProviderIds: { Imdb: "tt0000001" },
                        UserData: { LastPlayedDate: hourAgo, PlaybackPositionTicks: 0 },
                    },
                    // The server saw it after the other app did: left alone.
                    {
                        Id: "b",
                        ProviderIds: { Imdb: "tt0000002" },
                        UserData: { LastPlayedDate: now, PlaybackPositionTicks: 5 * 60e3 * 1e4 },
                    },
                    // Within a minute of where the server already is: left alone.
                    {
                        Id: "c",
                        ProviderIds: { Imdb: "tt0000003" },
                        UserData: {
                            LastPlayedDate: hourAgo,
                            PlaybackPositionTicks: 20 * 60e3 * 1e4,
                        },
                    },
                ],
            };
        }
        return {
            ok: true,
            status: 200,
            text: async () => (body === null ? "" : JSON.stringify(body)),
        };
    };
    const later = new Date(Date.now() - 60e3);
    const earlier = new Date(Date.now() - 2 * 3600e3);
    const prisma = {
        episodeWatchHistory: { findMany: async () => [] },
        movieWatchHistory: { findMany: async () => [] },
        watchSession: {
            findMany: async () => [
                {
                    itemId: "tt0000001",
                    itemType: "movie",
                    lastPosition: 40 * 60e3,
                    totalDuration: 120 * 60e3,
                    updatedAt: later,
                },
                {
                    itemId: "tt0000002",
                    itemType: "movie",
                    lastPosition: 40 * 60e3,
                    totalDuration: 120 * 60e3,
                    updatedAt: earlier,
                },
                {
                    itemId: "tt0000003",
                    itemType: "movie",
                    lastPosition: 20 * 60e3 + 30e3,
                    totalDuration: 120 * 60e3,
                    updatedAt: later,
                },
            ],
        },
    };
    try {
        const r = await markFor(
            prisma,
            "acc",
            {
                jellyfinUserId: "u1",
                person: { id: "p", username: "Sam" },
                serverUrl: "http://jf.example.com",
            },
            "tok",
            new Date(0)
        );
        assert.deepEqual(r, { marked: 0, resumed: 1 });
        assert.equal(writes.length, 1);
        assert.equal(writes[0].path, "/UserItems/a/UserData");
        assert.equal(writes[0].body.PlaybackPositionTicks, 40 * 60e3 * 1e4);
    } finally {
        global.fetch = original;
    }
});

test("vault keys reach an AIOStreams setup only for people switched on", async () => {
    const { rotateInAioConfigs } = require("../server/utils/aioServiceKeys");
    let sync = {};
    const calls = [];
    const original = global.fetch;
    global.fetch = async (url, opts = {}) => {
        calls.push(`${(opts.method || "GET").toUpperCase()} ${new URL(url).pathname}`);
        const config = {
            services: [{ credentials: { apiKey: "OLDKEY000000000001" }, id: "realdebrid" }],
        };
        return {
            json: async () => ({ data: { userData: config }, success: true }),
            ok: true,
            status: 200,
        };
    };
    const person = {
        accountId: "acc",
        aioConfigId: "uuid-1",
        aioConfigPassword: "enc",
        aioConfigStateJson: "{}",
        id: "aio-1",
        jellyfinServerUrl: "http://aio.example.com/jellyfin",
        username: "Kid",
    };
    const prisma = {
        appAccount: { findUnique: async () => ({ sync: JSON.stringify(sync) }) },
        user: {
            findMany: async ({ where }) => (where.id.in.includes(person.id) ? [person] : []),
            findUnique: async () => ({ aioConfigStateJson: "{}" }),
            update: async () => ({}),
            updateMany: async () => ({}),
        },
    };
    try {
        const off = await rotateInAioConfigs(prisma, () => "pw", {
            accountId: "acc",
            newSecret: "NEWKEY000000000002",
            oldSecret: "OLDKEY000000000001",
        });
        assert.deepEqual(off.updated, []);
        assert.equal(calls.length, 0, "nothing is read or written while switched off");

        sync = { aioRotateKeys: { "aio-1": true } };
        const on = await rotateInAioConfigs(prisma, () => "pw", {
            accountId: "acc",
            newSecret: "NEWKEY000000000002",
            oldSecret: "OLDKEY000000000001",
        });
        assert.deepEqual(on.updated, [{ services: ["realdebrid"], username: "Kid" }]);
        assert.ok(calls.includes("PUT /api/v1/user"));
    } finally {
        global.fetch = original;
    }
});
