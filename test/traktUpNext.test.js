const test = require("node:test");
const assert = require("node:assert/strict");
const { loadUpNext } = require("../server/utils/traktUpNext");
const now = Date.parse("2026-10-26T12:00:00Z");
function entry(id, first_aired = "2020-01-01T00:00:00Z") {
    return {
        progress: {
            hidden: 0,
            last_watched_at: "2026-10-25T12:00:00Z",
            next_episode: { first_aired, number: 2, season: 1 },
        },
        show: { ids: { imdb: `tt${id}`, trakt: id }, title: `Show ${id}` },
    };
}
test("Continue Watching uses Trakt web's direct endpoint and excludes unaired, unknown-date and hidden episodes", async () => {
    const paths = [];
    const hidden = entry(4);
    hidden.progress.hidden = 1;
    const result = await loadUpNext(async (path) => {
        paths.push(path);
        return {
            data: [entry(1), entry(2, "2027-01-01T00:00:00Z"), entry(3, null), hidden],
            pages: 14,
        };
    }, now);
    assert.equal(result.length, 1);
    assert.equal(result[0].show.ids.trakt, 1);
    assert.equal(result[0].resume, false);
    assert.equal(paths.length, 1);
    assert.match(paths[0], /^\/sync\/progress\/up_next_nitro\?intent=continue&/);
    assert.ok(!paths.some((path) => path.includes("history") || path.startsWith("/shows/")));
});
test("progress pagination retains all titles beyond the former 12 and 24 item caps", async () => {
    const paths = [];
    const rows = await loadUpNext(async (path) => {
        paths.push(path);
        const page = Number(new URL(path, "https://example.test").searchParams.get("page"));
        return {
            data:
                page === 1
                    ? Array.from({ length: 100 }, (_, index) => entry(index + 1))
                    : [entry(101), entry(1)],
            pages: 2,
        };
    }, now);
    assert.equal(paths.length, 2);
    assert.equal(rows.length, 101);
});
test("missing or invalid summary data fails visibly rather than claiming an empty list", async () => {
    await assert.rejects(
        loadUpNext(async () => ({ data: null }), now),
        /unavailable/
    );
});
