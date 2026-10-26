import type { JellyfinSignInApi } from "@/components/jellyfin/JellyfinSignIn";
import type { PlaybackEvidence } from "./playback";
import type { StremioManifest } from "./stremio-manifest";

/**
 * User Panel API Client
 *
 * API methods for the user panel (non-admin). Uses Stremio OAuth for authentication.
 * All endpoints are under /public-library/* and don't require admin auth.
 */

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "/api";

// Custom error class for API errors
export class UserApiError extends Error {
    status: number;

    constructor(message: string, status: number) {
        super(message);
        this.name = "UserApiError";
        this.status = status;
        // Fix prototype chain for proper instanceof checks in browsers
        Object.setPrototypeOf(this, UserApiError.prototype);
    }
}

// Helper to make API requests
async function request<T>(
    endpoint: string,
    options: RequestInit & { authKey?: string } = {}
): Promise<T> {
    const url = `${API_BASE}${endpoint}`;
    const { authKey, ...fetchOptions } = options;

    const headers: Record<string, string> = {
        "Content-Type": "application/json",
        ...(fetchOptions.headers as Record<string, string>),
    };

    if (authKey) {
        headers["x-stremio-auth"] = authKey;
    }

    const response = await fetch(url, {
        ...fetchOptions,
        headers,
    });

    if (!response.ok) {
        const error = await response.json().catch(() => ({ message: "Request failed" }));
        throw new UserApiError(
            error.message || error.error || `HTTP ${response.status}`,
            response.status
        );
    }

    return response.json();
}

// Types
export interface UserInfo {
    activityVisibility: "public" | "private";
    avatarUrl?: string | null;
    colorIndex?: number;
    createdAt: string;
    discordWebhookUrl?: string | null;
    email: string;
    expiresAt?: string;
    groupId?: string | null;
    groupName?: string | null;
    groups?: Array<{ id: string; name: string }>;
    id: string;
    notifyOnWatch?: boolean;
    publicStatsEnabled?: boolean;
    publicStatsSlug?: string | null;
    /** They switched Gravatar on, so their avatar may look their email up there. */
    useGravatar?: boolean;
    username: string;
}

export interface LibraryItem {
    _id: string;
    _mtime?: string | number;
    background?: string;
    id?: string;
    name: string;
    poster?: string;
    progress?: number;
    removed?: boolean | 0 | 1 | null;
    state?: {
        timeOffset?: number;
        overallTimeWatched?: number;
        lastWatched?: string;
        video_id?: string;
        season?: number;
        episode?: number;
    };
    type: "movie" | "series";
}

export interface GroupAddon {
    description?: string;
    id: string;
    isExcluded?: boolean;
    isProtected?: boolean;
    logo?: string;
    manifestUrl: string;
    name: string;
}

export interface StremioAddon {
    flags?: {
        official?: boolean;
        protected?: boolean;
    };
    manifest: {
        id: string;
        name: string;
        description?: string;
        version?: string;
        logo?: string;
    };
    transportName?: string;
    transportUrl: string;
}

export interface Share {
    createdAt: string;
    fromUserId: string;
    fromUsername?: string;
    id: string;
    itemId: string;
    itemName: string;
    itemType: "movie" | "series";
    poster?: string;
    toUserId: string;
    toUsername?: string;
    viewedAt?: string;
}

export interface GroupMember {
    colorIndex?: number;
    email: string;
    id: string;
    username: string;
}

// OAuth API
export const userOAuth = {
    /**
     * Generate a new OAuth link for Stremio authentication
     */
    async create(): Promise<{ code: string; link: string; expiresAt: number }> {
        const result = await request<{ code: string; link: string; expiresAt: string }>(
            "/public-library/generate-oauth",
            { method: "POST" }
        );
        return {
            code: result.code,
            expiresAt: new Date(result.expiresAt).getTime(),
            link: result.link,
        };
    },

    /**
     * Start Nuvio's device-code login flow. Unlike Stremio's simple 2-step
     * link (code -> authKey), Nuvio needs a 3-step anon-Supabase-session
     * dance - the caller must hold onto anonToken/deviceNonce and pass them
     * back into pollNuvio/exchangeNuvio.
     */
    async createNuvio(): Promise<{
        code: string;
        webUrl: string;
        expiresAt: string;
        pollIntervalSeconds: number;
        anonToken: string;
        deviceNonce: string;
    }> {
        return request("/public-library/generate-oauth-nuvio", { method: "POST" });
    },

    /**
     * Poll for OAuth completion
     */
    async poll(
        code: string
    ): Promise<{ success: boolean; authKey: string | null; error?: string }> {
        return request("/public-library/poll-oauth", {
            body: JSON.stringify({ code }),
            method: "POST",
        });
    },

    /**
     * Poll a Nuvio login session for approval status.
     */
    async pollNuvio(
        code: string,
        deviceNonce: string,
        anonToken: string
    ): Promise<{
        success: boolean;
        status?: string;
        expiresAt?: string;
        pollIntervalSeconds?: number;
        error?: string;
    }> {
        return request("/public-library/poll-oauth-nuvio", {
            body: JSON.stringify({ anonToken, code, deviceNonce }),
            method: "POST",
        });
    },
};

// User Authentication API
export const userAuth = {
    /**
     * Authenticate with Stremio auth key and get/create user
     */
    async authenticate(authKey: string): Promise<{
        success: boolean;
        userId: string;
        userInfo: UserInfo;
        isNewUser?: boolean;
        error?: string;
        errorCode?: string;
    }> {
        const response = await request<{
            success: boolean;
            user?: {
                id: string;
                username: string;
                email: string;
                colorIndex?: number;
                createdAt?: string;
                expiresAt?: string;
                groupId?: string | null;
                groups?: Array<{ id: string; name: string }>;
                groupName?: string | null;
                activityVisibility?: "public" | "private";
            };
            isNewUser?: boolean;
            error?: string;
            errorCode?: string;
        }>("/public-library/authenticate", {
            body: JSON.stringify({ authKey }),
            method: "POST",
        });

        // Transform response to expected format
        if (response.success && response.user) {
            return {
                isNewUser: response.isNewUser,
                success: true,
                userId: response.user.id,
                userInfo: {
                    activityVisibility: response.user.activityVisibility || "private",
                    colorIndex: response.user.colorIndex,
                    createdAt: response.user.createdAt || new Date().toISOString(),
                    email: response.user.email,
                    expiresAt: response.user.expiresAt,
                    groupId: response.user.groupId,
                    groupName: response.user.groupName,
                    id: response.user.id,
                    username: response.user.username,
                },
            };
        }

        return {
            error: response.error || "Authentication failed",
            errorCode: response.errorCode,
            success: false,
            userId: "",
            userInfo: {} as UserInfo,
        };
    },

    /**
     * Sign in through a Jellyfin-compatible server (a real Jellyfin, or the
     * media server AIOStreams or AIOMetadata runs). The server signs in with
     * what the person typed - or an approved Quick Connect secret - and hands
     * back a SlickSync session token, the role Stremio's authKey plays.
     */
    async authenticateJellyfin(credentials: Record<string, string>): Promise<{
        success: boolean;
        userId: string;
        userInfo: UserInfo;
        sessionToken: string;
        error?: string;
        errorCode?: string;
    }> {
        const response = await request<{
            success: boolean;
            sessionToken?: string;
            user?: {
                id: string;
                username: string;
                email: string;
                colorIndex?: number;
                createdAt?: string;
                expiresAt?: string;
            };
            error?: string;
            message?: string;
        }>("/public-library/authenticate-jellyfin", {
            body: JSON.stringify(credentials),
            method: "POST",
        });
        if (response.success && response.user && response.sessionToken) {
            return {
                sessionToken: response.sessionToken,
                success: true,
                userId: response.user.id,
                userInfo: {
                    activityVisibility: "private",
                    colorIndex: response.user.colorIndex,
                    createdAt: response.user.createdAt || new Date().toISOString(),
                    email: response.user.email,
                    expiresAt: response.user.expiresAt,
                    id: response.user.id,
                    username: response.user.username,
                },
            };
        }
        return {
            error: response.message || response.error || "Authentication failed",
            errorCode: response.error,
            sessionToken: "",
            success: false,
            userId: "",
            userInfo: {} as UserInfo,
        };
    },

    /**
     * Exchange a completed Nuvio device-code login for a session (mirrors
     * `authenticate` above, but Nuvio's exchange result - not a client-held
     * credential - is itself the proof of identity).
     */
    async authenticateNuvio(
        code: string,
        deviceNonce: string,
        anonToken: string
    ): Promise<{
        success: boolean;
        userId: string;
        userInfo: UserInfo;
        sessionToken: string;
        error?: string;
        errorCode?: string;
    }> {
        const response = await request<{
            success: boolean;
            sessionToken?: string;
            user?: {
                id: string;
                username: string;
                email: string;
                colorIndex?: number;
                createdAt?: string;
                expiresAt?: string;
            };
            error?: string;
            message?: string;
        }>("/public-library/authenticate-nuvio", {
            body: JSON.stringify({ anonToken, code, deviceNonce }),
            method: "POST",
        });

        if (response.success && response.user && response.sessionToken) {
            return {
                sessionToken: response.sessionToken,
                success: true,
                userId: response.user.id,
                userInfo: {
                    activityVisibility: "private",
                    colorIndex: response.user.colorIndex,
                    createdAt: response.user.createdAt || new Date().toISOString(),
                    email: response.user.email,
                    expiresAt: response.user.expiresAt,
                    id: response.user.id,
                    username: response.user.username,
                },
            };
        }

        return {
            error: response.message || response.error || "Authentication failed",
            errorCode: response.error,
            sessionToken: "",
            success: false,
            userId: "",
            userInfo: {} as UserInfo,
        };
    },

    /**
     * Self-service "delete my account" - permanently removes this user and
     * their own data (watch history, watchlist state, group membership).
     * Does NOT touch account-wide resources (Vault, Catalogs, other users) -
     * that's the separate admin-level Settings > Danger Zone delete. Re-proves
     * the live session server-side, so Stremio users must pass their current
     * authKey; Nuvio users are re-validated by userId alone (mirrors validate/
     * validateNuvio above).
     */
    async deleteAccount(
        userId: string,
        provider: "stremio" | "nuvio" | "jellyfin",
        authKey?: string
    ): Promise<{ deleted: boolean }> {
        return request("/public-library/delete-account", {
            authKey,
            body: JSON.stringify({ provider, userId }),
            method: "POST",
        });
    },
    async disablePublicStats(userId: string, authKey: string): Promise<{ success: boolean }> {
        return request("/public-library/public-stats/disable", {
            authKey,
            body: JSON.stringify({ userId }),
            method: "POST",
        });
    },

    /**
     * Enable/disable the public, unauthenticated stats share link. Enabling
     * returns the slug (not the full URL) - the caller builds the shareable
     * link from it. Distinct from activityVisibility above (household-only).
     */
    async enablePublicStats(userId: string, authKey: string): Promise<{ slug: string }> {
        return request("/public-library/public-stats/enable", {
            authKey,
            body: JSON.stringify({ userId }),
            method: "POST",
        });
    },

    async getUserInfo(userId: string, authKey?: string): Promise<UserInfo> {
        const params = new URLSearchParams({ userId });
        return request(`/public-library/user-info?${params.toString()}`, { authKey });
    },

    /** The steps before a Jellyfin sign-in: checking the address and Quick Connect. */
    jellyfinSignIn: {
        probe: (serverUrl: string) =>
            request<Awaited<ReturnType<JellyfinSignInApi["probe"]>>>(
                "/public-library/jellyfin-probe",
                {
                    body: JSON.stringify({ serverUrl }),
                    method: "POST",
                }
            ),
        quickConnectStatus: (params: { serverUrl: string; secret: string; device: string }) =>
            request<Awaited<ReturnType<JellyfinSignInApi["quickConnectStatus"]>>>(
                "/public-library/jellyfin-quick-connect-status",
                {
                    body: JSON.stringify(params),
                    method: "POST",
                }
            ),
        startQuickConnect: (serverUrl: string) =>
            request<Awaited<ReturnType<JellyfinSignInApi["startQuickConnect"]>>>(
                "/public-library/jellyfin-quick-connect",
                {
                    body: JSON.stringify({ serverUrl }),
                    method: "POST",
                }
            ),
    },

    /**
     * Update activity visibility
     */
    async updateActivityVisibility(
        userId: string,
        authKey: string,
        visibility: "public" | "private"
    ): Promise<{ success: boolean }> {
        return request("/public-library/activity-visibility", {
            authKey,
            body: JSON.stringify({ activityVisibility: visibility, userId }),
            method: "PATCH",
        });
    },

    /**
     * Get current user's info
     */
    async updateProfile(
        userId: string,
        authKey: string,
        data: { avatarUrl?: string | null; colorIndex?: number }
    ) {
        return request("/public-library/user-settings", {
            authKey,
            body: JSON.stringify({ userId, ...data }),
            method: "PATCH",
        });
    },

    async uploadAvatar(userId: string, authKey: string, file: File): Promise<{ url: string }> {
        const form = new FormData();
        form.append("avatar", file);
        const response = await fetch(
            `${API_BASE}/public-library/avatars/upload?${new URLSearchParams({ userId })}`,
            { body: form, headers: { "x-stremio-auth": authKey }, method: "POST" }
        );
        if (!response.ok) {
            throw new Error("Could not upload your picture");
        }
        return response.json();
    },

    /**
     * Validate user session
     */
    async validate(
        authKey: string,
        userId: string
    ): Promise<{
        valid: boolean;
        userId?: string;
        sessionToken?: string;
        error?: string;
        errorCode?: string;
    }> {
        const response = await request<{
            valid?: boolean;
            success?: boolean;
            userId?: string;
            error?: string;
            errorCode?: string;
        }>("/public-library/validate", {
            body: JSON.stringify({ authKey, userId }),
            method: "POST",
        });

        return {
            error: response.error,
            errorCode: response.errorCode,
            userId: response.userId,
            valid: response.valid ?? response.success ?? false,
        };
    },

    /** Re-validate a stored Jellyfin session (mirrors validateNuvio). */
    async validateJellyfin(
        userId: string,
        sessionToken?: string
    ): Promise<{
        valid: boolean;
        userId?: string;
        sessionToken?: string;
        error?: string;
        errorCode?: string;
    }> {
        const response = await request<{
            valid?: boolean;
            success?: boolean;
            sessionToken?: string;
            user?: { id: string };
            error?: string;
            message?: string;
        }>("/public-library/validate-jellyfin", {
            authKey: sessionToken,
            body: JSON.stringify({ userId }),
            method: "POST",
        });
        return {
            error: response.message || response.error,
            errorCode: response.error,
            sessionToken: response.sessionToken,
            userId: response.user?.id,
            valid: response.valid ?? response.success ?? false,
        };
    },

    /**
     * Re-validate a Nuvio user's stored session (mirrors `validate` above).
     * Requires the caller's own previously-issued session token - proof of
     * possession, not just a bare userId (which used to be sufficient to
     * "restore" a session as literally anyone, since nothing checked the
     * caller actually held any credential of their own). Returns a freshly
     * reissued token on success (sliding expiry), same pattern as
     * refreshUserInfo elsewhere in this file.
     */
    async validateNuvio(
        userId: string,
        sessionToken?: string
    ): Promise<{
        valid: boolean;
        userId?: string;
        sessionToken?: string;
        error?: string;
        errorCode?: string;
    }> {
        const response = await request<{
            valid?: boolean;
            success?: boolean;
            sessionToken?: string;
            user?: { id: string };
            error?: string;
            message?: string;
        }>("/public-library/validate-nuvio", {
            authKey: sessionToken,
            body: JSON.stringify({ userId }),
            method: "POST",
        });

        return {
            error: response.message || response.error,
            errorCode: response.error,
            sessionToken: response.sessionToken,
            userId: response.user?.id,
            valid: response.valid ?? response.success ?? false,
        };
    },
};

// Activity types
export interface WatchSession {
    durationSeconds: number;
    endTime?: string;
    episode?: number;
    id: string;
    isActive: boolean;
    isSynthetic?: boolean;
    itemId: string;
    itemName: string;
    itemType: "movie" | "series";
    poster?: string;
    season?: number;
    startTime: string;
    type: "session" | "episode";
    userColorIndex?: number;
    userEmail?: string;
    userId: string;
    username: string;
    videoId?: string;
}

export interface UserActivityStats {
    avgWatchTimeHours: number;
    avgWatchTimeSeconds: number;
    currentStreak?: number;
    episodesCount?: number;
    episodesTodayCount?: number;
    longestStreak?: number;
    moviesCount: number;
    recentItemsCount: number;
    seriesCount: number;
    totalSessions: number;
    totalWatchTimeHours: number;
    totalWatchTimeSeconds: number;
    watchedTodayCount: number;
    watchTimeTodayHours: number;
    watchTimeTodaySeconds: number;
}

export interface WatchTimeByDay {
    date: string;
    hours: number;
    minutes: number;
    movies: number;
    series: number;
    total: number;
}

export interface MostWatchedItem {
    count: number;
    id: string;
    name: string;
    poster?: string;
    totalDuration: number;
    type: string;
}

export interface BingeWatch {
    date: string;
    episodeCount: number;
    name: string;
    poster?: string;
    totalDuration: number;
}

export interface NowPlayingItem {
    elapsedFrozen?: boolean;
    elapsedSeconds?: number | null;
    item: {
        id: string;
        name: string;
        type: string;
        poster?: string | null;
        background?: string | null;
        thumbnail?: string | null;
        description?: string | null;
        episodeTitle?: string | null;
        season?: number;
        episode?: number;
    };
    /** Native playback checkpoints and runtime are milliseconds. */
    lastPosition?: number | null;
    playback?: PlaybackEvidence | null;
    startTime: string;
    totalDuration?: number | null;
    videoId?: string;
}

export interface UserActivityData {
    bingeWatches: BingeWatch[];
    episodeHistory: WatchSession[];
    mostWatched: MostWatchedItem | null;
    mostWatchedItems?: MostWatchedItem[];
    nowPlaying: NowPlayingItem[];
    sessions: WatchSession[];
    source?: "trakt" | "slicksync";
    sourceNote?: string;
    stats: UserActivityStats;
    todayAvailable?: boolean;
    user: {
        id: string;
        username: string;
        email: string;
        colorIndex?: number;
    };
    watchTimeByDay: WatchTimeByDay[];
}

// Activity API
export const userActivity = {
    /**
     * Get user's activity (watch sessions and stats)
     */
    async getActivity(
        userId: string,
        authKey?: string,
        limit = 100,
        home = false
    ): Promise<UserActivityData> {
        const params = new URLSearchParams({ home: String(home), limit: String(limit), userId });
        return request(`/public-library/activity?${params.toString()}`, {
            authKey,
            signal: AbortSignal.timeout(60_000),
        });
    },
};

// Data export
export interface UserExportData {
    episodeHistory: {
        showId: string;
        showName: string;
        videoId: string;
        season: number | null;
        episode: number | null;
        poster: string | null;
        watchedAt: string;
    }[];
    exportedAt: string;
    movieHistory: { itemId: string; itemName: string; poster: string | null; watchedAt: string }[];
    user: { username: string; email: string };
    watchlist: {
        itemId: string;
        itemType: string;
        name: string;
        poster: string | null;
        addedAt: string;
    }[];
}

export const userExport = {
    /**
     * Download this user's own watch history + household watchlist as JSON
     */
    async getExport(userId: string, authKey?: string): Promise<UserExportData> {
        const params = new URLSearchParams({ userId });
        return request(`/public-library/export?${params.toString()}`, { authKey });
    },
};

// Sync API
export interface AtRiskStatus {
    daysSinceActivity: number | null;
    lastActivity: string | null;
    lastSyncedAt: string | null;
    riskLevel: "healthy" | "warning" | "critical";
    riskReason: string | null;
    syncErrorMessage: string | null;
    syncStatus: string | null;
    userId: string;
}

export const userSync = {
    /**
     * Get user's at-risk status
     */
    async getAtRiskStatus(userId: string, authKey?: string): Promise<AtRiskStatus> {
        const params = new URLSearchParams({ userId });
        return request(`/public-library/at-risk-status?${params.toString()}`, { authKey });
    },
    /**
     * Sync user's addons
     */
    async sync(
        userId: string,
        authKey?: string
    ): Promise<{ success: boolean; message: string; details?: unknown }> {
        return request("/public-library/sync", {
            authKey,
            body: JSON.stringify({ userId }),
            method: "POST",
        });
    },
};

// Library API
export const userLibrary = {
    /**
     * Delete a library item
     */
    async deleteItem(
        userId: string,
        itemId: string,
        authKey?: string
    ): Promise<{ success: boolean }> {
        const params = new URLSearchParams({ userId });
        params.append("requestingUserId", userId);
        return request(
            `/public-library/library/${encodeURIComponent(itemId)}?${params.toString()}`,
            {
                authKey,
                method: "DELETE",
            }
        );
    },
    /**
     * Get user's library
     */
    async getLibrary(
        userId: string,
        authKey?: string
    ): Promise<{
        library: LibraryItem[];
        count: number;
    }> {
        const params = new URLSearchParams({ userId });
        // Pass requestingUserId as same user to indicate self-access
        params.append("requestingUserId", userId);
        return request(`/public-library/library?${params.toString()}`, { authKey });
    },
};

// Addons API
export const userAddons = {
    /**
     * Add an addon to Stremio and protect it
     */
    async addAddon(
        userId: string,
        addonUrl: string,
        manifestData?: Partial<StremioManifest>,
        authKey?: string
    ): Promise<{
        success: boolean;
        message: string;
    }> {
        return request("/public-library/add-addon", {
            authKey,
            body: JSON.stringify({ addonUrl, manifestData, userId }),
            method: "POST",
        });
    },

    /**
     * Exclude a group addon (don't sync to user)
     */
    async excludeAddon(
        userId: string,
        addonId: string,
        authKey?: string
    ): Promise<{ success: boolean }> {
        return request("/public-library/exclude-addon", {
            authKey,
            body: JSON.stringify({ addonId, userId }),
            method: "POST",
        });
    },
    /**
     * Get user's addons (group addons and Stremio addons)
     */
    async getAddons(
        userId: string,
        authKey?: string
    ): Promise<{
        groupAddons: GroupAddon[];
        stremioAddons: StremioAddon[];
        excludedAddonIds: string[];
        protectedAddonNames: string[];
    }> {
        const params = new URLSearchParams({ userId });
        return request(`/public-library/addons?${params.toString()}`, { authKey });
    },

    /**
     * Include a group addon (sync to user)
     */
    async includeAddon(
        userId: string,
        addonId: string,
        authKey?: string
    ): Promise<{ success: boolean }> {
        return request("/public-library/include-addon", {
            authKey,
            body: JSON.stringify({ addonId, userId }),
            method: "POST",
        });
    },

    /**
     * Remove an addon from Stremio
     */
    async removeAddon(
        userId: string,
        addonName: string,
        unsafe = false,
        authKey?: string
    ): Promise<{
        success: boolean;
    }> {
        return request(
            `/public-library/stremio-addons/${encodeURIComponent(addonName)}?userId=${userId}${unsafe ? "&unsafe=true" : ""}`,
            { authKey, method: "DELETE" }
        );
    },

    /**
     * Toggle addon protection status
     */
    async toggleProtect(
        userId: string,
        addonName: string,
        unsafe = false,
        authKey?: string
    ): Promise<{
        success: boolean;
        protected: boolean;
    }> {
        return request(`/public-library/protect-addon${unsafe ? "?unsafe=true" : ""}`, {
            authKey,
            body: JSON.stringify({ name: addonName, userId }),
            method: "POST",
        });
    },
};

// Shares API
export const userShares = {
    /**
     * Get group members for sharing
     */
    async getGroupMembers(userId: string, authKey?: string): Promise<{ members: GroupMember[] }> {
        const params = new URLSearchParams({ userId });
        return request(`/public-library/group-members?${params.toString()}`, { authKey });
    },
    /**
     * Get user's shares (sent and received)
     */
    async getShares(
        userId: string,
        authKey?: string
    ): Promise<{ sent: Share[]; received: Share[] }> {
        const params = new URLSearchParams({ userId });
        return request(`/public-library/shares?${params.toString()}`, { authKey });
    },

    /**
     * Mark a share as viewed
     */
    async markAsViewed(userId: string, shareId: string): Promise<{ success: boolean }> {
        return request(`/users/${userId}/shares/${shareId}/viewed`, { method: "PUT" });
    },

    /**
     * Remove a share
     */
    async removeShare(userId: string, shareId: string): Promise<{ success: boolean }> {
        return request(`/users/${userId}/shares/${shareId}`, { method: "DELETE" });
    },

    /**
     * Share items with other users
     */
    async shareItems(
        userId: string,
        items: Array<{ itemId: string; itemName?: string; itemType?: string; poster?: string }>,
        targetUserIds: string[]
    ): Promise<{ success: boolean; shareCount: number }> {
        return request(`/users/${userId}/shares`, {
            body: JSON.stringify({ items, targetUserIds }),
            method: "POST",
        });
    },
};

/**
 * Notifications on the person's own devices (PersonPushSubscription on the
 * server) - off until they turn them on, and never the admin's devices.
 */
/** Whether this person is paused right now by a daily limit or bedtime. */
export async function getOwnScreenTime(
    userId: string,
    authKey: string
): Promise<{ paused: { untilLabel: string; reason: "limit" | "bedtime" } | null }> {
    return request(`/public-library/screen-time?${new URLSearchParams({ userId })}`, { authKey });
}

export const userPush = {
    async status(
        userId: string,
        authKey: string,
        endpoint?: string
    ): Promise<{ enabled: boolean; publicKey: string | null; subscribed: boolean }> {
        const q = new URLSearchParams({ userId, ...(endpoint ? { endpoint } : {}) });
        return request(`/public-library/push/status?${q}`, { authKey });
    },
    async subscribe(
        userId: string,
        authKey: string,
        subscription: PushSubscriptionJSON
    ): Promise<{ success: boolean }> {
        return request("/public-library/push/subscribe", {
            authKey,
            body: JSON.stringify({
                subscription,
                userAgent: typeof navigator === "undefined" ? null : navigator.userAgent,
                userId,
            }),
            method: "POST",
        });
    },
    async unsubscribe(
        userId: string,
        authKey: string,
        endpoint: string
    ): Promise<{ success: boolean }> {
        return request("/public-library/push/unsubscribe", {
            authKey,
            body: JSON.stringify({ endpoint, userId }),
            method: "POST",
        });
    },
};

/**
 * The person's own API key. Their sign-in goes in the header like every other
 * call here - never the address, which ends up in access logs and history.
 */
export async function getUserApiKey(
    userId: string,
    authKey: string
): Promise<{ hasKey: boolean; apiKey: string | null }> {
    return request(`/public-library/user-api-key?${new URLSearchParams({ userId })}`, { authKey });
}

// Convenience export
export const userApi = {
    activity: userActivity,
    addons: userAddons,
    auth: userAuth,
    export: userExport,
    library: userLibrary,
    oauth: userOAuth,
    shares: userShares,
    sync: userSync,
};

export interface PersonalPreferences {
    autoplayTrailer: boolean;
    beginnerMode: boolean;
    hideSensitive: boolean;
    posterRatings: boolean;
    trailerSound: boolean;
}
export interface PersonalDevice {
    createdAt: string;
    id: string;
    label: string | null;
    lastSeenAt: string | null;
    userAgent: string | null;
}
export interface PersonalSyncStatus {
    connectionProblem: boolean;
    error: string | null;
    lastSyncedAt: string | null;
    status: string;
    supported: boolean;
}
export interface PersonalSyncPlan {
    additions: string[];
    alreadySynced: boolean;
    current: string[];
    desired: string[];
    noGroup: boolean;
    removals: string[];
    supported: boolean;
    updates: number;
}
export interface HistoryPreview {
    duplicates: number;
    rows: Array<{ itemId: string; itemName: string; watchedAt: string }>;
    skipped: number;
    token: string;
    total: number;
}

/** Every personal request carries both the selected identity and its proof. */
export function personalRequest<T>(
    userId: string,
    authKey: string,
    path: string,
    options: RequestInit = {}
): Promise<T> {
    const separator = path.includes("?") ? "&" : "?";
    return request<T>(
        `/public-library/personal${path}${separator}userId=${encodeURIComponent(userId)}`,
        { ...options, authKey }
    );
}

export interface PersonalProfile {
    avatarUrl: string | null;
    colorIndex: number;
    id: string;
    nuvioProfileId: number;
    username: string;
}
export const personalProfiles = {
    list: (userId: string, authKey: string) =>
        request<{ profiles: PersonalProfile[] }>(
            `/public-library/profiles?userId=${encodeURIComponent(userId)}`,
            { authKey }
        ),
    switch: (userId: string, authKey: string, targetId: string) =>
        request<{ userId: string; sessionToken: string }>("/public-library/switch-profile", {
            authKey,
            body: JSON.stringify({ targetId, userId }),
            method: "POST",
        }),
};
