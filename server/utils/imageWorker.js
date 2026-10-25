/**
 * Worker-thread entry for image encoding. One message in, one out; the
 * pool in imageEncodePool.js owns the lifecycle. See imageEncoder.js for
 * why this work is worth moving off the request thread at all.
 */
const { parentPort } = require("node:worker_threads");
const { encode, getEncoder } = require("./imageEncoder");

// Load the codecs now, while idle, rather than on the first poster.
getEncoder().catch(() => undefined);

parentPort.on("message", async (msg) => {
    const { id, buf, w, format } = msg || {};
    try {
        const result = await encode(Buffer.from(buf), { format, w });
        parentPort.postMessage({ format: result.format, id, out: result.buf });
    } catch (e) {
        parentPort.postMessage({ error: e?.message || "encode failed", id });
    }
});
