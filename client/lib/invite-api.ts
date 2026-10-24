import type { JellyfinSignInApi } from "@/components/jellyfin/JellyfinSignIn";
/**
 * Public Invite API
 *
 * These endpoints don't require authentication and are used for the public
 * invite flow where users request access to SlickSync.
 */

// Types for the invite flow
export interface InvitationCheck {
    currentUses: number;
    expiresAt: string | null;
    groupName?: string;
    isActive: boolean;
    /** Set when this invitation makes an account on a Jellyfin server. */
    jellyfinNewAccount?: { server: string } | null;
    maxUses: number | null;
}

export interface InviteRequestStatus {
    email: string;
    groupName?: string;
    status: "pending" | "accepted" | "rejected" | "completed";
    username: string;
}

export interface OAuthGenerateResponse {
    oauthCode: string;
    oauthExpiresAt: string;
    oauthLink: string;
}

export interface StremioUserInfo {
    email: string;
    username?: string;
}

// API base - uses relative paths which Next.js proxies via rewrites
const INVITE_BASE = "/invite";

/**
 * Error class for API errors with status code
 */
export class InviteApiError extends Error {
    status: number;
    code?: string;

    constructor(message: string, status: number, code?: string, options?: ErrorOptions) {
        super(message, options);
        this.name = "InviteApiError";
        this.status = status;
        this.code = code;
    }
}

/**
 * Helper to make API requests
 */
async function request<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
    const url = `${INVITE_BASE}${endpoint}`;

    const headers: Record<string, string> = {
        "Content-Type": "application/json",
        ...(options.headers as Record<string, string>),
    };

    try {
        const response = await fetch(url, {
            ...options,
            cache: "no-store",
            headers,
        });

        let data: unknown;
        try {
            data = await response.json();
        } catch {
            data = {};
        }

        if (!response.ok) {
            const payload = typeof data === "object" && data !== null ? data : {};
            const message =
                "message" in payload && typeof payload.message === "string"
                    ? payload.message
                    : "error" in payload && typeof payload.error === "string"
                      ? payload.error
                      : `HTTP ${response.status}`;
            const code =
                "error" in payload && typeof payload.error === "string"
                    ? payload.error
                    : "code" in payload && typeof payload.code === "string"
                      ? payload.code
                      : undefined;
            throw new InviteApiError(message, response.status, code);
        }

        return data as T;
    } catch (error) {
        if (error instanceof InviteApiError) {
            throw error;
        }
        // Network or other errors
        const message = error instanceof Error ? error.message : "Request failed";
        throw new InviteApiError(message, 0, undefined, { cause: error });
    }
}

/**
 * Public Invite API methods
 */
export const inviteApi = {
    /**
     * Check if an invitation is valid
     */
    async checkInvitation(inviteCode: string): Promise<InvitationCheck> {
        return request<InvitationCheck>(`/${inviteCode}/check`);
    },

    /**
     * Check the status of an access request
     */
    async checkStatus(
        inviteCode: string,
        email: string,
        username: string
    ): Promise<InviteRequestStatus> {
        const params = new URLSearchParams({ email, username });
        return request<InviteRequestStatus>(`/${inviteCode}/status?${params}`);
    },

    /**
     * Complete the invite flow with Stremio auth key
     */
    async complete(
        inviteCode: string,
        email: string,
        username: string,
        authKey: string,
        groupName?: string
    ): Promise<{ message: string; user?: { id: string; username: string; email?: string } }> {
        return request(`/${inviteCode}/complete`, {
            body: JSON.stringify({ authKey, email, groupName, username }),
            method: "POST",
        });
    },

    /**
     * Delete user account via OAuth. `addonsCleared` is false when SlickSync's
     * side is gone but its addons could not be taken off their Stremio account.
     */
    async deleteUser(authKey: string): Promise<{ message: string; addonsCleared?: boolean }> {
        return request("/delete-user", {
            body: JSON.stringify({ authKey }),
            method: "POST",
        });
    },

    /**
     * Generate OAuth link for user deletion (no invite code needed)
     */
    async generateDeleteOAuth(): Promise<OAuthGenerateResponse> {
        return request<OAuthGenerateResponse>("/generate-oauth", {
            method: "POST",
        });
    },

    /**
     * Generate OAuth link for completing account creation
     */
    async generateOAuth(
        inviteCode: string,
        email: string,
        username: string
    ): Promise<OAuthGenerateResponse> {
        return request<OAuthGenerateResponse>(`/${inviteCode}/generate-oauth`, {
            body: JSON.stringify({ email, username }),
            method: "POST",
        });
    },

    /**
     * Get Stremio user info from auth key
     */
    async getUserInfo(inviteCode: string, authKey: string): Promise<StremioUserInfo> {
        return request<StremioUserInfo>(`/${inviteCode}/user-info`, {
            body: JSON.stringify({ authKey }),
            method: "POST",
        });
    },

    /** The steps before that sign-in - checking the address and Quick Connect - gated on this invitation. */
    jellyfinSignIn(inviteCode: string) {
        return {
            probe: (serverUrl: string) =>
                request<Awaited<ReturnType<JellyfinSignInApi["probe"]>>>(
                    `/${inviteCode}/jellyfin/probe`,
                    {
                        body: JSON.stringify({ serverUrl }),
                        method: "POST",
                    }
                ),
            quickConnectStatus: (params: { serverUrl: string; secret: string; device: string }) =>
                request<Awaited<ReturnType<JellyfinSignInApi["quickConnectStatus"]>>>(
                    `/${inviteCode}/jellyfin/quick-connect-status`,
                    {
                        body: JSON.stringify(params),
                        method: "POST",
                    }
                ),
            startQuickConnect: (serverUrl: string) =>
                request<Awaited<ReturnType<JellyfinSignInApi["startQuickConnect"]>>>(
                    `/${inviteCode}/jellyfin/quick-connect`,
                    {
                        body: JSON.stringify({ serverUrl }),
                        method: "POST",
                    }
                ),
        };
    },

    async pollNuvioLogin(
        inviteCode: string,
        params: { code: string; deviceNonce: string; anonToken: string }
    ): Promise<{ status: string; email?: string | null }> {
        return request(`/${inviteCode}/nuvio/poll`, {
            body: JSON.stringify(params),
            method: "POST",
        });
    },

    /**
     * Start a Nuvio device sign-in for this invitation. Mirrors the admin
     * route, gated on the invite rather than a session, because someone
     * joining has no account to authenticate with yet.
     */
    async startNuvioLogin(inviteCode: string): Promise<{
        code: string;
        webUrl: string;
        expiresAt: string;
        pollIntervalSeconds: number;
        anonToken: string;
        deviceNonce: string;
    }> {
        return request(`/${inviteCode}/nuvio/start`, { body: JSON.stringify({}), method: "POST" });
    },

    /**
     * Joining with a Jellyfin-compatible server: the server signs in with what
     * the person typed (or an approved Quick Connect secret) and keeps the
     * token; nothing secret comes back.
     */
    async submitJellyfinRequest(
        inviteCode: string,
        username: string,
        jellyfin: Record<string, string>
    ): Promise<{ message?: string; email?: string; [key: string]: unknown }> {
        return request(`/${inviteCode}/request`, {
            body: JSON.stringify({ jellyfin, username }),
            method: "POST",
        });
    },

    /** An invitation that makes Jellyfin accounts: the account is named after the username, with this password. */
    async submitNewJellyfinAccountRequest(
        inviteCode: string,
        username: string,
        password: string
    ): Promise<{ message?: string; email?: string; [key: string]: unknown }> {
        return request(`/${inviteCode}/request`, {
            body: JSON.stringify({ jellyfinNew: { password }, username }),
            method: "POST",
        });
    },

    /**
     * The Nuvio equivalent of submitRequest. The refresh token never reaches
     * the browser - the poll below exchanges it server-side, so all that is
     * sent here is the device code it was issued against.
     */
    async submitNuvioRequest(
        inviteCode: string,
        username: string,
        nuvioCode: string
    ): Promise<{ message: string; email?: string; [key: string]: unknown }> {
        return request(`/${inviteCode}/request`, {
            body: JSON.stringify({ nuvioCode, username }),
            method: "POST",
        });
    },

    /**
     * Submit an access request (new flow: username + authKey from Stremio OAuth)
     */
    async submitRequest(
        inviteCode: string,
        username: string,
        authKey: string
    ): Promise<{ message: string; email?: string; [key: string]: unknown }> {
        return request(`/${inviteCode}/request`, {
            body: JSON.stringify({ authKey, username }),
            method: "POST",
        });
    },
};

/**
 * Stremio OAuth API helpers
 *
 * These interact directly with Stremio's link API
 */
export const stremioOAuth = {
    /**
     * Create a new Stremio OAuth session
     */
    async create(): Promise<{ code: string; link: string; expiresAt: number }> {
        const host = typeof window === "undefined" ? "slicksync.app" : window.location.host;
        const origin = typeof window === "undefined" ? `https://${host}` : window.location.origin;

        const response = await fetch("https://link.stremio.com/api/v2/create?type=Create", {
            headers: {
                Origin: origin,
                "X-Requested-With": host,
            },
            referrerPolicy: "no-referrer",
        });

        if (!response.ok) {
            throw new Error(`Stremio responded with ${response.status}`);
        }

        const data = await response.json();
        const result = data?.result;

        if (!(result?.success && result?.code && result?.link)) {
            throw new Error(data?.error?.message || "Failed to create Stremio link");
        }

        return {
            code: result.code,
            expiresAt: Date.now() + 5 * 60 * 1000, // 5 minutes
            link: result.link,
        };
    },

    /**
     * Poll Stremio for OAuth completion
     */
    async poll(code: string): Promise<{
        success: boolean;
        authKey?: string;
        user?: { email?: string; username?: string };
        error?: string;
    }> {
        const host = typeof window === "undefined" ? "slicksync.app" : window.location.host;
        const origin = typeof window === "undefined" ? `https://${host}` : window.location.origin;

        const response = await fetch(
            `https://link.stremio.com/api/v2/read?type=Read&code=${encodeURIComponent(code)}`,
            {
                headers: {
                    Origin: origin,
                    "X-Requested-With": host,
                },
                referrerPolicy: "no-referrer",
            }
        );

        const data = await response.json().catch(() => ({}));

        if (data?.result?.success && data.result.authKey) {
            return {
                authKey: data.result.authKey,
                success: true,
                user: data.result.user,
            };
        }

        // Code 101 means pending/waiting
        if (data?.error?.code === 101) {
            return { success: false };
        }

        if (data?.error) {
            return {
                error: data.error.message || "Stremio reported an error",
                success: false,
            };
        }

        return { success: false };
    },
};
