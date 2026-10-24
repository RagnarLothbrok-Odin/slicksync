const express = require("express");
const { publicMessage } = require("../utils/publicError");

// Follow / mute for the two alert feeds (see utils/followWatch.js): people
// whose new work should ping you, and shows whose renewal or cancellation
// should. Muting is a first-class action here, not an afterthought - the
// point of the feed is that it stays wanted.

module.exports = ({ prisma, getAccountId }) => {
    const router = express.Router();

    // Everything followed, both kinds, muted included so the UI can show it.
    router.get("/", async (req, res) => {
        try {
            const accountId = getAccountId(req) || "default";
            const items = await prisma.followedSubject.findMany({
                orderBy: [{ kind: "asc" }, { createdAt: "desc" }],
                where: { accountId },
            });
            res.json(items);
        } catch {
            res.status(500).json({ error: "Failed to read follows" });
        }
    });

    // Follow a person or a show. Idempotent: following something already
    // followed un-mutes it rather than erroring, since that is what pressing
    // Follow again plainly means.
    router.post("/", async (req, res) => {
        try {
            const accountId = getAccountId(req) || "default";
            const { kind, subjectId, name, poster } = req.body || {};
            if (!["person", "show"].includes(kind)) {
                return res.status(400).json({ error: "kind must be person or show" });
            }
            if (!(subjectId && name)) {
                return res.status(400).json({ error: "subjectId and name are required" });
            }
            const row = await prisma.followedSubject.upsert({
                create: {
                    accountId,
                    kind,
                    name: String(name),
                    poster: poster || null,
                    subjectId: String(subjectId),
                },
                update: { muted: false, name: String(name), poster: poster || null },
                where: {
                    accountId_kind_subjectId: { accountId, kind, subjectId: String(subjectId) },
                },
            });
            res.json(row);
        } catch (e) {
            res.status(500).json({ error: publicMessage(e, "Failed to follow") });
        }
    });

    // Mute / un-mute. The row survives either way, so re-following doesn't
    // replay news already announced.
    router.put("/:id/mute", async (req, res) => {
        try {
            const accountId = getAccountId(req) || "default";
            const muted = req.body?.muted !== false;
            const { count } = await prisma.followedSubject.updateMany({
                data: { muted },
                where: { accountId, id: req.params.id },
            });
            if (count === 0) {
                return res.status(404).json({ error: "Not found" });
            }
            res.json({ muted, success: true });
        } catch {
            res.status(500).json({ error: "Failed to update" });
        }
    });

    router.delete("/:id", async (req, res) => {
        try {
            const accountId = getAccountId(req) || "default";
            const { count } = await prisma.followedSubject.deleteMany({
                where: { accountId, id: req.params.id },
            });
            if (count === 0) {
                return res.status(404).json({ error: "Not found" });
            }
            res.json({ success: true });
        } catch {
            res.status(500).json({ error: "Failed to unfollow" });
        }
    });

    // Run the sweep now rather than waiting for the twice-daily one.
    router.post("/check-now", async (_req, res) => {
        try {
            const { runFollowSweep } = require("../utils/followWatch");
            const { resolveTmdbKeyForAccount } = require("../utils/listImport");
            await runFollowSweep(prisma, { resolveTmdbKeyForAccount });
            res.json({ success: true });
        } catch (e) {
            res.status(500).json({ error: publicMessage(e, "Check failed") });
        }
    });

    return router;
};
