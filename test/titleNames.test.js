// Titles that arrive named by their id (server/utils/titleNames.js).
const test = require("node:test");
const assert = require("node:assert/strict");
const names = require("../server/utils/titleNames");

const cinemeta = (titles) => async (url) => {
    const id = /\/(tt\d+)\.json$/.exec(url)?.[1];
    const kind = /\/meta\/(movie|series)\//.exec(url)?.[1];
    const name = titles[`${kind}|${id}`];
    return { json: async () => ({ meta: name ? { name } : null }), ok: !!name };
};

test("an id, or nothing, is not a name; a real title is", () => {
    assert.ok(names.looksLikeIdName("tt4468740", "tt4468740"));
    assert.ok(names.looksLikeIdName("", "tt1"));
    assert.ok(names.looksLikeIdName("tt0903747:1:3", "x"));
    assert.ok(names.looksLikeIdName("kitsu:1376", null));
    assert.ok(!names.looksLikeIdName("Paddington 2", "tt4468740"));
    assert.ok(!names.looksLikeIdName("Settings", null));
    assert.equal(names.imdbIdOf("", "tt0903747:2:5"), "tt0903747");
});

test("a list gets real titles where it had ids, and keeps real ones", async () => {
    const items = [
        { _id: "tt4468740", name: "tt4468740", type: "movie" },
        { _id: "tt0903747", name: "", type: "series" },
        { _id: "tt0133093", name: "The Matrix", type: "movie" },
    ];
    const fetchImpl = cinemeta({
        "movie|tt0133093": "WRONG",
        "movie|tt4468740": "Paddington 2",
        "series|tt0903747": "Breaking Bad",
    });
    const n = await names.fillNames(
        items,
        {
            getId: (e) => e._id,
            getName: (e) => e.name,
            getType: (e) => e.type,
            setName: (e, v) => {
                e.name = v;
            },
        },
        fetchImpl
    );
    assert.equal(n, 2);
    assert.deepEqual(
        items.map((i) => i.name),
        ["Paddington 2", "Breaking Bad", "The Matrix"]
    );
});

test("saved rows and the bell are repaired; real titles are left alone", async () => {
    const rows = {
        episodeWatchHistory: [{ id: "e1", showId: "tt0903748", showName: "tt0903748" }],
        movieWatchHistory: [
            { id: "m1", itemId: "tt4468741", itemName: "tt4468741" },
            { id: "m2", itemId: "tt0133093", itemName: "The Matrix" },
        ],
        watchSession: [{ id: "s1", itemId: "tt4468741", itemName: "tt4468741", itemType: "movie" }],
    };
    const updated = [];
    const table = (name) => ({
        findMany: async () => rows[name] || [],
        updateMany: async ({ where, data }) => {
            updated.push([name, where.id.in, data]);
            return { count: where.id.in.length };
        },
    });
    const notes = [
        { body: "Today", id: "n1", title: "VIFOY watched tt4468741" },
        { body: "Attention", id: "n2", title: "Settings saved" },
    ];
    const noteUpdates = [];
    const prisma = {
        episodeWatchHistory: table("episodeWatchHistory"),
        movieWatchHistory: table("movieWatchHistory"),
        notification: {
            findMany: async () => notes,
            update: async ({ where, data }) => {
                noteUpdates.push([where.id, data]);
            },
        },
        watchSession: table("watchSession"),
    };
    const fetchImpl = cinemeta({
        "movie|tt4468741": "Paddington 2",
        "series|tt0903748": "Breaking Bad",
    });
    const fixed = await names.repairStoredNames(prisma, fetchImpl);
    assert.deepEqual(updated, [
        ["movieWatchHistory", ["m1"], { itemName: "Paddington 2" }],
        ["episodeWatchHistory", ["e1"], { showName: "Breaking Bad" }],
        ["watchSession", ["s1"], { itemName: "Paddington 2" }],
    ]);
    assert.deepEqual(noteUpdates, [["n1", { body: "Today", title: "VIFOY watched Paddington 2" }]]);
    assert.equal(fixed, 4);
});
