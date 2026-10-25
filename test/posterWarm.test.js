// Poster pre-warming (server/utils/posterWarm.js): the page being answered
// goes ahead of the background timer's hundreds.
const test = require("node:test");
const assert = require("node:assert/strict");

const done = [];
const corePath = require.resolve("../server/utils/imageCacheCore");
require.cache[corePath] = {
    exports: {
        warm: (url, w) => {
            done.push(`${url}|${w}`);
            return new Promise((r) => setTimeout(r, 5));
        },
    },
    filename: corePath,
    id: corePath,
    loaded: true,
};
const { warmPosters } = require("../server/utils/posterWarm");

test("a page being answered goes ahead of the background lane, its common size first", async () => {
    const bg = Array.from({ length: 50 }, (_, i) => `https://img.example/bg${i}.jpg`);
    warmPosters(bg);
    warmPosters(["https://img.example/bg40.jpg", "https://img.example/page1.jpg"], {
        urgent: true,
        widths: [342, 185],
    });
    await new Promise((r) => setTimeout(r, 120));
    const firstUrgent = done.indexOf("https://img.example/page1.jpg|342");
    assert.ok(firstUrgent >= 0 && firstUrgent < 6, `page poster ran early (at ${firstUrgent})`);
    assert.ok(
        done.indexOf("https://img.example/bg40.jpg|342") < 6,
        "a background poster on the page was moved up"
    );
    assert.ok(
        done.indexOf("https://img.example/page1.jpg|342") <
            done.indexOf("https://img.example/page1.jpg|185")
    );
    assert.equal(
        done.filter((k) => k === "https://img.example/bg40.jpg|342").length,
        1,
        "never done twice"
    );
});
