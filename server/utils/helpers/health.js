/**
 * Centralized health check functionality
 */

const serverStartTime = new Date().toISOString();

/**
 * Get comprehensive health status
 */
async function getHealthStatus(prisma) {
    try {
        // Test database connection
        await prisma.$queryRaw`SELECT 1`;

        // Get basic counts
        const [userCount, addonCount, groupCount] = await Promise.all([
            prisma.user.count(),
            prisma.addon.count(),
            prisma.group.count(),
        ]);

        return {
            addons: addonCount,
            database: "connected",
            groups: groupCount,
            message: "SlickSync with Database",
            serverStartTime,
            status: "OK",
            timestamp: new Date().toISOString(),
            uptime: process.uptime(),
            users: userCount,
        };
    } catch (error) {
        return {
            database: "disconnected",
            error: error.message,
            message: "Database connection failed",
            serverStartTime,
            status: "ERROR",
            timestamp: new Date().toISOString(),
            uptime: process.uptime(),
        };
    }
}

/**
 * Create health check endpoint handler
 */
function createHealthCheckHandler(prisma) {
    return async (_req, res) => {
        const healthStatus = await getHealthStatus(prisma);
        const statusCode = healthStatus.status === "OK" ? 200 : 503;
        res.status(statusCode).json(healthStatus);
    };
}

module.exports = {
    createHealthCheckHandler,
    getHealthStatus,
};
