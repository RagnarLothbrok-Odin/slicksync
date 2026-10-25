// Whether an address someone typed in is safe for this server to fetch.
//
// Two levels, chosen by the caller:
//   - the default, for an instance that serves strangers: loopback, RFC1918,
//     carrier-grade NAT, link-local (cloud metadata included) and their IPv6
//     equivalents are refused, by literal IP and by what the name resolves to;
//   - allowPrivate, for a household's own install: a server on the LAN or on
//     the same machine is exactly what people point it at, so only link-local
//     is refused - nothing a person legitimately adds lives there, and it is
//     where a cloud host keeps its credentials.
// Either way the address must be http or https.

const dns = require("node:dns").promises;
const net = require("node:net");

function v4Parts(ip) {
    const parts = ip.split(".").map(Number);
    return parts.length === 4 && parts.every((n) => Number.isInteger(n) && n >= 0 && n <= 255)
        ? parts
        : null;
}

// An IPv4 address carried inside an IPv6 one: ::ffff:1.2.3.4, the form URL
// parsing turns that into (::ffff:102:304), and the NAT64 prefix.
function embeddedV4(lower) {
    const dotted = lower.match(/^(?:::ffff:|64:ff9b::)(\d+\.\d+\.\d+\.\d+)$/);
    if (dotted) {
        return dotted[1];
    }
    const hex = lower.match(/^(?:::ffff:|64:ff9b::)([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
    if (!hex) {
        return null;
    }
    const hi = Number.parseInt(hex[1], 16);
    const lo = Number.parseInt(hex[2], 16);
    return `${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`;
}

/** Link-local: 169.254.0.0/16 (cloud metadata lives here) and fe80::/10. */
function isLinkLocalIp(ip) {
    const lower = String(ip || "").toLowerCase();
    const kind = net.isIP(lower);
    if (kind === 4) {
        const p = v4Parts(lower);
        return !!p && p[0] === 169 && p[1] === 254;
    }
    if (kind === 6) {
        const inner = embeddedV4(lower);
        if (inner) {
            return isLinkLocalIp(inner);
        }
        return /^fe[89ab]/.test(lower);
    }
    return false;
}

/**
 * An address that is not on the public internet. Only ever true for an IP -
 * a hostname is not an address, and treating it as one refused real sites
 * whose name happens to start like a private IPv6 range ("fc2.com").
 */
function isPrivateIp(ip) {
    const lower = String(ip || "").toLowerCase();
    const kind = net.isIP(lower);
    if (kind === 4) {
        const p = v4Parts(lower);
        if (!p) {
            return true;
        }
        const [a, b] = p;
        if (a === 0 || a === 10 || a === 127) {
            return true;
        }
        if (a === 100 && b >= 64 && b <= 127) {
            return true; // carrier-grade NAT
        }
        if (a === 169 && b === 254) {
            return true;
        }
        if (a === 172 && b >= 16 && b <= 31) {
            return true;
        }
        if (a === 192 && b === 168) {
            return true;
        }
        if (a === 198 && (b === 18 || b === 19)) {
            return true;
        }
        return a >= 224; // multicast and reserved
    }
    if (kind === 6) {
        const inner = embeddedV4(lower);
        if (inner) {
            return isPrivateIp(inner);
        }
        if (lower === "::" || lower === "::1") {
            return true;
        }
        return /^fe[89ab]/.test(lower) || /^f[cd]/.test(lower) || lower.startsWith("ff");
    }
    return false;
}

const stripBrackets = (host) => host.replace(/^\[|\]$/g, "");

/**
 * Throws unless `raw` is an http(s) address this server may fetch; returns
 * the parsed URL. Every address the name resolves to is checked, not just
 * the first - a name with one public and one internal record must not pass.
 */
async function assertSafeUrl(raw, { allowPrivate = false } = {}) {
    let url;
    try {
        url = new URL(raw);
    } catch (cause) {
        throw new Error("invalid url", { cause });
    }
    if (url.protocol !== "http:" && url.protocol !== "https:") {
        throw new Error("unsupported protocol");
    }
    const host = stripBrackets(url.hostname.toLowerCase());
    const refused = allowPrivate ? isLinkLocalIp : isPrivateIp;
    if (net.isIP(host)) {
        if (refused(host)) {
            throw new Error("blocked host");
        }
        return url;
    }
    if (
        !allowPrivate &&
        (host === "localhost" ||
            host.endsWith(".localhost") ||
            host.endsWith(".local") ||
            host.endsWith(".internal"))
    ) {
        throw new Error("blocked host");
    }
    let addresses;
    try {
        addresses = await dns.lookup(host, { all: true });
    } catch (cause) {
        throw new Error("unresolvable host", { cause });
    }
    if (!addresses.length) {
        throw new Error("unresolvable host");
    }
    if (addresses.some((a) => refused(a.address))) {
        throw new Error("blocked host");
    }
    return url;
}

const REDIRECTS = new Set([301, 302, 303, 307, 308]);

function abortError() {
    const err = new Error("This operation was aborted");
    err.name = "AbortError";
    return err;
}

/**
 * Waits for `work`, but gives up as soon as `signal` aborts, with the same
 * reason fetch would have thrown. The address lookup cannot be cancelled, so
 * without this a caller's timeout would wait out a stalled resolver first.
 */
function untilAborted(work, signal) {
    if (!signal) {
        return work;
    }
    if (signal.aborted) {
        work.catch(() => undefined);
        return Promise.reject(signal.reason ?? abortError());
    }
    return new Promise((resolve, reject) => {
        const onAbort = () => reject(signal.reason ?? abortError());
        signal.addEventListener("abort", onAbort, { once: true });
        work.then(resolve, reject).finally(() => signal.removeEventListener("abort", onAbort));
    });
}

/**
 * fetch, with the same check applied to every redirect on the way. A plain
 * fetch after assertSafeUrl only vouches for the first address: a public
 * host can answer with a redirect to an internal one, and it was followed.
 *
 * `vet`, when given, is asked about every address (the first and each hop)
 * instead of the default check, for a caller that holds redirects to a rule of
 * its own. It returns or throws like assertSafeUrl.
 */
async function safeFetch(raw, init = {}, { allowPrivate = false, maxRedirects = 5, vet } = {}) {
    let current = String(raw);
    let options = { ...init, redirect: "manual" };
    for (let hop = 0; ; hop++) {
        await untilAborted(
            vet ? vet(current) : assertSafeUrl(current, { allowPrivate }),
            options.signal
        );
        const res = await fetch(current, options);
        const location = REDIRECTS.has(res.status) ? res.headers.get("location") : null;
        if (!location) {
            return res;
        }
        if (hop >= maxRedirects) {
            throw new Error("too many redirects");
        }
        try {
            await res.body?.cancel();
        } catch {
            // An already-closed response body needs no further cleanup.
        }
        const next = new URL(location, current);
        const method = String(options.method || "GET").toUpperCase();
        // A redirected POST becomes a GET, as browsers do it (always for 303).
        if (
            res.status === 303 ||
            ((res.status === 301 || res.status === 302) && method === "POST")
        ) {
            const { body: _body, ...rest } = options;
            options = { ...rest, method: "GET" };
        }
        // Credentials meant for the first host do not travel to another one.
        if (next.origin !== new URL(current).origin && options.headers) {
            const headers = new Headers(options.headers);
            for (const name of ["authorization", "cookie", "proxy-authorization"]) {
                headers.delete(name);
            }
            options = { ...options, headers };
        }
        current = next.toString();
    }
}

/** What this install allows: a private one may reach its own network. */
function instancePolicy() {
    return { allowPrivate: require("./config").INSTANCE_TYPE !== "public" };
}

module.exports = { assertSafeUrl, instancePolicy, isLinkLocalIp, isPrivateIp, safeFetch };
