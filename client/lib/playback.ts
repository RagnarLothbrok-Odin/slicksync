/** Playback state is only definite when a player or playback event reports it. */
export interface PlaybackEvidence {
    evidence: "player" | "event" | "proxy" | "history" | "tracker";
    observedAt: string | null;
    position: "reported" | "estimated" | "checkpoint";
    /** Provider save time for this position, independent of proxy presence checks. */
    positionUpdatedAt?: string | null;
    provider?: "trakt" | "mdblist";
    state: "playing" | "paused" | "unknown";
}

/** Shared wording keeps admin and personal cards equally honest about estimates. */
export function playbackPresentation(playback?: PlaybackEvidence | null) {
    const direct =
        playback?.evidence === "player" ||
        playback?.evidence === "event" ||
        playback?.evidence === "tracker";
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
              ? playback?.evidence === "tracker"
                  ? playback.provider === "mdblist"
                      ? "Playing on MDBList"
                      : "Playing on Trakt"
                  : "Playing now"
              : playback?.evidence === "proxy"
                ? "Stream detected"
                : "Recently active",
    };
}

/** Save times and presence checks describe different facts and stay separate. */
export function playbackUpdates(playback: PlaybackEvidence | null | undefined, now: number) {
    const updates: { label: string; at: string; age: string }[] = [];
    const add = (label: string, value?: string | null) => {
        const timestamp = value ? Date.parse(value) : Number.NaN;
        if (!Number.isFinite(timestamp) || timestamp <= 0 || timestamp > now + 30_000) {
            return;
        }
        const minutes = Math.floor(Math.max(0, now - timestamp) / 60_000);
        const hours = Math.floor(minutes / 60);
        const days = Math.floor(hours / 24);
        const age =
            minutes < 1
                ? "just now"
                : minutes < 60
                  ? `${minutes} min ago`
                  : hours < 24
                    ? `${hours} hr ago`
                    : `${days} ${days === 1 ? "day" : "days"} ago`;
        updates.push({ age, at: new Date(timestamp).toISOString(), label });
    };
    if (playback?.evidence === "history") {
        add("Progress saved", playback.positionUpdatedAt || playback.observedAt);
    } else if (playback?.evidence === "proxy") {
        add("Stream checked", playback.observedAt);
        add("Progress saved", playback.positionUpdatedAt);
    } else if (playback) {
        add(
            playback.evidence === "player"
                ? "Player checked"
                : playback.evidence === "tracker"
                  ? "Tracker checked"
                  : "Playback reported",
            playback.observedAt
        );
    }
    return updates;
}

/** Advance Trakt timing between polls; checkpoints and paused players stay fixed. */
export function livePlaybackPosition(
    playback: PlaybackEvidence | null | undefined,
    position: number | null | undefined,
    duration: number | null | undefined,
    now: number
) {
    if (typeof position !== "number" || typeof duration !== "number" || duration <= 0) {
        return null;
    }
    const observed = playback?.observedAt ? Date.parse(playback.observedAt) : Number.NaN;
    const elapsed =
        playback?.evidence === "tracker" &&
        playback.state === "playing" &&
        Number.isFinite(observed)
            ? Math.max(0, now - observed)
            : 0;
    return Math.min(duration, Math.max(0, position + elapsed));
}
