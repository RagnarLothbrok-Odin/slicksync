const test = require("node:test");
const assert = require("node:assert/strict");
const { createDefaultAvatar } = require("../server/utils/defaultAvatar");

test("new profiles receive independent Voxel Bot seeds and background colours", () => {
    const urls = Array.from({ length: 64 }, createDefaultAvatar);
    assert.equal(new Set(urls).size, urls.length);
    const colours = new Set();
    for (const value of urls) {
        const url = new URL(value);
        assert.equal(url.origin, "https://api.dicebear.com");
        assert.equal(url.pathname, "/10.x/voxel-bot/svg");
        assert.match(url.searchParams.get("seed"), /^[a-f0-9]{32}$/);
        assert.match(url.searchParams.get("backgroundColor"), /^[a-f0-9]{6}$/);
        colours.add(url.searchParams.get("backgroundColor"));
        // The stored picture is fully specified; reading it needs no randomness.
        assert.equal(JSON.parse(JSON.stringify({ avatarUrl: value })).avatarUrl, value);
    }
    assert.ok(colours.size > 1);
});

test("registration saves one avatar and repeated logins leave it unchanged", async () => {
    let account = null;
    let creations = 0;
    const prisma = {
        appAccount: {
            count: async () => (account ? 1 : 0),
            create: async ({ data }) => {
                creations++;
                account = { id: "avatar-test-account", ...data };
                return account;
            },
            findUnique: async () => account,
            update: async ({ data }) => {
                Object.assign(account, data);
                return account;
            },
        },
    };
    const router = require("../server/routes/publicAuth")({
        cookieName: (name) => name,
        INSTANCE_TYPE: "public",
        isProdEnv: () => false,
        issueAccessToken: () => "test-access",
        issueRefreshToken: () => "test-refresh",
        prisma,
        verifyAccountToken: () => null,
    });
    const call = async (path) => {
        const layer = router.stack.find((entry) => entry.route?.path === path);
        const response = {
            code: 200,
            cookie() {
                return this;
            },
            json() {
                return this;
            },
            status(code) {
                this.code = code;
                return this;
            },
        };
        await layer.route.stack[0].handle(
            {
                body: {
                    password: "avatar-test-password",
                    uuid: "f94cd034-ddd3-4254-8641-297147691f96",
                },
            },
            response
        );
        return response.code;
    };
    assert.equal(await call("/register"), 201);
    const initialAvatar = account.avatarUrl;
    assert.match(initialAvatar, /\/voxel-bot\/svg\?/);
    for (let index = 0; index < 3; index++) {
        assert.equal(await call("/login"), 200);
        assert.equal(account.avatarUrl, initialAvatar);
    }
    assert.equal(creations, 1);
});
