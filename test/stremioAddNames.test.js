// Adding a Stremio person needs no name: the server names them after their
// account, with a number on the end when someone here has that name already.
// The email-and-password route used to treat a name match as the same person
// and hand that entry (even a Nuvio or Jellyfin one) to the new sign-in, and
// it wrote the whole request, password included, to the log.
const test = require("node:test");
const assert = require("node:assert/strict");

// Stand-ins for Stremio itself, in place before the routes pick them up.
const stremioUtils = require("../server/utils/stremio");
stremioUtils.validateStremioAuthKey = async (key) => {
    if (key === "dead-key") {
        throw Object.assign(new Error("Session does not exist"), { code: 1 });
    }
    return { addons: {}, user: { email: "sam@example.com" } };
};
const stremioClient = require("stremio-api-client");
stremioClient.StremioAPIStore = class {
    async login() {
        this.authKey = "fresh-key";
        this.user = { email: "sam@example.com" };
    }
    async pullAddonCollection() {
        this.addons = {};
    }
};

const express = require("express");
const makeStremioRouter = require("../server/routes/stremio");

let rows = [];
const matches = (row, where) => Object.entries(where).every(([k, v]) => row[k] === v);
const prisma = {
    user: {
        create: async ({ data }) => {
            const row = { id: `new${rows.length}`, providerType: "stremio", ...data };
            rows.push(row);
            return row;
        },
        findFirst: async ({ where }) => rows.find((r) => matches(r, where)) || null,
        findMany: async ({ where }) => rows.filter((r) => matches(r, where)),
        update: async ({ where, data }) =>
            Object.assign(
                rows.find((r) => r.id === where.id),
                data
            ),
    },
};
const nuvioSam = () => ({
    accountId: "acc",
    email: "sam@example.com",
    id: "nuvio1",
    providerType: "nuvio",
    stremioAuthKey: null,
    username: "sam",
});

let base;
let server;
test.before(async () => {
    const app = express();
    app.use(express.json());
    app.use(
        "/stremio",
        makeStremioRouter({
            assignUserToGroup: async () => undefined,
            decrypt: (v) => String(v).slice(4),
            encrypt: (v) => `enc:${v}`,
            getAccountId: () => "acc",
            prisma,
        })
    );
    await new Promise((resolve) => {
        server = app.listen(0, "127.0.0.1", resolve);
    });
    base = `http://127.0.0.1:${server.address().port}/stremio`;
});
test.after(() => server.close());

const post = async (path, body) => {
    const r = await fetch(`${base}${path}`, {
        body: JSON.stringify(body),
        headers: { "content-type": "application/json" },
        method: "POST",
    });
    return { body: await r.json(), status: r.status };
};

test("signing in with Stremio adds them under a free name, without asking for one", async () => {
    rows = [nuvioSam()];
    const r = await post("/connect-authkey", {
        authKey: "good-key",
        create: true,
        email: "",
        username: "",
    });
    assert.equal(r.status, 201);
    assert.equal(r.body.user.username, "sam1");
    assert.deepEqual(
        rows[0],
        nuvioSam(),
        "the Nuvio person who already had the name is left alone"
    );
});

test("email and password: a name match is someone else, never taken over", async () => {
    rows = [nuvioSam()];
    const r = await post("/connect", { email: "sam@example.com", password: "not-for-the-log" });
    assert.equal(r.status, 201);
    assert.equal(rows.length, 2);
    assert.equal(r.body.user.username, "sam1");
    assert.deepEqual(rows[0], nuvioSam());
    assert.equal(rows[1].stremioAuthKey, "enc:fresh-key");
});

test("email and password: the same Stremio account with a dead sign-in is reconnected and keeps its name", async () => {
    rows = [
        {
            accountId: "acc",
            colorIndex: 3,
            email: "sam@example.com",
            id: "st1",
            providerType: "stremio",
            stremioAuthKey: "enc:dead-key",
            username: "Sammy",
        },
    ];
    const r = await post("/connect", {
        email: "sam@example.com",
        password: "not-for-the-log",
        username: "ignored",
    });
    assert.equal(r.status, 201);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].username, "Sammy");
    assert.equal(rows[0].stremioAuthKey, "enc:fresh-key");
});

test("the password never reaches the log", async () => {
    rows = [];
    const logged = [];
    const keep = { error: console.error, log: console.log };
    console.log = (...a) =>
        logged.push(a.map((x) => (typeof x === "string" ? x : JSON.stringify(x))).join(" "));
    console.error = console.log;
    try {
        const r = await post("/connect", { email: "sam@example.com", password: "not-for-the-log" });
        assert.equal(r.status, 201);
    } finally {
        Object.assign(console, keep);
    }
    assert.ok(logged.length > 0, "the route does log, so this would catch it");
    assert.ok(!logged.some((line) => line.includes("not-for-the-log")));
});
