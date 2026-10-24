// Runs the test suite, and runs it once more if the first run failed.
//
// Node's test runner used to fail a whole file now and then before any of its
// tests started ("Unable to deserialize cloned data") - a different file each
// time. The cause: each file's results reach the runner as binary messages on
// that file's stdout, and the server's console logging, which tests trigger
// constantly, went down the same pipe and sometimes landed inside a message.
// console-to-stderr-for-tests.js, loaded into every file's process, moves console
// output to stderr, which the runner never parses. The second run stays as a
// safety net: a test that is really broken fails both runs, so nothing is
// hidden.

const path = require("node:path");
const { spawnSync } = require("node:child_process");

const quietStdout = path.join(
    require("node:path").dirname(module.filename),
    "console-to-stderr-for-tests.js"
);

function run() {
    return spawnSync(
        process.execPath,
        ["--require", quietStdout, "--test", ...process.argv.slice(2)],
        { stdio: "inherit" }
    ).status;
}

let status = run();
if (status !== 0) {
    console.error("\n[tests] The run failed - running once more to rule out a runner hiccup.\n");
    status = run();
}
process.exit(status === null ? 1 : status);
