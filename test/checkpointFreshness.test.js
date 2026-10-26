const test = require("node:test");
const assert = require("node:assert/strict");
const { checkpointSavedAt } = require("../server/utils/playbackEvidence");
const now = Date.parse("2026-10-25T21:00:00Z");
const saved = "2026-10-25T20:58:00.000Z";
const session = {
    episode: 5,
    itemId: "tt123",
    lastPosition: 60_000,
    season: 3,
    videoId: "tt123:3:5",
};
const item = {
    _id: "tt123",
    state: { lastWatched: saved, timeOffset: 60_000, video_id: session.videoId },
};

test("checkpoint time requires the same video and saved position", () => {
    assert.equal(checkpointSavedAt(session, [item], now), saved);
    assert.equal(
        checkpointSavedAt(
            session,
            [{ ...item, state: { ...item.state, video_id: "tt123:3:4" } }],
            now
        ),
        null
    );
    assert.equal(
        checkpointSavedAt(
            session,
            [{ ...item, state: { ...item.state, timeOffset: 120_000 } }],
            now
        ),
        null
    );
    assert.equal(checkpointSavedAt(session, [{ ...item, _id: "tt456" }], now), null);
});

test("poll and metadata timestamps do not stand in for a missing or invalid checkpoint", () => {
    for (const lastWatched of [undefined, null, "bad", "2026-10-26T21:00:00Z"]) {
        assert.equal(
            checkpointSavedAt(
                session,
                [{ ...item, _mtime: now, state: { ...item.state, lastWatched } }],
                now
            ),
            null
        );
    }
    assert.equal(checkpointSavedAt(session, null, now), null);
});

test("expanded episode rows and explicit episode numbers match without borrowing another episode", () => {
    assert.equal(
        checkpointSavedAt(
            session,
            [{ _id: session.videoId, state: { lastWatched: saved, timeOffset: 60_000 } }],
            now
        ),
        saved
    );
    assert.equal(
        checkpointSavedAt(
            session,
            [
                {
                    _id: session.itemId,
                    state: { episode: 5, lastWatched: saved, season: 3, timeOffset: 60_000 },
                },
            ],
            now
        ),
        saved
    );
    assert.equal(
        checkpointSavedAt(
            session,
            [{ _id: session.itemId, state: { lastWatched: saved, timeOffset: 60_000 } }],
            now
        ),
        null
    );
});
