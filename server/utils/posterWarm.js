/**
 * Poster pre-warming.
 *
 * The moment the server hands a page its list of titles, it knows exactly
 * which posters that page is about to ask for. Producing them right then,
 * in the background, means the browser's requests a beat later are disk
 * reads instead of fetches and encodes - the grid fills at once rather
 * than poster by poster. Sizes match what the cards actually request: 342
 * for desktop and the pass-through case, 185 and 154 for phones.
 *
 * Two lanes. `urgent` is a page being answered right now: its posters go
 * ahead of everything, the sizes most screens ask for first, and a poster
 * already waiting in the background lane is moved up rather than skipped.
 * The background lane is the timer that keeps the default lists warm; it
 * queues hundreds at a time and used to fill the queue, so the page someone
 * was actually opening waited behind it or was dropped.
 *
 * Strictly best-effort and deliberately gentle: two at a time, bounded
 * queues, and a source+width done in the last ten minutes is not queued
 * again, so a page that re-fetches every few seconds does not turn into a
 * fetch storm against the poster CDN.
 */
const { warm } = require("./imageCacheCore");

const WIDTHS = [342, 185, 154];
const CONCURRENCY = 2;
const MAX_URGENT = 300;
const MAX_BACKGROUND = 400;
const RECENT_TTL_MS = 10 * 60 * 1000;

const urgent = [];
const background = [];
const waiting = new Map(); // key -> job, while queued
const recent = new Map(); // key -> when it was taken off a queue
let active = 0;

function eligible(url) {
    return typeof url === "string" && /^https?:\/\//i.test(url) && !/\.(gif|svg)(\?|$)/i.test(url);
}

function pump() {
    while (active < CONCURRENCY && (urgent.length > 0 || background.length > 0)) {
        const job = urgent.length > 0 ? urgent.shift() : background.shift();
        if (job.dropped) {
            continue;
        }
        waiting.delete(job.key);
        recent.set(job.key, Date.now());
        active += 1;
        warm(job.url, job.w)
            .catch(() => {
                /* optimisation only - a miss just costs the request a fetch */
            })
            .finally(() => {
                active -= 1;
                pump();
            });
    }
}

/**
 * Queue the posters of a list of items (anything with a `poster` string,
 * or plain URL strings) for warming. `urgent` for a page being answered now.
 */
function warmPosters(items, { widths = WIDTHS, urgent: isUrgent = false } = {}) {
    if (!Array.isArray(items) || items.length === 0) {
        return 0;
    }
    const now = Date.now();
    const urls = items
        .map((item) => (typeof item === "string" ? item : item?.poster))
        .filter(eligible);
    let queued = 0;
    // Width by width, so every poster gets the size most screens use before
    // any gets its third.
    for (const w of widths) {
        for (const url of urls) {
            const key = `${url}|${w}`;
            const done = recent.get(key);
            if (done && now - done < RECENT_TTL_MS) {
                continue;
            }
            const pending = waiting.get(key);
            if (pending) {
                if (!isUrgent || pending.urgent) {
                    continue;
                }
                pending.dropped = true; // moved up to the urgent lane below
            }
            const job = { key, urgent: isUrgent, url, w };
            if (isUrgent) {
                urgent.push(job);
                // The newest page matters most: past the cap, the oldest urgent go.
                while (urgent.length > MAX_URGENT) {
                    waiting.delete(urgent.shift().key);
                }
            } else {
                if (background.length >= MAX_BACKGROUND) {
                    continue;
                }
                background.push(job);
            }
            waiting.set(key, job);
            queued += 1;
        }
    }
    if (recent.size > 5000) {
        for (const [k, t] of recent) {
            if (now - t > RECENT_TTL_MS) {
                recent.delete(k);
            }
        }
    }
    if (queued > 0) {
        pump();
    }
    return queued;
}

module.exports = { warmPosters };
