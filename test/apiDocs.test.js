const assert = require("node:assert/strict");
const test = require("node:test");
const express = require("express");
const createApiDocs = require("../server/routes/apiDocs");
const { pathIsAllowlisted } = require("../server/utils/auth");

test("API docs serve the bare page and assets without a slash redirect loop", async () => {
    const app = express();
    app.use((_req, res, next) => {
        res.setHeader("Content-Security-Policy", "default-src 'self'");
        next();
    });
    app.use("/api/docs", createApiDocs());
    const server = app.listen(0, "127.0.0.1");
    await new Promise((resolve) => server.once("listening", resolve));
    try {
        const base = `http://127.0.0.1:${server.address().port}`;
        for (const suffix of ["", "/"]) {
            const response = await fetch(`${base}/api/docs${suffix}`, { redirect: "manual" });
            assert.equal(response.status, 200);
            assert.equal(response.headers.get("content-security-policy"), null);
            const html = await response.text();
            assert.ok(html.includes('<base href="/api/docs/">'));
            assert.ok(html.includes("swagger-ui-init.js"));
        }
        for (const file of ["swagger-ui.css", "swagger-ui-bundle.js", "swagger-ui-init.js"]) {
            const response = await fetch(`${base}/api/docs/${file}`);
            assert.equal(response.status, 200);
            assert.ok((await response.text()).length > 100);
        }
    } finally {
        server.closeAllConnections();
        await new Promise((resolve, reject) =>
            server.close((error) => (error ? reject(error) : resolve()))
        );
    }
});

test("API documentation allowlisting stops at its path boundary", () => {
    assert.equal(pathIsAllowlisted("/api/docs"), true);
    assert.equal(pathIsAllowlisted("/api/docs/swagger-ui.css"), true);
    assert.equal(pathIsAllowlisted("/api/docsevil"), false);
    assert.equal(pathIsAllowlisted("/api/settings/account-info"), false);
});
