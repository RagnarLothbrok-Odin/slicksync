// The person's own portal (/api/public-library) trusts a credential the caller
// holds: their Stremio key, or the session token a Nuvio or Jellyfin sign-in
// handed back. These pin that a credential only ever speaks for the person it
// belongs to - not for anyone whose id the caller happens to know - for every
// provider, that the key travels in a header or body and never the address,
// and that an addon address is held to the install's rule.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const dns = require("node:dns").promises;
const jwt = require("jsonwebtoken");

process.env.SHARES_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "slicksync-shares-"));

// A Stremio key is "key-for-<email>" here; the real call goes to Stremio.
const stremio = require("../server/utils/stremio");
stremio.validateStremioAuthKey = async (key) => {
    const m = /^key-for-(.+)$/.exec(String(key));
    if (!m) {
        const e = new Error("Invalid or expired Stremio auth key");
        e.code = 1;
        throw e;
    }
    return { addons: [], user: { email: m[1] } };
};

const express = require("express");
const config = require("../server/utils/config");
const makePublicLibraryRouter = require("../server/routes/publicLibrary");

const SECRET = "portal-identity-test-secret";
const realFetch = global.fetch;
const configuredType = config.INSTANCE_TYPE;

function match(row, where = {}) {
    return Object.entries(where).every(([key, want]) => {
        if (key === "OR") {
            return want.some((w) => match(row, w));
        }
        if (want && typeof want === "object" && !(want instanceof Date)) {
            if ("in" in want) {
                return want.in.includes(row[key]);
            }
            if ("contains" in want) {
                return String(row[key] ?? "").includes(want.contains);
            }
        }
        return row[key] === want;
    });
}
// Like Prisma: only the selected columns come back.
const pick = (row, select) =>
    select
        ? Object.fromEntries(
              Object.keys(select)
                  .filter((k) => select[k])
                  .map((k) => [k, row[k]])
          )
        : { ...row };
function table(rows) {
    return {
        findFirst: async ({ where, select } = {}) => {
            const r = rows.find((x) => match(x, where));
            return r ? pick(r, select) : null;
        },
        findMany: async ({ where, select } = {}) =>
            rows.filter((x) => match(x, where)).map((r) => pick(r, select)),
        findUnique: async ({ where, select } = {}) => {
            const r = rows.find((x) => match(x, where));
            return r ? pick(r, select) : null;
        },
        rows,
        update: async ({ where, data, select }) => {
            const r = rows.find((x) => match(x, where));
            Object.assign(r, data);
            return pick(r, select);
        },
    };
}

const person = (id, accountId, extra) => ({
    accountId,
    activityVisibility: "private",
    apiKey: null,
    colorIndex: 0,
    createdAt: new Date("2026-01-01"),
    discordWebhookUrl: null,
    email: `${id}@example.com`,
    expiresAt: null,
    id,
    isActive: true,
    notifyOnWatch: true,
    nuvioRefreshToken: null,
    nuvioUserId: null,
    protectedAddons: null,
    providerConnectionErrorAt: null,
    providerType: "stremio",
    publicStatsEnabled: false,
    publicStatsSlug: null,
    stremioAuthKey: null,
    username: id,
    ...extra,
});

function makeData() {
    return {
        episodeWatchHistory: table([]),
        group: table([
            {
                accountId: "acc1",
                id: "g1",
                isActive: true,
                userIds: JSON.stringify(["sA", "sB", "nA", "jA", "jB"]),
            },
            {
                accountId: "acc2",
                id: "g2",
                isActive: true,
                userIds: JSON.stringify(["sA2", "sC", "nA2"]),
            },
        ]),
        movieWatchHistory: table([]),
        personalTitleState: table([]),
        user: table([
            // Household 1: two Stremio people and a Nuvio and two Jellyfin ones.
            person("sA", "acc1", {
                email: "a@example.com",
                stremioAuthKey: "key-for-a@example.com",
            }),
            person("sB", "acc1", {
                apiKey: "sealed-key-of-b",
                discordWebhookUrl: "https://discord.example.com/api/webhooks/1/secret",
                email: "b@example.com",
                stremioAuthKey: "key-for-b@example.com",
            }),
            person("nA", "acc1", {
                nuvioRefreshToken: "refresh-1",
                nuvioUserId: "nuvio-1",
                providerType: "nuvio",
            }),
            person("jA", "acc1", { providerType: "jellyfin" }),
            person("jB", "acc1", { providerType: "jellyfin" }),
            // Household 2 holds the same Stremio account and the same Nuvio account as sA and nA.
            person("sA2", "acc2", {
                email: "a@example.com",
                stremioAuthKey: "key-for-a@example.com",
            }),
            person("sC", "acc2", { email: "c@example.com" }),
            person("nA2", "acc2", {
                nuvioRefreshToken: "refresh-1",
                nuvioUserId: "nuvio-1",
                providerType: "nuvio",
            }),
        ]),
        watchActivity: table([]),
        watchlistItem: table([]),
    };
}

let server;
let base;
let data;
const originalFetch = realFetch;

test.before(async () => {
    data = makeData();
    const app = express();
    app.use(express.json());
    app.use(
        "/api/public-library",
        makePublicLibraryRouter({
            DEFAULT_ACCOUNT_ID: "default",
            decrypt: (v) => v,
            encrypt: (v) => v,
            getCachedLibrary: () => [],
            JWT_SECRET: SECRET,
            prisma: data,
            setCachedLibrary: () => undefined,
        })
    );
    await new Promise((resolve) => {
        server = app.listen(0, "127.0.0.1", resolve);
    });
    base = `http://127.0.0.1:${server.address().port}/api/public-library`;
});
test.after(() => {
    server.close();
    fs.rmSync(process.env.SHARES_DIR, { force: true, recursive: true });
});

const session = (id, provider) => jwt.sign({ provider, sub: id }, SECRET, { expiresIn: "1h" });
const stremioKey = (email) => `key-for-${email}`;

async function call(method, route, { key, body, query } = {}) {
    const res = await realFetch(`${base}${route}${query ? `?${new URLSearchParams(query)}` : ""}`, {
        body: body ? JSON.stringify(body) : undefined,
        headers: { "content-type": "application/json", ...(key ? { "x-stremio-auth": key } : {}) },
        method,
    });
    let json = null;
    try {
        json = await res.json();
    } catch {
        // Optional remote data does not prevent the current operation from completing.
    }
    return { body: json, status: res.status };
}

// Everything a person's own page asks the server, as [method, route, how to put the person's id].
const BY_ID_ROUTES = [
    ["GET", "/user-info"],
    ["GET", "/user-api-key"],
    ["POST", "/user-api-key"],
    ["GET", "/user-api-key-status"],
    ["GET", "/activity"],
    ["GET", "/export"],
    ["GET", "/shares"],
    ["GET", "/group-members"],
];
const asking = (method, userId) =>
    method === "GET" ? { query: { userId } } : { body: { userId } };

test("a Stremio key opens none of the eight pages of a different person", async () => {
    const before = JSON.stringify(data.user.rows.find((u) => u.id === "sB"));
    // sA's own key, asking about sB - who is in the same household and whose id is
    // visible in the group list.
    for (const [method, route] of BY_ID_ROUTES) {
        const res = await call(method, route, {
            key: stremioKey("a@example.com"),
            ...asking(method, "sB"),
        });
        assert.equal(res.status, 401, `${method} ${route}`);
        assert.equal(res.body?.apiKey, undefined, `${method} ${route} must not hand back a key`);
        assert.equal(
            res.body?.discordWebhookUrl,
            undefined,
            `${method} ${route} must not hand back a webhook`
        );
    }
    assert.equal(
        JSON.stringify(data.user.rows.find((u) => u.id === "sB")),
        before,
        "the other person was not changed"
    );
});

test("the same key still opens its own person", async () => {
    const key = stremioKey("a@example.com");
    const info = await call("GET", "/user-info", { key, query: { userId: "sA" } });
    assert.equal(info.status, 200);
    assert.equal(info.body.id, "sA");
    assert.equal(
        (await call("GET", "/user-api-key-status", { key, query: { userId: "sA" } })).status,
        200
    );
    assert.deepEqual(
        (await call("GET", "/group-members", { key, query: { userId: "sA" } })).body.members
            .map((m) => m.id)
            .sort(),
        ["jA", "jB", "nA", "sB"]
    );
    assert.equal((await call("GET", "/export", { key, query: { userId: "sA" } })).status, 200);
});

test("someone in another household holding the same Stremio account reaches their own page", async () => {
    const key = stremioKey("a@example.com");
    // sA2 is second in the table; a bare search by email finds sA first.
    const info = await call("GET", "/user-info", { key, query: { userId: "sA2" } });
    assert.equal(info.status, 200);
    assert.equal(info.body.id, "sA2");
    const changed = await call("PATCH", "/activity-visibility", {
        body: { activityVisibility: "public", userId: "sA2" },
        key,
    });
    assert.equal(changed.status, 200);
    assert.equal(data.user.rows.find((u) => u.id === "sA2").activityVisibility, "public");
    assert.equal(
        data.user.rows.find((u) => u.id === "sA").activityVisibility,
        "private",
        "the other household was left alone"
    );
    assert.equal(
        (await call("POST", "/validate", { body: { authKey: key, userId: "sA2" } })).status,
        200
    );
});

test("a Nuvio session token speaks only for its own person, even when the Nuvio account is shared", async () => {
    // nA's token cannot open nA2, whose Nuvio account is the same one.
    assert.equal(
        (await call("GET", "/user-info", { key: session("nA", "nuvio"), query: { userId: "nA2" } }))
            .status,
        401
    );
    assert.equal(
        (
            await call("GET", "/user-info", {
                key: session("nA2", "nuvio"),
                query: { userId: "nA2" },
            })
        ).status,
        200
    );
    const changed = await call("PATCH", "/activity-visibility", {
        body: { activityVisibility: "public", userId: "nA2" },
        key: session("nA2", "nuvio"),
    });
    assert.equal(changed.status, 200);
    assert.equal(data.user.rows.find((u) => u.id === "nA2").activityVisibility, "public");
    assert.equal(data.user.rows.find((u) => u.id === "nA").activityVisibility, "private");
    // A Stremio key is no use against a Nuvio person, nor a Nuvio token against a Stremio one.
    assert.equal(
        (
            await call("GET", "/user-info", {
                key: stremioKey("a@example.com"),
                query: { userId: "nA" },
            })
        ).status,
        401
    );
    assert.equal(
        (await call("GET", "/user-info", { key: session("nA", "nuvio"), query: { userId: "sA" } }))
            .status,
        401
    );
});

test("a Jellyfin session token speaks only for its own person", async () => {
    assert.equal(
        (
            await call("GET", "/user-info", {
                key: session("jA", "jellyfin"),
                query: { userId: "jB" },
            })
        ).status,
        401
    );
    assert.equal(
        (
            await call("GET", "/user-api-key", {
                key: session("jA", "jellyfin"),
                query: { userId: "jB" },
            })
        ).status,
        401
    );
    assert.equal(
        (
            await call("GET", "/user-info", {
                key: session("jA", "jellyfin"),
                query: { userId: "jA" },
            })
        ).status,
        200
    );
});

test("a request with no credential is refused", async () => {
    for (const [method, route] of BY_ID_ROUTES) {
        assert.equal(
            (await call(method, route, asking(method, "sA"))).status,
            401,
            `${method} ${route}`
        );
    }
});

test("the key is read from the header or a body, never the address", async () => {
    const key = stremioKey("a@example.com");
    const inAddress = await call("GET", "/user-api-key-status", {
        query: { authKey: key, userId: "sA" },
    });
    assert.equal(inAddress.status, 401);
    const inHeader = await call("GET", "/user-api-key-status", { key, query: { userId: "sA" } });
    assert.equal(inHeader.status, 200);
    assert.equal(inHeader.body.hasKey, false);
    // A call that has a body can still carry it there (the sign-in and the page's own key requests do).
    assert.equal(
        (await call("POST", "/validate", { body: { authKey: key, userId: "sA" } })).status,
        200
    );
    assert.equal(
        (
            await call("PATCH", "/activity-visibility", {
                body: { activityVisibility: "private", authKey: key, userId: "sA" },
            })
        ).status,
        200
    );
    // The address is no way in for a Nuvio or Jellyfin token either.
    assert.equal(
        (
            await call("GET", "/user-info", {
                query: { authKey: session("jA", "jellyfin"), userId: "jA" },
            })
        ).status,
        401
    );
    assert.equal(
        (
            await call("GET", "/user-info", {
                query: { authKey: session("nA", "nuvio"), userId: "nA" },
            })
        ).status,
        401
    );
});

// ---- the person's API key ------------------------------------------------

const storedKey = (id) => data.user.rows.find((u) => u.id === id).apiKey;

test("the API key: asking for one again hands back the one they have, and only rotate replaces it", async () => {
    const key = stremioKey("a@example.com");
    const first = await call("POST", "/user-api-key", { body: { userId: "sA" }, key });
    assert.equal(first.status, 200);
    assert.match(first.body.apiKey, /^[a-f0-9]{32}$/);
    const stored = storedKey("sA");
    assert.ok(stored && !stored.includes(first.body.apiKey), "kept sealed, not as typed");

    // A page that could not find a key to show asks again; whatever they use the key for keeps working.
    for (const extra of [{}, { rotate: false }, { rotate: "true" }]) {
        const again = await call("POST", "/user-api-key", {
            body: { userId: "sA", ...extra },
            key,
        });
        assert.equal(again.status, 200);
        assert.equal(again.body.apiKey, first.body.apiKey, JSON.stringify(extra));
        assert.equal(storedKey("sA"), stored, "nothing was rewritten");
    }
    assert.deepEqual((await call("GET", "/user-api-key", { key, query: { userId: "sA" } })).body, {
        apiKey: first.body.apiKey,
        hasKey: true,
    });

    // Rotate is the person asking for a new one.
    const rotated = await call("POST", "/user-api-key", {
        body: { rotate: true, userId: "sA" },
        key,
    });
    assert.equal(rotated.status, 200);
    assert.match(rotated.body.apiKey, /^[a-f0-9]{32}$/);
    assert.notEqual(rotated.body.apiKey, first.body.apiKey);
    assert.deepEqual((await call("GET", "/user-api-key", { key, query: { userId: "sA" } })).body, {
        apiKey: rotated.body.apiKey,
        hasKey: true,
    });
});

test("the API key: one that can no longer be read counts as none, so asking makes a new one", async (t) => {
    t.mock.method(console, "error", () => undefined);
    // sB holds a value that is not a key this server sealed.
    assert.equal(storedKey("sB"), "sealed-key-of-b");
    assert.deepEqual(
        (
            await call("GET", "/user-api-key", {
                key: stremioKey("b@example.com"),
                query: { userId: "sB" },
            })
        ).body,
        { apiKey: null, hasKey: false }
    );
    const made = await call("POST", "/user-api-key", {
        body: { userId: "sB" },
        key: stremioKey("b@example.com"),
    });
    assert.equal(made.status, 200);
    assert.match(made.body.apiKey, /^[a-f0-9]{32}$/);
    assert.deepEqual(
        (
            await call("GET", "/user-api-key", {
                key: stremioKey("b@example.com"),
                query: { userId: "sB" },
            })
        ).body,
        { apiKey: made.body.apiKey, hasKey: true }
    );
});

test("the API key: a different person's credential gets neither the key nor a new one", async () => {
    const before = storedKey("sA");
    const refused = await call("POST", "/user-api-key", {
        body: { rotate: true, userId: "sA" },
        key: stremioKey("c@example.com"),
    });
    assert.equal(refused.status, 401);
    assert.equal(refused.body.apiKey, undefined);
    assert.equal(storedKey("sA"), before);
});

// ---- the addon address -------------------------------------------------

// Names in these tests resolve to whatever the test says, never the network.
function resolveTo(t, table) {
    const original = dns.lookup;
    dns.lookup = async (host) => {
        if (!(host in table)) {
            const e = new Error(`getaddrinfo ENOTFOUND ${host}`);
            e.code = "ENOTFOUND";
            throw e;
        }
        return table[host].map((address) => ({ address, family: address.includes(":") ? 6 : 4 }));
    };
    t.after(() => {
        dns.lookup = original;
    });
}

function stubFetch(t, handler) {
    const calls = [];
    global.fetch = (url, init) => {
        if (String(url).startsWith(base)) {
            return realFetch(url, init);
        }
        calls.push(String(url));
        return Promise.resolve(handler(String(url), init));
    };
    t.after(() => {
        global.fetch = originalFetch;
    });
    return calls;
}

function instanceType(t, type) {
    config.INSTANCE_TYPE = type;
    t.after(() => {
        config.INSTANCE_TYPE = configuredType;
    });
}

const REFUSED = "That addon address can’t be used";
const addAddon = (userId, addonUrl, extra = {}) =>
    call("POST", "/add-addon", {
        body: { addonUrl, userId, ...extra },
        key: session(userId, userId.startsWith("j") ? "jellyfin" : "nuvio"),
    });

test("add-addon: an instance serving strangers refuses every internal address", async (t) => {
    instanceType(t, "public");
    resolveTo(t, { "addon.example.com": ["93.184.216.34"], aiostreams: ["172.18.0.5"] });
    for (const url of [
        "http://192.168.1.10:7000/manifest.json",
        "http://127.0.0.1:11470/manifest.json",
        "http://aiostreams:3000/manifest.json",
        "http://169.254.169.254/latest/meta-data/",
        "stremio://192.168.1.10:7000/manifest.json",
    ]) {
        const res = await addAddon("jA", url);
        assert.equal(res.status, 400, url);
        assert.equal(res.body.message, REFUSED, url);
    }
    // A public address gets past the check (this person's server has no addon list, which is the next thing asked).
    assert.equal(
        (await addAddon("jA", "https://addon.example.com/manifest.json")).body.error,
        "NOT_SUPPORTED"
    );
});

test("add-addon: a household install reaches its own network but never the link-local range", async (t) => {
    instanceType(t, "private");
    resolveTo(t, { aiostreams: ["172.18.0.5"] });
    for (const url of [
        "http://192.168.1.10:7000/manifest.json",
        "http://127.0.0.1:11470/manifest.json",
        "http://aiostreams:3000/manifest.json",
    ]) {
        assert.equal((await addAddon("jA", url)).body.error, "NOT_SUPPORTED", url);
    }
    for (const url of [
        "http://169.254.169.254/latest/meta-data/",
        "http://[fe80::1]/manifest.json",
        "stremio://169.254.169.254/manifest.json",
    ]) {
        const res = await addAddon("jA", url);
        assert.equal(res.status, 400, url);
        assert.equal(res.body.message, REFUSED, url);
    }
});

test("add-addon: a name only the browser knows is let through on a household install when the page already read the manifest", async (t) => {
    instanceType(t, "private");
    resolveTo(t, {});
    const manifest = {
        id: "org.example.addon",
        name: "Example Addon",
        resources: ["catalog"],
        version: "1.0.0",
    };
    assert.equal(
        (await addAddon("jA", "http://nas.local:7000/manifest.json", { manifestData: manifest }))
            .body.error,
        "NOT_SUPPORTED"
    );
    // Nothing was handed over, so this server would be the one to fetch it, and it cannot.
    assert.equal(
        (await addAddon("jA", "http://nas.local:7000/manifest.json")).body.message,
        REFUSED
    );
    instanceType(t, "public");
    assert.equal(
        (await addAddon("jA", "http://nas.local:7000/manifest.json", { manifestData: manifest }))
            .body.message,
        REFUSED
    );
});

for (const type of ["public", "private"]) {
    test(`add-addon (${type}): the manifest is fetched from the rewritten address and a redirect inward is refused`, async (t) => {
        instanceType(t, type);
        resolveTo(t, { "addon.example.com": ["93.184.216.34"] });
        const calls = stubFetch(t, (url) =>
            url.startsWith("https://addon.example.com/")
                ? new Response(null, {
                      headers: { location: "http://169.254.169.254/latest/meta-data/" },
                      status: 302,
                  })
                : new Response("{}", { status: 200 })
        );
        const res = await addAddon("nA", "stremio://addon.example.com/manifest.json");
        assert.equal(res.status, 400);
        assert.equal(res.body.message, REFUSED);
        // The first (and only) request went to the address that was checked, as https, and nothing followed the redirect.
        assert.deepEqual(calls, ["https://addon.example.com/manifest.json"]);
    });
}

test("an authenticated person can read their own profile before joining a group", async () => {
    const person = data.user.rows.find((row) => row.id === "jA");
    const previous = person.accountId;
    person.accountId = "household-without-groups";
    try {
        const response = await call("GET", "/user-info", {
            key: session("jA", "jellyfin"),
            query: { userId: "jA" },
        });
        assert.equal(response.status, 200);
    } finally {
        person.accountId = previous;
    }
});

test("own profile reports exact group membership, including a solo member", async () => {
    const group = data.group.rows[0];
    const previous = group.userIds;
    group.name = "Household";
    group.userIds = JSON.stringify(["jA"]);
    try {
        const response = await call("GET", "/user-info", {
            key: session("jA", "jellyfin"),
            query: { userId: "jA" },
        });
        assert.equal(response.status, 200);
        assert.deepEqual(response.body.groups, [{ id: group.id, name: "Household" }]);
        assert.equal(response.body.groupName, "Household");
    } finally {
        group.userIds = previous;
    }
});

test("Nuvio profile selection stays within the authenticated login and household", async () => {
    const sibling = person("nSibling", "acc1", {
        nuvioProfileId: 2,
        nuvioRefreshToken: "refresh-1",
        nuvioUserId: "nuvio-1",
        providerType: "nuvio",
    });
    const unrelated = person("nOther", "acc1", {
        nuvioRefreshToken: "refresh-other",
        nuvioUserId: "nuvio-other",
        providerType: "nuvio",
    });
    data.user.rows.push(sibling, unrelated);
    const group = data.group.rows.find((row) => row.id === "g1");
    const previousMembers = group.userIds;
    group.userIds = JSON.stringify([...JSON.parse(group.userIds), sibling.id]);
    try {
        const key = session("nA", "nuvio");
        const listing = await call("GET", "/profiles", { key, query: { userId: "nA" } });
        assert.equal(listing.status, 200);
        assert.deepEqual(listing.body.profiles.map((profile) => profile.id).sort(), [
            "nA",
            "nSibling",
        ]);
        assert.equal(listing.body.profiles[0].nuvioRefreshToken, undefined);
        for (const targetId of ["nA2", "nOther", "sA"]) {
            assert.equal(
                (await call("POST", "/switch-profile", { body: { targetId, userId: "nA" }, key }))
                    .status,
                404
            );
        }
        assert.equal(
            (
                await call("GET", "/profiles", {
                    key: session("nA2", "nuvio"),
                    query: { userId: "nA" },
                })
            ).status,
            401
        );
        const switched = await call("POST", "/switch-profile", {
            body: { targetId: "nSibling", userId: "nA" },
            key,
        });
        assert.equal(switched.status, 200);
        assert.equal(jwt.verify(switched.body.sessionToken, SECRET).sub, "nSibling");
        assert.equal(
            (await call("GET", "/user-info", { key, query: { userId: "nSibling" } })).status,
            401
        );
        assert.equal(
            (
                await call("GET", "/user-info", {
                    key: switched.body.sessionToken,
                    query: { userId: "nSibling" },
                })
            ).status,
            200
        );
    } finally {
        group.userIds = previousMembers;
        for (const id of ["nSibling", "nOther"]) {
            data.user.rows.splice(
                data.user.rows.findIndex((row) => row.id === id),
                1
            );
        }
    }
});

test("rapid Nuvio session restoration never consumes a provider refresh token", async () => {
    const before = data.user.rows.find((row) => row.id === "nA").nuvioRefreshToken;
    const previousFetch = global.fetch;
    let providerCalls = 0;
    global.fetch = async () => {
        providerCalls++;
        throw new Error("Provider unavailable");
    };
    try {
        const key = session("nA", "nuvio");
        const results = await Promise.all(
            Array.from({ length: 4 }, () =>
                call("POST", "/validate-nuvio", { body: { userId: "nA" }, key })
            )
        );
        for (const result of results) {
            assert.equal(result.status, 200);
            assert.equal(result.body.valid, true);
            assert.equal(jwt.verify(result.body.sessionToken, SECRET).sub, "nA");
        }
        assert.equal(providerCalls, 0);
        assert.equal(data.user.rows.find((row) => row.id === "nA").nuvioRefreshToken, before);
        assert.equal(
            (await call("POST", "/validate-nuvio", { body: { userId: "nA" }, key: "invalid" }))
                .status,
            401
        );
    } finally {
        global.fetch = previousFetch;
    }
});
