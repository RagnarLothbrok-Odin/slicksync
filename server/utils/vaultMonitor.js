// Periodically runs active-checks on vault entries and notifies (ntfy/Discord) when:
//   - an entry is within its notifyDaysBefore window of expiresAt (throttled to once/day)
//   - an automated check flips from ok -> error (throttled to once/day per entry)

const { runCheck } = require("./vaultCheckers");
const { postDiscord } = require("./notify");
const { notifyPushForType } = require("./pushNotifications");

let vaultTimer = null;
const DEFAULT_INTERVAL_HOURS = 6;
const isDebugMode = process.env.DEBUG === "true" || process.env.DEBUG === "1";

// Vault alerts now ride on the account's single Discord webhook (the one in
// the Settings > Notifications card), gated by its own `notifyOnVault`
// toggle - the same shape as notifyOnActivity/notifyOnSync/notifyOnInvite.
// This replaced a separate Vault-only notification config (vaultNtfyUrl /
// vaultDiscordWebhookUrl / vaultCheckIntervalHours / vaultNotifyEnabled) so
// there's one place to set up notifications, not two.
function getNotifyConfig(cfg) {
    return {
        discordWebhookUrl: cfg?.webhookUrl || null,
        enabled: cfg?.notifyOnVault === true,
    };
}

// Discord needs an absolute URL to render a clickable link; the push payload's
// `url` is just consumed by the service worker so a relative path is fine
// there. PUBLIC_APP_URL is optional - without it we still send the alert,
// just without the "Fix now" line, rather than posting a broken link.
function getFixNowUrl(entryId) {
    const base = (process.env.PUBLIC_APP_URL || "").trim().replace(/\/$/, "");
    if (!base) {
        return null;
    }
    return `${base}/vault?edit=${entryId}`;
}

async function notify(
    { discordWebhookUrl },
    { title, message, entryId, actionLabel = "Fix now" },
    ctx
) {
    const { isDigestEnabled, queueDigestEntry } = require("./notificationDigest");
    const digestOn =
        ctx?.prisma && ctx?.accountId && (await isDigestEnabled(ctx.prisma, ctx.accountId));

    if (digestOn) {
        // Queued regardless of whether Discord is even configured - the digest
        // poller decides which channels (push, Discord, or both) to deliver
        // through. Push + bell are the primary channels; Discord is secondary.
        await queueDigestEntry(ctx.prisma, ctx.accountId, "vault", `${title}: ${message}`);
        return;
    }

    if (discordWebhookUrl) {
        const fixNowUrl = entryId ? getFixNowUrl(entryId) : null;
        const text = fixNowUrl
            ? `**${title}**\n${message}\n\n${actionLabel}: ${fixNowUrl}`
            : `**${title}**\n${message}`;
        await postDiscord(discordWebhookUrl, text);
    }
    // Mirror to phone push (self-gates on notifyOnVault). Independent of Discord,
    // so vault alerts reach an installed PWA even with no webhook configured.
    if (ctx?.prisma && ctx?.accountId) {
        await notifyPushForType(ctx.prisma, ctx.accountId, "notifyOnVault", {
            body: message,
            icon: "/android-chrome-192x192.png",
            title,
            // Deliberately the plain list page, not `?edit=${entryId}` - that
            // deep-links straight into the edit modal with no transition, which
            // read as a confusing surprise popup rather than a helpful shortcut
            // (confirmed real feedback). Landing on the list still gets you to
            // the right place; the entry itself is easy to spot since it's the
            // one showing the failure.
            url: "/vault",
        });
    }
}

function wasNotifiedToday(lastNotifiedAt) {
    if (!lastNotifiedAt) {
        return false;
    }
    const now = new Date();
    const last = new Date(lastNotifiedAt);
    return now.toDateString() === last.toDateString();
}

async function runVaultChecks({ prisma, decrypt, getAccountId: _getAccountId }) {
    try {
        const accounts = await prisma.appAccount.findMany({ select: { id: true, sync: true } });

        for (const account of accounts) {
            let cfg = account.sync;
            if (typeof cfg === "string") {
                try {
                    cfg = JSON.parse(cfg);
                } catch {
                    cfg = {};
                }
            }
            cfg = cfg || {};
            const notifyCfg = getNotifyConfig(cfg);
            // Toggle alone is enough — Discord is skipped downstream when there's no
            // webhook, but phone push can still fire.
            const hasNotifyChannel = notifyCfg.enabled;

            const entries = await prisma.vaultEntry.findMany({
                where: { accountId: account.id, isActive: true },
            });

            for (const entry of entries) {
                const mockReq = { appAccountId: account.id };

                // 1) Run the automated check, if configured
                if (entry.testType && entry.testType !== "manual") {
                    try {
                        const secret = decrypt(entry.encryptedSecret, mockReq);
                        const config = entry.testConfig ? JSON.parse(entry.testConfig) : {};
                        config.identifier = entry.provider || config.identifier;
                        const result = await runCheck(entry.testType, secret, config);

                        const wasOk = entry.lastCheckStatus === "ok";
                        const nowOk = result.ok === true;

                        const updateData = {
                            lastCheckedAt: new Date(),
                            lastCheckMessage: result.message || null,
                            lastCheckStatus:
                                result.ok === null ? "unknown" : nowOk ? "ok" : "error",
                        };
                        if (result.expiresAt instanceof Date && !Number.isNaN(result.expiresAt)) {
                            updateData.expiresAt = result.expiresAt;
                        }
                        await prisma.vaultEntry.update({
                            data: updateData,
                            where: { id: entry.id },
                        });

                        // Promotion round trip: this entry is the BACKUP half of an
                        // automatic promotion (it holds the demoted original secret),
                        // and it just passed - swap the secrets back, clear the stamp,
                        // rewrite addons carrying the interim key, and say so.
                        try {
                            const promos = cfg?.vaultPromotions || {};
                            const primaryId = Object.keys(promos).find(
                                (pid) => promos[pid]?.backupId === entry.id
                            );
                            if (nowOk && primaryId) {
                                const primaryEntry = await prisma.vaultEntry.findFirst({
                                    where: { accountId: account.id, id: primaryId },
                                });
                                if (primaryEntry) {
                                    let interimPlain = null;
                                    let recoveredPlain = null;
                                    try {
                                        interimPlain = decrypt(
                                            primaryEntry.encryptedSecret,
                                            mockReq
                                        );
                                    } catch {}
                                    try {
                                        recoveredPlain = decrypt(entry.encryptedSecret, mockReq);
                                    } catch {}
                                    await prisma.$transaction([
                                        prisma.vaultEntry.update({
                                            data: {
                                                encryptedSecret: entry.encryptedSecret,
                                                lastCheckMessage:
                                                    "Original key recovered - restored as primary",
                                                lastCheckStatus: "ok",
                                            },
                                            where: { id: primaryEntry.id },
                                        }),
                                        prisma.vaultEntry.update({
                                            data: {
                                                encryptedSecret: primaryEntry.encryptedSecret,
                                                lastCheckMessage: "Back to being the backup",
                                                lastCheckStatus: "unknown",
                                            },
                                            where: { id: entry.id },
                                        }),
                                    ]);
                                    delete cfg.vaultPromotions[primaryId];
                                    await prisma.appAccount.update({
                                        data: { sync: JSON.stringify(cfg) },
                                        where: { id: account.id },
                                    });
                                    if (
                                        interimPlain &&
                                        recoveredPlain &&
                                        interimPlain !== recoveredPlain
                                    ) {
                                        try {
                                            const {
                                                propagateSecretRotation,
                                            } = require("./keyRotation");
                                            const {
                                                encrypt: enc2,
                                                decrypt: dec2,
                                                getDecryptedManifestUrl,
                                            } = require("./encryption");
                                            const { manifestUrlHmac } = require("./hashing");
                                            await propagateSecretRotation(
                                                prisma,
                                                mockReq,
                                                {
                                                    decrypt: dec2,
                                                    encrypt: enc2,
                                                    getDecryptedManifestUrl,
                                                    manifestUrlHmac,
                                                },
                                                {
                                                    accountId: account.id,
                                                    newSecret: recoveredPlain,
                                                    oldSecret: interimPlain,
                                                }
                                            );
                                        } catch (e) {
                                            console.warn(
                                                "[VaultMonitor] swap-back rotation failed:",
                                                e?.message
                                            );
                                        }
                                    }
                                    try {
                                        const {
                                            createNotification,
                                        } = require("./notificationStore");
                                        await createNotification(prisma, account.id, {
                                            body: "The original credential passed its check again, so the automatic promotion was reversed - it is the primary once more, and the spare went back to being the backup.",
                                            dedupeKey: `vaultswapback-${primaryEntry.id}-${new Date().toDateString()}`,
                                            title: `"${primaryEntry.name}" recovered - promoted back to primary`,
                                            type: "vault",
                                        });
                                    } catch {
                                        // Unavailable optional records leave the current result in place.
                                    }
                                }
                            }
                        } catch (e) {
                            console.warn("[VaultMonitor] promotion round-trip failed:", e?.message);
                        }

                        // Notify on ok -> error transition (not on first-ever check, and throttled to once/day)
                        if (
                            wasOk &&
                            !nowOk &&
                            hasNotifyChannel &&
                            !wasNotifiedToday(entry.lastNotifiedAt)
                        ) {
                            await notify(
                                notifyCfg,
                                {
                                    entryId: entry.id,
                                    message: `${entry.provider || entry.category}: ${result.message || "Check failed"}`,
                                    tags: ["warning"],
                                    title: `⚠️ ${entry.name} check failed`,
                                },
                                { accountId: account.id, prisma }
                            );
                            await prisma.vaultEntry.update({
                                data: { lastNotifiedAt: new Date() },
                                where: { id: entry.id },
                            });
                        }

                        // Automation rules fire on the raw ok -> error edge, deliberately
                        // NOT gated on hasNotifyChannel like the notification above: a rule
                        // whose action is "move these users to the free group" must still
                        // run on an instance with no Discord webhook configured. No throttle
                        // needed - this is an edge, so it can't repeat while the entry stays
                        // failing (wasOk is false on every subsequent pass).
                        if (wasOk && !nowOk) {
                            try {
                                const { emitAutomationEvent } = require("./automation/engine");
                                // Resolve the backup once, so both events agree on whether
                                // a usable spare actually exists - "has a backup" must mean
                                // a real, active, working entry, not merely a non-null id
                                // pointing at something deleted or equally broken.
                                let backup = null;
                                if (entry.backupEntryId) {
                                    backup = await prisma.vaultEntry
                                        .findFirst({
                                            where: {
                                                accountId: account.id,
                                                id: entry.backupEntryId,
                                                isActive: true,
                                            },
                                        })
                                        .catch(() => null);
                                    if (
                                        backup &&
                                        ["failed", "error", "expired"].includes(
                                            String(backup.lastCheckStatus || "").toLowerCase()
                                        )
                                    ) {
                                        backup = null;
                                    }
                                }

                                await emitAutomationEvent(
                                    prisma,
                                    account.id,
                                    "vault.check_failed",
                                    {
                                        backupName: backup ? backup.name : "",
                                        category: entry.category,
                                        entryId: entry.id,
                                        entryName: entry.name,
                                        hasBackup: !!backup,
                                        message: result.message || "Check failed",
                                    }
                                );

                                // Emitted on the same ok -> error edge, so it can't repeat
                                // while the entry stays failing. Consumers switch to the
                                // backup from here on (see vaultFailover.js).
                                if (backup) {
                                    await emitAutomationEvent(
                                        prisma,
                                        account.id,
                                        "vault.failover_activated",
                                        {
                                            backupId: backup.id,
                                            backupName: backup.name,
                                            category: entry.category,
                                            entryId: entry.id,
                                            entryName: entry.name,
                                            message: result.message || "Check failed",
                                        }
                                    );
                                }
                            } catch {
                                /* emit never throws; guarding the require itself */
                            }
                        }
                    } catch (err) {
                        console.error(
                            `[VaultMonitor] Check failed for entry ${entry.id}:`,
                            err.message
                        );
                    }
                }

                // 2) Expiry warning, independent of the check above.
                // hasNotifyChannel is NOT part of this outer gate (it used to be) so
                // automation rules still fire on an instance with no notification
                // channel configured - the notify() call below keeps its own gate, and
                // lastNotifiedAt is only written when something actually happened, so
                // an instance with neither channels nor rules behaves exactly as before.
                if (entry.expiresAt) {
                    const msUntilExpiry = new Date(entry.expiresAt).getTime() - Date.now();
                    const daysUntilExpiry = msUntilExpiry / (1000 * 60 * 60 * 24);
                    const withinWindow = daysUntilExpiry <= (entry.notifyDaysBefore ?? 3);
                    const isSnoozed =
                        entry.snoozedUntil && new Date(entry.snoozedUntil) > new Date();

                    if (withinWindow && !isSnoozed && !wasNotifiedToday(entry.lastNotifiedAt)) {
                        let didNotify = false;
                        if (hasNotifyChannel) {
                            const daysText =
                                daysUntilExpiry < 0
                                    ? `expired ${Math.abs(Math.round(daysUntilExpiry))} day(s) ago`
                                    : `expires in ${Math.round(daysUntilExpiry)} day(s)`;
                            await notify(
                                notifyCfg,
                                {
                                    actionLabel: "Rotate now",
                                    entryId: entry.id,
                                    message: `${entry.provider || entry.category}: ${daysText}`,
                                    tags: ["hourglass"],
                                    title: `⏰ ${entry.name} ${daysUntilExpiry < 0 ? "has expired" : "expiring soon"}`,
                                },
                                { accountId: account.id, prisma }
                            );
                            didNotify = true;
                        }

                        // Unlike the check-failure edge above, this condition stays true on
                        // every pass until the credential is rotated, so it relies on the
                        // same once-a-day lastNotifiedAt throttle the notification uses -
                        // otherwise a 6h monitor would fire the rule four times a day.
                        let didFire = false;
                        try {
                            const { emitAutomationEvent } = require("./automation/engine");
                            const { fired } = await emitAutomationEvent(
                                prisma,
                                account.id,
                                "vault.expiring",
                                {
                                    category: entry.category,
                                    daysLeft: Math.round(daysUntilExpiry),
                                    entryId: entry.id,
                                    entryName: entry.name,
                                }
                            );
                            didFire = fired > 0;
                        } catch {
                            /* emit never throws; guarding the require itself */
                        }

                        if (didNotify || didFire) {
                            await prisma.vaultEntry.update({
                                data: { lastNotifiedAt: new Date() },
                                where: { id: entry.id },
                            });
                        }
                    }
                }
            }
        }
    } catch (err) {
        console.error("[VaultMonitor] Run failed:", err.message);
    }
}

function scheduleVaultMonitor({ prisma, decrypt, getAccountId }) {
    if (vaultTimer) {
        clearInterval(vaultTimer);
        vaultTimer = null;
    }

    const intervalHours = isDebugMode ? 1 / 60 : DEFAULT_INTERVAL_HOURS; // debug: every minute
    const intervalMs = intervalHours * 60 * 60 * 1000;

    // Run once shortly after boot, then on the interval
    setTimeout(() => runVaultChecks({ decrypt, getAccountId, prisma }), 30 * 1000);
    vaultTimer = setInterval(() => runVaultChecks({ decrypt, getAccountId, prisma }), intervalMs);
    console.log(`[VaultMonitor] Scheduled every ${intervalHours}h`);
}

module.exports = { runVaultChecks, scheduleVaultMonitor };
