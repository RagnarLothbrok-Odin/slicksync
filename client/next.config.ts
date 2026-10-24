import fs from "node:fs";
import path from "node:path";
import type { NextConfig } from "next";

// Resolve app version (prefer package.json, then manifest, then server/version.js)
// package.json is checked first because it's the one file every release
// patch reliably bumps - .release-please-manifest.json and
// server/version.js are managed by a separate tool (release-please) that
// isn't part of this fork's manual patch workflow, so they drift stale
// silently if a release skips running it. Falling back to them only when
// package.json is missing avoids the version badge getting stuck on an
// old number even though newer code is genuinely running.
let APP_VERSION = "dev";
try {
    // 1) Prefer root package.json
    try {
        const pkgRaw = fs.readFileSync(
            path.join(import.meta.dirname, "..", "package.json"),
            "utf8"
        );
        const pkg = JSON.parse(pkgRaw);
        if (pkg.version) {
            APP_VERSION = pkg.version;
        }
    } catch {
        // Malformed optional data leaves the existing fallback in place.
    }

    // 2) Fallback to .release-please-manifest.json (manifest mode)
    if (APP_VERSION === "dev") {
        try {
            const manifestPath = path.join(
                import.meta.dirname,
                "..",
                ".release-please-manifest.json"
            );
            if (fs.existsSync(manifestPath)) {
                const manifestRaw = fs.readFileSync(manifestPath, "utf8");
                const manifestJson = JSON.parse(manifestRaw);
                if (manifestJson && typeof manifestJson["."] === "string" && manifestJson["."]) {
                    APP_VERSION = manifestJson["."];
                }
            }
        } catch {
            // Malformed optional data leaves the existing fallback in place.
        }
    }

    // 3) Fallback to server/version.js (managed by release-please extra-files)
    if (APP_VERSION === "dev") {
        try {
            const serverRaw = fs.readFileSync(
                path.join(import.meta.dirname, "..", "server", "version.js"),
                "utf8"
            );
            const m = serverRaw.match(/VERSION\s*=\s*'([^']+)'/);
            if (m?.[1]) {
                APP_VERSION = m[1];
            }
        } catch {
            // Unavailable optional files leave the existing fallback in place.
        }
    }
} catch {
    // Malformed optional data leaves the existing fallback in place.
}

// The build stamp the Dockerfile writes just before `next build`, so every
// page knows which build it came from (components/pwa/BuildWatcher.tsx). Read
// from a file rather than made here: this config can be evaluated more than
// once per build, and two different stamps would make every tab think it is
// out of date. No file (local dev) means no checking.
let BUILD_STAMP = "dev";
try {
    const raw = fs.readFileSync(path.join(import.meta.dirname, ".build-stamp"), "utf8").trim();
    if (raw) {
        BUILD_STAMP = raw;
    }
} catch {
    // Unavailable optional files leave the existing fallback in place.
}

const nextConfig: NextConfig = {
    env: {
        NEXT_PUBLIC_APP_VERSION: APP_VERSION,
        NEXT_PUBLIC_BUILD_STAMP: BUILD_STAMP,
        NEXT_PUBLIC_INSTANCE_TYPE: process.env.INSTANCE || "private",
    },
    // Requests to the backend go through Next's rewrite proxy, whose default
    // patience is 30 seconds. Describe-it search waits up to 45 seconds for a
    // model to answer (slower and free-tier models genuinely take that long),
    // so a slow answer used to be cut off by the proxy first and surface as a
    // bare "HTTP 500" with no message. The proxy now outlasts the slowest
    // backend request rather than the other way round.
    experimental: {
        proxyTimeout: 60_000,
    },
    // A self-contained server (.next/standalone) carrying only the packages the
    // pages actually use. The image used to ship this folder's whole
    // node_modules - about 760 MB of a 2 GB image - just to run `next start`.
    // scripts/start.sh runs the standalone server when it is there.
    output: "standalone",
    // Bun hoists workspace dependencies to the repository root. Resolution and
    // standalone tracing must include that root so production builds include them.
    outputFileTracingRoot: path.join(import.meta.dirname, ".."),
    // The Guides section used to live at /help. Keep the old paths working
    // rather than 404ing anyone with a bookmark, an open tab from before the
    // rename, or a link shared in Discord.
    async redirects() {
        return [
            { destination: "/guides", permanent: true, source: "/help" },
            { destination: "/guides/:id", permanent: true, source: "/help/:id" },
        ];
    },
    async rewrites() {
        return [
            // Main API routes
            {
                destination: "http://localhost:4000/api/:path*",
                source: "/api/:path*",
            },
            // Uploaded avatar images (served statically by the backend)
            {
                destination: "http://localhost:4000/uploads/:path*",
                source: "/uploads/:path*",
            },
            // Addon proxy (server/routes/proxy.js) - the whole point of the
            // feature is handing out a URL on THIS host that hides the addon's
            // real manifest URL, and Stremio/Nuvio fetch it unauthenticated from
            // outside. Without this rewrite that URL reached Next.js instead of
            // the backend and returned a 404 HTML page, so every proxied addon
            // was dead on arrival - the backend route itself was fine and
            // answered correctly on its own port the whole time.
            {
                destination: "http://localhost:4000/proxy/:path*",
                source: "/proxy/:path*",
            },
            // SlickTrax Addon (server/routes/traxAddon.js) - same reasoning as
            // /proxy above: Stremio apps fetch this path on the public port, and
            // the backend owns it.
            {
                destination: "http://localhost:4000/trax/:path*",
                source: "/trax/:path*",
            },
            // Public invite routes (no auth required)
            {
                destination: "http://localhost:4000/invite/:inviteCode/check",
                source: "/invite/:inviteCode/check",
            },
            {
                destination: "http://localhost:4000/invite/:inviteCode/request",
                source: "/invite/:inviteCode/request",
            },
            {
                destination: "http://localhost:4000/invite/:inviteCode/status",
                source: "/invite/:inviteCode/status",
            },
            {
                destination: "http://localhost:4000/invite/:inviteCode/generate-oauth",
                source: "/invite/:inviteCode/generate-oauth",
            },
            {
                destination: "http://localhost:4000/invite/:inviteCode/complete",
                source: "/invite/:inviteCode/complete",
            },
            {
                destination: "http://localhost:4000/invite/:inviteCode/user-info",
                source: "/invite/:inviteCode/user-info",
            },
            // Nuvio device sign-in for someone joining by invite. Listed here for
            // the same reason every sibling above is: /invite/:code is a real page
            // in this app, so anything under it that the backend owns has to be
            // named explicitly or Next.js answers with its own 404.
            {
                destination: "http://localhost:4000/invite/:inviteCode/nuvio/start",
                source: "/invite/:inviteCode/nuvio/start",
            },
            {
                destination: "http://localhost:4000/invite/:inviteCode/nuvio/poll",
                source: "/invite/:inviteCode/nuvio/poll",
            },
            // Joining with a Jellyfin-compatible server: checking the address and
            // Quick Connect (routes/invitations.js), for the same reason.
            {
                destination: "http://localhost:4000/invite/:inviteCode/jellyfin/:step",
                source: "/invite/:inviteCode/jellyfin/:step",
            },
            // Public user deletion routes
            {
                destination: "http://localhost:4000/invite/generate-oauth",
                source: "/invite/generate-oauth",
            },
            {
                destination: "http://localhost:4000/invite/delete-user",
                source: "/invite/delete-user",
            },
        ];
    },
    turbopack: { root: path.join(import.meta.dirname, "..") },
};

export default nextConfig;
