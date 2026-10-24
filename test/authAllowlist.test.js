const test = require("node:test");
const assert = require("node:assert/strict");
const { pathIsAllowlisted, pathNeedsLiveAccount } = require("../server/utils/auth");

test("without a login, /api/health answers health checks only; its other routes stay gated", () => {
    assert.equal(pathIsAllowlisted("/api/health/build"), true);
    assert.equal(pathIsAllowlisted("/health"), true);
    // Reachable for health checks, but answers only "ok" without a login.
    assert.equal(pathIsAllowlisted("/api/health"), true);
    assert.equal(pathIsAllowlisted("/api/healthz"), false);
    assert.equal(pathIsAllowlisted("/api/health/proxy-ignore"), false);
});

test("an entry matches its own path and what sits below it, never a sibling that starts the same way", () => {
    for (const path of [
        "/api/auth/login",
        "/api/auth/login/",
        "/api/public-auth/private-login",
        "/api/ext",
        "/api/ext/account",
        "/api/ext/",
        "/invite",
        "/invite/abc123/check",
        "/api/superadmin",
        "/api/superadmin/login",
        "/api/public-library/user-info",
        "/api/qr",
        "/api/qr/",
        "/api/migration/bundle",
        "/health",
        "/health/",
        "/api/health/build",
        "/api/health/build/",
    ]) {
        assert.equal(pathIsAllowlisted(path), true, path);
    }
    for (const path of [
        "/api/auth/login-x",
        "/api/auth/login-reset",
        "/api/auth/loginx",
        "/api/auth/me",
        "/api/extra",
        "/api/ext-admin",
        "/invitexyz",
        "/invitations",
        "/api/superadmins",
        "/api/public-librarian",
        "/api/qrcode",
        "/api/migration/bundles",
        "/api/migration/offer",
        "/healthz",
        "/api/health/buildx",
        "/api/health/build-info",
    ]) {
        assert.equal(pathIsAllowlisted(path), false, path);
    }
});

test("the open-ended prefixes stay open-ended", () => {
    // Stremio and Nuvio fetch these with no session; the token in the URL is the credential.
    for (const path of [
        "/proxy/abc/manifest.json",
        "/trax/abc/manifest.json",
        "/stream/abc",
        "/api/federation/catalog/abc",
        "/api/public-auth/jellyfin-probe",
        "/api/public-auth/jellyfin-quick-connect-status",
        "/api/auth/jellyfin-login",
    ]) {
        assert.equal(pathIsAllowlisted(path), true, path);
    }
    for (const path of [
        "/proxy",
        "/trax",
        "/stream",
        "/streamx",
        "/proxyx/abc",
        "/api/federation",
        "/api/federation/publish",
        "/api/public-auth/jellyfin",
        "/api/public-auth/jellyfinx",
    ]) {
        assert.equal(pathIsAllowlisted(path), false, path);
    }
});

test("the router prefix of public-auth is not open, only its sign-in routes", () => {
    for (const path of [
        "/api/public-auth/login",
        "/api/public-auth/verify-2fa",
        "/api/public-auth/passkey/options",
        "/api/public-auth/passkey/verify",
        "/api/public-auth/oidc/config",
        "/api/public-auth/oidc/callback",
    ]) {
        assert.equal(pathIsAllowlisted(path), true, path);
    }
    for (const path of [
        "/api/public-auth",
        "/api/public-auth/me",
        "/api/public-auth/logout",
        "/api/public-auth/config-export",
        "/api/public-auth/passkey/register",
        "/api/public-auth/suggest-uuid",
    ]) {
        assert.equal(pathIsAllowlisted(path), false, path);
    }
});

test("the shared stats link and the stream route answer without a login, and nothing beside them does", () => {
    assert.equal(pathIsAllowlisted("/api/users/public-stats/abc123"), true);
    assert.equal(pathIsAllowlisted("/stream/abc123"), true);
    assert.equal(pathIsAllowlisted("/api/users/public-statsx"), false);
    assert.equal(pathIsAllowlisted("/api/users/public-stats"), false);
    assert.equal(pathIsAllowlisted("/api/users"), false);
    assert.equal(pathIsAllowlisted("/api/users/123"), false);
    assert.equal(pathIsAllowlisted("/api/users/123/public-stats/abc"), false);
});

test("a path that is not a string is never open", () => {
    for (const path of [undefined, null, 42, {}, ["/api/ext"]]) {
        assert.equal(pathIsAllowlisted(path), false);
    }
});

test("only the paths that answer from a session itself need the account to be live", () => {
    for (const path of [
        "/api/ext",
        "/api/ext/",
        "/api/ext/account",
        "/api/ext/groups/sync",
        "/api/health",
        "/api/health/",
    ]) {
        assert.equal(pathNeedsLiveAccount(path), true, path);
    }
    // Sign-in and the rest of the open paths must never be blocked by a disabled account's cookie.
    for (const path of [
        "/api/public-auth/login",
        "/api/auth/private-login",
        "/api/superadmin/login",
        "/api/health/build",
        "/api/health/proxy-ignore",
        "/api/extra",
        "/api/public-library/user-info",
        "/invite/abc/check",
        "/proxy/abc/manifest.json",
        "/api/users/public-stats/abc",
        "/stream/abc",
    ]) {
        assert.equal(pathNeedsLiveAccount(path), false, path);
    }
    assert.equal(pathNeedsLiveAccount(undefined), false);
});
