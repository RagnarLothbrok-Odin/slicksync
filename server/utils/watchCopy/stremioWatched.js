// Stremio's record of which episodes of a show are watched: one bit per
// episode, packed into `state.watched` on the library item as
// "<anchor video id>:<anchor length>:<base64 of zlib-deflated bytes>".
//
// This follows stremio-core exactly (stremio-watched-bitfield and
// LibraryItemState::watched_bitfield):
// - the bits are in the order of the show's videos sorted by season, then
//   episode, then release date - season 0 (specials) first;
// - bit i is byte i >> 3, mask 1 << (i & 7);
// - the anchor is the LAST watched video and its position + 1. When the show
//   gains episodes later, a reader finds the anchor in the new list and
//   shifts the bits by the difference - so a written field stays right as
//   new episodes and seasons appear.

const zlib = require("node:zlib");

/** Video ids in the order Stremio numbers them. */
function orderVideos(videos) {
    const key = (n) => (Number.isFinite(Number(n)) ? Number(n) : Number.NEGATIVE_INFINITY);
    const released = (v) => {
        const t = v?.released ? Date.parse(v.released) : Number.NaN;
        return Number.isFinite(t) ? t : Number.NEGATIVE_INFINITY;
    };
    return [...(videos || [])]
        .filter((v) => v?.id)
        .sort(
            (a, b) =>
                key(a.season) - key(b.season) ||
                key(a.episode) - key(b.episode) ||
                released(a) - released(b)
        )
        .map((v) => String(v.id));
}

function parseField(field) {
    if (!field || typeof field !== "string") {
        return null;
    }
    const parts = field.split(":");
    if (parts.length < 3) {
        return null;
    }
    const packed = parts.pop();
    const length = Number(parts.pop());
    const anchor = parts.join(":");
    if (!(anchor && Number.isInteger(length)) || length < 0) {
        return null;
    }
    let bytes;
    try {
        bytes = zlib.inflateSync(Buffer.from(packed, "base64"));
    } catch {
        return null;
    }
    return { anchor, bytes, length };
}

/**
 * The set of watched video ids, read against the show's current video list
 * (orderVideos). An anchor that is no longer in the list reads as nothing
 * watched - what Stremio itself does.
 */
function readWatched(field, videoIds) {
    const parsed = parseField(field);
    const out = new Set();
    if (!parsed) {
        return out;
    }
    const at = videoIds.indexOf(parsed.anchor);
    if (at < 0) {
        return out;
    }
    const offset = parsed.length - at - 1;
    const bitCount = parsed.bytes.length * 8;
    for (let i = 0; i < videoIds.length; i++) {
        const prev = i + offset;
        if (prev < 0 || prev >= bitCount) {
            continue;
        }
        if (parsed.bytes[prev >> 3] & (1 << (prev & 7))) {
            out.add(videoIds[i]);
        }
    }
    return out;
}

/** The field for exactly these watched video ids, or null when there are none. */
function writeWatched(watchedIds, videoIds) {
    const watched = watchedIds instanceof Set ? watchedIds : new Set(watchedIds);
    const bytes = Buffer.alloc(Math.ceil(videoIds.length / 8));
    let last = -1;
    videoIds.forEach((id, i) => {
        if (!watched.has(id)) {
            return;
        }
        bytes[i >> 3] |= 1 << (i & 7);
        last = i;
    });
    if (last < 0) {
        return null;
    }
    const packed = zlib.deflateSync(bytes).toString("base64");
    return `${videoIds[last]}:${last + 1}:${packed}`;
}

module.exports = { orderVideos, parseField, readWatched, writeWatched };
