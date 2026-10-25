/** Playback state is only definite when a player or playback event reports it. */
export interface PlaybackEvidence {
    evidence: "player" | "event" | "proxy" | "history";
    observedAt: string | null;
    position: "reported" | "estimated" | "checkpoint";
    state: "playing" | "paused" | "unknown";
}

/** Shared wording keeps admin and personal cards equally honest about estimates. */
export function playbackPresentation(playback?: PlaybackEvidence | null) {
    const direct = playback?.evidence === "player" || playback?.evidence === "event";
    const playing = direct && playback.state === "playing";
    const paused = direct && playback.state === "paused";
    return {
        playing,
        positionLabel: paused
            ? "Paused at"
            : playing && playback?.position === "estimated"
              ? "Estimated position"
              : "Last known position",
        status: paused
            ? "Paused"
            : playing
              ? "Playing now"
              : playback?.evidence === "proxy"
                ? "Stream detected"
                : "Recently active",
    };
}
