const test = require("node:test");
const assert = require("node:assert/strict");
const { mapMdblistStats } = require("../server/utils/mdblistHome");

test("MDBList home uses aggregate all-time fields and converts reported hours to seconds", () => {
    const result = mapMdblistStats({
        stats: {
            episodes: { all_time: 1200 },
            movies: { all_time: 100, year: 3 },
            runtime: { all_time_hours: 932.25, year_hours: 10 },
            shows: { all_time: 40, watched: 35 },
            watch_activity: { summary: { total: { current_streak: 3, longest_streak: 12 } } },
        },
    });
    assert.equal(result.available, true);
    assert.equal(result.stats.moviesCount, 100);
    assert.equal(result.stats.seriesCount, 40);
    assert.equal(result.stats.episodesCount, 1200);
    assert.equal(result.stats.totalWatchTimeSeconds, 3_356_100);
    assert.equal(result.stats.currentStreak, 3);
    assert.equal(result.stats.longestStreak, 12);
    assert.equal(result.stats.watchedTodayCount, undefined);
    assert.equal(result.stats.avgWatchTimeSeconds, undefined);
});

test("MDBList uncalculated statistics remain unavailable instead of becoming zero totals", () => {
    assert.deepEqual(mapMdblistStats({ stats: null }), { available: false, stats: {} });
    assert.throws(() => mapMdblistStats({}), /invalid statistics/);
    assert.throws(() => mapMdblistStats({ stats: { movies: {} } }), /incomplete aggregate/);
});
