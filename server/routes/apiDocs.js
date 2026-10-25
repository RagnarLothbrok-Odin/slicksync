const express = require("express");
const swaggerUi = require("swagger-ui-express");
const openapiSpec = require("../utils/openapi");

module.exports = () => {
    const router = express.Router();
    // Swagger's bootstrap uses inline scripts; relax CSP only on the docs surface.
    router.use((_req, res, next) => {
        res.removeHeader("Content-Security-Policy");
        next();
    });
    // Handle the page before express.static can redirect its directory URL.
    // An explicit base keeps assets under /api/docs even without a trailing slash,
    // which Next normalizes away on requests through the frontend.
    router.get("/", (_req, res) => {
        const html = swaggerUi.generateHTML(openapiSpec, { customSiteTitle: "SlickSync API" });
        res.send(html.replace("<head>", '<head><base href="/api/docs/">'));
    });
    router.use(swaggerUi.serveFiles(openapiSpec, {}));
    return router;
};
