const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const { createTraktTracking } = require("../server/utils/traktTracking");

const person = { accountId: "household-a", id: "profile-a", providerType: "nuvio" };
function matches(row, where) {
    return Object.entries(where).every(([field, value]) => {
        if (field === "accountId_userId_provider") {
            return matches(row, value);
        }
        if (value && typeof value === "object" && !(value instanceof Date)) {
            if ("not" in value) {
                return row[field] !== value.not;
            }
            if ("gt" in value) {
                return row[field] > value.gt;
            }
        }
        return row[field] === value;
    });
}
function setup(override) {
    const rows = [];
    const calls = [];
    const seal = (text, owner) => `sealed:${owner}:${Buffer.from(text).toString("base64")}`;
    const open = (text, owner) => {
        assert.ok(text.startsWith(`sealed:${owner}:`));
        return Buffer.from(text.slice(`sealed:${owner}:`.length), "base64").toString();
    };
    const model = {
        deleteMany: async ({ where }) => {
            let count = 0;
            for (let i = rows.length - 1; i >= 0; i--) {
                if (matches(rows[i], where)) {
                    rows.splice(i, 1);
                    count++;
                }
            }
            return { count };
        },
        findFirst: async ({ where }) =>
            structuredClone(rows.find((row) => matches(row, where)) || null),
        findUnique: async ({ where }) =>
            structuredClone(rows.find((row) => matches(row, where)) || null),
        update: async ({ where, data }) => {
            const row = rows.find((entry) => matches(entry, where));
            assert.ok(row);
            Object.assign(row, data);
            return row;
        },
        updateMany: async ({ where, data }) => {
            const found = rows.filter((row) => matches(row, where));
            for (const row of found) {
                Object.assign(row, data);
            }
            return { count: found.length };
        },
        upsert: async ({ where, create, update }) => {
            let row = rows.find((entry) => matches(entry, where));
            if (row) {
                Object.assign(row, update);
            } else {
                row = { credentials: null, id: `row-${rows.length}`, ...create };
                rows.push(row);
            }
            return row;
        },
    };
    const transport = async (url, options) => {
        const path = new URL(url).pathname;
        const body = options.body ? JSON.parse(options.body) : null;
        calls.push({ body, headers: options.headers, path });
        const custom = await override?.(path, body, options);
        if (custom) {
            return custom;
        }
        if (path === "/oauth/token") {
            return Response.json({
                access_token: "private-access",
                expires_in: 3600,
                refresh_token: "private-refresh",
            });
        }
        if (path === "/users/settings") {
            return Response.json({
                user: {
                    ids: { slug: "tracker-viewer", uuid: "stable-user-id" },
                    username: "tracker-viewer",
                },
            });
        }
        if (path === "/sync/playback") {
            return Response.json([]);
        }
        if (path.includes("/watching")) {
            return new Response(null, { status: 204 });
        }
        throw new Error(`Unexpected fixture endpoint ${path}`);
    };
    const prisma = {
        appAccount: { findUnique: async () => ({ sync: {} }) },
        trackingConnection: model,
    };
    const tracking = createTraktTracking({ decrypt: open, encrypt: seal, fetch: transport });
    return { calls, open, prisma, rows, seal, tracking };
}
async function linked(fixture) {
    const result = await fixture.tracking.begin(fixture.prisma, person);
    const url = new URL(result.url);
    await fixture.tracking.complete(fixture.prisma, person, {
        code: "one-use-code",
        state: url.searchParams.get("state"),
    });
    return url;
}

test.before(() => {
    process.env.TRAKT_TRACKING_CLIENT_ID = "fixture-client-123456";
    process.env.PUBLIC_APP_URL = "https://preview.example.test";
});

test("PKCE links only the authenticated Nuvio profile and never exposes stored credentials", async () => {
    const fixture = setup();
    const url = await linked(fixture);
    assert.equal(url.origin, "https://auth.trakt.tv");
    assert.equal(url.searchParams.get("code_challenge_method"), "S256");
    const exchange = fixture.calls.find((call) => call.path === "/oauth/token");
    assert.equal(
        crypto.createHash("sha256").update(exchange.body.code_verifier).digest("base64url"),
        url.searchParams.get("code_challenge")
    );
    assert.equal(exchange.body.client_secret, undefined);
    assert.equal(
        exchange.body.redirect_uri,
        "https://preview.example.test/user/settings/tracking/callback"
    );
    assert.ok(!fixture.rows[0].credentials.includes("private-access"));
    assert.equal(fixture.rows[0].pending, null);
    const visible = await fixture.tracking.status(fixture.prisma, person);
    assert.equal(visible.connected, true);
    assert.equal(visible.username, "tracker-viewer");
    assert.ok(!JSON.stringify(visible).includes("private"));
    assert.equal(fixture.rows[0].externalUserId, "stable-user-id");
    await assert.rejects(
        () =>
            fixture.tracking.complete(fixture.prisma, person, {
                code: "one-use-code",
                state: url.searchParams.get("state"),
            }),
        /expired|another profile/
    );
});

test("wrong profile, altered state, expired callbacks, and non-Nuvio linking are rejected before token exchange", async () => {
    const fixture = setup();
    const { url } = await fixture.tracking.begin(fixture.prisma, person);
    const state = new URL(url).searchParams.get("state");
    await assert.rejects(
        () =>
            fixture.tracking.complete(
                fixture.prisma,
                { ...person, id: "other" },
                { code: "code", state }
            ),
        /another profile/
    );
    await assert.rejects(
        () =>
            fixture.tracking.complete(fixture.prisma, person, {
                code: "code",
                state: "x".repeat(43),
            }),
        /another profile/
    );
    fixture.rows[0].pendingUntil = new Date(Date.now() - 1);
    await assert.rejects(
        () => fixture.tracking.complete(fixture.prisma, person, { code: "code", state }),
        /expired/
    );
    await assert.rejects(
        () => fixture.tracking.begin(fixture.prisma, { ...person, providerType: "stremio" }),
        /Nuvio/
    );
    assert.equal(fixture.calls.length, 0);
});

test("one household cannot attach the same tracker account to two profiles", async () => {
    const fixture = setup();
    await linked(fixture);
    const other = { ...person, id: "profile-b" };
    const { url } = await fixture.tracking.begin(fixture.prisma, other);
    await assert.rejects(
        () =>
            fixture.tracking.complete(fixture.prisma, other, {
                code: "code",
                state: new URL(url).searchParams.get("state"),
            }),
        /already linked/
    );
    assert.equal(fixture.rows.find((row) => row.userId === other.id).credentials, null);
});

test("read coalesces concurrent requests and respects upstream retry-after", async () => {
    let limited = false;
    const fixture = setup((path) =>
        limited && path === "/sync/playback"
            ? new Response(null, { headers: { "retry-after": "120" }, status: 429 })
            : null
    );
    await linked(fixture);
    await Promise.all([
        fixture.tracking.read(fixture.prisma, person, "watching", 30_000),
        fixture.tracking.read(fixture.prisma, person, "watching", 30_000),
    ]);
    assert.equal(fixture.calls.filter((call) => call.path.endsWith("/watching")).length, 1);
    limited = true;
    await assert.rejects(
        () => fixture.tracking.read(fixture.prisma, person, "progress", 60_000),
        /rate limiting/
    );
    await assert.rejects(
        () => fixture.tracking.read(fixture.prisma, person, "progress", 60_000),
        /rate limiting/
    );
    assert.equal(fixture.calls.filter((call) => call.path === "/sync/playback").length, 1);
});

test("HTTP callback is allowed only for explicit development loopback addresses", async () => {
    const fixture = setup();
    const original = process.env.NODE_ENV;
    try {
        process.env.NODE_ENV = "production";
        process.env.PUBLIC_APP_URL = "http://localhost:3000";
        await assert.rejects(() => fixture.tracking.begin(fixture.prisma, person), /HTTPS/);
        process.env.NODE_ENV = "development";
        assert.equal(
            new URL((await fixture.tracking.begin(fixture.prisma, person)).url).searchParams.get(
                "redirect_uri"
            ),
            "http://localhost:3000/user/settings/tracking/callback"
        );
        process.env.PUBLIC_APP_URL = "http://untrusted.example.test";
        await assert.rejects(() => fixture.tracking.begin(fixture.prisma, person), /HTTPS/);
    } finally {
        process.env.NODE_ENV = original;
        process.env.PUBLIC_APP_URL = "https://preview.example.test";
    }
});

test("an expired connection refreshes once across simultaneous resources", async () => {
    const fixture = setup();
    await linked(fixture);
    const row = fixture.rows[0];
    const owner = "household-a:profile-a:trakt";
    const credentials = JSON.parse(fixture.open(row.credentials, owner));
    row.credentials = fixture.seal(JSON.stringify({ ...credentials, expiresAt: 0 }), owner);
    await Promise.all([
        fixture.tracking.read(fixture.prisma, person, "watching", 30_000),
        fixture.tracking.read(fixture.prisma, person, "progress", 60_000),
    ]);
    assert.equal(
        fixture.calls.filter((call) => call.body?.grant_type === "refresh_token").length,
        1
    );
    assert.ok(JSON.parse(fixture.open(row.credentials, owner)).expiresAt > Date.now());
});

test("disconnect during a token refresh cannot recreate the connection", async () => {
    let release;
    let reportStarted;
    const started = new Promise((resolve) => {
        reportStarted = resolve;
    });
    const fixture = setup(async (path, body) => {
        if (path === "/oauth/token" && body.grant_type === "refresh_token") {
            reportStarted();
            return new Promise((resolve) => {
                release = () =>
                    resolve(
                        Response.json({
                            access_token: "new-access",
                            expires_in: 3600,
                            refresh_token: "new-refresh",
                        })
                    );
            });
        }
        return null;
    });
    await linked(fixture);
    const owner = "household-a:profile-a:trakt";
    const row = fixture.rows[0];
    const credentials = JSON.parse(fixture.open(row.credentials, owner));
    row.credentials = fixture.seal(JSON.stringify({ ...credentials, expiresAt: 0 }), owner);
    const reading = fixture.tracking.read(fixture.prisma, person, "watching", 30_000);
    await started;
    await fixture.tracking.disconnect(fixture.prisma, person);
    release();
    await assert.rejects(() => reading, /connection changed/);
    assert.equal(fixture.rows.length, 0);
});
