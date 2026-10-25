// Provider save times belong to a specific video and position. A cache file's
// write time or a WatchSession refresh cannot make an old checkpoint newer.
function checkpointSavedAt(session, library, now = Date.now()) {
    for (const item of Array.isArray(library) ? library : []) {
        const id = item._id || item.id;
        if (id !== session.itemId && id !== session.videoId) {
            continue;
        }
        const state = item.state;
        if (
            !(state && Number.isFinite(state.timeOffset)) ||
            state.timeOffset !== session.lastPosition
        ) {
            continue;
        }
        if (session.videoId) {
            const videoId = state.video_id || (id === session.videoId ? id : null);
            if (
                videoId
                    ? videoId !== session.videoId
                    : !(
                          state.season === session.season &&
                          state.episode === session.episode &&
                          session.episode != null
                      )
            ) {
                continue;
            }
        }
        const timestamp = state.lastWatched ? new Date(state.lastWatched).getTime() : Number.NaN;
        if (Number.isFinite(timestamp) && timestamp > 0 && timestamp <= now + 30_000) {
            return new Date(timestamp).toISOString();
        }
    }
    return null;
}

module.exports = { checkpointSavedAt };
