/**
 * Consolidated error handling that replaces both middleware and utils error handlers
 */

/**
 * Handle all types of errors consistently
 */
function handleError(error, _req, res, _next) {
    console.error("Error:", error);

    // Prisma errors
    if (error.code === "P2002") {
        const field = error.meta?.target?.[0];
        return res.status(409).json({
            error: `This ${field || "field"} is already in use`,
            message: `${field || "Field"} already exists`,
        });
    }

    if (error.code === "P2025") {
        return res.status(404).json({
            error: "The requested resource does not exist",
            message: "Record not found",
        });
    }

    // Stremio API errors
    if (error?.response?.data?.code === 2) {
        return res.status(401).json({
            error: "No Stremio account found with this email. Please register first or check your credentials.",
            message: "User not found",
        });
    }

    if (error?.response?.data?.code === 3) {
        return res.status(401).json({
            error: "Incorrect password for this Stremio account.",
            message: "Invalid password",
        });
    }

    if (error?.response?.data?.code === 26) {
        return res.status(400).json({
            error: "Please enter a valid email address",
            message: "Invalid email address",
        });
    }

    // Handle other Stremio API errors
    if (error?.response?.data?.message) {
        return res.status(400).json({
            error: "Stremio authentication failed",
            message: error.response.data.message,
        });
    }

    // Network errors
    if (error.message?.includes("Network") || error.code === "ENOTFOUND") {
        return res.status(503).json({
            error: "Please check your internet connection and try again",
            message: "Unable to connect to Stremio servers",
        });
    }

    // Authentication errors
    if (error.message === "User not found") {
        return res.status(401).json({
            error: "User not found (check email)",
            message: "Invalid Stremio credentials",
        });
    }

    if (error.code === 3 || error.wrongPass || error.message?.includes("Wrong passphrase")) {
        return res.status(401).json({
            error: "Wrong email or password",
            message: "Invalid Stremio credentials",
        });
    }

    if (
        error.message?.includes("Authentication failed") ||
        error.message?.includes("Wrong passphrase")
    ) {
        return res.status(401).json({
            error: error.message,
            message: "Invalid Stremio credentials",
        });
    }

    // Validation errors
    if (error.isJoi) {
        return res.status(400).json({
            error: error.details.map((detail) => detail.message).join(", "),
            message: "Validation error",
        });
    }

    // JWT errors
    if (error.name === "JsonWebTokenError") {
        return res.status(401).json({
            error: "Authentication token is invalid",
            message: "Invalid token",
        });
    }

    if (error.name === "TokenExpiredError") {
        return res.status(401).json({
            error: "Authentication token has expired",
            message: "Token expired",
        });
    }

    // Default error
    res.status(error.status || 500).json({
        message: error.message || "Internal server error",
        ...(process.env.NODE_ENV === "development" && { stack: error.stack }),
    });
}

/**
 * Legacy function for backward compatibility
 */
function handleStremioError(error, res) {
    return handleError(error, null, res, null);
}

/**
 * Legacy function for backward compatibility
 */
function handleDatabaseError(error, res, context = "operation") {
    console.error(`Database error during ${context}:`, error);
    return handleError(error, null, res, null);
}

/**
 * Standardized error response format
 */
function sendError(res, statusCode, message, error = null) {
    const response = { message };
    if (error) {
        response.error = error;
    }
    return res.status(statusCode).json(response);
}

module.exports = {
    handleDatabaseError,
    handleError,
    handleStremioError,
    sendError,
};
