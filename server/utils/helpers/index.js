/**
 * Helper utilities - Perform specific tasks and return data
 */

const {
    findUserById,
    findGroupById,
    findAddonById,
    getAllUsers,
    getAllGroups,
    getAllAddons,
    isUserActive,
    isGroupActive,
    getUserGroups,
    getGroupUsers,
    getAccountId,
    scopedWhere,
    getGroupAddons,
    assignUserToGroup,
} = require("./database");

const {
    isValidEmail,
    isValidPassword,
    sanitizeUrl,
    validateRequiredFields,
    validateStremioCredentials,
    hasPermission,
    validateAccountContext,
    createValidationMiddleware,
} = require("./validation");

const { getHealthStatus, createHealthCheckHandler } = require("./health");
const {
    createMulterInstance,
    standardUpload,
    largeFileUpload,
    anyFileUpload,
    imageUpload,
} = require("./multer");
const { resetAccountData, safeResetAccountData } = require("./accountReset");
const {
    createStremioClient,
    createStremioStore,
    validateStremioAuthKey,
    createStremioAPI,
} = require("./stremio");

module.exports = {
    anyFileUpload,
    assignUserToGroup,
    createHealthCheckHandler,

    // Multer helpers
    createMulterInstance,
    createStremioAPI,

    // Stremio API helpers
    createStremioClient,
    createStremioStore,
    createValidationMiddleware,
    findAddonById,
    findGroupById,
    // Database helpers
    findUserById,
    getAccountId,
    getAllAddons,
    getAllGroups,
    getAllUsers,
    getGroupAddons,
    getGroupUsers,

    // Health helpers
    getHealthStatus,
    getUserGroups,
    hasPermission,
    imageUpload,
    isGroupActive,
    isUserActive,

    // Validation helpers
    isValidEmail,
    isValidPassword,
    largeFileUpload,

    // Account reset helpers
    resetAccountData,
    safeResetAccountData,
    sanitizeUrl,
    scopedWhere,
    standardUpload,
    validateAccountContext,
    validateRequiredFields,
    validateStremioAuthKey,
    validateStremioCredentials,
};
