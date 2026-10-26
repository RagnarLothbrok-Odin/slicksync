import { deepEqual, equal } from "node:assert/strict";
import { test } from "node:test";
import { type PlaybackEvidence, playbackUpdates } from "../client/lib/playback";

const now = Date.parse("2026-10-25T21:15:00Z");
const saved = "2026-10-25T21:01:10.084Z";
const checked = "2026-10-25T21:14:50.000Z";
function evidence(fields: Partial<PlaybackEvidence>): PlaybackEvidence {
    return {
        evidence: "history",
        observedAt: null,
        position: "checkpoint",
        state: "unknown",
        ...fields,
    };
}

test("fresh proxy polling does not freshen the borrowed position", () => {
    deepEqual(
        playbackUpdates(
            evidence({ evidence: "proxy", observedAt: checked, positionUpdatedAt: saved }),
            now
        ),
        [
            { age: "just now", at: checked, label: "Stream checked" },
            { age: "13 min ago", at: saved, label: "Progress saved" },
        ]
    );
});

test("unchanged checkpoints get older even as requests continue", () => {
    const checkpoint = evidence({ observedAt: saved, positionUpdatedAt: saved });
    equal(playbackUpdates(checkpoint, now)[0].age, "13 min ago");
    equal(playbackUpdates(checkpoint, now + 120_000)[0].age, "15 min ago");
});

test("missing, invalid and future timestamps never appear fresh", () => {
    for (const observedAt of [null, "invalid", "2026-10-26T21:15:00Z"]) {
        deepEqual(playbackUpdates(evidence({ observedAt }), now), []);
    }
    deepEqual(playbackUpdates(undefined, now), []);
});

test("player observations and transition events have distinct labels", () => {
    equal(
        playbackUpdates(evidence({ evidence: "player", observedAt: checked }), now)[0].label,
        "Player checked"
    );
    equal(
        playbackUpdates(evidence({ evidence: "event", observedAt: checked }), now)[0].label,
        "Playback reported"
    );
});
