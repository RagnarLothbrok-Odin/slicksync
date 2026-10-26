const { createTrackingOAuth } = require("./trackingOAuth");

function createSimklTracking(options) {
    return createTrackingOAuth(
        {
            api: "https://api.simkl.com",
            authorizeUrl: "https://simkl.com/oauth2/authorize",
            identify: (profile) =>
                Number.isSafeInteger(profile?.account?.id) && profile.account.id > 0
                    ? String(profile.account.id)
                    : null,
            issuer: "https://simkl.com",
            name: "Simkl",
            profilePath: "/users/settings",
            provider: "simkl",
            requestMetadata: true,
            revokePath: "/oauth2/revoke",
            scope: "media:read",
            tokenPath: "/oauth2/token",
            username: (profile) => profile.user?.name,
        },
        options
    );
}
module.exports = { ...createSimklTracking(), createSimklTracking };
