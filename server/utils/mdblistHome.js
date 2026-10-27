function mapMdblistStats(response) {
    if (!(response && Object.hasOwn(response, "stats"))) {
        throw new Error("MDBList returned an invalid statistics response.");
    }
    if (response.stats === null) {
        return { available: false, stats: {} };
    }
    const source = response.stats;
    const values = {
        episodesCount: source.episodes?.all_time,
        moviesCount: source.movies?.all_time,
        seriesCount: source.shows?.all_time,
        totalWatchTimeHours: source.runtime?.all_time_hours,
    };
    if (!Object.values(values).every((value) => Number.isFinite(value) && value >= 0)) {
        throw new Error("MDBList returned incomplete aggregate statistics.");
    }
    const stats = { ...values, totalWatchTimeSeconds: values.totalWatchTimeHours * 3600 };
    const streaks = source.watch_activity?.summary?.total;
    if (Number.isInteger(streaks?.current_streak) && streaks.current_streak >= 0) {
        stats.currentStreak = streaks.current_streak;
    }
    if (Number.isInteger(streaks?.longest_streak) && streaks.longest_streak >= 0) {
        stats.longestStreak = streaks.longest_streak;
    }
    return { available: true, stats };
}
module.exports = { mapMdblistStats };
