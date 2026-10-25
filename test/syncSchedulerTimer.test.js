// The sync scheduler's long waits: a Monthly schedule (30 days) is longer
// than setTimeout can hold, which used to make it run every half a minute.
const test = require("node:test");
const assert = require("node:assert/strict");
const { scheduleSyncs, clearSyncSchedule } = require("../server/utils/syncScheduler");

const flush = async () => {
    for (let i = 0; i < 20; i++) {
        await Promise.resolve();
    }
};

function fakePrisma(counter, accounts = []) {
    return {
        appAccount: {
            findFirst: async ({ where }) => accounts.find((a) => a.id === where.id) || null,
            findMany: async () => {
                if (counter.failSeed-- > 0) {
                    throw new Error("db busy");
                }
                return accounts;
            },
        },
        group: {
            findMany: async () => {
                counter.runs++;
                return [];
            },
        },
    };
}

test("Monthly (30 days) waits instead of running straight away", async (t) => {
    t.mock.timers.enable({ apis: ["setTimeout", "Date"], now: Date.parse("2026-10-21T12:00:00") });
    const counter = { failSeed: 0, runs: 0 };
    scheduleSyncs(
        30 * 1440,
        fakePrisma(counter),
        () => null,
        () => ({}),
        null,
        null,
        {},
        "private"
    );
    await flush();
    for (let i = 0; i < 48; i++) {
        t.mock.timers.tick(60 * 60 * 1000);
        await flush();
    }
    assert.equal(counter.runs, 0, "nothing ran in the first two days");
    for (let i = 0; i < 30 * 24; i++) {
        t.mock.timers.tick(60 * 60 * 1000);
        await flush();
    }
    assert.equal(counter.runs, 1, "one run once the month was up");
    clearSyncSchedule();
});

test("rescheduling stops the old loop", async (t) => {
    // Later than the first test's month, so its last run doesn't count as a duplicate here.
    t.mock.timers.enable({ apis: ["setTimeout", "Date"], now: Date.parse("2027-02-01T12:00:00") });
    const counter = { failSeed: 0, runs: 0 };
    const prisma = fakePrisma(counter);
    scheduleSyncs(
        60,
        prisma,
        () => null,
        () => ({}),
        null,
        null,
        {},
        "private"
    );
    await flush();
    scheduleSyncs(
        60,
        prisma,
        () => null,
        () => ({}),
        null,
        null,
        {},
        "private"
    );
    await flush();
    t.mock.timers.tick(61 * 60 * 1000);
    await flush();
    assert.equal(counter.runs, 1, "one hourly run, not one per loop");
    clearSyncSchedule();
});

test("public: a failed read of the accounts is retried", async (t) => {
    t.mock.timers.enable({ apis: ["setTimeout", "Date"], now: Date.parse("2026-10-21T12:00:00") });
    const counter = { failSeed: 1, runs: 0 };
    const accounts = [{ id: "a1", sync: { enabled: true, frequency: "1h" } }];
    const prisma = fakePrisma(counter, accounts);
    let seeded = 0;
    const findMany = prisma.appAccount.findMany;
    prisma.appAccount.findMany = async (...a) => {
        const r = await findMany(...a);
        seeded++;
        return r;
    };
    scheduleSyncs(
        1,
        prisma,
        () => null,
        () => ({}),
        null,
        null,
        {},
        "public"
    );
    await flush();
    assert.equal(seeded, 0);
    t.mock.timers.tick(61 * 1000);
    await flush();
    assert.equal(seeded, 1, "tried again a minute later");
    clearSyncSchedule();
});
