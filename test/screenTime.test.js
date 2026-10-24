// Daily screen-time limits (server/utils/screenTime.js): counted like Watch
// Time, on the account's own day, one alert per person per day.
const test = require("node:test");
const assert = require("node:assert/strict");
const st = require("../server/utils/screenTime");
const { getAccountDateString } = require("../server/utils/dateUtils");

const TZ = "America/Los_Angeles";
// 2026-10-05 is a Monday. 06:00 UTC is still Sunday evening in Los Angeles.
const MON_NOON_LA = new Date("2026-10-05T19:00:00Z");
const SUN_EVENING_LA = new Date("2026-10-05T06:00:00Z");

// gateSettled: anyone whose limit can pause already has their stream addons
// through the gate. Off by default: without a public address the gate can't
// be reached, so it stays off (the gate's own tests say it can).
function world({ limits, activity, now, gateSettled = false }) {
    const notes = [];
    const gate = Object.fromEntries(
        Object.entries(limits || {})
            .filter(([, l]) => l?.onReach === "pause" || l?.bedtime)
            .map(([id]) => [id, { at: "2026-10-01T00:00:00.000Z", on: true }])
    );
    let sync = {
        accountTimezone: TZ,
        screenTime: limits,
        ...(gateSettled && Object.keys(gate).length ? { screenTimeGate: gate } : {}),
    };
    const prisma = {
        appAccount: {
            findFirst: async () => ({ sync: JSON.stringify(sync) }),
            findMany: async () => [{ id: "acc", sync: JSON.stringify(sync) }],
            findUnique: async () => ({ sync: JSON.stringify(sync) }),
            update: async ({ data }) => {
                sync = JSON.parse(data.sync);
            },
        },
        notification: {
            create: async ({ data }) => (notes.push(data), data),
            findUnique: async ({ where }) =>
                notes.find((n) => n.dedupeKey === where.accountId_dedupeKey.dedupeKey) || null,
            upsert: async ({ create }) => (notes.push(create), create),
        },
        user: {
            findFirst: async ({ where }) => ({ id: where.id }),
            findMany: async ({ where }) =>
                [
                    { id: "mia", username: "Mia" },
                    { id: "leo", username: "Leo" },
                ].filter((u) => where.id.in.includes(u.id)),
        },
        watchActivity: {
            groupBy: async ({ where }) => {
                const sums = new Map();
                for (const a of activity) {
                    if (!where.userId.in.includes(a.userId) || a.date < where.date.gte) {
                        continue;
                    }
                    sums.set(a.userId, (sums.get(a.userId) || 0) + a.watchTimeSeconds);
                }
                return [...sums].map(([userId, s]) => ({ _sum: { watchTimeSeconds: s }, userId }));
            },
        },
    };
    return {
        notes,
        prisma,
        get sync() {
            return sync;
        },
    };
}

// A row keyed the way metricsProcessor writes WatchActivity.date.
const row = (userId, minutes, when, tz = TZ) => ({
    date: new Date(getAccountDateString(when, tz)),
    userId,
    watchTimeSeconds: minutes * 60,
});

test("reaching the limit: one alert and one trigger for the day, however many checks", async () => {
    const w = world({
        activity: [row("mia", 60, MON_NOON_LA), row("mia", 35, MON_NOON_LA)],
        limits: { mia: { days: [], minutes: 90 } },
    });
    const fired = [];
    const emit = async (_p, _accountId, type, payload) => {
        fired.push({ payload, type });
    };
    assert.equal(await st.checkScreenTime(w.prisma, { emit, now: MON_NOON_LA }), 1);
    assert.equal(
        await st.checkScreenTime(w.prisma, {
            emit,
            now: new Date(MON_NOON_LA.getTime() + 5 * 60_000),
        }),
        0
    );
    assert.equal(w.notes.length, 1);
    assert.match(w.notes[0].title, /Mia reached today's 90-minute limit/);
    assert.deepEqual(fired, [
        {
            payload: { limitMinutes: 90, minutesWatched: 95, userId: "mia", username: "Mia" },
            type: "watch.budget_exceeded",
        },
    ]);
});

test("under the limit, or on a day it doesn't apply: nothing", async () => {
    const emit = async () => undefined;
    const under = world({
        activity: [row("mia", 89, MON_NOON_LA)],
        limits: { mia: { days: [], minutes: 90 } },
    });
    assert.equal(await st.checkScreenTime(under.prisma, { emit, now: MON_NOON_LA }), 0);
    // School days only, and it is still Sunday in the account's timezone.
    const sunday = world({
        activity: [row("mia", 200, SUN_EVENING_LA)],
        limits: { mia: { days: [1, 2, 3, 4, 5], minutes: 30 } },
    });
    assert.equal(
        await st.checkScreenTime(sunday.prisma, { emit, now: SUN_EVENING_LA }),
        0,
        "the account's Sunday, though UTC says Monday"
    );
});

test("today is the account's day, not the server's", async () => {
    // Yesterday evening (LA) counts for yesterday, not for today.
    const w = world({
        activity: [row("mia", 120, SUN_EVENING_LA)],
        limits: { mia: { days: [], minutes: 60 } },
    });
    assert.equal(
        await st.checkScreenTime(w.prisma, { emit: async () => undefined, now: MON_NOON_LA }),
        0
    );
    assert.equal(st.accountToday(TZ, SUN_EVENING_LA).weekday, 0);
    assert.equal(st.accountToday(TZ, MON_NOON_LA).weekday, 1);
});

test("limits are cleaned on the way in, and can be removed", async () => {
    assert.deepEqual(st.cleanLimit({ days: [5, 1, 1, 9, "x"], minutes: "90" }), {
        days: [1, 5],
        minutes: 90,
    });
    assert.equal(st.cleanLimit({ minutes: 0 }), null);
    assert.equal(st.cleanLimit({ minutes: 5000 }), null);
    const w = world({ activity: [], limits: {} });
    const set = await st.setLimit(w.prisma, "acc", "mia", { days: [0, 6], minutes: 45 });
    assert.deepEqual(set.limit, { days: [0, 6], minutes: 45 });
    await assert.rejects(st.setLimit(w.prisma, "acc", "mia", { minutes: 0 }), /between 1 and 1440/);
    const cleared = await st.setLimit(w.prisma, "acc", "mia", null);
    assert.equal(cleared.limit, null);
    assert.deepEqual(w.sync.screenTime, {});
});

// ---------------------------------------------------------------------------
// Pausing streaming at the limit

const quiet = async () => undefined;

test("a limit set to pause: paused at the limit with the alert, back just after midnight", async () => {
    const w = world({
        activity: [row("mia", 95, MON_NOON_LA)],
        limits: { mia: { days: [], minutes: 90, onReach: "pause" } },
    });
    const synced = [];
    const deps = {
        syncPerson: async (_p, _a, id) => {
            synced.push(await st.isStreamingPaused(w.prisma, "acc", id, MON_NOON_LA.getTime()));
        },
    };
    assert.equal(await st.checkScreenTime(w.prisma, { deps, emit: quiet, now: MON_NOON_LA }), 1);
    assert.deepEqual(synced, [true], "one sync, with the pause already in place for it to read");
    assert.match(w.notes[0].body, /Streaming is paused until midnight/);
    assert.equal(
        w.sync.screenTimePauses.mia.until,
        "2026-10-06T07:00:00.000Z",
        "midnight in Los Angeles"
    );

    await st.checkScreenTime(w.prisma, {
        deps,
        emit: quiet,
        now: new Date(MON_NOON_LA.getTime() + 5 * 60_000),
    });
    assert.equal(synced.length, 1, "not paused twice");

    await st.checkScreenTime(w.prisma, {
        deps,
        emit: quiet,
        now: new Date("2026-10-06T07:05:00Z"),
    });
    assert.deepEqual(synced, [true, false], "synced again after midnight, with the pause gone");
    assert.deepEqual(w.sync.screenTimePauses, {});
});

test('"Resume now" holds for the rest of the day, and is forgotten the next', async () => {
    const w = world({
        activity: [row("mia", 95, MON_NOON_LA)],
        limits: { mia: { days: [], minutes: 90, onReach: "pause" } },
    });
    let syncs = 0;
    const deps = {
        syncPerson: async () => {
            syncs++;
        },
    };
    await st.checkScreenTime(w.prisma, { deps, emit: quiet, now: MON_NOON_LA });
    const view = await st.resume(w.prisma, "acc", "mia", deps, {
        now: new Date(MON_NOON_LA.getTime() + 60_000),
    });
    assert.equal(view.paused, null);
    assert.equal(syncs, 2);
    await st.checkScreenTime(w.prisma, {
        deps,
        emit: quiet,
        now: new Date(MON_NOON_LA.getTime() + 10 * 60_000),
    });
    assert.equal(syncs, 2, "still over the limit, but not paused again today");
    await st.checkScreenTime(w.prisma, {
        deps,
        emit: quiet,
        now: new Date("2026-10-06T19:00:00Z"),
    });
    assert.deepEqual(w.sync.screenTimePauses, {}, "the note is dropped the next day");
    assert.equal(syncs, 2);
});

test("setting the limit back to alerting (or removing it) ends a pause at once", async () => {
    const w = world({
        activity: [row("mia", 95, MON_NOON_LA)],
        limits: { mia: { days: [], minutes: 90, onReach: "pause" } },
    });
    let syncs = 0;
    const deps = {
        syncPerson: async () => {
            syncs++;
        },
    };
    await st.checkScreenTime(w.prisma, { deps, emit: quiet, now: MON_NOON_LA });
    assert.ok(w.sync.screenTimePauses.mia);
    await st.setLimit(w.prisma, "acc", "mia", { days: [], minutes: 90 }, deps);
    assert.equal(w.sync.screenTimePauses.mia, undefined);
    assert.equal(syncs, 2);
    assert.deepEqual(st.cleanLimit({ days: [], minutes: 90, onReach: "pause" }), {
        days: [],
        minutes: 90,
        onReach: "pause",
    });
    assert.deepEqual(st.cleanLimit({ days: [], minutes: 90, onReach: "anything" }), {
        days: [],
        minutes: 90,
    });
});

test("Jellyfin: blocked by their access schedule, and it is put back - unless the block was not ours", async () => {
    for (const alreadyBlocked of [false, true]) {
        const w = world({
            activity: [row("mia", 95, MON_NOON_LA)],
            limits: { mia: { days: [], minutes: 90, onReach: "pause" } },
        });
        const mia = {
            id: "mia",
            jellyfinServerKind: "jellyfin",
            providerType: "jellyfin",
            username: "Mia",
        };
        w.prisma.user.findMany = async () => [mia];
        w.prisma.user.findFirst = async () => mia;
        const theirs = [{ DayOfWeek: "Weekday", EndHour: 21, StartHour: 7 }];
        const calls = [];
        const deps = {
            setJellyfinBlocked: async (_p, _a, _id, blocked, opts) => {
                calls.push([blocked, opts.restore]);
                return blocked && !alreadyBlocked ? theirs : null;
            },
            syncPerson: async () => {
                throw new Error("a Jellyfin person has no addons to sync");
            },
        };
        await st.checkScreenTime(w.prisma, { deps, emit: quiet, now: MON_NOON_LA });
        assert.equal(
            await st.isStreamingPaused(w.prisma, "acc", "mia", MON_NOON_LA.getTime()),
            true
        );
        await st.checkScreenTime(w.prisma, {
            deps,
            emit: quiet,
            now: new Date("2026-10-06T07:05:00Z"),
        });
        assert.deepEqual(
            calls,
            alreadyBlocked
                ? [[true, undefined]]
                : [
                      [true, undefined],
                      [false, theirs],
                  ],
            alreadyBlocked
                ? "a block that was already there is left alone"
                : "blocked, then their own schedule put back"
        );
    }
});

test("AIOStreams can only alert: no pause is recorded", async () => {
    const w = world({
        activity: [row("mia", 95, MON_NOON_LA)],
        limits: { mia: { days: [], minutes: 90, onReach: "pause" } },
    });
    w.prisma.user.findMany = async () => [
        { id: "mia", jellyfinServerKind: "aiostreams", providerType: "jellyfin", username: "Mia" },
    ];
    assert.equal(
        await st.checkScreenTime(w.prisma, { deps: {}, emit: quiet, now: MON_NOON_LA }),
        1
    );
    assert.equal(w.sync.screenTimePauses, undefined);
    assert.doesNotMatch(w.notes[0].body, /paused/);
});

test("which addons play streams, and when midnight is across a clock change", () => {
    assert.equal(st.servesStreams({ manifest: { resources: ["catalog", "meta"] } }), false);
    assert.equal(
        st.servesStreams({ manifest: { resources: [{ name: "stream", types: ["movie"] }] } }),
        true
    );
    assert.equal(st.servesStreams({ manifest: JSON.stringify({ resources: ["stream"] }) }), true);
    assert.equal(st.servesStreams({}), false);
    // US clocks go back on 2026-11-01: that midnight is still daylight time, the next isn't.
    assert.equal(
        st.nextAccountMidnight(TZ, new Date("2026-10-31T19:00:00Z")).toISOString(),
        "2026-11-01T07:00:00.000Z"
    );
    assert.equal(
        st.nextAccountMidnight(TZ, new Date("2026-11-01T20:00:00Z")).toISOString(),
        "2026-11-02T08:00:00.000Z"
    );
});

test("a paused person's addon list drops the group's stream addons - and only while paused", async () => {
    const helpers = require("../server/utils/helpers");
    const { getDesiredAddons } = require("../server/utils/sync");
    const original = helpers.getGroupAddons;
    helpers.getGroupAddons = async () => [
        {
            id: "a1",
            manifest: { name: "Catalogs", resources: ["catalog", "meta"] },
            transportName: "Catalogs",
            transportUrl: "https://catalogs.example.com/manifest.json",
        },
        {
            id: "a2",
            manifest: { name: "Streams", resources: [{ name: "stream", types: ["movie"] }] },
            transportName: "Streams",
            transportUrl: "https://streams.example.com/manifest.json",
        },
        {
            id: "a3",
            manifest: { name: "Both", resources: ["catalog", "stream"] },
            transportName: "Both",
            transportUrl: "https://both.example.com/manifest.json",
        },
    ];
    try {
        let cfg = { screenTimePauses: { mia: { until: "2999-01-01T00:00:00.000Z" } } };
        const deps = {
            _prefetchedUserAddons: [],
            canonicalizeManifestUrl: (u) => u,
            decrypt: (x) => x,
            getAccountId: () => "acc",
            parseAddonIds: () => [],
            parseProtectedAddons: () => [],
            prisma: {
                appAccount: { findUnique: async () => ({ sync: JSON.stringify(cfg) }) },
                group: { findMany: async () => [{ id: "g1" }] },
            },
        };
        const user = { excludedAddons: null, id: "mia", protectedAddons: null };
        const names = (r) => r.addons.map((a) => a.transportName);
        assert.deepEqual(names(await getDesiredAddons(user, {}, deps)), ["Catalogs"]);
        cfg = {};
        assert.deepEqual(names(await getDesiredAddons(user, {}, deps)), [
            "Catalogs",
            "Streams",
            "Both",
        ]);
    } finally {
        helpers.getGroupAddons = original;
    }
});

test('"Back on at" 7 AM: paused until the next 7 AM, not midnight', async () => {
    const w = world({
        activity: [row("mia", 95, MON_NOON_LA)],
        limits: { mia: { days: [], minutes: 90, onReach: "pause", resumeAt: "07:00" } },
    });
    let syncs = 0;
    const deps = {
        syncPerson: async () => {
            syncs++;
        },
    };
    await st.checkScreenTime(w.prisma, { deps, emit: quiet, now: MON_NOON_LA });
    assert.equal(
        w.sync.screenTimePauses.mia.until,
        "2026-10-06T14:00:00.000Z",
        "7 AM Tuesday in Los Angeles"
    );
    assert.match(w.notes[0].body, /paused until 7:00 AM/);
    // Midnight comes and goes: still paused.
    await st.checkScreenTime(w.prisma, {
        deps,
        emit: quiet,
        now: new Date("2026-10-06T07:05:00Z"),
    });
    assert.equal(syncs, 1);
    assert.ok(w.sync.screenTimePauses.mia.until);
    // Just after 7 AM: back on, nothing left behind (it ended on a new day).
    await st.checkScreenTime(w.prisma, {
        deps,
        emit: quiet,
        now: new Date("2026-10-06T14:05:00Z"),
    });
    assert.equal(syncs, 2);
    assert.deepEqual(w.sync.screenTimePauses, {});
});

test("a pause that ends the same day (back on at 9 PM) doesn't start again that day", async () => {
    const w = world({
        activity: [row("mia", 95, MON_NOON_LA)],
        limits: { mia: { days: [], minutes: 90, onReach: "pause", resumeAt: "21:00" } },
    });
    let syncs = 0;
    const deps = {
        syncPerson: async () => {
            syncs++;
        },
    };
    await st.checkScreenTime(w.prisma, { deps, emit: quiet, now: MON_NOON_LA });
    assert.equal(
        w.sync.screenTimePauses.mia.until,
        "2026-10-06T04:00:00.000Z",
        "9 PM Monday in Los Angeles"
    );
    await st.checkScreenTime(w.prisma, {
        deps,
        emit: quiet,
        now: new Date("2026-10-06T04:05:00Z"),
    });
    assert.equal(syncs, 2, "back on at 9 PM");
    await st.checkScreenTime(w.prisma, {
        deps,
        emit: quiet,
        now: new Date("2026-10-06T04:10:00Z"),
    });
    assert.equal(syncs, 2, "still over today's limit, but not paused again");
    assert.equal(w.sync.screenTimePauses.mia.resumedOn !== undefined, true);
});

test("back-on times are cleaned, and land on the right clock across a clock change", () => {
    assert.deepEqual(st.cleanLimit({ days: [], minutes: 60, onReach: "pause", resumeAt: "7:30" }), {
        days: [],
        minutes: 60,
        onReach: "pause",
        resumeAt: "07:30",
    });
    assert.deepEqual(
        st.cleanLimit({ days: [], minutes: 60, onReach: "pause", resumeAt: "00:00" }),
        { days: [], minutes: 60, onReach: "pause" }
    );
    assert.deepEqual(
        st.cleanLimit({ days: [], minutes: 60, onReach: "pause", resumeAt: "25:00" }),
        { days: [], minutes: 60, onReach: "pause" }
    );
    assert.deepEqual(
        st.cleanLimit({ days: [], minutes: 60, resumeAt: "07:00" }),
        { days: [], minutes: 60 },
        "only a pause has one"
    );
    // 1 AM on the morning the clocks go back: 7 AM is seven hours of real time away.
    assert.equal(
        st.nextAccountTime(TZ, new Date("2026-11-01T08:00:00Z"), "07:00").toISOString(),
        "2026-11-01T15:00:00.000Z"
    );
});

test("a pause stays in force until the check lifts it, not just until its time passes", async () => {
    const w = world({
        activity: [row("mia", 95, MON_NOON_LA)],
        limits: { mia: { days: [], minutes: 90, onReach: "pause" } },
    });
    const deps = { syncPerson: async () => undefined };
    await st.checkScreenTime(w.prisma, { deps, emit: quiet, now: MON_NOON_LA });
    // Past midnight on the clock, but no check has run yet.
    assert.equal(
        await st.isStreamingPaused(w.prisma, "acc", "mia"),
        true,
        "the refusals are still expected"
    );
    await st.checkScreenTime(w.prisma, {
        deps,
        emit: quiet,
        now: new Date("2026-10-06T07:01:00Z"),
    });
    assert.equal(await st.isStreamingPaused(w.prisma, "acc", "mia"), false);
});

// ---------------------------------------------------------------------------
// Bedtime: no streaming between two times, on chosen nights

const at = (iso) => new Date(iso);
// Monday 2026-10-05 in Los Angeles (UTC-7): 21:05 is 04:05Z on the 6th.
const MON_2105_LA = at("2026-10-06T04:05:00Z");
const TUE_0005_LA = at("2026-10-06T07:05:00Z");
const TUE_0705_LA = at("2026-10-06T14:05:00Z");

test("a bedtime is cleaned, and knows which night it belongs to", () => {
    assert.deepEqual(
        st.cleanLimit({ bedtime: { days: [0, 1, 2, 3, 4], from: "21:00", to: "7:00" } }),
        { bedtime: { days: [0, 1, 2, 3, 4], from: "21:00", to: "07:00" }, days: [] }
    );
    assert.equal(
        st.cleanLimit({ bedtime: { from: "21:00", to: "21:00" } }),
        null,
        "no hours is no bedtime"
    );
    assert.equal(st.cleanLimit({ bedtime: null, minutes: 0 }), null);
    const school = { days: [0, 1, 2, 3, 4], from: "21:00", to: "07:00" };
    assert.equal(
        st.bedtimeWindow(school, TZ, MON_2105_LA).night,
        "2026-10-05",
        "Monday night, from 9 PM"
    );
    assert.equal(
        st.bedtimeWindow(school, TZ, TUE_0005_LA).night,
        "2026-10-05",
        "still Monday night after midnight"
    );
    assert.equal(st.bedtimeWindow(school, TZ, TUE_0705_LA), null, "over at 7 AM");
    assert.equal(st.bedtimeWindow(school, TZ, MON_NOON_LA), null);
    // Friday 2026-10-09 21:05 LA: not a school night.
    assert.equal(st.bedtimeWindow(school, TZ, at("2026-10-10T04:05:00Z")), null);
    // A bedtime within the day: 1 PM to 3 PM.
    assert.ok(st.bedtimeWindow({ days: [], from: "11:30", to: "13:00" }, TZ, MON_NOON_LA));
});

test("bedtime pauses from its start to its end, without a limit or an alert", async () => {
    const w = world({
        activity: [],
        limits: { mia: { bedtime: { days: [], from: "21:00", to: "07:00" } } },
    });
    const synced = [];
    const deps = {
        syncPerson: async (_p, _a, id) => {
            synced.push(await st.isStreamingPaused(w.prisma, "acc", id));
        },
    };
    assert.equal(await st.checkScreenTime(w.prisma, { deps, emit: quiet, now: MON_NOON_LA }), 0);
    assert.equal(await st.isStreamingPaused(w.prisma, "acc", "mia"), false);
    await st.checkScreenTime(w.prisma, { deps, emit: quiet, now: MON_2105_LA });
    assert.equal(await st.isStreamingPaused(w.prisma, "acc", "mia"), true);
    assert.equal(w.sync.screenTimePauses.mia.until, "2026-10-06T14:00:00.000Z", "until 7 AM");
    await st.checkScreenTime(w.prisma, { deps, emit: quiet, now: TUE_0005_LA });
    assert.equal(await st.isStreamingPaused(w.prisma, "acc", "mia"), true);
    await st.checkScreenTime(w.prisma, { deps, emit: quiet, now: TUE_0705_LA });
    assert.equal(await st.isStreamingPaused(w.prisma, "acc", "mia"), false);
    assert.deepEqual(synced, [true, false], "one sync to pause, one to resume");
    assert.equal(w.notes.length, 0, "a bedtime is expected - no alert");
});

test("the limit's pause runs on into bedtime without lifting in between", async () => {
    const w = world({
        activity: [row("mia", 95, MON_NOON_LA)],
        limits: {
            mia: {
                bedtime: { days: [], from: "21:00", to: "07:00" },
                days: [],
                minutes: 90,
                onReach: "pause",
            },
        },
    });
    let syncs = 0;
    const deps = {
        syncPerson: async () => {
            syncs++;
        },
    };
    await st.checkScreenTime(w.prisma, { deps, emit: quiet, now: MON_NOON_LA });
    assert.equal(
        w.sync.screenTimePauses.mia.until,
        "2026-10-06T07:00:00.000Z",
        "until midnight for the limit"
    );
    await st.checkScreenTime(w.prisma, { deps, emit: quiet, now: MON_2105_LA });
    assert.equal(
        w.sync.screenTimePauses.mia.until,
        "2026-10-06T14:00:00.000Z",
        "bedtime carries it to 7 AM"
    );
    await st.checkScreenTime(w.prisma, { deps, emit: quiet, now: TUE_0005_LA });
    assert.equal(
        await st.isStreamingPaused(w.prisma, "acc", "mia"),
        true,
        "not lifted at midnight"
    );
    await st.checkScreenTime(w.prisma, { deps, emit: quiet, now: TUE_0705_LA });
    assert.equal(await st.isStreamingPaused(w.prisma, "acc", "mia"), false);
    assert.equal(syncs, 2, "paused once, resumed once");
});

test('"Resume now" at bedtime gives back that night only', async () => {
    const w = world({
        activity: [],
        limits: { mia: { bedtime: { days: [], from: "21:00", to: "07:00" } } },
    });
    const deps = { syncPerson: async () => undefined };
    await st.checkScreenTime(w.prisma, { deps, emit: quiet, now: MON_2105_LA });
    await st.resume(w.prisma, "acc", "mia", deps, { now: at("2026-10-06T04:10:00Z") });
    await st.checkScreenTime(w.prisma, { deps, emit: quiet, now: TUE_0005_LA });
    assert.equal(await st.isStreamingPaused(w.prisma, "acc", "mia"), false, "not again that night");
    await st.checkScreenTime(w.prisma, { deps, emit: quiet, now: at("2026-10-07T04:05:00Z") });
    assert.equal(
        await st.isStreamingPaused(w.prisma, "acc", "mia"),
        true,
        "Tuesday night is bedtime again"
    );
});

test("AIOStreams pauses through its variant, and the same users are given back", async () => {
    const w = world({
        activity: [row("mia", 95, MON_NOON_LA)],
        limits: { mia: { days: [], minutes: 90, onReach: "pause" } },
    });
    const mia = {
        id: "mia",
        jellyfinServerKind: "aiostreams",
        providerType: "jellyfin",
        username: "Mia",
    };
    w.prisma.user.findMany = async () => [mia];
    w.prisma.user.findFirst = async () => mia;
    const calls = [];
    const deps = {
        setAioPaused: async (_p, _a, _person, paused, opts) => {
            calls.push([paused, opts.users]);
            return { users: ["u1", "u2"] };
        },
    };
    await st.checkScreenTime(w.prisma, { deps, emit: quiet, now: MON_NOON_LA });
    assert.deepEqual(w.sync.screenTimePauses.mia.aioUsers, ["u1", "u2"]);
    assert.match(w.notes[0].body, /paused until midnight/);
    await st.checkScreenTime(w.prisma, { deps, emit: quiet, now: TUE_0005_LA });
    assert.deepEqual(calls, [
        [true, undefined],
        [false, ["u1", "u2"]],
    ]);
});

test('Jellyfin with "stop what\'s playing": a warning ten minutes before, then stopped', async () => {
    st.forgetWarningsForTests();
    const limits = { mia: { days: [], minutes: 90, onReach: "pause", stopPlaying: true } };
    const activity = [row("mia", 82, MON_NOON_LA)];
    const w = world({ activity, limits });
    const mia = {
        id: "mia",
        jellyfinServerKind: "jellyfin",
        providerType: "jellyfin",
        username: "Mia",
    };
    w.prisma.user.findMany = async () => [mia];
    w.prisma.user.findFirst = async () => mia;
    const screens = [];
    const deps = {
        messageScreens: async (_p, _a, _id, opts) => {
            screens.push([opts.text, !!opts.stop]);
            return 1;
        },
        setJellyfinBlocked: async (_p, _a, _id, blocked) => (blocked ? [] : null),
    };
    await st.checkScreenTime(w.prisma, { deps, emit: quiet, now: MON_NOON_LA });
    await st.checkScreenTime(w.prisma, {
        deps,
        emit: quiet,
        now: new Date(MON_NOON_LA.getTime() + 60_000),
    });
    assert.deepEqual(screens, [["8 minutes of watching left today.", false]], "warned once");
    activity.push(row("mia", 10, MON_NOON_LA));
    await st.checkScreenTime(w.prisma, {
        deps,
        emit: quiet,
        now: new Date(MON_NOON_LA.getTime() + 120_000),
    });
    assert.deepEqual(screens[1], ["Streaming is paused until midnight.", true]);
});

test('switching the limit off forgets a "Resume now", so switching it on again applies at once', async () => {
    const w = world({
        activity: [],
        limits: { mia: { bedtime: { days: [], from: "21:00", to: "07:00" } } },
    });
    const deps = { syncPerson: async () => undefined };
    await st.checkScreenTime(w.prisma, { deps, emit: quiet, now: MON_2105_LA });
    await st.resume(w.prisma, "acc", "mia", deps, { now: at("2026-10-06T04:10:00Z") });
    assert.ok(w.sync.screenTimePauses.mia?.skipNight, "tonight given back");
    await st.setLimit(w.prisma, "acc", "mia", null, deps);
    assert.equal(w.sync.screenTimePauses.mia, undefined);
});

// The person's own phone (devices they turned notifications on for from their
// page): the same ten minutes' notice Jellyfin puts on screen, for every kind
// of account, and a word when the pause starts - once each.
test("the person's phone: ten minutes' notice, then the pause, once each", async () => {
    st.forgetWarningsForTests();
    const activity = [row("mia", 82, MON_NOON_LA)];
    const w = world({ activity, limits: { mia: { days: [], minutes: 90, onReach: "pause" } } });
    const pushes = [];
    const deps = {
        sendPushToPerson: async (_p, _a, id, payload) => {
            pushes.push([id, payload.title]);
        },
        syncPerson: async () => undefined,
    };
    await st.checkScreenTime(w.prisma, { deps, emit: quiet, now: MON_NOON_LA });
    await st.checkScreenTime(w.prisma, {
        deps,
        emit: quiet,
        now: new Date(MON_NOON_LA.getTime() + 60_000),
    });
    assert.deepEqual(pushes, [["mia", "8 minutes of watching left today"]]);
    activity.push(row("mia", 10, MON_NOON_LA));
    await st.checkScreenTime(w.prisma, {
        deps,
        emit: quiet,
        now: new Date(MON_NOON_LA.getTime() + 120_000),
    });
    assert.deepEqual(pushes[1], ["mia", "Streaming paused"]);
    assert.equal(pushes.length, 2);
});

test("a limit that only tells you warns nobody's phone", async () => {
    st.forgetWarningsForTests();
    const w = world({
        activity: [row("mia", 85, MON_NOON_LA)],
        limits: { mia: { days: [], minutes: 90 } },
    });
    const pushes = [];
    await st.checkScreenTime(w.prisma, {
        deps: {
            sendPushToPerson: async (...a) => {
                pushes.push(a);
            },
        },
        emit: quiet,
        now: MON_NOON_LA,
    });
    assert.deepEqual(pushes, []);
});

test('bedtime on the person\'s phone: a heads-up ten minutes before, and "Bedtime" when it starts', async () => {
    st.forgetWarningsForTests();
    const w = world({
        activity: [],
        limits: { mia: { bedtime: { days: [], from: "21:00", to: "07:00" } } },
    });
    const pushes = [];
    const deps = {
        sendPushToPerson: async (_p, _a, _id, payload) => {
            pushes.push(payload.title);
        },
        syncPerson: async () => undefined,
    };
    await st.checkScreenTime(w.prisma, { deps, emit: quiet, now: at("2026-10-06T03:52:00Z") }); // 8:52 PM in LA
    await st.checkScreenTime(w.prisma, { deps, emit: quiet, now: MON_2105_LA });
    assert.deepEqual(pushes, ["Bedtime in 8 minutes", "Bedtime"]);
});

// After a pause on Stremio and Nuvio, their app can write the paused addon
// list back to their account (seen live on Nuvio). For a while after the
// pause ends, exactly that list coming back is undone - and nothing else.
const PAUSED = [{ transportUrl: "https://cinemeta.example.com/manifest.json" }];
const FULL = [...PAUSED, { transportUrl: "https://streams.example.com/manifest.json" }];
function afterPauseWorld() {
    const w = world({
        activity: [],
        limits: { mia: { bedtime: { days: [], from: "21:00", to: "07:00" } } },
    });
    const account = { addons: FULL };
    let syncs = 0;
    const deps = {
        readAddons: async () => account.addons,
        sendPushToPerson: async () => undefined,
        // SlickSync's own sync: the paused list while paused, the full one after.
        syncPerson: async (_p, _a, id) => {
            syncs++;
            account.addons = (await st.isStreamingPaused(w.prisma, "acc", id)) ? PAUSED : FULL;
        },
    };
    return { account, deps, syncs: () => syncs, w };
}
const TUE_0701_LA = at("2026-10-06T14:01:00Z");
const later = (d, min) => new Date(d.getTime() + min * 60_000);

test("after a pause: the app writing the paused list back is undone, and said so", async () => {
    const { w, account, deps, syncs } = afterPauseWorld();
    await st.checkScreenTime(w.prisma, { deps, emit: quiet, now: MON_2105_LA });
    assert.deepEqual(account.addons, PAUSED, "paused at bedtime");
    await st.checkScreenTime(w.prisma, { deps, emit: quiet, now: TUE_0701_LA });
    assert.deepEqual(account.addons, FULL, "bedtime over, full list back");
    const before = syncs();
    account.addons = PAUSED; // their app writes its paused list back
    await st.checkScreenTime(w.prisma, { deps, emit: quiet, now: later(TUE_0701_LA, 2) });
    assert.deepEqual(account.addons, FULL, "put back");
    assert.equal(syncs(), before + 1);
    assert.ok(w.notes.some((n) => /Mia's addons put back/.test(n.title)));
    await st.checkScreenTime(w.prisma, { deps, emit: quiet, now: later(TUE_0701_LA, 3) });
    assert.equal(syncs(), before + 1, "nothing more to do while the full list holds");
});

test("after a pause: any other change is the household's, and is left alone", async () => {
    const { w, account, deps, syncs } = afterPauseWorld();
    await st.checkScreenTime(w.prisma, { deps, emit: quiet, now: MON_2105_LA });
    await st.checkScreenTime(w.prisma, { deps, emit: quiet, now: TUE_0701_LA });
    const before = syncs();
    account.addons = [...FULL, { transportUrl: "https://their-own.example.com/manifest.json" }];
    await st.checkScreenTime(w.prisma, { deps, emit: quiet, now: later(TUE_0701_LA, 2) });
    assert.equal(syncs(), before);
    assert.equal(account.addons.length, 3);
});

test("after a pause: the watch ends after a while, and after a few tries", async () => {
    const { w, account, deps, syncs } = afterPauseWorld();
    await st.checkScreenTime(w.prisma, { deps, emit: quiet, now: MON_2105_LA });
    await st.checkScreenTime(w.prisma, { deps, emit: quiet, now: TUE_0701_LA });
    // An app that keeps writing it back: three tries, then SlickSync stops.
    const before = syncs();
    for (let m = 2; m <= 6; m++) {
        account.addons = PAUSED;
        await st.checkScreenTime(w.prisma, { deps, emit: quiet, now: later(TUE_0701_LA, m) });
    }
    assert.equal(syncs(), before + 3);
    // And a fresh pause's watch is gone once its 15 minutes are up.
    const second = afterPauseWorld();
    await st.checkScreenTime(second.w.prisma, { deps: second.deps, emit: quiet, now: MON_2105_LA });
    await st.checkScreenTime(second.w.prisma, { deps: second.deps, emit: quiet, now: TUE_0701_LA });
    const n = second.syncs();
    second.account.addons = PAUSED;
    await st.checkScreenTime(second.w.prisma, {
        deps: second.deps,
        emit: quiet,
        now: later(TUE_0701_LA, 20),
    });
    assert.equal(second.syncs(), n, "too late to be the pause");
    assert.equal(second.w.sync.screenTimeAfterPause?.mia, undefined);
});

test("the gate: one sync when someone's pause set-up starts, and one when it stops", async () => {
    const w = world({
        activity: [],
        gateSettled: false,
        limits: {
            leo: { days: [], minutes: 90 },
            mia: { bedtime: { days: [], from: "21:00", to: "07:00" } },
        },
    });
    const synced = [];
    const deps = {
        gateUsable: async () => ({ ok: true }),
        syncPerson: async (_p, _a, id) => {
            synced.push(id);
        },
    };
    await st.checkScreenTime(w.prisma, { deps, emit: quiet, now: MON_NOON_LA });
    assert.deepEqual(synced, ["mia"], "Mia (a bedtime) gets the gate; Leo's limit only alerts");
    assert.equal(w.sync.screenTimeGate.mia.on, true);
    await st.checkScreenTime(w.prisma, { deps, emit: quiet, now: later(MON_NOON_LA, 1) });
    assert.deepEqual(synced, ["mia"], "once");
    await st.setLimit(w.prisma, "acc", "mia", null, deps);
    const before = synced.length;
    await st.checkScreenTime(w.prisma, { deps, emit: quiet, now: later(MON_NOON_LA, 2) });
    assert.deepEqual(
        synced.slice(before),
        ["mia"],
        "bedtime off: synced back to the real addresses"
    );
    assert.equal(w.sync.screenTimeGate.mia, undefined);
});

test("the gate: a sync that fails is tried again in a while, not every minute", async () => {
    const w = world({
        activity: [],
        gateSettled: false,
        limits: { mia: { bedtime: { days: [], from: "21:00", to: "07:00" } } },
    });
    let tries = 0;
    let fail = true;
    const deps = {
        gateUsable: async () => ({ ok: true }),
        syncPerson: async () => {
            tries++;
            if (fail) {
                throw new Error("Nuvio said no");
            }
        },
    };
    await st.checkScreenTime(w.prisma, { deps, emit: quiet, now: MON_NOON_LA });
    assert.equal(tries, 1);
    assert.ok(w.sync.screenTimeGate.mia.retryAt);
    await st.checkScreenTime(w.prisma, { deps, emit: quiet, now: later(MON_NOON_LA, 5) });
    assert.equal(tries, 1);
    fail = false;
    await st.checkScreenTime(w.prisma, { deps, emit: quiet, now: later(MON_NOON_LA, 16) });
    assert.equal(tries, 2);
    assert.deepEqual(Object.keys(w.sync.screenTimeGate.mia).sort(), ["at", "checkedAt", "on"]);
});
