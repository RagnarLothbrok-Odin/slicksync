import { deepEqual, equal } from "node:assert/strict";
import { test } from "node:test";
import { type PlaybackEvidence, playbackPresentation } from "../client/lib/playback";

function evidence(values: Partial<PlaybackEvidence>): PlaybackEvidence {
    return {
        evidence: "history",
        observedAt: null,
        position: "checkpoint",
        state: "unknown",
        ...values,
    };
}

test("missing and historical evidence never claim playing or paused", () => {
    for (const value of [undefined, null, evidence({}), evidence({ state: "paused" })]) {
        deepEqual(playbackPresentation(value), {
            playing: false,
            positionLabel: "Last known position",
            status: "Recently active",
        });
    }
});

test("proxy traffic cannot establish playing or pause", () => {
    for (const state of ["playing", "paused", "unknown"] as const) {
        deepEqual(playbackPresentation(evidence({ evidence: "proxy", state })), {
            playing: false,
            positionLabel: "Last known position",
            status: "Stream detected",
        });
    }
});

test("player and transition events share state wording and disclose estimated progress", () => {
    for (const source of ["player", "event"] as const) {
        deepEqual(
            playbackPresentation(
                evidence({ evidence: source, position: "reported", state: "paused" })
            ),
            {
                playing: false,
                positionLabel: "Paused at",
                status: "Paused",
            }
        );
        const playing = playbackPresentation(
            evidence({ evidence: source, position: "estimated", state: "playing" })
        );
        equal(playing.status, "Playing now");
        equal(playing.playing, true);
        equal(playing.positionLabel, "Estimated position");
    }
});
