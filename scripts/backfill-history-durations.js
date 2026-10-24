// One-time backfill: fills in durationSeconds on already-written
// MovieWatchHistory/EpisodeWatchHistory rows that have it as null.
//
// durationSeconds was never actually written by recordEpisodeWatch/
// recordMovieWatch (metricsProcessor.js) - it only ever got "backfilled"
// in-memory for the Activity feed's API response (mergeCrossPipelineDuplicates
// in metricsBuilder.js), never persisted to the row itself. That's now fixed
// going forward; this repairs rows that were already written before the fix.
//
// For movies: matches WatchSession by (accountId, userId, itemId) directly.
// For episodes: WatchSession tracks one row per (user, show) - itemId is the
// show's own base ID, not per-episode - so a match is only trusted when the
// session's own videoId still equals the history row's videoId (otherwise
// the session has since moved on to a different episode of the same show,
// and its duration belongs to that episode, not this one).
//
// Only ever raises durationSeconds (max against whatever's already there),
// and only touches rows where a real match with a positive duration exists.
// Safe to run more than once. Dry-run by default; pass --apply to write.
//
// Usage:
//   docker exec -it -e DATABASE_URL="file:///app/data/sqlite.db" slicksync node scripts/backfill-history-durations.js
//   docker exec -it -e DATABASE_URL="file:///app/data/sqlite.db" slicksync node scripts/backfill-history-durations.js --apply

const { PrismaClient } = require("@prisma/client");

async function main() {
    const apply = process.argv.includes("--apply");
    const prisma = new PrismaClient();
    try {
        let totalFixed = 0;

        const movies = await prisma.movieWatchHistory.findMany({
            select: {
                accountId: true,
                id: true,
                itemId: true,
                itemName: true,
                userId: true,
                watchedAt: true,
            },
            where: { durationSeconds: null },
        });
        console.log(`MovieWatchHistory rows with durationSeconds=null: ${movies.length}`);
        for (const row of movies) {
            const session = await prisma.watchSession.findUnique({
                select: { durationSeconds: true },
                where: {
                    accountId_userId_itemId: {
                        accountId: row.accountId,
                        itemId: row.itemId,
                        userId: row.userId,
                    },
                },
            });
            const seconds = session?.durationSeconds || 0;
            if (seconds <= 0) {
                continue;
            }

            console.log(`  "${row.itemName}"  ${row.watchedAt.toISOString()}  null -> ${seconds}s`);
            totalFixed++;
            if (apply) {
                await prisma.movieWatchHistory.update({
                    data: { durationSeconds: seconds },
                    where: { id: row.id },
                });
            }
        }

        const episodes = await prisma.episodeWatchHistory.findMany({
            select: {
                accountId: true,
                episode: true,
                id: true,
                season: true,
                showId: true,
                showName: true,
                userId: true,
                videoId: true,
                watchedAt: true,
            },
            where: { durationSeconds: null },
        });
        console.log(`\nEpisodeWatchHistory rows with durationSeconds=null: ${episodes.length}`);
        for (const row of episodes) {
            const session = await prisma.watchSession.findUnique({
                select: { durationSeconds: true, videoId: true },
                where: {
                    accountId_userId_itemId: {
                        accountId: row.accountId,
                        itemId: row.showId,
                        userId: row.userId,
                    },
                },
            });
            if (session?.videoId !== row.videoId) {
                continue;
            }
            const seconds = session.durationSeconds || 0;
            if (seconds <= 0) {
                continue;
            }

            console.log(
                `  "${row.showName}" S${row.season}E${row.episode}  ${row.watchedAt.toISOString()}  null -> ${seconds}s`
            );
            totalFixed++;
            if (apply) {
                await prisma.episodeWatchHistory.update({
                    data: { durationSeconds: seconds },
                    where: { id: row.id },
                });
            }
        }

        if (totalFixed === 0) {
            console.log("\nNothing to do.");
        } else if (apply) {
            console.log(`\nUpdated ${totalFixed} row(s).`);
        } else {
            console.log(
                `\nDry run only - re-run with --apply to write these ${totalFixed} update(s).`
            );
        }
    } finally {
        await prisma.$disconnect();
    }
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
