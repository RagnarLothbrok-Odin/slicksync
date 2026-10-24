const test = require("node:test");
const assert = require("node:assert/strict");
const { ownerOf, ownedProfileIndexes } = require("../server/utils/nuvioProfiles");
const {
    findSharedEmailUserIds,
    dedupWatchActivityBySharedEmail,
} = require("../server/utils/watchDedup");

const main = { id: "main", nuvioProfileId: 1 };
const kids = { id: "kids", nuvioProfileId: 3 };

test("ownerOf: a profile with no person of its own counts for the main person", () => {
    assert.equal(ownerOf(2, [main], new Map()), "main");
});

test("ownerOf: a profile with its own person counts for them", () => {
    assert.equal(ownerOf(3, [main, kids], new Map()), "kids");
    assert.equal(ownerOf(1, [main, kids], new Map()), "main");
});

test("ownerOf: a route moves a profile to another person on the account, or to nobody", () => {
    assert.equal(
        ownerOf(2, [main, kids], new Map([[2, { skip: false, targetUserId: "kids" }]])),
        "kids"
    );
    assert.equal(
        ownerOf(2, [main, kids], new Map([[2, { skip: true, targetUserId: null }]])),
        null
    );
});

test("ownerOf: a profile's own person beats a stale route, and a route to someone gone falls back", () => {
    assert.equal(
        ownerOf(3, [main, kids], new Map([[3, { skip: false, targetUserId: "main" }]])),
        "kids"
    );
    assert.equal(
        ownerOf(3, [main, kids], new Map([[3, { skip: true, targetUserId: null }]])),
        "kids"
    );
    assert.equal(
        ownerOf(2, [main, kids], new Map([[2, { skip: false, targetUserId: "deleted" }]])),
        "main"
    );
});

function fakePrisma({ users, routes = [] }) {
    return {
        nuvioProfileRoute: {
            findMany: async ({ where }) =>
                routes.filter(
                    (r) => r.nuvioUserId === where.nuvioUserId && r.accountId === where.accountId
                ),
        },
        user: {
            findMany: async ({ where }) =>
                users.filter(
                    (u) =>
                        u.providerType === where.providerType &&
                        u.nuvioUserId === where.nuvioUserId &&
                        u.accountId === where.accountId
                ),
            findUnique: async ({ where }) => users.find((u) => u.id === where.id) || null,
        },
    };
}

const account = {
    accountId: "a",
    createdAt: new Date(0),
    nuvioUserId: "n1",
    providerType: "nuvio",
};

test("ownedProfileIndexes: each person reads only their own profiles", async () => {
    const prisma = fakePrisma({
        users: [
            { ...account, id: "main", nuvioProfileId: 1 },
            { ...account, id: "kids", nuvioProfileId: 3 },
        ],
    });
    assert.deepEqual(await ownedProfileIndexes(prisma, "main", [1, 2, 3]), [1, 2]);
    assert.deepEqual(await ownedProfileIndexes(prisma, "kids", [1, 2, 3]), [3]);
});

test("ownedProfileIndexes: a single person still reads every profile, as before", async () => {
    const prisma = fakePrisma({ users: [{ ...account, id: "main", nuvioProfileId: 1 }] });
    assert.deepEqual(await ownedProfileIndexes(prisma, "main", [1, 2, 3]), [1, 2, 3]);
});

test("ownedProfileIndexes: a skipped profile is read by nobody", async () => {
    const prisma = fakePrisma({
        routes: [
            { accountId: "a", nuvioUserId: "n1", profileIndex: 2, skip: true, targetUserId: null },
        ],
        users: [{ ...account, id: "main", nuvioProfileId: 1 }],
    });
    assert.deepEqual(await ownedProfileIndexes(prisma, "main", [1, 2]), [1]);
});

test("ownedProfileIndexes: anyone who is not a Nuvio person keeps every profile", async () => {
    const prisma = fakePrisma({ users: [{ ...account, id: "stremio", providerType: "stremio" }] });
    assert.deepEqual(await ownedProfileIndexes(prisma, "stremio", [1, 2]), [1, 2]);
});

test("dedupe: two profiles of one Nuvio account watching the same title the same day both count", () => {
    const users = [
        { email: "e", id: "main", nuvioProfileId: 1 },
        { email: "e", id: "kids", nuvioProfileId: 3 },
    ];
    const day = new Date("2026-10-01T00:00:00Z");
    const rows = [
        { date: day, itemId: "tt1", profileLabel: "Main", userId: "main", watchTimeSeconds: 600 },
        { date: day, itemId: "tt1", profileLabel: "Kids", userId: "kids", watchTimeSeconds: 900 },
    ];
    assert.equal(dedupWatchActivityBySharedEmail(rows, findSharedEmailUserIds(users)).length, 2);
});

test("dedupe: older unlabelled copies across profile people still collapse to one", () => {
    const users = [
        { email: "e", id: "main", nuvioProfileId: 1 },
        { email: "e", id: "kids", nuvioProfileId: 3 },
    ];
    const day = new Date("2026-10-01T00:00:00Z");
    const rows = [
        { date: day, itemId: "tt1", profileLabel: null, userId: "main", watchTimeSeconds: 600 },
        { date: day, itemId: "tt1", profileLabel: null, userId: "kids", watchTimeSeconds: 600 },
    ];
    assert.equal(dedupWatchActivityBySharedEmail(rows, findSharedEmailUserIds(users)).length, 1);
});

test("dedupe: a Stremio and Nuvio pair on one email still collapses, labels or not", () => {
    const users = [
        { email: "e", id: "nuvio", nuvioProfileId: 1 },
        { email: "e", id: "stremio", nuvioProfileId: 1 },
    ];
    const day = new Date("2026-10-01T00:00:00Z");
    const rows = [
        { date: day, itemId: "tt1", profileLabel: "Main", userId: "nuvio", watchTimeSeconds: 600 },
        { date: day, itemId: "tt1", profileLabel: null, userId: "stremio", watchTimeSeconds: 500 },
    ];
    assert.equal(dedupWatchActivityBySharedEmail(rows, findSharedEmailUserIds(users)).length, 1);
});

test("dedupe: history rows opt out, because their older copies were labelled too", () => {
    const users = [
        { email: "e", id: "main", nuvioProfileId: 1 },
        { email: "e", id: "kids", nuvioProfileId: 3 },
    ];
    const at = new Date("2026-10-01T10:00:00Z");
    const rows = [
        {
            durationSeconds: 600,
            itemId: "tt1",
            profileLabel: "Main",
            userId: "main",
            watchedAt: at,
        },
        {
            durationSeconds: 600,
            itemId: "tt1",
            profileLabel: "Main",
            userId: "kids",
            watchedAt: at,
        },
    ];
    const kept = dedupWatchActivityBySharedEmail(rows, findSharedEmailUserIds(users), {
        dateField: "watchedAt",
        durationField: "durationSeconds",
        independentProfiles: false,
    });
    assert.equal(kept.length, 1);
});
