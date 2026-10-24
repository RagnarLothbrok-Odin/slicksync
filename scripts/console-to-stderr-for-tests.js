// Loaded into every test file's process by scripts/run-tests.js.
//
// Node's test runner sends each file's results to the parent over that
// file's stdout, as binary messages with a length in front. Anything else
// printed to stdout - the server's own console logging, which tests trigger
// all the time - travels down the same pipe, and now and then lands where
// the runner expects a message length. The runner then fails the whole file
// with "Unable to deserialize cloned data", a different file each time.
// Console output goes to stderr instead, which the runner shows but never
// parses, so the result messages have stdout to themselves.
const util = require("node:util");

for (const method of ["log", "info", "debug", "dir", "table"]) {
    // eslint-disable-next-line no-console
    console[method] = (...args) => {
        process.stderr.write(`${util.format(...args)}\n`);
    };
}
