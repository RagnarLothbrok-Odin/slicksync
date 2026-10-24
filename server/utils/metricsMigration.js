/**
 * Metrics Migration - Populate watchSessions and episodeWatchHistory from historical WatchActivity data
 *
 * This runs at startup to backfill historical session data for v1.0.0+ features when upgrading from older versions.
 */

const { getCachedLibrary } = require("./libraryCache");
const { fetchMetadata } = require("./notify");

/**
 * Extract season/episode from video_id or item state
 */
function extractSeasonEpisode(item) {
    let season = item?.state?.season ?? null;
    let episode = item?.state?.episode ?? null;

    if (item?.state?.video_id) {
        const videoId = item.state.video_id;
        const parts = videoId.split(":");

        if (videoId.startsWith("kitsu:") && parts.length >= 3) {
            const episodePart = parts.at(-1);
            const parsedEpisode = Number.parseInt(episodePart, 10);
            if (!Number.isNaN(parsedEpisode)) {
                episode = parsedEpisode;
            }
            season = 1;
        } else if (parts.length >= 3 && parts[0].startsWith("tt")) {
            season = Number.parseInt(parts[1], 10) || season;
            episode = Number.parseInt(parts[2], 10) || episode;
        } else if (parts.length === 2 && parts[0].startsWith("tt")) {
            episode = Number.parseInt(parts[1], 10) || episode;
        }
    }

    return { episode, season };
}

/**
 * Get item metadata - first from cache, then from external API
 */
async function getItemMetadata(accountId, userId, itemId, itemType) {
    // Try library cache first
    const user = { id: userId };
    const library = getCachedLibrary(accountId, user);

    if (library && Array.isArray(library)) {
        const item = library.find((i) => (i._id || i.id) === itemId);
        if (item) {
            const { season, episode } = extractSeasonEpisode(item);
            return {
                episode,
                name: item.name || "Unknown",
                poster: item.poster || null,
                season,
                type: item.type,
            };
        }
    }

    // Fallback: fetch from external API (Cinemeta)
    // Only for IMDb IDs (tt...)
    if (itemId?.startsWith("tt")) {
        try {
            console.log(`[Migration] Fetching metadata for ${itemId}...`);
            const metadata = await fetchMetadata(itemId, itemType, null);
            console.log(
                `[Migration] Got metadata for ${itemId}:`,
                metadata ? { hasPoster: !!metadata.poster, title: metadata.title } : "NULL"
            );
            if (metadata) {
                return {
                    episode: metadata.episode ?? null,
                    name: metadata.title || itemId,
                    poster: metadata.poster || null,
                    season: metadata.season ?? null,
                    type: itemType,
                };
            }
        } catch (e) {
            console.log(`[Migration] Error fetching metadata for ${itemId}:`, e.message);
            // Ignore errors, will use fallback name
        }
    }

    // Final fallback: generate name from itemId
    return {
        episode: null,
        name: generateNameFromId(itemId),
        poster: null,
        season: null,
        type: itemType,
    };
}

/**
 * Generate a readable name from an IMDb ID
 */
function generateNameFromId(itemId) {
    if (!itemId) {
        return "Unknown";
    }

    // If it's a simple IMDb ID (tt0123456), return "Movie 123456" or "Show 123456"
    if (itemId.startsWith("tt") && /^\d+$/.test(itemId.slice(2))) {
        const num = itemId.slice(2);
        return `Movie ${num}`;
    }

    // If it has season/episode (tt0123456:1:5), extract just the ID
    if (itemId.includes(":")) {
        const baseId = itemId.split(":")[0];
        if (baseId.startsWith("tt") && /^\d+$/.test(baseId.slice(2))) {
            const num = baseId.slice(2);
            return `Movie ${num}`;
        }
    }

    // For other IDs, return as-is
    return itemId;
}

/**
 * Get series metadata - try to extract base show ID for lookup
 */
async function _getSeriesMetadata(accountId, userId, itemId) {
    // Try library cache first
    const user = { id: userId };
    const library = getCachedLibrary(accountId, user);

    if (library && Array.isArray(library)) {
        const baseItemId = itemId.split(":")[0];

        const item = library.find(
            (i) => (i._id || i.id) === baseItemId || (i._id || i.id)?.startsWith(baseItemId)
        );
        if (item) {
            const { season, episode } = extractSeasonEpisode(item);

            return {
                episode,
                poster: item.poster || null,
                season,
                showId: baseItemId,
                showName: item.name || "Unknown",
            };
        }
    }

    // Fallback: try external API
    const baseItemId = itemId.split(":")[0];
    if (baseItemId.startsWith("tt")) {
        try {
            const metadata = await fetchMetadata(baseItemId, "series", null);
            if (metadata) {
                return {
                    episode: metadata.episode ?? 1,
                    poster: metadata.poster || null,
                    season: metadata.season ?? 1,
                    showId: baseItemId,
                    showName: metadata.title || baseItemId,
                };
            }
        } catch {
            // Ignore
        }
    }

    return {
        episode: 1,
        poster: null,
        season: 1,
        showId: baseItemId,
        showName: generateNameFromId(baseItemId),
    };
}

/**
 * Run migration for a single account
 */
async function migrateAccountMetrics(prisma, accountId) {
    const accountIdValue = accountId || "default";

    console.log(`[MetricsMigration] === Checking account ${accountIdValue} ===`);

    const [sessionCount, episodeCount, activityCount] = await Promise.all([
        prisma.watchSession.count({ where: { accountId: accountIdValue } }),
        prisma.episodeWatchHistory.count({ where: { accountId: accountIdValue } }),
        prisma.watchActivity.count({ where: { accountId: accountIdValue } }),
    ]);

    console.log(
        `[MetricsMigration] ${accountIdValue} - Sessions: ${sessionCount}, Episodes: ${episodeCount}, Activities: ${activityCount}`
    );

    if (activityCount === 0) {
        console.log(`[MetricsMigration] ${accountIdValue}: No WatchActivity data to migrate`);
        return { migrated: false, reason: "no_activity_data" };
    }

    // Get all activities to determine what needs to be created
    const activities = await prisma.watchActivity.findMany({
        orderBy: { date: "asc" },
        where: { accountId: accountIdValue },
    });

    // Calculate unique items from watch_activity that should have sessions
    // One session per user + item combination (not per date - that's too granular)
    const uniqueUserItems = new Set();
    activities.forEach((a) => uniqueUserItems.add(`${a.userId}:${a.itemId}`));
    const neededSessions = uniqueUserItems.size;

    console.log(
        `[MetricsMigration] ${accountIdValue}: Have ${sessionCount} sessions, need ${neededSessions} for historical data`
    );

    // Get existing sessions to avoid duplicates
    const existingSessions = await prisma.watchSession.findMany({
        select: { itemId: true, userId: true },
        where: { accountId: accountIdValue },
    });
    const existingSessionSet = new Set(existingSessions.map((s) => `${s.userId}:${s.itemId}`));

    // Get existing episode keys to avoid duplicates
    const existingEpisodes = await prisma.episodeWatchHistory.findMany({
        select: { userId: true, videoId: true },
        where: { accountId: accountIdValue },
    });
    const existingEpisodeKeys = new Set(existingEpisodes.map((e) => `${e.userId}:${e.videoId}`));

    // If we already have enough sessions, just update episodes if needed
    const needsMigration = sessionCount < neededSessions;
    if (!needsMigration && episodeCount > 0) {
        console.log(
            `[MetricsMigration] ${accountIdValue}: Sessions and episodes already complete, skipping`
        );
        return { migrated: false, reason: "already_complete" };
    }

    console.log(
        `[MetricsMigration] ${accountIdValue}: Starting migration of ${activityCount} activities...`
    );

    const userIds = [...new Set(activities.map((a) => a.userId))];
    const users = await prisma.user.findMany({
        select: { colorIndex: true, email: true, id: true, username: true },
        where: { id: { in: userIds } },
    });
    const userMap = new Map(users.map((u) => [u.id, u]));

    // Pre-fetch metadata for all unique items (from cache or API)
    const uniqueItems = [...new Set(activities.map((a) => `${a.userId}:${a.itemId}`))];
    console.log(
        `[MetricsMigration] ${accountIdValue}: Fetching metadata for ${uniqueItems.length} unique items...`
    );

    const metadataCache = new Map();

    // First pass: get metadata for each unique user+item combination
    for (const uniqueKey of uniqueItems) {
        const [userId, itemId] = uniqueKey.split(":");
        const itemType =
            activities.find((a) => a.userId === userId && a.itemId === itemId)?.itemType || "movie";
        const metadata = await getItemMetadata(accountIdValue, userId, itemId, itemType);
        metadataCache.set(uniqueKey, metadata);
    }

    console.log(
        `[MetricsMigration] ${accountIdValue}: Metadata fetched, starting session creation...`
    );

    let sessionsCreated = 0;
    let episodesCreated = 0;

    const sessionsToCreate = [];
    const episodesToCreate = [];

    for (const activity of activities) {
        const user = userMap.get(activity.userId);
        const _userInfo = user
            ? {
                  colorIndex: user.colorIndex || 0,
                  email: user.email,
                  id: user.id,
                  username: user.username || user.email,
              }
            : {
                  colorIndex: 0,
                  email: null,
                  id: activity.userId,
                  username: activity.userId,
              };

        const metadata = metadataCache.get(`${activity.userId}:${activity.itemId}`);
        console.log(`[Migration] Using metadata for ${activity.userId}:${activity.itemId}:`, {
            hasPoster: !!metadata?.poster,
            name: metadata?.name,
        });

        const itemId = activity.itemId;
        const isSeries = activity.itemType === "series";

        // Session key includes date - one session per user+item+date
        // This properly distributes historical watch time across actual days
        const sessionKey = `${activity.userId}:${itemId}:${activity.date}`;
        if (existingSessionSet.has(sessionKey)) {
            // Already have this session, skip
        } else {
            existingSessionSet.add(sessionKey);

            // Use the actual date from the activity
            const startTime = new Date(activity.date);
            startTime.setHours(
                Math.floor(Math.random() * 12) + 8,
                Math.floor(Math.random() * 60),
                0,
                0
            );

            // Use just this day's watch time, not cumulative
            const totalWatchTime = activity.watchTimeSeconds || 0;

            const endTime = new Date(startTime.getTime() + totalWatchTime * 1000);

            // Try to get better name from itemId (extract title from common ID patterns)
            let itemName = metadata?.name || activity.itemId;
            if (itemName === activity.itemId && activity.itemId.startsWith("tt")) {
                // Extract numeric part as fallback
                const numPart = activity.itemId.match(/tt(\d+)/)?.[1];
                if (numPart) {
                    itemName = `Movie ${numPart}`;
                }
            }

            sessionsToCreate.push({
                accountId: accountIdValue,
                durationSeconds: totalWatchTime,
                endTime,
                episode: metadata?.episode || null,
                isActive: false,
                itemId,
                itemName,
                itemType: activity.itemType,
                poster: metadata?.poster,
                season: metadata?.season || null,
                startTime,
                userId: activity.userId,
                videoId: isSeries ? `${itemId}:1:1` : null,
            });
            // DEBUG: Show what was just pushed
            const justPushed = sessionsToCreate.at(-1);
            console.log(
                `[Migration] PUSHED session: itemName="${justPushed.itemName}" poster=${justPushed.poster ? "HAS_VALUE" : "NULL"}`
            );
            sessionsCreated++;
        }

        // Create episodes for series - one per unique item (not per date)
        if (isSeries) {
            // Use metadata from cache (already fetched)
            const seriesMeta = metadata;

            // Episode key without date - one episode entry per item
            const episodeKey = `${activity.userId}:${itemId}`;
            if (!existingEpisodeKeys.has(episodeKey)) {
                // Get earliest and latest dates for this item
                const itemActivities = activities.filter(
                    (a) => a.userId === activity.userId && a.itemId === itemId
                );
                const _earliestDate = itemActivities.reduce(
                    (min, a) => (a.date < min ? a.date : min),
                    itemActivities[0].date
                );
                const latestDate = itemActivities.reduce(
                    (max, a) => (a.date > max ? a.date : max),
                    itemActivities[0].date
                );

                const videoId = `${itemId}:${seriesMeta?.season || 1}:${seriesMeta?.episode || 1}`;

                episodesToCreate.push({
                    accountId: accountIdValue,
                    episode: seriesMeta?.episode || 1,
                    poster: seriesMeta?.poster,
                    season: seriesMeta?.season || 1,
                    showId: seriesMeta?.showId || itemId.split(":")[0],
                    showName: seriesMeta?.showName || activity.itemId,
                    userId: activity.userId,
                    videoId,
                    watchedAt: latestDate, // Use latest date as the watchedAt
                });
                existingEpisodeKeys.add(episodeKey);
                episodesCreated++;
            }
        }
    }

    if (sessionsToCreate.length > 0) {
        console.log(
            `[MetricsMigration] ${accountIdValue}: Creating ${sessionsToCreate.length} sessions...`
        );

        for (const session of sessionsToCreate) {
            try {
                console.log("[Migration] Upserting session:", {
                    itemId: session.itemId,
                    name: session.itemName,
                    poster: session.poster ? "YES" : "no",
                });
                await prisma.watchSession.upsert({
                    create: session,
                    update: {
                        durationSeconds: session.durationSeconds,
                        endTime: session.endTime,
                        episode: session.episode,
                        isActive: false,
                        itemName: session.itemName,
                        itemType: session.itemType,
                        poster: session.poster,
                        season: session.season,
                        startTime: session.startTime,
                        videoId: session.videoId,
                    },
                    where: {
                        accountId_userId_itemId: {
                            accountId: session.accountId,
                            itemId: session.itemId,
                            userId: session.userId,
                        },
                    },
                });
            } catch {
                // Ignore errors - session might already exist
            }
        }
    }

    if (episodesToCreate.length > 0) {
        console.log(
            `[MetricsMigration] ${accountIdValue}: Creating ${episodesToCreate.length} episodes...`
        );

        for (const episode of episodesToCreate) {
            try {
                await prisma.episodeWatchHistory.upsert({
                    create: episode,
                    update: {
                        poster: episode.poster,
                        showName: episode.showName,
                        watchedAt: episode.watchedAt,
                    },
                    where: {
                        accountId_userId_videoId: {
                            accountId: episode.accountId,
                            userId: episode.userId,
                            videoId: episode.videoId,
                        },
                    },
                });
            } catch (error) {
                if (!error.message.includes("Unique constraint")) {
                    console.warn("[MetricsMigration] Error creating episode:", error.message);
                }
            }
        }
    }

    console.log(
        `[MetricsMigration] ${accountIdValue}: Migration complete - ${sessionsCreated} sessions, ${episodesCreated} episodes`
    );

    return {
        episodesCreated,
        migrated: true,
        sessionsCreated,
    };
}

/**
 * Main migration function - runs at startup
 */
async function runMetricsMigration(prisma, _decrypt, _getAccountId, INSTANCE_TYPE) {
    console.log("[MetricsMigration] Starting metrics migration...");

    try {
        // Get account ID - handle both public and private modes
        let accountId;
        if (INSTANCE_TYPE === "public") {
            const accounts = await prisma.appAccount.findMany({
                select: { id: true },
            });
            console.log(`[MetricsMigration] Found ${accounts.length} accounts to check`);

            let totalMigrated = 0;
            for (const account of accounts) {
                console.log(`[MetricsMigration] Checking account: ${account.id}`);
                const result = await migrateAccountMetrics(prisma, account.id);
                if (result.migrated) {
                    totalMigrated++;
                }
            }
            console.log(`[MetricsMigration] Completed - migrated ${totalMigrated} accounts`);
        } else {
            accountId = process.env.DEFAULT_ACCOUNT_ID || "default";
            console.log(`[MetricsMigration] Private mode - using account: ${accountId}`);
            await migrateAccountMetrics(prisma, accountId);
            console.log("[MetricsMigration] Completed for private instance");
        }
    } catch (error) {
        console.error("[MetricsMigration] Migration failed:", error.message);
        console.error("[MetricsMigration] Stack:", error.stack);
    }
}

module.exports = {
    migrateAccountMetrics,
    runMetricsMigration,
};
