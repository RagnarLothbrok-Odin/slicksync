const test = require("node:test");
const assert = require("node:assert/strict");
const { membersOf } = require("../server/utils/aioCollections");

const lists = [
    {
        id: "a",
        itemsJson: JSON.stringify([{ id: "tt1" }, { id: "tt2" }, { id: "tt3" }, { id: "kitsu:5" }]),
    },
    { id: "b", itemsJson: JSON.stringify([{ id: "tt4" }, { id: "tt2" }]) },
];
const ids = (items) => items.map((i) => i.id).join(",");

test("titles: catalogs in order, each title once, IMDb ids only", () => {
    assert.equal(ids(membersOf({ catalogIds: ["a", "b"] }, lists)), "tt1,tt2,tt3,tt4");
    assert.equal(ids(membersOf({ catalogIds: ["b", "a"] }, lists)), "tt4,tt2,tt1,tt3");
});

test("titles: a dragged order wins, titles it does not mention keep their place after", () => {
    assert.equal(
        ids(membersOf({ catalogIds: ["a", "b"], order: ["tt4", "tt1"] }, lists)),
        "tt4,tt1,tt2,tt3"
    );
    assert.equal(
        ids(membersOf({ catalogIds: ["a", "b"], order: ["tt9", "tt3"] }, lists)),
        "tt3,tt1,tt2,tt4"
    );
    assert.equal(ids(membersOf({ catalogIds: ["a", "b"], order: [] }, lists)), "tt1,tt2,tt3,tt4");
});

function fakePrisma(sync) {
    const state = { sync };
    return {
        appAccount: {
            findUnique: async () => ({ sync: state.sync }),
            update: async ({ data }) => {
                state.sync = data.sync;
            },
        },
        customList: { findMany: async () => lists },
        state,
    };
}

test("per account: own arrangement, else the older shared one, else one per catalog", async () => {
    const { loadCollections, saveCollections } = require("../server/utils/aioCollections");
    const shared = { collections: [{ catalogIds: ["b"], hidden: false, id: "x", name: "Shared" }] };
    const prisma = fakePrisma({ aioCollections: shared });

    let r = await loadCollections(prisma, "acc", "sam");
    assert.equal(r.configured, true);
    assert.deepEqual(
        r.collections.map((c) => c.name),
        ["Shared"]
    );

    await saveCollections(prisma, "acc", "sam", [{ catalogIds: ["a"], id: "y", name: "Sam only" }]);
    assert.deepEqual(
        (await loadCollections(prisma, "acc", "sam")).collections.map((c) => c.name),
        ["Sam only"]
    );
    assert.deepEqual(
        (await loadCollections(prisma, "acc", "kim")).collections.map((c) => c.name),
        ["Shared"]
    );

    await saveCollections(prisma, "acc", "sam", null);
    r = await loadCollections(prisma, "acc", "sam");
    assert.equal(r.configured, false);
    assert.deepEqual(
        r.collections.map((c) => c.id),
        ["a", "b"]
    );
    assert.deepEqual(
        (await loadCollections(prisma, "acc", "kim")).collections.map((c) => c.name),
        ["Shared"]
    );

    await assert.rejects(saveCollections(prisma, "acc", "", []));
});

// Export -> import: into another household (different catalogs), and back
// into the one it came from.
function catalogStore(initial) {
    const rows = initial.map((l) => ({ ...l }));
    let n = 0;
    return {
        create: async ({ data }) => {
            const row = { id: `new${++n}`, ...data };
            rows.push(row);
            return row;
        },
        findMany: async () => rows,
        rows,
    };
}

test("export carries each collection with its catalogs and their titles", async () => {
    const { exportCollections } = require("../server/utils/aioCollections");
    const prisma = fakePrisma({
        aioCollections: {
            byUser: {
                sam: {
                    collections: [
                        {
                            catalogIds: ["a", "b"],
                            hidden: false,
                            id: "c1",
                            name: "Mix",
                            order: ["tt4"],
                        },
                    ],
                },
            },
        },
    });
    const out = await exportCollections(prisma, "acc", "sam");
    assert.equal(out.v, 1);
    assert.deepEqual(out.collections, [
        { catalogs: ["a", "b"], coverUrl: null, hidden: false, name: "Mix", order: ["tt4"] },
    ]);
    assert.deepEqual(
        out.catalogs.map((c) => [c.ref, c.items.map((i) => i.id).join(",")]),
        [
            ["a", "tt1,tt2,tt3"],
            ["b", "tt4,tt2"],
        ]
    );
});

test("import into another household makes the catalogs it lacks and reuses an identical one", async () => {
    const { importCollections } = require("../server/utils/aioCollections");
    const customList = catalogStore([
        // Same name and same titles as "Horror" in the code: reused.
        { id: "h1", itemsJson: JSON.stringify([{ id: "tt7" }, { id: "tt8" }]), name: "horror" },
        // Same name, different titles: a new one is made beside it.
        { id: "k1", itemsJson: JSON.stringify([{ id: "tt1" }]), name: "Kids" },
    ]);
    const prisma = { customList };
    const payload = {
        catalogs: [
            {
                items: [
                    { id: "tt7", name: "A", type: "movie" },
                    { id: "tt8", name: "B", type: "movie" },
                ],
                name: "Horror",
                ref: "x-h",
            },
            {
                items: [
                    { id: "tt2", name: "C", type: "series" },
                    { id: "tt3", name: "D", type: "movie" },
                    { id: "nope", name: "E", type: "movie" },
                ],
                name: "Kids",
                ref: "x-k",
            },
        ],
        collections: [
            { catalogs: ["x-h"], hidden: false, name: "Scary" },
            {
                catalogs: ["x-k", "x-missing"],
                hidden: true,
                name: "Family",
                order: ["tt3", "bogus"],
            },
        ],
        v: 1,
    };
    const r = await importCollections(prisma, "acc", payload);
    assert.equal(r.catalogsReused, 1);
    assert.equal(r.catalogsCreated, 1);
    const made = customList.rows.find((l) => l.id === "new1");
    assert.equal(made.name, "Kids (imported)");
    assert.deepEqual(
        JSON.parse(made.itemsJson).map((i) => i.id),
        ["tt2", "tt3"]
    );
    assert.deepEqual(
        r.collections.map((c) => [c.name, c.catalogIds.join(","), c.hidden]),
        [
            ["Scary", "h1", false],
            ["Family", "new1", true],
        ]
    );
    assert.deepEqual(r.collections[1].order, ["tt3"]);
    assert.ok(r.collections.every((c) => /^c-[0-9a-f]{10}$/.test(c.id)));
});

test("import back into the same household reuses its catalogs by id", async () => {
    const { importCollections } = require("../server/utils/aioCollections");
    const customList = catalogStore(lists);
    const r = await importCollections({ customList }, "acc", {
        catalogs: [
            { items: [], name: "A", ref: "a" },
            { items: [], name: "B", ref: "b" },
        ],
        collections: [{ catalogs: ["a", "b"], name: "Mix" }],
        v: 1,
    });
    assert.equal(r.catalogsCreated, 0);
    assert.equal(r.catalogsReused, 2);
    assert.deepEqual(r.collections[0].catalogIds, ["a", "b"]);
});

test("import refuses something that is not an export", async () => {
    const { importCollections } = require("../server/utils/aioCollections");
    const customList = catalogStore([]);
    await assert.rejects(
        importCollections({ customList }, "acc", { collections: [] }),
        /isn.t an AIOStreams collections export/
    );
    await assert.rejects(
        importCollections({ customList }, "acc", { catalogs: [], collections: [], v: 1 }),
        /no collections/
    );
});
