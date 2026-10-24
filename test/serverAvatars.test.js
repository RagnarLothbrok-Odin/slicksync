// Profile pictures kept in step with people's servers
// (server/utils/serverAvatars.js refreshOne): when one changed on the server
// comes back here, and when a picture chosen here is left alone.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { refreshOne, AVATAR_DIR } = require("../server/utils/serverAvatars");

function serving(bytes) {
    const real = global.fetch;
    global.fetch = async () => ({
        arrayBuffer: async () => Buffer.from(bytes),
        headers: { get: () => "image/png" },
        ok: true,
    });
    return () => {
        global.fetch = real;
    };
}
const source = { kind: "jellyfin", serverUrl: "https://jf.example.com", token: "t", userId: "u1" };
const made = [];
const tidy = () => {
    for (const url of made) {
        try {
            fs.unlinkSync(path.join(AVATAR_DIR, url.split("/").pop()));
        } catch {
            // Cleanup is best effort when the resource is already unavailable.
        }
    }
};

test("no picture here: the server’s is taken", async () => {
    const restore = serving("one");
    try {
        const rec = await refreshOne(source, null, undefined);
        made.push(rec.url);
        assert.match(rec.url, /^\/uploads\/avatars\/[a-f0-9-]+\.png$/);
        assert.equal(rec.own, true);
    } finally {
        restore();
    }
});

test("in step: a picture changed on the server comes back here; an unchanged one is left", async () => {
    let restore = serving("one");
    let first;
    try {
        first = await refreshOne(source, null, undefined);
        made.push(first.url);
    } finally {
        restore();
    }
    restore = serving("one");
    try {
        assert.equal(
            (await refreshOne(source, first.url, first)).url,
            first.url,
            "same picture: nothing changes"
        );
    } finally {
        restore();
    }
    restore = serving("two");
    try {
        const next = await refreshOne(source, first.url, first);
        made.push(next.url);
        assert.notEqual(next.url, first.url);
        assert.equal(
            fs.existsSync(path.join(AVATAR_DIR, first.url.split("/").pop())),
            false,
            "the old copy made here is tidied away"
        );
    } finally {
        restore();
    }
});

test("sent from here: still in step, and the picture chosen here is never deleted", async () => {
    const chosen = "https://images.example.com/me.png";
    const restore = serving("server-copy");
    try {
        const sent = { hash: "older", url: chosen };
        const next = await refreshOne(source, chosen, sent);
        made.push(next.url);
        assert.notEqual(next.url, chosen, "a later change on the server comes back here");
    } finally {
        restore();
    }
});

test("chosen here and not sent: left alone", async () => {
    const restore = serving("anything");
    try {
        assert.equal(
            await refreshOne(source, "/uploads/avatars/mine.png", {
                hash: "x",
                url: "/uploads/avatars/other.png",
            }),
            null
        );
        assert.equal(
            await refreshOne(source, "https://images.example.com/me.png", undefined),
            null
        );
    } finally {
        restore();
        tidy();
    }
});

test("AIOStreams is never asked at /UserImage, which is its logo for everyone", async () => {
    const asked = [];
    const real = global.fetch;
    global.fetch = async (url) => {
        asked.push(String(url));
        return {
            arrayBuffer: async () => Buffer.alloc(0),
            headers: { get: () => "application/json" },
            json: async () => [],
            ok: false,
            status: 404,
            text: async () => "[]",
        };
    };
    try {
        const { pictureFor } = require("../server/utils/serverAvatars");
        await pictureFor({
            kind: "aiostreams",
            serverUrl: "https://aio.example.com/jellyfin",
            token: "t",
            userId: "u1",
        });
        assert.equal(
            asked.some((u) => u.includes("/UserImage")),
            false
        );
        assert.ok(asked.some((u) => u.includes("/Users/u1/Images/Primary")));
    } finally {
        global.fetch = real;
    }
});

test("just sent from here: nothing is taken back while the server may still show the old one", async () => {
    const restore = serving("old-one");
    try {
        const sent = {
            hash: "sent",
            sentAt: new Date().toISOString(),
            url: "/uploads/avatars/new.png",
        };
        assert.equal(await refreshOne(source, "/uploads/avatars/new.png", sent), sent);
    } finally {
        restore();
    }
});

test("the same picture tag as last time: nothing is downloaded", async () => {
    let downloads = 0;
    const real = global.fetch;
    global.fetch = async () => {
        downloads++;
        return {
            arrayBuffer: async () => Buffer.from("x"),
            headers: { get: () => "image/png" },
            ok: true,
        };
    };
    try {
        const taken = { hash: "h", tag: "abc", url: "/uploads/avatars/a.png" };
        const same = await refreshOne(source, taken.url, taken, { tagOf: async () => "abc" });
        assert.equal(same, taken);
        assert.equal(downloads, 0);
        const changed = await refreshOne(source, taken.url, taken, { tagOf: async () => "def" });
        made.push(changed.url);
        assert.ok(downloads > 0, "a new tag means a new picture to fetch");
        assert.equal(changed.tag, "def");
    } finally {
        global.fetch = real;
        tidy();
    }
});
