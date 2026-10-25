/**
 * Stremio Watched Bitfield Decoder
 *
 * Decodes the watched field from Stremio library items
 * Format: {lastVideoID}:{lastLength}:{serializedBuf}
 * Example: tt25274446:2:5:14:eJz7b8/AAAAEvQE/
 */

const zlib = require("node:zlib");

/**
 * Decode a Stremio watched bitfield string
 * @param {string} watchedStr - The watched field value
 * @returns {Object} Decoded information
 */
function decodeWatchedBitfield(watchedStr) {
    if (!watchedStr || typeof watchedStr !== "string") {
        return null;
    }

    const parts = watchedStr.split(":");
    if (parts.length < 4) {
        return { error: "Invalid format", raw: watchedStr };
    }

    // Parse components
    const lastVideoId = parts.slice(0, 3).join(":"); // tt25274446:2:5
    const lastLength = Number.parseInt(parts[3], 10); // 14
    const serializedBuf = parts[4]; // eJz7b8/AAAAEvQE/

    if (!serializedBuf) {
        return { error: "No bitfield data", lastLength, lastVideoId };
    }

    try {
        // Decode base64
        const compressed = Buffer.from(serializedBuf, "base64");

        // Decompress using zlib (pako/inflate)
        const bitfield = zlib.inflateSync(compressed);

        // Convert to array of booleans (watched status per episode)
        const watchedEpisodes = [];
        for (let i = 0; i < bitfield.length; i++) {
            const byte = bitfield[i];
            for (let j = 0; j < 8; j++) {
                const episodeIndex = i * 8 + j;
                if (episodeIndex >= lastLength) {
                    break;
                }
                watchedEpisodes.push({
                    episode: episodeIndex + 1,
                    watched: (byte & (1 << j)) !== 0,
                });
            }
        }

        return {
            lastLength,
            lastVideoId,
            serializedBuf,
            watchedCount: watchedEpisodes.filter((e) => e.watched).length,
            watchedEpisodes,
        };
    } catch (error) {
        return {
            error: error.message,
            lastLength,
            lastVideoId,
            serializedBuf,
        };
    }
}

/**
 * Parse a library item and extract watched episode info
 * @param {Object} libraryItem - Stremio library item
 * @returns {Object} Parsed info
 */
function parseLibraryItemWatched(libraryItem) {
    if (!libraryItem?.state?.watched) {
        return null;
    }

    const decoded = decodeWatchedBitfield(libraryItem.state.watched);

    return {
        duration: libraryItem.state.duration,
        lastWatched: libraryItem.state.lastWatched,
        showId: libraryItem._id,
        showName: libraryItem.name,
        timesWatched: libraryItem.state.timesWatched,
        timeWatched: libraryItem.state.timeWatched,
        type: libraryItem.type,
        ...decoded,
    };
}

// Example usage with your data
const example = {
    _ctime: "2026-01-26T19:03:56.776496Z",
    _id: "tt25274446",
    _mtime: "2026-02-07T20:52:50.693967Z",
    background: "",
    logo: "",
    name: "Physical: 100",
    poster: "https://api.ratingposterdb.com/t0-free-rpdb/imdb/poster-default/tt25274446.jpg?fallback=true",
    posterShape: "poster",
    removed: true,
    state: {
        duration: 3_259_000,
        episode: 0,
        flaggedWatched: 1,
        lastWatched: "2026-02-07T20:52:50.615314Z",
        noNotif: false,
        overallTimeWatched: 102_975_926,
        season: 0,
        timeOffset: 3_021_019,
        timesWatched: 14,
        timeWatched: 3_021_018,
        video_id: "tt25274446:2:5",
        watched: "tt25274446:2:5:14:eJz7b8/AAAAEvQE/",
    },
    temp: true,
    type: "series",
    year: "",
};

console.log("=== Stremio Watched Bitfield Decoder ===\n");
console.log("Input:", example.state.watched);
console.log("");

const result = parseLibraryItemWatched(example);
console.log("Decoded Result:");
console.log(JSON.stringify(result, null, 2));

// Export for use in other modules
module.exports = {
    decodeWatchedBitfield,
    parseLibraryItemWatched,
};
