// Addresses someone typed in that the server fetches once they are saved: a
// catalog shared by another SlickSync, an AIOStreams or AIOMetadata
// configuration, a LumiereDB, a profile picture. An address checked once and
// then fetched with redirects followed is only checked at its first hop, so on
// an instance serving strangers the fetch itself holds every hop to the same
// rule (utils/safeUrl.js); a household install is fetched exactly as before.
// And SlickTrax's own address is only ever read from this server when it
// really is a path of this server's /trax/.
const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const dns = require("node:dns").promises;
const config = require("../server/utils/config");

const realFetch = global.fetch;
const configuredType = config.INSTANCE_TYPE;
function instanceType(t, type) {
    config.INSTANCE_TYPE = type;
    t.after(() => {
        config.INSTANCE_TYPE = configuredType;
    });
}

// Names resolve to whatever the test says, never the network.
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

function listen(t, handler) {
    const seen = [];
    return new Promise((resolve) => {
        const server = http.createServer((req, res) => {
            seen.push({ method: req.method, url: req.url });
            handler(req, res);
        });
        server.listen(0, "127.0.0.1", () => {
            t.after(
                () =>
                    new Promise((done) => {
                        server.closeAllConnections?.();
                        server.close(done);
                    })
            );
            resolve({ seen, url: `http://127.0.0.1:${server.address().port}` });
        });
    });
}

// Replaces the server's outgoing fetch for this test.
function stubFetch(t, handler) {
    const calls = [];
    global.fetch = (url, init) => {
        calls.push(String(url));
        return Promise.resolve(handler(String(url), init));
    };
    t.after(() => {
        global.fetch = realFetch;
    });
    return calls;
}

const redirect = (location, status = 302) => new Response(null, { headers: { location }, status });
const json = (body) => Response.json(body, { headers: { "content-type": "application/json" } });

// ---- another SlickSync's shared catalog ------------------------------------

const { importFromSlickSync } = require("../server/utils/listImport");
const CANNOT_USE = /That address cannot be used from this server/;
const catalog = {
    federation: 1,
    itemCount: 2,
    items: [
        { id: "tt0000001", name: "A Film", type: "movie", year: 1999 },
        { id: "tt0000002", name: "A Show", type: "series" },
    ],
    name: "Weekend Films",
};

test("a shared catalog on an instance serving strangers: an address on its own network is not fetched", async (t) => {
    instanceType(t, "public");
    resolveTo(t, { "other.example": ["93.184.216.34"] });
    const internal = await listen(t, (_req, res) => {
        res.end(JSON.stringify(catalog));
    });
    for (const url of [
        `${internal.url}/api/federation/catalog/abc?key=k`,
        "http://169.254.169.254/api/federation/catalog/abc",
        "http://192.168.1.20:4000/api/federation/catalog/abc?key=k",
    ]) {
        await assert.rejects(importFromSlickSync(url), CANNOT_USE, url);
    }
    assert.equal(internal.seen.length, 0);

    // A public instance that sends the server somewhere internal is not followed.
    const calls = stubFetch(t, () => redirect("http://10.0.0.5:4000/api/federation/catalog/abc"));
    await assert.rejects(
        importFromSlickSync("https://other.example/api/federation/catalog/abc?key=k"),
        CANNOT_USE
    );
    assert.deepEqual(calls, ["https://other.example/api/federation/catalog/abc?key=k"]);
});

test("a shared catalog: a public instance is read, redirects included", async (t) => {
    instanceType(t, "public");
    resolveTo(t, { "other.example": ["93.184.216.34"], "www.other.example": ["93.184.216.35"] });
    const calls = stubFetch(t, (url) =>
        url.startsWith("http://other.example")
            ? redirect("https://www.other.example/api/federation/catalog/abc?key=k", 301)
            : json(catalog)
    );
    const result = await importFromSlickSync(
        "http://other.example/api/federation/catalog/abc?key=k"
    );
    assert.deepEqual(
        result.items.map((i) => i.id),
        ["tt0000001", "tt0000002"]
    );
    assert.equal(result.name, "Weekend Films");
    assert.deepEqual(calls, [
        "http://other.example/api/federation/catalog/abc?key=k",
        "https://www.other.example/api/federation/catalog/abc?key=k",
    ]);
});

test("a shared catalog on a household install: another SlickSync on its network works, link-local does not, the old messages are unchanged", async (t) => {
    instanceType(t, "private");
    const other = await listen(t, (req, res) => {
        if (req.url.startsWith("/api/federation/catalog/gone")) {
            res.writeHead(404);
            return res.end();
        }
        if (req.url.startsWith("/api/federation/catalog/broken")) {
            res.writeHead(200);
            return res.end("not json");
        }
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify(catalog));
    });
    const result = await importFromSlickSync(`${other.url}/api/federation/catalog/abc?key=k`);
    assert.equal(result.items.length, 2);
    await assert.rejects(
        importFromSlickSync(`${other.url}/api/federation/catalog/gone?key=k`),
        /That share link is no longer valid/
    );
    await assert.rejects(
        importFromSlickSync(`${other.url}/api/federation/catalog/broken?key=k`),
        /did not return a SlickSync catalog/
    );
    await assert.rejects(
        importFromSlickSync("http://169.254.169.254/api/federation/catalog/abc"),
        CANNOT_USE
    );
    resolveTo(t, {});
    await assert.rejects(
        importFromSlickSync("https://gone.example/api/federation/catalog/abc"),
        /Could not reach that instance/
    );
});

// ---- AIOStreams and AIOMetadata configurations --------------------------------

const aioConfig = require("../server/utils/aiostreamsConfig");
const aioMetadata = require("../server/utils/aiometadataHousehold");
const aioHealth = require("../server/utils/aioHealth");
const SENT_AWAY_AIOSTREAMS = "AIOStreams sent this server to an address it does not connect to";

const configBody = { data: { userData: { presets: [] } }, success: true };

test("reading an AIOStreams configuration on an instance serving strangers: a redirect to an internal address is not followed", async (t) => {
    instanceType(t, "public");
    resolveTo(t, { "aio.example": ["93.184.216.34"] });
    const calls = stubFetch(t, () => redirect("http://169.254.169.254/latest/meta-data/"));
    await assert.rejects(
        aioConfig.readConfig({
            account: "cfg-uuid",
            password: "example-password",
            serverUrl: "https://aio.example/jellyfin",
        }),
        (e) => e.status === 502 && e.message === SENT_AWAY_AIOSTREAMS
    );
    assert.deepEqual(calls, ["https://aio.example/api/v1/user?raw=true"]);
});

test("saving an AIOStreams configuration: the whole configuration is not replayed to an internal address", async (t) => {
    instanceType(t, "public");
    resolveTo(t, { "aio.example": ["93.184.216.34"] });
    const bodies = [];
    const calls = stubFetch(t, (_url, init) => {
        bodies.push(init.body);
        return redirect("http://10.0.0.5:3000/api/v1/user", 307);
    });
    await assert.rejects(
        aioConfig.writeConfig(
            {
                account: "cfg-uuid",
                password: "example-password",
                serverUrl: "https://aio.example/jellyfin",
            },
            { presets: [] }
        ),
        (e) => e.status === 502 && e.message === SENT_AWAY_AIOSTREAMS
    );
    assert.deepEqual(calls, ["https://aio.example/api/v1/user"]);
    assert.equal(bodies.length, 1);
});

test("an AIOStreams configuration on a public host behind an ordinary redirect is read, and saved with the same body", async (t) => {
    instanceType(t, "public");
    resolveTo(t, { "aio.example": ["93.184.216.34"] });
    const sent = [];
    const calls = stubFetch(t, (url, init) => {
        if (url.startsWith("http://aio.example")) {
            return redirect(url.replace("http://", "https://"), 301);
        }
        sent.push({
            auth: new Headers(init.headers).get("authorization"),
            body: init.body,
            method: init.method,
        });
        return json(configBody);
    });
    const read = await aioConfig.readConfig({
        account: "cfg-uuid",
        password: "example-password",
        serverUrl: "http://aio.example/jellyfin",
    });
    assert.deepEqual(read, { presets: [] });
    await aioConfig.writeConfig(
        {
            account: "cfg-uuid",
            password: "example-password",
            serverUrl: "https://aio.example/jellyfin",
        },
        { presets: [{ id: "one" }] }
    );
    assert.deepEqual(calls, [
        "http://aio.example/api/v1/user?raw=true",
        "https://aio.example/api/v1/user?raw=true",
        "https://aio.example/api/v1/user",
    ]);
    assert.equal(sent[1].method, "PUT");
    assert.equal(sent[1].body, JSON.stringify({ config: { presets: [{ id: "one" }] } }));
    assert.equal(
        sent[1].auth,
        `Basic ${Buffer.from("cfg-uuid:example-password").toString("base64")}`
    );
});

test("an AIOStreams configuration on a household install is fetched as it always was: redirects followed by the runtime", async (t) => {
    instanceType(t, "private");
    const aio = await listen(t, (req, res) => {
        if (req.url.startsWith("/api/v1/user?raw=true")) {
            res.writeHead(302, { location: "/api/v1/user-moved" });
            return res.end();
        }
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify(configBody));
    });
    const read = await aioConfig.readConfig({
        account: "cfg-uuid",
        password: "example-password",
        serverUrl: `${aio.url}/jellyfin`,
    });
    assert.deepEqual(read, { presets: [] });
    assert.deepEqual(
        aio.seen.map((s) => s.url),
        ["/api/v1/user?raw=true", "/api/v1/user-moved"]
    );
});

test("AIOStreams health on an instance serving strangers: nothing internal is asked, an ordinary redirect is followed", async (t) => {
    instanceType(t, "public");
    resolveTo(t, { "aio.example": ["93.184.216.34"] });
    const person = {
        accountId: "acc",
        aioConfigId: "cfg-uuid",
        aioConfigPassword: "enc",
        id: "p1",
        jellyfinServerKind: "aiostreams",
        jellyfinServerUrl: "https://aio.example/jellyfin/u/family",
        providerType: "jellyfin",
        username: "Sam",
    };
    const prisma = {
        episodeWatchHistory: { findMany: async () => [] },
        movieWatchHistory: { findMany: async () => [] },
        user: { findFirst: async () => person },
    };
    const calls = stubFetch(t, (url) => {
        if (url === "https://aio.example/api/v1/status") {
            return redirect("http://169.254.169.254/latest/meta-data/");
        }
        if (url === "https://aio.example/api/v1/user/client-agents") {
            return redirect("/api/v1/user/client-agents-moved");
        }
        if (url === "https://aio.example/api/v1/user/client-agents-moved") {
            return json({
                data: [{ lastSeen: 1_700_000_000_000, userAgent: "Example App/1.0" }],
                success: true,
            });
        }
        return json({ data: {}, success: true });
    });
    const health = await aioHealth.healthFor(prisma, () => "example-password", "acc", "p1");
    assert.equal(health.canRead, true);
    assert.equal(
        health.analyticsEnabled,
        false,
        "the status answer was not read from the internal address"
    );
    assert.deepEqual(
        health.apps.map((a) => a.name),
        ["Example App/1.0"]
    );
    assert.ok(!calls.some((u) => u.includes("169.254")));
});

test("an AIOMetadata configuration on an instance serving strangers: a redirect to an internal address is not followed", async (t) => {
    instanceType(t, "public");
    resolveTo(t, { "meta.example": ["93.184.216.34"] });
    const calls = stubFetch(t, () => redirect("http://127.0.0.1:4000/api/health", 307));
    await assert.rejects(
        aioMetadata.readConfig({
            base: "https://meta.example",
            password: "example-password",
            uuid: "cfg-uuid",
        }),
        (e) =>
            e.status === 502 &&
            e.message === "AIOMetadata sent this server to an address it does not connect to"
    );
    assert.deepEqual(calls, ["https://meta.example/api/config/load/cfg-uuid"]);

    const ok = stubFetch(t, (url) =>
        url.endsWith("/load/cfg-uuid")
            ? redirect("/api/config/load/cfg-uuid/moved", 308)
            : json({ config: { jellyfinUsers: [] } })
    );
    assert.deepEqual(
        await aioMetadata.readConfig({
            base: "https://meta.example",
            password: "example-password",
            uuid: "cfg-uuid",
        }),
        { jellyfinUsers: [] }
    );
    assert.equal(ok.length, 2);
});

// ---- LumiereDB --------------------------------------------------------------

test("LumiereDB on an instance serving strangers: a redirect to an internal address is not followed", async (t) => {
    instanceType(t, "public");
    resolveTo(t, { "lumiere.example": ["93.184.216.34"] });
    const calls = stubFetch(t, () => redirect("http://169.254.169.254/latest/meta-data/"));
    const lumiere = require("../server/utils/lumiere");
    await assert.rejects(
        lumiere.call("https://lumiere.example", "/readyz"),
        (e) => e.status === 0 && /reach LumiereDB/.test(e.message)
    );
    assert.deepEqual(calls, ["https://lumiere.example/readyz"]);
});

// ---- a profile picture --------------------------------------------------------

test("a profile picture on an instance serving strangers: a redirect to an internal address is not followed, an ordinary one is", async (t) => {
    instanceType(t, "public");
    resolveTo(t, { "img.example": ["93.184.216.35"], "jf.example": ["93.184.216.34"] });
    const png = Buffer.from("89504e470d0a1a0a", "hex");
    const calls = stubFetch(t, (url) => {
        if (url.startsWith("https://jf.example/UserImage")) {
            return redirect("http://169.254.169.254/latest/meta-data/");
        }
        if (url.startsWith("https://jf.example/Users/")) {
            return redirect("https://img.example/avatar.png", 301);
        }
        return new Response(png, { headers: { "content-type": "image/png" } });
    });
    const { pictureFor } = require("../server/utils/serverAvatars");
    const picture = await pictureFor({
        kind: "jellyfin",
        serverUrl: "https://jf.example",
        token: "example-token",
        userId: "u1",
    });
    assert.equal(picture.type, "image/png");
    assert.deepEqual(picture.buf, png);
    assert.ok(!calls.some((u) => u.includes("169.254")));
    assert.ok(calls.includes("https://img.example/avatar.png"));
});

// ---- SlickTrax's own address ---------------------------------------------------

const { localTraxManifest, loopbackTraxUrl } = require("../server/utils/localTraxManifest");
const TOKEN = "AbCdEfGhIjKlMnOp1234";
const traxPrisma = {
    user: {
        findFirst: async ({ where }) =>
            where.traxToken === TOKEN ? { accountId: "acc", id: "u1", traxToken: TOKEN } : null,
    },
};
const LOOPBACK = /^http:\/\/127\.0\.0\.1:\d+/;

test("SlickTrax on this server is read over loopback only when the token opens the path of the address", async () => {
    const own = await loopbackTraxUrl(
        traxPrisma,
        `https://slicksync.example.com/trax/${TOKEN}/v3/catalog/movie/top.json?genre=Drama`
    );
    assert.match(own, LOOPBACK);
    assert.ok(own.endsWith(`/trax/${TOKEN}/v3/catalog/movie/top.json?genre=Drama`), own);
    assert.match(
        await loopbackTraxUrl(traxPrisma, `http://192.168.1.20:3000/trax/${TOKEN}/manifest.json`),
        LOOPBACK,
        "a LAN address of this server"
    );
    assert.match(
        await loopbackTraxUrl(traxPrisma, `https://slicksync.example.com/trax/${TOKEN}`),
        LOOPBACK
    );
});

test("SlickTrax: an address that only mentions a token is not sent to this server", async () => {
    for (const url of [
        `https://other.example/api/health?x=/trax/${TOKEN}/`,
        `https://other.example/api/health#/trax/${TOKEN}/`,
        `https://other.example/trax/${TOKEN}/../../api/health`,
        `https://other.example/trax/${TOKEN}/%2e%2e/%2e%2e/api/health`,
        `https://other.example/elsewhere/trax/${TOKEN}/manifest.json`,
        `https://other.example/trax/${TOKEN}extra/manifest.json`,
        "https://other.example/trax/SHORTTOKEN/manifest.json",
        `https://other.example/trax/${"Z".repeat(20)}/manifest.json`,
        "not a url",
        "",
    ]) {
        assert.equal(await loopbackTraxUrl(traxPrisma, url), null, url);
    }
    assert.equal(
        await loopbackTraxUrl(null, `https://slicksync.example.com/trax/${TOKEN}/manifest.json`),
        null
    );
});

test("SlickTrax: building its own manifest in-process fetches nothing and is as it was - the token is looked up wherever the address keeps it", async () => {
    const asked = [];
    const prisma = {
        user: {
            findFirst: async ({ where }) => {
                asked.push(where.traxToken);
                return null;
            },
        },
    };
    assert.equal(
        await localTraxManifest(
            prisma,
            `https://slicksync.example.com/prefix/trax/${TOKEN}/manifest.json`
        ),
        null
    );
    assert.deepEqual(asked, [TOKEN]);
    assert.equal(await localTraxManifest(prisma, "https://addon.example.com/manifest.json"), null);
    assert.deepEqual(asked, [TOKEN]);
});
