// A Nuvio backend address is typed in by whoever runs the account, and the
// server then sends that person's sign-in to it on every sync. On an instance
// serving strangers it must not be a way to reach the server's own network; a
// household's own install may point at a server on its LAN.
const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const dns = require("node:dns").promises;
const express = require("express");
const config = require("../server/utils/config");
const {
    backendAddressProblem,
    discoverNuvioBackend,
    resolveServerConfigForAccount,
} = require("../server/providers/supabase");
const makeSettingsRouter = require("../server/routes/settings");

const realFetch = global.fetch;

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

// Which kind of install this is, as the server reads it.
const INSTALLED_AS = config.INSTANCE_TYPE;
function instance(t, type) {
    config.INSTANCE_TYPE = type;
    t.after(() => {
        config.INSTANCE_TYPE = INSTALLED_AS;
    });
}

const DOC = { publishable_key: "pk-example", self_hosted: true, service: "nuvio", version: 1 };

// A server on this machine that counts what reaches it.
function listen(t, handler) {
    return new Promise((resolve) => {
        const hits = [];
        const server = http.createServer((req, res) => {
            hits.push(req.url);
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
            resolve({ base: `http://127.0.0.1:${server.address().port}`, hits });
        });
    });
}
const sendDoc = (_req, res) => {
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify(DOC));
};

test("an instance serving strangers refuses every internal address, and accepts a public one", async (t) => {
    instance(t, "public");
    resolveTo(t, {
        "backend.example.com": ["93.184.216.34"],
        "intranet.example": ["10.0.0.5"],
        "mixed.example": ["93.184.216.34", "127.0.0.1"],
    });
    for (const url of [
        "http://127.0.0.1:8000",
        "http://[::1]:8000",
        "http://169.254.169.254/",
        "http://10.0.0.5",
        "http://192.168.1.10:8000",
        "http://localhost:54321",
        "http://db.internal",
        "http://nas.local",
        "http://intranet.example",
        "http://mixed.example",
    ]) {
        assert.match(await backendAddressProblem(url), /not allowed to reach/, url);
    }
    assert.equal(await backendAddressProblem("https://backend.example.com"), null);
    assert.equal(await backendAddressProblem("https://8.8.8.8:8443/"), null);
});

test("an address that is not http(s) is refused on any install, with a plain message", async (t) => {
    resolveTo(t, {});
    for (const type of ["public", "private"]) {
        instance(t, type);
        for (const url of [
            "ftp://backend.example.com",
            "backend.example.com",
            "javascript:alert(1)",
            "file:///etc/passwd",
        ]) {
            assert.match(await backendAddressProblem(url), /starting with http/, `${type}: ${url}`);
        }
    }
});

test("a household install may point at its own network, but never at link-local", async (t) => {
    instance(t, "private");
    resolveTo(t, { "metadata.example": ["169.254.169.254"], "nuvio-backend": ["172.18.0.5"] });
    for (const url of [
        "http://192.168.1.10:8000",
        "http://127.0.0.1:54321",
        "http://10.0.0.5",
        "http://nuvio-backend:8000",
        "http://localhost:3000",
    ]) {
        assert.equal(await backendAddressProblem(url), null, url);
    }
    for (const url of [
        "http://169.254.169.254/",
        "http://metadata.example/",
        "http://[fe80::1]/",
    ]) {
        assert.match(await backendAddressProblem(url), /not allowed to reach/, url);
    }
});

test("a name that does not resolve right now is not refused - the backend may just be starting", async (t) => {
    resolveTo(t, {});
    for (const type of ["public", "private"]) {
        instance(t, type);
        assert.equal(await backendAddressProblem("http://starting.example:8000"), null, type);
    }
});

test("discovery on a public instance never sends a request to an internal address", async (t) => {
    instance(t, "public");
    const local = await listen(t, sendDoc);
    const result = await discoverNuvioBackend(local.base);
    assert.deepEqual([result.ok, result.refused], [false, true]);
    assert.match(result.error, /not allowed to reach/);
    assert.equal(local.hits.length, 0, "nothing reached the server");
});

test("discovery on a household install works against a server on its own machine", async (t) => {
    instance(t, "private");
    const local = await listen(t, sendDoc);
    const result = await discoverNuvioBackend(local.base);
    assert.equal(result.ok, true);
    assert.equal(result.anonKey, "pk-example");
    assert.deepEqual(local.hits, ["/.well-known/nuvio"]);
});

test("discovery does not follow a redirect to somewhere internal", async (t) => {
    resolveTo(t, { "backend.example.com": ["93.184.216.34"] });
    const asked = [];
    global.fetch = async (url) => {
        asked.push(String(url));
        return new Response(null, {
            headers: { location: "http://169.254.169.254/latest/meta-data/" },
            status: 302,
        });
    };
    t.after(() => {
        global.fetch = realFetch;
    });
    for (const type of ["public", "private"]) {
        instance(t, type);
        asked.length = 0;
        const result = await discoverNuvioBackend("https://backend.example.com");
        assert.deepEqual([result.ok, result.refused], [false, true], type);
        assert.deepEqual(
            asked,
            ["https://backend.example.com/.well-known/nuvio"],
            `${type}: the redirect was not requested`
        );
    }
});

test("discovery on a public instance still works against a public backend", async (t) => {
    instance(t, "public");
    resolveTo(t, { "backend.example.com": ["93.184.216.34"] });
    global.fetch = async () =>
        new Response(JSON.stringify({ ...DOC, backend_url: "https://backend.example.com/" }), {
            headers: { "content-type": "application/json" },
            status: 200,
        });
    t.after(() => {
        global.fetch = realFetch;
    });
    const result = await discoverNuvioBackend("https://backend.example.com");
    assert.deepEqual(result, {
        anonKey: "pk-example",
        ok: true,
        selfHosted: true,
        url: "https://backend.example.com",
    });
});

// What the account has saved, as the provider factory reads it.
const savedAs = (url, anonKey = "pk-example") => ({
    appAccount: {
        findUnique: async () => ({
            sync: JSON.stringify({ nuvioAnonKey: anonKey, nuvioServerUrl: url }),
        }),
    },
});

test("a saved address an instance serving strangers may not reach is not used", async (t) => {
    instance(t, "public");
    resolveTo(t, { "backend.example.com": ["93.184.216.34"], "rebound.example": ["10.0.0.5"] });
    t.mock.method(console, "warn", () => undefined);
    assert.equal(await resolveServerConfigForAccount(savedAs("http://10.0.0.5:8000"), "acc"), null);
    assert.equal(
        await resolveServerConfigForAccount(savedAs("http://rebound.example"), "acc"),
        null,
        "a name that now points inside"
    );
    assert.deepEqual(
        await resolveServerConfigForAccount(savedAs("https://backend.example.com"), "acc"),
        { anonKey: "pk-example", url: "https://backend.example.com" }
    );
});

test("a saved LAN address is used on a household install", async (t) => {
    instance(t, "private");
    resolveTo(t, { "nuvio-backend": ["172.18.0.5"], "starting.example": [] });
    t.mock.method(console, "warn", () => undefined);
    assert.deepEqual(
        await resolveServerConfigForAccount(savedAs("http://192.168.1.10:8000"), "acc"),
        { anonKey: "pk-example", url: "http://192.168.1.10:8000" }
    );
    assert.deepEqual(
        await resolveServerConfigForAccount(savedAs("http://nuvio-backend:8000"), "acc"),
        { anonKey: "pk-example", url: "http://nuvio-backend:8000" }
    );
    assert.equal(
        await resolveServerConfigForAccount(savedAs("http://169.254.169.254"), "acc"),
        null,
        "link-local never"
    );
    assert.equal(
        await resolveServerConfigForAccount(savedAs("http://192.168.1.10:8000", ""), "acc"),
        null,
        "half-filled is still ignored"
    );
});

// The routes. A public instance, with the account already resolved.
async function withSettingsRouter(t, prisma) {
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
        req.appAccountId = "acc";
        next();
    });
    app.use(
        "/settings",
        makeSettingsRouter({ getAccountId: () => "acc", INSTANCE_TYPE: "public", prisma })
    );
    const server = await new Promise((resolve) => {
        const s = app.listen(0, "127.0.0.1", () => resolve(s));
    });
    t.after(
        () =>
            new Promise((done) => {
                server.closeAllConnections?.();
                server.close(done);
            })
    );
    const base = `http://127.0.0.1:${server.address().port}/settings`;
    return async (method, path, body) => {
        const res = await realFetch(`${base}${path}`, {
            body: JSON.stringify(body),
            headers: { "content-type": "application/json" },
            method,
        });
        return { body: await res.json(), status: res.status };
    };
}

test("the discover route answers 400 with the reason when the address is one the server may not reach", async (t) => {
    instance(t, "public");
    const local = await listen(t, sendDoc);
    const call = await withSettingsRouter(t, {});
    const { status, body } = await call("POST", "/account-sync/discover-nuvio", {
        url: local.base,
    });
    assert.equal(status, 400);
    assert.equal(body.ok, false);
    assert.match(body.message, /not allowed to reach/);
    assert.equal(local.hits.length, 0);
});

test("the discover route answers an ordinary result for a backend that is just not there", async (t) => {
    instance(t, "public");
    resolveTo(t, { "backend.example.com": ["93.184.216.34"] });
    global.fetch = async (url, init) =>
        String(url).startsWith("http://127.0.0.1")
            ? realFetch(url, init)
            : new Response("nope", { status: 404 });
    t.after(() => {
        global.fetch = realFetch;
    });
    const call = await withSettingsRouter(t, {});
    const { status, body } = await call("POST", "/account-sync/discover-nuvio", {
        url: "https://backend.example.com",
    });
    assert.equal(status, 200);
    assert.deepEqual(body, { error: "Discovery endpoint returned 404", ok: false });
});

test("saving an internal backend address is refused with a 400 and nothing is stored", async (t) => {
    instance(t, "public");
    resolveTo(t, { "intranet.example": ["10.0.0.5"] });
    let writes = 0;
    const call = await withSettingsRouter(t, {
        appAccount: {
            findUnique: async () => ({ sync: "{}" }),
            update: async () => {
                writes++;
            },
        },
    });
    for (const url of [
        "http://127.0.0.1:8000",
        "http://169.254.169.254",
        "http://10.0.0.5",
        "http://intranet.example",
        "ftp://backend.example.com",
    ]) {
        const { status, body } = await call("PUT", "/account-sync", { nuvioServerUrl: url });
        assert.equal(status, 400, url);
        assert.ok(body.message, url);
    }
    assert.equal(writes, 0);
});

// The migration code's address is fetched by the server in the same way. That
// route only exists on a household's own install, so it is mounted as one,
// with the backup scheduler and the restore stood in for.
function stubModule(relative, exports) {
    const resolved = require.resolve(relative);
    require.cache[resolved] = { exports, filename: resolved, id: resolved, loaded: true };
}
const restores = [];
stubModule("../server/utils/backup", {
    BACKUP_DIR: "",
    clearBackupSchedule() {
        // This test double intentionally performs no external work.
    },
    ensureBackupDir() {
        // This test double intentionally performs no external work.
    },
    performBackupOnce() {
        // This test double intentionally performs no external work.
    },
    readBackupFrequencyDays: () => 0,
    scheduleBackups() {
        // This test double intentionally performs no external work.
    },
    writeBackupFrequencyDays() {
        // This test double intentionally performs no external work.
    },
});
stubModule("../server/utils/disasterRecoveryKit", {
    restoreKit: async (_prisma, accountId) => {
        restores.push(accountId);
        return { restored: true };
    },
});

async function receive(t, address) {
    instance(t, "private");
    const app = express();
    app.use(express.json());
    app.use(
        "/settings",
        makeSettingsRouter({ getAccountId: () => "default", INSTANCE_TYPE: "private", prisma: {} })
    );
    const server = await new Promise((resolve) => {
        const s = app.listen(0, "127.0.0.1", () => resolve(s));
    });
    t.after(
        () =>
            new Promise((done) => {
                server.closeAllConnections?.();
                server.close(done);
            })
    );
    const code = require("../server/routes/migration").encodeCode(address, "token-1", "phrase");
    const res = await realFetch(
        `http://127.0.0.1:${server.address().port}/settings/migration/receive`,
        {
            body: JSON.stringify({ code }),
            headers: { "content-type": "application/json" },
            method: "POST",
        }
    );
    return { body: await res.json(), status: res.status };
}

test("a migration code may point at a server on the same machine or LAN on a household install", async (t) => {
    restores.length = 0;
    const old = await listen(t, (_req, res) => {
        res.setHeader("content-type", "application/json");
        res.end(JSON.stringify({ kit: { version: 1 } }));
    });
    const { status, body } = await receive(t, old.base);
    assert.equal(status, 200, JSON.stringify(body));
    assert.deepEqual(old.hits, ["/api/migration/bundle?token=token-1"]);
    assert.deepEqual(restores, ["default"]);
});

test("a migration code is refused for link-local, and so is a redirect there, without a request going out", async (t) => {
    const asked = [];
    global.fetch = async (url, init) => {
        if (String(url).startsWith("http://127.0.0.1")) {
            return realFetch(url, init);
        }
        asked.push(String(url));
        return new Response(null, {
            headers: { location: "http://169.254.169.254/latest/meta-data/" },
            status: 302,
        });
    };
    t.after(() => {
        global.fetch = realFetch;
    });
    resolveTo(t, { "old.example.com": ["93.184.216.34"] });

    let result = await receive(t, "http://169.254.169.254");
    assert.equal(result.status, 400);
    assert.match(result.body.message, /address this instance can.t use/);
    assert.deepEqual(asked, [], "nothing was requested");

    result = await receive(t, "https://old.example.com");
    assert.equal(result.status, 400, "redirected to link-local");
    assert.deepEqual(
        asked,
        ["https://old.example.com/api/migration/bundle?token=token-1"],
        "only the first address was requested"
    );
});

// --- Every request to an account's own backend, not just the first address ---

const supabase = require("../server/providers/supabase");

const OWN = { anonKey: "pk-example", url: "https://backend.example.com" };
const rowsJson = () =>
    new Response("[]", { headers: { "content-type": "application/json" }, status: 200 });

// Anything on this machine is real; every other address answers with a
// redirect to `to`, and is written down.
function redirectingTo(t, to, status = 307) {
    const asked = [];
    global.fetch = async (url, init) => {
        if (String(url).startsWith("http://127.0.0.1")) {
            return realFetch(url, init);
        }
        asked.push({ method: init?.method || "GET", url: String(url) });
        return new Response(null, { headers: { location: to }, status });
    };
    t.after(() => {
        global.fetch = realFetch;
        supabase._test.resetCircuit();
    });
    return asked;
}

const everyCall = (configLocal, token = "tok") => [
    ["read", () => supabase.supabaseGet("addons", { select: "*" }, token, configLocal)],
    [
        "insert",
        () =>
            supabase.supabasePost(
                "addons",
                [{ url: "https://a.example/manifest.json" }],
                token,
                configLocal
            ),
    ],
    ["delete", () => supabase.supabaseDelete("addons", { user_id: "eq.u1" }, token, configLocal)],
    ["rpc", () => supabase.supabaseRpc("sync_pull_profiles", {}, token, configLocal)],
];

test("on an instance serving strangers a redirect from an account backend to somewhere internal is not followed", async (t) => {
    instance(t, "public");
    resolveTo(t, { "backend.example.com": ["93.184.216.34"] });
    t.mock.method(console, "error", () => undefined);
    const internal = await listen(t, (_req, res) => {
        res.end("[]");
    });
    for (const target of [
        `${internal.base}/rest/v1/addons`,
        "http://169.254.169.254/latest/meta-data/",
        "http://10.0.0.5/rest/v1/addons",
    ]) {
        const asked = redirectingTo(t, target);
        for (const [what, call] of everyCall(OWN)) {
            await assert.rejects(
                call(),
                (e) => e.code === "BACKEND_REFUSED" && /not allowed to reach/.test(e.message),
                `${what} -> ${target}`
            );
        }
        assert.equal(
            asked.length,
            4,
            `${target}: only the account address was requested, once per call`
        );
        assert.ok(asked.every((a) => a.url.startsWith("https://backend.example.com/")));
    }
    assert.equal(internal.hits.length, 0, "nothing reached the server on this machine");
});

test("an account backend that resolves somewhere internal is refused before a request goes out", async (t) => {
    instance(t, "public");
    resolveTo(t, { "rebound.example": ["10.0.0.5"] });
    const asked = redirectingTo(t, "http://127.0.0.1/");
    t.mock.method(console, "error", () => undefined);
    await assert.rejects(
        supabase.supabaseGet("addons", {}, "tok", {
            anonKey: "pk-example",
            url: "http://rebound.example",
        }),
        (e) => e.code === "BACKEND_REFUSED"
    );
    assert.deepEqual(asked, []);
});

test("a household install follows a redirect on its own network from its backend, but never one to link-local", async (t) => {
    instance(t, "private");
    t.mock.method(console, "error", () => undefined);
    const lan = await listen(t, (_req, res) => {
        res.setHeader("content-type", "application/json");
        res.end('[{"id":"r1"}]');
    });
    const own = { anonKey: "pk-example", url: "http://203.0.113.7:8000" };

    redirectingTo(t, `${lan.base}/rest/v1/addons`);
    assert.deepEqual(await supabase.supabaseGet("addons", {}, "tok", own), [{ id: "r1" }]);
    assert.deepEqual(lan.hits, ["/rest/v1/addons"]);

    const asked = redirectingTo(t, "http://169.254.169.254/latest/meta-data/");
    await assert.rejects(
        supabase.supabaseGet("addons", {}, "tok", own),
        (e) => e.code === "BACKEND_REFUSED"
    );
    assert.equal(asked.length, 1);
});

test("a household backend on its LAN, on this machine or at a docker name is used as it was", async (t) => {
    instance(t, "private");
    resolveTo(t, { "nuvio-backend": ["172.18.0.5"] });
    const seen = [];
    global.fetch = async (url, init) => {
        seen.push({ apikey: init?.headers?.apikey, url: String(url) });
        return rowsJson();
    };
    t.after(() => {
        global.fetch = realFetch;
        supabase._test.resetCircuit();
    });
    for (const base of [
        "http://192.168.1.10:8000",
        "http://127.0.0.1:54321",
        "http://nuvio-backend:8000",
    ]) {
        seen.length = 0;
        await supabase.supabaseGet("addons", {}, "tok", { anonKey: "pk-example", url: base });
        assert.deepEqual(seen, [{ apikey: "pk-example", url: `${base}/rest/v1/addons?` }], base);
    }
});

test("the standard backend is called with a plain fetch: no address check, no redirect handling of our own", async (t) => {
    for (const type of ["public", "private"]) {
        instance(t, type);
        // A lookup would mean the address was being checked.
        const original = dns.lookup;
        dns.lookup = async () => {
            throw new Error("the standard backend must not be looked up");
        };
        const seen = [];
        global.fetch = async (url, init) => {
            seen.push({ redirect: init?.redirect, url: String(url) });
            return rowsJson();
        };
        try {
            for (const configLocal of [
                undefined,
                {},
                { anonKey: "", url: "" },
                { anonKey: "other", url: `${supabase.SUPABASE_URL}/` },
            ]) {
                seen.length = 0;
                await supabase.supabaseGet("addons", { select: "*" }, "tok", configLocal);
                assert.deepEqual(
                    seen,
                    [
                        {
                            redirect: undefined,
                            url: `${supabase.SUPABASE_URL}/rest/v1/addons?select=*`,
                        },
                    ],
                    `${type} ${JSON.stringify(configLocal)}`
                );
            }
        } finally {
            dns.lookup = original;
            global.fetch = realFetch;
            supabase._test.resetCircuit();
        }
    }
});

test("the sign-in calls get the same treatment through backendFetch", async (t) => {
    instance(t, "public");
    resolveTo(t, { "backend.example.com": ["93.184.216.34"] });
    const asked = redirectingTo(t, "http://127.0.0.1:1/auth/v1/token");
    await assert.rejects(
        supabase.backendFetch(
            "https://backend.example.com/auth/v1/token?grant_type=password",
            { body: "{}", method: "POST" },
            OWN
        ),
        (e) => e.code === "BACKEND_REFUSED"
    );
    assert.equal(asked.length, 1);

    const plain = [];
    global.fetch = async (url, init) => {
        plain.push([String(url), init?.redirect]);
        return rowsJson();
    };
    await supabase.backendFetch(
        `${supabase.SUPABASE_URL}/auth/v1/token`,
        { method: "POST" },
        undefined
    );
    assert.deepEqual(plain, [[`${supabase.SUPABASE_URL}/auth/v1/token`, undefined]]);
});

// --- The breaker is per backend, and a refusal is not a failure ---

test("a refusal never counts against the breaker, however often it happens", async (t) => {
    instance(t, "public");
    resolveTo(t, { "backend.example.com": ["93.184.216.34"] });
    t.mock.method(console, "error", () => undefined);
    redirectingTo(t, "http://127.0.0.1:1/");
    for (let i = 0; i < 12; i++) {
        await assert.rejects(
            supabase.supabaseGet("addons", {}, "tok", OWN),
            (e) => e.code === "BACKEND_REFUSED"
        );
    }
    assert.equal(supabase.isCircuitOpen(OWN), false);
    assert.equal(supabase._test.breakerState(OWN).consecutiveFailures, 0);
    assert.equal(supabase.isCircuitOpen(), false);
    assert.equal(supabase._test.breakerState().consecutiveFailures, 0);
});

test("an account backend failing opens its own breaker and nobody else", async (t) => {
    instance(t, "private");
    t.mock.method(console, "error", () => undefined);
    const mine = { anonKey: "pk-example", url: "http://203.0.113.7:8000" };
    const another = { anonKey: "pk-example", url: "http://203.0.113.8:8000" };
    const seen = [];
    global.fetch = async (url) => {
        seen.push(String(url));
        return String(url).startsWith("http://203.0.113.7")
            ? new Response("{}", { status: 500 })
            : rowsJson();
    };
    t.after(() => {
        global.fetch = realFetch;
        supabase._test.resetCircuit();
    });

    for (let i = 0; i < 5; i++) {
        await assert.rejects(
            supabase.supabaseGet("addons", {}, "tok", mine),
            (e) => e.status === 500
        );
    }
    assert.equal(supabase.isCircuitOpen(mine), true);
    assert.equal(supabase.isCircuitOpen(another), false);
    assert.equal(supabase.isCircuitOpen(), false, "the standard backend is not held back by it");

    seen.length = 0;
    await assert.rejects(supabase.supabaseGet("addons", {}, "tok", mine), (e) => e.status === 503);
    assert.deepEqual(seen, [], "held back without a request");
    assert.deepEqual(await supabase.supabaseGet("addons", {}, "tok"), []);
    assert.deepEqual(await supabase.supabaseGet("addons", {}, "tok", another), []);
});

test("the standard backend failing still opens its breaker for everyone using it, as before", async (t) => {
    t.mock.method(console, "error", () => undefined);
    global.fetch = async () => new Response("{}", { headers: { "retry-after": "1" }, status: 429 });
    t.after(() => {
        global.fetch = realFetch;
        supabase._test.resetCircuit();
    });
    for (let i = 0; i < 2; i++) {
        await assert.rejects(supabase.supabaseGet("addons", {}, "tok"), (e) => e.status === 429);
    }
    assert.equal(supabase.isCircuitOpen(), true);
    assert.equal(supabase.isCircuitOpen(undefined), true);
    assert.equal(
        supabase.isCircuitOpen({ anonKey: "", url: "" }),
        true,
        "an account with no backend of its own shares it"
    );
    assert.equal(
        supabase.isCircuitOpen({ anonKey: "pk-example", url: "http://203.0.113.7:8000" }),
        false
    );
});

test("the breakers kept for backends of their own are bounded, and the standard one is never forgotten", async (t) => {
    t.mock.method(console, "error", () => undefined);
    global.fetch = async () => new Response("{}", { status: 500 });
    t.after(() => {
        global.fetch = realFetch;
        supabase._test.resetCircuit();
    });
    const at = (n) => ({
        anonKey: "pk-example",
        url: `http://203.0.113.${n % 250}:${8000 + Math.floor(n / 250)}`,
    });
    for (let i = 0; i < 5; i++) {
        await assert.rejects(supabase.supabaseGet("addons", {}, "tok"));
    }
    for (let i = 0; i < 5; i++) {
        await assert.rejects(supabase.supabaseGet("addons", {}, "tok", at(0)));
    }
    assert.equal(supabase.isCircuitOpen(), true);
    assert.equal(supabase.isCircuitOpen(at(0)), true);
    for (let n = 1; n <= 250; n++) {
        supabase.isCircuitOpen(at(n));
    }
    assert.equal(supabase.isCircuitOpen(at(0)), false, "the oldest of them was let go");
    assert.equal(supabase.isCircuitOpen(), true, "the standard breaker is not one of those");
});

test("a refused backend address is reported as that, not as a sign-in that expired", async (t) => {
    instance(t, "public");
    resolveTo(t, { "backend.example.com": ["93.184.216.34"] });
    t.mock.method(console, "error", () => undefined);
    t.mock.method(console, "warn", () => undefined);
    redirectingTo(t, "http://10.0.0.5/auth/v1/token");
    const { createNuvioProvider } = require("../server/providers/nuvio");
    const provider = createNuvioProvider({
        profileId: 1,
        refreshToken: "refresh",
        resolveServerConfig: async () => OWN,
        userId: "u-refused",
    });
    for (const call of [() => provider.getAddons(), () => provider.getLibrary()]) {
        await assert.rejects(
            call(),
            (e) => e.code === "BACKEND_REFUSED" && /not allowed to reach/.test(e.message)
        );
    }
});
