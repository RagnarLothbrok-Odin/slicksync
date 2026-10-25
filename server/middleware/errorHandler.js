const { handleError } = require("../utils/handlers");

const errorHandler = (err, req, res, next) => handleError(err, req, res, next);

module.exports = { errorHandler };
