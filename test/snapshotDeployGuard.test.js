// Deploying a template replaces a person's whole addon list. Addons that cannot be
// fetched are left out and named, but a template that names addons is never written
// as an empty list - that would take everything off their account.
const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const express = require("express");
const makeSnapshotsRouter = require("../server/routes/snapshots");

const encrypt = (v) => `enc:${v}`;
const decrypt = (v) => {
    if (typeof v !== "string" || !v.startsWith("enc:")) {
        throw new Error("cannot decrypt");
    }
    return v.slice(4);
};

// Addon hosts on this machine: /ok/* answer with a manifest, /down/* with a
// server error, /page/* with something that is not JSON.
function addonHost(t) {
    return new Promise((resolve) => {
        const server = http.createServer((req, res) => {
            if (req.url.startsWith("/ok/")) {
                res.setHeader("content-type", "application/json");
                res.end(JSON.stringify({ id: req.url, name: req.url.split("/")[2] }));
                return;
            }
            if (req.url.startsWith("/page/")) {
                res.end("<html>nope</html>");
                return;
            }
            res.statusCode = 500;
            res.end("{}");
        });
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

// The router with a stand-in database and provider. `deployed` collects what
// reached the provider, `guard` what the account guard recorded.
async function deployer(t, addonList, { setAddons } = {}) {
    const deployed = [];
    const guard = [];
    const prisma = {
        addonSnapshot: {
            findFirst: async () => ({
                accountId: "acc",
                addonsJson: JSON.stringify(addonList),
                id: "s1",
            }),
        },
        user: {
            findFirst: async () => ({ guardStateJson: null, id: "u1", providerType: "nuvio" }),
            update: async (args) => {
                guard.push(args);
            },
        },
    };
    const createProvider = () => ({
        setAddons:
            setAddons ||
            (async (list) => {
                deployed.push(list);
            }),
    });
    const app = express();
    app.use(express.json());
    app.use(
        "/snapshots",
        makeSnapshotsRouter({ createProvider, decrypt, encrypt, getAccountId: () => "acc", prisma })
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
    const url = `http://127.0.0.1:${server.address().port}/snapshots/s1/deploy`;
    const deploy = async () => {
        const res = await fetch(url, {
            body: JSON.stringify({ targetUserId: "u1" }),
            headers: { "content-type": "application/json" },
            method: "POST",
        });
        return { body: await res.json(), status: res.status };
    };
    return { deploy, deployed, guard };
}

const entry = (name, base, path) => ({ manifestUrl: encrypt(`${base}${path}`), name });
const quiet = (t) => {
    t.mock.method(console, "error", () => undefined);
};

test("a template whose addons were all fetched is deployed as it was", async (t) => {
    const base = await addonHost(t);
    const { deploy, deployed } = await deployer(t, [
        entry("Alpha", base, "/ok/alpha/manifest.json"),
        entry("Beta", base, "/ok/beta/manifest.json"),
    ]);
    const { status, body } = await deploy();
    assert.equal(status, 200);
    assert.deepEqual(body, { deployed: 2, failed: 0, targetUserId: "u1" });
    assert.equal(deployed.length, 1);
    assert.deepEqual(
        deployed[0].map((a) => a.transportUrl),
        [`${base}/ok/alpha/manifest.json`, `${base}/ok/beta/manifest.json`]
    );
    assert.equal(deployed[0][0].manifest.name, "alpha");
});

test("a template none of whose addons could be fetched writes nothing and answers with a failure", async (t) => {
    quiet(t);
    const base = await addonHost(t);
    const { deploy, deployed, guard } = await deployer(t, [
        entry("Alpha", base, "/down/alpha/manifest.json?key=secret-1"),
        entry("Beta", base, "/page/beta/manifest.json"),
    ]);
    const { status, body } = await deploy();
    assert.equal(status, 502);
    assert.match(body.error, /None of the addons/);
    assert.match(body.error, /nothing was changed/);
    assert.deepEqual(body.failed, ["Alpha", "Beta"]);
    assert.deepEqual(deployed, [], "the list was not replaced, with nothing or with anything");
    assert.deepEqual(guard, [], "and no baseline was recorded for a list that was not written");
    assert.equal(
        JSON.stringify(body).includes("secret-1"),
        false,
        "the answer names addons, never their addresses"
    );
});

test("a template some of whose addons could not be fetched is deployed without them, and the answer names them", async (t) => {
    quiet(t);
    const base = await addonHost(t);
    const { deploy, deployed, guard } = await deployer(t, [
        entry("Alpha", base, "/ok/alpha/manifest.json"),
        entry("Beta", base, "/down/beta/manifest.json?key=secret-2"),
        entry("Gamma", base, "/ok/gamma/manifest.json"),
        entry("Delta", base, "/page/delta/manifest.json"),
    ]);
    const { status, body } = await deploy();
    assert.equal(status, 200);
    assert.deepEqual(body, {
        deployed: 2,
        failed: 2,
        leftOut: ["Beta", "Delta"],
        targetUserId: "u1",
    });
    assert.deepEqual(
        deployed[0].map((a) => a.manifest.name),
        ["alpha", "gamma"]
    );
    assert.equal(guard.length, 1, "the baseline is recorded for the list that was written");
    assert.equal(JSON.stringify(body).includes("secret-2"), false);
});

test("Stremio Local Files, which this server cannot fetch, no longer stops the rest of the template", async (t) => {
    const base = await addonHost(t);
    const local = {
        manifestUrl: encrypt("http://127.0.0.1:1/local-addon/manifest.json"),
        name: "Local Files",
        stremioAddonId: "org.stremio.local",
    };
    const { deploy, deployed } = await deployer(t, [
        entry("Alpha", base, "/ok/alpha/manifest.json"),
        local,
        entry("Beta", base, "/ok/beta/manifest.json"),
    ]);
    const { status, body } = await deploy();
    assert.equal(status, 200);
    assert.deepEqual(body, {
        deployed: 2,
        failed: 1,
        leftOut: ["Local Files"],
        targetUserId: "u1",
    });
    assert.equal(deployed[0].length, 2);
});

test("an addon that cannot be fetched is taken from the manifest the template carries", async (t) => {
    const base = await addonHost(t);
    const kept = {
        manifest: { id: "kept.id", name: "Kept" },
        manifestUrl: encrypt(`${base}/down/kept/manifest.json`),
        name: "Kept",
    };
    const { deploy, deployed } = await deployer(t, [
        entry("Alpha", base, "/ok/alpha/manifest.json"),
        kept,
    ]);
    const { status, body } = await deploy();
    assert.equal(status, 200);
    assert.deepEqual(body, { deployed: 2, failed: 0, targetUserId: "u1" });
    assert.equal(deployed[0][1].manifest.id, "kept.id");
});

test("a long list of failures is named in full in the details", async (t) => {
    quiet(t);
    const base = await addonHost(t);
    const names = ["A1", "A2", "A3", "A4", "A5", "A6", "A7"];
    const { deploy } = await deployer(t, [
        entry("Fine", base, "/ok/fine/manifest.json"),
        ...names.map((n) => entry(n, base, `/down/${n}/manifest.json`)),
    ]);
    const { status, body } = await deploy();
    assert.equal(status, 200);
    assert.deepEqual(body.leftOut, names);
});

test("addresses that cannot be decrypted count as not fetched, so they cannot empty a list", async (t) => {
    quiet(t);
    const { deploy, deployed } = await deployer(t, [
        { manifestUrl: "not-ours", name: "Alpha" },
        { manifestUrl: "also-not-ours", name: "Beta" },
    ]);
    const { status, body } = await deploy();
    assert.equal(status, 502);
    assert.deepEqual(body.failed, ["Alpha", "Beta"]);
    assert.deepEqual(deployed, []);
});

test("an entry saved without an address is skipped as it always was, and is not a failure", async (t) => {
    const base = await addonHost(t);
    const { deploy, deployed } = await deployer(t, [
        { manifestUrl: null, name: "No address" },
        entry("Alpha", base, "/ok/alpha/manifest.json"),
    ]);
    const { status, body } = await deploy();
    assert.equal(status, 200);
    assert.deepEqual(body, { deployed: 1, failed: 0, targetUserId: "u1" });
    assert.equal(deployed[0].length, 1);
});

test("a template that names addons but has no address for any of them is not deployed as an empty list", async (t) => {
    const { deploy, deployed } = await deployer(t, [
        { manifestUrl: null, name: "One" },
        { manifestUrl: null, name: "Two" },
    ]);
    const { status } = await deploy();
    assert.equal(status, 502);
    assert.deepEqual(deployed, []);
});

test("a template with no addons at all is still deployed, which clears the list as the template says", async (t) => {
    const { deploy, deployed } = await deployer(t, []);
    const { status, body } = await deploy();
    assert.equal(status, 200);
    assert.deepEqual(body, { deployed: 0, failed: 0, targetUserId: "u1" });
    assert.deepEqual(deployed, [[]]);
});

test("a list that could not be written back is reported as that, not as a generic failure", async (t) => {
    quiet(t);
    const base = await addonHost(t);
    const lost = Object.assign(
        new Error(
            "Their addon list could not be written back after the change failed and may be empty. Run a sync to fill it again."
        ),
        { code: "ADDON_LIST_NOT_RESTORED", status: 500 }
    );
    const { deploy } = await deployer(t, [entry("Alpha", base, "/ok/alpha/manifest.json")], {
        setAddons: async () => {
            throw lost;
        },
    });
    const { status, body } = await deploy();
    assert.equal(status, 500);
    assert.match(body.error, /could not be written back/);
    assert.match(body.error, /sync/i);
});

test("any other failure of the write keeps the plain message", async (t) => {
    quiet(t);
    const base = await addonHost(t);
    const { deploy } = await deployer(t, [entry("Alpha", base, "/ok/alpha/manifest.json")], {
        setAddons: async () => {
            throw Object.assign(new Error("internal detail at 203.0.113.9"), { status: 503 });
        },
    });
    const { status, body } = await deploy();
    assert.equal(status, 500);
    assert.deepEqual(body, { error: "Failed to deploy snapshot" });
});
