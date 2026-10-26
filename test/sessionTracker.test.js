const test = require("node:test");
const assert = require("node:assert/strict");
const { processUserSessions, hasReachedEnd } = require("../server/utils/sessionTracker");

// A WatchSession table in memory, with just the calls processUserSessions
// makes. One row per account/user/item, as the schema's @@unique has it.
function fakePrisma(rows = []) {
    let nextId = rows.length + 1;
    const keyOf = (r) => `${r.accountId}:${r.userId}:${r.itemId}`;
    const table = new Map(rows.map((r) => [keyOf(r), { ...r }]));
    return {
        rows: () => [...table.values()],
        user: {
            findUnique: async () => ({
                colorIndex: 0,
                discordWebhookUrl: null,
                email: null,
                id: "u1",
                username: "TEST USER",
            }),
        },
        watchSession: {
            findMany: async ({ where }) =>
                [...table.values()].filter(
                    (r) =>
                        r.accountId === where.accountId &&
                        r.userId === where.userId &&
                        r.isActive === where.isActive
                ),
            findUnique: async ({ where }) => {
                const k = where.accountId_userId_itemId;
                return table.get(`${k.accountId}:${k.userId}:${k.itemId}`) || null;
            },
            update: async ({ where, data }) => {
                const row = [...table.values()].find((r) => r.id === where.id);
                Object.assign(row, data);
                return row;
            },
            upsert: async ({ where, create, update }) => {
                const k = where.accountId_userId_itemId;
                const key = `${k.accountId}:${k.userId}:${k.itemId}`;
                const existing = table.get(key);
                if (existing) {
                    Object.assign(existing, update);
                    return existing;
                }
                const row = { id: `s${nextId++}`, ...create };
                table.set(key, row);
                return row;
            },
        },
    };
}

const MIN = 60 * 1000;
const DURATION = 26 * MIN + 12 * 1000; // 26:12, the episode from the report

function episode(now, { position, lastWatchedAgo }) {
    return {
        _id: "tt1844624",
        name: "American Horror Story",
        poster: "https://example.com/poster.jpg",
        state: {
            duration: DURATION,
            lastWatched: new Date(now - lastWatchedAgo).toISOString(),
            timeOffset: position,
            video_id: "tt1844624:13:5",
        },
        type: "series",
    };
}

test("hasReachedEnd: the last 2% of the runtime counts as the end, anything earlier does not", () => {
    assert.equal(hasReachedEnd(DURATION, DURATION), true);
    assert.equal(hasReachedEnd(DURATION - 20 * 1000, DURATION), true);
    assert.equal(hasReachedEnd(DURATION * 0.9, DURATION), false);
    assert.equal(hasReachedEnd(0, DURATION), false);
    assert.equal(hasReachedEnd(DURATION, 0), false);
    assert.equal(hasReachedEnd(null, DURATION), false);
    assert.equal(hasReachedEnd(DURATION, undefined), false);
});

test("a checkpoint at the end of the runtime closes the open session on that poll, without waiting for checkpoint expiry", async () => {
    const now = Date.now();
    const startedAt = new Date(now - 30 * MIN);
    const prisma = fakePrisma([
        {
            accountId: "default",
            durationSeconds: 20 * 60,
            endTime: null,
            episode: 5,
            id: "s1",
            isActive: true,
            itemId: "tt1844624",
            itemName: "American Horror Story",
            itemType: "series",
            lastPosition: 20 * MIN,
            paused: false,
            poster: null,
            season: 13,
            startPosition: 0,
            startTime: startedAt,
            totalDuration: DURATION,
            userId: "u1",
            videoId: "tt1844624:13:5",
        },
    ]);

    // The episode ran out a minute ago: Nuvio's final checkpoint is at 26:12
    // of 26:12. Before this the session stayed in Now Playing for the whole
    // freshness window after.
    const finishedAgo = 1 * MIN;
    const r = await processUserSessions(
        prisma,
        "default",
        "u1",
        [episode(now, { lastWatchedAgo: finishedAgo, position: DURATION })],
        new Date(now)
    );
    assert.equal(r.sessionsUpdated, 1);
    assert.equal(r.sessionsClosed, 1);
    const [row] = prisma.rows();
    assert.equal(row.isActive, false);
    assert.equal(
        row.endTime.getTime(),
        now - finishedAgo,
        "ends at the checkpoint, not at the poll"
    );
    // The last stretch (20:00 -> 26:12) is still credited.
    assert.equal(row.durationSeconds, 20 * 60 + 6 * 60 + 12);
    assert.equal(row.lastPosition, DURATION);

    // The next polls still see the same final checkpoint for the rest of the
    // window. They must not reopen the session.
    for (let i = 1; i <= 3; i++) {
        const again = await processUserSessions(
            prisma,
            "default",
            "u1",
            [episode(now, { lastWatchedAgo: finishedAgo, position: DURATION })],
            new Date(now + i * MIN)
        );
        assert.equal(again.sessionsCreated, 0, `poll ${i} reopened the finished session`);
        assert.equal(prisma.rows()[0].isActive, false);
    }
});

test("a rewatch after a finish starts a session again", async () => {
    const now = Date.now();
    const prisma = fakePrisma([
        {
            accountId: "default",
            durationSeconds: 26 * 60,
            endTime: new Date(now - 90 * MIN),
            episode: 5,
            id: "s1",
            isActive: false,
            itemId: "tt1844624",
            itemName: "American Horror Story",
            itemType: "series",
            lastPosition: DURATION,
            paused: false,
            poster: null,
            season: 13,
            startPosition: 0,
            startTime: new Date(now - 2 * 60 * MIN),
            totalDuration: DURATION,
            userId: "u1",
            videoId: "tt1844624:13:5",
        },
    ]);
    const r = await processUserSessions(
        prisma,
        "default",
        "u1",
        [episode(now, { lastWatchedAgo: 30 * 1000, position: 2 * MIN })],
        new Date(now)
    );
    assert.equal(r.sessionsCreated, 1);
    assert.equal(prisma.rows()[0].isActive, true);
});

test("a watch first seen at its end is recorded, then closed on the following poll", async () => {
    const now = Date.now();
    const prisma = fakePrisma();
    // Nuvio only checkpoints at pause/stop, so a straight-through watch's
    // first checkpoint can be its last. It still has to produce a session,
    // credited with the runtime, as before.
    const first = await processUserSessions(
        prisma,
        "default",
        "u1",
        [episode(now, { lastWatchedAgo: 30 * 1000, position: DURATION })],
        new Date(now)
    );
    assert.equal(first.sessionsCreated, 1);
    let [row] = prisma.rows();
    assert.equal(row.durationSeconds, 26 * 60 + 12);

    const second = await processUserSessions(
        prisma,
        "default",
        "u1",
        [episode(now, { lastWatchedAgo: 30 * 1000, position: DURATION })],
        new Date(now + MIN)
    );
    assert.equal(second.sessionsClosed, 1);
    [row] = prisma.rows();
    assert.equal(row.isActive, false);
    assert.equal(
        row.durationSeconds,
        26 * 60 + 12,
        "closing adds nothing: the position did not move"
    );

    const third = await processUserSessions(
        prisma,
        "default",
        "u1",
        [episode(now, { lastWatchedAgo: 30 * 1000, position: DURATION })],
        new Date(now + 2 * MIN)
    );
    assert.equal(third.sessionsCreated, 0);
    assert.equal(prisma.rows()[0].isActive, false);
});

test("a checkpoint short of the end keeps the session open, as before", async () => {
    const now = Date.now();
    const prisma = fakePrisma([
        {
            accountId: "default",
            durationSeconds: 10 * 60,
            endTime: null,
            episode: 5,
            id: "s1",
            isActive: true,
            itemId: "tt1844624",
            itemName: "American Horror Story",
            itemType: "series",
            lastPosition: 10 * MIN,
            paused: false,
            poster: null,
            season: 13,
            startPosition: 0,
            startTime: new Date(now - 30 * MIN),
            totalDuration: DURATION,
            userId: "u1",
            videoId: "tt1844624:13:5",
        },
    ]);
    const r = await processUserSessions(
        prisma,
        "default",
        "u1",
        [episode(now, { lastWatchedAgo: 4 * MIN, position: 20 * MIN })],
        new Date(now)
    );
    assert.equal(r.sessionsClosed, 0);
    assert.equal(prisma.rows()[0].isActive, true);
});

// --- Several sittings of one title in a day, and the next episode starting ---

const FILM = 98 * MIN;
function film(now, { position, lastWatchedAgo = 0 }) {
    return {
        _id: "tt31192372",
        name: "Fall 2: Deadpoint",
        poster: "https://example.com/fall2.jpg",
        state: {
            duration: FILM,
            lastWatched: new Date(now - lastWatchedAgo).toISOString(),
            timeOffset: position,
        },
        type: "movie",
    };
}
// Midday UTC: the same calendar day in every timezone the default could be.
const DAY = Date.parse("2026-10-10T18:00:00Z");
const run = (prisma, at, item) =>
    processUserSessions(prisma, "default", "u1", [item], new Date(at));

test("a film watched in three sittings on one day ends up with the whole viewing, not the last sitting", async () => {
    const prisma = fakePrisma();
    // Sitting 1: first seen 26 minutes in, then up to 41.
    await run(prisma, DAY, film(DAY, { position: 26 * MIN }));
    await run(prisma, DAY + 15 * MIN, film(DAY + 15 * MIN, { position: 41 * MIN }));
    // Nothing new for longer than the freshness window: the sitting closes.
    await run(
        prisma,
        DAY + 45 * MIN,
        film(DAY + 45 * MIN, { lastWatchedAgo: 30 * MIN, position: 41 * MIN })
    );
    assert.equal(prisma.rows()[0].isActive, false);
    assert.equal(prisma.rows()[0].durationSeconds, 41 * 60);

    // Sitting 2, over an hour later: resumes and reaches 61.
    await run(prisma, DAY + 110 * MIN, film(DAY + 110 * MIN, { position: 61 * MIN }));
    assert.equal(prisma.rows()[0].isActive, true);
    assert.equal(
        prisma.rows()[0].durationSeconds,
        61 * 60,
        "the earlier sitting is kept, plus what moved since"
    );
    await run(
        prisma,
        DAY + 150 * MIN,
        film(DAY + 150 * MIN, { lastWatchedAgo: 30 * MIN, position: 61 * MIN })
    );

    // Sitting 3: to the end.
    await run(prisma, DAY + 200 * MIN, film(DAY + 200 * MIN, { position: 70 * MIN }));
    await run(prisma, DAY + 228 * MIN, film(DAY + 228 * MIN, { position: FILM }));
    const [row] = prisma.rows();
    assert.equal(row.isActive, false, "reaching the end closes it");
    assert.equal(row.durationSeconds, 98 * 60);
});

test("a title picked up again on a later day starts its own figure", async () => {
    const yesterday = DAY - 24 * 60 * MIN;
    const prisma = fakePrisma([
        {
            accountId: "default",
            durationSeconds: 40 * 60,
            endTime: new Date(yesterday + 40 * MIN),
            episode: null,
            id: "s1",
            isActive: false,
            itemId: "tt31192372",
            itemName: "Fall 2: Deadpoint",
            itemType: "movie",
            lastPosition: 40 * MIN,
            poster: null,
            season: null,
            startPosition: 0,
            startTime: new Date(yesterday),
            totalDuration: FILM,
            userId: "u1",
            videoId: null,
        },
    ]);
    await run(prisma, DAY, film(DAY, { position: 55 * MIN }));
    const [row] = prisma.rows();
    assert.equal(row.isActive, true);
    // Only what moved since yesterday's 40-minute mark - yesterday's 40 minutes are yesterday's.
    assert.equal(row.durationSeconds, 15 * 60);
});

test("the next episode starting does not close the session it just opened", async () => {
    const prisma = fakePrisma([
        {
            accountId: "default",
            durationSeconds: 15 * 60,
            endTime: null,
            episode: 5,
            id: "s1",
            isActive: true,
            itemId: "tt1844624",
            itemName: "American Horror Story",
            itemType: "series",
            lastPosition: 15 * MIN,
            poster: null,
            season: 13,
            startPosition: 0,
            startTime: new Date(DAY - 20 * MIN),
            totalDuration: DURATION,
            userId: "u1",
            videoId: "tt1844624:13:5",
        },
    ]);
    const next = episode(DAY, { lastWatchedAgo: 0, position: 2 * MIN });
    next.state.video_id = "tt1844624:13:6";
    await run(prisma, DAY, next);
    const [row] = prisma.rows();
    assert.equal(row.videoId, "tt1844624:13:6");
    assert.equal(row.isActive, true, "still playing");
    assert.equal(
        row.durationSeconds,
        2 * 60,
        "its own two minutes, not the previous episode's time"
    );
});

test("unchanged checkpoints expire after five minutes and newer provider saves renew activity", async () => {
    const now = Date.now();
    const prisma = fakePrisma();
    const checkpoint = episode(now, { lastWatchedAgo: 4 * MIN, position: 10 * MIN });
    await processUserSessions(prisma, "default", "u1", [checkpoint], new Date(now));
    assert.equal(prisma.rows()[0].isActive, true);
    await processUserSessions(prisma, "default", "u1", [checkpoint], new Date(now + 2 * MIN));
    assert.equal(prisma.rows()[0].isActive, false);
    const advanced = episode(now + 2 * MIN, { lastWatchedAgo: 0, position: 11 * MIN });
    await processUserSessions(prisma, "default", "u1", [advanced], new Date(now + 2 * MIN));
    assert.equal(prisma.rows()[0].isActive, true);
});
