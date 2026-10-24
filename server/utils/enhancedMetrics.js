// Phase 3: Enhanced Metrics Calculations

const { getAccountDateString } = require("./dateUtils");

/**
 * Calculate top items with user details
 * Uses watchSessions to get item details and track per-user watch time
 */
function calculateTopItemsWithUsers(watchSessions, allUsers) {
    const itemStats = new Map();
    // allUsers carries avatarUrl/colorIndex/email (see metricsBuilder.js's own
    // select) but was previously accepted as a param and never actually read -
    // session.user only ever had username, so every avatar in this panel's
    // per-user breakdown silently fell back to an initial-letter circle
    // regardless of whether the user had a real uploaded avatar.
    const userInfoById = new Map((allUsers || []).map((u) => [u.id, u]));

    // Process each session to aggregate by item and track users
    watchSessions.forEach((session) => {
        const itemId = session.item.id;
        const userId = session.user.id;
        const duration = session.durationSeconds || 0;
        const episode = session.item.episode;
        const season = session.item.season;

        if (!itemStats.has(itemId)) {
            itemStats.set(itemId, {
                itemId,
                name: session.item.name,
                poster: session.item.poster,
                totalWatchTimeHours: 0,
                totalWatchTimeSeconds: 0,
                type: session.item.type,
                users: new Map(), // Use Map to track unique users and their watch times
            });
        }

        const stats = itemStats.get(itemId);
        stats.totalWatchTimeSeconds += duration;

        // Track per-user watch time (accumulate if user watched multiple times)
        if (!stats.users.has(userId)) {
            const userInfo = userInfoById.get(userId);
            stats.users.set(userId, {
                avatarUrl: userInfo?.avatarUrl ?? null,
                colorIndex: userInfo?.colorIndex,
                email: userInfo?.email,
                episodesWatched: new Set(), // Track unique episodes for series
                useGravatar: userInfo?.useGravatar === true,
                userId,
                username: session.user.username,
                watchTimeHours: 0,
                watchTimeSeconds: 0,
            });
        }
        const userStats = stats.users.get(userId);
        userStats.watchTimeSeconds += duration;
        userStats.watchTimeHours = Math.round((userStats.watchTimeSeconds / 3600) * 100) / 100;

        // Track unique episodes for series
        if (session.item.type === "series" && season !== undefined && episode !== undefined) {
            const episodeKey = `${season}:${episode}`;
            userStats.episodesWatched.add(episodeKey);
        }
    });

    // Convert to final format
    const processedItems = Array.from(itemStats.values()).map((stats) => ({
        itemId: stats.itemId,
        name: stats.name,
        poster: stats.poster,
        totalWatchTimeHours: Math.round((stats.totalWatchTimeSeconds / 3600) * 100) / 100,
        totalWatchTimeSeconds: stats.totalWatchTimeSeconds,
        type: stats.type,
        userCount: stats.users.size,
        users: Array.from(stats.users.values()).map((user) => ({
            ...user,
            episodesWatched:
                user.episodesWatched instanceof Set
                    ? user.episodesWatched.size
                    : user.episodesWatched,
        })),
    }));

    // Sort by watch time and split by type
    const sorted = processedItems.sort((a, b) => b.totalWatchTimeSeconds - a.totalWatchTimeSeconds);

    return {
        movies: sorted.filter((item) => item.type === "movie").slice(0, 10),
        series: sorted.filter((item) => item.type === "series").slice(0, 10),
    };
}

/**
 * Calculate watch velocity (episodes per day for series)
 * Uses WatchSession data to count actual episodes watched per day
 * This provides accurate binge watching statistics
 */
function calculateWatchVelocity(watchSessions, accountTimeZone) {
    const seriesStats = new Map();

    // Group sessions by show and track episodes per day
    watchSessions.forEach((session) => {
        if (session.item.type !== "series") {
            return;
        }

        const itemId = session.item.id;
        const episode = session.item.episode;
        const season = session.item.season;
        // session.startTime is a real timestamp (unlike WatchActivity.date, which
        // is pre-bucketed to account-day at write time) - bucketing it by UTC day
        // could split one binge-watching evening into two "days" (or merge two
        // into one) for any account west of UTC, skewing episodes-per-day.
        const watchDate = getAccountDateString(new Date(session.startTime), accountTimeZone);

        if (!seriesStats.has(itemId)) {
            seriesStats.set(itemId, {
                daysActive: new Set(),
                episodesByDay: new Map(), // Track unique episodes per day
                itemId,
                name: session.item.name,
                poster: session.item.poster,
                totalWatchTime: 0,
                uniqueEpisodes: new Set(), // Track all unique episodes
            });
        }

        const stats = seriesStats.get(itemId);
        stats.totalWatchTime += session.durationSeconds || 0;
        stats.daysActive.add(watchDate);

        // Track unique episodes
        const episodeKey = `${season}:${episode}`;
        stats.uniqueEpisodes.add(episodeKey);

        // Track episodes per day
        if (!stats.episodesByDay.has(watchDate)) {
            stats.episodesByDay.set(watchDate, new Set());
        }
        stats.episodesByDay.get(watchDate).add(episodeKey);
    });

    return Array.from(seriesStats.values())
        .map((stats) => {
            const daysActive = stats.daysActive.size;
            const totalEpisodes = stats.uniqueEpisodes.size;

            // Calculate average episodes per day
            let episodesPerDay = 0;
            if (daysActive > 0) {
                // Sum up episodes watched each day and average
                let totalDailyEpisodes = 0;
                stats.episodesByDay.forEach((episodes) => {
                    totalDailyEpisodes += episodes.size;
                });
                episodesPerDay = totalDailyEpisodes / daysActive;
            }

            return {
                daysActive,
                episodesPerDay: Math.round(episodesPerDay * 100) / 100,
                episodesPerWeek: Math.round(episodesPerDay * 7 * 100) / 100,
                estimatedEpisodes: totalEpisodes,
                itemId: stats.itemId,
                name: stats.name,
                poster: stats.poster,
                totalWatchTimeHours: Math.round((stats.totalWatchTime / 3600) * 100) / 100,
            };
        })
        .sort((a, b) => b.episodesPerDay - a.episodesPerDay)
        .slice(0, 10);
}

/**
 * Calculate interesting metrics
 */
function calculateInterestingMetrics(watchActivityByUser, engagement, watchSessions, _allUsers) {
    const activeUsers = Object.keys(watchActivityByUser).length;
    const totalWatchTime = Object.values(watchActivityByUser).reduce(
        (sum, u) => sum + (u.watchTime || 0),
        0
    );

    // Average watch time per user
    const avgWatchTimePerUser =
        activeUsers > 0 ? Math.round((totalWatchTime / activeUsers / 3600) * 100) / 100 : 0;

    // Most active hour from engagement data
    const mostActiveHour = engagement?.peakHour ?? 0;

    // Weekend vs weekday watching (from watch sessions)
    let weekendCount = 0;
    let totalCount = 0;
    watchSessions.forEach((session) => {
        const day = new Date(session.startTime).getDay();
        if (day === 0 || day === 6) {
            weekendCount++;
        }
        totalCount++;
    });
    const weekendWatchPercentage =
        totalCount > 0 ? Math.round((weekendCount / totalCount) * 100) : 0;

    // Completion rate (sessions that ended naturally vs total)
    const completedSessions = watchSessions.filter(
        (s) => s.endTime && s.durationSeconds > 600
    ).length;
    const completionRate =
        watchSessions.length > 0 ? Math.round((completedSessions / watchSessions.length) * 100) : 0;

    return {
        avgSessionDuration: engagement?.averageSessionMinutes || 0,
        avgWatchTimePerUser,
        completionRate,
        mostActiveHour,
        totalBingeSessions: engagement?.bingeSessions || 0,
        weekendWatchPercentage,
    };
}

module.exports = {
    calculateInterestingMetrics,
    calculateTopItemsWithUsers,
    calculateWatchVelocity,
};
