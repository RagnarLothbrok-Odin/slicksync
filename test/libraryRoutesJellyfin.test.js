// The library buttons (add/remove, delete, backup, view) used to ask "Stremio
// auth key, or a Nuvio sign-in?" by hand and selected only those columns, so
// they told every Jellyfin, AIOStreams and AIOMetadata person "User not
// connected to a provider". They now select PROVIDER_SELECT and ask
// isProviderConnected() (server/utils/providerInfo.js).
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const cacheDir = fs.mkdtempSync(path.join(os.tmpdir(), "slicksync-libcache-"));
process.env.LIBRARIES_CACHE_DIR = cacheDir;
const express = require("express");
const makeUsersRouter = require("../server/routes/users");

const ROWS = {
    aio: {
        accountId: "acc",
        email: "aio@example.com",
        id: "aio",
        isActive: true,
        jellyfinServerKind: "aiostreams",
        jellyfinServerUrl: "https://aio.example.com",
        jellyfinToken: "enc-token",
        jellyfinUserId: "u2",
        providerType: "jellyfin",
        username: "aio",
    },
    gone: {
        accountId: "acc",
        email: "gone@example.com",
        id: "gone",
        isActive: true,
        jellyfinServerKind: "jellyfin",
        jellyfinServerUrl: "https://jellyfin.example.com",
        jellyfinToken: null,
        jellyfinUserId: null,
        providerType: "jellyfin",
        username: "gone",
    },
    jf: {
        accountId: "acc",
        email: "someone@example.com",
        id: "jf",
        isActive: true,
        jellyfinServerKind: "jellyfin",
        jellyfinServerUrl: "https://jellyfin.example.com",
        jellyfinToken: "enc-token",
        jellyfinUserId: "u1",
        providerType: "jellyfin",
        username: "someone",
    },
};

// Returns only the selected columns, like Prisma - a route that forgets the
// Jellyfin columns gets a row without them, which is what the bug was.
const prisma = {
    user: {
        findFirst: async ({ where, select }) => {
            const row = ROWS[where.id];
            if (!row || where.accountId !== row.accountId) {
                return null;
            }
            if (!select) {
                return { ...row };
            }
            return Object.fromEntries(
                Object.keys(select)
                    .filter((k) => select[k])
                    .map((k) => [k, row[k]])
            );
        },
    },
};

const calls = [];
const library = [{ _id: "tt0000001", name: "A Film", removed: false, type: "movie" }];
// Stands in for providers/index.js: a Jellyfin provider needs the sign-in columns.
function createProvider(user) {
    if (user.providerType !== "jellyfin" || !user.jellyfinToken) {
        return null;
    }
    return {
        addLibraryItem: async (changes) => {
            calls.push(["add", user.id, changes.map((c) => c._id)]);
            return {};
        },
        getLibrary: async () => library.map((i) => ({ ...i })),
        removeLibraryItem: async (changes) => {
            calls.push(["remove", user.id, changes.map((c) => c._id)]);
            return {};
        },
        supportsLibraryWrite: true,
        type: "jellyfin",
    };
}

let base;
let server;
test.before(async () => {
    const app = express();
    app.use(express.json());
    app.use(
        "/users",
        makeUsersRouter({ createProvider, decrypt: (v) => v, getAccountId: () => "acc", prisma })
    );
    await new Promise((resolve) => {
        server = app.listen(0, "127.0.0.1", resolve);
    });
    base = `http://127.0.0.1:${server.address().port}/users`;
});
test.after(() => {
    server.close();
    fs.rmSync(cacheDir, { force: true, recursive: true });
});

for (const id of ["jf", "aio"]) {
    test(`${id}: add to library goes through the Jellyfin provider`, async () => {
        const res = await fetch(`${base}/${id}/library/toggle`, {
            body: JSON.stringify({
                items: [
                    {
                        addToLibrary: true,
                        itemId: "tt0000002",
                        itemName: "Another Film",
                        itemType: "movie",
                    },
                ],
            }),
            headers: { "content-type": "application/json" },
            method: "POST",
        });
        const body = await res.json();
        assert.equal(res.status, 200, JSON.stringify(body));
        assert.equal(body.successCount, 1);
        assert.deepEqual(calls.at(-1), ["add", id, ["tt0000002"]]);
    });

    test(`${id}: delete from library goes through the Jellyfin provider`, async () => {
        const res = await fetch(`${base}/${id}/library/tt0000001`, { method: "DELETE" });
        assert.equal(res.status, 200, await res.text());
        assert.deepEqual(calls.at(-1), ["remove", id, ["tt0000001"]]);
    });

    test(`${id}: library backup downloads the Jellyfin library`, async () => {
        const res = await fetch(`${base}/${id}/library/backup`);
        assert.equal(res.status, 200);
        assert.match(
            res.headers.get("content-disposition"),
            id === "aio" ? /AIOStreams-Library-/ : /Jellyfin-Library-/
        );
        assert.equal((await res.json())[0]._id, "tt0000001");
    });

    test(`${id}: library view loads`, async () => {
        const res = await fetch(`${base}/${id}/library`);
        assert.equal(res.status, 200, await res.text());
    });
}

test("a Jellyfin person with no sign-in is still told they are not connected", async () => {
    const toggle = await fetch(`${base}/gone/library/toggle`, {
        body: JSON.stringify({
            items: [{ addToLibrary: true, itemId: "tt0000002", itemType: "movie" }],
        }),
        headers: { "content-type": "application/json" },
        method: "POST",
    });
    assert.equal(toggle.status, 400);
    assert.equal((await toggle.json()).message, "User not connected to a provider");
    for (const url of [`${base}/gone/library/tt0000001`, `${base}/gone/library/backup`]) {
        const res = await fetch(url, { method: url.endsWith("backup") ? "GET" : "DELETE" });
        assert.equal(res.status, 400);
        assert.equal((await res.json()).error, "User not connected to a provider");
    }
});
