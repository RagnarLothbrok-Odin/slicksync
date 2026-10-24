const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");
const dns = require("node:dns").promises;

// The proxy writes a line per request to a log file; keep that out of the
// repository's own logs folder.
process.env.LOG_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "streamproxy-test-"));

const express = require("express");
const config = require("../server/utils/config");
const streamProxyFactory = require("../server/routes/streamProxy");
const usersRouter = require("../server/routes/users");

const realFetch = global.fetch;

// "private" is a household's own install, "public" one serving strangers.
function instance(t, type) {
    const before = config.INSTANCE_TYPE;
    config.INSTANCE_TYPE = type;
    t.after(() => {
        config.INSTANCE_TYPE = before;
    });
}

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

// Answers each outgoing request from the handler and remembers what was asked.
// A real fetch reports the address it asked for in `url`; so does this.
function stubFetch(t, handler) {
    const calls = [];
    global.fetch = async (url, init = {}) => {
        calls.push({ init, url: String(url) });
        const res = await handler(String(url), init);
        Object.defineProperty(res, "url", { value: String(url) });
        return res;
    };
    t.after(() => {
        global.fetch = realFetch;
    });
    return calls;
}

const redirect = (location, status = 302) => new Response(null, { headers: { location }, status });

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

// The proxy talks a lot on the console; the tests do not need to hear it.
function quiet(t) {
    const saved = { error: console.error, log: console.log, warn: console.warn };
    console.log = console.warn = console.error = () => undefined;
    t.after(() => Object.assign(console, saved));
}

function makeProxy(t) {
    quiet(t);
    const key = crypto.randomBytes(32);
    return { key, proxy: streamProxyFactory({ getServerKey: () => key }) };
}

// The stream proxy mounted the way index.js mounts it.
async function mount(t) {
    const { proxy, key } = makeProxy(t);
    const app = express();
    app.use("/stream", proxy.router);
    const base = await listen(t, app);
    return {
        base: `${base}/stream`,
        key,
        proxy,
        url: (target) => `${base}/stream/${proxy.encryptStreamUrl(target, key)}`,
    };
}

// A player: one request, the whole answer (or the fact that it was cut off).
function play(url, headers = {}) {
    return new Promise((resolve, reject) => {
        const req = http.request(url, { agent: false, headers }, (res) => {
            const chunks = [];
            res.on("data", (c) => chunks.push(c));
            res.on("end", () =>
                resolve({
                    body: Buffer.concat(chunks).toString(),
                    headers: res.headers,
                    status: res.statusCode,
                })
            );
            res.on("aborted", () =>
                resolve({
                    aborted: true,
                    body: Buffer.concat(chunks).toString(),
                    headers: res.headers,
                    status: res.statusCode,
                })
            );
            res.on("error", () =>
                resolve({ aborted: true, headers: res.headers, status: res.statusCode })
            );
        });
        req.on("error", reject);
        req.end();
    });
}

const streamsBody = (...streams) => ({ streams });
const SLICK = "https://slick.example";

// ---- links handed out to the player -------------------------------------

test("processStreamResponse: an instance serving strangers hands out no link for an internal address, and never calls it", async (t) => {
    instance(t, "public");
    resolveTo(t, { "intranet.example": ["10.0.0.5"] });
    const calls = stubFetch(t, () => {
        throw new Error("nothing should be fetched");
    });
    const { proxy, key } = makeProxy(t);

    const urls = [
        "http://127.0.0.1:11470/v.mkv",
        "http://169.254.169.254/latest/meta-data/",
        "http://10.0.0.5/x",
        "http://192.168.1.5:8096/v",
        "file:///etc/passwd",
        "http://intranet.example/v.mkv",
    ];
    const input = streamsBody(...urls.map((url) => ({ url })), {
        externalUrl: "http://192.168.1.5/page",
    });
    const out = JSON.parse(await proxy.processStreamResponse(input, key, SLICK));

    // Left as the addon sent them: the player can still try them from its own network.
    assert.deepEqual(
        out.streams.slice(0, urls.length).map((s) => s.url),
        urls
    );
    assert.equal(out.streams[urls.length].externalUrl, "http://192.168.1.5/page");
    assert.equal(calls.length, 0);
});

test("processStreamResponse: a public address is followed through its redirects and the last one is what gets sealed", async (t) => {
    instance(t, "public");
    resolveTo(t, { "cdn.example": ["93.184.216.34"], "files.example": ["93.184.216.35"] });
    const calls = stubFetch(t, (url) => {
        if (url === "https://cdn.example/start") {
            return redirect("/hop");
        }
        if (url === "https://cdn.example/hop") {
            return redirect("https://files.example/movie.mkv", 307);
        }
        return new Response("video", { status: 200 });
    });
    const { proxy, key } = makeProxy(t);

    const out = JSON.parse(
        await proxy.processStreamResponse(
            streamsBody({ url: "https://cdn.example/start" }),
            key,
            SLICK
        )
    );
    assert.ok(out.streams[0].url.startsWith(`${SLICK}/stream/`));
    assert.equal(
        proxy.decryptStreamUrl(out.streams[0].url.slice(`${SLICK}/stream/`.length), key),
        "https://files.example/movie.mkv"
    );
    assert.deepEqual(
        calls.map((c) => c.url),
        ["https://cdn.example/start", "https://cdn.example/hop", "https://files.example/movie.mkv"]
    );
    assert.ok(
        calls.every((c) => c.init.redirect === "manual"),
        "redirects are followed by the guard, one hop at a time"
    );
});

test("processStreamResponse: a public address that redirects to an internal one gets no link, and the internal one is never called", async (t) => {
    instance(t, "public");
    resolveTo(t, { "cdn.example": ["93.184.216.34"], "sneaky.example": ["10.0.0.5"] });
    const { proxy, key } = makeProxy(t);
    for (const target of [
        "http://169.254.169.254/latest/meta-data/",
        "http://127.0.0.1:4000/api/users",
        "http://[::1]/x",
        "https://sneaky.example/x",
    ]) {
        const calls = stubFetch(t, () => redirect(target));
        const out = JSON.parse(
            await proxy.processStreamResponse(
                streamsBody({
                    externalUrl: "https://cdn.example/page",
                    url: "https://cdn.example/start",
                }),
                key,
                SLICK
            )
        );
        assert.equal(out.streams[0].url, "https://cdn.example/start", target);
        assert.equal(out.streams[0].externalUrl, "https://cdn.example/page", target);
        assert.ok(
            calls.every((c) => c.url.startsWith("https://cdn.example/")),
            `only the public host was called for ${target}`
        );
    }
});

test("processStreamResponse: a household install may stream from its own network, but never from link-local", async (t) => {
    instance(t, "private");
    resolveTo(t, { aiostreams: ["172.18.0.5"] });
    const calls = stubFetch(t, () => new Response("video", { status: 200 }));
    const { proxy, key } = makeProxy(t);

    const lan = [
        "http://192.168.1.20:8096/Videos/1/stream.mkv",
        "http://127.0.0.1:11470/stream",
        "http://aiostreams:3000/stream/x",
    ];
    const out = JSON.parse(
        await proxy.processStreamResponse(streamsBody(...lan.map((url) => ({ url }))), key, SLICK)
    );
    out.streams.forEach((s, i) => {
        assert.ok(s.url.startsWith(`${SLICK}/stream/`), lan[i]);
        assert.equal(proxy.decryptStreamUrl(s.url.slice(`${SLICK}/stream/`.length), key), lan[i]);
    });

    calls.length = 0;
    const meta = JSON.parse(
        await proxy.processStreamResponse(
            streamsBody({ url: "http://169.254.169.254/latest/meta-data/" }),
            key,
            SLICK
        )
    );
    assert.equal(meta.streams[0].url, "http://169.254.169.254/latest/meta-data/");
    assert.equal(calls.length, 0);
});

test("processStreamResponse: a host that is only slow or down still gets a link when its address is fine", async (t) => {
    instance(t, "public");
    resolveTo(t, { "cdn.example": ["93.184.216.34"] });
    stubFetch(t, () => {
        throw new TypeError("fetch failed");
    });
    const { proxy, key } = makeProxy(t);

    const out = JSON.parse(
        await proxy.processStreamResponse(
            streamsBody(
                { url: "https://cdn.example/movie.mkv" },
                { url: "https://gone.example/movie.mkv" }
            ),
            key,
            SLICK
        )
    );
    assert.equal(
        proxy.decryptStreamUrl(out.streams[0].url.slice(`${SLICK}/stream/`.length), key),
        "https://cdn.example/movie.mkv"
    );
    // A name that does not resolve cannot be vouched for, so it gets no link.
    assert.equal(out.streams[1].url, "https://gone.example/movie.mkv");
});

// ---- playing a link -------------------------------------------------------

test("a stream link to an internal address is refused when played on an instance serving strangers", async (t) => {
    instance(t, "public");
    let upstreamHits = 0;
    const upstream = await listen(t, (_req, res) => {
        upstreamHits++;
        res.end("secret");
    });
    const { url } = await mount(t);

    const answer = await play(url(`${upstream}/movie.mkv`));
    assert.equal(answer.status, 403);
    assert.deepEqual(JSON.parse(answer.body), { error: "This stream address cannot be used" });
    assert.equal(upstreamHits, 0);
});

test("a link whose host now redirects to an internal address is refused at play time, on the hop that is internal", async (t) => {
    instance(t, "public");
    resolveTo(t, { "cdn.example": ["93.184.216.34"] });
    const calls = stubFetch(t, () => redirect("http://169.254.169.254/latest/meta-data/iam"));
    const { url } = await mount(t);

    const answer = await play(url("https://cdn.example/movie.mkv"));
    assert.equal(answer.status, 403);
    assert.deepEqual(
        calls.map((c) => c.url),
        ["https://cdn.example/movie.mkv"]
    );
});

test("link-local and non-web addresses are refused on a household install too", async (t) => {
    instance(t, "private");
    const calls = stubFetch(t, () => {
        throw new Error("nothing should be fetched");
    });
    const { url } = await mount(t);

    for (const target of [
        "http://169.254.169.254/latest/meta-data/",
        "http://[fe80::1]/x",
        "file:///etc/passwd",
        "ftp://example.com/x",
    ]) {
        const answer = await play(url(target));
        assert.equal(answer.status, 403, target);
    }
    assert.equal(calls.length, 0);
});

test("a link that does not decrypt is still a 400", async (t) => {
    const { base } = await mount(t);
    const answer = await play(`${base}/not-a-link`);
    assert.equal(answer.status, 400);
});

test("a household install streams from its own network: whole file, byte ranges and the headers players use", async (t) => {
    instance(t, "private");
    const FILE = "0123456789";
    const seen = [];
    const upstream = await listen(t, (req, res) => {
        seen.push({ range: req.headers.range, url: req.url });
        const m = /^bytes=(\d+)-(\d+)$/.exec(req.headers.range || "");
        const common = {
            "accept-ranges": "bytes",
            "cache-control": "max-age=60",
            "content-type": "video/x-matroska",
            etag: '"abc123"',
            "last-modified": "Wed, 01 Jan 2025 00:00:00 GMT",
        };
        if (m) {
            const part = FILE.slice(Number(m[1]), Number(m[2]) + 1);
            res.writeHead(206, {
                ...common,
                "content-length": String(part.length),
                "content-range": `bytes ${m[1]}-${m[2]}/${FILE.length}`,
            });
            res.end(part);
        } else {
            res.writeHead(200, { ...common, "content-length": String(FILE.length) });
            res.end(FILE);
        }
    });
    const { url } = await mount(t);
    const link = url(`${upstream}/dir/Movie.2020.mkv`);

    const whole = await play(link);
    assert.equal(whole.status, 200);
    assert.equal(whole.body, FILE);
    assert.equal(whole.headers["content-type"], "video/x-matroska");
    assert.equal(whole.headers["content-length"], "10");
    assert.equal(whole.headers["accept-ranges"], "bytes");
    assert.equal(whole.headers.etag, '"abc123"');
    assert.equal(whole.headers["last-modified"], "Wed, 01 Jan 2025 00:00:00 GMT");
    assert.equal(whole.headers["cache-control"], "max-age=60");
    assert.equal(whole.headers["content-disposition"], 'inline; filename="Movie.2020.mkv"');
    assert.equal(whole.headers["access-control-allow-origin"], "*");

    const part = await play(link, { Range: "bytes=2-5" });
    assert.equal(part.status, 206);
    assert.equal(part.body, "2345");
    assert.equal(part.headers["content-range"], "bytes 2-5/10");
    assert.equal(part.headers["content-length"], "4");
    assert.equal(seen[1].range, "bytes=2-5");
});

test("a redirect on the way to the file is followed and the byte range goes with it", async (t) => {
    instance(t, "private");
    const seen = [];
    const upstream = await listen(t, (req, res) => {
        seen.push({ range: req.headers.range, url: req.url });
        if (req.url === "/start") {
            res.writeHead(302, { location: "/real/final.mp4" });
            return res.end();
        }
        res.writeHead(206, {
            "content-length": "4",
            "content-range": "bytes 4-7/10",
            "content-type": "video/mp4",
        });
        res.end("4567");
    });
    const { url } = await mount(t);

    const answer = await play(url(`${upstream}/start`), { Range: "bytes=4-7" });
    assert.equal(answer.status, 206);
    assert.equal(answer.body, "4567");
    assert.deepEqual(seen, [
        { range: "bytes=4-7", url: "/start" },
        { range: "bytes=4-7", url: "/real/final.mp4" },
    ]);
    // The filename comes from where the redirect ended, not where it began.
    assert.equal(answer.headers["content-disposition"], 'inline; filename="final.mp4"');
});

test("an upstream that cannot be reached is a 502, not a crash", async (t) => {
    instance(t, "private");
    const { url } = await mount(t);
    // A port nothing listens on: take a free one and let it go.
    const probe = http.createServer();
    await new Promise((r) => probe.listen(0, "127.0.0.1", r));
    const dead = `http://127.0.0.1:${probe.address().port}/movie.mkv`;
    await new Promise((r) => probe.close(r));

    const answer = await play(url(dead));
    assert.equal(answer.status, 502);
    assert.deepEqual(JSON.parse(answer.body), { error: "Error fetching upstream content" });
});

test("the upstream request ends when the player goes away", async (t) => {
    instance(t, "private");
    let upstreamGone;
    const gone = new Promise((resolve) => {
        upstreamGone = resolve;
    });
    const upstream = await listen(t, (req, res) => {
        res.writeHead(200, { "content-type": "video/mp4" });
        const timer = setInterval(() => res.write(Buffer.alloc(16 * 1024, 1)), 5);
        // The socket, not the response: Bun reports a dropped connection there only.
        req.socket.on("close", () => {
            clearInterval(timer);
            upstreamGone();
        });
    });
    const { url } = await mount(t);

    await new Promise((resolve, reject) => {
        const req = http.request(url(`${upstream}/endless.mp4`), { agent: false }, (res) => {
            res.once("data", () => {
                req.destroy();
                resolve();
            });
            res.on("error", () => undefined);
        });
        req.on("error", () => undefined);
        req.setTimeout(5000, () => reject(new Error("no data from the proxy")));
        req.end();
    });

    const timeout = new Promise((_, reject) =>
        setTimeout(
            () => reject(new Error("upstream was still being read 4s after the player left")),
            4000
        ).unref()
    );
    await Promise.race([gone, timeout]);
});

test("an upstream that drops mid-file closes the player's connection and the proxy carries on", async (t) => {
    instance(t, "private");
    const upstream = await listen(t, (req, res) => {
        if (req.url === "/ok") {
            res.writeHead(200, { "content-length": "2" });
            return res.end("ok");
        }
        res.writeHead(200, { "content-length": "100000", "content-type": "video/mp4" });
        res.write(Buffer.alloc(1000, 1));
        setTimeout(() => res.destroy(), 20);
    });
    const { url } = await mount(t);

    const cut = await play(url(`${upstream}/cut.mp4`));
    assert.equal(cut.aborted, true);

    const after = await play(url(`${upstream}/ok`));
    assert.equal(after.status, 200);
    assert.equal(after.body, "ok");
});

// ---- the catalog preview (GET /users/:id/nuvio-catalog-preview) -----------------------

const TRAX_TOKEN = "ABCDEFGHIJKLMNOP1234";

// The users router over a fake database in which only SlickTrax tokens are known.
function previewRouter({ knownToken = null } = {}) {
    const prisma = {
        user: {
            findFirst: async ({ where }) =>
                where && where.traxToken === knownToken ? { id: "owner" } : null,
        },
    };
    return usersRouter({
        decrypt: (v) => v,
        encrypt: (v) => v,
        getAccountId: () => "acct",
        INSTANCE_TYPE: "private",
        prisma,
        scopedWhere: (_req, where) => where,
    });
}

async function preview(router, query) {
    const layer = router.stack.find(
        (l) => l.route && l.route.path === "/:id/nuvio-catalog-preview"
    );
    const res = { body: undefined, statusCode: 200 };
    res.status = (code) => {
        res.statusCode = code;
        return res;
    };
    res.json = (body) => {
        res.body = body;
        return res;
    };
    await layer.route.stack[0].handle({ params: { id: "user-1" }, query }, res);
    return res;
}

const CATALOG = {
    metas: [
        {
            description: "left out",
            id: "tt0000001",
            name: "A Film",
            poster: "https://img.example/a.jpg",
            type: "movie",
        },
    ],
};
const ITEMS = [
    { id: "tt0000001", name: "A Film", poster: "https://img.example/a.jpg", type: "movie" },
];

test("catalog preview: an instance serving strangers refuses its own network and link-local, and calls nothing", async (t) => {
    instance(t, "public");
    quiet(t);
    resolveTo(t, { "nowhere.example": [] });
    let hits = 0;
    const upstream = await listen(t, (_req, res) => {
        hits++;
        res.end(JSON.stringify(CATALOG));
    });
    const router = previewRouter();

    for (const addonUrl of [
        `${upstream}/manifest.json`,
        "http://169.254.169.254/latest/meta-data",
        "http://[::1]:4000",
        "http://10.0.0.5:7000/manifest.json",
        "file:///etc/passwd",
    ]) {
        const res = await preview(router, { addonUrl, catalogId: "top", type: "movie" });
        assert.equal(res.statusCode, 400, addonUrl);
        assert.deepEqual(res.body, { message: "That address can't be used" }, addonUrl);
    }
    const missing = await preview(router, {
        addonUrl: "https://nowhere.example/manifest.json",
        catalogId: "top",
        type: "movie",
    });
    assert.equal(missing.statusCode, 400);
    assert.deepEqual(missing.body, { message: "That address couldn't be found" });
    assert.equal(hits, 0);
});

test("catalog preview: a public addon that redirects to an internal address is refused on that hop", async (t) => {
    instance(t, "public");
    quiet(t);
    resolveTo(t, { "addon.example": ["93.184.216.34"] });
    const calls = stubFetch(t, () => redirect("http://169.254.169.254/latest/meta-data"));

    const res = await preview(previewRouter(), {
        addonUrl: "https://addon.example/manifest.json",
        catalogId: "top",
        type: "movie",
    });
    assert.equal(res.statusCode, 400);
    assert.deepEqual(
        calls.map((c) => c.url),
        ["https://addon.example/catalog/movie/top.json"]
    );
});

test("catalog preview: a household install previews an addon on its own network, with genre and redirects", async (t) => {
    instance(t, "private");
    quiet(t);
    const seen = [];
    const upstream = await listen(t, (req, res) => {
        seen.push(req.url);
        if (req.url === "/catalog/movie/top.json") {
            res.writeHead(302, { location: "/moved/top.json" });
            return res.end();
        }
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify(CATALOG));
    });
    const router = previewRouter();

    const plain = await preview(router, {
        addonUrl: `${upstream}/manifest.json`,
        catalogId: "top",
        type: "movie",
    });
    assert.equal(plain.statusCode, 200);
    assert.deepEqual(plain.body, { items: ITEMS });
    const genre = await preview(router, {
        addonUrl: upstream,
        catalogId: "top",
        genre: "Family",
        type: "movie",
    });
    assert.deepEqual(genre.body, { items: ITEMS });
    assert.deepEqual(seen, [
        "/catalog/movie/top.json",
        "/moved/top.json",
        "/catalog/movie/top/genre=Family.json",
    ]);
});

test("catalog preview: a household install still never reaches link-local, directly or by redirect", async (t) => {
    instance(t, "private");
    quiet(t);
    const upstream = await listen(t, (_req, res) => {
        res.writeHead(307, { location: "http://169.254.169.254/latest/meta-data" });
        res.end();
    });
    const router = previewRouter();

    for (const addonUrl of ["http://169.254.169.254/manifest.json", `${upstream}/manifest.json`]) {
        const res = await preview(router, { addonUrl, catalogId: "top", type: "movie" });
        assert.equal(res.statusCode, 400, addonUrl);
    }
});

test("catalog preview: a SlickTrax catalog is still read over loopback on an instance serving strangers", async (t) => {
    instance(t, "public");
    quiet(t);
    resolveTo(t, {});
    const seen = [];
    let own;
    const upstream = await listen(t, (req, resLocal) => {
        seen.push(req.url);
        resLocal.writeHead(200, { "content-type": "application/json" });
        resLocal.end(
            JSON.stringify({
                metas: [
                    {
                        id: "tt0000001",
                        name: "Listed",
                        poster: `${own}/trax/${TRAX_TOKEN}/poster/tt0000001.jpg`,
                        type: "movie",
                    },
                ],
            })
        );
    });
    own = upstream;
    const savedPort = process.env.PORT;
    process.env.PORT = String(new URL(upstream).port);
    t.after(() => {
        if (savedPort === undefined) {
            delete process.env.PORT;
        } else {
            process.env.PORT = savedPort;
        }
    });

    const res = await preview(previewRouter({ knownToken: TRAX_TOKEN }), {
        addonUrl: `https://slick.example/trax/${TRAX_TOKEN}/manifest.json`,
        catalogId: "list1",
        type: "movie",
    });
    assert.equal(res.statusCode, 200);
    assert.deepEqual(seen, [`/trax/${TRAX_TOKEN}/catalog/movie/list1.json`]);
    // The loopback origin is this container's, so the viewer gets the path only.
    assert.deepEqual(res.body.items, [
        {
            id: "tt0000001",
            name: "Listed",
            poster: `/trax/${TRAX_TOKEN}/poster/tt0000001.jpg`,
            type: "movie",
        },
    ]);

    // A token nobody on this instance owns is an ordinary address, and refused as one.
    const stranger = await preview(previewRouter(), {
        addonUrl: `https://slick.example/trax/${TRAX_TOKEN}/manifest.json`,
        catalogId: "list1",
        type: "movie",
    });
    assert.equal(stranger.statusCode, 400);
});

test("catalog preview: the required parameters are still required", async (_t) => {
    const res = await preview(previewRouter(), {
        addonUrl: "https://addon.example/manifest.json",
        type: "movie",
    });
    assert.equal(res.statusCode, 400);
    assert.deepEqual(res.body, { message: "addonUrl, type, and catalogId are required" });
});
