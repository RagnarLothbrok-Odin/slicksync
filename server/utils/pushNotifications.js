/**
 * Web Push (the browser Push API) for SlickSync's PWA - lets new-episode
 * alerts arrive as native phone/desktop notifications even when SlickSync
 * isn't open.
 *
 * VAPID keys (the keypair browsers require to accept push from this server)
 * are generated once on first use and stored in data/vapid.json, which lives
 * on the same mounted volume as backups - so they persist across container
 * rebuilds with zero env/setup on the operator's part. If web-push isn't
 * installed (or generation fails), everything degrades to a no-op: push just
 * doesn't fire, and the bell/Discord alerts are unaffected.
 */

const fs = require("node:fs");
const path = require("node:path");

// Shares the same debug log file as activityMonitor.js/sessionTracker.js's
// heartbeat() - console.warn alone doesn't survive a container restart
// (docker logs aren't persisted to the mounted volume), which made a real
// push-delivery failure undiagnosable after the fact (confirmed real case,
// 2026-07-29: a notification's push delivery failed once, self-recovered
// minutes later, and by the time it was investigated the only surviving
// evidence was inferring it indirectly from PushSubscription.lastSeenAt
// timestamps - there was no direct record of the failure itself).
function heartbeat(event, data = {}) {
    try {
        require("./debugLogFile").appendCapped(
            "/app/data/activity-monitor-debug.log",
            `[${new Date().toISOString()}] ${event} ${JSON.stringify(data)}\n`
        );
    } catch {
        // Diagnostic logging must not interrupt the operation it describes.
    }
}

const VAPID_FILE = path.join(process.cwd(), "data", "vapid.json");
// Apple's web.push.apple.com validates the VAPID JWT's `sub` claim more
// strictly than Chrome/Firefox's push services do, and rejects a `.local`
// subject outright (403 BadJwtToken) — `.local` is a reserved,
// non-registrable TLD (RFC 6762), and Apple's validator apparently checks
// for a plausible domain shape rather than just "looks like an email."
// Confirmed live: iOS/Safari PWA subscriptions failed 100% of the time with
// the old default and succeeded immediately once switched to a real-shaped
// domain, while Firefox/Chrome never had a problem either way. example.com
// is IANA-reserved for documentation (RFC 2606), so it's a safe placeholder
// that still satisfies Apple's stricter check.
const VAPID_SUBJECT = process.env.VAPID_SUBJECT || "mailto:admin@example.com";

let webpush = null;
try {
    webpush = require("web-push");
} catch {
    // web-push not installed - push disabled, handled gracefully everywhere below.
}

let cachedKeys = null;

function getVapidKeys() {
    if (!webpush) {
        return null;
    }
    if (cachedKeys) {
        return cachedKeys;
    }
    try {
        if (fs.existsSync(VAPID_FILE)) {
            const parsed = JSON.parse(fs.readFileSync(VAPID_FILE, "utf8"));
            if (parsed?.publicKey && parsed?.privateKey) {
                cachedKeys = parsed;
                return cachedKeys;
            }
        }
    } catch {
        // Malformed optional data leaves the existing fallback in place.
    }
    // Generate + persist a fresh pair.
    try {
        const keys = webpush.generateVAPIDKeys();
        try {
            fs.mkdirSync(path.dirname(VAPID_FILE), { recursive: true });
            fs.writeFileSync(VAPID_FILE, JSON.stringify(keys), "utf8");
        } catch (e) {
            console.warn("[Push] Could not persist VAPID keys:", e?.message);
        }
        cachedKeys = keys;
        return cachedKeys;
    } catch (e) {
        console.warn("[Push] Failed to generate VAPID keys:", e?.message);
        return null;
    }
}

function isPushEnabled() {
    return !!(webpush && getVapidKeys());
}

/** The public key the browser needs to subscribe. Null when push is disabled. */
function getPublicKey() {
    const keys = getVapidKeys();
    return keys?.publicKey || null;
}

function configureWebPush() {
    const keys = getVapidKeys();
    if (!(webpush && keys)) {
        return false;
    }
    try {
        webpush.setVapidDetails(VAPID_SUBJECT, keys.publicKey, keys.privateKey);
        return true;
    } catch {
        return false;
    }
}

/**
 * Sends one payload to every stored subscription for an account, pruning any
 * that the push service reports as gone (404/410). Best-effort: a failure to
 * one endpoint never throws out of here.
 */
async function sendPushToAccount(prisma, accountId, payload) {
    if (!configureWebPush()) {
        heartbeat("push:transport_unavailable", { accountId, title: payload?.title });
        return { pruned: 0, sent: 0 };
    }
    let subs = [];
    try {
        subs = await prisma.pushSubscription.findMany({ where: { accountId } });
    } catch {
        return { pruned: 0, sent: 0 }; // table may not exist yet on an older DB
    }

    const body = JSON.stringify(payload);
    let sent = 0;
    let pruned = 0;
    for (const sub of subs) {
        const subscription = {
            endpoint: sub.endpoint,
            keys: { auth: sub.auth, p256dh: sub.p256dh },
        };
        try {
            await webpush.sendNotification(subscription, body);
            sent++;
            // Best-effort - a device's Settings > Devices "last active" reading
            // shouldn't be able to fail the actual push send.
            prisma.pushSubscription
                .update({ data: { lastSeenAt: new Date() }, where: { id: sub.id } })
                .catch(() => undefined);
        } catch (err) {
            const status = err?.statusCode;
            if (status === 404 || status === 410) {
                try {
                    await prisma.pushSubscription.delete({ where: { id: sub.id } });
                    pruned++;
                } catch {
                    // Unavailable optional records leave the current result in place.
                }
            } else {
                // Anything else (e.g. the BadJwtToken failure that motivated this
                // log line - see VAPID_SUBJECT's comment above) used to disappear
                // silently. A subscription isn't gone here, so it's not pruned; log
                // it so a systemic failure (wrong subject, revoked VAPID keys, etc.)
                // is actually visible instead of just "push never seems to arrive."
                console.warn(
                    `[Push] Send failed for subscription ${sub.id} (${new URL(sub.endpoint).host}): status=${status} ${err?.body || err?.message || ""}`
                );
                heartbeat("push:send_failed", {
                    message: err?.body || err?.message,
                    status,
                    subscriptionId: sub.id,
                    title: payload?.title,
                });
            }
        }
    }
    heartbeat("push:dispatch_done", {
        accountId,
        pruned,
        sent,
        title: payload?.title,
        totalSubs: subs.length,
    });
    return { pruned, sent };
}

/**
 * Toggle-aware push: sends `payload` to an account's devices only when that
 * account has the matching notification type enabled (the same
 * `notifyOnActivity` / `notifyOnSync` / `notifyOnInvite` / `notifyOnVault`
 * flags that gate the Discord notifications). Self-gating and fully
 * best-effort so notification call sites can fire it with a single line
 * without caring whether push is configured, the toggle is on, or the account
 * has any subscribed devices. Deliberately independent of whether a Discord
 * webhook is set, so phone notifications work even without Discord.
 */
async function notifyPushForType(prisma, accountId, typeKey, payload) {
    try {
        if (!accountId) {
            return;
        }
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
        if (!cfg || typeof cfg !== "object" || cfg[typeKey] !== true) {
            return;
        }

        // Persist an in-app bell notification FIRST - the bell is a primary
        // channel (alongside push), so it must record the event whether or not
        // web-push transport (VAPID keys) is even configured. Previously this
        // function returned early when push was disabled, which is exactly why a
        // notification could reach Discord/push but never the bell.
        try {
            const { persistBellNotification } = require("./notificationStore");
            await persistBellNotification(prisma, accountId, typeKey, payload);
        } catch (e) {
            // Bell write is best-effort; don't block the push transport below.
            console.warn("[Push] bell persist failed:", e?.message);
            heartbeat("push:bell_persist_failed", { accountId, message: e?.message, typeKey });
        }

        // Web-push transport is secondary and only fires when VAPID is set up.
        if (isPushEnabled()) {
            await sendPushToAccount(prisma, accountId, payload);
        }
    } catch {
        // Never let a failure here disturb the Discord path it rides alongside.
    }
}

/**
 * Sends one payload to a person's own devices - the ones they turned
 * notifications on for from their SlickSync page (PersonPushSubscription),
 * never the admin's. Nothing happens for someone who turned none on. Prunes
 * gone endpoints like sendPushToAccount; never throws.
 */
async function sendPushToPerson(prisma, accountId, userId, payload) {
    if (!(userId && configureWebPush())) {
        return { pruned: 0, sent: 0 };
    }
    let subs = [];
    try {
        subs = await prisma.personPushSubscription.findMany({
            where: { accountId: accountId || "default", userId },
        });
    } catch {
        return { pruned: 0, sent: 0 };
    }
    const body = JSON.stringify(payload);
    let sent = 0;
    let pruned = 0;
    for (const sub of subs) {
        try {
            await webpush.sendNotification(
                { endpoint: sub.endpoint, keys: { auth: sub.auth, p256dh: sub.p256dh } },
                body
            );
            sent++;
            prisma.personPushSubscription
                .update({ data: { lastSeenAt: new Date() }, where: { id: sub.id } })
                .catch(() => undefined);
        } catch (err) {
            const status = err?.statusCode;
            if (status === 404 || status === 410) {
                try {
                    await prisma.personPushSubscription.delete({ where: { id: sub.id } });
                    pruned++;
                } catch {
                    // Unavailable optional records leave the current result in place.
                }
            } else {
                console.warn(
                    `[Push] Send to a person's device failed (${new URL(sub.endpoint).host}): status=${status} ${err?.body || err?.message || ""}`
                );
            }
        }
    }
    heartbeat("push:person_dispatch_done", {
        accountId,
        pruned,
        sent,
        title: payload?.title,
        totalSubs: subs.length,
    });
    return { pruned, sent };
}

module.exports = {
    getPublicKey,
    isPushEnabled,
    notifyPushForType,
    sendPushToAccount,
    sendPushToPerson,
};
