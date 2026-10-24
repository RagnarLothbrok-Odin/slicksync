// The poster proxy (/api/img). A poster host that is itself public can answer
// with a redirect to an address the server must not fetch, so every hop is
// checked; and when the proxy cannot produce an image it hands the device the
// original address - which must not work as a way to send a person's browser
// somewhere from this site's own domain.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const dns = require("node:dns").promises;
const express = require("express");

const png = fs.readFileSync(
    path.join(
        require("node:path").dirname(module.filename),
        "..",
        "client",
        "public",
        "favicon-16x16.png"
    )
);
const cwd = process.cwd();
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "slicksync-imgredirect-"));
process.chdir(tmp); // the poster cache lives under the working directory

const config = require("../server/utils/config");
const realFetch = global.fetch;
const configuredType = config.INSTANCE_TYPE;
let ownBase = "";
let server;

test.before(async () => {
    const prisma = {
        user: { findMany: async () => [] },
        userProviderCredential: { findMany: async () => [] },
    };
    const app = express();
    app.use("/api/img", require("../server/routes/imageCache")({ prisma }));
    await new Promise((resolve) => {
        server = app.listen(0, "127.0.0.1", resolve);
    });
    ownBase = `http://127.0.0.1:${server.address().port}`;
});
test.after(() => {
    server.close();
    process.chdir(cwd);
    fs.rmSync(tmp, { force: true, recursive: true });
});

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

// Replaces the server's outgoing fetch; requests to the test's own app go
// through, and so does anything that isn't a web address - the WebP encoder
// loads its own .wasm file with fetch(file://...) the first time it runs.
function stubUpstream(t, handler) {
    const calls = [];
    global.fetch = (url, init) => {
        if (String(url).startsWith(ownBase) || !/^https?:/i.test(String(url))) {
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

const image = () => new Response(png, { headers: { "content-type": "image/png" } });
const redirect = (location, statusLocal = 302) =>
    new Response(null, { headers: { location }, status: statusLocal });

// What a browser or a device would see: the redirect itself, not where it
// leads. node:http rather than fetch, because fetch sets its own Sec-Fetch-*
// headers and would overwrite the ones a test wants to send.
const get = (src, headers = {}) =>
    new Promise((resolve, reject) => {
        const req = http.get(
            `${ownBase}/api/img?src=${encodeURIComponent(src)}&w=64`,
            { headers },
            (res) => {
                res.resume();
                res.on("end", () =>
                    resolve({
                        headers: { get: (name) => res.headers[name.toLowerCase()] ?? null },
                        status: res.statusCode,
                    })
                );
            }
        );
        req.on("error", reject);
    });

test("a poster host that redirects to an internal address is not followed", async (t) => {
    instanceType(t, "public");
    resolveTo(t, { "cdn.example": ["93.184.216.34"] });
    const calls = stubUpstream(t, (url) => {
        if (url === "https://cdn.example/to-metadata.png") {
            return redirect("http://169.254.169.254/latest/meta-data/");
        }
        if (url === "https://cdn.example/to-loopback.png") {
            return redirect("/hop", 307);
        }
        if (url === "https://cdn.example/hop") {
            return redirect("http://127.0.0.1:9/secret.png");
        }
        return image();
    });
    for (const name of ["to-metadata.png", "to-loopback.png"]) {
        const src = `https://cdn.example/${name}`;
        const res = await get(src);
        assert.equal(res.status, 302, name);
        assert.equal(
            res.headers.get("location"),
            src,
            "the device is handed the original address, as for any poster that cannot be produced"
        );
    }
    assert.ok(!calls.includes("http://169.254.169.254/latest/meta-data/"));
    assert.ok(!calls.includes("http://127.0.0.1:9/secret.png"));
    // A refusal is final: the first address was asked once, not retried.
    assert.equal(calls.filter((u) => u === "https://cdn.example/to-metadata.png").length, 1);
});

test("a household install holds a redirect to the same rule as the address itself: not to its LAN, loopback or link-local", async (t) => {
    instanceType(t, "private");
    resolveTo(t, { "cdn.example": ["93.184.216.34"], "tail.example": ["100.101.102.103"] });
    const calls = stubUpstream(t, (url) => {
        if (url === "https://cdn.example/to-lan.png") {
            return redirect("http://10.0.0.5:8080/poster.png");
        }
        if (url === "https://cdn.example/to-loopback.png") {
            return redirect("http://127.0.0.1:9/poster.png");
        }
        if (url === "https://cdn.example/to-metadata-private.png") {
            return redirect("http://169.254.169.254/latest/meta-data/");
        }
        if (url === "https://cdn.example/to-tailnet.png") {
            return redirect("http://tail.example/poster.png");
        }
        return image();
    });
    for (const name of ["to-lan.png", "to-loopback.png", "to-metadata-private.png"]) {
        calls.length = 0;
        const res = await get(`https://cdn.example/${name}`);
        assert.equal(res.status, 302, name);
        assert.deepEqual(
            calls,
            [`https://cdn.example/${name}`],
            `${name}: the hop was never requested`
        );
    }

    calls.length = 0;
    const tailnet = await get("https://cdn.example/to-tailnet.png");
    assert.equal(tailnet.status, 200, "a hop to a tailnet address is still followed");
    assert.deepEqual(calls, [
        "https://cdn.example/to-tailnet.png",
        "http://tail.example/poster.png",
    ]);
});

test("ordinary poster-host redirects still resolve, up to five hops", async (t) => {
    instanceType(t, "public");
    resolveTo(t, { "cdn.example": ["93.184.216.34"], "img.example": ["93.184.216.35"] });
    const calls = stubUpstream(t, (url) => {
        if (url === "http://cdn.example/p.png") {
            return redirect("https://cdn.example/p.png", 301);
        }
        if (url === "https://cdn.example/p.png") {
            return redirect("/eu/p.png");
        }
        if (url === "https://cdn.example/eu/p.png") {
            return redirect("https://img.example/p.png?size=small", 308);
        }
        return image();
    });
    const res = await get("http://cdn.example/p.png");
    assert.equal(res.status, 200);
    assert.match(res.headers.get("content-type"), /^image\//);
    assert.deepEqual(calls, [
        "http://cdn.example/p.png",
        "https://cdn.example/p.png",
        "https://cdn.example/eu/p.png",
        "https://img.example/p.png?size=small",
    ]);
});

test("five redirects in a row still resolve, a sixth does not", async (t) => {
    instanceType(t, "public");
    resolveTo(t, { "cdn.example": ["93.184.216.34"] });
    const calls = stubUpstream(t, (url) => {
        const m = /^https:\/\/cdn\.example\/(five|six)\/(\d)\.png$/.exec(url);
        if (!m) {
            return image();
        }
        const last = m[1] === "five" ? 5 : 6;
        return Number(m[2]) < last ? redirect(`/${m[1]}/${Number(m[2]) + 1}.png`) : image();
    });
    const five = await get("https://cdn.example/five/0.png");
    assert.equal(five.status, 200);
    assert.equal(calls.length, 6);

    const six = await get("https://cdn.example/six/0.png");
    assert.equal(six.status, 302, "given back to the device rather than followed forever");
});

test("a poster that cannot be produced is handed to a device, and refused to a navigation", async (t) => {
    instanceType(t, "public");
    resolveTo(t, { "cdn.example": ["93.184.216.34"] });
    stubUpstream(t, () => new Response("blocked", { status: 403 }));
    const cases = [
        ["an animated gif, never fetched", "https://cdn.example/anim.gif"],
        ["a vector logo, never fetched", "https://cdn.example/logo.svg?v=2"],
        ["a poster the host turns this server away from", "https://cdn.example/refused.png"],
    ];
    for (const [label, src] of cases) {
        // An <img> in a page or a native client: redirected, as before.
        for (const headers of [
            {},
            { "sec-fetch-dest": "image", "sec-fetch-mode": "no-cors" },
            { "sec-fetch-dest": "empty", "sec-fetch-mode": "cors" },
        ]) {
            const res = await get(src, headers);
            assert.equal(res.status, 302, `${label} ${JSON.stringify(headers)}`);
            assert.equal(res.headers.get("location"), src);
        }
        // A person (or a link someone sent them) opening the address itself.
        for (const headers of [
            { "sec-fetch-mode": "navigate" },
            { "sec-fetch-dest": "document" },
            { "sec-fetch-dest": "document", "sec-fetch-mode": "navigate" },
        ]) {
            const res = await get(src, headers);
            assert.equal(res.status, 404, `${label} ${JSON.stringify(headers)}`);
            assert.equal(res.headers.get("location"), null);
            assert.equal(res.headers.get("cache-control"), "no-store");
        }
    }
});

test("a navigation to a poster that can be produced still gets the image", async (t) => {
    instanceType(t, "public");
    resolveTo(t, { "cdn.example": ["93.184.216.34"] });
    stubUpstream(t, () => image());
    const res = await get("https://cdn.example/fine.png", {
        "sec-fetch-dest": "document",
        "sec-fetch-mode": "navigate",
    });
    assert.equal(res.status, 200);
    assert.match(res.headers.get("content-type"), /^image\//);
});

test("a server error from the poster host is still retried before giving up", async (t) => {
    instanceType(t, "public");
    resolveTo(t, { "cdn.example": ["93.184.216.34"] });
    let attempts = 0;
    const calls = stubUpstream(t, () =>
        ++attempts === 1 ? new Response("busy", { status: 503 }) : image()
    );
    const res = await get("https://cdn.example/flaky.png");
    assert.equal(res.status, 200);
    assert.equal(calls.length, 2);
});

// ---- the entry check, per install -------------------------------------------

// The status and body of the route itself, not where it redirects.
const status = (src) =>
    new Promise((resolve, reject) => {
        http.get(`${ownBase}/api/img?src=${encodeURIComponent(src)}&w=64`, (res) => {
            res.resume();
            res.on("end", () => resolve(res.statusCode));
        }).on("error", reject);
    });

test("a household install still fetches a poster from a tailnet or fake-IP address; a LAN or loopback one is still turned away", async (t) => {
    instanceType(t, "private");
    resolveTo(t, {
        "both.example": ["100.101.102.103", "127.0.0.1"],
        "lan.example": ["192.168.1.20"],
        "proxied.example": ["198.18.0.7"],
        "tailnet.example": ["100.101.102.103"],
    });
    const calls = stubUpstream(t, () => image());
    for (const src of [
        "http://100.101.102.103:8080/poster.png",
        "http://tailnet.example/poster.png",
        "http://proxied.example/poster.png",
        "http://198.18.0.7/poster.png",
    ]) {
        assert.equal(await status(src), 200, src);
    }
    assert.equal(calls.length, 4, "each of them was actually fetched");

    calls.length = 0;
    for (const src of [
        "http://10.0.0.5/poster.png",
        "http://192.168.1.20/poster.png",
        "http://lan.example/poster.png",
        "http://127.0.0.1:9/poster.png",
        "http://169.254.169.254/latest/meta-data/",
        "http://both.example/poster.png",
        "http://nas.local/poster.png",
        "http://localhost/poster.png",
        "http://[fd12::5]/poster.png",
    ]) {
        assert.equal(await status(src), 400, src);
    }
    assert.deepEqual(calls, [], "nothing was sent to any of them");
});

test("an instance serving strangers refuses tailnet and fake-IP addresses too", async (t) => {
    instanceType(t, "public");
    resolveTo(t, { "tailnet.example": ["100.101.102.103"] });
    const calls = stubUpstream(t, () => image());
    // Other paths than the household test used: a poster already in the cache is served before the address is looked at.
    for (const src of [
        "http://100.101.102.103:8080/public-check.png",
        "http://tailnet.example/public-check.png",
        "http://198.18.0.7/public-check.png",
        "http://100.100.100.200/latest/meta-data/",
    ]) {
        assert.equal(await status(src), 400, src);
    }
    assert.deepEqual(calls, []);
});

test("a name with a tailnet IPv4 and a Tailscale IPv6 address is fetched on a household install, and refused on a public one", async (t) => {
    resolveTo(t, {
        "box.example": ["100.101.102.103", "fd7a:115c:a1e0::1234"],
        "other.example": ["100.101.102.103", "fd12::5"],
    });
    const calls = stubUpstream(t, () => image());
    instanceType(t, "private");
    assert.equal(await status("http://box.example/dual.png"), 200);
    assert.equal(
        await status("http://other.example/dual.png"),
        400,
        "one address outside those ranges is still enough to refuse it"
    );
    assert.equal(calls.length, 1);
    config.INSTANCE_TYPE = "public";
    assert.equal(await status("http://box.example/dual-public.png"), 400);
    assert.equal(calls.length, 1);
});

test("the pre-warmer applies the same entry check as the route on both kinds of install", async (t) => {
    resolveTo(t, { "lan.example": ["192.168.1.20"], "proxied.example": ["198.18.0.7"] });
    const calls = stubUpstream(t, () => image());
    const core = require("../server/utils/imageCacheCore");
    instanceType(t, "private");
    assert.equal(
        await core.warm("http://proxied.example/warm.png", 64),
        true,
        "a fake-IP host is warmed on a household install"
    );
    await assert.rejects(core.warm("http://lan.example/warm.png", 64), /blocked host/);
    config.INSTANCE_TYPE = "public";
    await assert.rejects(core.warm("http://proxied.example/warm-public.png", 64), /blocked host/);
    assert.equal(calls.length, 1);
});
