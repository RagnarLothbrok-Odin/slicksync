/**
 * Utility functions for server routes to reduce duplication
 */

/**
 * Validate that an entity exists and return it
 */
const validateEntityExists = async (prisma, entityType, id, accountId) => {
    const entity = await prisma[entityType].findUnique({
        where: {
            accountId,
            id,
        },
    });

    if (!entity) {
        throw new Error(`${entityType} not found`);
    }

    return entity;
};

/**
 * Standardized error responses
 */
const sendNotFound = (res, entityType) =>
    res.status(404).json({ message: `${entityType} not found` });

const sendBadRequest = (res, message) => res.status(400).json({ message });

const sendInternalError = (res, message = "Internal server error") =>
    res.status(500).json({ message });

/**
 * Common route handlers with error handling
 */
const createRouteHandler = (handler) => async (req, res) => {
    try {
        await handler(req, res);
    } catch (error) {
        console.error("Route error:", error);

        if (error.message.includes("not found")) {
            const entityType = error.message.split(" ")[0];
            return sendNotFound(res, entityType);
        }

        if (error.message.includes("already exists")) {
            return sendBadRequest(res, error.message);
        }

        return sendInternalError(res, error.message);
    }
};

/**
 * Entity validation middleware
 */
// Takes prisma rather than reaching for one that was never in this file. As
// written it referenced a free variable, so the first request through it would
// have thrown - nothing wires it up today, which is the only reason that has
// not been noticed. Matches validateEntityExists below, which already asks for
// its client the same way.
const validateEntity = (prisma, entityType) => async (req, res, next) => {
    try {
        const { id } = req.params;
        const accountId = req.appAccountId || req.accountId;

        if (!id) {
            return sendBadRequest(res, `${entityType} ID is required`);
        }

        const entity = await validateEntityExists(prisma, entityType, id, accountId);
        req.entity = entity;
        next();
    } catch (error) {
        if (error.message.includes("not found")) {
            return sendNotFound(res, entityType);
        }
        return sendInternalError(res, error.message);
    }
};

/**
 * Common response patterns
 */
const responseUtils = {
    badRequest: (res, message) => sendBadRequest(res, message),

    created: (res, data, message) =>
        res.status(201).json({
            data,
            message,
            success: true,
        }),

    internalError: (res, message) => sendInternalError(res, message),

    notFound: (res, entityType) => sendNotFound(res, entityType),
    success: (res, data, message) =>
        res.json({
            data,
            message,
            success: true,
        }),
};

/**
 * Common validation functions
 */
const validationUtils = {
    validateEmail: (email) => {
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(email)) {
            throw new Error("Invalid email address");
        }
    },

    validateId: (id) => {
        if (!id || typeof id !== "string" || id.trim() === "") {
            throw new Error("Invalid ID provided");
        }
    },
    validateRequired: (fields, req) => {
        const missing = fields.filter((field) => !req.body[field]);
        if (missing.length > 0) {
            throw new Error(`Missing required fields: ${missing.join(", ")}`);
        }
    },
};

/**
 * Common database operations
 */
const dbUtils = {
    deleteEntity: async (prisma, entityType, id, accountId) =>
        await prisma[entityType].delete({
            where: { accountId, id },
        }),
    findEntity: async (prisma, entityType, id, accountId) =>
        await prisma[entityType].findUnique({
            where: { accountId, id },
        }),

    findEntityWithRelations: async (prisma, entityType, id, accountId, include = {}) =>
        await prisma[entityType].findUnique({
            include,
            where: { accountId, id },
        }),

    updateEntity: async (prisma, entityType, id, data, accountId) =>
        await prisma[entityType].update({
            data,
            where: { accountId, id },
        }),
};

module.exports = {
    createRouteHandler,
    dbUtils,
    responseUtils,
    sendBadRequest,
    sendInternalError,
    sendNotFound,
    validateEntity,
    validateEntityExists,
    validationUtils,
};
