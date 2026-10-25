const express = require("express");
const { publicMessage } = require("../utils/publicError");
const { previewHistory } = require("../utils/portalHistory");
const PREFERENCES = {
    autoplayTrailer: false,
    beginnerMode: false,
    hideSensitive: false,
    posterRatings: false,
    trailerSound: false,
};

module.exports = ({ prisma, personAsking, decrypt, createProvider, JWT_SECRET }) => {
    const router = express.Router();
    // Resolve the credential before every operation, including uploaded files.
    router.use(async (req, res, next) => {
        try {
            const person = await personAsking(req, req.query.userId || req.body?.userId);
            Object.assign(req, { person });
            next();
        } catch (error) {
            res.status(error.status || 401).json({
                error: "Please sign in to your own account again.",
            });
        }
    });
    const handle = (fn) => async (req, res) => {
        try {
            await fn(req, res);
        } catch (error) {
            console.error("[personal-panel]", error?.message);
            res.status(error.status || 500).json({
                error: publicMessage(error, "Could not complete that request"),
            });
        }
    };
    const scope = (req) => ({ accountId: req.person.accountId, userId: req.person.id });
    router.get(
        "/about",
        handle(async (_req, res) => {
            res.json({ version: require("../../package.json").version });
        })
    );
    router.get(
        "/preferences",
        handle(async (req, res) => {
            const user = await prisma.user.findUnique({
                select: { portalPreferences: true },
                where: { id: req.person.id },
            });
            let stored = {};
            try {
                stored = JSON.parse(user.portalPreferences || "{}");
            } catch {
                /* Older preferences are replaced on the next save. */
            }
            const account = await prisma.appAccount.findUnique({
                select: { sync: true },
                where: { id: req.person.accountId },
            });
            let settings = account?.sync || {};
            if (typeof settings === "string") {
                try {
                    settings = JSON.parse(settings);
                } catch {
                    settings = {};
                }
            }
            res.json({
                ...PREFERENCES,
                posterRatings: settings.enablePosterRatings === true,
                ...stored,
            });
        })
    );
    router.patch(
        "/preferences",
        handle(async (req, res) => {
            const patch = req.body.preferences;
            if (
                !patch ||
                Object.keys(patch).some(
                    (key) => !Object.hasOwn(PREFERENCES, key) || typeof patch[key] !== "boolean"
                )
            ) {
                return res.status(400).json({ error: "Invalid display preferences" });
            }
            // Require a complete, typed snapshot; household configuration is never
            // writable through the personal preference endpoint.
            if (Object.keys(patch).length !== Object.keys(PREFERENCES).length) {
                return res.status(400).json({ error: "Send all display preferences" });
            }
            await prisma.user.update({
                data: { portalPreferences: JSON.stringify(patch) },
                where: { id: req.person.id },
            });
            res.json(patch);
        })
    );
    router.get(
        "/devices",
        handle(async (req, res) => {
            const devices = await prisma.personPushSubscription.findMany({
                orderBy: { createdAt: "desc" },
                select: {
                    createdAt: true,
                    id: true,
                    label: true,
                    lastSeenAt: true,
                    userAgent: true,
                },
                where: scope(req),
            });
            res.json({ devices });
        })
    );
    router.patch(
        "/devices/:id",
        handle(async (req, res) => {
            if (typeof req.body.label !== "string" || req.body.label.trim().length > 60) {
                return res.status(400).json({ error: "Use a name of 60 characters or fewer" });
            }
            const result = await prisma.personPushSubscription.updateMany({
                data: { label: req.body.label.trim() || null },
                where: { ...scope(req), id: req.params.id },
            });
            if (!result.count) {
                return res.status(404).json({ error: "Device not found" });
            }
            res.json({ success: true });
        })
    );
    router.delete(
        "/devices/:id",
        handle(async (req, res) => {
            const result = await prisma.personPushSubscription.deleteMany({
                where: { ...scope(req), id: req.params.id },
            });
            if (!result.count) {
                return res.status(404).json({ error: "Device not found" });
            }
            res.json({ success: true });
        })
    );
    router.get(
        "/upcoming-episodes",
        handle(async (req, res) => {
            res.json(
                await require("../utils/episodeAlerts").getUpcomingEpisodes(
                    prisma,
                    req.person.accountId,
                    24,
                    req.person.id
                )
            );
        })
    );
    router.get(
        "/now-playing",
        handle(async (req, res) => {
            // Attribute streams against the whole household first, then return
            // only this authenticated profile and no household identity fields.
            const rows = await require("../utils/metricsBuilder").liveNowPlaying(
                prisma,
                req.person.accountId
            );
            res.set("Cache-Control", "no-store");
            res.json({
                items: rows
                    .filter((row) => row.user?.id === req.person.id)
                    .map((row) => ({
                        elapsedFrozen: row.elapsedFrozen === true,
                        elapsedSeconds: row.elapsedSeconds ?? null,
                        item: {
                            episode: row.item.episode,
                            id: row.item.id,
                            name: row.item.name,
                            poster: row.item.poster || null,
                            season: row.item.season,
                            type: row.item.type,
                        },
                        lastPosition: row.lastPosition ?? null,
                        playback: row.playback
                            ? {
                                  evidence: row.playback.evidence,
                                  observedAt: row.playback.observedAt,
                                  position: row.playback.position,
                                  state: row.playback.state,
                              }
                            : null,
                        startTime: row.watchedAt,
                        totalDuration: row.totalDuration ?? null,
                        videoId: row.videoId,
                    })),
            });
        })
    );
    router.get(
        "/continue-watching",
        handle(async (req, res) => {
            const items = await require("../utils/continueWatching").getContinueWatching(
                prisma,
                req.person.accountId,
                12,
                req.person.id
            );
            res.json({ items });
        })
    );
    router.post(
        "/continue-watching/dismiss",
        handle(async (req, res) => {
            const { showId } = req.body || {};
            if (typeof showId !== "string" || !/^[A-Za-z0-9:._-]{1,160}$/.test(showId)) {
                return res.status(400).json({ error: "Invalid title" });
            }
            await require("../utils/continueWatching").dismissContinueWatching(
                prisma,
                req.person.accountId,
                req.person.id,
                showId
            );
            res.json({ success: true });
        })
    );
    router.get(
        "/sync-status",
        handle(async (req, res) => {
            const user = await prisma.user.findUnique({
                select: {
                    lastSyncedAt: true,
                    providerConnectionErrorAt: true,
                    providerType: true,
                    syncErrorMessage: true,
                    syncStatus: true,
                },
                where: { id: req.person.id },
            });
            // Provider errors can contain credential-bearing URLs. Expose a helpful
            // state, while the existing operational logs retain the actual details.
            res.json({
                connectionProblem: !!user.providerConnectionErrorAt,
                error: user.syncErrorMessage
                    ? "The last sync failed. Try again or ask your household administrator."
                    : null,
                lastSyncedAt: user.lastSyncedAt,
                status: user.syncStatus || "idle",
                supported: user.providerType !== "jellyfin",
            });
        })
    );
    router.get(
        "/sync-plan",
        handle(async (req, res) => {
            const user = await prisma.user.findUnique({ where: { id: req.person.id } });
            const account = await prisma.appAccount.findUnique({
                select: { sync: true },
                where: { id: user.accountId },
            });
            let settings = account?.sync || {};
            if (typeof settings === "string") {
                settings = JSON.parse(settings);
            }
            const { computeUserSyncPlan, createManifestFingerprint } = require("../utils/sync");
            const {
                parseAddonIds,
                parseProtectedAddons,
                canonicalizeManifestUrl,
            } = require("../utils/validation");
            const getAccountId = () => user.accountId;
            const scopedReq = Object.assign(Object.create(req), {
                accountId: user.accountId,
                appAccountId: user.accountId,
            });
            const plan = await computeUserSyncPlan(user, scopedReq, {
                canonicalizeManifestUrl,
                createProvider,
                decrypt,
                getAccountId,
                parseAddonIds,
                parseProtectedAddons,
                prisma,
                StremioAPIClient: require("stremio-api-client").StremioAPIClient,
                unsafeMode: settings.safe === false,
                useCustomFields: settings.useCustomFields !== false,
            });
            if (!plan.success) {
                return res.status(502).json({
                    error: "Could not read your provider addon list. Reconnect your account or try again.",
                });
            }
            const fingerprint = createManifestFingerprint(canonicalizeManifestUrl, {
                urlOnly: user.providerType !== "stremio",
            });
            const names = (items) =>
                items.map((item) => item?.manifest?.name || item?.transportName || "Addon");
            const currentKeys = new Set(plan.current.map(fingerprint)),
                desiredKeys = new Set(plan.desired.map(fingerprint));
            res.json({
                additions: names(
                    plan.desired.filter((item) => !currentKeys.has(fingerprint(item)))
                ),
                alreadySynced: plan.alreadySynced,
                current: names(plan.current),
                desired: names(plan.desired),
                noGroup: !!plan.noGroup,
                removals: names(plan.current.filter((item) => !desiredKeys.has(fingerprint(item)))),
                supported: !plan.unsupported,
                updates: plan.staleManifests?.length || 0,
            });
        })
    );
    router.post(
        "/history/preview",
        handle(async (req, res) => {
            if (
                typeof req.body.text !== "string" ||
                Buffer.byteLength(req.body.text) > 1024 * 1024
            ) {
                return res
                    .status(400)
                    .json({ error: "Choose a CSV or JSON file smaller than 1 MB" });
            }
            const existing = await prisma.movieWatchHistory.findMany({
                select: { itemId: true },
                where: scope(req),
            });
            let preview;
            try {
                preview = previewHistory(
                    req.body.text,
                    existing.map((row) => row.itemId)
                );
            } catch (error) {
                return res.status(400).json({ error: error.message });
            }
            // The signed preview pins the exact rows and owner that were reviewed.
            const token = require("jsonwebtoken").sign(
                { accountId: req.person.accountId, rows: preview.rows, userId: req.person.id },
                JWT_SECRET,
                { audience: "personal-history-import", expiresIn: "15m" }
            );
            res.json({ ...preview, token });
        })
    );
    router.post(
        "/history/import",
        handle(async (req, res) => {
            let preview;
            try {
                preview = require("jsonwebtoken").verify(req.body.token, JWT_SECRET, {
                    audience: "personal-history-import",
                });
            } catch {
                return res.status(400).json({ error: "Preview expired. Choose your file again." });
            }
            if (preview.userId !== req.person.id || preview.accountId !== req.person.accountId) {
                return res.status(403).json({ error: "This preview belongs to another account" });
            }
            const imported = await prisma.$transaction(
                async (tx) => {
                    let added = 0;
                    for (const row of preview.rows) {
                        const where = { ...scope(req), itemId: row.itemId };
                        const existing = await tx.movieWatchHistory.findUnique({
                            where: { accountId_userId_itemId: where },
                        });
                        if (existing) {
                            continue;
                        }
                        await tx.movieWatchHistory.upsert({
                            create: {
                                ...where,
                                completed: true,
                                itemName: row.itemName,
                                profileLabel: "Imported",
                                watchedAt: new Date(row.watchedAt),
                            },
                            update: {},
                            where: { accountId_userId_itemId: where },
                        });
                        added++;
                    }
                    return added;
                },
                { timeout: 30_000 }
            );
            res.json({ imported, skipped: preview.rows.length - imported });
        })
    );
    router.post(
        "/discover/ratings",
        handle(async (req, res) => {
            if (
                !Array.isArray(req.body.imdbIds) ||
                req.body.imdbIds.length > 60 ||
                req.body.imdbIds.some((id) => typeof id !== "string" || !/^tt\d+$/.test(id))
            ) {
                return res.status(400).json({ error: "Send up to 60 IMDb IDs" });
            }
            const key = await require("../utils/listImport").resolveOmdbKeyForAccount(
                prisma,
                req.person.accountId
            );
            const ratings = {};
            await Promise.all(
                [...new Set(req.body.imdbIds)].map(async (id) => {
                    const value = await require("../utils/omdb").fetchOmdbRatings(id, key);
                    if (value) {
                        ratings[id] = value;
                    }
                })
            );
            res.json({ ratings });
        })
    );
    router.get(
        "/discover/saved",
        handle(async (req, res) => {
            res.json({
                items: await prisma.personalTitleState.findMany({
                    orderBy: { createdAt: "desc" },
                    where: { ...scope(req), saved: true },
                }),
            });
        })
    );
    router.put(
        "/discover/titles/:id",
        handle(async (req, res) => {
            const { name, itemType, poster, saved, reaction } = req.body;
            if (
                !(/^tt\d+$/.test(req.params.id) && ["movie", "series"].includes(itemType)) ||
                typeof name !== "string" ||
                name.length > 300 ||
                typeof saved !== "boolean" ||
                ![null, "like", "dislike"].includes(reaction) ||
                (poster !== null &&
                    (typeof poster !== "string" ||
                        poster.length > 2048 ||
                        !/^https:\/\//.test(poster)))
            ) {
                return res.status(400).json({ error: "Invalid title" });
            }
            const data = { itemType, name, poster, reaction, saved };
            res.json(
                await prisma.personalTitleState.upsert({
                    create: { ...scope(req), itemId: req.params.id, ...data },
                    update: data,
                    where: { userId_itemId: { itemId: req.params.id, userId: req.person.id } },
                })
            );
        })
    );
    router.get(
        "/discover/episodes/:id",
        handle(async (req, res) => {
            if (!/^tt\d+$/.test(req.params.id)) {
                return res.status(400).json({ error: "Invalid title" });
            }
            const metadata = await require("../utils/notify").fetchMetadata(
                req.params.id,
                "series",
                null
            );
            const watched = await prisma.episodeWatchHistory.findMany({
                select: { episode: true, season: true },
                where: { ...scope(req), showId: req.params.id },
            });
            const seen = new Set(watched.map((row) => `${row.season}:${row.episode}`));
            const seasons = new Map();
            for (const episode of metadata?.allEpisodes || []) {
                if (!seasons.has(episode.season)) {
                    seasons.set(episode.season, {
                        episodes: [],
                        season: episode.season,
                        watchedCount: 0,
                    });
                }
                const row = seasons.get(episode.season);
                const complete = seen.has(`${episode.season}:${episode.episode}`);
                row.episodes.push({ ...episode, watched: complete });
                if (complete) {
                    row.watchedCount++;
                }
            }
            res.json({ seasons: [...seasons.values()].sort((a, b) => a.season - b.season) });
        })
    );
    router.get(
        "/discover/titles/:id",
        handle(async (req, res) => {
            if (!(/^tt\d+$/.test(req.params.id) && ["movie", "series"].includes(req.query.type))) {
                return res.status(400).json({ error: "Invalid title" });
            }
            const metadata = await require("../utils/notify").fetchMetadata(
                req.params.id,
                req.query.type,
                null
            );
            const state = await prisma.personalTitleState.findUnique({
                where: { userId_itemId: { itemId: req.params.id, userId: req.person.id } },
            });
            res.json({
                metadata: metadata
                    ? {
                          backdrop: null,
                          boxOffice: null,
                          metacritic: null,
                          rated: null,
                          rottenTomatoes: null,
                          ...metadata,
                          imdb_id: metadata.imdb_id || req.params.id,
                      }
                    : null,
                state,
            });
        })
    );
    // Reuse the admin's browse/filter implementation, but never expose its
    // household mutations or recommendations through this personal router.
    const discover = require("./discover")({
        decrypt,
        getAccountId: (req) => req.person.accountId,
        prisma,
    });
    router.use("/discover", (req, res, next) => {
        if (
            req.method !== "GET" ||
            !/^\/(browse|search|lumiere|search-person|person\/[^/]+)$/.test(req.path)
        ) {
            return res.status(404).json({ error: "Not found" });
        }
        discover(req, res, next);
    });
    return router;
};
