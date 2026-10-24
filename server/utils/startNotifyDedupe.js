// One "started watching" per viewing, whichever pipeline sees it first.
//
// The AIOStreams proxy, AIOStreams' own apps (through Watch State) and a
// Jellyfin server's sessions list can each report the same viewing starting:
// an Odin stream that also runs through the proxy reaches SlickSync twice,
// seconds apart. Each pipeline claims the start here before announcing it,
// and only the first claim for a person and title within the window wins.

const WINDOW_MS = 10 * 60 * 1000;
const claims = new Map(); // `${accountId}:${userId}:${itemId}` -> expiresAt

function claimStart(accountId, userId, itemId) {
    if (!(userId && itemId)) {
        return true;
    }
    const now = Date.now();
    for (const [key, expiresAt] of claims) {
        if (expiresAt <= now) {
            claims.delete(key);
        }
    }
    const key = `${accountId || "default"}:${userId}:${itemId}`;
    if (claims.has(key)) {
        return false;
    }
    claims.set(key, now + WINDOW_MS);
    return true;
}

/**
 * The "started watching" for a viewing a live pipeline saw begin: Discord,
 * phone push and the watch.started automation trigger, once per viewing.
 * `viewing` names the title already: { itemId, itemType, videoId, season,
 * episode, title, episodeName, poster }.
 */
async function announceViewingStart(prisma, user, viewing) {
    const accountId = user.accountId || "default";
    const { title, episodeName, poster } = viewing;
    if (!title) {
        return;
    }
    let cfg = {};
    try {
        const account = await prisma.appAccount.findFirst({
            select: { sync: true },
            where: { id: accountId },
        });
        cfg = typeof account?.sync === "string" ? JSON.parse(account.sync) : account?.sync || {};
    } catch {
        cfg = {};
    }
    if (cfg?.notifyOnActivity !== true) {
        return;
    }
    if (user.notifyOnWatch === false) {
        return;
    }
    // Another pipeline may already have announced this same viewing.
    if (!claimStart(accountId, user.id, viewing.itemId)) {
        return;
    }

    const episodeTag =
        viewing.itemType === "series" && viewing.season != null && viewing.episode != null
            ? ` S${viewing.season}E${viewing.episode}${episodeName ? ` - ${episodeName}` : ""}`
            : "";
    const webhookUrl = user.discordWebhookUrl || cfg.webhookUrl || null;
    if (webhookUrl) {
        const { sendSessionStartNotification } = require("./sessionTracker");
        await sendSessionStartNotification(
            webhookUrl,
            {
                episode: viewing.episode ?? null,
                itemId: viewing.itemId,
                itemName: title,
                itemType: viewing.itemType,
                poster: poster || null,
                season: viewing.season ?? null,
                startTime: new Date(),
                videoId: viewing.itemType === "series" ? viewing.videoId : null,
            },
            user
        ).catch(() => undefined);
    }
    try {
        const { emitAutomationEvent } = require("./automation/engine");
        await emitAutomationEvent(prisma, accountId, "watch.started", {
            contentType: viewing.itemType === "series" ? "series" : "movie",
            itemId: viewing.itemId,
            itemName: title,
            userId: user.id,
            username: user.username || "",
        });
    } catch {
        /* emit never throws; guards the require itself */
    }
    const { notifyPushForType } = require("./pushNotifications");
    await notifyPushForType(prisma, accountId, "notifyOnActivity", {
        body: `${title}${episodeTag}`,
        icon: poster || "/android-chrome-192x192.png",
        title: `${user.username || user.email || "Someone"} started watching`,
        url: "/activity",
    }).catch(() => undefined);
}

module.exports = { announceViewingStart, claimStart, WINDOW_MS };
