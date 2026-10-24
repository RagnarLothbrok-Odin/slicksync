const test = require("node:test");
const assert = require("node:assert/strict");

test("continue watching scopes all history and dismissals before selection and separates profile caches", async () => {
    const imports = require("../server/utils/listImport");
    const original = imports.resolveOmdbKeyForAccount;
    imports.resolveOmdbKeyForAccount = async () => null;
    const {
        getContinueWatching,
        invalidateContinueWatching,
    } = require("../server/utils/continueWatching");
    const calls = [];
    const empty = (model) => ({
        findMany: async (args) => {
            calls.push({ model, where: args.where });
            return [];
        },
    });
    const prisma = {
        dismissedContinueWatching: empty("dismissals"),
        episodeWatchHistory: empty("episodes"),
        movieWatchHistory: empty("movies"),
        user: empty("users"),
    };
    try {
        for (const userId of ["first", "second"]) {
            const offset = calls.length;
            assert.deepEqual(await getContinueWatching(prisma, "scope-test", 12, userId), []);
            for (const model of ["episodes", "movies", "dismissals"]) {
                const call = calls.slice(offset).find((row) => row.model === model);
                assert.equal(call.where.userId, userId);
                assert.equal(call.where.accountId, "scope-test");
            }
        }
        const cached = calls.length;
        await getContinueWatching(prisma, "scope-test", 12, "first");
        assert.equal(calls.length, cached);
        invalidateContinueWatching("scope-test");
        await getContinueWatching(prisma, "scope-test", 12, "first");
        assert.ok(calls.length > cached);
        const offset = calls.length;
        await getContinueWatching(prisma, "scope-test", 12);
        assert.equal(
            calls.slice(offset).find((row) => row.model === "episodes").where.userId,
            undefined
        );
    } finally {
        imports.resolveOmdbKeyForAccount = original;
        invalidateContinueWatching("scope-test");
    }
});

test("personal calendar scopes watched shows before the result limit", async () => {
    const { getUpcomingEpisodes } = require("../server/utils/episodeAlerts");
    const calls = [];
    const prisma = {
        dismissedUpcomingEpisode: { findMany: async () => [] },
        episodeWatchHistory: {
            findMany: async (args) => {
                calls.push(args);
                return [{ showId: "tt-own" }];
            },
        },
        mutedShow: { findMany: async () => [] },
        showEpisodeAlertState: {
            findMany: async (args) => {
                calls.push(args);
                return [];
            },
        },
    };
    assert.deepEqual(await getUpcomingEpisodes(prisma, "house", 24, "viewer"), []);
    assert.deepEqual(calls[0].where, { accountId: "house", userId: "viewer" });
    assert.deepEqual(calls[1].where.showId, { in: ["tt-own"] });
    assert.equal(calls[1].take, 24);
    calls.length = 0;
    await getUpcomingEpisodes(prisma, "house");
    assert.equal(calls[0].where.showId, undefined);
});
