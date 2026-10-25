// "Someone has been inactive for a while" (automation/inactivity.js) and the
// reversible "Deactivate a user" action (registry.js).
const test = require("node:test");
const assert = require("node:assert/strict");
const { runInactivityCheck } = require("../server/utils/automation/inactivity");
const { ACTIONS, TRIGGERS } = require("../server/utils/automation/registry");
const { validateRule: _validateRule } = (() => {
    try {
        return require("../server/utils/automation/engine");
    } catch {
        return {};
    }
})();

const DAY = 86_400_000;
const NOW = Date.parse("2026-10-05T12:00:00Z");

function world({ users, activity = [], rules }) {
    const runs = [];
    const table = (rows, field) => ({
        groupBy: async ({ where }) => {
            const m = new Map();
            for (const r of rows) {
                if (r.accountId !== where.accountId || !where.userId.in.includes(r.userId)) {
                    continue;
                }
                if (!m.has(r.userId) || r[field] > m.get(r.userId)) {
                    m.set(r.userId, r[field]);
                }
            }
            return [...m].map(([userId, v]) => ({ _max: { [field]: v }, userId }));
        },
    });
    const prisma = {
        automationRule: { findMany: async () => rules },
        automationRun: {
            findFirst: async ({ where }) =>
                runs.find(
                    (r) =>
                        r.ruleId === where.ruleId &&
                        where.AND.every((c) => r.payload.includes(c.payload.contains))
                ) || null,
        },
        episodeWatchHistory: table([], "watchedAt"),
        movieWatchHistory: table([], "watchedAt"),
        proxyStreamSession: { groupBy: async () => [] },
        user: { findMany: async () => users },
        watchActivity: table(activity, "createdAt"),
        watchSession: table([], "startTime"),
    };
    const fired = [];
    const emit = async (_p, _accountId, type, payload, opts) => {
        fired.push({ payload, ruleId: opts.ruleId, type });
        runs.push({ payload: JSON.stringify(payload), ruleId: opts.ruleId });
        return { fired: 1 };
    };
    return { emit, fired, prisma };
}

const rule = {
    accountId: "acc",
    enabled: true,
    id: "r1",
    triggerConfig: JSON.stringify({ days: 30 }),
    triggerType: "user.inactive",
};
const person = (id, extra = {}) => ({
    createdAt: new Date(NOW - 400 * DAY),
    email: `${id}@example.com`,
    expiresAt: null,
    id,
    providerType: "jellyfin",
    username: id,
    ...extra,
});

test("fires once per quiet stretch, and again only after they come back and go quiet", async () => {
    const activity = [{ accountId: "acc", createdAt: new Date(NOW - 45 * DAY), userId: "ann" }];
    const w = world({ activity, rules: [rule], users: [person("ann")] });
    assert.equal(await runInactivityCheck(w.prisma, { emit: w.emit, now: NOW }), 1);
    assert.equal(w.fired[0].payload.daysInactive, 45);
    assert.equal(w.fired[0].ruleId, "r1", "targets the rule whose days were checked");
    assert.equal(
        await runInactivityCheck(w.prisma, { emit: w.emit, now: NOW + 3600e3 }),
        0,
        "the same stretch never fires twice"
    );

    // Back for an evening, then quiet again for 31 days.
    activity.push({ accountId: "acc", createdAt: new Date(NOW + 2 * DAY), userId: "ann" });
    assert.equal(
        await runInactivityCheck(w.prisma, { emit: w.emit, now: NOW + 10 * DAY }),
        0,
        "active again"
    );
    assert.equal(await runInactivityCheck(w.prisma, { emit: w.emit, now: NOW + 33 * DAY }), 1);
});

test("skips the recently active, a future end date, and counts never-watched from when they were added", async () => {
    const w = world({
        activity: [
            { accountId: "acc", createdAt: new Date(NOW - 2 * DAY), userId: "recent" },
            { accountId: "acc", createdAt: new Date(NOW - 90 * DAY), userId: "ends" },
        ],
        rules: [rule],
        users: [
            person("recent"),
            person("ends", { expiresAt: new Date(NOW + 10 * DAY) }),
            person("new", { createdAt: new Date(NOW - 5 * DAY) }),
            person("quiet"),
        ],
    });
    await runInactivityCheck(w.prisma, { emit: w.emit, now: NOW });
    assert.deepEqual(
        w.fired.map((f) => f.payload.userId),
        ["quiet"]
    );
    assert.equal(w.fired[0].payload.neverSeen, true);
});

test("the trigger asks for its number of days", () => {
    assert.deepEqual(
        TRIGGERS["user.inactive"].triggerConfigFields.map((f) => f.name),
        ["days"]
    );
});

test("deactivate switches off, never deletes, and leaves an end date alone", async () => {
    const rows = {
        u1: { expiresAt: null, id: "u1", isActive: true, username: "Ann" },
        u2: { expiresAt: new Date(Date.now() + 5 * DAY), id: "u2", isActive: true, username: "Bo" },
    };
    const calls = [];
    const prisma = {
        appAccount: { findUnique: async () => ({ sync: "{}" }) },
        user: {
            delete: async () => {
                throw new Error("must never delete");
            },
            deleteMany: async () => {
                throw new Error("must never delete");
            },
            findFirst: async ({ where }) => rows[where.id] || null,
            update: async ({ where, data }) => {
                calls.push(["update", where.id, data]);
                Object.assign(rows[where.id], data);
            },
        },
    };
    const run = (userId) =>
        ACTIONS["user.deactivate"].run({
            accountId: "acc",
            config: {},
            payload: { userId },
            prisma,
        });
    assert.match(await run("u1"), /Deactivated Ann/);
    assert.equal(rows.u1.isActive, false);
    assert.deepEqual(calls, [["update", "u1", { isActive: false }]]);
    assert.match(await run("u1"), /already switched off/);
    assert.match(await run("u2"), /Left Bo on/);
    assert.equal(rows.u2.isActive, true);
});
