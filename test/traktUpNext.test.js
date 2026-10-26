const test = require("node:test");
const assert = require("node:assert/strict");
const { loadUpNext } = require("../server/utils/traktUpNext");
const show = (id) => ({ ids: { imdb: `tt${id}`, trakt: id }, title: `Show ${id}` });
test("next episodes use recent show summaries and respect hidden and completed shows", async () => {
    const calls = [];
    const rows = await loadUpNext(async (path) => {
        calls.push(path);
        if (path.startsWith("/sync/watched")) {
            return {
                data: [1, 2, 3].map((id) => ({
                    last_watched_at: "2026-10-26T12:00:00Z",
                    show: show(id),
                })),
            };
        }
        if (path.startsWith("/users/hidden")) {
            return { data: [{ show: show(1) }], pages: 1 };
        }
        if (path.startsWith("/shows/2/")) {
            return { data: { next_episode: null } };
        }
        return { data: { next_episode: { number: 4, season: 2, title: "Next episode" } } };
    });
    assert.equal(rows.length, 1);
    assert.equal(rows[0].show.ids.trakt, 3);
    assert.equal(rows[0].episode.number, 4);
    assert.equal(rows[0].resume, false);
    assert.ok(!calls.some((path) => path.includes("/shows/1/")));
    assert.ok(!calls.some((path) => path.includes("history")));
});
test("show progress work stays bounded even if a provider ignores the requested limit", async () => {
    let progressCalls = 0;
    await loadUpNext(async (path) => {
        if (path.startsWith("/sync/watched")) {
            return { data: Array.from({ length: 100 }, (_, index) => ({ show: show(index + 1) })) };
        }
        if (path.startsWith("/users/hidden")) {
            return { data: [], pages: 0 };
        }
        progressCalls++;
        return { data: { next_episode: null } };
    });
    assert.equal(progressCalls, 24);
});
