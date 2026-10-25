const express = require("express");

// System Health board: one page answering "is everything actually working
// right now" - today that means checking Sync (per-user drift, via Sync
// Guardian's already-computed state), Addons (reachability, from the
// existing health-check poller), Vault (credential check failures + expiry
// windows, from the existing vault monitor), and the AIOStreams Proxy
// (last poll outcome), and each Jellyfin-compatible server people sign in
// to (utils/serverStatus.js). Every signal here is read from state ALREADY
// maintained by an existing background monitor - this route computes
// nothing live and makes no outbound calls itself, so loading the page has
// no cost beyond a few fast DB reads.
module.exports = ({ prisma, getAccountId, INSTANCE_TYPE }) => {
    const router = express.Router();

    // Which build of the pages this server is serving - the stamp the
    // Dockerfile writes next to the build. Open tabs compare it with their own
    // (components/pwa/BuildWatcher.tsx) to notice an update. Fixed for the
    // container's lifetime, so it is read once.
    let buildStamp = null;
    router.get("/build", (_req, res) => {
        if (buildStamp === null) {
            try {
                buildStamp = require("node:fs")
                    .readFileSync(
                        require("node:path").join(
                            require("node:path").dirname(module.filename),
                            "..",
                            "..",
                            "client",
                            ".next",
                            "build-stamp"
                        ),
                        "utf8"
                    )
                    .trim();
            } catch {
                buildStamp = "";
            }
        }
        res.set("Cache-Control", "no-store");
        res.json({ stamp: buildStamp || null });
    });

    router.get("/", async (req, res) => {
        try {
            // No signed-in account: a health check asking whether it's up. Answer
            // that and nothing else - the rest of this is the admin Health page.
            if (!req.appAccountId) {
                return res.json({ status: "ok" });
            }
            const accountId = getAccountId(req) || "default";

            const { getVersionStatus } = require("../utils/versionCheck");

            const [
                addons,
                vaultEntries,
                driftNotifications,
                mismatchCount,
                users,
                version,
                addonEvents,
                vaultProxyEvents,
                appAccount,
            ] = await Promise.all([
                prisma.addon.findMany({
                    select: {
                        healthCheckError: true,
                        healthIgnored: true,
                        id: true,
                        isOnline: true,
                        lastHealthCheck: true,
                        name: true,
                    },
                    where: { accountId },
                }),
                prisma.vaultEntry.findMany({
                    select: {
                        expiresAt: true,
                        healthIgnored: true,
                        id: true,
                        lastCheckedAt: true,
                        lastCheckMessage: true,
                        lastCheckStatus: true,
                        name: true,
                        notifyDaysBefore: true,
                        provider: true,
                    },
                    where: { accountId, isActive: true },
                }),
                // dedupeKey is `sync-guardian-${user.id}` (see syncGuardian.js) - kept
                // in the select so a drifted user's own healthIgnored flag can be
                // checked below without a second query.
                prisma.notification.findMany({
                    select: {
                        body: true,
                        createdAt: true,
                        dedupeKey: true,
                        title: true,
                        url: true,
                    },
                    where: { accountId, dedupeKey: { startsWith: "sync-guardian-" }, type: "sync" },
                }),
                prisma.notification.count({ where: { accountId, type: "mismatch" } }),
                prisma.user.findMany({
                    select: { healthIgnored: true, id: true, username: true },
                    where: { accountId, isActive: true },
                }),
                getVersionStatus(),
                // Unified incident timeline, part 1: addon offline/online edge events
                // (AddonHealthAlert already logs exactly this - see the model's own
                // comment). Not filtered by healthIgnored - an ignored addon's past
                // history is still real history, only its CURRENT status stops
                // counting toward Attention.
                prisma.addonHealthAlert.findMany({
                    orderBy: { createdAt: "desc" },
                    take: 50,
                    where: { accountId },
                }),
                // Unified incident timeline, part 2: Vault and Proxy don't have a
                // dedicated event-log table the way addons do, but notifyPushForType
                // already persists a bell Notification row for every vault/proxy
                // health transition (see pushNotifications.js) - reusing that instead
                // of building a second logging mechanism for the same kind of event.
                prisma.notification.findMany({
                    orderBy: { createdAt: "desc" },
                    take: 50,
                    where: { accountId, type: { in: ["vault", "proxy"] } },
                }),
                // Proxy has no per-item entity to hang a healthIgnored flag off of
                // (it's one global connectivity check, not a list) - the mute lives
                // on the account itself instead.
                prisma.appAccount.findUnique({
                    select: { proxyHealthIgnored: true },
                    where: { id: accountId },
                }),
            ]);

            // Jellyfin, AIOStreams and AIOMetadata servers, from each person's last
            // read, plus their outage alerts for the timeline.
            let servers = [];
            let serverEvents = [];
            try {
                servers = await require("../utils/serverStatus").serverStatusList(
                    prisma,
                    accountId
                );
                serverEvents = await prisma.notification.findMany({
                    orderBy: { createdAt: "desc" },
                    select: { body: true, createdAt: true, dedupeKey: true, id: true, title: true },
                    take: 50,
                    where: { accountId, dedupeKey: { startsWith: "connection-server-" } },
                });
            } catch (e) {
                console.warn("[Health] server status failed:", e.message);
            }

            // The account's LumiereDB, when one is set: up, building its index,
            // or not answering. One cached check (a minute), same as Settings'.
            let lumiere = null;
            try {
                const { lumiereAddress, lumiereStatus } = require("../utils/lumiere");
                const base = await lumiereAddress(prisma, accountId);
                if (base) {
                    const status = await lumiereStatus(base);
                    let address = "";
                    try {
                        const u = new URL(base);
                        u.username = "";
                        u.password = "";
                        address = u.host + (u.pathname === "/" ? "" : u.pathname);
                    } catch {
                        // Keep the original address when it cannot be normalized.
                    }
                    lumiere = { ...status, address };
                }
            } catch (e) {
                console.warn("[Health] LumiereDB status failed:", e.message);
            }

            const timeline = [
                ...addonEvents.map((e) => ({
                    at: e.createdAt,
                    detail: e.errorMessage || null,
                    id: e.id,
                    source: "addon",
                    status: e.event === "offline" ? "down" : "up",
                    title:
                        e.event === "offline"
                            ? `${e.addonName} went offline`
                            : `${e.addonName} came back online`,
                })),
                ...vaultProxyEvents.map((n) => ({
                    at: n.createdAt,
                    detail: n.body || null,
                    id: n.id,
                    source: n.type,
                    // Proxy has a real ✅ recovery notification (proxyStreamMonitor.js);
                    // Vault only ever alerts on failure/expiry (⚠️/⏰ - vaultMonitor.js
                    // has no "back to ok" counterpart), so this correctly shows as
                    // "down" for every vault event - an accurate reflection of what's
                    // actually tracked, not a gap in this timeline.
                    status: n.title.startsWith("✅") ? "up" : "down",
                    title: n.title,
                })),
                ...serverEvents.map((n) => ({
                    at: n.createdAt,
                    detail: n.body || null,
                    id: n.id,
                    source: "server",
                    status: n.dedupeKey.endsWith("-ok") ? "up" : "down",
                    title: n.title,
                })),
            ]
                .sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime())
                .slice(0, 50);

            // Addons - healthIgnored entries never show as Attention or count
            // toward `overall`. The ignored list itself is independent of current
            // online/offline state (once marked ignored, it stays manageable from
            // Health even if the addon later comes back online) so there's always
            // a way back to un-ignore it - never a one-way black hole.
            const addonsOffline = addons.filter((a) => a.isOnline === false && !a.healthIgnored);
            const addonsIgnored = addons.filter((a) => a.healthIgnored);
            const addonsChecked = addons.filter((a) => a.lastHealthCheck != null);

            // Uptime % reconstructed from AddonHealthAlert's offline/online
            // transition log - see computeAddonUptime's own comment for why it
            // needs the pre-window state too, not just events inside the window.
            const { computeAddonUptime } = require("../utils/addonHealthCheck");
            const addonUptime = Object.fromEntries(
                await Promise.all(
                    addons.map(async (a) => [
                        a.id,
                        {
                            uptime7d: await computeAddonUptime(
                                prisma,
                                accountId,
                                a.id,
                                a.isOnline !== false,
                                7
                            ),
                            uptime30d: await computeAddonUptime(
                                prisma,
                                accountId,
                                a.id,
                                a.isOnline !== false,
                                30
                            ),
                        },
                    ])
                )
            );

            // Vault - same healthIgnored treatment as addons above.
            const now = Date.now();
            const vaultFailing = vaultEntries.filter(
                (v) => v.lastCheckStatus === "error" && !v.healthIgnored
            );
            const vaultExpiring = vaultEntries.filter((v) => {
                if (!v.expiresAt || v.healthIgnored) {
                    return false;
                }
                const daysUntil = (new Date(v.expiresAt).getTime() - now) / (1000 * 60 * 60 * 24);
                return daysUntil <= (v.notifyDaysBefore ?? 3);
            });
            const vaultIgnored = vaultEntries.filter((v) => v.healthIgnored);

            // Sync - same healthIgnored treatment as addons/vault above, keyed by
            // user since that's what dedupeKey encodes (`sync-guardian-${userId}`).
            const ignoredUserIds = new Set(users.filter((u) => u.healthIgnored).map((u) => u.id));
            const driftedUserId = (n) => (n.dedupeKey || "").replace(/^sync-guardian-/, "");
            const driftVisible = driftNotifications.filter(
                (n) => !ignoredUserIds.has(driftedUserId(n))
            );
            const driftIgnored = driftNotifications.filter((n) =>
                ignoredUserIds.has(driftedUserId(n))
            );

            // Proxy connectivity - last poll outcome, in-memory (single-instance
            // deploy). This entire concept is private-mode-only: the monitor is
            // wired up once at boot against ONE shared AIOSTREAMS_URL env var for
            // DEFAULT_ACCOUNT_ID (server/index.js), not a per-tenant Settings
            // field - there is no way for an individual public-mode account to
            // ever configure their own. Every public tenant would otherwise see
            // the exact same "Not configured" card forever, since it's reading
            // one process-wide global that has nothing to do with their account.
            let proxy = null;
            if (INSTANCE_TYPE !== "public") {
                proxy = { at: null, configured: false, error: null, ok: null };
                try {
                    const { getProxyMonitorStatus } = require("../utils/proxyStreamMonitor");
                    proxy = {
                        ...getProxyMonitorStatus(),
                        configured: !!process.env.AIOSTREAMS_URL,
                    };
                } catch {
                    // The health response remains available when the optional proxy monitor is absent.
                }
                proxy.healthIgnored = !!appAccount?.proxyHealthIgnored;
            }

            const overall =
                addonsOffline.length === 0 &&
                vaultFailing.length === 0 &&
                driftVisible.length === 0 &&
                (proxy?.ok !== false || proxy.healthIgnored) &&
                servers.every((s) => s.status === "up") &&
                (!lumiere || lumiere.state === "ready" || lumiere.state === "building")
                    ? "healthy"
                    : "attention";

            res.json({
                addons: {
                    checked: addonsChecked.length,
                    ignored: addonsIgnored.map((a) => ({ id: a.id, name: a.name })),
                    offline: addonsOffline.map((a) => ({
                        error: a.healthCheckError,
                        id: a.id,
                        lastChecked: a.lastHealthCheck,
                        name: a.name,
                    })),
                    offlineCount: addonsOffline.length,
                    total: addons.length,
                    uptime: addons.map((a) => ({
                        id: a.id,
                        name: a.name,
                        uptime7d: addonUptime[a.id].uptime7d,
                        uptime30d: addonUptime[a.id].uptime30d,
                    })),
                },
                checkedAt: new Date().toISOString(),
                lumiere,
                mismatchCount,
                overall,
                proxy,
                servers,
                sync: {
                    driftCount: driftVisible.length,
                    drifted: driftVisible.map((n) => ({
                        body: n.body,
                        since: n.createdAt,
                        title: n.title,
                        url: n.url,
                        userId: driftedUserId(n),
                    })),
                    ignored: driftIgnored
                        .map((n) => ({
                            since: n.createdAt,
                            title: n.title,
                            userId: driftedUserId(n),
                        }))
                        .concat(
                            // A user can be marked ignored before they've ever actually
                            // drifted (pre-emptive mute) - driftIgnored above only covers
                            // ones with a live drift notification right now, so also list
                            // any healthIgnored user who isn't already in that set.
                            users
                                .filter(
                                    (u) =>
                                        u.healthIgnored &&
                                        !driftIgnored.some((n) => driftedUserId(n) === u.id)
                                )
                                .map((u) => ({ since: null, title: u.username, userId: u.id }))
                        ),
                    usersTracked: users.length,
                },
                timeline,
                vault: {
                    expiring: vaultExpiring.map((v) => ({
                        expiresAt: v.expiresAt,
                        id: v.id,
                        name: v.name,
                        provider: v.provider,
                    })),
                    expiringCount: vaultExpiring.length,
                    failing: vaultFailing.map((v) => ({
                        id: v.id,
                        lastChecked: v.lastCheckedAt,
                        message: v.lastCheckMessage,
                        name: v.name,
                        provider: v.provider,
                    })),
                    failingCount: vaultFailing.length,
                    ignored: vaultIgnored.map((v) => ({
                        id: v.id,
                        name: v.name,
                        provider: v.provider,
                    })),
                    total: vaultEntries.length,
                },
                version,
            });
        } catch (error) {
            console.error("Error building health status:", error);
            res.status(500).json({ error: "Failed to build health status" });
        }
    });

    // PATCH /api/health/proxy-ignore - mute the AIOStreams proxy connectivity
    // card's Attention state. Account-level (see proxy's own comment above for
    // why: one shared monitor, no per-item entity to hang a flag off of).
    router.patch("/proxy-ignore", async (req, res) => {
        try {
            const { healthIgnored } = req.body;
            const accountId = getAccountId(req) || "default";
            const updated = await prisma.appAccount.update({
                data: { proxyHealthIgnored: !!healthIgnored },
                select: { proxyHealthIgnored: true },
                where: { id: accountId },
            });
            res.json({ healthIgnored: updated.proxyHealthIgnored });
        } catch (error) {
            console.error("Error updating proxy health-ignore state:", error);
            res.status(500).json({ error: "Failed to update proxy health-ignore state" });
        }
    });

    return router;
};
