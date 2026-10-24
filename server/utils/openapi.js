// Interactive docs for the external developer API (server/routes/externalApi.js,
// mounted at /api/ext - the only part of SlickSync meant for third-party
// callers, per API.md). Internal admin routes (addons/groups/users/etc.) are
// consumed only by SlickSync's own frontend and aren't part of this surface.
//
// The spec is built from @openapi JSDoc blocks living directly above each
// route handler in externalApi.js, not a hand-maintained YAML file kept
// separately - so the docs stay next to (and in sync with) the code they
// describe, the same reasoning that keeps API.md itself checked into the
// repo rather than living on a wiki.
const swaggerJsdoc = require("swagger-jsdoc");
const path = require("node:path");

const spec = swaggerJsdoc({
    apis: [path.join(require("node:path").dirname(module.filename), "../routes/externalApi.js")],
    definition: {
        components: {
            securitySchemes: {
                ApiKeyAuth: {
                    description:
                        "Generate a key in Settings on this instance, then paste it here (Authorize button) to try requests live.",
                    scheme: "bearer",
                    type: "http",
                },
            },
        },
        info: {
            description:
                "The `/api/ext` surface - for addon developers to trigger a reload/sync on this SlickSync instance when their addon updates. See API.md in the repo for the same reference in Markdown.",
            title: "SlickSync External API",
            version: require("../../package.json").version,
        },
        openapi: "3.0.3",
        security: [{ ApiKeyAuth: [] }],
        servers: [{ url: "/api/ext" }],
    },
});

module.exports = spec;
