const test = require("node:test");
const assert = require("node:assert/strict");
const st = require("../server/utils/screenTime");

const TZ = "America/Los_Angeles";
const NOW = new Date("2026-10-05T19:00:00Z"); // Monday noon in Los Angeles
const KID = "np-nuv1-3";
const quiet = async () => undefined;

// One Nuvio login: Dad is its main profile's person; profile 3, "Kid", is
// merged into him (its viewing is recorded on Dad, labelled "Kid").
function family({
    limits,
    activity,
    profiles = { [KID]: { at: NOW.toISOString(), name: "Kid", sharesPrimary: false } },
}) {
    const notes = [];
    let sync = { accountTimezone: TZ, screenTime: limits, screenTimeProfiles: profiles };
    const dad = {
        accountId: "acc",
        createdAt: new Date(0),
        email: "dad@example.invalid",
        id: "dad",
        isActive: true,
        jellyfinServerKind: null,
        nuvioProfileId: 1,
        nuvioUserId: "nuv1",
        providerType: "nuvio",
        username: "Dad",
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
        group: { count: async () => 1 },
        notification: {
            create: async ({ data }) => {
                notes.push(data);
                return data;
            },
            findUnique: async ({ where }) =>
                notes.find((n) => n.dedupeKey === where.accountId_dedupeKey.dedupeKey) || null,
            upsert: async ({ create }) => {
                notes.push(create);
                return create;
            },
        },
        nuvioProfileRoute: { findMany: async () => [] },
        user: {
            findFirst: async ({ where }) => (where.id === "dad" ? dad : null),
            findMany: async ({ where }) => {
                if (where.id?.in) {
                    return where.id.in.includes("dad") ? [dad] : [];
                }
                return where.nuvioUserId === "nuv1" ? [dad] : [];
            },
            findUnique: async ({ where }) => (where.id === "dad" ? dad : null),
        },
        watchActivity: {
            groupBy: async ({ by, where }) => {
                // These fixtures describe today's activity; date boundaries are covered separately.
                const rows = activity.filter(
                    (a) => where.userId.in.includes(a.userId) && (!where.profileLabel || a.label)
                );
                const key = (a) =>
                    by.includes("profileLabel") ? `${a.userId}|${a.label}` : a.userId;
                const sums = new Map();
                for (const a of rows) {
                    sums.set(key(a), {
                        profileLabel: a.label || null,
                        s: (sums.get(key(a))?.s || 0) + a.minutes * 60,
                        userId: a.userId,
                    });
                }
                return [...sums.values()].map((r) => ({
                    _sum: { watchTimeSeconds: r.s },
                    profileLabel: r.profileLabel,
                    userId: r.userId,
                }));
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

test("a merged profile's own daily limit counts its own minutes, pauses only it, and alerts under its name", async () => {
    const w = family({
        activity: [
            { label: "Kid", minutes: 65, userId: "dad" },
            { label: "Main", minutes: 20, userId: "dad" },
        ],
        limits: { [KID]: { days: [], minutes: 60, onReach: "pause" } },
    });
    const wrapped = [];
    const synced = [];
    const deps = {
        gateUsable: async () => ({ ok: true }),
        syncPerson: async (_p, _a, id) => {
            synced.push(id);
        },
        wrapProfile: async (_p, _a, person, want) => {
            wrapped.push([person.id, want]);
        },
    };
    await st.checkScreenTime(w.prisma, { deps, emit: quiet, now: NOW });
    assert.ok(w.sync.screenTimePauses[KID]?.until, "Kid is paused");
    assert.equal(w.sync.screenTimePauses.dad, undefined, "Dad is not");
    assert.deepEqual(wrapped, [[KID, true]], "Kid's stream addons went behind the gate, once");
    assert.deepEqual(synced, [], "nobody's addon list was synced - the gate does the pausing");
    assert.ok(
        w.notes.some(
            (n) => /^Kid reached today's 60-minute limit/.test(n.title) && n.url === "/users/dad"
        )
    );

    await st.checkScreenTime(w.prisma, {
        deps,
        emit: quiet,
        now: new Date(NOW.getTime() + 60_000),
    });
    assert.deepEqual(wrapped, [[KID, true]], "not again");
});

test("the person a profile is merged into stops counting its minutes once it has a limit of its own", async () => {
    const activity = [
        { label: "Kid", minutes: 65, userId: "dad" },
        { label: "Main", minutes: 20, userId: "dad" },
    ];
    const w = family({
        activity,
        limits: { dad: { days: [], minutes: 600 }, [KID]: { days: [], minutes: 60 } },
    });
    const dad = await st.getLimit(w.prisma, "acc", "dad", {
        gateUsable: async () => ({ ok: true }),
    });
    const kid = await st.getLimit(w.prisma, "acc", KID, { gateUsable: async () => ({ ok: true }) });
    assert.equal(kid.todayMinutes, 65);
    assert.equal(dad.todayMinutes, 20, "85 minutes recorded on Dad, 65 of them Kid's");
    assert.deepEqual(kid.profileOf, { kind: "nuvio-profile", name: "Dad" });
});

test("a profile on the main profile's addons can only alert", async () => {
    const w = family({
        activity: [{ label: "Kid", minutes: 65, userId: "dad" }],
        limits: { [KID]: { days: [], minutes: 60, onReach: "pause" } },
        profiles: { [KID]: { at: NOW.toISOString(), name: "Kid", sharesPrimary: true } },
    });
    const view = await st.getLimit(w.prisma, "acc", KID, {
        gateUsable: async () => ({ ok: true }),
    });
    assert.equal(view.canPause.ok, false);
    assert.equal(view.canPause.code, "shares-addons");
    const wrapped = [];
    await st.checkScreenTime(w.prisma, {
        deps: {
            gateUsable: async () => ({ ok: true }),
            wrapProfile: async (...a) => {
                wrapped.push(a);
            },
        },
        emit: quiet,
        now: NOW,
    });
    assert.equal(w.sync.screenTimePauses?.[KID], undefined, "not paused");
    assert.ok(
        w.notes.some((n) => /^Kid reached/.test(n.title)),
        "but you are told"
    );
});

test("without a gate devices can reach, a profile can't be paused - and says why", async () => {
    const w = family({
        activity: [],
        limits: { [KID]: { bedtime: { days: [], from: "09:00", to: "23:00" } } },
    });
    const view = await st.getLimit(w.prisma, "acc", KID, {
        gateUsable: async () => ({ ok: false }),
    });
    assert.equal(view.canPause.code, "needs-address");
});
