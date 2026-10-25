// Deleting a person or an account clears every table that holds their rows:
// the lists in utils/accountDeletion.js are checked against both schemas.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const {
    PERSON_TABLES,
    ACCOUNT_TABLES,
    purgePersonLeftovers,
} = require("../server/utils/accountDeletion");

const lower = (m) => m[0].toLowerCase() + m.slice(1);
function modelsWith(field) {
    const out = new Set();
    for (const file of ["schema.postgres.prisma", "schema.sqlite.prisma"]) {
        let model = null;
        for (const line of fs
            .readFileSync(
                path.join(require("node:path").dirname(module.filename), "..", "prisma", file),
                "utf8"
            )
            .split("\n")) {
            const m = /^model (\w+) \{/.exec(line);
            if (m) {
                model = m[1];
            } else if (model && new RegExp(`^\\s+${field}\\s+String`).test(line)) {
                out.add(lower(model));
            }
        }
    }
    return out;
}

test("every table with a person's rows is cleared when they are deleted", () => {
    const tables = modelsWith("userId");
    assert.ok(tables.has("watchActivity") && tables.has("watchSyncSetting"), "the schema was read");
    const missing = [...tables].filter((t) => !PERSON_TABLES.includes(t));
    assert.deepEqual(missing, []);
});

test("every account-scoped table is cleared when the account is deleted", () => {
    const tables = modelsWith("accountId");
    assert.ok(tables.has("vaultEntry") && tables.has("watchCopyRun"), "the schema was read");
    const missing = [...tables].filter((t) => t !== "user" && !ACCOUNT_TABLES.includes(t));
    assert.deepEqual(missing, []);
});

test("a person brought back from the Trash keeps their history", async () => {
    const cleared = [];
    const prisma = new Proxy(
        {
            $transaction: async (ops) => {
                cleared.push(...ops);
            },
            user: { findUnique: async () => ({ id: "u1" }) },
        },
        { get: (t, k) => t[k] || { deleteMany: ({ where }) => ({ table: k, where }) } }
    );
    await purgePersonLeftovers(prisma, "u1");
    assert.equal(cleared.length, 0);
    prisma.user.findUnique = async () => null;
    await purgePersonLeftovers(prisma, "u1");
    assert.ok(cleared.some((c) => c.table === "watchActivity" && c.where.userId === "u1"));
});
