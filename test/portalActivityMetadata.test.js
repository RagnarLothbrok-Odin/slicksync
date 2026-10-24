const test = require("node:test");
const assert = require("node:assert/strict");
const { portalActivityMetadata } = require("../server/utils/portalActivityMetadata");

test("cold home resolves show titles without first opening Library", async () => {
    const calls = [];
    const map = await portalActivityMetadata(
        [],
        [{ itemId: "tt2661044:1:2", itemType: "series", watchTimeSeconds: 300 }],
        async (id, type) => {
            calls.push([id, type]);
            return { poster: "https://example.test/poster.jpg", title: "The 100" };
        }
    );
    assert.deepEqual(calls, [["tt2661044", "series"]]);
    assert.equal(map.get("tt2661044:1:2").name, "The 100");
    assert.equal(map.get("tt2661044").poster, "https://example.test/poster.jpg");
});

test("warm library metadata is reused and failed lookups do not fail history", async () => {
    const map = await portalActivityMetadata(
        [{ _id: "tt1", name: "Known movie", poster: "poster.jpg" }],
        [
            { itemId: "tt1", itemType: "movie" },
            { itemId: "tt2", itemType: "movie" },
        ],
        async (id) => {
            assert.equal(id, "tt2");
            throw new Error("offline");
        }
    );
    assert.equal(map.get("tt1").name, "Known movie");
    assert.equal(map.get("tt2"), undefined);
});

test("bounded cold-cache work prioritizes the most-watched title", async () => {
    const calls = [];
    const activities = Array.from({ length: 30 }, (_, i) => ({
        itemId: `tt${i}`,
        itemType: "movie",
        watchTimeSeconds: i,
    }));
    await portalActivityMetadata([], activities, async (id) => {
        calls.push(id);
        return { title: id };
    });
    assert.equal(calls.length, 12);
    assert.equal(calls[0], "tt29");
});
