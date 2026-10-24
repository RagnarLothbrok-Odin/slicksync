// Every addon address is fetched by the server - when it is added, edited and
// reloaded, and again before every sync. These pin which addresses that may
// reach: an instance serving strangers never an internal one, a household
// install anything on its own network except link-local, and a redirect is
// held to the same rule as the address that started it.
const test = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");
const dns = require("node:dns").promises;
const config = require("../server/utils/config");
const makeAddonsRouter = require("../server/routes/addons");
const { reloadAddon, prewarmManifests } = makeAddonsRouter;
const { sanitizeUrl } = require("../server/utils/helpers/validation");

const realFetch = global.fetch;
let ownBase = "";

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

// Replaces the server's outgoing fetch; calls to the test's own app still go through.
function stubFetch(t, handler) {
    const calls = [];
    global.fetch = (url, init) => {
        if (ownBase && String(url).startsWith(ownBase)) {
            return realFetch(url, init);
        }
        calls.push(String(url));
        return Promise.resolve(handler(String(url), init));
    };
    t.after(() => {
        global.fetch = realFetch;
    });
    return calls;
}

const manifest = (extra = {}) =>
    new Response(
        JSON.stringify({
            catalogs: [],
            id: "org.example.addon",
            name: "Example Addon",
            resources: ["catalog"],
            version: "1.0.0",
            ...extra,
        }),
        { headers: { "content-type": "application/json" } }
    );
const redirect = (location, status = 302) => new Response(null, { headers: { location }, status });

const configuredType = config.INSTANCE_TYPE;
function instanceType(t, type) {
    config.INSTANCE_TYPE = type;
    t.after(() => {
        config.INSTANCE_TYPE = configuredType;
    });
}

// The addon routes over a fake database that already holds one addon called
// "Example Addon" - so a request that gets past the address check and the
// manifest fetch ends in "already exists" without needing the rest of a save.
async function serve(t, type) {
    instanceType(t, type);
    const updates = [];
    const prisma = {
        addon: {
            create: async () => {
                throw new Error("nothing should be saved");
            },
            findFirst: async ({ where }) => {
                if (where.id === "a1") {
                    return { accountId: "acc", groupAddons: [], id: "a1", name: "Example Addon" };
                }
                if (where.name === "Example Addon") {
                    return { id: "a1", isActive: true, name: "Example Addon" };
                }
                return null;
            },
            update: async (args) => {
                updates.push(args);
                throw new Error("nothing should be saved");
            },
        },
        user: { findFirst: async () => null },
    };
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
        req.appAccountId = "acc";
        next();
    });
    const passthrough = (v) => v;
    app.use(
        "/api/addons",
        makeAddonsRouter({
            decrypt: passthrough,
            encrypt: passthrough,
            filterManifestByCatalogs: passthrough,
            filterManifestByResources: passthrough,
            getAccountId: () => "acc",
            getDecryptedManifestUrl: (a) => a.manifestUrl,
            INSTANCE_TYPE: type,
            manifestHash: () => "h",
            manifestUrlHmac: () => "hmac",
            prisma,
            scopedWhere: () => ({}),
        })
    );
    const server = await new Promise((resolve) => {
        const s = app.listen(0, "127.0.0.1", () => resolve(s));
    });
    ownBase = `http://127.0.0.1:${server.address().port}`;
    t.after(
        () =>
            new Promise((done) => {
                server.closeAllConnections?.();
                server.close(done);
                ownBase = "";
            })
    );
    return { base: `${ownBase}/api/addons`, updates };
}

const send = (method, url, body) =>
    realFetch(url, {
        body: JSON.stringify(body),
        headers: { "content-type": "application/json" },
        method,
    });

test("sanitizeUrl: still accepts web and stremio addresses, now refuses every other scheme", () => {
    assert.equal(
        sanitizeUrl("https://addon.example.com/manifest.json"),
        "https://addon.example.com/manifest.json"
    );
    assert.equal(
        sanitizeUrl("  http://192.168.1.10:7000/manifest.json "),
        "http://192.168.1.10:7000/manifest.json"
    );
    assert.equal(
        sanitizeUrl("stremio://addon.example.com/manifest.json"),
        "https://addon.example.com/manifest.json"
    );
    assert.equal(
        sanitizeUrl("@@STREMIO://addon.example.com/m.json"),
        "https://addon.example.com/m.json"
    );
    assert.equal(
        sanitizeUrl("HTTPS://Addon.Example.com/m.json"),
        "HTTPS://Addon.Example.com/m.json"
    );
    assert.equal(
        sanitizeUrl("http://aiostreams:3000/stremio/abc/manifest.json"),
        "http://aiostreams:3000/stremio/abc/manifest.json"
    );
    for (const bad of [
        "file:///etc/passwd",
        "data:text/plain,hi",
        "ftp://addon.example.com/m.json",
        "javascript:alert(1)",
        "blob:abc",
        "not a url",
        "",
        "   ",
        null,
        undefined,
        42,
    ]) {
        assert.equal(sanitizeUrl(bad), null, String(bad));
    }
});

test("adding an addon: an instance serving strangers refuses internal addresses before fetching anything", async (t) => {
    const { base, updates } = await serve(t, "public");
    const calls = stubFetch(t, () => manifest());
    for (const url of [
        "http://169.254.169.254/latest/meta-data/",
        "http://127.0.0.1:11470/local-addon/manifest.json",
        "http://192.168.1.10:7000/manifest.json",
        "http://[::1]:7000/manifest.json",
        "http://10.0.0.5/manifest.json",
        "stremio://10.0.0.5/manifest.json",
        "http://db.internal/manifest.json",
    ]) {
        const res = await send("POST", base, { url });
        assert.equal(res.status, 400, url);
        assert.match((await res.json()).message, /private or internal network/, url);
    }
    for (const url of [
        "file:///etc/passwd",
        "data:text/plain,hi",
        "ftp://addon.example.com/manifest.json",
    ]) {
        const res = await send("POST", base, { url });
        assert.equal(res.status, 400, url);
        assert.match((await res.json()).message, /Invalid URL/, url);
    }
    // The browser sending the manifest itself does not excuse the address: it is what later reloads fetch.
    const withManifest = await send("POST", base, {
        manifestData: { name: "Another", resources: [] },
        url: "http://10.0.0.5/manifest.json",
    });
    assert.equal(withManifest.status, 400);
    assert.deepEqual(calls, [], "nothing was sent anywhere");
    assert.deepEqual(updates, []);
});

test("adding an addon: a household install still adds LAN, loopback and compose-name addons, but never a link-local one", async (t) => {
    const { base } = await serve(t, "private");
    resolveTo(t, { "addon.example.com": ["93.184.216.34"], aiostreams: ["172.18.0.5"] });
    const calls = stubFetch(t, () => manifest());
    for (const url of [
        "http://192.168.1.10:7000/manifest.json",
        "http://aiostreams:3000/stremio/abc/manifest.json",
        "http://127.0.0.1:11470/local-addon/manifest.json",
        "https://addon.example.com/manifest.json",
        "stremio://addon.example.com/manifest.json",
    ]) {
        const res = await send("POST", base, { url });
        // Past the address check and the fetch: the fake database already has this addon's name.
        assert.equal(res.status, 409, url);
    }
    assert.deepEqual(calls, [
        "http://192.168.1.10:7000/manifest.json",
        "http://aiostreams:3000/stremio/abc/manifest.json",
        "http://127.0.0.1:11470/local-addon/manifest.json",
        "https://addon.example.com/manifest.json",
        "https://addon.example.com/manifest.json",
    ]);

    calls.length = 0;
    for (const url of [
        "http://169.254.169.254/latest/meta-data/",
        "http://[fe80::1]/manifest.json",
    ]) {
        const res = await send("POST", base, { url });
        assert.equal(res.status, 400, url);
        assert.match((await res.json()).message, /link-local/, url);
    }
    assert.deepEqual(calls, []);
});

test("adding an addon: a redirect to an internal address is not followed, an ordinary one is", async (t) => {
    const { base } = await serve(t, "public");
    resolveTo(t, { "addons.example": ["93.184.216.35"], "cdn.example": ["93.184.216.34"] });
    const calls = stubFetch(t, (url) => {
        if (url === "https://cdn.example/to-metadata.json") {
            return redirect("http://169.254.169.254/latest/meta-data/");
        }
        if (url === "https://cdn.example/to-lan.json") {
            return redirect("/hop", 307);
        }
        if (url === "https://cdn.example/hop") {
            return redirect("http://192.168.1.10:7000/manifest.json");
        }
        if (url === "https://cdn.example/moved.json") {
            return redirect("https://addons.example/manifest.json", 301);
        }
        return manifest();
    });
    for (const path of ["to-metadata.json", "to-lan.json"]) {
        const res = await send("POST", base, { url: `https://cdn.example/${path}` });
        assert.equal(res.status, 400, path);
        assert.match((await res.json()).message, /private or internal network/, path);
    }
    assert.ok(!calls.includes("http://169.254.169.254/latest/meta-data/"));
    assert.ok(!calls.includes("http://192.168.1.10:7000/manifest.json"));

    calls.length = 0;
    const moved = await send("POST", base, { url: "https://cdn.example/moved.json" });
    assert.equal(moved.status, 409, "followed to the real manifest");
    assert.deepEqual(calls, [
        "https://cdn.example/moved.json",
        "https://addons.example/manifest.json",
    ]);
});

test("adding an addon: a name this server cannot look up is only a problem when it has to fetch it", async (t) => {
    const { base } = await serve(t, "public");
    resolveTo(t, {});
    const calls = stubFetch(t, () => manifest());
    const supplied = await send("POST", base, {
        manifestData: { name: "Example Addon", resources: [] },
        url: "https://gone.example/manifest.json",
    });
    assert.equal(supplied.status, 409, "the browser already read the manifest, nothing to resolve");
    const fetched = await send("POST", base, { url: "https://gone.example/manifest.json" });
    assert.equal(fetched.status, 400);
    assert.match((await fetched.json()).message, /could not be found/);
    assert.deepEqual(calls, []);
});

test("editing an addon address: the same rules, and nothing is saved when it is refused", async (t) => {
    const { base, updates } = await serve(t, "public");
    const calls = stubFetch(t, () => manifest());
    for (const url of [
        "http://169.254.169.254/latest/meta-data/",
        "http://192.168.1.10:7000/manifest.json",
        "http://127.0.0.1:4000/api/health",
    ]) {
        const res = await send("PUT", `${base}/a1`, { url });
        assert.equal(res.status, 400, url);
        assert.match((await res.json()).message, /private or internal network/, url);
    }
    for (const url of ["file:///etc/passwd", "ftp://addon.example.com/manifest.json"]) {
        const res = await send("PUT", `${base}/a1`, { url });
        assert.equal(res.status, 400, url);
        assert.match((await res.json()).message, /Invalid URL/, url);
    }
    assert.deepEqual(calls, []);
    assert.deepEqual(updates, []);
});

test("editing an addon address: a household install may point it at its own network", async (t) => {
    const { base } = await serve(t, "private");
    const calls = stubFetch(t, () => new Response("nope", { status: 404 }));
    const lan = await send("PUT", `${base}/a1`, { url: "http://192.168.1.10:7000/manifest.json" });
    assert.equal(lan.status, 400);
    // The ordinary "could not fetch" answer, not the refusal: the request was made.
    assert.match((await lan.json()).message, /URL may be incorrect/);
    assert.deepEqual(calls, ["http://192.168.1.10:7000/manifest.json"]);
    const metadata = await send("PUT", `${base}/a1`, {
        url: "http://169.254.169.254/latest/meta-data/",
    });
    assert.match((await metadata.json()).message, /link-local/);
    assert.deepEqual(calls, ["http://192.168.1.10:7000/manifest.json"]);
});

// ---- the fetches that run on every sync ------------------------------------

function reloadDeps() {
    const passthrough = (v) => v;
    return {
        decrypt: passthrough,
        encrypt: passthrough,
        filterManifestByCatalogs: passthrough,
        filterManifestByResources: passthrough,
        getDecryptedManifestUrl: (a) => a.manifestUrl,
        manifestHash: () => "h",
        silent: true,
    };
}

function savedAddon(url) {
    const updates = [];
    const prisma = {
        addon: {
            delete: async () => {
                throw new Error("a saved addon is never deleted by a reload");
            },
            findFirst: async () => ({
                accountId: "acc",
                catalogs: "[]",
                id: "a1",
                isActive: true,
                manifestUrl: url,
                name: "Example Addon",
                resources: "[]",
            }),
            update: async (args) => {
                updates.push(args);
                return {
                    id: "a1",
                    isActive: true,
                    manifestHash: "h2",
                    manifestUrl: url,
                    name: "Example Addon",
                };
            },
        },
    };
    return { prisma, updates };
}

test("reload: an address the server will not connect to leaves the saved addon exactly as it was", async (t) => {
    instanceType(t, "public");
    const calls = stubFetch(t, () => manifest());
    for (const url of [
        "http://169.254.169.254/latest/meta-data/",
        "http://10.0.0.5:7000/manifest.json",
        "http://127.0.0.1:4000/api/health",
        "file:///etc/passwd",
    ]) {
        const { prisma, updates } = savedAddon(url);
        await assert.rejects(
            reloadAddon(prisma, () => "acc", "a1", {}, reloadDeps()),
            /Failed to fetch addon manifest: /,
            url
        );
        assert.deepEqual(updates, [], `${url}: nothing written`);
    }
    assert.deepEqual(calls, []);
});

test("reload: an addon redirected to an internal address is unreachable for this pass", async (t) => {
    instanceType(t, "public");
    resolveTo(t, { "cdn.example": ["93.184.216.34"] });
    const calls = stubFetch(t, () => redirect("http://169.254.169.254/latest/meta-data/"));
    const { prisma, updates } = savedAddon("https://cdn.example/redirects.json");
    await assert.rejects(
        reloadAddon(prisma, () => "acc", "a1", {}, reloadDeps()),
        /Failed to fetch addon manifest: That address is on a private or internal network/
    );
    assert.deepEqual(updates, []);
    assert.deepEqual(calls, ["https://cdn.example/redirects.json"]);
});

test("reload: the local addon address is still skipped without a fetch, on any install", async (t) => {
    const calls = stubFetch(t, () => manifest());
    for (const type of ["public", "private"]) {
        instanceType(t, type);
        const { prisma, updates } = savedAddon("http://127.0.0.1:11470/local-addon/manifest.json");
        const result = await reloadAddon(prisma, () => "acc", "a1", {}, reloadDeps());
        assert.equal(result.skipped, true, type);
        assert.deepEqual(updates, []);
    }
    assert.deepEqual(calls, []);
});

test("reload: a household install reloads an addon on its own network, a public host works on a public one", async (t) => {
    resolveTo(t, { "addons.example": ["93.184.216.34"] });
    const calls = stubFetch(t, () => manifest({ version: "2.0.0" }));
    instanceType(t, "private");
    const lan = savedAddon("http://192.168.77.10:7000/manifest.json");
    assert.equal(
        (await reloadAddon(lan.prisma, () => "acc", "a1", {}, reloadDeps())).success,
        true
    );
    assert.equal(lan.updates.length, 1);
    instanceType(t, "public");
    const pub = savedAddon("https://addons.example/reload-ok.json");
    assert.equal(
        (await reloadAddon(pub.prisma, () => "acc", "a1", {}, reloadDeps())).success,
        true
    );
    assert.equal(pub.updates.length, 1);
    assert.deepEqual(calls, [
        "http://192.168.77.10:7000/manifest.json",
        "https://addons.example/reload-ok.json",
    ]);
});

test("prewarm: refused addresses are skipped quietly, the rest are still warmed", async (t) => {
    instanceType(t, "public");
    resolveTo(t, { "addons.example": ["93.184.216.34"] });
    const calls = stubFetch(t, () => manifest());
    const result = await prewarmManifests([
        "http://169.254.169.254/latest/meta-data/",
        "http://10.0.0.5:7000/prewarm.json",
        "https://addons.example/prewarm.json",
        "http://127.0.0.1:11470/local-addon/manifest.json",
        "file:///etc/passwd",
    ]);
    assert.deepEqual(result, { attempted: 3, warmed: 1 });
    assert.deepEqual(calls, ["https://addons.example/prewarm.json"]);
});

test("prewarm: a household install warms addons on its own network", async (t) => {
    instanceType(t, "private");
    const calls = stubFetch(t, () => manifest());
    const result = await prewarmManifests([
        "http://192.168.88.10:7000/prewarm.json",
        "http://169.254.169.254/latest/meta-data/",
    ]);
    assert.deepEqual(result, { attempted: 2, warmed: 1 });
    assert.deepEqual(calls, ["http://192.168.88.10:7000/prewarm.json"]);
});

// ---- addons brought in from a person's account or a list of addresses --------
//
// The import routes fetch each addon's manifest, and then keep what comes back
// in a row of their own - so they hold the address to the same rule as adding
// an addon by hand, and one refused address never stops the rest of the list.

const makeUsersRouter = require("../server/routes/users");

// The users routes over a fake database that records what the import saves.
async function serveUsers(t, type, { providerType = "stremio", provided = [] } = {}) {
    instanceType(t, type);
    const created = [];
    const attached = [];
    const added = [];
    const prisma = {
        addon: {
            create: async ({ data }) => {
                created.push(data);
                return { id: `a${created.length}`, manifestUrl: data.manifestUrl, name: data.name };
            },
            findFirst: async () => null,
        },
        group: {
            create: async ({ data }) => ({ id: "g1", name: data.name }),
            findFirst: async () => null,
            findMany: async () => [],
        },
        groupAddon: {
            aggregate: async () => ({ _max: { position: null } }),
            create: async ({ data }) => {
                attached.push(data);
                return data;
            },
            findFirst: async () => null,
        },
        user: {
            findFirst: async () => ({
                accountId: "acc",
                id: "u1",
                isActive: true,
                providerType,
                stremioAuthKey: "enc-key",
                username: "someone",
            }),
        },
    };
    const app = express();
    app.use(express.json());
    const passthrough = (v) => v;
    app.use(
        "/api/users",
        makeUsersRouter({
            assignUserToGroup: async () => undefined,
            createProvider: () => ({
                addAddon: async (url) => {
                    added.push(url);
                },
                getAddons: async () => ({ addons: provided }),
            }),
            decrypt: passthrough,
            encrypt: passthrough,
            getAccountId: () => "acc",
            manifestHash: (m) => `hash:${m.name}`,
            manifestUrlHmac: (_req, url) => `hmac:${url}`,
            prisma,
        })
    );
    const server = await new Promise((resolve) => {
        const s = app.listen(0, "127.0.0.1", () => resolve(s));
    });
    ownBase = `http://127.0.0.1:${server.address().port}`;
    t.after(
        () =>
            new Promise((done) => {
                server.closeAllConnections?.();
                server.close(done);
                ownBase = "";
            })
    );
    return { added, attached, base: `${ownBase}/api/users`, created };
}

const sendJson = async (method, url, body) => {
    const res = await send(method, url, body);
    return { body: await res.json(), status: res.status };
};

test("adding addons to a person: an instance serving strangers fetches nothing internal, and the rest of the list still goes through", async (t) => {
    const { base, added } = await serveUsers(t, "public");
    resolveTo(t, { "addon.example": ["93.184.216.34"], "cdn.example": ["93.184.216.35"] });
    const calls = stubFetch(t, (url) => {
        if (url === "https://cdn.example/redirects.json") {
            return redirect("http://169.254.169.254/latest/meta-data/");
        }
        return manifest();
    });
    const { status, body } = await sendJson("POST", `${base}/u1/stremio-addons/add`, {
        addonUrls: [
            "http://169.254.169.254/latest/meta-data/",
            "https://addon.example/manifest.json",
            "http://192.168.1.10:7000/manifest.json",
            "https://cdn.example/redirects.json",
        ],
    });
    assert.equal(status, 200);
    assert.deepEqual(
        body.results.map((r) => r.status),
        ["error", "success", "error", "error"]
    );
    for (const i of [0, 2, 3]) {
        assert.match(body.results[i].error, /private or internal network/, body.results[i].url);
    }
    assert.equal(body.addedCount, 1);
    assert.deepEqual(added, ["https://addon.example/manifest.json"]);
    assert.deepEqual(calls, [
        "https://addon.example/manifest.json",
        "https://cdn.example/redirects.json",
    ]);
});

test("adding addons to a person: a household install reaches its own network, but never link-local", async (t) => {
    const { base, added } = await serveUsers(t, "private");
    const calls = stubFetch(t, () => manifest());
    const { body } = await sendJson("POST", `${base}/u1/stremio-addons/add`, {
        addonUrls: [
            "http://192.168.1.10:7000/manifest.json",
            "http://127.0.0.1:11470/local-addon/manifest.json",
            "http://169.254.169.254/latest/meta-data/",
        ],
    });
    assert.deepEqual(
        body.results.map((r) => r.status),
        ["success", "success", "error"]
    );
    assert.match(body.results[2].error, /link-local/);
    assert.deepEqual(added, [
        "http://192.168.1.10:7000/manifest.json",
        "http://127.0.0.1:11470/local-addon/manifest.json",
    ]);
    assert.deepEqual(calls, added);
});

test("importing a list of addons: nothing is saved at an address the server will not connect to, the rest are imported", async (t) => {
    const { base, created, attached } = await serveUsers(t, "public");
    resolveTo(t, {
        "addon.example": ["93.184.216.34"],
        "cdn.example": ["93.184.216.35"],
        "down.example": ["93.184.216.36"],
    });
    const calls = stubFetch(t, (url) => {
        if (url === "https://down.example/manifest.json") {
            throw new TypeError("fetch failed");
        }
        if (url === "https://cdn.example/redirects.json") {
            return redirect("http://169.254.169.254/latest/meta-data/");
        }
        return manifest({ name: `Fetched ${new URL(url).hostname}` });
    });
    const { status, body } = await sendJson("POST", `${base}/u1/import-addons`, {
        addons: [
            // The manifest came with it, so nothing would be fetched - the address is what every later reload fetches.
            {
                manifest: { name: "Metadata", resources: [] },
                manifestUrl: "http://169.254.169.254/latest/meta-data/",
            },
            { manifestUrl: "http://10.0.0.5:7000/manifest.json" },
            {
                manifest: { name: "Local", resources: [] },
                transportUrl: "http://127.0.0.1:11470/local-addon/manifest.json",
            },
            { manifestUrl: "https://addon.example/manifest.json" },
            // An addon that is down today is still kept, with what the list said about it.
            {
                id: "org.example.down",
                manifestUrl: "https://down.example/manifest.json",
                name: "Down Addon",
            },
            // A public host sending the server to an internal address: its own address is kept, the internal one is never asked.
            { manifestUrl: "https://cdn.example/redirects.json", name: "Redirecting Addon" },
        ],
    });
    assert.equal(status, 200);
    assert.deepEqual(
        created.map((c) => c.manifestUrl),
        [
            "https://addon.example/manifest.json",
            "https://down.example/manifest.json",
            "https://cdn.example/redirects.json",
        ]
    );
    assert.equal(created[0].name, "Fetched addon.example (someone)");
    assert.equal(created[1].name, "Down Addon (someone)");
    assert.equal(attached.length, 3);
    assert.equal(body.addonCount, 3);
    assert.equal(body.skipped.length, 3);
    assert.deepEqual(
        body.skipped.map((s) => s.url),
        [
            "http://169.254.169.254/latest/meta-data/",
            "http://10.0.0.5:7000/manifest.json",
            "http://127.0.0.1:11470/local-addon/manifest.json",
        ]
    );
    assert.match(body.skipped[0].reason, /private or internal network/);
    assert.match(body.message, /3 left out: That address is on a private or internal network/);
    assert.ok(
        !calls.some((u) => u.includes("169.254") || u.includes("10.0.0.5")),
        "no internal address was asked"
    );
});

test("importing addons from the older addonUrls list takes the same route and the same rule", async (t) => {
    const { base, created } = await serveUsers(t, "public");
    resolveTo(t, { "addon.example": ["93.184.216.34"] });
    const calls = stubFetch(t, () => manifest());
    const { status, body } = await sendJson("POST", `${base}/u1/import-addons`, {
        addonUrls: [
            "http://192.168.1.10:7000/manifest.json",
            "https://addon.example/manifest.json",
        ],
    });
    assert.equal(status, 200);
    assert.deepEqual(
        created.map((c) => c.manifestUrl),
        ["https://addon.example/manifest.json"]
    );
    assert.equal(body.skipped.length, 1);
    assert.deepEqual(calls, [
        "https://addon.example/manifest.json",
        "https://addon.example/manifest.json",
    ]);
});

test("importing addons on a household install: its own network is imported, link-local is left out", async (t) => {
    const { base, created } = await serveUsers(t, "private");
    resolveTo(t, { aiostreams: ["172.18.0.5"] });
    const calls = stubFetch(t, () => manifest());
    const { body } = await sendJson("POST", `${base}/u1/import-addons`, {
        addons: [
            { manifestUrl: "http://192.168.1.10:7000/manifest.json" },
            { manifestUrl: "http://aiostreams:3000/stremio/abc/manifest.json" },
            {
                manifest: { name: "Local", resources: [] },
                manifestUrl: "http://127.0.0.1:11470/local-addon/manifest.json",
            },
            {
                manifest: { name: "Metadata", resources: [] },
                manifestUrl: "http://169.254.169.254/latest/meta-data/",
            },
        ],
    });
    assert.deepEqual(
        created.map((c) => c.manifestUrl),
        [
            "http://192.168.1.10:7000/manifest.json",
            "http://aiostreams:3000/stremio/abc/manifest.json",
            "http://127.0.0.1:11470/local-addon/manifest.json",
        ]
    );
    assert.equal(body.skipped.length, 1);
    assert.match(body.skipped[0].reason, /link-local/);
    assert.ok(!calls.some((u) => u.includes("169.254")));
    assert.ok(
        calls.includes("http://aiostreams:3000/stremio/abc/manifest.json"),
        "a compose service name is fetched, not just imported"
    );
});

test("a Nuvio persons addon list: a refused address reads as an addon that did not answer, and the list still comes back", async (t) => {
    const provided = [
        { transportName: "Internal Addon", transportUrl: "http://10.0.0.5:7000/manifest.json" },
        { transportName: "Public Addon", transportUrl: "https://addon.example/manifest.json" },
    ];
    const { base } = await serveUsers(t, "public", { provided, providerType: "nuvio" });
    resolveTo(t, { "addon.example": ["93.184.216.34"] });
    const calls = stubFetch(t, () => manifest({ name: "Public Addon Manifest", version: "3.0.0" }));
    const res = await realFetch(`${base}/u1/stremio-addons`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.deepEqual(
        body.addons.map((a) => [a.name, a.version]),
        [
            ["Internal Addon", null],
            ["Public Addon Manifest", "3.0.0"],
        ]
    );
    assert.deepEqual(calls, ["https://addon.example/manifest.json"]);
});
