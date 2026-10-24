const express = require("express");
const { publicMessage } = require("../utils/publicError");

// Anime endpoints, backed by AniList (utils/anilist.js).
//
// Read-only and key-free: AniList's public GraphQL API needs no credentials,
// so nothing here spends anyone's quota or needs a Settings field. Every
// handler degrades to an empty/null answer rather than an error, because
// anime metadata is strictly additive - Cinemeta still provides the base
// record, and a bad day at AniList must never break a page.

module.exports = ({ getAccountId: _getAccountId }) => {
    const router = express.Router();

    // This season's airing anime - the seasonal chart row.
    router.get("/seasonal", async (req, res) => {
        try {
            const {
                getSeasonalAnime,
                nextEpisodeCountdown,
                getServiceStatus,
            } = require("../utils/anilist");
            const media = await getSeasonalAnime({
                perPage: 40,
                season:
                    typeof req.query.season === "string"
                        ? req.query.season.toUpperCase()
                        : undefined,
                seasonYear: Number.isFinite(Number(req.query.year))
                    ? Number(req.query.year)
                    : undefined,
            });
            // An empty row plus the reason, rather than an empty row on its own -
            // "AniList is down" and "nothing is airing" look identical otherwise.
            const status =
                media.length === 0 ? getServiceStatus() : { available: true, reason: null };
            res.json({
                items: media.map((m) => ({
                    anilistId: m.id,
                    episodes: m.episodes ?? null,
                    format: m.format || null,
                    genres: Array.isArray(m.genres) ? m.genres.slice(0, 4) : [],
                    name: m.title?.english || m.title?.romaji || m.title?.native,
                    nextEpisode: nextEpisodeCountdown(m),
                    poster: m.coverImage?.large || null,
                    score: Number.isFinite(m.averageScore) ? m.averageScore : null,
                    siteUrl: m.siteUrl || null,
                    status: m.status || null,
                })),
                reason: status.reason,
                unavailable: !status.available,
            });
        } catch {
            const { getServiceStatus } = require("../utils/anilist");
            const status = getServiceStatus();
            res.json({ items: [], reason: status.reason, unavailable: !status.available });
        }
    });

    // Title lookup - used to attach anime data to a title the rest of the app
    // already knows about through Cinemeta.
    router.get("/lookup", async (req, res) => {
        try {
            const { searchAnime, nextEpisodeCountdown } = require("../utils/anilist");
            const title = String(req.query.title || "").trim();
            if (!title) {
                return res.status(400).json({ error: "title is required" });
            }
            const year = Number.isFinite(Number(req.query.year))
                ? Number(req.query.year)
                : undefined;
            const media = await searchAnime(title, year);
            if (!media) {
                return res.json({ found: false });
            }
            res.json({
                anilistId: media.id,
                episodes: media.episodes ?? null,
                found: true,
                malId: media.idMal ?? null,
                name: media.title?.english || media.title?.romaji,
                nextEpisode: nextEpisodeCountdown(media),
                siteUrl: media.siteUrl || null,
                status: media.status || null,
            });
        } catch {
            res.json({ found: false });
        }
    });

    // Franchise watch order: the prequel/sequel line, with side stories and
    // movies kept separate rather than interleaved on a guess.
    router.get("/:anilistId/watch-order", async (req, res) => {
        try {
            const { getWatchOrder } = require("../utils/anilist");
            const order = await getWatchOrder(req.params.anilistId);
            if (!order) {
                return res.status(404).json({ error: "Not found on AniList" });
            }
            const shape = (m) => ({
                anilistId: m.id,
                episodes: m.episodes ?? null,
                format: m.format || null,
                name: m.title?.english || m.title?.romaji,
                year: m.seasonYear ?? null,
            });
            res.json({
                mainLine: order.mainLine.map(shape),
                movies: order.movies.map(shape),
                sideStories: order.sideStories.map(shape),
            });
        } catch (e) {
            res.status(500).json({ error: publicMessage(e, "Failed to build a watch order") });
        }
    });

    // Absolute -> season/episode. Answers null rather than guessing when the
    // chain's episode counts aren't known, since a wrong answer would put
    // someone's progress on the wrong episode.
    router.get("/:anilistId/episode", async (req, res) => {
        try {
            const { resolveAbsoluteEpisode } = require("../utils/anilist");
            const absolute = Number(req.query.absolute);
            const resolved = await resolveAbsoluteEpisode(req.params.anilistId, absolute);
            res.json({ resolved: resolved || null });
        } catch {
            res.json({ resolved: null });
        }
    });

    return router;
};
