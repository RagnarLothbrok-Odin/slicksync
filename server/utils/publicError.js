// What a failed request tells the person who made it.
//
// Many errors are written for people ("That list is private", "Enter the
// server address") and should reach them. Others are the inside of the
// server - a database error, a refused connection, a crash, a request URL
// that can carry an addon's keys - and say nothing useful while giving away
// detail. publicMessage passes the first kind through and swaps the second
// for the route's own fallback line, keeping the real error in the log.

const INTERNAL = [
    /prisma|\bP\d{4}\b|sqlite|postgres|database|\bsql\b|constraint|unique|foreign key/i,
    /\bE(?:CONN\w*|NOTFOUND|AI_AGAIN|TIMEDOUT|HOSTUNREACH|NETUNREACH|PIPE|PROTO)\b|socket hang up|fetch failed|network error/i,
    /cannot (?:read|set) propert|is not a function|is not defined|is not iterable|is not a constructor|\bundefined\b|\bnull\b|\bNaN\b/i,
    /unexpected (?:token|end of)|JSON at position|JSON\.parse|in JSON\b|TypeError|ReferenceError|SyntaxError|RangeError|\bstack\b/i,
    /https?:\/\/|\/app\/|\/home\/|\/opt\/|node_modules|\.m?js:\d+/i,
    /status code \d{3}|request failed with|request to \S+ failed|timeout of \d+\s*ms|AbortError|certificate|self[- ]signed|\bSSL\b|\bTLS\b/i,
    /<html|<!doctype/i,
    /[A-Za-z0-9_\-+/=]{32,}/, // tokens, keys, hashes
];

function looksInternal(message) {
    if (typeof message !== "string") {
        return true;
    }
    const text = message.trim();
    if (!text || text.length > 300) {
        return true;
    }
    return INTERNAL.some((re) => re.test(text));
}

function publicMessage(error, fallback = "Something went wrong") {
    const message = typeof error === "string" ? error : error?.message;
    if (message && !looksInternal(message)) {
        return message;
    }
    if (message) {
        console.warn("[error hidden from the response]", message);
    }
    return fallback;
}

module.exports = { looksInternal, publicMessage };
