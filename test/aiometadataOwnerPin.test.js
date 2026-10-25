// A main AIOMetadata user with a PIN signs in as "password/PIN". SlickSync
// must keep the configuration password - the part before the slash - so the
// household card can still add users and set PINs afterwards.
const test = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");
const { rememberAccess } = require("../server/utils/aiometadataHousehold");

const UUID = "11111111-2222-4333-8444-555555555555";

async function fakeAiometadata(t, configPassword) {
    const app = express();
    app.use(express.json());
    const tried = [];
    app.post("/api/config/load/:uuid", (req, res) => {
        tried.push(req.body.password);
        if (req.params.uuid !== UUID || req.body.password !== configPassword) {
            return res.status(401).json({ error: "Invalid password" });
        }
        res.json({ config: { jellyfinUsers: [] } });
    });
    const server = await new Promise((resolve) => {
        const s = app.listen(0, "127.0.0.1", () => resolve(s));
    });
    t.after(() => server.close());
    return { serverUrl: `http://127.0.0.1:${server.address().port}/jellyfin/${UUID}`, tried };
}

function fakePrisma() {
    const saved = [];
    return {
        saved,
        user: {
            update: async ({ data }) => {
                saved.push(data);
            },
        },
    };
}
const encrypt = (value) => `enc(${value})`;
const person = { accountId: "default", id: "p1" };

test("the owner typing password/PIN: the password before the slash is kept", async (t) => {
    const { serverUrl, tried } = await fakeAiometadata(t, "hunter2");
    const prisma = fakePrisma();
    assert.equal(
        await rememberAccess(prisma, encrypt, person, {
            password: "hunter2/1234",
            probe: { kind: "aiometadata", serverUrl },
        }),
        true
    );
    assert.deepEqual(tried, ["hunter2/1234", "hunter2"]);
    assert.deepEqual(prisma.saved, [{ aioConfigId: UUID, aioConfigPassword: "enc(hunter2)" }]);
});

test("a password that itself contains a slash still works whole", async (t) => {
    const { serverUrl, tried } = await fakeAiometadata(t, "a/b");
    const prisma = fakePrisma();
    assert.equal(
        await rememberAccess(prisma, encrypt, person, {
            password: "a/b",
            probe: { kind: "aiometadata", serverUrl },
        }),
        true
    );
    assert.deepEqual(tried, ["a/b"]);
    assert.equal(prisma.saved[0].aioConfigPassword, "enc(a/b)");
});

test("a client password that opens nothing is not kept", async (t) => {
    const { serverUrl } = await fakeAiometadata(t, "hunter2");
    const prisma = fakePrisma();
    assert.equal(
        await rememberAccess(prisma, encrypt, person, {
            password: "clientpw/1234",
            probe: { kind: "aiometadata", serverUrl },
        }),
        false
    );
    assert.equal(prisma.saved.length, 0);
});

test("a failed save never fails the sign-in", async (t) => {
    const { serverUrl } = await fakeAiometadata(t, "hunter2");
    const prisma = {
        user: {
            update: async () => {
                throw new Error("database is locked");
            },
        },
    };
    assert.equal(
        await rememberAccess(prisma, encrypt, person, {
            password: "hunter2",
            probe: { kind: "aiometadata", serverUrl },
        }),
        false
    );
});
