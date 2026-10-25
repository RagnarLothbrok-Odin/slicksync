// "Caught up to here" (server/utils/catchUp.js): History only - never watch
// time - and the person's own server.
const test = require("node:test");
const assert = require("node:assert/strict");
const catchUp = require("../server/utils/catchUp");

const NOW = Date.parse("2026-10-05T12:00:00Z");

function world({ history = [] } = {}) {
    const episodes = [...history];
    const writes = { watchActivity: 0 };
    const prisma = {
        episodeWatchHistory: {
            deleteMany: async ({ where }) => {
                const keep = episodes.filter(
                    (e) =>
                        !Object.entries(where).every(
                            ([k, v]) => k === "accountId" || k === "userId" || e[k] === v
                        )
                );
                const count = episodes.length - keep.length;
                episodes.splice(0, episodes.length, ...keep);
                return { count };
            },
            findMany: async ({ where }) =>
                episodes.filter((e) => !where.showId || e.showId === where.showId),
            findUnique: async ({ where }) =>
                episodes.find((e) => e.videoId === where.accountId_userId_videoId.videoId) || null,
            updateMany: async ({ where, data }) => {
                let count = 0;
                for (const e of episodes) {
                    if (e.videoId === where.videoId) {
                        Object.assign(e, data);
                        count++;
                    }
                }
                return { count };
            },
            upsert: async ({ where, create, update }) => {
                const row = episodes.find(
                    (e) => e.videoId === where.accountId_userId_videoId.videoId
                );
                if (row) {
                    Object.assign(row, update);
                    return row;
                }
                episodes.push(create);
                return create;
            },
        },
        user: {
            findFirst: async ({ where }) => ({
                accountId: "acc",
                id: where.id,
                jellyfinServerKind: "jellyfin",
                jellyfinServerUrl: "https://jf.example.com",
                jellyfinToken: "enc",
                jellyfinUserId: "u",
                providerType: "jellyfin",
                username: "Mia",
            }),
        },
        watchActivity: {
            create: async () => {
                writes.watchActivity++;
            },
            createMany: async () => {
                writes.watchActivity++;
            },
        },
    };
    return { episodes, prisma, writes };
}

// Cinemeta's list for a show: S1E1-3 aired, S1E4 next week, plus a special.
const meta = async () => ({
    allEpisodes: [
        { episode: 1, released: "2026-01-01T00:00:00Z", season: 1, title: "One" },
        { episode: 2, released: "2026-01-08T00:00:00Z", season: 1, title: "Two" },
        { episode: 3, released: "2026-01-15T00:00:00Z", season: 1, title: "Three" },
        { episode: 4, released: "2026-10-12T00:00:00Z", season: 1, title: "Four" },
    ],
    poster: "https://images.example.com/frieren.jpg",
    title: "Frieren",
});

function fakeProvider({ playedUpTo = false } = {}) {
    const calls = { playedUpTo: [], setPlayed: [] };
    const server = [
        { episode: 1, itemId: "e1", played: true, premiere: "2026-01-01", season: 1, title: "One" },
        {
            episode: 2,
            itemId: "e2",
            played: false,
            premiere: "2026-01-08",
            season: 1,
            title: "Two",
        },
        {
            episode: 3,
            itemId: "e3",
            played: false,
            premiere: "2026-01-15",
            season: 1,
            title: "Three",
        },
        {
            episode: 4,
            itemId: "e4",
            played: false,
            premiere: "2026-10-12",
            season: 1,
            title: "Four",
        },
    ];
    return {
        calls,
        createProvider: () => ({
            listEpisodes: async () => server,
            playedUpTo: async (id) => {
                calls.playedUpTo.push(id);
                return playedUpTo;
            },
            setPlayed: async (id) => {
                calls.setPlayed.push(id);
            },
        }),
    };
}

test("marks every aired episode up to the chosen one - in History, never as watch time", async () => {
    catchUp.forgetForTests();
    const w = world({
        history: [
            {
                completed: true,
                episode: 1,
                episodeName: "One",
                season: 1,
                showId: "tt1",
                showName: "Frieren",
                videoId: "tt1:1:1",
            },
        ],
    });
    const p = fakeProvider();
    const job = await catchUp.start(
        w.prisma,
        () => "tok",
        "acc",
        "mia",
        { episode: 4, season: 1, showId: "tt1" },
        { createProvider: p.createProvider, fetchMeta: meta, now: NOW, wait: true }
    );
    assert.equal(job.state, "done");
    assert.equal(job.total, 3, "S1E4 hasn't aired yet");
    assert.equal(job.alreadyWatched, 1);
    assert.equal(job.recorded, 2);
    const added = w.episodes.filter((e) => e.profileLabel === "Caught up");
    assert.deepEqual(
        added.map((e) => e.videoId),
        ["tt1:1:2", "tt1:1:3"]
    );
    assert.ok(
        added.every((e) => e.completed === true && e.episodeName && e.showName === "Frieren")
    );
    assert.equal(w.writes.watchActivity, 0, "no watch time");
    // Real Jellyfin: one "played" per episode it doesn't already have.
    assert.deepEqual(p.calls.setPlayed.sort(), ["e2", "e3"]);
    assert.deepEqual(job.server, { how: "each", marked: 2, state: "done", total: 2 });
});

test("AIOStreams with PlayedUpTo: one call for the lot", async () => {
    catchUp.forgetForTests();
    const w = world();
    const p = fakeProvider({ playedUpTo: true });
    const job = await catchUp.start(
        w.prisma,
        () => "tok",
        "acc",
        "mia",
        { episode: 3, season: 1, showId: "tt1" },
        { createProvider: p.createProvider, fetchMeta: meta, now: NOW, wait: true }
    );
    assert.deepEqual(p.calls.playedUpTo, ["e3"]);
    assert.deepEqual(p.calls.setPlayed, []);
    assert.equal(job.server.how, "played-up-to");
});

test("refuses nonsense, and a second run while one is going", async () => {
    catchUp.forgetForTests();
    const w = world();
    const p = fakeProvider();
    await assert.rejects(
        catchUp.start(
            w.prisma,
            () => "tok",
            "acc",
            "mia",
            { episode: 1, season: 0, showId: "tt1" },
            { createProvider: p.createProvider, fetchMeta: meta, now: NOW }
        ),
        /Pick the episode/
    );
    const first = await catchUp.start(
        w.prisma,
        () => "tok",
        "acc",
        "mia",
        { episode: 2, season: 1, showId: "tt1" },
        { createProvider: p.createProvider, fetchMeta: meta, now: NOW }
    );
    assert.equal(first.state, "running");
    await assert.rejects(
        catchUp.start(
            w.prisma,
            () => "tok",
            "acc",
            "mia",
            { episode: 3, season: 1, showId: "tt1" },
            { createProvider: p.createProvider, fetchMeta: meta, now: NOW }
        ),
        /Already marking/
    );
});

test("a show Cinemeta doesn't know (anime, TMDb-only) is listed from their server", async () => {
    catchUp.forgetForTests();
    const w = world();
    const p = fakeProvider();
    const list = await catchUp.episodesFor(w.prisma, () => "tok", "acc", "mia", "tmdb:209867", {
        createProvider: p.createProvider,
        fetchMeta: async () => null,
    });
    assert.deepEqual(
        list.episodes.map((e) => `${e.season}:${e.episode}`),
        ["1:1", "1:2", "1:3", "1:4"]
    );
});

test("the show picker only offers shows whose episodes can be listed", async () => {
    catchUp.forgetForTests();
    const w = world({
        history: [
            { episode: 2, poster: null, season: 1, showId: "tt1", showName: "Frieren" },
            { episode: 1, poster: null, season: 1, showId: "tt1", showName: "Frieren" },
            { episode: 1, poster: null, season: 1, showId: "tt7000013", showName: "Made-up show" },
            {
                episode: 4,
                poster: null,
                season: 1,
                showId: "tmdb:209867",
                showName: "Not on Cinemeta",
            },
        ],
    });
    const fetchMeta = async (id) => (id === "tt1" ? meta() : null);

    // No server of their own: only what Cinemeta can list.
    const findFirst = w.prisma.user.findFirst;
    w.prisma.user.findFirst = async ({ where }) => ({
        accountId: "acc",
        id: where.id,
        jellyfinToken: null,
        providerType: "nuvio",
    });
    const shows = await catchUp.showsFor(w.prisma, "acc", "mia", { fetchMeta });
    assert.deepEqual(
        shows.map((s) => s.id),
        ["tt1"],
        "a show nothing can list is never offered"
    );
    assert.equal(
        shows[0].poster,
        "https://images.example.com/frieren.jpg",
        "the poster comes from Cinemeta when History has none"
    );
    assert.deepEqual(shows[0].last, { episode: 2, season: 1 }, "the newest episode they watched");

    // Their own server can list any show, so everything is offered.
    w.prisma.user.findFirst = findFirst;
    const withServer = await catchUp.showsFor(w.prisma, "acc", "mia", { fetchMeta });
    assert.deepEqual(
        withServer.map((s) => s.id),
        ["tt1", "tt7000013", "tmdb:209867"]
    );
});

test("the picker looks past unlistable shows, and asks about each only once", async () => {
    catchUp.forgetForTests();
    // Thirty made-up shows watched most recently, then two real ones.
    const history = Array.from({ length: 30 }, (_, i) => ({
        episode: 1,
        poster: null,
        season: 1,
        showId: `tt70000${String(i).padStart(2, "0")}`,
        showName: `Made-up ${i}`,
    }));
    history.push(
        { episode: 3, poster: null, season: 1, showId: "tt1", showName: "Frieren" },
        { episode: 1, poster: null, season: 1, showId: "tt2", showName: "Dungeon Meshi" }
    );
    const w = world({ history });
    w.prisma.user.findFirst = async ({ where }) => ({
        accountId: "acc",
        id: where.id,
        jellyfinToken: null,
        providerType: "nuvio",
    });
    const asked = [];
    const fetchMeta = async (id) => {
        asked.push(id);
        return id === "tt1" || id === "tt2" ? meta() : null;
    };
    const shows = await catchUp.showsFor(w.prisma, "acc", "mia", { fetchMeta });
    assert.deepEqual(
        shows.map((s) => s.id),
        ["tt1", "tt2"]
    );
    assert.equal(asked.length, 32);
    asked.length = 0;
    await catchUp.showsFor(w.prisma, "acc", "mia", { fetchMeta });
    assert.deepEqual(asked, ["tt1", "tt2"], "the made-up ones are remembered as unlistable");
});

test("Undo takes back exactly what the run added, here and on their server", async () => {
    catchUp.forgetForTests();
    // E1 already watched, E2 started but not finished, E3 never opened.
    const w = world({
        history: [
            {
                completed: true,
                episode: 1,
                season: 1,
                showId: "tt1",
                showName: "Frieren",
                videoId: "tt1:1:1",
            },
            {
                completed: false,
                episode: 2,
                season: 1,
                showId: "tt1",
                showName: "Frieren",
                videoId: "tt1:1:2",
            },
        ],
    });
    const p = fakeProvider();
    const calls = [];
    const createProvider = () => ({
        ...p.createProvider(),
        setPlayed: async (id, played) => {
            calls.push([id, played]);
        },
    });
    const job = await catchUp.start(
        w.prisma,
        () => "tok",
        "acc",
        "mia",
        { episode: 3, season: 1, showId: "tt1" },
        { createProvider, fetchMeta: meta, now: NOW, wait: true }
    );
    assert.equal(job.canUndo, true);
    assert.deepEqual(
        w.episodes.map((e) => [e.videoId, e.completed]),
        [
            ["tt1:1:1", true],
            ["tt1:1:2", true],
            ["tt1:1:3", true],
        ]
    );
    assert.deepEqual(calls, [
        ["e2", true],
        ["e3", true],
    ]);

    calls.length = 0;
    const after = await catchUp.undo(w.prisma, () => "tok", "acc", "mia", {
        createProvider,
        wait: true,
    });
    assert.equal(after.state, "undone");
    assert.equal(after.canUndo, false);
    assert.deepEqual(
        w.episodes.map((e) => [e.videoId, e.completed]),
        [
            ["tt1:1:1", true],
            ["tt1:1:2", false],
        ],
        "E1 stays watched, E2 back to started, E3 gone"
    );
    assert.deepEqual(
        calls.sort(),
        [
            ["e2", false],
            ["e3", false],
        ],
        "only what the run marked is unmarked there"
    );
    await assert.rejects(
        catchUp.undo(w.prisma, () => "tok", "acc", "mia", { createProvider }),
        /Nothing to undo/
    );
});

test("one episode can be marked not watched again", async () => {
    catchUp.forgetForTests();
    const w = world({
        history: [
            {
                completed: true,
                episode: 1,
                season: 1,
                showId: "tt1",
                showName: "Frieren",
                videoId: "tt1:1:1",
            },
            {
                completed: true,
                episode: 2,
                season: 1,
                showId: "tt1",
                showName: "Frieren",
                videoId: "tt1:1:2",
            },
        ],
    });
    const calls = [];
    const createProvider = () => ({
        ...fakeProvider().createProvider(),
        setPlayed: async (id, played) => {
            calls.push([id, played]);
        },
    });
    const result = await catchUp.unmark(
        w.prisma,
        () => "tok",
        "acc",
        "mia",
        { episode: 2, season: 1, showId: "tt1" },
        { createProvider }
    );
    assert.deepEqual(result, { removed: 1, server: "done" });
    assert.deepEqual(
        w.episodes.map((e) => e.videoId),
        ["tt1:1:1"]
    );
    assert.deepEqual(calls, [["e2", false]]);
});

test("Done clears a finished run and its Undo; a run still going is left alone", async () => {
    catchUp.forgetForTests();
    const w = world({
        history: [
            {
                completed: true,
                episode: 1,
                season: 1,
                showId: "tt1",
                showName: "Frieren",
                videoId: "tt1:1:1",
            },
        ],
    });
    const p = fakeProvider();
    const running = await catchUp.start(
        w.prisma,
        () => "tok",
        "acc",
        "mia",
        { episode: 2, season: 1, showId: "tt1" },
        { createProvider: p.createProvider, fetchMeta: meta, now: NOW }
    );
    assert.equal(running.state, "running");
    assert.equal(catchUp.dismiss("mia").state, "running", "not cleared mid-run");

    catchUp.forgetForTests();
    await catchUp.start(
        w.prisma,
        () => "tok",
        "acc",
        "mia",
        { episode: 3, season: 1, showId: "tt1" },
        { createProvider: p.createProvider, fetchMeta: meta, now: NOW, wait: true }
    );
    assert.equal(catchUp.status("mia").canUndo, true);
    assert.equal(catchUp.dismiss("mia"), null);
    assert.equal(catchUp.status("mia"), null, "gone at the next opening too");
    await assert.rejects(
        catchUp.undo(w.prisma, () => "tok", "acc", "mia", { createProvider: p.createProvider }),
        /Nothing to undo/
    );
});

test("on AIOStreams, filler and recap episodes are marked as such in the list", async () => {
    const w = world();
    const base = w.prisma.user.findFirst;
    w.prisma.user.findFirst = async (args) => ({
        ...(await base(args)),
        jellyfinServerKind: "aiostreams",
    });
    const server = [
        { episode: 1, itemId: "e1", played: false, season: 1 },
        { episode: 2, filler: true, itemId: "e2", played: false, season: 1 },
        { episode: 3, itemId: "e3", played: false, recap: true, season: 1 },
    ];
    const list = await catchUp.episodesFor(w.prisma, () => "tok", "acc", "mia", "tt1", {
        createProvider: () => ({ listEpisodes: async () => server }),
        fetchMeta: meta,
    });
    assert.deepEqual(
        list.episodes.map((e) => e.kind || null),
        [null, "filler", "recap", null]
    );
    assert.equal(list.episodes[0].title, "One", "Cinemeta still gives the titles");
});

test("on AIOMetadata the server's filler and recap marks are read too; a plain Jellyfin isn't asked", async () => {
    const server = [
        { episode: 1, itemId: "e1", played: false, season: 1 },
        { episode: 2, filler: true, itemId: "e2", played: false, season: 1 },
        { episode: 3, itemId: "e3", played: false, recap: true, season: 1 },
    ];
    const w = world();
    const base = w.prisma.user.findFirst;
    w.prisma.user.findFirst = async (args) => ({
        ...(await base(args)),
        jellyfinServerKind: "aiometadata",
    });
    const list = await catchUp.episodesFor(w.prisma, () => "tok", "acc", "mia", "tt1", {
        createProvider: () => ({ listEpisodes: async () => server }),
        fetchMeta: meta,
    });
    assert.deepEqual(
        list.episodes.map((e) => e.kind || null),
        [null, "filler", "recap", null]
    );

    const plain = world();
    let asked = false;
    const jf = await catchUp.episodesFor(plain.prisma, () => "tok", "acc", "mia", "tt1", {
        createProvider: () => ({
            listEpisodes: async () => {
                asked = true;
                return server;
            },
        }),
        fetchMeta: meta,
    });
    assert.equal(asked, false, "Cinemeta's list is enough there");
    assert.ok(jf.episodes.every((e) => !e.kind));
});
