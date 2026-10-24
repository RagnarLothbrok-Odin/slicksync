const express = require("express");
const { publicMessage } = require("../utils/publicError");
const { decrypt } = require("../utils/encryption");
const {
    parseAddonIds,
    parseProtectedAddons,
    canonicalizeManifestUrl,
} = require("../utils/validation");
const { StremioAPIClient } = require("stremio-api-client");
const { handleDatabaseError, sendError } = require("../utils/handlers");
const { findGroupById } = require("../utils/helpers");
const { responseUtils, dbUtils } = require("../utils/routeUtils");
const { createdAtFromCuid } = require("../utils/dateUtils");
const { removeUserFromGroup, setGroupMembers } = require("../utils/helpers/database");

// Export a function that returns the router, allowing dependency injection
module.exports = ({
    prisma,
    getAccountId,
    scopedWhere,
    INSTANCE_TYPE,
    assignUserToGroup,
    getDecryptedManifestUrl,
    manifestUrlHmac,
    decrypt,
    createProvider,
}) => {
    const router = express.Router();

    // PUT /api/groups/reorder - bulk update group display order (drag-and-
    // drop), same pattern as addons.js's own /reorder. Registered before
    // PUT /:id below - Express matches routes in registration order, not
    // specificity, so this has to come first or "/reorder" would match
    // "/:id" with id="reorder" instead (same ordering note vault.js's own
    // /reorder already has).
    router.put("/reorder", async (req, res) => {
        try {
            const { orderedIds } = req.body || {};
            if (!Array.isArray(orderedIds) || orderedIds.length === 0) {
                return res.status(400).json({ error: "orderedIds is required" });
            }
            const existing = await prisma.group.findMany({
                select: { id: true },
                where: scopedWhere(req, { id: { in: orderedIds } }),
            });
            if (existing.length !== orderedIds.length) {
                return res
                    .status(400)
                    .json({ error: "One or more groups do not belong to this account" });
            }
            await Promise.all(
                orderedIds.map((id, index) =>
                    prisma.group.update({ data: { position: index }, where: { id } })
                )
            );
            res.json({ success: true });
        } catch (error) {
            console.error("Error reordering groups:", error);
            res.status(500).json({ error: "Failed to reorder groups" });
        }
    });

    // Shared helper: reload (advanced mode) then sync all users in a group.
    // forcePush bypasses the alreadySynced skip below - needed after a
    // group-level addon reorder, since computeUserSyncPlan's comparison is
    // deliberately order-insensitive (see sync.js's own comment: a *user's*
    // own local reorder in their Stremio app must not read as "not synced").
    // That same order-insensitivity means a pure reorder never looks different
    // from "already synced" to the normal check, so the group's new order
    // never actually got pushed down - reported as addons/reorder silently
    // not syncing to local user accounts.
    async function syncGroupUsers(groupId, req, { forcePush = false } = {}) {
        // Load group with scoped account
        const group = await prisma.group.findFirst({
            select: { id: true, name: true, userIds: true },
            where: { accountId: getAccountId(req), id: groupId },
        });
        if (!group) {
            return { error: "Group not found", groupId };
        }

        // Parse userIds array from stored JSON
        let userIds = [];
        try {
            userIds = Array.isArray(group.userIds)
                ? group.userIds
                : JSON.parse(group.userIds || "[]");
        } catch {
            // Malformed optional data leaves the existing fallback in place.
        }
        if (!Array.isArray(userIds) || userIds.length === 0) {
            return {
                failedUsers: 0,
                groupId,
                message: "Group has no users to sync",
                syncedUsers: 0,
            };
        }

        // Read account-backed sync settings; fallback to headers only if unavailable
        let syncMode = "normal";
        let unsafeMode = false;
        let useCustomFields = true;
        try {
            const acct = await prisma.appAccount.findUnique({
                select: { sync: true },
                where: { id: getAccountId(req) },
            });
            let cfg = acct?.sync;
            if (typeof cfg === "string") {
                try {
                    cfg = JSON.parse(cfg);
                } catch {
                    cfg = null;
                }
            }
            if (cfg && typeof cfg === "object") {
                if (cfg.mode === "advanced") {
                    syncMode = "advanced";
                }
                if (typeof cfg.safe === "boolean") {
                    unsafeMode = !cfg.safe;
                }
                if (typeof cfg.useCustomFields === "boolean") {
                    useCustomFields = cfg.useCustomFields;
                } else if (typeof cfg.useCustomNames === "boolean") {
                    // Backward compatibility: migrate old useCustomNames to useCustomFields
                    useCustomFields = cfg.useCustomNames;
                } else {
                    useCustomFields = true;
                }
            } else {
                const headerMode = (req.headers["x-sync-mode"] || "").toString().toLowerCase();
                syncMode = headerMode === "advanced" ? "advanced" : "normal";
                unsafeMode = req.query?.unsafe === "true" || req.body?.unsafe === true;
            }
        } catch {
            const headerMode = (req.headers["x-sync-mode"] || "").toString().toLowerCase();
            syncMode = headerMode === "advanced" ? "advanced" : "normal";
            unsafeMode = req.query?.unsafe === "true" || req.body?.unsafe === true;
        }

        // Remove duplicates from userIds to prevent double syncing
        const uniqueUserIds = [...new Set(userIds)];
        if (uniqueUserIds.length !== userIds.length) {
            console.log(
                `⚠️ Group ${groupId} had duplicate user IDs, deduplicated: ${userIds.length} -> ${uniqueUserIds.length}`
            );
        }

        console.log(`\nSyncing group ${group.name || groupId}`);
        console.log(`🔄 Syncing ${uniqueUserIds.length} users in group`);

        // In advanced mode, reload group addons first (shared helper from users router)
        let reloadInfo = null;
        if (syncMode === "advanced") {
            const { reloadGroupAddons } = require("./users");
            try {
                reloadInfo = await reloadGroupAddons(prisma, getAccountId, groupId, req, decrypt);
            } catch (e) {
                console.warn("Group reload before sync failed:", e?.message);
            }
        }

        // Sync each user in the group (like individual user sync)
        const { syncUserAddons } = require("./users");
        const { computeUserSyncPlan } = require("../utils/sync");
        let synced = 0;
        let failed = 0;

        for (const uid of uniqueUserIds) {
            try {
                // Pre-compute current/desired and alreadySynced using the same comparator as the badge
                const userRec = await prisma.user.findFirst({
                    // accountId, traxAddonEnabled and traxToken are NOT optional here,
                    // however unused they look: computeUserSyncPlan feeds this row to
                    // syncTraxAddon, which reads all three. Without them SlickTrax is
                    // silently absent from the desired list, so a user whose only
                    // pending change is SlickTrax compares as already synced and this
                    // loop skips them - syncing the group did nothing while syncing
                    // the same user from their own page worked, which is exactly how
                    // it was reported.
                    select: {
                        accountId: true,
                        excludedAddons: true,
                        id: true,
                        isActive: true,
                        nuvioRefreshToken: true,
                        nuvioUserId: true,
                        protectedAddons: true,
                        providerType: true,
                        stremioAuthKey: true,
                        traxAddonEnabled: true,
                        traxToken: true,
                        username: true,
                    },
                    where: { accountId: getAccountId(req), id: uid },
                });
                if (!userRec || userRec.isActive === false) {
                    failed++;
                    continue;
                }

                const plan = await computeUserSyncPlan(userRec, req, {
                    canonicalizeManifestUrl,
                    createProvider,
                    decrypt,
                    getAccountId,
                    parseAddonIds,
                    parseProtectedAddons,
                    prisma,
                    StremioAPIClient,
                    unsafeMode,
                    useCustomFields,
                });

                // If already synced, count and skip pushing - unless forcePush, since
                // this comparison is order-insensitive and a pure reorder looks
                // identical to "already synced" here (see this function's own
                // comment above).
                if (!forcePush && plan?.success && plan.alreadySynced) {
                    console.log("✅ User already synced");
                    synced++;
                    continue;
                }

                // Otherwise perform sync (reload already handled above if advanced)
                // The force reaches the push itself - see syncCredentialsAddons.
                const result = await syncUserAddons(
                    prisma,
                    uid,
                    [],
                    unsafeMode,
                    req,
                    decrypt,
                    getAccountId,
                    useCustomFields,
                    { force: forcePush }
                );
                if (result?.success) {
                    synced++;
                    console.log("✅ User now synced");
                } else {
                    failed++;
                }
            } catch {
                failed++;
            }
        }

        return {
            failedUsers: failed,
            groupId,
            message: `Group sync completed: ${synced}/${userIds.length} users synced`,
            reloadDiffs: reloadInfo?.diffsByAddon || [],
            syncedUsers: synced,
        };
    }

    // Get all groups
    router.get("/", async (req, res) => {
        try {
            const _whereScope =
                INSTANCE_TYPE === "public" && req.appAccountId
                    ? { accountId: req.appAccountId }
                    : {};
            const groups = await prisma.group.findMany({
                include: {
                    _count: { select: { addons: true } },
                    addons: { include: { addon: true } },
                },
                orderBy: [{ position: "asc" }, { id: "asc" }],
                where: scopedWhere(req, {}),
            });

            const transformedGroups = await Promise.all(
                groups.map(async (group) => {
                    // Count only active users from userIds array
                    let activeMemberCount = 0;
                    if (group.userIds) {
                        try {
                            const userIds = JSON.parse(group.userIds);
                            if (Array.isArray(userIds) && userIds.length > 0) {
                                const activeUsers = await prisma.user.findMany({
                                    select: { id: true },
                                    where: {
                                        accountId: getAccountId(req),
                                        id: { in: userIds },
                                        isActive: true,
                                    },
                                });
                                activeMemberCount = activeUsers.length;
                            }
                        } catch (e) {
                            console.error("Error parsing group userIds:", e);
                        }
                    }

                    // Count unique active addons scoped to this account (avoid duplicates across accounts)
                    const accountId = getAccountId(req);
                    const uniqActiveAddonIds = new Set(
                        (group.addons || [])
                            .filter(
                                (ga) =>
                                    ga?.addon &&
                                    ga.addon.isActive !== false &&
                                    (!accountId || ga.addon.accountId === accountId)
                            )
                            .map((ga) => ga.addon.id)
                    );

                    return {
                        // Activity visibility - 'public' or 'private'
                        activityVisibility: group.activityVisibility || "private",
                        addons: uniqActiveAddonIds.size,
                        avatarUrl: group.avatarUrl,
                        // Expose color index for UI
                        colorIndex: group.colorIndex ?? 0,
                        description: group.description,
                        id: group.id,
                        isActive: group.isActive,
                        name: group.name,
                        // Include userIds for SQLite compatibility
                        userIds: group.userIds,
                        users: activeMemberCount,
                    };
                })
            );

            res.json(transformedGroups);
        } catch (error) {
            console.error("Error fetching groups:", error);
            res.status(500).json({ message: "Failed to fetch groups" });
        }
    });

    // Create new group
    router.post("/", async (req, res) => {
        try {
            const { name, description, colorIndex } = req.body;

            // typeof first: a non-string (a number, an array) is truthy, so the
            // trim below used to throw and come back as a server error rather
            // than "that is not a name".
            if (typeof name !== "string" || !name.trim()) {
                return res.status(400).json({ message: "Group name is required" });
            }

            // Check if group with same name exists
            const existingGroup = await prisma.group.findFirst({
                where: {
                    name: name.trim(),
                    ...(INSTANCE_TYPE === "public" && req.appAccountId
                        ? { accountId: req.appAccountId }
                        : {}),
                },
            });

            if (existingGroup) {
                return res.status(400).json({ message: "Group with this name already exists" });
            }

            const newGroup = await prisma.group.create({
                data: {
                    accountId: getAccountId(req),
                    colorIndex: colorIndex ?? 0,
                    description: description || "",
                    name: name.trim(),
                },
            });

            res.status(201).json({
                addons: 0,
                avatarUrl: newGroup.avatarUrl ?? null,
                colorIndex: newGroup.colorIndex ?? 0,
                description: newGroup.description,
                id: newGroup.id,
                isActive: newGroup.isActive,
                name: newGroup.name,
                users: 0,
            });
        } catch (error) {
            console.error("Error creating group:", error);
            res.status(500).json({
                error: publicMessage(error, "Failed to create group"),
                message: "Failed to create group",
            });
        }
    });

    // Clone group
    router.post("/clone", async (req, res) => {
        try {
            const { originalGroupId } = req.body;

            if (!originalGroupId) {
                return res.status(400).json({ message: "Original group ID is required" });
            }

            // Find the original group
            const originalGroup = await prisma.group.findFirst({
                include: {
                    addons: { include: { addon: true } },
                },
                where: {
                    accountId: getAccountId(req),
                    id: originalGroupId,
                },
            });

            if (!originalGroup) {
                return responseUtils.notFound(res, "Original group");
            }

            // Create a clone with a modified name
            const clonedGroup = await prisma.group.create({
                data: {
                    accountId: getAccountId(req),
                    avatarUrl: originalGroup.avatarUrl ?? null,
                    colorIndex: originalGroup.colorIndex ?? 0,
                    description: originalGroup.description,
                    name: `${originalGroup.name} (Copy)`,
                },
            });

            // Clone addon associations
            if (originalGroup.addons && originalGroup.addons.length > 0) {
                const groupAddonData = originalGroup.addons.map((ga) => ({
                    addonId: ga.addonId,
                    groupId: clonedGroup.id,
                    isEnabled: ga.isEnabled,
                    position: ga.position ?? null,
                }));

                await prisma.groupAddon.createMany({
                    data: groupAddonData,
                });
            }

            res.json({
                group: {
                    addons: originalGroup.addons?.length || 0,
                    avatarUrl: clonedGroup.avatarUrl ?? null,
                    colorIndex: clonedGroup.colorIndex ?? 0,
                    description: clonedGroup.description,
                    id: clonedGroup.id,
                    isActive: clonedGroup.isActive,
                    name: clonedGroup.name,
                    users: 0,
                },
                message: "Group cloned successfully",
            });
        } catch (error) {
            console.error("Error cloning group:", error);
            res.status(500).json({
                error: publicMessage(error, "Failed to clone group"),
                message: "Failed to clone group",
            });
        }
    });

    // Reload addons for a group
    router.post("/:id/reload-addons", async (req, res) => {
        try {
            const { id: groupId } = req.params;

            const group = await prisma.group.findFirst({
                include: {
                    addons: { include: { addon: true } },
                },
                where: {
                    accountId: getAccountId(req),
                    id: groupId,
                },
            });

            if (!group) {
                return responseUtils.notFound(res, "Group");
            }

            // Use the shared reload group addons function
            const { reloadGroupAddons } = require("./users");
            const reloadResult = await reloadGroupAddons(
                prisma,
                getAccountId,
                group.id,
                req,
                decrypt
            );

            res.json({
                failedCount: reloadResult.failedCount,
                message: "Group addons reloaded successfully",
                reloadedCount: reloadResult.reloadedCount,
                total: reloadResult.total,
            });
        } catch (error) {
            console.error("Error reloading group addons:", error);
            res.status(500).json({
                error: publicMessage(error, "Failed to reload group addons"),
                message: "Failed to reload group addons",
            });
        }
    });

    // Find or create group
    router.post("/find-or-create", async (req, res) => {
        try {
            const { name } = req.body;

            // typeof first: a non-string (a number, an array) is truthy, so the
            // trim below used to throw and come back as a server error rather
            // than "that is not a name".
            if (typeof name !== "string" || !name.trim()) {
                return res.status(400).json({ message: "Group name is required" });
            }

            // Try to find existing group
            let group = await prisma.group.findFirst({
                where: {
                    accountId: getAccountId(req),
                    name: name.trim(),
                },
            });

            if (!group) {
                // Create new group if not found
                group = await prisma.group.create({
                    data: {
                        accountId: getAccountId(req),
                        colorIndex: 0,
                        description: "",
                        name: name.trim(),
                    },
                });
            }

            res.json({
                addons: 0,
                avatarUrl: group.avatarUrl,
                colorIndex: group.colorIndex ?? 0,
                description: group.description,
                id: group.id,
                isActive: group.isActive,
                name: group.name,
                users: 0,
            });
        } catch (error) {
            console.error("Error finding or creating group:", error);
            res.status(500).json({
                error: publicMessage(error, "Failed to find or create group"),
                message: "Failed to find or create group",
            });
        }
    });

    // Get group details with users and addons
    router.get("/:id", async (req, res) => {
        try {
            const { id } = req.params;
            const group = await findGroupById(prisma, id, getAccountId(req), {
                addons: {
                    include: { addon: true },
                },
            });
            if (!group) {
                return sendError(res, 404, "Group not found");
            }

            // Use shared helper to get ordered addons for this group
            const { getGroupAddons } = require("../utils/helpers");
            const filteredAddonsSorted = await getGroupAddons(prisma, id, req);

            // Note: manifest URLs are derived within helper per addon; no separate list needed here

            // Find users that belong to this group (SQLite approach) - only active users
            const userIds = group.userIds ? JSON.parse(group.userIds) : [];
            const dbUsers = await prisma.user.findMany({
                select: {
                    colorIndex: true,
                    email: true,
                    excludedAddons: true,
                    id: true,
                    lastSyncedAt: true,
                    username: true,
                },
                where: {
                    accountId: getAccountId(req),
                    id: { in: userIds },
                    isActive: true,
                },
            });

            const users = dbUsers.map((user) => ({
                colorIndex: user.colorIndex,
                email: user.email,
                excludedAddons: user.excludedAddons || [],
                id: user.id,
                // Field kept for UI compatibility; with private mode we no longer store per-user stremioAddons
                stremioAddonsCount: 0,
                username: user.username,
            }));
            // A group has no sync operation of its own to timestamp - syncing is per
            // user - so "when was this group last synced" is honestly answered by the
            // most recent sync among its members. null when nobody has synced yet,
            // which the UI renders as Never rather than inventing a date. This whole
            // field used to be the hardcoded string "Last sync: Unknown", which every
            // group displayed forever regardless of state.
            const memberSyncTimes = dbUsers
                .map((u) => u.lastSyncedAt)
                .filter(Boolean)
                .map((d) => new Date(d).getTime())
                .filter((t) => Number.isFinite(t));
            const lastSyncedAt = memberSyncTimes.length
                ? new Date(Math.max(...memberSyncTimes))
                : null;

            res.json({
                activityVisibility: group.activityVisibility || "private",
                addons: filteredAddonsSorted,
                avatarUrl: group.avatarUrl,
                colorIndex: group.colorIndex ?? 0,
                // Recovered from the cuid primary key: the Group model has no createdAt
                // column, and adding one would have stamped every existing group with
                // the migration date. See createdAtFromCuid.
                createdAt: createdAtFromCuid(group.id),
                description: group.description,
                id: group.id,
                isActive: group.isActive,
                lastSyncedAt,
                name: group.name,
                userIds: group.userIds,
                users,
            });
        } catch (error) {
            console.error("Error fetching group detail:", error);
            res.status(500).json({
                error: publicMessage(error, "Failed to fetch group detail"),
                message: "Failed to fetch group detail",
            });
        }
    });

    // GET /api/groups/:id/dashboard - per-group activity rollup: member list with
    // provider/addon info, addon-count and watch-time totals aggregated across the
    // group's members. Queries WatchActivity directly, scoped to this group's userIds.
    router.get("/:id/dashboard", async (req, res) => {
        try {
            const { id } = req.params;
            const accountId = getAccountId(req);
            const { period = "30d" } = req.query;

            const group = await findGroupById(prisma, id, accountId, {
                addons: { include: { addon: true }, where: { isEnabled: true } },
            });
            if (!group) {
                return sendError(res, 404, "Group not found");
            }

            let userIds = [];
            try {
                userIds = group.userIds ? JSON.parse(group.userIds) : [];
            } catch {
                // Malformed optional data leaves the existing fallback in place.
            }

            const members = await prisma.user.findMany({
                select: {
                    email: true,
                    expiresAt: true,
                    id: true,
                    isActive: true,
                    lastSyncedAt: true,
                    providerType: true,
                    syncStatus: true,
                    username: true,
                },
                where: { accountId, id: { in: userIds } },
            });

            // Watch-time rollup: sum WatchActivity deltas directly for this group's members
            // and period, rather than an account-wide metrics builder (which only surfaces
            // its top users — not reliable for a small group's full roster).
            const watchTimeByUser = {};
            try {
                let sinceDate = null;
                const now = new Date();
                if (period === "7d") {
                    sinceDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
                } else if (period === "30d") {
                    sinceDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
                } else if (period === "90d") {
                    sinceDate = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
                } else if (period === "1y") {
                    sinceDate = new Date(now.getTime() - 365 * 24 * 60 * 60 * 1000);
                }

                if (userIds.length > 0) {
                    const activity = await prisma.watchActivity.groupBy({
                        _sum: { watchTimeSeconds: true },
                        by: ["userId"],
                        where: {
                            accountId: accountId || "default",
                            userId: { in: userIds },
                            ...(sinceDate ? { date: { gte: sinceDate } } : {}),
                        },
                    });
                    for (const row of activity) {
                        const seconds = row._sum.watchTimeSeconds || 0;
                        watchTimeByUser[row.userId] = {
                            watchTimeHours: Math.round((seconds / 3600) * 100) / 100,
                            watchTimeSeconds: seconds,
                        };
                    }
                }
            } catch (e) {
                console.error("Dashboard: watch-time rollup failed:", e.message);
            }

            const memberRows = members.map((u) => ({
                email: u.email,
                expiresAt: u.expiresAt,
                id: u.id,
                isActive: u.isActive,
                lastSyncedAt: u.lastSyncedAt,
                provider: u.providerType,
                syncStatus: u.syncStatus,
                username: u.username,
                watchTime: watchTimeByUser[u.id] || null,
            }));

            res.json({
                addonCount: (group.addons || []).length,
                addons: (group.addons || []).map((ga) => ({
                    id: ga.addon.id,
                    name: ga.addon.name,
                    version: ga.addon.version,
                })),
                groupId: group.id,
                groupName: group.name,
                memberCount: memberRows.length,
                members: memberRows,
                period,
            });
        } catch (error) {
            console.error("Error building group dashboard:", error);
            res.status(500).json({
                error: publicMessage(error, "Failed to build group dashboard"),
                message: "Failed to build group dashboard",
            });
        }
    });

    // Update group fields and usership/addons
    router.put("/:id", async (req, res) => {
        const { id } = req.params;
        const { name, description, userIds, addonIds, colorIndex, avatarUrl, activityVisibility } =
            req.body;
        try {
            const group = await prisma.group.findFirst({
                include: {
                    addons: {
                        include: {
                            addon: true,
                        },
                    },
                },
                where: {
                    accountId: getAccountId(req),
                    id,
                },
            });
            if (!group) {
                return responseUtils.notFound(res, "Group");
            }

            // Update basic fields (ignore empty strings)
            const nextName = typeof name === "string" && name.trim() === "" ? undefined : name;
            const nextDesc =
                typeof description === "string" && description.trim() === ""
                    ? undefined
                    : description;
            const updateData = {
                description: nextDesc ?? group.description,
                name: nextName ?? group.name,
            };

            if (colorIndex !== undefined) {
                updateData.colorIndex = colorIndex;
            }

            if (avatarUrl !== undefined) {
                updateData.avatarUrl = avatarUrl || null;
            }

            // Update activity visibility if provided
            if (
                activityVisibility !== undefined &&
                ["public", "private"].includes(activityVisibility)
            ) {
                updateData.activityVisibility = activityVisibility;
            }

            await prisma.group.update({
                data: updateData,
                where: {
                    accountId: getAccountId(req),
                    id,
                },
            });

            // Invitations name their group rather than point at it, so a rename
            // carries over to them and to requests still waiting - otherwise the
            // next person to join lands in no group at all.
            if (updateData.name !== group.name) {
                const accountId = getAccountId(req);
                try {
                    await prisma.invitation.updateMany({
                        data: { groupName: updateData.name },
                        where: { accountId, groupName: group.name },
                    });
                    await prisma.inviteRequest.updateMany({
                        data: { groupName: updateData.name },
                        where: { accountId, groupName: group.name, status: "pending" },
                    });
                } catch (e) {
                    console.warn("[groups] invitations kept the old group name:", e?.message);
                }
            }

            // Sync users only if userIds is explicitly provided (SQLite approach).
            // The final list is worked out once and written once (see
            // setGroupMembers): emptying the group and adding people back one at a
            // time left it short in between, and let anyone added or removed in that
            // gap be lost. Ids that are not people of this account are dropped.
            if (userIds !== undefined) {
                const kept = await setGroupMembers(prisma, id, userIds, req);
                const asked = Array.isArray(userIds)
                    ? new Set(userIds.filter((u) => typeof u === "string" && u.trim() !== "")).size
                    : 0;
                if (kept.length < asked) {
                    console.warn(
                        `[groups] ${asked - kept.length} id(s) in the member list of group ${id} are not people of this account and were left out`
                    );
                }
            }

            // Sync addons only if addonIds is explicitly provided
            if (addonIds !== undefined) {
                const desiredAddonIds = Array.isArray(addonIds) ? addonIds : [];

                // Remove all existing addon associations
                await prisma.groupAddon.deleteMany({
                    where: { groupId: id },
                });

                // Add new addon associations
                if (desiredAddonIds.length > 0) {
                    await prisma.groupAddon.createMany({
                        data: desiredAddonIds.map((addonId, index) => ({
                            addonId,
                            groupId: id,
                            isEnabled: true,
                            position: index,
                        })),
                    });
                }
            }

            res.json({ message: "Group updated successfully" });
        } catch (error) {
            console.error("Error updating group:", error);
            res.status(500).json({
                error: publicMessage(error, "Failed to update group"),
                message: "Failed to update group",
            });
        }
    });

    // Delete a group (hard delete and detach users/addons)
    router.delete("/:id", async (req, res) => {
        try {
            const { id } = req.params;
            const existing = await prisma.group.findFirst({
                where: {
                    accountId: getAccountId(req),
                    id,
                },
            });
            if (!existing) {
                return responseUtils.notFound(res, "Group");
            }

            // Into the Trash first (30-day undo) - archive failure aborts the delete.
            await require("../utils/trash").archiveGroupDelete(prisma, getAccountId(req), id);

            await prisma.$transaction([
                // GroupMember model removed - using JSON arrays instead
                prisma.groupAddon.deleteMany({ where: { groupId: id } }),
                // ActivityLog model removed
                prisma.group.delete({
                    where: {
                        accountId: getAccountId(req),
                        id,
                    },
                }),
            ]);

            return res.json({ message: "Group deleted and users/addons detached" });
        } catch (error) {
            console.error("Error deleting group:", error);
            if (error.code === "P2025") {
                return responseUtils.notFound(res, "Group");
            }
            return res.status(500).json({
                error: publicMessage(error, "Failed to delete group"),
                message: "Failed to delete group",
            });
        }
    });

    // Remove user from group
    router.delete("/:groupId/users/:userId", async (req, res) => {
        try {
            const { groupId, userId } = req.params;
            const group = await prisma.group.findFirst({
                where: {
                    accountId: getAccountId(req),
                    id: groupId,
                },
            });

            if (!group) {
                return responseUtils.notFound(res, "Group");
            }

            // Parse current userIds and remove the specified user
            const currentUserIds = group.userIds ? JSON.parse(group.userIds) : [];
            const updatedUserIds = currentUserIds.filter((id) => id !== userId);

            // Only an actual removal is archived - removing someone who wasn't in
            // the group would otherwise leave a no-op undo entry in the Trash.
            if (updatedUserIds.length !== currentUserIds.length) {
                await require("../utils/trash").archiveMembershipRemoval(
                    prisma,
                    getAccountId(req),
                    groupId,
                    userId
                );
            }

            // Removed from the list as it is when the write happens, not the copy
            // read above, so someone added in between is not lost with it.
            await removeUserFromGroup(prisma, userId, groupId, req);

            res.json({ message: "User removed from group successfully" });
        } catch (error) {
            console.error("Error removing user from group:", error);
            res.status(500).json({
                error: publicMessage(error, "Failed to remove user from group"),
                message: "Failed to remove user from group",
            });
        }
    });

    // GET /groups/:id/watch-time - Get watch time statistics for a group
    router.get("/:id/watch-time", async (req, res) => {
        try {
            const { id: groupId } = req.params;
            const { period = "30d", startDate: queryStartDate, endDate: queryEndDate } = req.query;

            const accountId = getAccountId(req);
            const group = await prisma.group.findFirst({
                select: { id: true, name: true, userIds: true },
                where: { accountId, id: groupId },
            });

            if (!group) {
                return responseUtils.notFound(res, "Group");
            }

            // Resolve userIds
            let userIds = [];
            try {
                userIds = Array.isArray(group.userIds)
                    ? group.userIds
                    : JSON.parse(group.userIds || "[]");
            } catch (e) {
                console.error("Error parsing group userIds:", e);
            }

            if (userIds.length === 0) {
                return res.json({ byDate: [], users: {} });
            }

            // Calculate date range
            let start = new Date();
            let end = new Date();

            if (queryStartDate && queryEndDate) {
                start = new Date(queryStartDate);
                end = new Date(queryEndDate);
            } else {
                // Use period logic if no explicit dates
                switch (period) {
                    case "1h":
                        start.setHours(start.getHours() - 1);
                        break;
                    case "24h":
                        start.setHours(start.getHours() - 24);
                        break;
                    case "7d":
                        start.setDate(start.getDate() - 7);
                        break;
                    case "30d":
                        start.setDate(start.getDate() - 30);
                        break;
                    case "90d":
                        start.setDate(start.getDate() - 90);
                        break;
                    case "1y":
                        start.setFullYear(start.getFullYear() - 1);
                        break;
                    default:
                        start.setDate(start.getDate() - 30);
                }
            }

            // Fetch watch activity for all users in group
            const activities = await prisma.watchActivity.findMany({
                orderBy: { date: "asc" },
                select: {
                    date: true,
                    itemType: true,
                    userId: true,
                    watchTimeSeconds: true,
                },
                where: {
                    accountId,
                    date: {
                        gte: start,
                        lte: end,
                    },
                    userId: { in: userIds },
                },
            });

            // Get user details for names/colors
            const users = await prisma.user.findMany({
                select: { colorIndex: true, email: true, id: true, username: true },
                where: { id: { in: userIds } },
            });
            const _userMap = new Map(users.map((u) => [u.id, u]));

            // Aggregate data
            const byDate = new Map(); // date -> { date, totalMinutes, users: { userId: minutes }, userItems: { userId: count }, content: { movies: count, series: count } }

            for (const activity of activities) {
                const date = new Date(activity.date).toISOString().split("T")[0];
                if (!byDate.has(date)) {
                    byDate.set(date, {
                        content: { movies: 0, series: 0 },
                        date,
                        totalMinutes: 0,
                        userItems: {},
                        users: {},
                    });
                }

                const entry = byDate.get(date);
                const minutes = Math.round((activity.watchTimeSeconds || 0) / 60);

                entry.totalMinutes += minutes;

                // Per-user watch time
                if (!entry.users[activity.userId]) {
                    entry.users[activity.userId] = 0;
                }
                entry.users[activity.userId] += minutes;

                // Per-user item count
                if (!entry.userItems[activity.userId]) {
                    entry.userItems[activity.userId] = 0;
                }
                entry.userItems[activity.userId] += 1;

                // Content breakdown (count activities)
                if (activity.itemType === "movie") {
                    entry.content.movies += 1;
                } else if (activity.itemType === "series") {
                    entry.content.series += 1;
                }
            }

            // Format response
            const result = Array.from(byDate.values()).sort((a, b) => a.date.localeCompare(b.date));

            // Return user metadata too so frontend can map IDs to names/colors
            const userMeta = users.reduce((acc, u) => {
                acc[u.id] = { colorIndex: u.colorIndex, name: u.username || u.email };
                return acc;
            }, {});

            res.json({
                byDate: result,
                users: userMeta,
            });
        } catch (error) {
            console.error("Error fetching group watch time:", error);
            res.status(500).json({
                error: publicMessage(error, "Failed to fetch group watch time"),
                message: "Failed to fetch group watch time",
            });
        }
    });

    // Reorder addons in group (by manifest URL order) and sync users
    router.post("/:id/addons/reorder", async (req, res) => {
        console.log("🔵 REORDER ENDPOINT HIT:", {
            body: req.body,
            groupId: req.params.id,
            orderedAddonIds: req.body?.orderedAddonIds,
            orderedManifestUrls: req.body?.orderedManifestUrls,
        });
        // Read before the try, not inside it. The catch at the bottom reports
        // which group and which order were being applied, and both were declared
        // in here - so a failed reorder threw a second time inside its own error
        // handler, losing the real reason in favour of a generic failure.
        const { id: groupId } = req.params;
        const { orderedManifestUrls, orderedAddonIds } = req.body || {};
        // Support both orderedManifestUrls (legacy) and orderedAddonIds (new)
        const orderedIds = orderedAddonIds || orderedManifestUrls;
        try {
            if (!Array.isArray(orderedIds) || orderedIds.length === 0) {
                return res
                    .status(400)
                    .json({ message: "orderedAddonIds or orderedManifestUrls array is required" });
            }

            // Ensure group exists and is scoped to the account
            const group = await prisma.group.findFirst({
                where: { accountId: getAccountId(req), id: groupId },
            });
            if (!group) {
                return responseUtils.notFound(res, "Group");
            }

            console.log(`[Reorder] Group found: ${group.name} (${group.id})`);

            // Fetch GroupAddon records separately to be safe
            const allGroupAddons = await prisma.groupAddon.findMany({
                include: { addon: true },
                where: { groupId },
            });

            const validGroupAddons = allGroupAddons.filter((ga) => ga.addon !== null);
            console.log(
                `[Reorder] Found ${allGroupAddons.length} GA records, ${validGroupAddons.length} have valid addons.`
            );

            // Build a map of addon ID to GroupAddon record for efficient lookup
            const addonIdToGroupAddon = new Map();

            for (const ga of validGroupAddons) {
                const aId = String(ga.addon.id);
                const gaId = String(ga.addonId);
                const recordId = String(ga.id);

                console.log(
                    `[Reorder] Mapping: Addon=${ga.addon.name}, AddonID=${aId}, GA.addonId=${gaId}, RecordID=${recordId}`
                );

                addonIdToGroupAddon.set(aId, ga);
                addonIdToGroupAddon.set(gaId, ga);
                addonIdToGroupAddon.set(recordId, ga); // Also map by the GroupAddon record ID just in case
            }

            const normalizedOrderedIds = orderedIds.map((id) => String(id).trim()).filter(Boolean);
            console.log("[Reorder] Target IDs:", normalizedOrderedIds);

            // Use a transaction for reordering to ensure atomicity
            await prisma.$transaction(async (tx) => {
                let pos = 0;
                for (const addonId of normalizedOrderedIds) {
                    console.log(`[Reorder] Processing item ${pos}: ${addonId}`);

                    let ga = addonIdToGroupAddon.get(addonId);

                    // Exhaustive search if not found in map
                    if (!ga) {
                        console.log(`[Reorder] ${addonId} not in map, searching values...`);
                        ga = Array.from(addonIdToGroupAddon.values()).find(
                            (g) =>
                                String(g.addonId) === addonId ||
                                String(g.addon?.id) === addonId ||
                                String(g.id) === addonId
                        );
                    }

                    if (!ga) {
                        const availableIds = Array.from(addonIdToGroupAddon.keys()).join(", ");
                        const errorMsg = `Addon ${addonId} not found in this group. Available IDs: ${availableIds}`;
                        console.error(`❌ ${errorMsg}`);
                        const err = new Error(errorMsg);
                        err.code = "ADDON_NOT_FOUND";
                        throw err;
                    }

                    console.log(
                        `[Reorder] Updating ${ga.addon.name} (GA:${ga.id}) to position ${pos}`
                    );
                    await tx.groupAddon.update({
                        data: { position: pos++ },
                        where: { id: ga.id },
                    });
                }
            });

            // After reordering, push the new order down to every user in this
            // group - forcePush because the addon *set* hasn't changed, only its
            // order, and the normal alreadySynced check can't tell that apart from
            // a no-op (see syncGroupUsers's own comment).
            console.log(`[Reorder] Success. Triggering group sync for ${groupId}`);
            syncGroupUsers(groupId, req, { forcePush: true }).catch((e) =>
                console.error("Post-reorder group sync failed:", e.message)
            );

            res.json({
                groupId,
                message: "Addons reordered successfully",
                reorderedCount: orderedIds.length,
            });
        } catch (error) {
            console.error("Error reordering addons:", error.message);

            const isNotFound =
                error.code === "P2025" ||
                error.code === "ADDON_NOT_FOUND" ||
                error.message.includes("not found");
            const status = isNotFound ? 404 : 500;

            return res.status(status).json({
                details: {
                    groupId,
                    orderedIds,
                },
                error: error.code || "INTERNAL_ERROR",
                message: publicMessage(error, "Failed to reorder addons"),
            });
        }
    });

    // Alias route for compatibility: accept either orderedManifestUrls or addonIds
    router.post("/:id/reorder-addons", async (req, res) => {
        try {
            const { id: groupId } = req.params;
            const { orderedManifestUrls, addonIds, orderedAddonIds } = req.body || {};

            // Use orderedAddonIds first, then orderedManifestUrls, then addonIds
            const orderedIds =
                orderedAddonIds ||
                (Array.isArray(orderedManifestUrls) && orderedManifestUrls.length > 0
                    ? orderedManifestUrls
                    : Array.isArray(addonIds)
                      ? addonIds
                      : []);

            if (!Array.isArray(orderedIds) || orderedIds.length === 0) {
                return res
                    .status(400)
                    .json({ message: "orderedAddonIds or orderedManifestUrls array is required" });
            }

            // Ensure group exists and is scoped to the account
            const group = await prisma.group.findFirst({
                where: { accountId: getAccountId(req), id: groupId },
            });
            if (!group) {
                return responseUtils.notFound(res, "Group");
            }

            console.log(`[Reorder-Alias] Group found: ${group.name} (${group.id})`);

            // Fetch GroupAddon records separately
            const allGroupAddons = await prisma.groupAddon.findMany({
                include: { addon: true },
                where: { groupId },
            });

            const validGroupAddons = allGroupAddons.filter((ga) => ga.addon !== null);

            // Build lookup map
            const addonIdToGroupAddon = new Map();
            for (const ga of validGroupAddons) {
                addonIdToGroupAddon.set(String(ga.addon.id), ga);
                addonIdToGroupAddon.set(String(ga.addonId), ga);
                addonIdToGroupAddon.set(String(ga.id), ga);
            }

            const normalizedOrderedIds = orderedIds.map((id) => String(id).trim()).filter(Boolean);

            // Persist order
            try {
                let pos = 0;
                for (const addonId of normalizedOrderedIds) {
                    let ga = addonIdToGroupAddon.get(addonId);
                    if (!ga) {
                        // Exhaustive search
                        ga = Array.from(addonIdToGroupAddon.values()).find(
                            (g) => String(g.addonId) === addonId || String(g.addon?.id) === addonId
                        );
                    }

                    if (!ga) {
                        continue; // Skip missing in alias route for better compatibility
                    }

                    await prisma.groupAddon.update({
                        data: { position: pos++ },
                        where: { id: ga.id },
                    });
                }
            } catch (e) {
                console.error("[Reorder-Alias] Order persistence failed:", e.message);
            }

            res.json({
                groupId,
                message: "Addons reordered successfully",
                reorderedCount: orderedIds.length,
            });
        } catch (error) {
            console.error("[Reorder-Alias] Error reordering addons:", error.message);
            res.status(500).json({
                error: publicMessage(error, "Failed to reorder addons"),
                message: "Failed to reorder addons",
            });
        }
    });

    // Add user to group
    router.post("/:groupId/users/:userId", async (req, res) => {
        try {
            const { groupId, userId } = req.params;

            // Naming an id that is not on this account is a request problem, not
            // a server one: it used to reach assignUserToGroup, throw there, and
            // come back as 500 Internal server error for what is simply a wrong id.
            const [groupRow, userRow] = await Promise.all([
                prisma.group.findFirst({
                    select: { id: true },
                    where: { accountId: getAccountId(req), id: groupId },
                }),
                prisma.user.findFirst({
                    select: { id: true },
                    where: { accountId: getAccountId(req), id: userId },
                }),
            ]);
            if (!groupRow) {
                return responseUtils.notFound(res, "Group");
            }
            if (!userRow) {
                return responseUtils.notFound(res, "User");
            }

            // Use the assignUserToGroup function to handle the assignment
            await assignUserToGroup(prisma, userId, groupId, req);

            res.json({ message: "User added to group successfully" });
        } catch (error) {
            console.error("Error adding user to group:", error);
            res.status(500).json({
                error: publicMessage(error, "Failed to add user to group"),
                message: "Failed to add user to group",
            });
        }
    });

    // Add addon to group
    router.post("/:groupId/addons/:addonId", async (req, res) => {
        try {
            const { groupId, addonId } = req.params;

            // Check if group exists
            const group = await prisma.group.findFirst({
                where: {
                    accountId: getAccountId(req),
                    id: groupId,
                },
            });

            if (!group) {
                return responseUtils.notFound(res, "Group");
            }

            // Check if addon exists
            const addon = await prisma.addon.findFirst({
                where: {
                    accountId: getAccountId(req),
                    id: addonId,
                },
            });

            if (!addon) {
                return responseUtils.notFound(res, "Addon");
            }

            // If relation already exists by addonId, return idempotently
            const existingById = await prisma.groupAddon.findUnique({
                where: {
                    groupId_addonId: { addonId, groupId },
                },
            });
            if (existingById) {
                return res.json({ addonId, groupId, message: "Addon already in group" });
            }

            // Add addon to group at bottom (no URL-based replacement)
            await prisma.$transaction(async (tx) => {
                const maxPosition = await tx.groupAddon.aggregate({
                    _max: { position: true },
                    where: { groupId },
                });
                const nextPosition = (maxPosition._max.position ?? -1) + 1;

                await tx.groupAddon.create({
                    data: {
                        addonId,
                        groupId,
                        isEnabled: true,
                        position: nextPosition,
                    },
                });

                console.log(`🔢 Added addon to group ${groupId} at position ${nextPosition}`);
            });

            res.json({ message: "Addon added to group successfully" });
        } catch (error) {
            console.error("Error adding addon to group:", error);
            res.status(500).json({
                error: publicMessage(error, "Failed to add addon to group"),
                message: "Failed to add addon to group",
            });
        }
    });

    // Remove addon from group
    router.delete("/:groupId/addons/:addonId", async (req, res) => {
        try {
            const { groupId, addonId } = req.params;

            // Check if group exists
            const group = await prisma.group.findFirst({
                where: {
                    accountId: getAccountId(req),
                    id: groupId,
                },
            });

            if (!group) {
                return responseUtils.notFound(res, "Group");
            }

            // Find and remove the group-addon relationship
            const groupAddon = await prisma.groupAddon.findFirst({
                where: {
                    addonId,
                    groupId,
                },
            });

            if (!groupAddon) {
                return responseUtils.notFound(res, "Addon in this group");
            }

            await prisma.groupAddon.delete({
                where: {
                    groupId_addonId: {
                        addonId,
                        groupId,
                    },
                },
            });

            res.json({ message: "Addon removed from group successfully" });
        } catch (error) {
            console.error("Error removing addon from group:", error);
            res.status(500).json({
                error: publicMessage(error, "Failed to remove addon from group"),
                message: "Failed to remove addon from group",
            });
        }
    });

    // Enable group
    router.put("/:id/enable", async (req, res) => {
        try {
            const { id } = req.params;

            const group = await prisma.group.findFirst({
                where: {
                    accountId: getAccountId(req),
                    id,
                },
            });

            if (!group) {
                return responseUtils.notFound(res, "Group");
            }

            await prisma.group.update({
                data: { isActive: true },
                where: {
                    accountId: getAccountId(req),
                    id,
                },
            });

            res.json({ message: "Group enabled successfully" });
        } catch (error) {
            console.error("Error enabling group:", error);
            res.status(500).json({
                error: publicMessage(error, "Failed to enable group"),
                message: "Failed to enable group",
            });
        }
    });

    // Disable group
    router.put("/:id/disable", async (req, res) => {
        try {
            const { id } = req.params;

            const group = await prisma.group.findFirst({
                where: {
                    accountId: getAccountId(req),
                    id,
                },
            });

            if (!group) {
                return responseUtils.notFound(res, "Group");
            }

            await prisma.group.update({
                data: { isActive: false },
                where: {
                    accountId: getAccountId(req),
                    id,
                },
            });

            res.json({ message: "Group disabled successfully" });
        } catch (error) {
            console.error("Error disabling group:", error);
            res.status(500).json({
                error: publicMessage(error, "Failed to disable group"),
                message: "Failed to disable group",
            });
        }
    });

    // Sync group - iterate users in this group and call the shared user sync function
    router.post("/:id/sync", async (req, res) => {
        try {
            const { id: groupId } = req.params;
            const result = await syncGroupUsers(groupId, req);
            if (result?.error) {
                return responseUtils.notFound(res, "Group");
            }
            return res.json(result);
        } catch (error) {
            console.error("Error syncing group:", error);
            res.status(500).json({
                error: publicMessage(error, "Failed to sync group"),
                message: "Failed to sync group",
            });
        }
    });

    // Group sync-status: aggregate user statuses via shared getUserSyncStatus
    router.get("/:id/sync-status", async (req, res) => {
        try {
            const { id } = req.params;
            const group = await prisma.group.findFirst({
                include: { addons: { include: { addon: true } } },
                where: { accountId: getAccountId(req), id },
            });
            if (!group) {
                return responseUtils.notFound(res, "Group");
            }

            // Resolve userIds JSON
            let _userIds = [];
            try {
                _userIds = Array.isArray(group.userIds)
                    ? group.userIds
                    : JSON.parse(group.userIds || "[]");
            } catch {
                // Malformed optional data leaves the existing fallback in place.
            }

            const { createGetGroupSyncStatus } = require("../utils/sync");
            const getGroupSyncStatus = createGetGroupSyncStatus({
                canonicalizeManifestUrl,
                // Missing here meant getUserAddons() fell back to its Stremio-only
                // legacy path (checks user.stremioAuthKey directly, ignores Nuvio
                // credentials entirely) for every member checked through this
                // endpoint - confirmed real case: a Nuvio-only user came back
                // "User not connected to Stremio" here while the per-user
                // /users/:id/sync-status route (which does pass this) correctly
                // recognized the same user as synced. This endpoint went from
                // dead code to actually being called by SyncBadge.tsx without this
                // gap ever being exercised until now.
                createProvider,
                decrypt,
                getAccountId,
                getDecryptedManifestUrl: (addon) => addon?.manifestUrl,
                parseAddonIds,
                parseProtectedAddons,
                prisma,
                StremioAPIClient,
            });

            const aggregated = await getGroupSyncStatus(id, req);
            if (aggregated?.error) {
                return res.status(404).json({ message: aggregated.error });
            }
            res.json(aggregated);
        } catch (error) {
            console.error("Error fetching group sync status:", error);
            res.status(500).json({ message: "Failed to fetch group sync status" });
        }
    });

    // Reorder addons in group (by manifest URL order) and sync users
    // Simple health probe for groups router
    router.get("/health", (_req, res) => res.json({ ok: true }));

    // Update user's excluded addons
    router.put("/:groupId/users/:userId/excluded-addons", async (req, res) => {
        try {
            const { groupId, userId } = req.params;
            const { excludedAddons } = req.body;

            // Check if group exists
            const group = await prisma.group.findFirst({
                where: {
                    accountId: getAccountId(req),
                    id: groupId,
                },
            });

            if (!group) {
                return responseUtils.notFound(res, "Group");
            }

            // Check if user exists
            const user = await prisma.user.findFirst({
                where: {
                    accountId: getAccountId(req),
                    id: userId,
                },
            });

            if (!user) {
                return res.status(404).json({ message: "User not found" });
            }

            // Update user's excluded addons
            await prisma.user.update({
                data: {
                    excludedAddons: Array.isArray(excludedAddons)
                        ? JSON.stringify(excludedAddons)
                        : null,
                },
                where: { id: userId },
            });

            res.json({ message: "Excluded addons updated successfully" });
        } catch (error) {
            console.error("Error updating excluded addons:", error);
            res.status(500).json({
                error: publicMessage(error, "Failed to update excluded addons"),
                message: "Failed to update excluded addons",
            });
        }
    });

    // Toggle group status
    router.patch("/:id/toggle-status", async (req, res) => {
        try {
            const { id } = req.params;
            const { isActive } = req.body;

            // Update group status
            const updatedGroup = await prisma.group.update({
                data: { isActive },
                include: {
                    addons: {
                        include: {
                            addon: true,
                        },
                    },
                },
                where: {
                    accountId: getAccountId(req),
                    id,
                },
            });

            res.json(updatedGroup);
        } catch (error) {
            console.error("Error toggling group status:", error);
            res.status(500).json({
                details: publicMessage(error, "Failed to toggle group status"),
                error: "Failed to toggle group status",
            });
        }
    });

    // Update activity visibility for a group
    router.patch("/:id/activity-visibility", async (req, res) => {
        try {
            const { id } = req.params;
            const { activityVisibility } = req.body;

            if (!(activityVisibility && ["public", "private"].includes(activityVisibility))) {
                return res.status(400).json({
                    error: 'Invalid activityVisibility value. Must be "public" or "private".',
                });
            }

            const group = await prisma.group.findFirst({
                where: {
                    accountId: getAccountId(req),
                    id,
                },
            });

            if (!group) {
                return responseUtils.notFound(res, "Group");
            }

            const updatedGroup = await prisma.group.update({
                data: { activityVisibility },
                where: {
                    accountId: getAccountId(req),
                    id,
                },
            });

            res.json({
                activityVisibility: updatedGroup.activityVisibility,
                message: `Activity visibility set to ${activityVisibility}`,
            });
        } catch (error) {
            console.error("Error updating activity visibility:", error);
            res.status(500).json({
                details: publicMessage(error, "Failed to update activity visibility"),
                error: "Failed to update activity visibility",
            });
        }
    });

    // Get group addons directly
    router.get("/:id/addons", async (req, res) => {
        try {
            const { id } = req.params;
            const group = await findGroupById(prisma, id, getAccountId(req));
            if (!group) {
                return sendError(res, 404, "Group not found");
            }

            // Use shared helper to get ordered addons for this group
            const { getGroupAddons } = require("../utils/helpers");
            const filteredAddonsSorted = await getGroupAddons(prisma, id, req);

            res.json({ addons: filteredAddonsSorted });
        } catch (error) {
            console.error("Error fetching group addons:", error);
            res.status(500).json({
                error: publicMessage(error, "Failed to fetch group addons"),
                message: "Failed to fetch group addons",
            });
        }
    });

    // Sync all groups
    router.post("/sync-all", async (req, res) => {
        try {
            const groups = await prisma.group.findMany({
                select: { id: true },
                where: scopedWhere(req, {}),
            });

            if (groups.length === 0) {
                return res.json({
                    failedGroups: 0,
                    message: "No groups found to sync",
                    syncedGroups: 0,
                    totalGroups: 0,
                });
            }

            let syncedGroups = 0;
            let failedGroups = 0;
            let totalUsersSynced = 0;
            let totalUsersFailed = 0;

            for (const group of groups) {
                try {
                    const result = await syncGroupUsers(group.id, req);
                    if (result?.error) {
                        failedGroups++;
                    } else {
                        syncedGroups++;
                        totalUsersSynced += result.syncedUsers || 0;
                        totalUsersFailed += result.failedUsers || 0;
                        console.log(result.message);
                    }
                } catch (error) {
                    console.error(`Failed to sync group ${group.id}:`, error);
                    failedGroups++;
                }
            }

            res.json({
                failedGroups,
                message: `Synced ${syncedGroups} groups successfully, ${failedGroups} failed. Total users: ${totalUsersSynced} synced, ${totalUsersFailed} failed`,
                syncedGroups,
                totalGroups: groups.length,
                totalUsersFailed,
                totalUsersSynced,
            });
        } catch (error) {
            console.error("Error syncing all groups:", error);
            res.status(500).json({
                error: publicMessage(error, "Failed to sync all groups"),
                message: "Failed to sync all groups",
            });
        }
    });
    // Exportable helper to sync one group's users (used by scheduler)
    async function externalSyncGroupUsers(
        prismaDep,
        getAccountIdDep,
        _scopedWhereDep,
        decryptDep,
        groupId,
        reqDep
    ) {
        // Load group
        const group = await prismaDep.group.findFirst({
            select: { id: true, name: true, userIds: true },
            where: { accountId: getAccountIdDep(reqDep), id: groupId },
        });
        if (!group) {
            return { error: "Group not found", groupId };
        }
        // Parse users
        let userIds = [];
        try {
            userIds = Array.isArray(group.userIds)
                ? group.userIds
                : JSON.parse(group.userIds || "[]");
        } catch {
            // Malformed optional data leaves the existing fallback in place.
        }
        const uniqueUserIds = [...new Set(userIds)];
        // Mode/unsafe/useCustomFields: prefer DB account sync config; fallback to request header/body
        let syncMode = "normal";
        let unsafeMode = false;
        let useCustomFields = true;
        try {
            const accountId = reqDep.appAccountId;
            if (accountId) {
                const acc = await prismaDep.appAccount.findUnique({
                    select: { sync: true },
                    where: { id: accountId },
                });
                let cfg = acc?.sync || null;
                if (cfg && typeof cfg === "string") {
                    try {
                        cfg = JSON.parse(cfg);
                    } catch {
                        cfg = null;
                    }
                }
                if (cfg && typeof cfg === "object") {
                    syncMode = cfg.mode === "advanced" ? "advanced" : "normal";
                    unsafeMode = typeof cfg.safe === "boolean" ? !cfg.safe : !!cfg.unsafe;
                    if (typeof cfg.useCustomFields === "boolean") {
                        useCustomFields = cfg.useCustomFields;
                    } else if (typeof cfg.useCustomNames === "boolean") {
                        // Backward compatibility: migrate old useCustomNames to useCustomFields
                        useCustomFields = cfg.useCustomNames;
                    } else {
                        useCustomFields = true;
                    }
                }
            }
        } catch {
            // Malformed optional data leaves the existing fallback in place.
        }
        if (!syncMode) {
            syncMode = "normal";
        }
        // Final fallback to request if DB not present
        if (!reqDep.appAccountId) {
            const headerMode = (reqDep.headers?.["x-sync-mode"] || "").toString().toLowerCase();
            syncMode = headerMode === "advanced" ? "advanced" : "normal";
            unsafeMode = reqDep.body?.unsafe === true;
        }
        // Log before any reload
        console.log(`\nSyncing group ${group.name || groupId}`);
        // Advanced: reload and capture diffs
        let reloadInfo = null;
        if (syncMode === "advanced") {
            const { reloadGroupAddons } = require("./users");
            try {
                reloadInfo = await reloadGroupAddons(
                    prismaDep,
                    getAccountIdDep,
                    groupId,
                    reqDep,
                    decryptDep
                );
            } catch {
                // Unavailable optional records leave the current result in place.
            }
        }
        // Sync users
        const { syncUserAddons } = require("./users");
        let synced = 0,
            failed = 0;
        for (const uid of uniqueUserIds) {
            try {
                const r = await syncUserAddons(
                    prismaDep,
                    uid,
                    [],
                    unsafeMode,
                    reqDep,
                    decryptDep,
                    getAccountIdDep,
                    useCustomFields
                );
                if (r?.success) {
                    synced++;
                } else {
                    failed++;
                }
            } catch {
                failed++;
            }
        }
        return {
            failedUsers: failed,
            groupId,
            reloadDiffs: reloadInfo?.diffsByAddon || [],
            syncedUsers: synced,
        };
    }

    // Attach export
    module.exports.syncGroupUsers = externalSyncGroupUsers;
    // Also attach to the returned router instance for factory consumers
    router.syncGroupUsers = externalSyncGroupUsers;

    return router;
};
