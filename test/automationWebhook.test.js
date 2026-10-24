// The "Call a webhook" automation action. Its URL and headers are free text and
// any account can write a rule, so what it may reach depends on the install:
// one serving strangers only calls public addresses, a household install may
// call its own network (Home Assistant, ntfy, n8n on the LAN) but not
// link-local. Redirects are held to the same rule, and the headers that
// describe the connection are not the rule's to set.
const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const dns = require("node:dns").promises;
const config = require("../server/utils/config");
const { ACTIONS } = require("../server/utils/automation/registry");
const { runActions } = require("../server/utils/automation/engine");

const webhook = (configLocal) =>
    ACTIONS.webhook.run({ config: configLocal, payload: { addonName: "Example Addon" } });

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

// A local server that records every request it gets.
function listen(t, handler) {
    const seen = [];
    return new Promise((resolve) => {
        const server = http.createServer((req, res) => {
            let body = "";
            req.on("data", (c) => {
                body += c;
            });
            req.on("end", () => {
                seen.push({ body, headers: req.headers, method: req.method, url: req.url });
                if (handler) {
                    return handler(req, res);
                }
                res.writeHead(200, { "content-type": "text/plain" });
                res.end("ok");
            });
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

test("webhook on an instance serving strangers: internal addresses are refused and nothing is sent", async (t) => {
    instanceType(t, "public");
    const target = await listen(t);
    for (const url of [
        `${target.url}/api/health`,
        "http://169.254.169.254/latest/meta-data/",
        "http://192.168.1.20:8123/api/webhook/x",
        "http://[::1]:4000/",
        "http://db.internal/hook",
    ]) {
        await assert.rejects(webhook({ url }), /only calls public addresses/, url);
    }
    assert.equal(target.seen.length, 0);
});

test("webhook on a public instance still calls a public address", async (t) => {
    instanceType(t, "public");
    resolveTo(t, { "hooks.example.com": ["93.184.216.34"] });
    const realFetch = global.fetch;
    const calls = [];
    global.fetch = async (url, init) => {
        calls.push({ init, url: String(url) });
        return new Response("ok");
    };
    t.after(() => {
        global.fetch = realFetch;
    });
    assert.equal(
        await webhook({ url: "https://hooks.example.com/hook/abc" }),
        "Called webhook (200)"
    );
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, "https://hooks.example.com/hook/abc");
    assert.equal(calls[0].init.method, "POST");
    assert.equal(calls[0].init.body, JSON.stringify({ addonName: "Example Addon" }));
});

test("webhook on a household install: its own network is reachable, link-local is not", async (t) => {
    instanceType(t, "private");
    const target = await listen(t);
    assert.equal(await webhook({ url: `${target.url}/api/webhook/x` }), "Called webhook (200)");
    assert.equal(target.seen.length, 1);
    assert.equal(target.seen[0].method, "POST");
    assert.equal(target.seen[0].url, "/api/webhook/x");
    assert.deepEqual(JSON.parse(target.seen[0].body), { addonName: "Example Addon" });

    await assert.rejects(
        webhook({ url: "http://169.254.169.254/latest/meta-data/" }),
        /never calls link-local addresses/
    );
    await assert.rejects(
        webhook({ url: "http://[fe80::1]/hook" }),
        /never calls link-local addresses/
    );
});

test("webhook: a redirect to an address that is not allowed is not followed", async (t) => {
    instanceType(t, "private");
    const toMetadata = await listen(t, (_req, res) => {
        res.writeHead(302, { location: "http://169.254.169.254/latest/meta-data/" });
        res.end();
    });
    await assert.rejects(
        webhook({ url: `${toMetadata.url}/go` }),
        /never calls link-local addresses/
    );
    assert.equal(toMetadata.seen.length, 1);

    instanceType(t, "public");
    resolveTo(t, { "hooks.example.com": ["93.184.216.34"] });
    const realFetch = global.fetch;
    const calls = [];
    global.fetch = async (url) => {
        calls.push(String(url));
        return new Response(null, {
            headers: { location: "http://10.0.0.5:8080/admin" },
            status: 307,
        });
    };
    t.after(() => {
        global.fetch = realFetch;
    });
    await assert.rejects(
        webhook({ url: "https://hooks.example.com/hook" }),
        /only calls public addresses/
    );
    assert.deepEqual(calls, ["https://hooks.example.com/hook"]);
});

const CONNECTION_LINES = [
    "Content-Length: 1",
    "Connection: keep-alive",
    "Transfer-Encoding: chunked",
    "Upgrade: websocket",
    "TE: trailers",
    "Trailer: X-Foo",
    "Keep-Alive: timeout=5",
    "Proxy-Authorization: Basic abc",
    "Proxy-Connection: keep-alive",
    "Expect: 100-continue",
];

test("webhook on an instance serving strangers: headers that describe the connection, name another host or carry a cookie are left out, the rest are sent", async (t) => {
    instanceType(t, "public");
    resolveTo(t, { "hooks.example.com": ["93.184.216.34"] });
    const realFetch = global.fetch;
    const calls = [];
    global.fetch = async (url, init) => {
        calls.push({ init, url: String(url) });
        return new Response("ok");
    };
    t.after(() => {
        global.fetch = realFetch;
    });
    const lines = [
        "Authorization: Bearer example-token",
        "X-Custom-Key: kept",
        "X_Underscore_Key: also kept",
        "HOST: other.example.com",
        "cOOkie: session=abc",
        ...CONNECTION_LINES,
        "no colon on this line",
    ];
    const result = await webhook({
        headers: lines.join("\r\n"),
        url: "https://hooks.example.com/hook",
    });
    assert.match(
        result,
        /^Called webhook \(200\); not sent: HOST, cOOkie, Content-Length, Connection, /,
        "the run log says which were left out"
    );
    const sent = calls[0].init.headers;
    assert.equal(sent.Authorization, "Bearer example-token");
    assert.equal(sent["X-Custom-Key"], "kept");
    assert.equal(sent.X_Underscore_Key, "also kept");
    assert.equal(sent["Content-Type"], "application/json");
    assert.deepEqual(Object.keys(sent).sort(), [
        "Authorization",
        "Content-Type",
        "X-Custom-Key",
        "X_Underscore_Key",
    ]);
});

test("webhook on a household install: Host and Cookie are sent as written, the connection headers still are not", async (t) => {
    instanceType(t, "private");
    const target = await listen(t);
    const lines = [
        "Authorization: Bearer example-token",
        "X-Custom-Key: kept",
        "HOST: ha.example.lan",
        "cOOkie: session=abc",
        ...CONNECTION_LINES,
    ];
    const result = await webhook({ headers: lines.join("\r\n"), url: `${target.url}/hook` });
    assert.match(
        result,
        /^Called webhook \(200\); not sent: Content-Length, Connection, Transfer-Encoding, /
    );
    assert.ok(
        !/HOST|cOOkie/.test(result),
        "nothing the rule set for Host or Cookie is reported as left out"
    );
    const sent = target.seen[0].headers;
    assert.equal(sent.authorization, "Bearer example-token");
    assert.equal(sent["x-custom-key"], "kept");
    assert.equal(sent["content-type"], "application/json");
    assert.equal(sent.cookie, "session=abc");
    assert.equal(
        sent["content-length"],
        String(Buffer.byteLength(target.seen[0].body)),
        "the length is the real body length"
    );
    for (const name of [
        "transfer-encoding",
        "upgrade",
        "te",
        "trailer",
        "proxy-authorization",
        "proxy-connection",
        "expect",
    ]) {
        assert.equal(sent[name], undefined, name);
    }

    // Host is handed to fetch as written. (Node's own fetch sets Host from the
    // URL whatever it is given; the runtime the server runs on honours it, so it
    // is the request this builds that is checked, not what Node puts on the wire.)
    const realFetch = global.fetch;
    const calls = [];
    global.fetch = async (url, init) => {
        calls.push({ init, url: String(url) });
        return new Response("ok");
    };
    t.after(() => {
        global.fetch = realFetch;
    });
    await webhook({
        headers: "Host: ha.example.lan\nCookie: session=abc",
        url: "http://192.168.1.20:8123/api/webhook/x",
    });
    assert.equal(calls[0].init.headers.Host, "ha.example.lan");
    assert.equal(calls[0].init.headers.Cookie, "session=abc");
});

test("webhook: with nothing left out the result reads as it always did", async (t) => {
    instanceType(t, "private");
    const target = await listen(t);
    assert.equal(
        await webhook({ headers: "X-Key: one", url: `${target.url}/hook` }),
        "Called webhook (200)"
    );
});

test("webhook: a header that cannot be sent as written fails the action with a clear message", async (t) => {
    instanceType(t, "private");
    const target = await listen(t);
    await assert.rejects(
        webhook({ headers: "Bad Name: x", url: `${target.url}/hook` }),
        /Invalid header "Bad Name"/
    );
    await assert.rejects(
        webhook({ headers: "X-Key: one\rInjected: two", url: `${target.url}/hook` }),
        /Invalid header "X-Key"/
    );
    assert.equal(target.seen.length, 0);
});

test("webhook: the existing messages are unchanged", async (t) => {
    instanceType(t, "private");
    const failing = await listen(t, (_req, res) => {
        res.writeHead(500);
        res.end();
    });
    await assert.rejects(webhook({ url: `${failing.url}/hook` }), /^Error: Webhook returned 500$/);
    await assert.rejects(webhook({}), /No webhook URL configured/);
    await assert.rejects(webhook({ url: "not a url" }), /Invalid webhook URL/);
    await assert.rejects(
        webhook({ url: "ftp://hooks.example.com/x" }),
        /Webhook URL must be http or https/
    );
});

test("a refused webhook fails only that action, with a plain message in the rule's own result", async (t) => {
    instanceType(t, "public");
    const target = await listen(t);
    const rule = {
        actions: JSON.stringify([
            { config: { url: `${target.url}/hook` }, type: "webhook" },
            { config: { url: "http://169.254.169.254/latest/meta-data/" }, type: "webhook" },
        ]),
    };
    const results = await runActions({}, "acc", rule, { addonName: "Example Addon" });
    assert.deepEqual(results, [
        {
            message: "Webhook address not allowed: this server only calls public addresses",
            ok: false,
            type: "webhook",
        },
        {
            message: "Webhook address not allowed: this server only calls public addresses",
            ok: false,
            type: "webhook",
        },
    ]);
    assert.equal(target.seen.length, 0);
});
