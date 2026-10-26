const { createTrackingOAuth } = require("./trackingOAuth");

function createMdblistTracking(options) {
    return createTrackingOAuth(
        {
            acceptedScopes: ["read", "write"],
            api: "https://api.mdblist.com",
            authorizeUrl: "https://mdblist.com/oauth/authorize/",
            identify: (profile) =>
                Number.isSafeInteger(profile?.user_id) && profile.user_id > 0
                    ? String(profile.user_id)
                    : null,
            maxCooldownMs: 86_400_000,
            name: "MDBList",
            oauthForm: true,
            profilePath: "/user",
            provider: "mdblist",
            revokePath: "/oauth/revoke_token/",
            // MDBList currently exposes only this broad OAuth scope. Media reads
            // remain GET-only, even though the consent grant also permits writes.
            scope: "write",
            scopeOptional: true,
            tokenPath: "/oauth/token/",
            username: (profile) => profile.username || profile.name,
            verifyAccessPath: "/sync/last_activities",
        },
        options
    );
}
module.exports = { ...createMdblistTracking(), createMdblistTracking };
