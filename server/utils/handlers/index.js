/**
 * Handler utilities - Process requests and generate responses
 */

const {
    handleError,
    handleStremioError,
    handleDatabaseError,
    sendError,
} = require("./errorHandler");
const { createRouteHandler, DatabaseTransactions, StremioAPIUtils } = require("./routeHandler");

module.exports = {
    // Route handling
    createRouteHandler,
    DatabaseTransactions,
    handleDatabaseError,
    // Error handling
    handleError,
    handleStremioError,
    StremioAPIUtils,
    sendError,
};
