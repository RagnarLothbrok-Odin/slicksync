/**
 * New-episode alerts: for every show someone on this instance is actively
 * watching (has an EpisodeWatchHistory row in the recent window), watch
 * Cinemeta's episode list for newly-RELEASED episodes and alert when one
 * appears - Discord (via the account's existing webhook) plus an
 * EpisodeAlert row the notification bell reads.
 *
 * "New" is defined against a stored per-show baseline (ShowEpisodeAlertState),
 * not against what the user has watched - a person 3 episodes behind
 * shouldn't get re-alerted about episodes that were already out when this
 * feature first saw the show. The first poll for a show only records the
 * baseline; alerts start from the second poll onward.
 *
 * Cinemeta's episode lists include FUTURE episodes with future `released`
 * dates (that's how it renders upcoming-episode placeholders), so the
 * baseline/comparison only ever considers episodes whose released date is in
 * the past - otherwise a whole announced-but-unaired season would "alert"
 * the moment Cinemeta lists it.
 */

const { fetchMetadata, postDiscord } = require("./notify");
const { getAccountDayNumber, resolveAccountTimezone } = require("./dateUtils");

const POLL_INTERVAL_MS = 6 * 60 * 60 * 1000; // 6h - episode drops are a daily-scale event
const FIRST_RUN_DELAY_MS = 3 * 60 * 1000; // let boot-time work settle first
const RECENT_WATCH_WINDOW_DAYS = 120; // same "actively watching" window Continue Watching uses

function episodeOrder(season, episode) {
    return season * 10_000 + episode;
}

/**
 * A metadata provider's `released` field is a plain calendar day (typically
 * serialized as literal T00:00:00.000Z, not a real airtime), so its OWN
 * calendar-day components are read as encoded (timeZone: 'UTC'), not
 * converted through the account's timezone - that would shift a July 30
 * release date to July 29 for a UTC-7 account, moving the bug in the wrong
 * direction. It's `todayDayNumber` (see resolveTodayDayNumber below) that
 * needs to be account-timezone-aware, not this.
 */
function releasedDayNumber(ep) {
    const d = new Date(ep.released);
    if (Number.isNaN(d.getTime())) {
        return null;
    }
    return getAccountDayNumber(d, "UTC");
}

/** Latest episode in the list whose released day is on or before today (in the account's own timezone - see module comment / getAccountDayNumber). */
function latestReleasedEpisode(allEpisodes, todayDayNumber) {
    let latest = null;
    for (const ep of allEpisodes) {
        if (!ep.released) {
            continue;
        }
        const day = releasedDayNumber(ep);
        if (day === null || day > todayDayNumber) {
            continue;
        }
        if (
            !latest ||
            episodeOrder(ep.season, ep.episode) > episodeOrder(latest.season, latest.episode)
        ) {
            latest = ep;
        }
    }
    return latest;
}

/** Soonest episode whose released day is still after today (by air date, account-timezone-aware). */
function nextUpcomingEpisode(allEpisodes, todayDayNumber) {
    let next = null;
    let nextDay = Number.POSITIVE_INFINITY;
    for (const ep of allEpisodes) {
        if (!ep.released) {
            continue;
        }
        const day = releasedDayNumber(ep);
        if (day === null || day <= todayDayNumber) {
            continue;
        }
        if (day < nextDay) {
            next = ep;
            nextDay = day;
        }
    }
    return next;
}

/**
 * The Dashboard "Coming up" calendar: the next upcoming episode for every show
 * someone here is mid-season on. Reads the fields the poller stores on
 * ShowEpisodeAlertState — no Cinemeta call on page load. Keeps rows whose air
 * date is today or later (a small back-buffer so "airs today" stays visible
 * between the 6h polls that would otherwise roll it forward).
 */
async function getUpcomingEpisodes(prisma, accountId, limit = 24, userId = null) {
    // Filter to this profile's watched shows before applying the calendar limit.
    const history = userId
        ? await prisma.episodeWatchHistory.findMany({
              distinct: ["showId"],
              select: { showId: true },
              where: { accountId, userId },
          })
        : null;
    const cutoff = new Date(Date.now() - 12 * 60 * 60 * 1000);
    const rows = await prisma.showEpisodeAlertState.findMany({
        orderBy: { nextAirDate: "asc" },
        take: limit,
        where: {
            accountId,
            ...(history ? { showId: { in: history.map((row) => row.showId) } } : {}),
            nextAirDate: { gte: cutoff },
        },
    });
    let candidates = rows.filter(
        (r) => r.nextSeason != null && r.nextEpisode != null && r.nextAirDate
    );

    try {
        const muted = await prisma.mutedShow.findMany({
            select: { showId: true },
            where: { accountId, showId: { in: candidates.map((r) => r.showId) } },
        });
        const mutedIds = new Set(muted.map((m) => m.showId));
        candidates = candidates.filter((r) => !mutedIds.has(r.showId));
    } catch {
        // Unavailable optional records leave the current result in place.
    } // Table may not exist yet on a very-first boot before db push runs.

    // Filter out dismissed episodes — the (season, episode) tuple is intentional,
    // so once the poller advances the show to a NEW next episode, that new one
    // isn't in the dismiss list and re-appears without any manual reset.
    let dismissed = new Set();
    try {
        const rowsD = await prisma.dismissedUpcomingEpisode.findMany({
            select: { episode: true, season: true, showId: true },
            where: { accountId, showId: { in: candidates.map((r) => r.showId) } },
        });
        dismissed = new Set(rowsD.map((r) => `${r.showId}::${r.season}::${r.episode}`));
    } catch {
        // Unavailable optional records leave the current result in place.
    } // Table may not exist yet on a very-first boot before db push runs.

    return candidates
        .filter((r) => !dismissed.has(`${r.showId}::${r.nextSeason}::${r.nextEpisode}`))
        .map((r) => ({
            airDate: r.nextAirDate,
            episode: r.nextEpisode,
            poster: r.poster || null,
            season: r.nextSeason,
            showId: r.showId,
            showName: r.showName || null,
            title: r.nextTitle || null,
        }));
}

/**
 * Hide an upcoming episode from the "Coming up" panel. Persisted server-side
 * so a dismissal from one browser/device carries across the account.
 */
async function dismissUpcomingEpisode(prisma, accountId, showId, season, episode) {
    const accountIdValue = accountId || "default";
    await prisma.dismissedUpcomingEpisode.upsert({
        create: { accountId: accountIdValue, episode, season, showId },
        update: {},
        where: {
            accountId_showId_season_episode: { accountId: accountIdValue, episode, season, showId },
        },
    });
}

/**
 * Whole-show opt-out: stops the show appearing in "Coming up" AND stops
 * new-episode alerts (push/Discord) for it, until unmuted. Unlike dismissing
 * one episode, this doesn't wear off when the show advances.
 */
async function muteShow(prisma, accountId, showId, showName, poster) {
    const accountIdValue = accountId || "default";
    await prisma.mutedShow.upsert({
        create: {
            accountId: accountIdValue,
            poster: poster || null,
            showId,
            showName: showName || null,
        },
        update: {},
        where: { accountId_showId: { accountId: accountIdValue, showId } },
    });
}

async function unmuteShow(prisma, accountId, showId) {
    const accountIdValue = accountId || "default";
    await prisma.mutedShow.deleteMany({ where: { accountId: accountIdValue, showId } });
}

async function getMutedShows(prisma, accountId) {
    return prisma.mutedShow.findMany({
        orderBy: { createdAt: "desc" },
        where: { accountId },
    });
}

async function getNotifyTarget(prisma, accountId) {
    try {
        const account = await prisma.appAccount.findUnique({
            select: { sync: true },
            where: { id: accountId },
        });
        let cfg = account?.sync;
        if (typeof cfg === "string") {
            try {
                cfg = JSON.parse(cfg);
            } catch {
                cfg = {};
            }
        }
        // Rides the existing activity toggle rather than adding a new settings
        // field - "a new episode of something you watch is out" is activity-
        // adjacent, and the Settings UI stays untouched.
        return {
            enabled: cfg?.notifyOnActivity === true,
            webhookUrl: cfg?.webhookUrl || null,
        };
    } catch {
        return { enabled: false, webhookUrl: null };
    }
}

async function checkForNewEpisodes(prisma) {
    const since = new Date(Date.now() - RECENT_WATCH_WINDOW_DAYS * 24 * 60 * 60 * 1000);

    // Every show with recent watch history, across all accounts (private mode
    // has exactly one). Track each show's watchers so the alert can say who's
    // behind.
    const rows = await prisma.episodeWatchHistory.findMany({
        orderBy: { watchedAt: "desc" },
        select: {
            accountId: true,
            episode: true,
            poster: true,
            season: true,
            showId: true,
            showName: true,
            userId: true,
            videoId: true,
            watchedAt: true,
        },
        where: { watchedAt: { gte: since } },
    });

    // (accountId, showId) -> { showName, poster, videoId, watchers: Map<userId, latest {season, episode}> }
    const shows = new Map();
    for (const row of rows) {
        const key = `${row.accountId}::${row.showId}`;
        if (!shows.has(key)) {
            shows.set(key, {
                accountId: row.accountId,
                poster: row.poster,
                showId: row.showId,
                showName: row.showName,
                videoId: row.videoId,
                watchers: new Map(),
            });
        }
        const show = shows.get(key);
        // rows are newest-first, so first sighting per user IS their latest episode
        if (!show.watchers.has(row.userId) && row.season != null && row.episode != null) {
            show.watchers.set(row.userId, { episode: row.episode, season: row.season });
        }
    }

    // Muted shows are skipped entirely below - no baseline/nextFields refresh,
    // no alert, no push, no Discord - until unmuted.
    const mutedRows = await prisma.mutedShow
        .findMany({ select: { accountId: true, showId: true } })
        .catch(() => []);
    const mutedKeys = new Set(mutedRows.map((m) => `${m.accountId}::${m.showId}`));

    // Resolved once per account (not per show) and cached for this run - shows
    // can span multiple accounts, and each account may have its own configured
    // timezone (AppAccount.sync.accountTimezone).
    const todayDayNumberByAccount = new Map();
    async function todayDayNumberFor(accountId) {
        if (todayDayNumberByAccount.has(accountId)) {
            return todayDayNumberByAccount.get(accountId);
        }
        const tz = await resolveAccountTimezone(prisma, accountId);
        const value = getAccountDayNumber(new Date(), tz);
        todayDayNumberByAccount.set(accountId, value);
        return value;
    }

    const omdbKeyByAccount = new Map();
    async function omdbKeyFor(accountId) {
        if (omdbKeyByAccount.has(accountId)) {
            return omdbKeyByAccount.get(accountId);
        }
        const { resolveOmdbKeyForAccount } = require("./listImport");
        const value = await resolveOmdbKeyForAccount(prisma, accountId);
        omdbKeyByAccount.set(accountId, value);
        return value;
    }

    let alertsFired = 0;
    for (const show of shows.values()) {
        if (mutedKeys.has(`${show.accountId}::${show.showId}`)) {
            continue;
        }
        try {
            const metadata = await fetchMetadata(
                show.showId,
                "series",
                show.videoId,
                await omdbKeyFor(show.accountId)
            );
            if (!metadata?.allEpisodes?.length) {
                continue;
            }

            const todayDayNumber = await todayDayNumberFor(show.accountId);
            const latest = latestReleasedEpisode(metadata.allEpisodes, todayDayNumber);
            if (!latest) {
                continue;
            }

            // Upcoming-episode + display fields for the "Coming up" calendar, kept
            // fresh on every poll independently of the alert baseline below.
            const next = nextUpcomingEpisode(metadata.allEpisodes, todayDayNumber);
            const nextFields = {
                nextAirDate: next ? new Date(next.released) : null,
                nextEpisode: next ? next.episode : null,
                nextSeason: next ? next.season : null,
                nextTitle: next ? next.title || null : null,
                poster: metadata.poster || show.poster || null,
                showName: metadata.title || show.showName || null,
            };

            const state = await prisma.showEpisodeAlertState.findUnique({
                where: { accountId_showId: { accountId: show.accountId, showId: show.showId } },
            });

            if (!state) {
                // First sighting: record the baseline, never alert - see module comment.
                await prisma.showEpisodeAlertState.create({
                    data: {
                        accountId: show.accountId,
                        lastEpisode: latest.episode,
                        lastSeason: latest.season,
                        showId: show.showId,
                        ...nextFields,
                    },
                });
                continue;
            }

            // Refresh the upcoming/display fields every poll (air dates approach; a
            // show can gain or lose an announced next episode). Baseline untouched.
            await prisma.showEpisodeAlertState
                .update({
                    data: nextFields,
                    where: { accountId_showId: { accountId: show.accountId, showId: show.showId } },
                })
                .catch(() => undefined);

            if (
                episodeOrder(latest.season, latest.episode) <=
                episodeOrder(state.lastSeason, state.lastEpisode)
            ) {
                continue; // nothing new
            }

            // Advance the baseline FIRST - if the notification below throws, the
            // next poll must not re-alert the same episode (create() below would
            // also catch that via its unique constraint, but belt and suspenders).
            await prisma.showEpisodeAlertState.update({
                data: { lastEpisode: latest.episode, lastSeason: latest.season },
                where: { accountId_showId: { accountId: show.accountId, showId: show.showId } },
            });

            // Only the LATEST new episode alerts, even if several dropped between
            // polls (e.g. a full-season drop) - one "S05E09 is out" beats ten
            // rapid-fire pings, and the show page has the rest anyway.
            try {
                await prisma.episodeAlert.create({
                    data: {
                        accountId: show.accountId,
                        episode: latest.episode,
                        poster: metadata.poster || show.poster || null,
                        season: latest.season,
                        showId: show.showId,
                        showName: metadata.title || show.showName,
                        title: latest.title || null,
                    },
                });
            } catch {
                // Unique-constraint hit = already alerted (shouldn't happen given the
                // baseline check, but restarts/races are cheap to be safe against).
                continue;
            }
            alertsFired++;

            const epLabel = `S${String(latest.season).padStart(2, "0")}E${String(latest.episode).padStart(2, "0")}`;

            const { isDigestEnabled, queueDigestEntry } = require("./notificationDigest");
            const digestOn = await isDigestEnabled(prisma, show.accountId);

            // Native web-push to any PWA-installed device that opted in - fires even
            // when SlickSync isn't open. Best-effort; failures never block the rest.
            // Skipped when digest mode is on - the digest poller sends one push at
            // send time instead (push + bell are primary; Discord is secondary and
            // was the only channel this feature originally had).
            if (!digestOn) {
                try {
                    const { sendPushToAccount } = require("./pushNotifications");
                    await sendPushToAccount(prisma, show.accountId, {
                        body: `${epLabel}${latest.title ? ` · ${latest.title}` : ""} is out`,
                        icon: metadata.poster || show.poster || "/android-chrome-192x192.png",
                        title: `New episode: ${metadata.title || show.showName}`,
                        url: "/activity",
                    });
                } catch {
                    // Unavailable optional records leave the current result in place.
                }
            }

            if (digestOn) {
                // Queued regardless of whether Discord is even configured - the
                // digest poller decides which channels (push, Discord, or both) to
                // actually deliver it through.
                await queueDigestEntry(
                    prisma,
                    show.accountId,
                    "episode",
                    `${metadata.title || show.showName} ${epLabel}${latest.title ? ` · ${latest.title}` : ""}`
                );
            } else {
                const target = await getNotifyTarget(prisma, show.accountId);
                if (target.enabled && target.webhookUrl) {
                    // "Who's behind" flavor - a watcher already past the new episode
                    // (rewatch scenarios) is skipped.
                    const behind = [...show.watchers.entries()].filter(
                        ([, w]) =>
                            episodeOrder(w.season, w.episode) <
                            episodeOrder(latest.season, latest.episode)
                    );
                    let behindLine = "";
                    if (behind.length > 0) {
                        const userRows = await prisma.user.findMany({
                            select: { email: true, id: true, username: true },
                            where: { id: { in: behind.map(([userId]) => userId) } },
                        });
                        const nameById = new Map(
                            userRows.map((u) => [u.id, u.username || u.email || "someone"])
                        );
                        behindLine =
                            "\n" +
                            behind
                                .map(
                                    ([userId, w]) =>
                                        `${nameById.get(userId) || "someone"} is on S${String(w.season).padStart(2, "0")}E${String(w.episode).padStart(2, "0")}`
                                )
                                .join(" · ");
                    }
                    await postDiscord(
                        target.webhookUrl,
                        `**New episode: ${metadata.title || show.showName} ${epLabel}${latest.title ? ` · ${latest.title}` : ""}**${behindLine}`
                    ).catch(() => undefined);
                }
            }
        } catch (e) {
            console.warn(`[EpisodeAlerts] Failed to check ${show.showId}:`, e?.message);
        }
    }

    if (alertsFired > 0) {
        console.log(
            `[EpisodeAlerts] Fired ${alertsFired} new-episode alert${alertsFired === 1 ? "" : "s"}`
        );
    }
    return alertsFired;
}

function scheduleEpisodeAlerts(prisma) {
    const run = () =>
        checkForNewEpisodes(prisma).catch((e) =>
            console.warn("[EpisodeAlerts] Poll failed:", e?.message)
        );
    setTimeout(run, FIRST_RUN_DELAY_MS);
    setInterval(run, POLL_INTERVAL_MS);
}

module.exports = {
    checkForNewEpisodes,
    dismissUpcomingEpisode,
    getMutedShows,
    getUpcomingEpisodes,
    muteShow,
    scheduleEpisodeAlerts,
    unmuteShow,
};
