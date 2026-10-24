const express = require("express");
const crypto = require("node:crypto");
const { Readable, pipeline } = require("node:stream");
const { logProxyRequest } = require("../utils/proxyLogger");
const { assertSafeUrl, safeFetch, instancePolicy } = require("../utils/safeUrl");

// What safeFetch / assertSafeUrl say when the address itself is the problem
// (as opposed to the host being slow or down).
const REFUSED_ADDRESS = new Set(["blocked host", "unsupported protocol", "invalid url"]);

/**
 * Set CORS headers for Stremio/streaming compatibility
 */
function setCorsHeaders(res) {
    res.set("Access-Control-Allow-Origin", "*");
    res.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS, HEAD");
    res.set("Access-Control-Allow-Headers", "Content-Type, Authorization, Range");
    res.set(
        "Access-Control-Expose-Headers",
        "Content-Length, Content-Range, Accept-Ranges, Location"
    );
    res.set("Access-Control-Max-Age", "86400");
}

/**
 * Encrypt a stream URL for use in the proxy
 * Uses AES-256-GCM with the server key
 */
function encryptStreamUrl(url, serverKey) {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv("aes-256-gcm", serverKey, iv);
    const ciphertext = Buffer.concat([cipher.update(url, "utf8"), cipher.final()]);
    const tag = cipher.getAuthTag();

    // Format: iv:ciphertext:tag (all base64)
    const encrypted = `${iv.toString("base64")}:${ciphertext.toString("base64")}:${tag.toString("base64")}`;

    // URL-safe base64 encoding (replace + with -, / with _, remove =)
    return Buffer.from(encrypted)
        .toString("base64")
        .replace(/\+/g, "-")
        .replace(/\//g, "_")
        .replace(/[=]/g, "");
}

/**
 * Decrypt a stream URL from the proxy format
 */
function decryptStreamUrl(encryptedPayload, serverKey) {
    try {
        // Restore URL-safe base64 to standard base64
        let base64 = encryptedPayload.replace(/-/g, "+").replace(/_/g, "/");

        // Add padding if needed
        while (base64.length % 4) {
            base64 += "=";
        }

        const encrypted = Buffer.from(base64, "base64").toString("utf8");
        const parts = encrypted.split(":");

        if (parts.length !== 3) {
            throw new Error("Invalid encrypted stream URL format");
        }

        const [ivB64, ctB64, tagB64] = parts;
        const iv = Buffer.from(ivB64, "base64");
        const ciphertext = Buffer.from(ctB64, "base64");
        const tag = Buffer.from(tagB64, "base64");

        const decipher = crypto.createDecipheriv("aes-256-gcm", serverKey, iv);
        decipher.setAuthTag(tag);
        const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);

        return plaintext.toString("utf8");
    } catch (error) {
        throw new Error(`Failed to decrypt stream URL: ${error.message}`);
    }
}

/**
 * Resolve the final URL after following redirects, without downloading the body.
 *
 * Every address on the way is checked, so an addon cannot use a stream link
 * to make this server call something it should not. Returns null when this
 * install will not fetch the address - the caller must not hand out a link
 * for it.
 */
async function getRedirectedUrl(url) {
    const policy = instancePolicy();
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10_000); // 10s timeout

    try {
        const response = await safeFetch(
            url,
            {
                headers: {
                    "User-Agent": "Mozilla/5.0 (compatible; SlickSync/1.0)",
                },
                method: "GET",
                signal: controller.signal,
            },
            policy
        );
        const finalUrl = response.url || url;
        // Don't download body: cancel the stream
        if (response.body) {
            await response.body.cancel();
        }
        return finalUrl;
    } catch (error) {
        if (REFUSED_ADDRESS.has(error.message)) {
            console.warn(`[StreamProxy] Not proxying a stream address: ${error.message}`);
            return null;
        }
        console.warn(`[StreamProxy] Failed to resolve redirect for ${url}: ${error.message}`);
        // The host was slow or unreachable, not refused. The original address is
        // still fine to hand out as long as it passes the same check - it is
        // checked again, hop by hop, when the stream is played.
        try {
            await assertSafeUrl(url, policy);
            return url;
        } catch {
            return null;
        }
    } finally {
        clearTimeout(timeoutId);
    }
}

/**
 * Process a stream response to encrypt stream URLs
 * This transforms the streams array to use encrypted proxy URLs
 */
async function processStreamResponse(data, serverKey, proxyBaseUrl) {
    try {
        const json = typeof data === "string" ? JSON.parse(data) : data;

        // Only process if this looks like a stream response
        if (!json || typeof json !== "object") {
            return data;
        }

        // Handle streams array
        if (Array.isArray(json.streams)) {
            // Process streams in parallel
            json.streams = await Promise.all(
                json.streams.map(async (stream) => {
                    if (!stream || typeof stream !== "object") {
                        return stream;
                    }

                    // Encrypt the URL field if present
                    if (stream.url && typeof stream.url === "string") {
                        try {
                            console.log(
                                `[StreamProxy] Resolving redirect for URL: ${stream.url.substring(0, 100)}...`
                            );
                            // Resolve the final URL (follow redirects)
                            const resolvedUrl = await getRedirectedUrl(stream.url);
                            // An address this install will not fetch keeps the link the addon
                            // gave, so the player can still try it from its own network.
                            if (resolvedUrl) {
                                console.log(
                                    `[StreamProxy] Resolved to: ${resolvedUrl.substring(0, 100)}...`
                                );

                                const encryptedUrl = encryptStreamUrl(resolvedUrl, serverKey);
                                stream.url = `${proxyBaseUrl}/stream/${encryptedUrl}`;
                            }
                        } catch (e) {
                            console.error("[StreamProxy] Failed to process stream URL:", e.message);
                            // Keep original URL if encryption/resolution fails
                        }
                    }

                    // Encrypt externalUrl if present (some addons use this)
                    // We probably should resolve this too if it's treated as a stream source,
                    // but instructions focused on "stream links". adhering to pattern for safety.
                    if (stream.externalUrl && typeof stream.externalUrl === "string") {
                        try {
                            const resolvedExternalUrl = await getRedirectedUrl(stream.externalUrl);
                            if (resolvedExternalUrl) {
                                const encryptedUrl = encryptStreamUrl(
                                    resolvedExternalUrl,
                                    serverKey
                                );
                                stream.externalUrl = `${proxyBaseUrl}/stream/${encryptedUrl}`;
                            }
                        } catch (e) {
                            console.error("Failed to encrypt externalUrl:", e.message);
                            // Keep original URL if encryption fails
                        }
                    }

                    return stream;
                })
            );
        }

        return JSON.stringify(json);
    } catch (error) {
        // If parsing fails, return original data
        console.warn("Failed to process stream response:", error.message);
        return data;
    }
}

/**
 * Get the real client IP address
 */
function getClientIp(req) {
    const forwarded = req.get("x-forwarded-for");
    if (forwarded) {
        return forwarded.split(",")[0].trim();
    }
    return req.get("x-real-ip") || req.get("cf-connecting-ip") || req.ip;
}

module.exports = ({ getServerKey }) => {
    const router = express.Router();
    const serverKey = getServerKey();

    // CORS preflight
    router.options("/:encryptedUrl(*)", (_req, res) => {
        setCorsHeaders(res);
        res.status(204).end();
    });

    // GET /:encryptedUrl - decrypt and redirect to actual stream
    router.get("/:encryptedUrl(*)", async (req, res) => {
        const startTime = Date.now();
        const encryptedUrl = req.params.encryptedUrl;
        let targetUrl = null;
        let resolvedUrl = null;
        let errorMessage = null;

        // Helper to log request on finish
        const logRequest = () => {
            const responseTimeMs = Date.now() - startTime;
            logProxyRequest({
                addon: { name: "Stream Proxy" }, // Generic name as we don't know the specific addon here
                cacheHit: false,
                error: errorMessage,
                ip: getClientIp(req),
                method: req.method,
                path: "/stream",
                responseTimeMs,
                statusCode: res.statusCode,
                upstreamUrl: resolvedUrl || targetUrl,
                url: `${req.protocol}://${req.get("host")}/stream/${encryptedUrl}`,
                userAgent: req.get("user-agent"),
            });
        };

        res.on("finish", logRequest);

        console.log(
            `[StreamProxy] Received request for encrypted URL: ${encryptedUrl.substring(0, 50)}...`
        );

        try {
            setCorsHeaders(res);

            // Decrypt the target URL
            try {
                targetUrl = decryptStreamUrl(encryptedUrl, serverKey);
                console.log(`[StreamProxy] Decrypted URL: ${targetUrl.substring(0, 100)}...`);
            } catch (e) {
                errorMessage = "Invalid or expired stream URL";
                console.error("[StreamProxy] Error decrypting stream URL:", e.message);
                return res.status(400).json({ error: errorMessage });
            }

            // Proxy the request to the target URL
            console.log(`[StreamProxy] Proxying content from: ${targetUrl.substring(0, 100)}...`);

            const fetchHeaders = {
                Accept: req.get("Accept") || "*/*",
                "User-Agent": req.get("User-Agent") || "SlickSync-Proxy/1.0",
            };

            // Forward Range header if present (critical for seeking)
            if (req.headers.range) {
                fetchHeaders.Range = req.headers.range;
            }

            // The player going away - every seek, every stop - ends the upstream
            // request with it. Left alone, the download from the debrid or CDN host
            // would run on to the end of the file with nobody reading it.
            const upstreamAbort = new AbortController();
            const playerGone = () => {
                if (!res.writableFinished) {
                    upstreamAbort.abort();
                }
            };
            // Bun does not report a dropped connection on the response, only on
            // the socket; Node reports it on both. The socket listener comes off
            // again once this response is done, since keep-alive reuses the socket.
            const socket = req.socket;
            const forgetSocket = () => socket?.off("close", playerGone);
            socket?.once("close", playerGone);
            res.once("close", playerGone);
            res.once("close", forgetSocket);
            res.once("finish", forgetSocket);

            try {
                // Every address on the way is checked, here and not only when the
                // link was handed out: a name can point somewhere else by now, and a
                // public host can answer with a redirect to an internal one.
                const upstreamResponse = await safeFetch(
                    targetUrl,
                    {
                        headers: fetchHeaders,
                        method: "GET",
                        signal: upstreamAbort.signal,
                    },
                    instancePolicy()
                );

                // Capture the final URL (after redirects)
                resolvedUrl = upstreamResponse.url;
                if (resolvedUrl !== targetUrl) {
                    console.log(`[StreamProxy] Redirected to: ${resolvedUrl.substring(0, 100)}...`);
                }

                // Forward status code
                res.status(upstreamResponse.status);

                // Forward relevant headers
                const headersToForward = [
                    "content-type",
                    "content-length",
                    "content-range",
                    "accept-ranges",
                    "cache-control",
                    "last-modified",
                    "etag",
                    "content-disposition",
                ];

                let hasContentDisposition = false;
                headersToForward.forEach((header) => {
                    const value = upstreamResponse.headers.get(header);
                    if (value) {
                        res.set(header, value);
                        if (header === "content-disposition") {
                            hasContentDisposition = true;
                        }
                    }
                });

                // If upstream didn't send a filename, try to derive one from the URL
                if (!hasContentDisposition) {
                    try {
                        const urlObj = new URL(resolvedUrl || targetUrl);
                        const pathname = urlObj.pathname;
                        const filename = pathname.split("/").pop();

                        if (filename?.includes(".")) {
                            // Simple cleanup to ensure it's a valid filename
                            const cleanFilename = decodeURIComponent(filename).replace(
                                /["\\]/g,
                                ""
                            );
                            res.set("Content-Disposition", `inline; filename="${cleanFilename}"`);
                        }
                    } catch {
                        // Ignore errors in filename generation
                    }
                }

                // Pipe the response body. pipeline (not pipe) so an upstream that
                // drops mid-file closes the player's connection instead of leaving it
                // hanging, and so the error is handled here rather than thrown.
                if (upstreamResponse.body) {
                    pipeline(Readable.fromWeb(upstreamResponse.body), res, (pipeError) => {
                        if (pipeError && !upstreamAbort.signal.aborted) {
                            console.warn("[StreamProxy] Upstream ended early:", pipeError.message);
                        }
                    });
                } else {
                    res.end();
                }
            } catch (fetchError) {
                // The player left before the upstream answered - nobody to reply to.
                if (upstreamAbort.signal.aborted) {
                    return;
                }
                if (REFUSED_ADDRESS.has(fetchError.message)) {
                    console.warn(`[StreamProxy] Refused stream address: ${fetchError.message}`);
                    errorMessage = "This stream address cannot be used";
                    if (!res.headersSent) {
                        res.status(403).json({ error: errorMessage });
                    }
                    return;
                }
                console.error("[StreamProxy] Error fetching upstream:", fetchError);
                errorMessage = "Error fetching upstream content";
                if (!res.headersSent) {
                    res.status(502).json({ error: errorMessage });
                }
            }
        } catch (error) {
            console.error("[StreamProxy] Error in stream proxy:", error);
            errorMessage = "Internal server error";
            if (!res.headersSent) {
                res.status(500).json({ error: errorMessage });
            }
        }
    });

    return {
        decryptStreamUrl,
        encryptStreamUrl,
        processStreamResponse,
        router,
    };
};
