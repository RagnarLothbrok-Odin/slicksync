// Keep in step (server/utils/watchCopy/keepInStep.js): what moves, what
// doesn't, and who sends.
const test = require("node:test");
const assert = require("node:assert/strict");
const kis = require("../server/utils/watchCopy/keepInStep");
const { forgetForTests } = require("../server/utils/watchCopy/adapters");

const ON = Date.parse("2026-10-20T12:00:00Z");
const LATER = Date.parse("2026-10-20T13:00:00Z");
const OLD = Date.parse("2026-09-01T12:00:00Z");

function world({ members = [], enabled = true } = {}) {
    const setting = {
        accountId: "acc",
        enabled,
        enabledAt: new Date(ON),
        lastPassAt: null,
        members: JSON.stringify(members),
        userId: "u1",
    };
    const moves = [];
    const prisma = {
        user: {
            findFirst: async () => ({
                accountId: "acc",
                email: "c@example.com",
                id: "u1",
                providerType: "stremio",
                stremioAuthKey: "k",
                username: "Chris",
            }),
        },
        userProviderCredential: {
            findMany: async () => [
                { id: "c1", nuvioRefreshToken: "r", nuvioUserId: "n", providerType: "nuvio" },
            ],
        },
        watchSyncMove: {
            createMany: async ({ data }) => {
                moves.push(...data);
            },
            deleteMany: async () => ({ count: 0 }),
            findMany: async () => moves.slice().reverse(),
        },
        watchSyncSetting: {
            findMany: async () => [setting],
            findUnique: async () => setting,
            update: async ({ data }) => Object.assign(setting, data),
            upsert: async ({ update }) => Object.assign(setting, update),
        },
    };
    // Stremio: empty library. Nuvio profile 1 (Chris) and 2 (Kids).
    const library = [];
    const pushed = { 1: [], 2: [] };
    const nuvioData = {
        1: {
            library: [],
            progress: [],
            watched: [
                { content_id: "tt1", content_type: "movie", title: "New Film", watched_at: LATER },
                { content_id: "tt2", content_type: "movie", title: "Old Film", watched_at: OLD },
            ],
        },
        2: {
            library: [],
            progress: [],
            watched: [
                { content_id: "tt3", content_type: "movie", title: "Cartoon", watched_at: LATER },
            ],
        },
    };
    const stremio = {
        addLibraryItem: async (c) => {
            for (const i of c) {
                const k = library.findIndex((x) => x._id === i._id);
                if (k >= 0) {
                    library[k] = i;
                } else {
                    library.push(i);
                }
            }
        },
        getLibrary: async () => library,
    };
    const nuvio = {
        getProfileAvatars: async () => new Map(),
        getProfiles: async () => [
            { name: "Chris", profile_index: 1 },
            { name: "Kids", profile_index: 2 },
        ],
        getWatchState: async (p) => nuvioData[p],
        pushLibraryItems: async () => undefined,
        pushWatchedItems: async (p, items) => {
            pushed[p].push(...items);
            nuvioData[p].watched.push(...items);
        },
        pushWatchProgress: async () => undefined,
    };
    const deps = {
        createProvider: (row) => (row.providerType === "nuvio" ? nuvio : stremio),
        decrypt: (t) => t,
    };
    return { deps, library, moves, prisma, pushed, setting };
}

test("out of the box: each sign-in's own profile sends and receives, a second profile is left out", async () => {
    const w = world();
    const d = await kis.describe(w.prisma, w.deps, "acc", "u1");
    assert.deepEqual(
        d.places.map((p) => [p.side, p.mode]),
        [
            ["stremio", "both"],
            ["nuvio:1", "both"],
            ["nuvio:2", "off"],
        ]
    );
});

test("what is finished after switching on moves; what came before stays put", async () => {
    forgetForTests();
    const w = world({ members: [{ mode: "off", side: "nuvio:2" }] });
    const moved = await kis.runPerson(w.prisma, w.deps, w.setting, LATER + 60_000);
    assert.deepEqual(
        moved.map((m) => [m.title, [...m.to]]),
        [["New Film", ["Stremio"]]]
    );
    assert.equal(w.library.find((i) => i._id === "tt1")?.state.flaggedWatched, 1);
    assert.equal(
        w.library.find((i) => i._id === "tt2"),
        undefined,
        "older than switching on: not moved"
    );
    assert.equal(w.pushed[2].length, 0, "a left-out profile is untouched");
    assert.equal(w.moves[0].title, "New Film");
    assert.deepEqual(JSON.parse(w.moves[0].toLabels), ["Stremio"]);
});

test("a receive-only profile gets everything but never sends", async () => {
    forgetForTests();
    const w = world({ members: [{ mode: "receive", side: "nuvio:2" }] });
    await kis.runPerson(w.prisma, w.deps, w.setting, LATER + 60_000);
    assert.deepEqual(
        w.pushed[2].map((i) => i.content_id),
        ["tt1"],
        "Kids receives the new film"
    );
    assert.equal(
        w.library.find((i) => i._id === "tt3"),
        undefined,
        "the cartoon never leaves Kids"
    );
});

test("a second pass moves nothing new (no echo back and forth)", async () => {
    forgetForTests();
    const w = world({ members: [{ mode: "receive", side: "nuvio:2" }] });
    await kis.runPerson(w.prisma, w.deps, w.setting, LATER + 60_000);
    w.setting.lastPassAt = new Date(LATER + 60_000);
    const again = await kis.runPerson(w.prisma, w.deps, w.setting, LATER + 5 * 60_000);
    assert.deepEqual(again, []);
});

test("merge keeps each title at its furthest", () => {
    const a = new Map([
        [
            "tt9",
            {
                episodes: new Map([["1:1", 1]]),
                id: "tt9",
                lastActivity: 10,
                resume: { at: 10, episode: 2, position: 5, season: 1 },
                type: "series",
                watchedAt: null,
            },
        ],
    ]);
    const b = new Map([
        [
            "tt9",
            {
                episodes: new Map([["1:2", 2]]),
                id: "tt9",
                lastActivity: 20,
                resume: { at: 20, episode: 3, position: 9, season: 1 },
                type: "series",
                watchedAt: null,
            },
        ],
    ]);
    const m = kis
        .merge([
            { label: "A", state: a },
            { label: "B", state: b },
        ])
        .get("tt9");
    assert.deepEqual([...m.episodes.keys()].sort(), ["1:1", "1:2"]);
    assert.equal(m.resume.episode, 3);
    assert.equal(m.from, "B");
});

test("switching on starts the clock; modes are saved", async () => {
    const w = world({ enabled: false });
    w.setting.enabledAt = null;
    const d = await kis.save(w.prisma, w.deps, "acc", "u1", {
        enabled: true,
        members: [
            { mode: "receive", side: "nuvio:2" },
            { mode: "bogus", side: "x" },
        ],
        now: LATER,
    });
    assert.equal(w.setting.enabled, true);
    assert.equal(new Date(w.setting.enabledAt).getTime(), LATER);
    assert.deepEqual(JSON.parse(w.setting.members), [{ mode: "receive", side: "nuvio:2" }]);
    assert.equal(d.places.find((p) => p.side === "nuvio:2").mode, "receive");
});

test("a pass that could not read a place does not move the clock, so the next pass catches up", async () => {
    forgetForTests();
    const w = world();
    w.deps.createProvider = (row) => {
        if (row.providerType === "stremio") {
            return {
                getLibrary: async () => {
                    throw new Error("offline");
                },
            };
        }
        return w.deps.__nuvio;
    };
    const nuvio = {
        getProfileAvatars: async () => new Map(),
        getProfiles: async () => [{ name: "Chris", profile_index: 1 }],
        getWatchState: async () => ({ library: [], progress: [], watched: [] }),
    };
    w.deps.__nuvio = nuvio;
    await kis.runAll(w.prisma, () => w.deps, LATER + 60_000);
    assert.equal(w.setting.lastPassAt, null, "not counted as done");
    assert.match(w.setting.lastError, /Stremio/);
    assert.ok(nuvio);
});

test("a person who was deleted has their Keep in step removed", async () => {
    const w = world();
    w.prisma.user.findFirst = async () => null;
    let deleted = null;
    w.prisma.watchSyncSetting.deleteMany = async ({ where }) => {
        deleted = where.userId;
        return { count: 1 };
    };
    await kis.runAll(w.prisma, () => w.deps, LATER + 60_000);
    assert.equal(deleted, "u1");
});
