const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

// The proxy writes a line per request to a log file; keep that out of the
// repository's own logs folder.
process.env.LOG_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "proxycache-test-"));

const express = require("express");

// Load the proxy while watching for timers it starts: the cache sweeper must
// never be the thing that keeps the process alive.
const startedIntervals = [];
const realSetInterval = global.setInterval;
global.setInterval = (fn, ...rest) => {
    const handle = realSetInterval(fn, ...rest);
    startedIntervals.push({ handle, name: fn?.name });
    return handle;
};
const proxyFactory = require("../server/routes/proxy");
global.setInterval = realSetInterval;

const {
    getCachedProxy,
    setCachedProxy,
    sweepProxyCache,
    cacheStats,
    clearCache,
    CACHE_MAX_ENTRIES,
    CACHE_MAX_BYTES,
    CACHE_MAX_ENTRY_BYTES,
    CACHE_TTL_MS,
} = proxyFactory._test;

const realNow = Date.now;
function clockAt(t, start) {
    let now = start;
    Date.now = () => now;
    t.after(() => {
        Date.now = realNow;
    });
    return {
        advance: (ms) => {
            now += ms;
        },
    };
}

function listen(t, handler) {
    return new Promise((resolve) => {
        const server = http.createServer(handler);
        server.listen(0, "127.0.0.1", () => {
            t.after(
                () =>
                    new Promise((done) => {
                        server.closeAllConnections?.();
                        server.close(done);
                    })
            );
            resolve(`http://127.0.0.1:${server.address().port}`);
        });
    });
}

function get(url) {
    return new Promise((resolve, reject) => {
        http.get(url, { agent: false }, (res) => {
            const chunks = [];
            res.on("data", (c) => chunks.push(c));
            res.on("end", () =>
                resolve({
                    body: Buffer.concat(chunks),
                    headers: res.headers,
                    status: res.statusCode,
                })
            );
        }).on("error", reject);
    });
}

// The addon proxy in front of a fake upstream addon, as index.js mounts it.
async function mountProxy(t, upstreamHandler) {
    const saved = { error: console.error, log: console.log, warn: console.warn };
    console.log = console.warn = console.error = () => undefined;
    t.after(() => Object.assign(console, saved));
    const upstream = await listen(t, upstreamHandler);
    const addon = {
        accountId: "acct",
        id: "addon-1",
        manifestUrl: `${upstream}/manifest.json`,
        name: "Test addon",
        proxyUuid: "uuid-1",
    };
    const prisma = { addon: { findFirst: async () => addon } };
    const app = express();
    app.use(
        "/proxy",
        proxyFactory({
            decrypt: (v) => v,
            getAccountId: () => "acct",
            getServerKey: () => Buffer.alloc(32),
            prisma,
        })
    );
    return `${await listen(t, app)}/proxy/uuid-1`;
}

test("the cache sweeper does not keep the process alive", () => {
    const sweepers = startedIntervals.filter((i) => i.name === "sweepProxyCache");
    assert.equal(sweepers.length, 1);
    assert.equal(sweepers[0].handle.hasRef(), false);
});

test("a thousand distinct keys leave no more than the entry cap, newest kept", () => {
    clearCache();
    for (let i = 0; i < 1000; i++) {
        setCachedProxy(`k${i}`, `body ${i}`, "application/json");
    }
    assert.equal(cacheStats().entries, CACHE_MAX_ENTRIES);
    assert.equal(getCachedProxy("k0"), null);
    assert.equal(getCachedProxy(`k${1000 - CACHE_MAX_ENTRIES - 1}`), null);
    assert.equal(
        getCachedProxy(`k${1000 - CACHE_MAX_ENTRIES}`).data,
        `body ${1000 - CACHE_MAX_ENTRIES}`
    );
    assert.equal(getCachedProxy("k999").data, "body 999");
    clearCache();
});

test("the cache holds no more bytes than its cap, oldest evicted first", () => {
    clearCache();
    const body = "x".repeat(1.5 * 1024 * 1024);
    for (let i = 0; i < 100; i++) {
        setCachedProxy(`big${i}`, body, "application/json");
    }
    const { entries, bytes } = cacheStats();
    assert.ok(bytes <= CACHE_MAX_BYTES, `${bytes} bytes held`);
    assert.equal(entries, Math.floor(CACHE_MAX_BYTES / body.length));
    assert.equal(getCachedProxy("big0"), null);
    assert.ok(getCachedProxy("big99"));
    clearCache();
});

test("sizes are counted in bytes, for text and for buffers", () => {
    clearCache();
    setCachedProxy("text", "é".repeat(10), "text/plain"); // 20 bytes in UTF-8
    setCachedProxy("buf", Buffer.alloc(1000), "application/octet-stream");
    assert.deepEqual(cacheStats(), { bytes: 1020, entries: 2 });
    clearCache();
});

test("a body over the per-entry cap is not cached, and does not push anything out", () => {
    clearCache();
    setCachedProxy("keep", "small", "application/json");
    assert.equal(
        setCachedProxy("huge", "x".repeat(CACHE_MAX_ENTRY_BYTES + 1), "application/json"),
        false
    );
    assert.equal(getCachedProxy("huge"), null);
    assert.ok(getCachedProxy("keep"));
    assert.equal(
        setCachedProxy("exact", "x".repeat(CACHE_MAX_ENTRY_BYTES), "application/json"),
        true
    );
    clearCache();
});

test("a key that is set again is counted once, and an oversize replacement drops the stale copy", () => {
    clearCache();
    for (let i = 0; i < 10; i++) {
        setCachedProxy("same", "y".repeat(1000), "application/json");
    }
    assert.deepEqual(cacheStats(), { bytes: 1000, entries: 1 });
    setCachedProxy("same", "z".repeat(CACHE_MAX_ENTRY_BYTES + 1), "application/json");
    assert.deepEqual(cacheStats(), { bytes: 0, entries: 0 });
});

test("the sweeper removes expired entries that nobody asked for again, and only those", (t) => {
    clearCache();
    const clock = clockAt(t, 1_000_000);
    setCachedProxy("old1", "a", "application/json");
    setCachedProxy("old2", "bb", "application/json");
    clock.advance(CACHE_TTL_MS - 1000);
    setCachedProxy("fresh", "ccc", "application/json");
    clock.advance(2000); // the first two are now past their minute, the third is not

    sweepProxyCache();
    assert.deepEqual(cacheStats(), { bytes: 3, entries: 1 });
    assert.equal(getCachedProxy("fresh").data, "ccc");

    clock.advance(CACHE_TTL_MS);
    sweepProxyCache();
    assert.deepEqual(cacheStats(), { bytes: 0, entries: 0 });
});

test("an expired entry that is read is dropped and its bytes given back", (t) => {
    clearCache();
    const clock = clockAt(t, 5_000_000);
    setCachedProxy("a", "x".repeat(500), "application/json");
    clock.advance(CACHE_TTL_MS + 1);
    assert.equal(getCachedProxy("a"), null);
    assert.deepEqual(cacheStats(), { bytes: 0, entries: 0 });
});

test("through the proxy: a catalog is cached for repeat requests, many distinct paths stay within the cap", async (t) => {
    clearCache();
    let upstreamHits = 0;
    const base = await mountProxy(t, (req, res) => {
        upstreamHits++;
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ metas: [], path: req.url }));
    });

    const first = await get(`${base}/catalog/movie/top.json`);
    const second = await get(`${base}/catalog/movie/top.json`);
    assert.equal(first.headers["x-proxy-cache"], "MISS");
    assert.equal(second.headers["x-proxy-cache"], "HIT");
    assert.equal(upstreamHits, 1);

    const total = CACHE_MAX_ENTRIES + 100;
    for (let from = 0; from < total; from += 50) {
        await Promise.all(
            Array.from({ length: Math.min(50, total - from) }, (_, i) =>
                get(`${base}/meta/movie/tt${from + i}.json`)
            )
        );
    }
    assert.equal(cacheStats().entries, CACHE_MAX_ENTRIES);
    clearCache();
});

test("through the proxy: a body over the entry cap and a binary body are served but not kept", async (t) => {
    clearCache();
    const hits = {};
    const base = await mountProxy(t, (req, res) => {
        hits[req.url] = (hits[req.url] || 0) + 1;
        if (req.url === "/huge.json") {
            res.writeHead(200, { "content-type": "application/json" });
            return res.end(JSON.stringify({ blob: "x".repeat(CACHE_MAX_ENTRY_BYTES + 1024) }));
        }
        res.writeHead(200, { "content-type": "image/png" });
        res.end(Buffer.alloc(2048, 7));
    });

    const huge = await get(`${base}/huge.json`);
    assert.equal(huge.status, 200);
    assert.ok(huge.body.length > CACHE_MAX_ENTRY_BYTES);
    assert.equal((await get(`${base}/huge.json`)).headers["x-proxy-cache"], "MISS");

    const png = await get(`${base}/logo.png`);
    assert.equal(png.status, 200);
    assert.equal(png.headers["content-type"], "image/png");
    assert.equal(png.body.length, 2048);
    assert.equal((await get(`${base}/logo.png`)).headers["x-proxy-cache"], "MISS");

    assert.deepEqual(hits, { "/huge.json": 2, "/logo.png": 2 });
    assert.deepEqual(cacheStats(), { bytes: 0, entries: 0 });
});

// ---- the upstream address ---------------------------------------------------
//
// /proxy/<uuid>/... answers anyone holding the link, and the address it fetches
// is whatever the addon's owner saved - so it is held to the same rule as every
// other address typed in somewhere: an instance serving strangers never reaches
// its own network, a household install does, and nobody reaches link-local.
// A redirect is held to the rule too.

const dns = require("node:dns").promises;
const config = require("../server/utils/config");

const configuredType = config.INSTANCE_TYPE;
function instanceType(t, type) {
    config.INSTANCE_TYPE = type;
    t.after(() => {
        config.INSTANCE_TYPE = configuredType;
    });
}

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

// The proxy for an addon saved at `manifestUrl`, wherever that is.
async function mountProxyFor(t, manifestUrl) {
    const saved = { error: console.error, log: console.log, warn: console.warn };
    console.log = console.warn = console.error = () => undefined;
    t.after(() => Object.assign(console, saved));
    const addon = {
        accountId: "acct",
        id: "addon-2",
        manifestUrl,
        name: "Test addon",
        proxyUuid: "uuid-2",
    };
    const prisma = { addon: { findFirst: async () => addon } };
    const app = express();
    app.use(
        "/proxy",
        proxyFactory({
            decrypt: (v) => v,
            getAccountId: () => "acct",
            getServerKey: () => Buffer.alloc(32),
            prisma,
        })
    );
    return `${await listen(t, app)}/proxy/uuid-2`;
}

// Replaces the server's outgoing fetch for this test.
function stubUpstream(t, handler) {
    const calls = [];
    const realFetch = global.fetch;
    global.fetch = (url, init) => {
        calls.push({ init, url: String(url) });
        return Promise.resolve(handler(String(url), init));
    };
    t.after(() => {
        global.fetch = realFetch;
    });
    return calls;
}

const json = (body, extra = {}) =>
    new Response(JSON.stringify(body), {
        headers: { "content-type": "application/json" },
        ...extra,
    });
const redirectTo = (location, status = 302) =>
    new Response(null, { headers: { location }, status });

test("proxy upstream: an instance serving strangers never fetches an address on its own network", async (t) => {
    clearCache();
    instanceType(t, "public");
    let hits = 0;
    const internal = await listen(t, (_req, res) => {
        hits++;
        res.end("internal");
    });
    for (const manifestUrl of [
        `${internal}/manifest.json`,
        "http://192.168.1.10:7000/manifest.json",
        "http://169.254.169.254/latest/manifest.json",
        "http://[::1]:7000/manifest.json",
    ]) {
        const base = await mountProxyFor(t, manifestUrl);
        const res = await get(`${base}/catalog/movie/top.json`);
        assert.equal(res.status, 403, manifestUrl);
        assert.deepEqual(JSON.parse(res.body), { error: "Upstream address is not allowed" });
    }
    assert.equal(hits, 0, "nothing was sent to the internal server");
});

test("proxy upstream: a public addon that redirects to an internal address is not followed", async (t) => {
    clearCache();
    instanceType(t, "public");
    resolveTo(t, { "addon.example": ["93.184.216.34"] });
    const calls = stubUpstream(t, (url) => {
        if (url === "https://addon.example/to-metadata.json") {
            return redirectTo("http://169.254.169.254/latest/meta-data/");
        }
        if (url === "https://addon.example/to-lan.json") {
            return redirectTo("/hop", 307);
        }
        if (url === "https://addon.example/hop") {
            return redirectTo("http://10.0.0.5:8080/admin");
        }
        return json({ ok: true });
    });
    const base = await mountProxyFor(t, "https://addon.example/manifest.json");
    for (const path of ["to-metadata.json", "to-lan.json"]) {
        const res = await get(`${base}/${path}`);
        assert.equal(res.status, 403, path);
    }
    assert.ok(
        !calls.some((c) => c.url.includes("169.254") || c.url.includes("10.0.0.5")),
        "neither internal address was asked"
    );
});

test("proxy upstream: an ordinary redirect on a public addon is followed, and what the app relies on is unchanged", async (t) => {
    clearCache();
    instanceType(t, "public");
    resolveTo(t, { "addon.example": ["93.184.216.34"], "cdn.example": ["93.184.216.35"] });
    const calls = stubUpstream(t, (url, _init) => {
        if (url === "https://addon.example/moved.json") {
            return redirectTo("https://cdn.example/moved.json", 301);
        }
        if (url === "https://cdn.example/moved.json") {
            return json({ metas: [{ id: "tt0000001" }] });
        }
        if (url === "https://addon.example/logo.png") {
            return new Response(Buffer.alloc(300, 9), { headers: { "content-type": "image/png" } });
        }
        return new Response("nope", { status: 404 });
    });
    const base = await mountProxyFor(t, "https://addon.example/manifest.json");

    const first = await get(`${base}/moved.json`);
    assert.equal(first.status, 200);
    assert.match(first.headers["content-type"], /json/);
    assert.deepEqual(JSON.parse(first.body), { metas: [{ id: "tt0000001" }] });
    assert.equal(first.headers["x-proxy-cache"], "MISS");
    assert.equal(calls[0].init.method, "GET");
    assert.equal(calls[0].init.headers["User-Agent"], "SlickSync-Proxy/1.0");
    assert.equal((await get(`${base}/moved.json`)).headers["x-proxy-cache"], "HIT");

    const png = await get(`${base}/logo.png`);
    assert.equal(png.status, 200);
    assert.equal(png.headers["content-type"], "image/png");
    assert.equal(png.body.length, 300);

    const missing = await get(`${base}/gone.json`);
    assert.equal(missing.status, 404, "the addon's own status still reaches the player");
});

test("proxy upstream: a household install still reaches an addon on its own network, but never link-local", async (t) => {
    clearCache();
    instanceType(t, "private");
    let hits = 0;
    const local = await listen(t, (_req, res) => {
        hits++;
        res.writeHead(200, { "content-type": "application/json" });
        res.end('{"metas":[]}');
    });
    const lan = await mountProxyFor(t, `${local}/manifest.json`);
    assert.equal((await get(`${lan}/catalog/movie/lan.json`)).status, 200);
    assert.equal(hits, 1);

    const metadata = await mountProxyFor(t, "http://169.254.169.254/latest/manifest.json");
    const res = await get(`${metadata}/catalog/movie/top.json`);
    assert.equal(res.status, 403);
});

test("proxy upstream: an address that cannot be looked up or reached is still a 502, not a refusal", async (t) => {
    clearCache();
    instanceType(t, "public");
    resolveTo(t, {});
    const base = await mountProxyFor(t, "https://gone.example/manifest.json");
    const res = await get(`${base}/catalog/movie/top.json`);
    assert.equal(res.status, 502);
    assert.deepEqual(JSON.parse(res.body), { error: "Failed to fetch from upstream addon" });
});
