// An invite code is the only thing standing between the internet and an
// invitation, so it has to be out of reach of guessing - while every code made
// before keeps working. The status answer a stranger with a code can read has
// to stop short of anything that signs a person in, and opting out must not
// touch a person's Stremio account before SlickSync has finished its side.
const test = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");

const stremio = require("../server/utils/stremio");
const stremioClient = require("stremio-api-client");
const accountDeletion = require("../server/utils/accountDeletion");
const makeInvitationsRouter = require("../server/routes/invitations");
const { generateInviteCode, INVITE_CODE_ALPHABET, INVITE_CODE_LENGTH } = makeInvitationsRouter;

const realFetch = global.fetch;

function match(row, where = {}) {
    return Object.entries(where).every(([key, want]) => {
        if (key === "OR") {
            return want.some((w) => match(row, w));
        }
        return row[key] === want;
    });
}
const pick = (row, select) =>
    select
        ? Object.fromEntries(
              Object.keys(select)
                  .filter((k) => select[k])
                  .map((k) => [k, row[k]])
          )
        : { ...row };
function table(rows) {
    let n = 0;
    return {
        create: async ({ data }) => {
            const r = { createdAt: new Date(), id: `new${++n}`, ...data };
            rows.push(r);
            return { ...r };
        },
        findFirst: async ({ where, select, include } = {}) => {
            const r = rows.find((x) => match(x, where));
            return r
                ? {
                      ...pick(r, select),
                      ...(include?.invitation && r.invitation ? { invitation: r.invitation } : {}),
                  }
                : null;
        },
        findMany: async ({ where, select } = {}) =>
            rows.filter((x) => match(x, where)).map((r) => pick(r, select)),
        findUnique: async ({ where, select } = {}) => {
            const r = rows.find((x) => match(x, where));
            return r ? pick(r, select) : null;
        },
        rows,
    };
}

async function serve(t, prisma, build = (app) => app) {
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
        req.appAccountId = "acc1";
        next();
    });
    app.use(
        "/api/invitations",
        makeInvitationsRouter({
            assignUserToGroup: async () => undefined,
            decrypt: (v) => v,
            encrypt: (v) => v,
            getAccountId: () => "acc1",
            INSTANCE_TYPE: "private",
            prisma,
        })
    );
    app.use(
        "/invite",
        makeInvitationsRouter.createPublicRouter({
            assignUserToGroup: async () => undefined,
            decrypt: (v) => v,
            encrypt: (v) => v,
            prisma,
        })
    );
    build(app);
    const server = await new Promise((resolve) => {
        const s = app.listen(0, "127.0.0.1", () => resolve(s));
    });
    t.after(() => server.close());
    const base = `http://127.0.0.1:${server.address().port}`;
    return async (method, route, body) => {
        const res = await realFetch(`${base}${route}`, {
            body: body ? JSON.stringify(body) : undefined,
            headers: { "content-type": "application/json" },
            method,
        });
        let json = null;
        try {
            json = await res.json();
        } catch {
            // Optional remote data does not prevent the current operation from completing.
        }
        return { body: json, status: res.status };
    };
}

// ---- the code itself ----------------------------------------------------

test("a new invite code has at least 80 bits, from characters nobody mistakes for each other", () => {
    assert.ok(INVITE_CODE_LENGTH * Math.log2(INVITE_CODE_ALPHABET.length) >= 80, "enough bits");
    assert.equal(
        new Set(INVITE_CODE_ALPHABET).size,
        INVITE_CODE_ALPHABET.length,
        "no repeated symbol"
    );
    for (const confusable of "01OIL") {
        assert.ok(
            !INVITE_CODE_ALPHABET.includes(confusable),
            `${confusable} would be mistaken for another`
        );
    }
    for (let i = 0; i < 200; i++) {
        const code = generateInviteCode();
        assert.equal(code.length, INVITE_CODE_LENGTH);
        assert.match(code, /^[A-Z2-9]+$/);
        assert.doesNotMatch(code, /[01OIL]/);
    }
});

test("invite codes do not repeat and every symbol is equally likely", () => {
    const seen = new Set();
    const counts = new Map();
    const codes = 20_000;
    for (let i = 0; i < codes; i++) {
        const code = generateInviteCode();
        assert.ok(!seen.has(code), "a code was made twice");
        seen.add(code);
        for (const ch of code) {
            counts.set(ch, (counts.get(ch) || 0) + 1);
        }
    }
    assert.equal(counts.size, INVITE_CODE_ALPHABET.length);
    const expected = (codes * INVITE_CODE_LENGTH) / INVITE_CODE_ALPHABET.length;
    for (const [ch, n] of counts) {
        assert.ok(
            Math.abs(n - expected) < expected * 0.06,
            `${ch} came up ${n} times, expected about ${Math.round(expected)}`
        );
    }
});

test("creating an invitation stores a long code; codes made before are looked up exactly as stored", async (t) => {
    const invitations = table([
        // Made when codes were short: six uppercase characters, and eight.
        {
            accountId: "acc1",
            currentUses: 0,
            expiresAt: null,
            id: "old6",
            inviteCode: "Q3ZV8W",
            isActive: true,
            maxUses: 0,
        },
        {
            accountId: "acc1",
            currentUses: 1,
            expiresAt: null,
            id: "old8",
            inviteCode: "AB12CD34",
            isActive: true,
            maxUses: 5,
        },
    ]);
    const prisma = {
        appAccount: { findUnique: async () => null },
        invitation: invitations,
    };
    const call = await serve(t, prisma);

    const created = await call("POST", "/api/invitations", { name: "Friends" });
    assert.equal(created.status, 200);
    const code = created.body.inviteCode;
    assert.equal(code.length, INVITE_CODE_LENGTH);
    assert.equal(invitations.rows.at(-1).inviteCode, code);

    for (const known of [code, "Q3ZV8W", "AB12CD34"]) {
        const checked = await call("GET", `/invite/${known}/check`);
        assert.equal(checked.status, 200, known);
        assert.equal(checked.body.isActive, true, known);
    }
    assert.equal((await call("GET", "/invite/NOSUCHCODE/check")).status, 404);
});

// ---- what the status answer says ----------------------------------------

test("the status answer says where a request stands and gives nothing to sign in with", async (t) => {
    const future = new Date(Date.now() + 5 * 60 * 1000);
    const invitation = {
        accountId: "acc1",
        groupName: "Family",
        id: "inv1",
        inviteCode: "Q3ZV8W",
        isActive: true,
    };
    const prisma = {
        invitation: table([invitation]),
        inviteRequest: table([
            {
                createdAt: new Date("2026-03-01"),
                email: "new@example.com",
                groupName: null,
                id: "r1",
                invitation,
                invitationId: "inv1",
                oauthCode: "LINKCODE",
                oauthExpiresAt: future,
                oauthLink: "https://link.example.com/?code=LINKCODE",
                status: "accepted",
                username: "Newcomer",
            },
            {
                createdAt: new Date("2026-03-02"),
                email: "wait@example.com",
                groupName: "Friends",
                id: "r2",
                invitation,
                invitationId: "inv1",
                oauthCode: null,
                oauthExpiresAt: null,
                oauthLink: null,
                status: "pending",
                username: "Waiting",
            },
        ]),
    };
    const call = await serve(t, prisma);

    const accepted = await call(
        "GET",
        "/invite/Q3ZV8W/status?email=new%40example.com&username=Newcomer"
    );
    assert.equal(accepted.status, 200);
    assert.deepEqual(Object.keys(accepted.body).sort(), ["createdAt", "groupName", "status"]);
    assert.equal(accepted.body.status, "accepted");
    assert.equal(accepted.body.groupName, "Family");
    assert.ok(!JSON.stringify(accepted.body).includes("LINKCODE"));

    const pending = await call(
        "GET",
        "/invite/Q3ZV8W/status?email=wait%40example.com&username=Waiting"
    );
    assert.equal(pending.body.status, "pending");
    assert.equal(pending.body.groupName, "Friends");

    assert.equal(
        (await call("GET", "/invite/Q3ZV8W/status?email=nobody%40example.com&username=Nobody"))
            .status,
        404
    );
});

// ---- opting out ---------------------------------------------------------

// Stremio, and what is removed from SlickSync, recorded in the order they happen.
function optOutWorld(t, { rows, deleteFails = false, clearFails = false, addonsLeft = false }) {
    const events = [];
    const originals = {
        cascade: accountDeletion.deleteUserCascade,
        client: stremioClient.StremioAPIClient,
        validate: stremio.validateStremioAuthKey,
    };
    stremio.validateStremioAuthKey = async (key) => {
        if (key !== "key-ok") {
            const e = new Error("Invalid");
            e.code = 1;
            throw e;
        }
        return { user: { email: "Former@Example.com" } };
    };
    stremioClient.StremioAPIClient = class {
        constructor(opts) {
            events.push(`stremio:signed-in:${opts.authKey}`);
        }
        async request(name) {
            events.push(`stremio:${name}`);
            if (name === "addonCollectionSet" && clearFails) {
                throw new Error("Stremio did not answer");
            }
            return name === "addonCollectionGet"
                ? { addons: addonsLeft ? [{ manifest: { id: "org.example.addon" } }] : [] }
                : {};
        }
    };
    accountDeletion.deleteUserCascade = async (_prisma, id) => {
        if (deleteFails) {
            throw new Error("database unavailable");
        }
        events.push(`deleted:${id}`);
        const i = rows.findIndex((r) => r.id === id);
        if (i >= 0) {
            rows.splice(i, 1);
        }
    };
    t.after(() => {
        stremio.validateStremioAuthKey = originals.validate;
        stremioClient.StremioAPIClient = originals.client;
        accountDeletion.deleteUserCascade = originals.cascade;
    });
    return events;
}

test("opting out: a Stremio account SlickSync never held keeps its addons", async (t) => {
    const rows = [{ email: "someone.else@example.com", id: "other", providerType: "stremio" }];
    const events = optOutWorld(t, { rows });
    const call = await serve(t, { user: table(rows) });
    const res = await call("POST", "/invite/delete-user", { authKey: "key-ok" });
    assert.equal(res.status, 404);
    assert.equal(res.body.addonsCleared, undefined);
    assert.deepEqual(events, [], "nothing was done on their Stremio account");
});

test("opting out: their people are removed first, then the Stremio addons, and only Stremio people with that email go", async (t) => {
    const rows = [
        { accountId: "acc1", email: "former@example.com", id: "house1", providerType: "stremio" },
        { accountId: "acc2", email: "former@example.com", id: "house2", providerType: "stremio" },
        { accountId: "acc1", email: "former@example.com", id: "nuvio", providerType: "nuvio" },
        { accountId: "acc1", email: "former@example.com", id: "jelly", providerType: "jellyfin" },
        {
            accountId: "acc1",
            email: "bystander@example.com",
            id: "bystander",
            providerType: "stremio",
        },
    ];
    const events = optOutWorld(t, { rows });
    const call = await serve(t, { user: table(rows) });
    const res = await call("POST", "/invite/delete-user", { authKey: "key-ok" });
    assert.equal(res.status, 200);
    assert.equal(res.body.success, true);
    assert.equal(res.body.addonsCleared, true);
    assert.deepEqual(events, [
        "deleted:house1",
        "deleted:house2",
        "stremio:signed-in:key-ok",
        "stremio:addonCollectionSet",
        "stremio:addonCollectionGet",
    ]);
    assert.deepEqual(rows.map((r) => r.id).sort(), ["bystander", "jelly", "nuvio"]);
});

test("opting out: if removing them fails, nothing is taken off their Stremio account", async (t) => {
    const rows = [
        { accountId: "acc1", email: "former@example.com", id: "house1", providerType: "stremio" },
    ];
    const events = optOutWorld(t, { deleteFails: true, rows });
    const call = await serve(t, { user: table(rows) });
    const res = await call("POST", "/invite/delete-user", { authKey: "key-ok" });
    assert.equal(res.status, 500);
    assert.deepEqual(events, []);
    assert.equal(rows.length, 1);
});

test("opting out: they are out of SlickSync even when Stremio does not answer afterwards", async (t) => {
    const rows = [
        { accountId: "acc1", email: "former@example.com", id: "house1", providerType: "stremio" },
    ];
    const events = optOutWorld(t, { clearFails: true, rows });
    const call = await serve(t, { user: table(rows) });
    const res = await call("POST", "/invite/delete-user", { authKey: "key-ok" });
    assert.equal(res.status, 200);
    assert.equal(events[0], "deleted:house1");
    assert.equal(rows.length, 0);
    // Asking again would find nobody here and never reach Stremio, so the answer has to say the addons are still there.
    assert.equal(res.body.addonsCleared, false);
    const eventsBefore = events.length;
    const again = await call("POST", "/invite/delete-user", { authKey: "key-ok" });
    assert.equal(again.status, 404);
    assert.equal(events.length, eventsBefore, "the second attempt did not reach Stremio");
});

test("opting out: addons Stremio still lists afterwards are reported as not cleared", async (t) => {
    const rows = [
        { accountId: "acc1", email: "former@example.com", id: "house1", providerType: "stremio" },
    ];
    optOutWorld(t, { addonsLeft: true, rows });
    const call = await serve(t, { user: table(rows) });
    const res = await call("POST", "/invite/delete-user", { authKey: "key-ok" });
    assert.equal(res.status, 200);
    assert.equal(res.body.success, true);
    assert.equal(res.body.addonsCleared, false);
});
