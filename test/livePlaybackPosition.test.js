const test = require("node:test");
const assert = require("node:assert/strict");
const { livePlaybackPosition } = require("../client/lib/playback.ts");
const observedAt = "2026-10-26T12:00:00Z";
const now = Date.parse(observedAt) + 10_000;
test("Trakt timing ticks between polls and remains bounded by duration", () => {
    const playback = { evidence: "tracker", observedAt, state: "playing" };
    assert.equal(livePlaybackPosition(playback, 30_000, 100_000, now), 40_000);
    assert.equal(livePlaybackPosition(playback, 95_000, 100_000, now), 100_000);
    assert.equal(livePlaybackPosition(playback, 30_000, 100_000, now - 20_000), 30_000);
});
test("pause, proxy evidence and checkpoints never advance locally", () => {
    for (const [evidence, state] of [
        ["tracker", "paused"],
        ["proxy", "unknown"],
        ["history", "unknown"],
    ]) {
        assert.equal(
            livePlaybackPosition({ evidence, observedAt, state }, 30_000, 100_000, now),
            30_000
        );
    }
    assert.equal(livePlaybackPosition(null, null, null, now), null);
});
