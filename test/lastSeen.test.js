// "Last seen" on person cards was always blank - the routes sent
// lastActive: null. It is now worked out from SlickSync's own records
// (server/utils/lastSeen.js), never from the Jellyfin server's
// LastActivityDate, which SlickSync's own reads keep moving.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { lastSeenByUser, lastSeenFor } = require("../server/utils/lastSeen");

const NOW = Date.now();
const ago = (mins) => new Date(NOW - mins * 60_000);

// groupBy over in-memory rows, the way Prisma answers it.
function table(rows) {
    return {
        groupBy: async ({ by, where, _max }) => {
            const key = by[0];
            const field = Object.keys(_max)[0];
            const groups = new Map();
            for (const r of rows) {
                if (r.accountId !== where.accountId) {
                    continue;
                }
                if (where.userId?.in && !where.userId.in.includes(r.userId)) {
                    continue;
                }
                const cur = groups.get(r[key]);
                if (!cur || r[field] > cur) {
                    groups.set(r[key], r[field]);
                }
            }
            return [...groups].map(([k, v]) => ({ [key]: k, _max: { [field]: v } }));
        },
    };
}

const users = [
    { email: "ann@example.com", id: "ann", username: "ann" },
    { email: "bob@example.com", id: "bob", username: "bob" },
    { email: "cy@example.com", id: "cy", username: "cy" },
    { email: "dee@example.com", id: "dee", username: "dee" },
];

function prismaWith(extra = {}) {
    return {
        episodeWatchHistory: table([
            { accountId: "acc", userId: "bob", watchedAt: ago(2 * 24 * 60) },
        ]),
        movieWatchHistory: table([
            { accountId: "acc", userId: "bob", watchedAt: ago(3 * 24 * 60) },
        ]),
        proxyStreamSession: table([
            { accountId: "acc", aiostreamsUser: "cy", lastSeenAt: ago(5) },
            { accountId: "acc", aiostreamsUser: "nobody-we-know", lastSeenAt: ago(1) },
        ]),
        user: { findMany: async () => users },
        watchActivity: table([
            { accountId: "acc", createdAt: ago(600), userId: "ann" },
            { accountId: "acc", createdAt: ago(300), userId: "ann" },
            { accountId: "other", createdAt: ago(1), userId: "ann" },
        ]),
        watchSession: table([{ accountId: "acc", startTime: ago(120), userId: "ann" }]),
        ...extra,
    };
}

test("newest record wins across every source, per account", async () => {
    const seen = await lastSeenByUser(prismaWith(), "acc", users);
    assert.equal(
        seen.get("ann").getTime(),
        ago(120).getTime(),
        "a viewing beats older watch time; another account is ignored"
    );
    assert.equal(seen.get("bob").getTime(), ago(2 * 24 * 60).getTime(), "History counts");
    assert.equal(
        seen.get("cy").getTime(),
        ago(5).getTime(),
        "a proxy stream counts for the person its login name matches"
    );
    assert.equal(seen.has("dee"), false, "no record = never seen");
});

test("a proxy name nobody owns counts for nobody", async () => {
    const seen = await lastSeenByUser(prismaWith(), "acc", users);
    assert.equal([...seen.keys()].sort().join(), "ann,bob,cy");
});

test("one broken source does not blank the rest; a future time reads as now", async () => {
    const broken = {
        groupBy: async () => {
            throw new Error("boom");
        },
    };
    const seen = await lastSeenByUser(
        prismaWith({
            movieWatchHistory: table([
                { accountId: "acc", userId: "dee", watchedAt: new Date(NOW + 3600e3) },
            ]),
            proxyStreamSession: broken,
            watchSession: broken,
        }),
        "acc",
        users
    );
    assert.equal(seen.get("ann").getTime(), ago(300).getTime());
    assert.ok(seen.get("dee").getTime() <= Date.now());
});

test("one person is answered the same way as the list", async () => {
    assert.equal((await lastSeenFor(prismaWith(), "acc", "cy")).getTime(), ago(5).getTime());
    assert.equal(await lastSeenFor(prismaWith(), "acc", "dee"), null);
});

test("the user routes send it instead of a hard-coded null, and never read Jellyfin LastActivityDate", () => {
    const src = fs.readFileSync(
        path.join(require("node:path").dirname(module.filename), "..", "server/routes/users.js"),
        "utf8"
    );
    assert.match(src, /lastActive: lastSeen\.get\(user\.id\)\?\.toISOString\(\) \|\| null/);
    assert.equal(
        (src.match(/lastSeenFor\(/g) || []).length,
        2,
        "the person page and the edit response"
    );
    assert.doesNotMatch(
        fs.readFileSync(
            path.join(
                require("node:path").dirname(module.filename),
                "..",
                "server/utils/lastSeen.js"
            ),
            "utf8"
        ),
        /LastActivityDate['"]?\]|\.LastActivityDate/
    );
});

test("the app's own last-watched time counts, when it is the newest", async () => {
    // Nuvio says dee watched something 30 minutes ago that never made a History row.
    const seen = await lastSeenByUser(
        prismaWith({
            watchSnapshot: table([
                { accountId: "acc", lastWatched: ago(30), userId: "dee" },
                { accountId: "acc", lastWatched: ago(9000), userId: "ann" },
            ]),
        }),
        "acc",
        users
    );
    assert.equal(seen.get("dee").getTime(), ago(30).getTime());
    assert.equal(
        seen.get("ann").getTime(),
        ago(120).getTime(),
        "an older snapshot does not pull anyone back"
    );
});
