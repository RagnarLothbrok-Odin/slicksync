const test = require("node:test");
const assert = require("node:assert/strict");
const { searchCinemetaPosterByTitle } = require("../server/utils/libraryHelpers");

// Swap global.fetch for a stub that returns the given metas array.
function withStubbedFetch(metas, fn, { ok = true } = {}) {
    const original = global.fetch;
    global.fetch = async () => ({ json: async () => ({ metas }), ok });
    return (async () => {
        try {
            return await fn();
        } finally {
            global.fetch = original;
        }
    })();
}

test("searchCinemetaPosterByTitle: exact title + matching year returns the poster and id", async () => {
    await withStubbedFetch(
        [
            {
                id: "tt9999999",
                name: "Simpsley",
                poster: "https://p/simpsley.jpg",
                releaseInfo: "2026",
                type: "movie",
            },
        ],
        async () => {
            const r = await searchCinemetaPosterByTitle("Simpsley", "2026", "movie");
            assert.deepEqual(r, {
                id: "tt9999999",
                name: "Simpsley",
                poster: "https://p/simpsley.jpg",
                type: "movie",
            });
        }
    );
});

test("searchCinemetaPosterByTitle: matching title but wrong year returns null (correct-or-nothing)", async () => {
    await withStubbedFetch(
        [
            {
                id: "tt1",
                name: "Send Help",
                poster: "https://p/wrong.jpg",
                releaseInfo: "2019",
                type: "movie",
            },
        ],
        async () => {
            // The user wanted the 2026 "Send Help"; a 2019 same-title movie must not be used.
            const r = await searchCinemetaPosterByTitle("Send Help", "2026", "movie");
            assert.equal(r, null);
        }
    );
});

test("searchCinemetaPosterByTitle: different title returns null even if year matches", async () => {
    await withStubbedFetch(
        [
            {
                id: "tt2",
                name: "Send Help Now",
                poster: "https://p/x.jpg",
                releaseInfo: "2026",
                type: "movie",
            },
        ],
        async () => {
            const r = await searchCinemetaPosterByTitle("Send Help", "2026", "movie");
            assert.equal(r, null);
        }
    );
});

test("searchCinemetaPosterByTitle: year required but candidate has no year returns null", async () => {
    await withStubbedFetch(
        [{ id: "tt3", name: "Simpsley", poster: "https://p/x.jpg", type: "movie" }],
        async () => {
            const r = await searchCinemetaPosterByTitle("Simpsley", "2026", "movie");
            assert.equal(r, null);
        }
    );
});

test("searchCinemetaPosterByTitle: no year supplied (series) falls back to exact-title match", async () => {
    await withStubbedFetch(
        [
            {
                id: "tt7366338",
                name: "Chernobyl",
                poster: "https://p/chern.jpg",
                releaseInfo: "2019",
                type: "series",
            },
        ],
        async () => {
            const r = await searchCinemetaPosterByTitle("Chernobyl", null, "series");
            assert.equal(r.id, "tt7366338");
            assert.equal(r.poster, "https://p/chern.jpg");
        }
    );
});

test("searchCinemetaPosterByTitle: picks the correct year among multiple same-title candidates", async () => {
    await withStubbedFetch(
        [
            {
                id: "tt-old",
                name: "Send Help",
                poster: "https://p/2019.jpg",
                releaseInfo: "2019",
                type: "movie",
            },
            {
                id: "tt-new",
                name: "Send Help",
                poster: "https://p/2026.jpg",
                releaseInfo: "2026",
                type: "movie",
            },
        ],
        async () => {
            const r = await searchCinemetaPosterByTitle("Send Help", "2026", "movie");
            assert.equal(r.id, "tt-new");
            assert.equal(r.poster, "https://p/2026.jpg");
        }
    );
});

test("searchCinemetaPosterByTitle: a non-OK HTTP response returns null", async () => {
    await withStubbedFetch(
        [],
        async () => {
            const r = await searchCinemetaPosterByTitle("Anything", "2026", "movie");
            assert.equal(r, null);
        },
        { ok: false }
    );
});
