// Phase 2 Admin Analytics - Addon Performance & Server Health
// These functions extend the admin dashboard with operational insights

const fs = require("node:fs").promises;
const path = require("node:path");

/**
 * Calculate addon performance analytics
 * Tracks usage, errors, and popularity across the server
 */
async function calculateAddonAnalytics(prisma, accountId) {
    // Get all addons for this account
    const addons = await prisma.addon.findMany({
        include: {
            groupAddons: {
                include: {
                    group: true,
                },
            },
        },
        where: { accountId },
    });

    // Calculate usage statistics
    const addonStats = addons.map((addon) => {
        const enabledGroups = addon.groupAddons.filter((ga) => ga.isEnabled);
        const totalGroups = addon.groupAddons.length;

        // Count unique users across all groups
        const userIds = new Set();
        enabledGroups.forEach((ga) => {
            if (ga.group.userIds) {
                try {
                    const ids = JSON.parse(ga.group.userIds);
                    ids.forEach((id) => userIds.add(id));
                } catch {
                    // Invalid JSON, skip
                }
            }
        });

        return {
            catalogs: addon.catalogs ? JSON.parse(addon.catalogs) : [],
            enabledGroups: enabledGroups.length,
            iconUrl: addon.iconUrl,
            id: addon.id,
            isActive: addon.isActive,
            manifestUrl: addon.manifestUrl,
            name: addon.name,
            // Parse resources for display
            resources: addon.resources ? JSON.parse(addon.resources) : [],
            totalGroups,
            usageRate: totalGroups > 0 ? Math.round((enabledGroups.length / totalGroups) * 100) : 0,
            userCount: userIds.size,
        };
    });

    // Sort by user count (popularity)
    const sortedByUsage = addonStats.sort((a, b) => b.userCount - a.userCount);

    return {
        activeAddons: addons.filter((a) => a.isActive).length,
        byResource: calculateResourceBreakdown(addonStats),
        topAddons: sortedByUsage.slice(0, 10),
        totalAddons: addons.length,
        underutilized: sortedByUsage.filter((a) => a.usageRate < 50 && a.totalGroups > 0),
    };
}

/**
 * Calculate resource breakdown (streams, catalogs, metadata, etc.)
 */
function calculateResourceBreakdown(addonStats) {
    const resources = {};

    addonStats.forEach((addon) => {
        if (addon.resources && Array.isArray(addon.resources)) {
            addon.resources.forEach((resource) => {
                resources[resource] = (resources[resource] || 0) + 1;
            });
        }
    });

    return Object.entries(resources)
        .sort(([, a], [, b]) => b - a)
        .map(([name, count]) => ({ count, name }));
}

/**
 * Calculate server health metrics
 * Monitors sync status, storage, and system health
 */
async function calculateServerHealth(prisma, accountId) {
    const health = {
        checks: {},
        metrics: {},
        status: "healthy", // healthy, warning, critical
    };

    // 1. Check sync queue (users needing library sync)
    try {
        const usersNeedingSync = await prisma.user.count({
            where: {
                accountId,
                isActive: true,
                OR: [{ stremioAuthKey: { not: null } }],
            },
        });

        // Estimate based on last activity
        const staleUsers = await prisma.watchSession.groupBy({
            _max: {
                startTime: true,
            },
            by: ["userId"],
            where: {
                accountId: accountId || "default",
                startTime: {
                    lt: new Date(Date.now() - 24 * 60 * 60 * 1000), // Not active in last 24h
                },
            },
        });

        health.checks.syncQueue = {
            message:
                staleUsers.length > 10
                    ? `${staleUsers.length} users need library sync`
                    : "Sync queue is healthy",
            staleUsers: staleUsers.length,
            status: staleUsers.length > 10 ? "warning" : "healthy",
            totalUsers: usersNeedingSync,
        };

        if (staleUsers.length > 20) {
            health.status = "warning";
        }
    } catch {
        health.checks.syncQueue = {
            message: "Unable to check sync queue",
            status: "unknown",
        };
    }

    // 2. Check storage utilization - scoped to this account's own cache
    // subdirectory (CACHE_DIR/account-{accountId}/, see libraryCache.js),
    // not the shared parent directory. In public multi-tenant mode that
    // parent holds every tenant's cache side by side - walking it
    // unscoped would show one tenant's admin the storage/file-count
    // footprint of every OTHER tenant on the shared instance too.
    try {
        const dataDir = path.join(
            process.cwd(),
            "data",
            "libraries",
            `account-${accountId || "default"}`
        );
        let storageSize = 0;
        let fileCount = 0;

        try {
            const stats = await fs.stat(dataDir);
            if (stats.isDirectory()) {
                const files = await fs.readdir(dataDir, { recursive: true });
                for (const file of files) {
                    const filePath = path.join(dataDir, file);
                    try {
                        const fileStat = await fs.stat(filePath);
                        if (fileStat.isFile()) {
                            storageSize += fileStat.size;
                            fileCount++;
                        }
                    } catch {
                        // Skip files we can't access
                    }
                }
            }
        } catch {
            // Directory might not exist
        }

        const sizeInMB = Math.round(storageSize / (1024 * 1024));

        health.checks.storage = {
            fileCount,
            message:
                sizeInMB > 500
                    ? `Library cache using ${sizeInMB}MB`
                    : `Storage healthy (${sizeInMB}MB)`,
            sizeMB: sizeInMB,
            status: sizeInMB > 500 ? "warning" : "healthy",
        };

        if (sizeInMB > 1000) {
            health.status = "warning";
        }
    } catch {
        health.checks.storage = {
            message: "Unable to check storage",
            status: "unknown",
        };
    }

    // 3. Check database connectivity
    try {
        await prisma.$queryRaw`SELECT 1`;
        health.checks.database = {
            message: "Database connection OK",
            status: "healthy",
        };
    } catch {
        health.checks.database = {
            message: "Database connection failed",
            status: "critical",
        };
        health.status = "critical";
    }

    // 4. Check user activity metrics
    try {
        const now = new Date();
        const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);

        const activeSessions = await prisma.watchSession.count({
            where: {
                accountId: accountId || "default",
                isActive: true,
                updatedAt: {
                    gte: oneHourAgo,
                },
            },
        });

        health.metrics.activeSessions = activeSessions;
        health.metrics.serverTime = now.toISOString();

        health.checks.activity = {
            activeSessions,
            message: `${activeSessions} active viewing sessions`,
            status: "healthy",
        };
    } catch {
        health.checks.activity = {
            message: "Unable to check activity",
            status: "unknown",
        };
    }

    return health;
}

/**
 * Generate operational alerts based on health checks
 */
function generateOperationalAlerts(health, addonAnalytics) {
    const alerts = [];

    // Critical alerts
    if (health.checks.database?.status === "critical") {
        alerts.push({
            message: "Database connection failed - immediate attention required",
            severity: "critical",
            type: "database_down",
        });
    }

    // Warning alerts
    if (health.checks.syncQueue?.status === "warning") {
        alerts.push({
            count: health.checks.syncQueue.staleUsers,
            message: health.checks.syncQueue.message,
            severity: "warning",
            type: "sync_queue_high",
        });
    }

    if (health.checks.storage?.status === "warning") {
        alerts.push({
            message: health.checks.storage.message,
            severity: "warning",
            sizeMB: health.checks.storage.sizeMB,
            type: "storage_high",
        });
    }

    // Addon alerts
    if (addonAnalytics.underutilized.length > 0) {
        alerts.push({
            addons: addonAnalytics.underutilized.slice(0, 3).map((a) => a.name),
            count: addonAnalytics.underutilized.length,
            message: `${addonAnalytics.underutilized.length} addons are underutilized (< 50% usage)`,
            severity: "info",
            type: "underutilized_addons",
        });
    }

    return alerts;
}

module.exports = {
    calculateAddonAnalytics,
    calculateServerHealth,
    generateOperationalAlerts,
};
