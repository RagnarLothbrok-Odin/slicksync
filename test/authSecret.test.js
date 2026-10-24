const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const jwt = require("jsonwebtoken");

// What a fresh install of this repository would sign with before the secret
// was made per install. It is public in the source, so nothing may accept it.
const PUBLIC_PLACEHOLDER = "slicksync-dev-secret-change-me";

// This process: its own signing secret and its own encryption key, so nothing
// here depends on, or writes into, the machine's data folder.
const OWN_SECRET = "unit-test-signing-secret-not-for-use";
process.env.JWT_SECRET = OWN_SECRET;
process.env.ENCRYPTION_KEY = "unit-test-encryption-key-not-for-use-0123456789";
delete process.env.INSTANCE_TYPE;
delete process.env.INSTANCE;

const REPO = path.resolve(require("node:path").dirname(module.filename), "..");
const CONFIG = path.join(REPO, "server", "utils", "config.js");
const AUTH = path.join(REPO, "server", "utils", "auth.js");

// Runs `body` in a fresh process (so config.js loads from scratch) with exactly
// the environment given, from a working directory of its own, and returns what
// it printed on the RESULT line plus the raw output.
function inFreshProcess({ env = {}, cwd, body }) {
    const clean = { ...process.env };
    for (const k of ["JWT_SECRET", "ENCRYPTION_KEY", "INSTANCE_TYPE", "INSTANCE", "NODE_ENV"]) {
        delete clean[k];
    }
    const script = `const out = (v) => console.log('RESULT:' + JSON.stringify(v)); ${body}`;
    const r = spawnSync(process.execPath, ["-e", script], {
        cwd,
        encoding: "utf8",
        env: { ...clean, ...env },
    });
    assert.equal(r.status, 0, `child failed: ${r.stderr}`);
    const line = r.stdout.split(/\r?\n/).find((l) => l.startsWith("RESULT:"));
    return {
        stderr: r.stderr,
        stdout: r.stdout,
        value: line ? JSON.parse(line.slice("RESULT:".length)) : null,
    };
}

function scratchDir(t) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "slick-auth-"));
    t.after(() => fs.rmSync(dir, { force: true, recursive: true }));
    return dir;
}

const secretOf = (opts) =>
    inFreshProcess({ ...opts, body: `out(require(${JSON.stringify(CONFIG)}).JWT_SECRET)` });

// ---------------------------------------------------------------- the choice

const { resolveJwtSecret } = require("../server/utils/config");
const KEY_A = Buffer.alloc(32, 7);
const KEY_B = Buffer.alloc(32, 9);

test("a JWT_SECRET the install set itself is used exactly as given, so its sessions stay valid", () => {
    for (const own of [
        "x",
        "short",
        "a-long-secret-that-someone-generated-with-openssl-0123456789",
        " spaced secret ",
        "temp-jwt-secret-key",
    ]) {
        const r = resolveJwtSecret({ encryptionKey: KEY_A, envSecret: own });
        assert.equal(r.secret, own);
        assert.equal(r.source, "env");
    }
});

test("with no usable JWT_SECRET the secret comes from the encryption key, never from the public placeholder", () => {
    const expected = crypto
        .createHmac("sha256", KEY_A)
        .update("slicksync-jwt-secret-v1")
        .digest("hex");
    for (const envSecret of [
        undefined,
        null,
        "",
        "   ",
        PUBLIC_PLACEHOLDER,
        `  ${PUBLIC_PLACEHOLDER}\n`,
    ]) {
        const r = resolveJwtSecret({ encryptionKey: KEY_A, envSecret });
        assert.equal(r.source, "derived", String(envSecret));
        assert.equal(r.secret, expected);
        assert.notEqual(r.secret, PUBLIC_PLACEHOLDER);
    }
});

test("the derived secret is stable for one install and different for another", () => {
    const a1 = resolveJwtSecret({ encryptionKey: KEY_A }).secret;
    const a2 = resolveJwtSecret({ encryptionKey: Buffer.from(KEY_A) }).secret;
    const b = resolveJwtSecret({ encryptionKey: KEY_B }).secret;
    assert.equal(a1, a2);
    assert.notEqual(a1, b);
    assert.equal(a1.length, 64);
    // It is a one-way function of the key: the key itself is not in it.
    assert.ok(!a1.includes(KEY_A.toString("hex")));
    assert.ok(!a1.includes(KEY_A.toString("base64")));
});

test("with no encryption key at all it is random for this run, and still not the placeholder", () => {
    const seen = new Set();
    for (const encryptionKey of [undefined, null, Buffer.alloc(0)]) {
        const r = resolveJwtSecret({ encryptionKey, envSecret: "" });
        assert.equal(r.source, "random");
        assert.notEqual(r.secret, PUBLIC_PLACEHOLDER);
        assert.ok(r.secret.length >= 64);
        seen.add(r.secret);
    }
    assert.equal(seen.size, 3);
});

// --------------------------------------------------------- config.js, loaded

test("config.js: an install that sets JWT_SECRET signs with it, and logs nothing about it", (t) => {
    const r = inFreshProcess({
        body: `out(require(${JSON.stringify(CONFIG)}).JWT_SECRET)`,
        cwd: scratchDir(t),
        env: { ENCRYPTION_KEY: "k".repeat(40), JWT_SECRET: "my-own-secret" },
    });
    assert.equal(r.value, "my-own-secret");
    assert.ok(!r.stdout.includes("[auth]"));
});

test("config.js: without JWT_SECRET it derives one from ENCRYPTION_KEY, the same on every start", (t) => {
    const cwd = scratchDir(t);
    const env = { ENCRYPTION_KEY: "a".repeat(40) };
    const first = secretOf({ cwd, env });
    const second = secretOf({ cwd, env });
    assert.equal(first.value, second.value);
    assert.notEqual(first.value, PUBLIC_PLACEHOLDER);
    assert.equal(first.value.length, 64);
    // A different install (different key) gets a different secret.
    assert.notEqual(secretOf({ cwd, env: { ENCRYPTION_KEY: "b".repeat(40) } }).value, first.value);
});

test("config.js: one line at start-up says the derived secret is in use, and never prints it", (t) => {
    const r = secretOf({ cwd: scratchDir(t), env: { ENCRYPTION_KEY: "a".repeat(40) } });
    const lines = r.stdout.split(/\r?\n/).filter((l) => l.includes("[auth]"));
    assert.equal(lines.length, 1);
    assert.match(lines[0], /JWT_SECRET is not set/);
    // (the RESULT line is the test's own readout of the secret, not a log line)
    const logged = r.stdout
        .split(/\r?\n/)
        .filter((l) => !l.startsWith("RESULT:"))
        .join("\n");
    assert.ok(!logged.includes(r.value));
    assert.ok(!r.stderr.includes(r.value));
});

test("config.js: the placeholder from the source counts as no secret at all", (t) => {
    const cwd = scratchDir(t);
    const env = { ENCRYPTION_KEY: "a".repeat(40) };
    const unset = secretOf({ cwd, env });
    const placeholder = secretOf({ cwd, env: { ...env, JWT_SECRET: PUBLIC_PLACEHOLDER } });
    assert.equal(placeholder.value, unset.value);
    assert.match(placeholder.stdout, /placeholder/);
});

test("config.js: with neither JWT_SECRET nor ENCRYPTION_KEY the key is generated once, kept on disk, and the secret follows it across restarts", (t) => {
    const cwd = scratchDir(t);
    const first = secretOf({ cwd });
    assert.ok(fs.existsSync(path.join(cwd, "data", "server_secret.key")));
    const second = secretOf({ cwd });
    assert.equal(first.value, second.value);
    assert.notEqual(first.value, PUBLIC_PLACEHOLDER);
    // A different install generates a different key, so a different secret.
    assert.notEqual(secretOf({ cwd: scratchDir(t) }).value, first.value);
});

test("utils/auth.js can be loaded without touching config or the data folder; signing is what brings the secret in", (t) => {
    const r = inFreshProcess({
        body: `
      const auth = require(${JSON.stringify(AUTH)});
      const configLoaded = () => Object.keys(require.cache).some((k) => /utils[\\\\/]config\\.js$/.test(k));
      const before = { config: configLoaded(), data: require('fs').existsSync('data') };
      auth.issueAccessToken('acc1');
      out({ before, configLoadedAfterSigning: configLoaded() });
    `,
        cwd: scratchDir(t),
    });
    assert.deepEqual(r.value, {
        before: { config: false, data: false },
        configLoadedAfterSigning: true,
    });
});

// ------------------------------------------------------------------- tokens

const {
    issueAccessToken,
    issueRefreshToken,
    checkAccountClaims,
    verifyAccountToken,
} = require("../server/utils/auth");

test("tokens signed with the public placeholder are refused once the install has its own secret", () => {
    const forgedAccount = jwt.sign({ accId: "default", typ: "access" }, PUBLIC_PLACEHOLDER, {
        expiresIn: "1d",
    });
    const forgedSuper = jwt.sign({ typ: "superadmin" }, PUBLIC_PLACEHOLDER, { expiresIn: "1d" });
    assert.throws(() => verifyAccountToken(forgedAccount, ["access"]), /invalid signature/);
    assert.throws(() => jwt.verify(forgedSuper, OWN_SECRET), /invalid signature/);
});

test("tokens signed with the derived secret (no JWT_SECRET set) are refused if forged with the placeholder", (t) => {
    const cwd = scratchDir(t);
    const forged = jwt.sign({ accId: "default", typ: "access" }, PUBLIC_PLACEHOLDER, {
        expiresIn: "1d",
    });
    const r = inFreshProcess({
        body: `
      const auth = require(${JSON.stringify(AUTH)});
      let forgedAccepted = false;
      try { auth.verifyAccountToken(${JSON.stringify(forged)}, ['access']); forgedAccepted = true } catch {}
      const own = auth.issueAccessToken('acc1');
      out({ forgedAccepted, ownAccId: auth.verifyAccountToken(own, ['access']).accId });
    `,
        cwd,
        env: { ENCRYPTION_KEY: "a".repeat(40) },
    });
    assert.deepEqual(r.value, { forgedAccepted: false, ownAccId: "acc1" });
});

test("what the server issues round-trips in its own slot and is refused in the other", () => {
    const at = issueAccessToken("acc1");
    const rt = issueRefreshToken("acc1");
    assert.equal(verifyAccountToken(at, ["access"]).accId, "acc1");
    assert.equal(verifyAccountToken(rt, ["refresh"]).accId, "acc1");
    assert.throws(() => verifyAccountToken(rt, ["access"]), /wrong token type/);
    assert.throws(() => verifyAccountToken(at, ["refresh"]), /wrong token type/);
    // Where the code takes whichever cookie is left, either one will do.
    assert.equal(verifyAccountToken(at).accId, "acc1");
    assert.equal(verifyAccountToken(rt, ["access", "refresh"]).accId, "acc1");
    assert.equal(jwt.decode(at).typ, "access");
    assert.equal(jwt.decode(rt).typ, "refresh");
});

test("a session token from before the type claim existed still works in either slot", () => {
    const legacy = jwt.sign({ accId: "acc1" }, OWN_SECRET, { expiresIn: "1d" });
    assert.equal(verifyAccountToken(legacy, ["access"]).accId, "acc1");
    assert.equal(verifyAccountToken(legacy, ["refresh"]).accId, "acc1");
});

test("a superadmin session, a portal session or a pending-2FA token never passes for an account", () => {
    const sign = (claims) => jwt.sign(claims, OWN_SECRET, { expiresIn: "1d" });
    const notAccounts = {
        emptyAccId: sign({ accId: "", typ: "access" }),
        jellyfinPortal: sign({ provider: "jellyfin", sub: "user1" }),
        numericAccId: sign({ accId: 7, typ: "access" }),
        nuvioPortal: sign({ provider: "nuvio", sub: "user1" }),
        pending2fa: sign({ accId: "acc1", typ: "pending-2fa" }),
        superadmin: sign({ typ: "superadmin" }),
        // Even with an accId claim, the wrong type is refused.
        superadminWithAccId: sign({ accId: "acc1", typ: "superadmin" }),
    };
    for (const [name, token] of Object.entries(notAccounts)) {
        for (const kinds of [["access"], ["refresh"], ["access", "refresh"]]) {
            assert.throws(
                () => verifyAccountToken(token, kinds),
                /not an account token|wrong token type/,
                `${name} in ${kinds}`
            );
        }
    }
    assert.throws(() => checkAccountClaims(null), /not an account token/);
    assert.throws(() => checkAccountClaims("acc1"), /not an account token/);
});

test("an expired or tampered token is refused", () => {
    const expired = jwt.sign({ accId: "acc1", typ: "access" }, OWN_SECRET, { expiresIn: -10 });
    assert.throws(() => verifyAccountToken(expired, ["access"]), /expired/);
    const good = issueAccessToken("acc1");
    const [h, _p, s] = good.split(".");
    const swapped = Buffer.from(JSON.stringify({ accId: "someone-else", typ: "access" })).toString(
        "base64url"
    );
    assert.throws(
        () => verifyAccountToken(`${h}.${swapped}.${s}`, ["access"]),
        /invalid signature/
    );
});

// ------------------------------------------------- stored manifest hashes

test("manifest hashes: when the key lookup cannot decide, the server key is used, not a fixed string", () => {
    const encryption = require("../server/utils/encryption");
    const hashing = require("../server/utils/hashing");
    const url = "https://addon.example.com/manifest.json";

    // The key every stored hash was made under, worked out independently.
    const serverKey = encryption.getServerKey();
    const prk = crypto
        .createHmac("sha256", Buffer.from("slicksync-hmac-salt"))
        .update(serverKey)
        .digest();
    const expectedKey = crypto.createHmac("sha256", prk).update("slicksync-manifest-hmac").digest();
    const expectedHash = crypto.createHmac("sha256", expectedKey).update(url).digest("hex");

    assert.deepEqual(hashing.getAccountHmacKey({}), expectedKey);
    assert.equal(hashing.manifestUrlHmac({}, url), expectedHash);

    const original = encryption.selectKeyForRequest;
    encryption.selectKeyForRequest = () => {
        throw new TypeError("Cannot read properties of undefined (reading 'appAccountId')");
    };
    try {
        assert.deepEqual(hashing.getAccountHmacKey(undefined), expectedKey);
        assert.equal(hashing.manifestUrlHmac(undefined, url), expectedHash);
        const pepperKey = crypto
            .createHmac("sha256", Buffer.from("slicksync-pepper"))
            .update(url)
            .digest("hex");
        assert.notEqual(hashing.manifestUrlHmac(undefined, url), pepperKey);
    } finally {
        encryption.selectKeyForRequest = original;
    }
});
