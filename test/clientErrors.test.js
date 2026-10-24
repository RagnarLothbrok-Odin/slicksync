const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");
const ts = require("typescript");

const source = fs.readFileSync(path.join(process.cwd(), "client/lib/errors.ts"), "utf8");
const { outputText } = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
});
const loaded = { exports: {} };
vm.runInNewContext(outputText, { exports: loaded.exports, module: loaded });
const { readErrorMessage, readErrorName } = loaded.exports;

test("client error readers handle thrown values without assuming an Error instance", () => {
    assert.equal(readErrorMessage(new Error("Request failed")), "Request failed");
    assert.equal(readErrorMessage({ message: "Provider unavailable" }), "Provider unavailable");
    assert.equal(readErrorMessage("Offline"), "Offline");
    for (const value of [null, undefined, false, 0, {}, { message: 42 }, { message: "" }]) {
        assert.equal(readErrorMessage(value, "Retry later"), "Retry later");
    }
});

test("client error names preserve cancellation handling without unchecked casts", () => {
    assert.equal(readErrorName({ name: "AbortError" }), "AbortError");
    assert.equal(readErrorName(new TypeError("Network request failed")), "TypeError");
    assert.equal(readErrorName(null), "Error");
    assert.equal(readErrorName({ name: 42 }), "Error");
});
