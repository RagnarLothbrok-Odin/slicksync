import type { PublicKeyCredentialCreationOptionsJSON } from "@simplewebauthn/browser";
import type { ErrorPayload } from "@/lib/errors";
import type { StremioCatalog, StremioManifest } from "@/lib/stremio-manifest";
import type { PlaybackEvidence } from "./playback";
// API client for connecting to SlickSync backend
// Use relative path if NEXT_PUBLIC_API_URL is not set (Next.js will proxy via rewrites)
// Otherwise use the explicit URL (useful for production or different ports)
export const API_BASE = process.env.NEXT_PUBLIC_API_URL || "/api";

export class ApiError extends Error {
    code?: string;
    data?: ErrorPayload;
    originalError?: unknown;
    response?: { data: ErrorPayload; status: number };
}

// One entry in a cast member's filmography, as /api/discover/person returns it.
/** One of a person's SlickTrax rows - see server/routes/traxAddon.js orderedTraxRows. */
export interface TraxRow {
    hidden: boolean;
    key: string;
    name: string;
}

/** Where "finished" starts and when a started show counts as unfinished. */
export interface WatchTrackingSettings {
    defaults: { finishedPercent: number; unfinishedAfterDays: number };
    finishedPercent: number;
    limits: { finishedPercent: [number, number]; unfinishedAfterDays: [number, number] };
    unfinishedAfterDays: number;
}

/** Whose viewing each profile on one Nuvio account is - see server/utils/nuvioProfiles.js. */
export interface ProfilesView {
    misplaced: { titles: number } | null;
    moved?: { movies: number; episodes: number };
    person?: { id: string; username: string };
    persons: Array<{
        id: string;
        username: string;
        profileIndex: number;
        isActive: boolean;
        colorIndex: number;
        avatarUrl: string | null;
        useGravatar: boolean;
        email: string | null;
        movies: number;
        episodes: number;
    }>;
    profiles: Array<{
        index: number;
        name: string | null;
        color: string | null;
        usesPrimaryAddons: boolean;
        /** Who it counts for; null when it is not counted. */
        ownerId: string | null;
        ownPersonId: string | null;
        skipped: boolean;
        titles: { movies: number; episodes: number };
        merged: { id: string; donorUsername: string; createdAt: string } | null;
        /** Whose limits its Limits pill opens: its own person's id, or its own as a merged profile. */
        limitId?: string;
    }>;
    removedUserId?: string | null;
}

/** A person's Watch State link with AIOStreams, and the household profiles it has seen. */
export interface WatchStateView {
    baseKnown: boolean;
    /** SlickSync can add the link to their AIOStreams configuration itself. */
    canInstall?: boolean;
    /** Their choice: keep SlickSync's collections first in their AIOStreams catalogs. */
    collectionsFirst?: boolean;
    enabled: boolean;
    /** Why moving it to the top didn't work just now, when it didn't. */
    firstError?: string;
    /** The outcome of adding it just now, when one was tried. */
    install?: "added" | "already" | "failed";
    installError?: string;
    /** What the 30-minute check last found wrong (server/utils/aioSlickTrax.js). */
    issues?: Array<"missing" | "trackers" | "libraries" | "quiet">;
    manifestUrl: string | null;
    people: Array<{ id: string; username: string; enabled: boolean }>;
    viewers: Array<{
        viewer: string;
        userId: string | null;
        skipped?: boolean;
        username: string | null;
        userEnabled: boolean | null;
    }>;
}

export interface PersonCredit {
    mediaType: "movie" | "tv";
    poster: string | null;
    role: string | null;
    title: string;
    tmdbId: number;
    year: string | null;
}

interface FetchOptions extends RequestInit {
    // For a background read a page fires on its own rather than data the page
    // needs: a 401 stays an answer for the caller and never clears the sign-in
    // or sends anyone to the login page.
    quiet401?: boolean;
    token?: string;
}

// Helper to get CSRF token from cookies (for non-GET requests)
function getCsrfToken(): string | null {
    if (typeof window === "undefined") {
        return null;
    }
    const cookies = document.cookie?.split(";") || [];
    const find = (name: string) => {
        const key = `${name}=`;
        const entry = cookies.find((c) => c.trim().startsWith(key));
        return entry ? decodeURIComponent(entry.split("=")[1]) : "";
    };
    return find("__Host-sfm_csrf") || find("sfm_csrf") || null;
}

// Detail lookups for the poster-click modal, kept briefly so a hover can
// pay for the click that follows (see prefetchMediaDetails). Short on
// purpose: this is metadata that can change (ratings, episode lists), and
// the window only has to cover the distance between hovering a poster and
// opening it.
const MEDIA_DETAILS_TTL_MS = 90 * 1000;
const MEDIA_DETAILS_MAX = 60;
const mediaDetailsCache = new Map<string, { at: number; promise: Promise<MediaDetails | null> }>();

class ApiClient {
    private token: string | null = null;
    // Dedup + short-window cache for GETs. Several unrelated pages/components
    // independently poll the same couple of endpoints (getInvitations,
    // getMetrics - Dashboard, Activity, Invitations, Metrics, Users, Vault,
    // plus NotificationsDropdown's own always-running 30s poll, now persistent
    // across navigation) with no coordination between them, which on a single
    // page load fired ~15-20 near-simultaneous identical requests to the same
    // endpoint. Every request round-trips through Traefik's Authelia
    // forward-auth check (confirmed via the container's own routing labels),
    // and that burst was the likely source of an occasional real 404 seen
    // live under the concurrent load (data still loaded fine off the other
    // requests in the burst, so nothing user-visible broke - just wasteful,
    // and apparently not perfectly safe at that volume).
    //
    // Sharing only the exact in-flight promise (the original fix) caught
    // requests that overlap down to the millisecond, but independent 30s
    // intervals drift out of phase with each other and with whatever a page
    // fires on its own mount - most of the burst is "near-simultaneous," not
    // truly concurrent, so a pure in-flight dedup missed most of it and the
    // occasional 404 kept happening. Layering a short resolved-value cache on
    // top (same idea as SWR's own `dedupingInterval`, same default duration)
    // catches those near-misses too: a second caller within the window gets
    // the first caller's already-resolved data instantly, no network request
    // at all. Bounded to 2s specifically so it's invisible against this data's
    // own 30s natural refresh cadence - nothing here is ever meaningfully
    // stale. Failures are never cached (evicted immediately) so a transient
    // error can't get replayed onto callers that would've otherwise succeeded.
    private readonly inFlightGets = new Map<string, Promise<unknown>>();
    private readonly recentGets = new Map<string, { value: unknown; at: number }>();
    private static readonly DEDUPE_WINDOW_MS = 2000;

    // Instant navigation: the last successful response of every GET, kept for
    // the whole session and snapshotted to localStorage when the tab hides.
    // Pages initialize their state from peekGet() and skip their loading
    // spinner when it hits - the data shown is whatever this client last saw
    // (possibly minutes old), and the page's own normal fetch-on-mount then
    // refreshes it in place. A deliberate third layer next to the two above:
    // recentGets (2s) exists to coalesce request BURSTS and must stay short
    // so nothing reads meaningfully stale data as if it were fresh; this
    // layer is allowed to be arbitrarily stale precisely because it is only
    // ever read through peekGet by callers that immediately revalidate.
    // Failures never touch it. A mutation drops only the copy of the very
    // resource it changed (PUT /groups/x drops GET /groups/x, not the list):
    // the page that mutated refetches anyway, but another page showing that
    // resource next would otherwise open on the pre-change copy - a group
    // recoloured from the Groups list opened its own page in the old colour.
    private readonly lastKnown = new Map<string, unknown>();
    private lastKnownRestored = false;
    // Set when a response lands, so going to the background only writes the
    // snapshot again when something in it changed.
    private lastKnownDirty = false;
    private static readonly LAST_KNOWN_STORAGE_KEY = "slicksync-last-known";
    private static readonly LAST_KNOWN_MAX_BYTES = 3 * 1024 * 1024;

    private getKey(endpoint: string, token?: string | null): string {
        return `${endpoint}::${token || this.getToken() || ""}`;
    }

    private restoreLastKnown() {
        if (this.lastKnownRestored || typeof window === "undefined") {
            return;
        }
        this.lastKnownRestored = true;
        try {
            const raw = localStorage.getItem(ApiClient.LAST_KNOWN_STORAGE_KEY);
            if (!raw) {
                return;
            }
            const entries: [string, unknown][] = JSON.parse(raw);
            for (const [k, v] of entries) {
                if (!this.lastKnown.has(k)) {
                    this.lastKnown.set(k, v);
                }
            }
        } catch {
            // Corrupt/oversized snapshot - drop it, pages just show spinners once.
            try {
                localStorage.removeItem(ApiClient.LAST_KNOWN_STORAGE_KEY);
            } catch {
                // Browser storage can be unavailable in restricted browsing contexts.
            }
        }
    }

    private persistLastKnown() {
        if (typeof window === "undefined" || !this.lastKnownDirty) {
            return;
        }
        try {
            // Size cap: drop the LARGEST entries first until it fits - one huge
            // metrics snapshot shouldn't evict twenty small lists. Each entry is
            // measured once (this runs as the app goes to the background, where a
            // phone notices every millisecond).
            const sized = Array.from(this.lastKnown.entries()).map((e) => ({
                e,
                size: JSON.stringify(e).length + 1,
            }));
            let total = sized.reduce((sum, x) => sum + x.size, 1);
            sized.sort((a, b) => b.size - a.size);
            let drop = 0;
            while (total > ApiClient.LAST_KNOWN_MAX_BYTES && drop < sized.length) {
                total -= sized[drop++].size;
            }
            localStorage.setItem(
                ApiClient.LAST_KNOWN_STORAGE_KEY,
                JSON.stringify(sized.slice(drop).map((x) => x.e))
            );
            this.lastKnownDirty = false;
        } catch {
            // Quota/private mode - instant nav still works in-memory this session.
        }
    }

    /** Last successful response this client has seen for a GET endpoint, or
     * undefined if it has never succeeded. Callers MUST treat this as a
     * provisional first paint and still fetch fresh data - see lastKnown's
     * comment above. */
    peekGet<T>(endpoint: string): T | undefined {
        this.restoreLastKnown();
        return this.lastKnown.get(this.getKey(endpoint)) as T | undefined;
    }

    /** Whether this device was signed in last time (the snapshot is cleared on
     * sign-out and on an expired session) - the app opens straight away then,
     * and checks the session in the background. */
    wasSignedIn(): boolean {
        if (typeof window === "undefined") {
            return false;
        }
        try {
            return (
                !!localStorage.getItem(ApiClient.LAST_KNOWN_STORAGE_KEY) ||
                !!localStorage.getItem("slicksync_token")
            );
        } catch {
            return false;
        }
    }

    constructor() {
        // Snapshot the last-known store whenever the tab goes to the
        // background - covers both plain navigation away and the PWA being
        // swiped closed, without paying a localStorage write per request.
        if (typeof window !== "undefined") {
            window.addEventListener("pagehide", () => this.persistLastKnown());
            document.addEventListener("visibilitychange", () => {
                if (document.visibilityState === "hidden") {
                    this.persistLastKnown();
                }
            });
        }
    }

    setToken(token: string) {
        this.token = token;
        if (typeof window !== "undefined") {
            localStorage.setItem("slicksync_token", token);
        }
    }

    getToken(): string | null {
        if (this.token) {
            return this.token;
        }
        if (typeof window !== "undefined") {
            this.token = localStorage.getItem("slicksync_token");
        }
        return this.token;
    }

    clearToken() {
        this.token = null;
        if (typeof window !== "undefined") {
            localStorage.removeItem("slicksync_token");
            // Logout hygiene: last-known responses are account data - don't leave
            // them readable (or restorable) for whoever logs in next on this
            // machine.
            this.lastKnown.clear();
            try {
                localStorage.removeItem(ApiClient.LAST_KNOWN_STORAGE_KEY);
            } catch {
                // Browser storage can be unavailable in restricted browsing contexts.
            }
        }
    }

    private getAuthHeaders(method = "GET"): Record<string, string> {
        const headers: Record<string, string> = {};
        const token = this.getToken();
        if (token) {
            headers.Authorization = `Bearer ${token}`;
        }
        if (method !== "GET" && method !== "HEAD" && method !== "OPTIONS") {
            const csrfToken = getCsrfToken();
            if (csrfToken) {
                headers["X-CSRF-Token"] = csrfToken;
            }
        }
        return headers;
    }

    private fetch<T>(endpoint: string, options: FetchOptions = {}): Promise<T> {
        const method = (options.method || "GET").toUpperCase();
        // Only GETs are safe to dedup - a mutating request needs to actually
        // happen every time it's called, and two callers might not even mean
        // the same body. Keyed on endpoint + token, since a mid-flight token
        // change (e.g. login) shouldn't hand an anonymous caller someone else's
        // in-flight authenticated response or vice versa.
        //
        // Any mutation drops the whole GET cache once it settles. The common
        // "delete/create, then immediately re-fetch the list to show the
        // result" pattern (e.g. Invitations' handleDeleteSingle) would
        // otherwise risk being served a pre-mutation snapshot straight out of
        // the 2s cache below instead of the fresh data it's explicitly asking
        // for - confirmed this exact call shape exists before shipping the
        // cache. Cleared on settle (not before starting) so a GET that lands
        // mid-mutation and caches its own snapshot doesn't leave a stale entry
        // behind for the caller's own post-mutation refetch to pick up -
        // clearing only up front would miss exactly that window. Cleared on
        // both success and failure for simplicity; a failed mutation didn't
        // change server state so this is a few extra requests at worst, never
        // a stale read. Blunt (a mutation to one resource evicts unrelated
        // cached GETs too) but safe by construction.
        if (method !== "GET") {
            return this.fetchImpl<T>(endpoint, options).finally(() => {
                this.recentGets.clear();
                const path = endpoint.split("?")[0];
                for (const k of Array.from(this.lastKnown.keys())) {
                    if (k.startsWith(`${path}::`) || k.startsWith(`${path}?`)) {
                        this.lastKnown.delete(k);
                        this.lastKnownDirty = true;
                    }
                }
            });
        }
        const key = `${endpoint}::${options.token || this.getToken() || ""}`;

        const inFlight = this.inFlightGets.get(key);
        if (inFlight) {
            return inFlight as Promise<T>;
        }

        const recent = this.recentGets.get(key);
        if (recent && Date.now() - recent.at < ApiClient.DEDUPE_WINDOW_MS) {
            return Promise.resolve(recent.value as T);
        }

        const promise = this.fetchImpl<T>(endpoint, options)
            .then((value) => {
                this.recentGets.set(key, { at: Date.now(), value });
                this.lastKnown.set(key, value);
                this.lastKnownDirty = true;
                return value;
            })
            .finally(() => {
                this.inFlightGets.delete(key);
            });
        this.inFlightGets.set(key, promise);
        return promise;
    }

    private async fetchImpl<T>(endpoint: string, options: FetchOptions = {}): Promise<T> {
        const token = options.token || this.getToken();
        const headers: Record<string, string> = {
            "Content-Type": "application/json",
            ...(options.headers as Record<string, string>),
        };

        if (token) {
            headers.Authorization = `Bearer ${token}`;
        }

        // Add CSRF token for state-changing requests
        const method = (options.method || "GET").toUpperCase();
        if (method !== "GET" && method !== "HEAD" && method !== "OPTIONS") {
            const csrfToken = getCsrfToken();
            if (csrfToken) {
                headers["X-CSRF-Token"] = csrfToken;
            }
        }

        try {
            const response = await fetch(`${API_BASE}${endpoint}`, {
                cache: "no-store",
                credentials: "include",
                ...options,
                headers,
            });

            if (!response.ok) {
                let errorData: ErrorPayload;
                try {
                    errorData = await response.json();
                } catch {
                    errorData = { message: `HTTP ${response.status}: ${response.statusText}` };
                }

                const errorMessage =
                    errorData.message || errorData.error || `HTTP ${response.status}`;
                const apiError = new ApiError(errorMessage);
                apiError.response = { data: errorData, status: response.status };
                // Attach the original error data for easier access
                apiError.data = errorData;

                // Global 401 Redirect handler for client-side. Excludes /superadmin
                // same as /login - it's a public page with its own entirely separate
                // auth (a distinct sfm_superadmin cookie, never a tenant login), but
                // global providers that wrap every page (ThemeProvider fetching
                // /settings/theme-pref in particular) still fire their own
                // tenant-scoped requests there and 401 - without this exclusion that
                // 401 hijacked the page to /login?mode=admin before the superadmin
                // login form ever got a chance to render.
                //
                // /u/ is the shared stats page (never /u alone, which would also
                // match /user): it is open to anyone with the link and makes no
                // signed-in calls of its own, so a 401 there is never a reason to
                // send the visitor away. The same goes for any call that opts out
                // with quiet401 - the theme preference read, which every page fires
                // and which is how a logged-out visitor on a public page (a stats
                // link, an invite) would otherwise be bounced to the login page.
                if (
                    response.status === 401 &&
                    !options.quiet401 &&
                    typeof window !== "undefined" &&
                    !window.location.pathname.startsWith("/login") &&
                    !window.location.pathname.startsWith("/superadmin") &&
                    !window.location.pathname.startsWith("/u/")
                ) {
                    // Do not redirect if the failure happened during an active auth attempt/management,
                    // or came from /ext/* - that prefix runs its own API-key auth (see server/routes/
                    // externalApi.js), entirely separate from the tenant session cookie. getAccountStats()
                    // hits /ext/account on every Dashboard/Settings/topbar/sidebar mount, and a brand new
                    // account has no API key configured yet - a legitimate, expected 401 that has nothing
                    // to do with whether the tenant session itself is valid. Treating it as "logged out"
                    // force-redirected a freshly registered (and fully signed-in) account straight back to
                    // the login page.
                    const isAuthEndpoint =
                        [
                            "/auth/login",
                            "/auth/stremio-login",
                            "/auth/private-login",
                            "/auth/unlink-stremio",
                            "/auth/set-credentials",
                        ].some((route) => endpoint.startsWith(route)) ||
                        endpoint.startsWith("/ext/");

                    if (!isAuthEndpoint) {
                        this.clearToken();
                        const isUserRoute =
                            window.location.pathname.startsWith("/user") ||
                            window.location.pathname.startsWith("/invite");
                        window.location.href = `/login?mode=${isUserRoute ? "user" : "admin"}`;
                    }
                }

                throw apiError;
            }

            return response.json();
        } catch (fetchError) {
            // Handle network errors, CORS errors, etc.
            if (fetchError instanceof TypeError && fetchError.message.includes("fetch")) {
                const networkError = new ApiError("Network error: Unable to reach the server");
                networkError.response = { data: { message: "Network error" }, status: 0 };
                networkError.originalError = fetchError;
                throw networkError;
            }

            // If it's already our API error, re-throw it
            if (fetchError instanceof ApiError) {
                throw fetchError;
            }

            // Otherwise, wrap it
            const wrappedError = new ApiError(
                fetchError instanceof Error ? fetchError.message : "Request failed"
            );
            wrappedError.originalError = fetchError;
            wrappedError.response = {
                data: {
                    message: fetchError instanceof Error ? fetchError.message : "Unknown error",
                },
                status: 0,
            };
            throw wrappedError;
        }
    }

    // Auth
    async login(username: string, password: string) {
        const data = await this.fetch<{ token: string }>("/auth/login", {
            body: JSON.stringify({ password, uuid: username }), // Backend expects 'uuid' for public login
            method: "POST",
        });
        this.setToken(data.token);
        return data;
    }

    // Public-mode (multi-tenant) self-registration. The uuid isn't user-chosen -
    // it's generated server-side (generateAccountUuid) and doubles as the login
    // identifier, since public mode has no separate username/email requirement.
    async generateAccountUuid() {
        return this.fetch<{ success: boolean; uuid: string }>("/auth/generate-uuid");
    }

    async register(uuid: string, password: string) {
        const data = await this.fetch<{
            token: string;
            account: { id: string; uuid: string; email: string | null };
        }>("/auth/register", {
            body: JSON.stringify({ password, uuid }),
            method: "POST",
        });
        this.setToken(data.token);
        return data;
    }

    async stremioLogin(authKey: string) {
        const data = await this.fetch<{
            token: string;
            account: { id: string; uuid: string; email: string | null };
        }>("/auth/stremio-login", {
            body: JSON.stringify({ authKey }),
            method: "POST",
        });
        if (data.token) {
            this.setToken(data.token);
        }
        return data;
    }

    // Nuvio admin login (public mode only) - unlike Stremio's single authKey,
    // Nuvio needs its own start/poll device-code round trip before there's
    // anything to log in with.
    async startNuvioAdminOAuth() {
        return this.fetch<{
            code: string;
            webUrl: string;
            expiresAt: string;
            pollIntervalSeconds: number;
            anonToken: string;
            deviceNonce: string;
        }>("/auth/nuvio-start-oauth", { body: JSON.stringify({}), method: "POST" });
    }

    async pollNuvioAdminOAuth(params: { code: string; deviceNonce: string; anonToken: string }) {
        return this.fetch<{ status: string; expiresAt: string; pollIntervalSeconds: number }>(
            "/auth/nuvio-poll-oauth",
            { body: JSON.stringify(params), method: "POST" }
        );
    }

    async nuvioLogin(params: { code: string; deviceNonce: string; anonToken: string }) {
        const data = await this.fetch<{
            token: string;
            account: { id: string; uuid: string; email: string | null };
        }>("/auth/nuvio-login", {
            body: JSON.stringify(params),
            method: "POST",
        });
        if (data.token) {
            this.setToken(data.token);
        }
        return data;
    }

    /**
     * Signs the admin out for real. The server drops its session cookies (they
     * are httpOnly, so only it can), then this browser forgets the bearer token,
     * the signed-in flag and the cached account data - forgetting only those
     * left the session alive, and on a private instance the login page simply
     * let the person back in. Plain fetch plus the cookie helper, so it behaves
     * the same with a mouse, a touch screen or a D-pad inside a WebView.
     * Never throws: an expired session answers 401 and there is nothing left to
     * end, and an unreachable server must not stop this browser forgetting (nor
     * leave someone with only a D-pad staring at a button that does nothing).
     */
    async logout() {
        const csrfToken = getCsrfToken();
        // Older WebViews have no AbortController; they just wait as fetch does.
        const controller = typeof AbortController === "undefined" ? null : new AbortController();
        const timer = controller ? setTimeout(() => controller.abort(), 5000) : null;
        try {
            await fetch(`${API_BASE}/auth/logout`, {
                body: "{}",
                credentials: "include",
                headers: {
                    "Content-Type": "application/json",
                    ...(csrfToken ? { "X-CSRF-Token": csrfToken } : {}),
                },
                method: "POST",
                signal: controller?.signal,
            });
        } catch {
            // Unreachable server - carry on and clear what is held here.
        } finally {
            if (timer) {
                clearTimeout(timer);
            }
        }
        this.clearToken();
        try {
            localStorage.removeItem("slicksync-admin-token");
        } catch {
            // Browser storage can be unavailable in restricted browsing contexts.
        }
    }

    async unlinkStremio(password: string) {
        return this.fetch<{ message: string; uuid: string }>("/auth/unlink-stremio", {
            body: JSON.stringify({ password }),
            method: "POST",
        });
    }

    async unlinkUuid() {
        return this.fetch<{ message: string }>("/auth/unlink-uuid", {
            method: "POST",
        });
    }

    async setCredentials(password: string) {
        return this.fetch<{ message: string; uuid: string }>("/auth/set-credentials", {
            body: JSON.stringify({ password }),
            method: "POST",
        });
    }

    // Session check for the admin auth gate - resolves with { account: null } when
    // auth is disabled (private mode) or a real account when a session is valid,
    // and 401s (triggering the global redirect handler above) when it isn't.
    async getSession() {
        return this.fetch<{
            account: { id: string; uuid: string; email: string | null } | null;
            message?: string;
        }>("/auth/me");
    }

    // Users
    async getUsers() {
        return this.fetch<User[]>("/users");
    }

    async getUser(id: string) {
        return this.fetch<User>(`/users/${id}`);
    }

    // Account merge (Stremio<->Nuvio, same real person) - see
    // server/utils/userMerge.js for the full design.
    async getMergePreview(id: string, donorId: string) {
        return this.fetch<MergePreview>(
            `/users/${id}/merge-preview?donorId=${encodeURIComponent(donorId)}`
        );
    }
    async mergeUsers(id: string, donorId: string) {
        return this.fetch<{ success: boolean } & MergePreview & { archivePath: string }>(
            `/users/${id}/merge`,
            {
                body: JSON.stringify({ donorId }),
                method: "POST",
            }
        );
    }
    async getMergeInfo(id: string) {
        return this.fetch<{ info: MergeInfo | null }>(`/users/${id}/merge-info`);
    }
    async undoMerge(id: string) {
        return this.fetch<{
            success: boolean;
            donorUsername: string;
            donorProviderType: "stremio" | "nuvio";
        }>(`/users/${id}/undo-merge`, {
            method: "POST",
        });
    }

    async createUser(data: CreateUserData) {
        return this.fetch<User>("/users", {
            body: JSON.stringify(data),
            method: "POST",
        });
    }

    async updateUser(id: string, data: Partial<User>) {
        return this.fetch<User>(`/users/${id}`, {
            body: JSON.stringify(data),
            method: "PUT",
        });
    }

    async toggleUserStatus(id: string, isActive: boolean) {
        return this.fetch<{ message: string; isActive: boolean }>(`/users/${id}/toggle-status`, {
            body: JSON.stringify({ isActive }),
            method: "PATCH",
        });
    }

    async deleteUser(id: string) {
        return this.fetch(`/users/${id}`, { method: "DELETE" });
    }

    async syncUser(id: string) {
        return this.fetch(`/users/${id}/sync`, { method: "POST" });
    }

    async connectUserStremio(
        id: string,
        data: { email: string; password: string; username?: string }
    ) {
        return this.fetch(`/users/${id}/connect-stremio`, {
            body: JSON.stringify(data),
            method: "POST",
        });
    }

    async connectUserStremioWithAuthKey(id: string, authKey: string) {
        return this.fetch(`/users/${id}/connect-stremio-authkey`, {
            body: JSON.stringify({ authKey }),
            method: "POST",
        });
    }

    async startSimklPin(id: string) {
        return this.fetch<{
            userCode: string;
            verificationUrl: string;
            expiresIn: number;
            pollIntervalSeconds: number;
        }>(`/users/${id}/simkl/start`, { method: "POST" });
    }

    async pollSimklPin(id: string, userCode: string) {
        return this.fetch<{ status: "pending" | "authorized"; username?: string }>(
            `/users/${id}/simkl/poll`,
            {
                body: JSON.stringify({ userCode }),
                method: "POST",
            }
        );
    }

    async disconnectSimkl(id: string) {
        return this.fetch(`/users/${id}/simkl/disconnect`, { method: "POST" });
    }

    async setHouseholdStats(id: string, excluded: boolean) {
        return this.fetch<{ excludeFromHouseholdStats: boolean }>(
            `/users/${encodeURIComponent(id)}/household-stats`,
            { body: JSON.stringify({ excluded }), method: "PUT" }
        );
    }

    async getTraxRows(id: string) {
        return this.fetch<{ enabled: boolean; rows: TraxRow[] }>(
            `/users/${encodeURIComponent(id)}/trax-rows`
        );
    }

    async saveTraxRows(id: string, order: string[], hidden: string[]) {
        return this.fetch<{ enabled: boolean; rows: TraxRow[] }>(
            `/users/${encodeURIComponent(id)}/trax-rows`,
            { body: JSON.stringify({ hidden, order }), method: "PUT" }
        );
    }

    // How viewing is judged - see server/utils/watchSettings.js.
    async getWatchTrackingSettings() {
        return this.fetch<WatchTrackingSettings>("/settings/watch-tracking");
    }

    async saveWatchTrackingSettings(
        patch: Partial<Pick<WatchTrackingSettings, "finishedPercent" | "unfinishedAfterDays">>
    ) {
        return this.fetch<WatchTrackingSettings>("/settings/watch-tracking", {
            body: JSON.stringify(patch),
            method: "PUT",
        });
    }

    // Profiles on a Nuvio account - see server/utils/nuvioProfiles.js.
    async getProfiles(id: string) {
        return this.fetch<ProfilesView>(`/users/${encodeURIComponent(id)}/profiles`);
    }

    async setProfileOwner(id: string, profileIndex: number, target: string) {
        return this.fetch<ProfilesView>(
            `/users/${encodeURIComponent(id)}/profiles/${profileIndex}`,
            { body: JSON.stringify({ target }), method: "PUT" }
        );
    }

    async giveProfileOwnPerson(id: string, profileIndex: number) {
        return this.fetch<ProfilesView>(
            `/users/${encodeURIComponent(id)}/profiles/${profileIndex}/own-person`,
            { method: "POST" }
        );
    }

    async tidyProfiles(id: string) {
        return this.fetch<ProfilesView>(`/users/${encodeURIComponent(id)}/profiles/tidy`, {
            method: "POST",
        });
    }

    // Watch State with AIOStreams - see server/utils/watchState.js.
    async getWatchState(id: string) {
        return this.fetch<WatchStateView>(`/users/${encodeURIComponent(id)}/watch-state`);
    }

    // Keep SlickSync's collections first in their AIOStreams catalog order, or stop.
    async setWatchStateCollectionsFirst(id: string, enabled: boolean) {
        return this.fetch<WatchStateView>(
            `/users/${encodeURIComponent(id)}/watch-state/collections-first`,
            { body: JSON.stringify({ enabled }), method: "PUT" }
        );
    }

    // Add the SlickTrax link to their AIOStreams configuration again.
    async installWatchStateIntoAio(id: string) {
        return this.fetch<WatchStateView>(`/users/${encodeURIComponent(id)}/watch-state/install`, {
            method: "POST",
        });
    }

    async setWatchState(id: string, enabled: boolean) {
        return this.fetch<WatchStateView>(`/users/${encodeURIComponent(id)}/watch-state`, {
            body: JSON.stringify({ enabled }),
            method: "POST",
        });
    }

    async linkWatchStateViewer(id: string, viewer: string, userId: string | null) {
        return this.fetch<WatchStateView>(`/users/${encodeURIComponent(id)}/watch-state/viewers`, {
            body: JSON.stringify({ userId, viewer }),
            method: "PUT",
        });
    }

    async getUserWatchTime(id: string, period: "day" | "week" | "month" | "year" = "week") {
        return this.fetch<WatchTimeData>(`/users/${id}/watch-time?period=${period}`);
    }

    async getUserTopItems(id: string, limit = 10) {
        return this.fetch<TopItem[]>(`/users/${id}/top-items?limit=${limit}`);
    }

    async getUserStreaks(id: string) {
        return this.fetch<StreakData>(`/users/${id}/streaks`);
    }

    async getUserVelocity(id: string) {
        return this.fetch<VelocityData>(`/users/${id}/velocity`);
    }

    async getUserSyncStatus(id: string, groupId?: string) {
        const url = groupId
            ? `/users/${id}/sync-status?groupId=${groupId}`
            : `/users/${id}/sync-status`;
        return this.fetch<{
            status: "synced" | "unsynced" | "stale" | "connect" | "error" | "unsupported";
            message?: string;
            isSynced?: boolean;
        }>(url);
    }

    async getUserSyncPlan(id: string) {
        return this.fetch<{
            alreadySynced: boolean;
            current: { name: string; transportUrl: string; fingerprint: string }[];
            desired: { name: string; transportUrl: string; fingerprint: string }[];
            currentCount: number;
            desiredCount: number;
        }>(`/users/${id}/sync-plan`);
    }

    async getGroupSyncStatus(id: string) {
        // Server aggregates every member's status in one pass (see
        // server/routes/groups.js `/:id/sync-status`) - avoids the N+1 of
        // fetching each member's own sync-status individually, which is what
        // used to blow through the API rate limit on groups with several users.
        return this.fetch<{
            groupStatus: "synced" | "unsynced";
            userStatuses: Array<{
                userId: string;
                status?: string;
                isSynced?: boolean;
                message?: string;
            }>;
            memberCount?: number;
            addonCount?: number;
        }>(`/groups/${id}/sync-status`);
    }

    async getUserStremioAddons(id: string) {
        const response = await this.fetch<{
            userId: string;
            count: number;
            addons: ProviderAddon[];
        }>(`/users/${id}/stremio-addons`);
        // Normalize the response - backend returns manifestUrl but we need transportUrl
        const normalized = (response.addons || []).map((addon) => ({
            ...addon,
            manifest: addon.manifest || {
                description: addon.description || "",
                id: addon.id || "unknown",
                logo: addon.iconUrl || addon.logo || undefined,
                name: addon.name || "Unknown",
                resources: addon.resources || [],
                types: addon.types || [],
                version: addon.version || "unknown",
            },
            transportUrl: addon.transportUrl || addon.manifestUrl || addon.url || "",
        }));
        return normalized;
    }

    // Nuvio Collections (admin) — pull/edit/push a Nuvio profile's own
    // home-screen Collections. Distinct from this app's local "Catalogs".
    async getNuvioProfiles(userId: string) {
        return this.fetch<{ profiles: NuvioProfile[] }>(
            `/users/${encodeURIComponent(userId)}/nuvio-profiles`
        );
    }

    // Promote one of the account's other profiles to its own user, so its addon
    // list can be managed and synced like anyone else's. Reuses the credential
    // already stored against `userId`, so no password is asked for again.
    async addNuvioProfileAsUser(userId: string, profileIndex: number) {
        return this.fetch<{
            user: { id: string; username: string; nuvioProfileId: number };
            message: string;
        }>(`/users/${encodeURIComponent(userId)}/nuvio-profiles/${profileIndex}/add-user`, {
            body: JSON.stringify({}),
            method: "POST",
        });
    }

    async getNuvioCollections(userId: string, profileId: number) {
        return this.fetch<{ collections: NuvioCollection[] }>(
            `/users/${encodeURIComponent(userId)}/nuvio-collections/${profileId}`
        );
    }

    async setNuvioCollections(userId: string, profileId: number, collections: NuvioCollection[]) {
        return this.fetch<{ success: boolean; collections: NuvioCollection[] }>(
            `/users/${encodeURIComponent(userId)}/nuvio-collections/${profileId}`,
            { body: JSON.stringify({ collections }), method: "PUT" }
        );
    }

    /** Collections Guard: profiles whose Nuvio collections or home-row layout look externally overwritten. */
    async getCollectionsGuardAlarms() {
        return this.fetch<{
            alarms: Array<{
                kind: "collections" | "layout";
                userId: string;
                username: string | null;
                profileId: number;
                currentCount: number;
                lastGoodCount: number | null;
                lastGoodAt: string | null;
                detectedAt: string;
                preview: string[];
                previewTotal: number;
            }>;
        }>("/users/collections-guard/alarms");
    }

    async restoreCollectionsSnapshot(
        userId: string,
        profileId: number,
        kind: "collections" | "layout" = "collections"
    ) {
        return this.fetch<{
            success: boolean;
            restoredCount?: number;
            restoredItems?: number;
            from: string;
        }>("/users/collections-guard/restore", {
            body: JSON.stringify({ kind, profileId, userId }),
            method: "POST",
        });
    }

    async acceptCollectionsState(
        userId: string,
        profileId: number,
        kind: "collections" | "layout" = "collections"
    ) {
        return this.fetch<{ success: boolean; acceptedCount?: number; acceptedItems?: number }>(
            "/users/collections-guard/accept",
            { body: JSON.stringify({ kind, profileId, userId }), method: "POST" }
        );
    }

    /** Smart Catalogs: store the criteria a catalog keeps re-evaluating (null clears it). */
    async setSmartRule(listId: string, rule: SmartCatalogRule | null, autoRefresh = true) {
        return this.fetch<{ success: boolean; rule: SmartCatalogRule | null; description: string }>(
            `/lists/${encodeURIComponent(listId)}/smart-rule`,
            { body: JSON.stringify({ autoRefresh, rule }), method: "PUT" }
        );
    }
    async refreshSmartCatalog(listId: string) {
        return this.fetch<{ success: boolean; id: string; name: string; count: number }>(
            `/lists/${encodeURIComponent(listId)}/smart-refresh`,
            { method: "POST" }
        );
    }

    /** The household's own titles (watchlist + recent history), for instant local matches. */
    async getLocalIndex() {
        return this.fetch<{
            items: Array<{
                id: string;
                name: string;
                type: "movie" | "series";
                poster: string | null;
            }>;
        }>("/discover/local-index");
    }

    /** A series' episode list grouped by season, with watched state. Lazy -
     *  the detail modal only asks when someone expands the season list. */
    async getMediaEpisodes(itemId: string) {
        return this.fetch<{ seasons: SeriesSeason[] }>(
            `/users/media-episodes?itemId=${encodeURIComponent(itemId)}`
        );
    }

    /** Tip-of-the-tongue search: a plot description -> real, TMDb-verified titles. */
    async searchByDescription(description: string, type?: "movie" | "series") {
        return this.fetch<{
            items: DiscoverItem[];
            candidates: number;
            filteredByType: "movie" | "series" | null;
        }>("/discover/describe", { body: JSON.stringify({ description, type }), method: "POST" });
    }

    /** Followed people and shows, muted ones included. */
    async getFollows() {
        return this.fetch<FollowedSubject[]>("/follows");
    }
    /** Follow a person (TMDb id) or a show (tt id); following again un-mutes. */
    async followSubject(
        kind: "person" | "show",
        subjectId: string,
        name: string,
        poster?: string | null
    ) {
        return this.fetch<FollowedSubject>("/follows", {
            body: JSON.stringify({ kind, name, poster, subjectId }),
            method: "POST",
        });
    }
    async muteFollow(id: string, muted: boolean) {
        return this.fetch<{ success: boolean; muted: boolean }>(
            `/follows/${encodeURIComponent(id)}/mute`,
            { body: JSON.stringify({ muted }), method: "PUT" }
        );
    }
    async unfollowSubject(id: string) {
        return this.fetch<{ success: boolean }>(`/follows/${encodeURIComponent(id)}`, {
            method: "DELETE",
        });
    }

    /** This season's airing anime (AniList, no key required). */
    async getSeasonalAnime() {
        return this.fetch<{
            items: SeasonalAnime[];
            unavailable?: boolean;
            reason?: string | null;
        }>("/anime/seasonal");
    }
    /** Attaches AniList data (episode count, airing countdown) to a known title. */
    async lookupAnime(title: string, year?: number) {
        const params = new URLSearchParams({ title });
        if (year) {
            params.set("year", String(year));
        }
        return this.fetch<{
            found: boolean;
            anilistId?: number;
            malId?: number | null;
            name?: string;
            episodes?: number | null;
            status?: string | null;
            nextEpisode?: { episode: number; airingAt: string; label: string } | null;
            siteUrl?: string | null;
        }>(`/anime/lookup?${params.toString()}`);
    }
    /** Franchise watch order - main line, side stories and movies kept apart. */
    async getAnimeWatchOrder(anilistId: number) {
        return this.fetch<{
            mainLine: AnimeEntry[];
            sideStories: AnimeEntry[];
            movies: AnimeEntry[];
        }>(`/anime/${anilistId}/watch-order`);
    }

    /** The profile's home-screen row arrangement, labelled with real addon/catalog names. */
    async getNuvioHomeLayout(userId: string, profileId: number) {
        return this.fetch<{
            items: NuvioHomeRow[];
            unarranged: NuvioHomeRow[];
            sourcePlatform: string | null;
            buckets: string[];
        }>(`/users/${encodeURIComponent(userId)}/home-layout/${profileId}`);
    }

    /** Writes the arrangement back - array order becomes the on-device row order. */
    async saveNuvioHomeLayout(userId: string, profileId: number, items: NuvioHomeRow[]) {
        return this.fetch<{ success: boolean; rows: number; buckets: number }>(
            `/users/${encodeURIComponent(userId)}/home-layout/${profileId}`,
            { body: JSON.stringify({ items }), method: "PUT" }
        );
    }

    /** Copy one Nuvio profile's whole home-row arrangement onto another profile (overwrites the target's). */
    async copyHomeLayout(userId: string, fromProfileId: number, toProfileId: number) {
        return this.fetch<{ success: boolean; copiedItems: number }>("/users/home-layout/copy", {
            body: JSON.stringify({ fromProfileId, toProfileId, userId }),
            method: "POST",
        });
    }

    async getNuvioCommunityCovers(
        userId: string,
        opts: {
            sort?: string;
            orientation?: string;
            format?: string;
            page?: number;
            limit?: number;
            search?: string;
        } = {}
    ) {
        const params = new URLSearchParams();
        if (opts.sort) {
            params.set("sort", opts.sort);
        }
        if (opts.orientation) {
            params.set("orientation", opts.orientation);
        }
        if (opts.format) {
            params.set("format", opts.format);
        }
        if (opts.page) {
            params.set("page", String(opts.page));
        }
        if (opts.limit) {
            params.set("limit", String(opts.limit));
        }
        if (opts.search) {
            params.set("search", opts.search);
        }
        const qs = params.toString();
        return this.fetch<NuvioCommunityCoversResponse>(
            `/users/${encodeURIComponent(userId)}/nuvio-covers${qs ? `?${qs}` : ""}`
        );
    }

    async getNuvioCatalogPreview(
        userId: string,
        addonUrl: string,
        type: string,
        catalogId: string,
        genre?: string
    ) {
        const params = new URLSearchParams({ addonUrl, catalogId, type });
        if (genre && genre !== "none") {
            params.set("genre", genre);
        }
        return this.fetch<{
            items: { id: string; type: string; name: string; poster: string | null }[];
        }>(`/users/${encodeURIComponent(userId)}/nuvio-catalog-preview?${params.toString()}`);
    }

    // Import user addons to a new group (copied from old UI)
    async importUserAddons(id: string) {
        // Fetch live addons from Stremio for this user first
        const stremioResponse = await this.fetch<{
            userId: string;
            count: number;
            addons: ProviderAddon[];
        }>(`/users/${id}/stremio-addons`);
        const addons: ProviderAddon[] = Array.isArray(stremioResponse?.addons)
            ? stremioResponse.addons
            : [];

        // Post the collected addons to the import endpoint
        return this.fetch<{ importedCount: number; message: string }>(
            `/users/${id}/import-addons`,
            {
                body: JSON.stringify({ addons }),
                method: "POST",
            }
        );
    }

    async getUserGroupAddons(id: string) {
        const response = await this.fetch<{ addons: Addon[] }>(`/users/${id}/group-addons`);
        return response.addons || [];
    }

    async updateUserExcludedAddons(id: string, excludedAddons: string[]) {
        return this.fetch(`/users/${id}/excluded-addons`, {
            body: JSON.stringify({ excludedAddons }),
            method: "PUT",
        });
    }

    async reorderUserStremioAddons(id: string, orderedAddonNames: string[]) {
        return this.fetch(`/users/${id}/stremio-addons/reorder`, {
            body: JSON.stringify({ orderedNames: orderedAddonNames }), // Changed from orderedAddonNames to orderedNames
            method: "POST", // Changed from PUT to POST to match backend
        });
    }

    async toggleUserProtectedAddon(id: string, addonName: string) {
        return this.fetch<{ isProtected: boolean; message: string }>(`/users/${id}/protect-addon`, {
            body: JSON.stringify({ name: addonName }), // Changed from addonName to name
            method: "POST",
        });
    }

    async removeUserStremioAddon(id: string, addonName: string) {
        return this.fetch(`/users/${id}/stremio-addons/${encodeURIComponent(addonName)}`, {
            method: "DELETE",
        });
    }

    // Groups
    async getGroups() {
        return this.fetch<Group[]>("/groups");
    }

    async getGroup(id: string) {
        return this.fetch<Group>(`/groups/${id}`);
    }

    async createGroup(data: CreateGroupData) {
        return this.fetch<Group>("/groups", {
            body: JSON.stringify(data),
            method: "POST",
        });
    }

    async updateGroup(id: string, data: Partial<Group>) {
        return this.fetch<Group>(`/groups/${id}`, {
            body: JSON.stringify(data),
            method: "PUT",
        });
    }

    async toggleGroupStatus(id: string, isActive: boolean) {
        return this.fetch<Group>(`/groups/${id}/toggle-status`, {
            body: JSON.stringify({ isActive }),
            method: "PATCH",
        });
    }

    async deleteGroup(id: string) {
        return this.fetch(`/groups/${id}`, { method: "DELETE" });
    }

    async syncGroup(id: string) {
        return this.fetch(`/groups/${id}/sync`, { method: "POST" });
    }

    async getGroupAddons(id: string) {
        // Backend returns { addons: [...] } with a slightly different shape
        const response = await this.fetch<{ addons: ProviderAddon[] }>(`/groups/${id}/addons`);
        const rawAddons = Array.isArray(response?.addons) ? response.addons : [];

        // Normalize to the Addon type used by the UI
        return rawAddons
            .filter((a) => {
                // Ensure we have a valid ID
                if (!a.id) {
                    console.warn("Addon without ID from backend:", a);
                    return false;
                }
                return true;
            })
            .map((a) => {
                const manifest: Partial<StremioAddon["manifest"]> = a.manifest || {};
                // Get logo from multiple sources
                const logo =
                    a.customLogo ||
                    manifest.logo ||
                    (manifest.id && `https://stremio-addon.netlify.app/${manifest.id}/icon.png`) ||
                    undefined;
                return {
                    catalogs: Array.isArray(manifest.catalogs) ? manifest.catalogs : [],
                    createdAt: "",
                    description: a.description || manifest.description || "",
                    id: a.id, // This is guaranteed to exist after filter
                    logo,
                    manifestUrl: a.transportUrl || "",
                    name: a.name || manifest.name || "Unnamed Addon",
                    resources: Array.isArray(manifest.resources)
                        ? manifest.resources
                              .map((r) => (typeof r === "string" ? r : r.name))
                              .filter(Boolean)
                        : [],
                    stremioAddonId: manifest.id,
                    updatedAt: "",
                    version: manifest.version,
                } as Addon;
            });
    }

    async addAddonToGroup(groupId: string, addonId: string) {
        return this.fetch(`/groups/${groupId}/addons/${addonId}`, { method: "POST" });
    }

    async removeAddonFromGroup(groupId: string, addonId: string) {
        return this.fetch(`/groups/${groupId}/addons/${addonId}`, { method: "DELETE" });
    }

    async reorderGroupAddons(groupId: string, orderedAddonIds: string[]) {
        try {
            return await this.fetch(`/groups/${groupId}/addons/reorder`, {
                body: JSON.stringify({ orderedAddonIds }),
                method: "POST",
            });
        } catch (error) {
            const apiError = error instanceof ApiError ? error : undefined;
            // Log error details separately to avoid serialization issues
            console.error(
                "API reorderGroupAddons error - message:",
                error instanceof Error ? error.message : "Request failed"
            );
            if (apiError?.data) {
                console.error("API reorderGroupAddons error - data:", apiError.data);
            }
            console.error("API reorderGroupAddons error - type:", typeof error);
            console.error(
                "API reorderGroupAddons error - response data:",
                apiError?.response?.data
            );
            console.error(
                "API reorderGroupAddons error - response status:",
                apiError?.response?.status
            );
            console.error("API reorderGroupAddons error - groupId:", groupId);
            console.error("API reorderGroupAddons error - orderedAddonIds:", orderedAddonIds);
            if (apiError?.response?.data?.details?.availableAddonIds) {
                console.error(
                    "API reorderGroupAddons error - available addon IDs from backend:",
                    apiError.response.data.details.availableAddonIds
                );
            }
            console.error("API reorderGroupAddons error - full error:", error);
            throw error;
        }
    }

    async addUserToGroup(groupId: string, userId: string) {
        return this.fetch(`/groups/${groupId}/users/${userId}`, { method: "POST" });
    }

    async removeUserFromGroup(groupId: string, userId: string) {
        return this.fetch(`/groups/${groupId}/users/${userId}`, { method: "DELETE" });
    }

    // Cinemeta patching - the account's own default metadata addon, with parts
    // of its manifest removed. See server/utils/cinemetaPatch.js.
    async getCinemetaState(userId: string) {
        return this.fetch<{
            supported?: boolean;
            installed: boolean;
            removeSearch: boolean;
            removeCatalogs: boolean;
            removeMeta: boolean;
            canReset: boolean;
        }>(`/users/${userId}/cinemeta`);
    }

    async patchCinemeta(
        userId: string,
        patch: { removeSearch: boolean; removeCatalogs: boolean; removeMeta: boolean }
    ) {
        return this.fetch<{ success: boolean; summary: string }>(`/users/${userId}/cinemeta`, {
            body: JSON.stringify(patch),
            method: "POST",
        });
    }

    async resetCinemeta(userId: string) {
        return this.fetch<{ success: boolean }>(`/users/${userId}/cinemeta`, { method: "DELETE" });
    }

    // Passkeys (WebAuthn). Registering one always requires an existing
    // session; signing in with one is in publicAuth on the server side and is
    // called straight from the login page, not through here.
    async getPasskeys() {
        return this.fetch<{ passkeys: PasskeyRow[]; currentRpId: string | null }>("/passkeys");
    }

    async getPasskeyRegistrationOptions() {
        return this.fetch<PublicKeyCredentialCreationOptionsJSON>("/passkeys/register/options", {
            body: JSON.stringify({}),
            method: "POST",
        });
    }

    async verifyPasskeyRegistration(credential: unknown, name: string) {
        return this.fetch<{ success: boolean; passkeys: PasskeyRow[] }>(
            "/passkeys/register/verify",
            {
                body: JSON.stringify({ credential, name }),
                method: "POST",
            }
        );
    }

    async deletePasskey(id: string) {
        return this.fetch<{ success: boolean; passkeys: PasskeyRow[] }>(`/passkeys/${id}`, {
            method: "DELETE",
        });
    }

    // Addons
    async getAddons() {
        return this.fetch<Addon[]>("/addons");
    }

    async getAddon(id: string) {
        return this.fetch<
            Addon & {
                groups?: {
                    id: string;
                    name: string;
                    color?: string;
                    users?: number;
                    addonCount?: number;
                    addons?: number;
                }[];
            }
        >(`/addons/${id}`);
    }

    /** Browse the public Stremio addon directory (proxied + cached by
     * server/routes/addonDirectory.js). Read-only: installing one of these
     * goes through createAddon below, which re-fetches the manifest from the
     * addon's own URL rather than trusting the directory listing. */
    async browseAddonDirectory(opts: { page?: number; search?: string; category?: string } = {}) {
        const params = new URLSearchParams();
        if (opts.page) {
            params.set("page", String(opts.page));
        }
        if (opts.search) {
            params.set("search", opts.search);
        }
        if (opts.category) {
            params.set("category", opts.category);
        }
        const qs = params.toString();
        return this.fetch<{
            addons: Array<{
                id: string | null;
                name: string;
                description: string;
                version: string | null;
                logo: string | null;
                manifestUrl: string;
                configureUrl: string | null;
                stars: number;
                types: string[];
                resources: string[];
                categories: string[];
            }>;
            pagination: {
                page: number;
                totalPages: number;
                total: number;
                hasNextPage: boolean;
                hasPreviousPage: boolean;
            };
            cached?: boolean;
        }>(`/addon-directory${qs ? `?${qs}` : ""}`);
    }

    async createAddon(data: CreateAddonData) {
        // Backend expects 'url' but we use 'manifestUrl' in the interface
        const payload: Partial<CreateAddonData> & { url?: string } = { ...data };
        if (payload.manifestUrl && !payload.url) {
            payload.url = payload.manifestUrl;
            delete payload.manifestUrl;
        }
        // If manifestData is provided, extract name from it if name is not provided
        // This ensures the backend always has a name field (required for duplicate check)
        if (payload.manifestData?.name && !payload.name) {
            payload.name = payload.manifestData.name;
        }
        // Keep manifestData if provided (for pre-fetched manifests)
        if (payload.manifestData) {
            // manifestData is already in the payload
        }
        const result = await this.fetch<Addon | { addon: Addon }>("/addons", {
            body: JSON.stringify(payload),
            method: "POST",
        });
        // Backend sometimes wraps addon in { addon, message }
        return "addon" in result ? result.addon : result;
    }

    async updateAddon(id: string, data: Partial<Addon>) {
        // Backend expects 'url' but we use 'manifestUrl' in the interface
        const payload: Partial<Addon> = { ...data };
        if (payload.manifestUrl && !payload.url) {
            payload.url = payload.manifestUrl;
            delete payload.manifestUrl;
        }
        return this.fetch<Addon>(`/addons/${id}`, {
            body: JSON.stringify(payload),
            method: "PUT",
        });
    }

    async toggleAddonStatus(id: string, isActive: boolean) {
        return this.fetch<Addon>(`/addons/${id}/toggle-status`, {
            body: JSON.stringify({ isActive }),
            method: "PATCH",
        });
    }

    /** Returns trashId when the addon was archived first, so the caller can
     * offer an immediate Undo - see server/utils/trash.js. */
    async deleteAddon(id: string) {
        return this.fetch<{ message?: string; trashId?: string | null }>(`/addons/${id}`, {
            method: "DELETE",
        });
    }

    async moveAddonToVault(
        id: string,
        category: string
    ): Promise<{ success: boolean; vaultEntryId: string; removedFromGroups: number }> {
        return this.fetch(`/addons/${id}/move-to-vault`, {
            body: JSON.stringify({ category }),
            method: "POST",
        });
    }

    async reloadAddon(id: string) {
        return this.fetch(`/addons/${id}/reload`, { method: "POST" });
    }

    async getAddonHealthHistory(id: string, limit = 50) {
        return this.fetch<{
            addonId: string;
            addonName: string;
            history: Array<{
                id: string;
                isOnline: boolean;
                error: string | null;
                checkedAt: string;
                responseTimeMs: number | null;
            }>;
        }>(`/addons/${id}/health-history?limit=${limit}`);
    }

    // AI incident summary of recent health-check history - null when the
    // history is clean (nothing to summarize) or no AI key is configured.
    async getAddonHealthSummary(id: string) {
        return this.fetch<{ summary: string | null }>(`/addons/${id}/health-summary`);
    }

    // Backup Management
    async getAddonBackup(id: string) {
        return this.fetch<{
            addonId: string;
            addonName: string;
            usingBackup: boolean;
            backup: {
                id: string;
                manifestUrl: string;
                stremioAddonId: string | null;
                name: string | null;
                isOnline: boolean;
                lastCheck: string | null;
                checkError: string | null;
                createdAt: string;
                updatedAt: string;
            } | null;
        }>(`/addons/${id}/backup`);
    }

    async setAddonBackup(id: string, backupAddonId: string) {
        return this.fetch<{
            message: string;
            backupAddon: {
                id: string;
                name: string;
                isActive: boolean;
                isOnline: boolean;
            };
        }>(`/addons/${id}/backup`, {
            body: JSON.stringify({ backupAddonId }),
            method: "PUT",
        });
    }

    async deleteAddonBackup(id: string) {
        return this.fetch<{ message: string }>(`/addons/${id}/backup`, {
            method: "DELETE",
        });
    }

    async getAddonBackupActive(id: string) {
        return this.fetch<{
            chain: Array<{
                id: string;
                name: string;
                isActive: boolean;
                isOnline: boolean;
                lastHealthCheck: string | null;
            }>;
            activeAddon: {
                id: string;
                name: string;
                isActive: boolean;
                isOnline: boolean;
                lastHealthCheck: string | null;
            };
            isUsingBackup: boolean;
            totalChainLength: number;
            message: string;
        }>(`/addons/${id}/backup/active`);
    }

    // Proxy
    // These three routes answer through responseUtils.success, which wraps the
    // payload as { success, message, data } - so the fields live under .data,
    // NOT at the top level. The declared return types used to claim otherwise,
    // which meant every caller read `result.proxyUuid` as undefined: the proxy
    // was enabled correctly server-side, but the page then rendered "Not
    // generated" until a manual reload. Unwrapped here so callers keep the
    // flat shape they always expected.
    private async proxyAction(id: string, action: "enable" | "disable" | "regenerate") {
        const res = await this.fetch<
            { success?: boolean; data?: ProxyActionResult } & Partial<ProxyActionResult>
        >(`/addons/${id}/proxy/${action}`, { method: "POST" });
        // Tolerates both shapes, so this cannot break again if a route is ever
        // changed to answer flat.
        return (res?.data ?? res) as ProxyActionResult;
    }

    async enableProxy(id: string): Promise<ProxyActionResult> {
        return this.proxyAction(id, "enable");
    }

    async disableProxy(id: string): Promise<ProxyActionResult> {
        return this.proxyAction(id, "disable");
    }

    async regenerateProxyUuid(id: string): Promise<ProxyActionResult> {
        return this.proxyAction(id, "regenerate");
    }

    async getProxyLogs(
        id: string,
        limit?: number,
        offset?: number
    ): Promise<{ logs: ProxyRequestLog[]; total: number; limit: number; offset: number }> {
        const params = new URLSearchParams();
        if (limit) {
            params.append("limit", limit.toString());
        }
        if (offset) {
            params.append("offset", offset.toString());
        }
        const query = params.toString() ? `?${params.toString()}` : "";
        const response = await this.fetch<{
            success: boolean;
            data: { logs: ProxyRequestLog[]; total: number; limit: number; offset: number };
        }>(`/addons/${id}/proxy-logs${query}`);
        return response.data;
    }

    async getAllProxyLogs(
        limit?: number,
        offset?: number,
        addonId?: string
    ): Promise<{ logs: ProxyRequestLog[]; total: number; limit: number; offset: number }> {
        const params = new URLSearchParams();
        if (limit) {
            params.append("limit", limit.toString());
        }
        if (offset) {
            params.append("offset", offset.toString());
        }
        if (addonId) {
            params.append("addonId", addonId);
        }
        const query = params.toString() ? `?${params.toString()}` : "";
        const response = await this.fetch<{
            success: boolean;
            data: { logs: ProxyRequestLog[]; total: number; limit: number; offset: number };
        }>(`/addons/proxy-logs/all${query}`);
        return response.data;
    }

    // Invitations
    async getInvitations() {
        return this.fetch<Invitation[]>("/invitations");
    }

    // Just what the notification bell shows: waiting requests and the last
    // month's accepted ones.
    async getInvitationBell() {
        return this.fetch<{
            pending: (InviteRequest & { groupName?: string; invitationName?: string })[];
            accepted: (InviteRequest & { groupName?: string; invitationName?: string })[];
        }>("/invitations/bell");
    }

    async createInvitation(data: CreateInvitationData) {
        // Map frontend field names to backend field names
        // IMPORTANT: Use null instead of undefined so JSON.stringify includes the key
        // Backend treats null/undefined as unlimited (0)
        const payload = {
            expiresAt: data.expiresAt || null,
            groupName: data.groupName || null,
            jellyfinServerKey: data.jellyfinServerKey || null,
            // Explicitly send null for unlimited (backend treats null as 0 = unlimited)
            maxUses: data.maxUses ?? null,
            // Backend expects membershipDurationDays, not membershipDuration
            membershipDurationDays: data.membershipDuration ?? null,
            name: data.name || null,
            syncOnJoin: data.syncOnJoin ?? false,
        };
        const result = await this.fetch<Invitation | { invitation: Invitation }>("/invitations", {
            body: JSON.stringify(payload),
            method: "POST",
        });
        return "invitation" in result ? result.invitation : result;
    }

    async updateInvitation(id: string, data: Partial<CreateInvitationData>) {
        // Map frontend field names to backend field names
        // Use null instead of undefined so JSON.stringify includes the key
        const payload: Partial<{
            name: string | null;
            groupName: string | null;
            maxUses: number | null;
            expiresAt: string | null;
            membershipDurationDays: number | null;
            syncOnJoin: boolean;
            jellyfinServerKey: string | null;
        }> = {};
        if (data.name !== undefined) {
            payload.name = data.name || null;
        }
        if (data.groupName !== undefined) {
            payload.groupName = data.groupName || null;
        }
        // Explicitly send null for unlimited (backend treats null as 0 = unlimited)
        if (data.maxUses !== undefined) {
            payload.maxUses = data.maxUses ?? null;
        }
        if (data.expiresAt !== undefined) {
            payload.expiresAt = data.expiresAt || null;
        }
        if (data.membershipDuration !== undefined) {
            payload.membershipDurationDays = data.membershipDuration ?? null;
        }
        if (data.syncOnJoin !== undefined) {
            payload.syncOnJoin = data.syncOnJoin;
        }
        if (data.jellyfinServerKey !== undefined) {
            payload.jellyfinServerKey = data.jellyfinServerKey || null;
        }

        return this.fetch<Invitation>(`/invitations/${id}`, {
            body: JSON.stringify(payload),
            method: "PATCH",
        });
    }

    async toggleInvitationStatus(id: string, isActive: boolean) {
        return this.fetch<Invitation>(`/invitations/${id}/toggle-status`, {
            body: JSON.stringify({ isActive }),
            method: "PATCH",
        });
    }

    async refreshInvitationOAuth(requestId: string) {
        return this.fetch<{ oauthCode: string; oauthLink: string; oauthExpiresAt: string }>(
            `/invitations/requests/${requestId}/refresh-oauth`,
            {
                method: "POST",
            }
        );
    }

    async deleteInvitation(id: string) {
        return this.fetch(`/invitations/${id}`, { method: "DELETE" });
    }

    async getInvitationRequests(id: string) {
        return this.fetch<InviteRequest[]>(`/invitations/${id}/requests`);
    }

    async acceptInviteRequest(requestId: string) {
        return this.fetch(`/invitations/requests/${requestId}/accept`, { method: "POST" });
    }

    async rejectInviteRequest(requestId: string) {
        return this.fetch(`/invitations/requests/${requestId}/reject`, { method: "POST" });
    }

    // Account/Stats
    async getAccountStats() {
        return this.fetch<AccountStats>("/ext/account");
    }

    // Identity of the signed-in account, over the ordinary session cookie.
    // Deliberately not getAccountStats() for this: that hits /ext/*, which
    // authenticates with an API key, and a freshly registered account hasn't
    // configured one yet - it 401s for exactly the new accounts that need
    // identifying most.
    async getAccountIdentity() {
        return this.fetch<{ id: string; uuid: string | null }>("/settings/account-info");
    }

    async updateAccountAvatar(avatarUrl: string | null) {
        return this.fetch<{ avatarUrl: string | null }>("/settings/account-avatar", {
            body: JSON.stringify({ avatarUrl }),
            method: "PUT",
        });
    }

    async updateAccountDisplayName(displayName: string | null) {
        return this.fetch<{ displayName: string | null }>("/settings/account-display-name", {
            body: JSON.stringify({ displayName }),
            method: "PUT",
        });
    }

    // Settings
    async getSyncSettings() {
        return this.fetch<SyncSettings>("/settings/account-sync");
    }

    async updateSyncSettings(data: Partial<SyncSettings>) {
        return this.fetch<SyncSettings>("/settings/account-sync", {
            body: JSON.stringify(data),
            method: "PUT",
        });
    }

    // Self-service, irreversible, public-instance-only - see the server
    // route's own comment for why this never accepts an id (always the
    // caller's own account, resolved server-side from the session).
    async deleteMyAccount() {
        return this.fetch<{ deleted: boolean }>("/settings/delete-account", { method: "POST" });
    }

    /** Asks a self-hosted Nuvio backend to describe itself via /.well-known/nuvio. */
    async discoverNuvioBackend(url: string) {
        return this.fetch<{ ok: boolean; url?: string; anonKey?: string; error?: string }>(
            "/settings/account-sync/discover-nuvio",
            {
                body: JSON.stringify({ url }),
                method: "POST",
            }
        );
    }

    async testWebhook(webhookUrl: string) {
        return this.fetch("/settings/account-sync/test-webhook", {
            body: JSON.stringify({ webhookUrl }),
            method: "POST",
        });
    }

    async generateMosaicNow(month?: string) {
        return this.fetch<{
            posted: boolean;
            reason?: string | null;
            count: number;
            month?: string;
        }>("/settings/mosaic/generate-now", {
            body: JSON.stringify(month ? { month } : {}),
            method: "POST",
        });
    }

    async getApiKeyStatus() {
        return this.fetch<{ hasKey: boolean; apiKey?: string }>("/settings/account-api");
    }

    async generateApiKey() {
        return this.fetch<{ apiKey: string }>("/settings/account-api-key", {
            method: "POST",
        });
    }

    async rotateApiKey() {
        return this.fetch<{ apiKey: string }>("/settings/account-api-key", {
            method: "PUT",
        });
    }

    // AI Services - powers natural-language Catalog building (Catalogs ->
    // "Describe a catalog"). Stored as a Vault entry underneath, but this is
    // the focused Settings-native form for it - see server/routes/settings.js's
    // account-ai-services comment for why.
    async getAiServicesStatus() {
        return this.fetch<{
            configured: boolean;
            baseUrl?: string | null;
            model?: string | null;
            lastCheckStatus?: "ok" | "error" | null;
            lastCheckMessage?: string | null;
        }>("/settings/account-ai-services");
    }
    // The real stored key, for the eye icon's reveal - same underlying
    // VaultEntry secret as vault.js's own /:id/reveal.
    async revealAiServicesKey() {
        return this.fetch<{ secret: string }>("/settings/account-ai-services/reveal", {
            method: "POST",
        });
    }
    // Saving always re-verifies with a real request (see settings.js's own
    // comment) - the response's lastCheckStatus/Message reflect that just-run
    // check, not merely "something got saved."
    async setAiServices(data: { apiKey?: string; baseUrl?: string; model?: string }) {
        return this.fetch<{
            configured: boolean;
            lastCheckStatus: "ok" | "error";
            lastCheckMessage: string | null;
        }>("/settings/account-ai-services", {
            body: JSON.stringify(data),
            method: "PUT",
        });
    }
    // Live model list from the provider itself, not a hardcoded guess - see
    // settings.js's own comment on why (model names go stale fast). apiKey
    // blank falls back to whatever's already saved.
    async listAiModels(data: { apiKey?: string; baseUrl?: string }) {
        return this.fetch<{ models: string[] }>("/settings/account-ai-services/list-models", {
            body: JSON.stringify(data),
            method: "POST",
        });
    }
    async removeAiServices() {
        return this.fetch<{ configured: boolean }>("/settings/account-ai-services", {
            method: "DELETE",
        });
    }

    // Two-factor auth (TOTP) - opt-in, per account. See server/utils/twoFactor.js.
    async get2faStatus() {
        return this.fetch<{ enabled: boolean }>("/settings/account-2fa");
    }
    async setup2fa() {
        return this.fetch<{ secret: string; otpauthUrl: string; qrCodeDataUrl: string }>(
            "/settings/account-2fa/setup",
            {
                method: "POST",
            }
        );
    }
    async enable2fa(secret: string, code: string) {
        return this.fetch<{ enabled: boolean; backupCodes: string[] }>(
            "/settings/account-2fa/enable",
            {
                body: JSON.stringify({ code, secret }),
                method: "POST",
            }
        );
    }
    async disable2fa(code: string) {
        return this.fetch<{ enabled: boolean }>("/settings/account-2fa/disable", {
            body: JSON.stringify({ code }),
            method: "POST",
        });
    }
    async regenerate2faBackupCodes(code: string) {
        return this.fetch<{ backupCodes: string[] }>("/settings/account-2fa/backup-codes", {
            body: JSON.stringify({ code }),
            method: "POST",
        });
    }

    async getBackupFrequency() {
        return this.fetch<{ days: number }>("/settings/backup-frequency");
    }

    async setBackupFrequency(days: number) {
        return this.fetch("/settings/backup-frequency", {
            body: JSON.stringify({ days }),
            method: "PUT",
        });
    }

    async runBackupNow() {
        return this.fetch("/settings/backup-now", { method: "POST" });
    }

    async listBackups() {
        return this.fetch<BackupFile[]>("/settings/backups");
    }

    async getDbSizeReport() {
        return this.fetch<DbSizeReport>("/settings/db-size");
    }

    async downloadBackup(filename: string) {
        const response = await fetch(
            `${API_BASE}/settings/backups/${encodeURIComponent(filename)}/download`,
            {
                credentials: "include",
                headers: this.getAuthHeaders(),
            }
        );
        if (!response.ok) {
            const error = await response.json().catch(() => ({ message: "Download failed" }));
            throw new Error(error.message || `HTTP ${response.status}`);
        }
        const blob = await response.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = filename;
        a.click();
        URL.revokeObjectURL(url);
    }

    // DESTRUCTIVE - replaces all current users/groups/addons with the
    // backup's contents. Caller is responsible for confirming with the user
    // first; this just performs the restore.
    /** What restoring this backup would change - names only, computed before
     * anything is touched. Feeds the confirmation dialog. */
    async diffBackup(filename: string) {
        return this.fetch<{
            backupDate: string | null;
            addons: { added: string[]; removed: string[]; changed: string[] };
            users: { added: string[]; removed: string[] };
            groups: { added: string[]; removed: string[] };
            counts: {
                backup: { addons: number; users: number; groups: number };
                current: { addons: number; users: number; groups: number };
            };
        }>(`/settings/backups/${encodeURIComponent(filename)}/diff`);
    }

    /** One-code migration: mint a single-use 15-minute code carrying this
     * instance's whole household to a new server. */
    async offerMigration() {
        return this.fetch<{ code: string; expiresInMinutes: number }>("/settings/migration/offer", {
            method: "POST",
        });
    }

    /** Paste the code on the NEW instance - fetches and restores everything.
     * Destructive: replaces this instance's data. */
    async receiveMigration(code: string) {
        return this.fetch<{
            counts?: { users?: number; groups?: number; addons?: number };
            message?: string;
        }>("/settings/migration/receive", {
            body: JSON.stringify({ code }),
            method: "POST",
        });
    }

    async restoreBackup(filename: string) {
        return this.fetch<ImportConfigResult>(
            `/settings/backups/${encodeURIComponent(filename)}/restore`,
            {
                method: "POST",
            }
        );
    }

    async deleteBackup(filename: string) {
        return this.fetch(`/settings/backups/${encodeURIComponent(filename)}`, {
            method: "DELETE",
        });
    }

    // Disaster Recovery Kit - unlike the regular config backup above (Users/
    // Groups/Addons only), this also bundles every Vault secret, re-encrypted
    // under the passphrase supplied here instead of this instance's own
    // ENCRYPTION_KEY, so the file is portable to a brand-new instance.
    async exportDisasterRecoveryKit(passphrase: string) {
        return this.fetch<DisasterRecoveryKit>("/settings/disaster-recovery-kit/export", {
            body: JSON.stringify({ passphrase }),
            method: "POST",
        });
    }

    async importDisasterRecoveryKit(passphrase: string, kit: DisasterRecoveryKit) {
        return this.fetch<{
            restoredVaultCount: number;
            counts: { users: number; groups: number; addons: number };
        }>("/settings/disaster-recovery-kit/import", {
            body: JSON.stringify({ kit, passphrase }),
            method: "POST",
        });
    }

    // Addon Snapshots ("Templates") - save a user's/group's current addon
    // set as a named, reusable template; deploy it onto any user later.
    async getSnapshots() {
        return this.fetch<AddonSnapshot[]>("/snapshots");
    }

    async getSnapshot(id: string) {
        return this.fetch<AddonSnapshotDetail>(`/snapshots/${id}`);
    }

    async createSnapshot(data: {
        name: string;
        description?: string;
        sourceType: "user" | "group";
        sourceId: string;
    }) {
        return this.fetch<{ id: string; name: string; addonCount: number }>("/snapshots", {
            body: JSON.stringify(data),
            method: "POST",
        });
    }

    // --- Backup targets, DB maintenance, updates (private mode) ---
    async getBackupTargets() {
        return this.fetch<BackupTargets>("/settings/backup-targets");
    }
    async saveBackupTargets(data: Partial<BackupTargets>) {
        return this.fetch<BackupTargets>("/settings/backup-targets", {
            body: JSON.stringify(data),
            method: "PUT",
        });
    }
    async testBackupTarget() {
        return this.fetch<{ ok: boolean; location?: string; error?: string }>(
            "/settings/backup-targets/test",
            { method: "POST" }
        );
    }
    /** Full-data backups: real database snapshots, the only lane carrying watch history. */
    async getDataBackup() {
        return this.fetch<DataBackupSettings>("/settings/data-backup");
    }
    async saveDataBackup(
        data: Partial<
            Pick<DataBackupSettings, "enabled" | "offsite" | "frequencyDays" | "keepLocal">
        >
    ) {
        return this.fetch<DataBackupSettings>("/settings/data-backup", {
            body: JSON.stringify(data),
            method: "PUT",
        });
    }
    async runDataBackup() {
        return this.fetch<{
            filename: string;
            sizeBytes: number;
            encrypted: boolean;
            verified: boolean | null;
            users: number | null;
            upload?: { skipped?: string; ok?: boolean };
        }>("/settings/data-backup/run", { method: "POST" });
    }
    async deleteDataSnapshot(filename: string) {
        return this.fetch<{ success: boolean }>(
            `/settings/data-backup/${encodeURIComponent(filename)}`,
            { method: "DELETE" }
        );
    }
    /** Downloads a snapshot to disk - it is the file scripts/restore-data-snapshot.js takes. */
    async downloadDataSnapshot(filename: string) {
        const response = await fetch(
            `${API_BASE}/settings/data-backup/${encodeURIComponent(filename)}/download`,
            {
                credentials: "include",
                headers: this.getAuthHeaders(),
            }
        );
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }
        const blob = await response.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = filename;
        a.click();
        URL.revokeObjectURL(url);
    }

    async getDbMaintenance() {
        return this.fetch<DbMaintenanceSettings>("/settings/db-maintenance");
    }
    async saveDbMaintenance(data: Partial<DbMaintenanceSettings>) {
        return this.fetch<DbMaintenanceSettings>("/settings/db-maintenance", {
            body: JSON.stringify(data),
            method: "PUT",
        });
    }
    async runDbMaintenance(action: "integrity" | "vacuum" | "prune" | "pruneNotifications") {
        return this.fetch<Record<string, unknown>>("/settings/db-maintenance/run", {
            body: JSON.stringify({ action }),
            method: "POST",
        });
    }
    async getUpdateCapability() {
        return this.fetch<UpdateCapability>("/settings/update-capability");
    }
    async applyUpdate() {
        return this.fetch<{ started: boolean; note: string }>("/settings/update-apply", {
            method: "POST",
        });
    }
    /** Restart onto the image recorded before the last self-update. */
    async rollbackUpdate() {
        return this.fetch<{ started: boolean; rollingBackTo: string; note: string }>(
            "/settings/update-rollback",
            { method: "POST" }
        );
    }

    /** Create a template directly from an addon list (share-code import) -
     * the server encrypts the manifest URLs at rest with ITS key. */
    async importSnapshot(data: {
        name: string;
        description?: string;
        addons: Array<{
            name: string;
            manifestUrl: string | null;
            stremioAddonId?: string | null;
            version?: string | null;
        }>;
    }) {
        return this.fetch<{ id: string; name: string; addonCount: number }>("/snapshots/import", {
            body: JSON.stringify(data),
            method: "POST",
        });
    }

    async deploySnapshot(id: string, targetUserId: string) {
        return this.fetch<{
            deployed: number;
            failed: number;
            targetUserId: string;
            leftOut?: string[];
        }>(`/snapshots/${id}/deploy`, {
            body: JSON.stringify({ targetUserId }),
            method: "POST",
        });
    }

    async deleteSnapshot(id: string) {
        return this.fetch(`/snapshots/${id}`, { method: "DELETE" });
    }

    // New-episode alerts (fired server-side by the episodeAlerts poller)
    async getEpisodeAlerts(days = 14) {
        return this.fetch<EpisodeAlert[]>(`/users/episode-alerts?days=${days}`);
    }

    // Addon online<->offline transitions (fired server-side by addonHealthCheck.js)
    async getAddonHealthAlerts(days = 14) {
        return this.fetch<AddonHealthAlert[]>(`/addons/health-alerts?days=${days}`);
    }

    // Persistent in-app bell notifications - written server-side from the same
    // dispatch path as push/Discord (notificationStore.js), with server-side
    // read state so the bell is consistent across devices.
    async getNotifications(days = 14) {
        return this.fetch<StoredNotification[]>(`/users/notifications?days=${days}`);
    }

    // Mark notifications read - specific ids, or all when omitted.
    async markNotificationsRead(ids?: string[]) {
        return this.fetch("/users/notifications/mark-read", {
            body: JSON.stringify(ids ? { ids } : {}),
            method: "POST",
        });
    }

    // Delete notifications - specific ids, or all when omitted (Clear).
    async dismissNotifications(ids?: string[]) {
        return this.fetch("/users/notifications/dismiss", {
            body: JSON.stringify(ids ? { ids } : {}),
            method: "POST",
        });
    }

    // PWA web-push
    async getPushVapidKey() {
        return this.fetch<{ enabled: boolean; publicKey: string | null }>("/push/vapid-key");
    }

    async savePushSubscription(sub: PushSubscriptionJSON, userAgent?: string) {
        return this.fetch("/push/subscribe", {
            body: JSON.stringify({ ...sub, userAgent }),
            method: "POST",
        });
    }

    async removePushSubscription(endpoint: string) {
        return this.fetch("/push/unsubscribe", {
            body: JSON.stringify({ endpoint }),
            method: "POST",
        });
    }

    async getPushDevices() {
        return this.fetch<PushDevice[]>("/push/devices");
    }

    async renamePushDevice(id: string, label: string | null) {
        return this.fetch<PushDevice>(`/push/devices/${id}`, {
            body: JSON.stringify({ label }),
            method: "PATCH",
        });
    }

    async revokePushDevice(id: string) {
        return this.fetch<{ success: boolean }>(`/push/devices/${id}`, { method: "DELETE" });
    }

    async repairAddons() {
        return this.fetch<{ inspected: number; updated: number }>("/settings/repair-addons", {
            method: "POST",
        });
    }

    // Addon Health Check
    async getAddonHealthCheckSettings() {
        return this.fetch<{ enabled: boolean; intervalMinutes: number }>(
            "/settings/addon-health-check"
        );
    }

    async setAddonHealthCheckInterval(intervalMinutes: number) {
        return this.fetch("/settings/addon-health-check", {
            body: JSON.stringify({ intervalMinutes }),
            method: "PUT",
        });
    }

    async runAddonHealthCheckNow() {
        return this.fetch("/settings/addon-health-check/now", { method: "POST" });
    }

    /** Validity check for whichever of the four metadata-provider keys
     * (TMDb/OMDb/MDBList/RPDB) are actually configured for this account -
     * see server/utils/metadataKeyHealth.js. Returns the merged keyHealth
     * map, same shape SyncSettings.keyHealth carries. */
    /** What this instance has and hasn't been configured with yet, in one
     * call - see server/routes/settings.js's setup-status route. */
    async getSetupStatus() {
        return this.fetch<{
            users: { done: boolean; count: number };
            addons: { done: boolean; count: number };
            notifications: { done: boolean; pushDevices: number };
            vault: { done: boolean; count: number };
            offsiteBackup: { done: boolean };
            recoveryKit: { done: boolean; lastExportAt: string | null };
            automation: { done: boolean; count: number };
            timezone: { done: boolean };
        }>("/settings/setup-status");
    }

    /** Read-only scan for provably-wrong watch history rows. Never writes -
     * see server/utils/historyDoctor.js. */
    async scanHistory() {
        return this.fetch<{
            findings: Array<{ id: string; kind: string; summary: string; detail: string }>;
            counts: { cross_provider_duplicate: number; orphaned: number; total: number };
            scannedAt: string;
        }>("/settings/history-scan");
    }

    /** Deletes what a fresh server-side scan identifies. */
    async repairHistory(kinds?: string[]) {
        return this.fetch<{ removed: number; examined: number }>("/settings/history-repair", {
            body: JSON.stringify({ kinds: kinds || null }),
            method: "POST",
        });
    }

    /** Recently deleted catalogs and addons, restorable for 30 days.
     * See server/utils/trash.js for why this is an archive rather than
     * deletedAt columns. */
    async getTrash() {
        return this.fetch<
            Array<{
                id: string;
                kind: string;
                label: string;
                deletedAt: string;
                expiresInDays: number;
            }>
        >("/settings/trash");
    }

    async restoreFromTrash(trashId: string) {
        return this.fetch<{ kind: string; label: string }>(
            `/settings/trash/${encodeURIComponent(trashId)}/restore`,
            { method: "POST" }
        );
    }

    /** Permanent - the one delete with nothing behind it. */
    async purgeTrashItem(trashId: string) {
        return this.fetch<{ success: boolean }>(`/settings/trash/${encodeURIComponent(trashId)}`, {
            method: "DELETE",
        });
    }

    /** No argument checks all four keys; a provider name checks just that one
     * (the save-time verification for a single edited field). */
    /** Whether this account's LumiereDB is up - `fresh` skips the minute-long cache. */
    async getLumiereStatus(fresh = false) {
        return this.fetch<LumiereStatus>(`/settings/lumiere-status${fresh ? "?fresh=1" : ""}`);
    }

    async checkProviderKeys(
        provider?: "tmdb" | "omdb" | "mdblist" | "rpdb"
    ): Promise<{ keyHealth: SyncSettings["keyHealth"] }> {
        const res = await this.fetch<
            { data?: { keyHealth: SyncSettings["keyHealth"] } } & Partial<{
                keyHealth: SyncSettings["keyHealth"];
            }>
        >("/settings/check-keys", {
            body: JSON.stringify(provider ? { provider } : {}),
            method: "POST",
        });
        return (res?.data ?? res) as { keyHealth: SyncSettings["keyHealth"] };
    }

    // Bulk Operations
    async syncAllUsers() {
        const users = await this.getUsers();
        const results = { failed: 0, success: 0 };
        for (const user of users) {
            try {
                await this.syncUser(user.id);
                results.success++;
            } catch {
                results.failed++;
            }
        }
        return results;
    }

    async syncAllGroups() {
        return this.fetch<{
            syncedGroups: number;
            failedGroups: number;
            totalUsersSynced: number;
            totalUsersFailed: number;
        }>("/groups/sync-all", { method: "POST" });
    }

    async deleteAllUsers() {
        const users = await this.getUsers();
        const results = { failed: 0, success: 0 };
        for (const user of users) {
            try {
                await this.deleteUser(user.id);
                results.success++;
            } catch {
                results.failed++;
            }
        }
        return results;
    }

    async deleteAllGroups() {
        const groups = await this.getGroups();
        const results = { failed: 0, success: 0 };
        for (const group of groups) {
            try {
                await this.deleteGroup(group.id);
                results.success++;
            } catch {
                results.failed++;
            }
        }
        return results;
    }

    // Metrics Migration
    async getMetricsMigrationPreview() {
        return this.fetch<{
            migrationStatus: {
                hasExistingData: boolean;
                alreadyMigrated: boolean;
                sessionsCount: number;
                episodesCount: number;
                activitiesCount: number;
            };
            users: {
                userId: string;
                username: string;
                movies: number;
                shows: number;
                watchTimeHours: number;
                dateRange: { earliest: string; latest: string } | null;
            }[];
            totals: {
                users: number;
                movies: number;
                shows: number;
                watchTimeHours: number;
                pendingMigration: boolean;
            };
        }>("/users/metrics-migration-preview");
    }

    async runMetricsMigration() {
        return this.fetch<{
            migrated: boolean;
            sessionsCreated: number;
            episodesCreated: number;
            reason?: string;
        }>("/users/metrics-migration", { method: "POST" });
    }

    async deleteAllAddons() {
        const addons = await this.getAddons();
        const results = { failed: 0, success: 0 };
        for (const addon of addons) {
            try {
                await this.deleteAddon(addon.id);
                results.success++;
            } catch {
                results.failed++;
            }
        }
        return results;
    }

    async clearAllUserAddons() {
        const users = await this.getUsers();
        const results = { failed: 0, success: 0 };
        for (const user of users) {
            try {
                await this.fetch(`/users/${user.id}/stremio-addons/clear`, { method: "POST" });
                results.success++;
            } catch {
                results.failed++;
            }
        }
        return results;
    }

    async reloadAllAddons() {
        return this.fetch<{ reloaded: number }>("/addons/reload-all", { method: "POST" });
    }

    // Import/Export
    async exportAddons() {
        return this.fetch<Addon[]>("/public-auth/addon-export");
    }

    async exportConfig() {
        return this.fetch<ExportedConfig>("/public-auth/config-export");
    }

    async importAddons(file: File) {
        const formData = new FormData();
        formData.append("file", file);
        const response = await fetch(`${API_BASE}/public-auth/addon-import`, {
            body: formData,
            credentials: "include",
            headers: this.getAuthHeaders("POST"),
            method: "POST",
        });
        if (!response.ok) {
            const error = await response.json().catch(() => ({ message: "Import failed" }));
            throw new Error(error.message || `HTTP ${response.status}`);
        }
        return response.json() as Promise<{
            successful: number;
            failed: number;
            redundant: number;
        }>;
    }

    async importConfig(file: File, passphrase?: string) {
        const formData = new FormData();
        formData.append("file", file);
        // Only needed for .enc files from a passphrase-protected off-site
        // target - the server answers code PASSPHRASE_REQUIRED when one is
        // missing, and the Tasks page prompts and retries.
        if (passphrase) {
            formData.append("passphrase", passphrase);
        }
        const response = await fetch(`${API_BASE}/public-auth/config-import`, {
            body: formData,
            credentials: "include",
            headers: this.getAuthHeaders("POST"),
            method: "POST",
        });
        if (!response.ok) {
            const error = await response.json().catch(() => ({ message: "Import failed" }));
            const err = new ApiError(error.message || `HTTP ${response.status}`);
            err.code = error.code;
            throw err;
        }
        return response.json() as Promise<ImportConfigResult>;
    }

    /** Enable/disable the SlickTrax Addon for a user - the per-user Stremio
     * addon serving Continue Watching / Watchlist / Catalogs inside the apps.
     * rotate: true issues a fresh URL token, killing the old URL everywhere. */
    async setTraxAddon(userId: string, enabled: boolean, rotate = false) {
        return this.fetch<{ enabled: boolean; manifestUrl: string; autoInstall: boolean }>(
            `/users/${encodeURIComponent(userId)}/trax-addon`,
            { body: JSON.stringify({ enabled, rotate }), method: "POST" }
        );
    }

    // Watch-history CSV import (IMDb/Letterboxd/loose-Trakt-export compatible -
    // see server/utils/csvHistoryImport.js) for one household member.
    /** Vault-inject an addon: its embedded secrets become {{vault:id}}
     * placeholders that only the server-side proxy resolves, so the real key
     * never again appears in the stored URL or on any device. */
    async vaultifyAddon(addonId: string) {
        return this.fetch<VaultifyResult | { data: VaultifyResult; message?: string }>(
            `/addons/${encodeURIComponent(addonId)}/vaultify`,
            { method: "POST" }
        );
    }

    async unvaultifyAddon(addonId: string) {
        return this.fetch<{ data?: { vaultified: boolean } } & { message?: string }>(
            `/addons/${encodeURIComponent(addonId)}/unvaultify`,
            { method: "POST" }
        );
    }

    async importUserHistory(userId: string, file: File) {
        const formData = new FormData();
        formData.append("file", file);
        const response = await fetch(
            `${API_BASE}/users/${encodeURIComponent(userId)}/import-history`,
            {
                body: formData,
                credentials: "include",
                headers: this.getAuthHeaders("POST"),
                method: "POST",
            }
        );
        if (!response.ok) {
            const error = await response.json().catch(() => ({ error: "Import failed" }));
            throw new Error(error.error || `HTTP ${response.status}`);
        }
        return response.json() as Promise<{
            imported: number;
            skipped: number;
            skippedEpisodes?: number;
            totalRows: number;
            truncated: boolean;
            unresolvedTitles: string[];
        }>;
    }

    // Letterboxd-import-compatible CSV export for one household member - a
    // raw text fetch (not JSON), so the caller builds a download Blob from
    // it, same pattern as every other "export my data" flow in this app
    // (a plain <a href> to the API URL would bypass the auth headers this
    // request needs).
    async exportUserHistory(userId: string): Promise<string> {
        const response = await fetch(
            `${API_BASE}/users/${encodeURIComponent(userId)}/export-history.csv`,
            {
                credentials: "include",
                headers: this.getAuthHeaders("GET"),
            }
        );
        if (!response.ok) {
            const error = await response.json().catch(() => ({ error: "Export failed" }));
            throw new Error(error.error || `HTTP ${response.status}`);
        }
        return response.text();
    }

    async resetConfig() {
        return this.fetch("/public-auth/reset", { method: "POST" });
    }

    async backupUserLibrary(userId: string) {
        const response = await fetch(`${API_BASE}/users/${userId}/library/backup`, {
            credentials: "include",
            headers: this.getAuthHeaders(),
        });
        if (!response.ok) {
            const error = await response.json().catch(() => ({ message: "Export failed" }));
            throw new Error(error.message || `HTTP ${response.status}`);
        }
        const data = await response.json();
        // Download as file
        const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
        const url = URL.createObjectURL(blob);
        const date = new Date().toISOString().split("T")[0].replace(/-/g, "");
        const a = document.createElement("a");
        a.href = url;
        a.download = `${date}-library-export.json`;
        a.click();
        URL.revokeObjectURL(url);
        return data;
    }

    // History export/import
    async exportHistory(userId?: string) {
        const queryParam = userId && userId !== "all" ? `?userId=${userId}` : "?userId=all";
        const response = await fetch(`${API_BASE}/users/history/export${queryParam}`, {
            credentials: "include",
            headers: this.getAuthHeaders(),
        });
        if (!response.ok) {
            const error = await response.json().catch(() => ({ message: "Export failed" }));
            throw new Error(error.message || `HTTP ${response.status}`);
        }
        const data = await response.json();
        // Download as file
        const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
        const url = URL.createObjectURL(blob);
        const date = new Date().toISOString().split("T")[0].replace(/-/g, "");
        const suffix = userId && userId !== "all" ? "-user" : "-all";
        const a = document.createElement("a");
        a.href = url;
        a.download = `${date}-history${suffix}.json`;
        a.click();
        URL.revokeObjectURL(url);
        return data;
    }

    async importHistory(
        file: File,
        targetUserId?: string
    ): Promise<{
        message: string;
        results: {
            watchSessions: { imported: number; skipped: number };
            episodeWatchHistory: { imported: number; skipped: number };
            watchActivity: { imported: number; skipped: number };
            watchSnapshots: { imported: number; skipped: number };
        };
    }> {
        const text = await file.text();
        const data = JSON.parse(text);
        if (targetUserId) {
            data.targetUserId = targetUserId;
        }
        return this.fetch("/users/history/import", {
            body: JSON.stringify(data),
            method: "POST",
        });
    }

    async clearUserHistory(userId: string): Promise<{
        message: string;
        deleted: {
            watchSessions: number;
            episodeWatchHistory: number;
            watchActivity: number;
            watchSnapshots: number;
        };
    }> {
        return this.fetch(`/users/${userId}/history`, {
            method: "DELETE",
        });
    }

    async clearUserLibrary(userId: string): Promise<{
        message: string;
        deleted: number;
    }> {
        return this.fetch(`/users/${userId}/library`, {
            method: "DELETE",
        });
    }

    async decodeWatchedBitfield(watched: string): Promise<{
        lastVideoId: string;
        lastLength: number;
        serializedBuf: string;
        watchedEpisodes: { episode: number; watched: boolean }[];
        watchedCount: number;
    }> {
        return this.fetch("/users/decode-watched", {
            body: JSON.stringify({ watched }),
            method: "POST",
        });
    }

    // Stremio OAuth (admin-side helpers)
    async generateStremioOAuth() {
        // Uses public-library router to create an OAuth link and code
        return this.fetch<{
            success?: boolean;
            code: string;
            link: string;
            expiresAt: string;
        }>("/public-library/generate-oauth", {
            method: "POST",
        });
    }

    async pollStremioOAuth(code: string) {
        // Polls public-library for OAuth completion and returns an authKey when ready
        return this.fetch<{
            success: boolean;
            authKey: string | null;
            error?: string;
        }>("/public-library/poll-oauth", {
            body: JSON.stringify({ code }),
            method: "POST",
        });
    }

    async verifyStremioAuthKey(payload: { authKey: string; username?: string; email?: string }) {
        // Lightweight verification + user info fetch; does NOT create or persist a user
        return this.fetch<{
            authKey: string;
            user?: { username?: string; email?: string };
        }>("/stremio/connect-authkey", {
            body: JSON.stringify(payload),
            method: "POST",
        });
    }

    async createUserWithStremio(data: {
        authKey: string;
        username: string;
        email: string;
        groupName?: string;
        colorIndex?: number;
    }) {
        // Mirrors old UI behavior by delegating user creation to /stremio/connect-authkey
        const payload = {
            authKey: data.authKey,
            colorIndex: data.colorIndex,
            create: true,
            email: data.email,
            groupName: data.groupName,
            username: data.username,
        };

        const result = await this.fetch<User | { user: User }>("/stremio/connect-authkey", {
            body: JSON.stringify(payload),
            method: "POST",
        });
        // Normalize to plain User
        return "user" in result ? result.user : result;
    }

    async createUserWithCredentials(data: {
        email: string;
        password: string;
        username: string;
        groupName?: string;
        colorIndex?: number;
        registerNew?: boolean;
    }) {
        const payload = {
            colorIndex: data.colorIndex,
            email: data.email,
            groupName: data.groupName,
            password: data.password,
            registerNew: data.registerNew,
            username: data.username,
        };

        const endpoint = data.registerNew ? "/stremio/register" : "/stremio/connect";
        const result = await this.fetch<User | { user: User }>(endpoint, {
            body: JSON.stringify(payload),
            method: "POST",
        });
        return "user" in result ? result.user : result;
    }

    // --- Jellyfin-compatible servers (a real Jellyfin, AIOStreams, AIOMetadata) ---
    // The server signs in; the browser only ever sends what the person typed.

    async jellyfinProbe(serverUrl: string) {
        return this.fetch<import("@/components/jellyfin/JellyfinSignIn").JellyfinServerInfo>(
            "/jellyfin/probe",
            {
                body: JSON.stringify({ serverUrl }),
                method: "POST",
            }
        );
    }

    async jellyfinStartQuickConnect(serverUrl: string) {
        return this.fetch<{ code: string; secret: string; device: string; serverUrl: string }>(
            "/jellyfin/quick-connect",
            {
                body: JSON.stringify({ serverUrl }),
                method: "POST",
            }
        );
    }

    async jellyfinQuickConnectStatus(params: {
        serverUrl: string;
        secret: string;
        device: string;
    }) {
        return this.fetch<{ authenticated: boolean; expired?: boolean }>(
            "/jellyfin/quick-connect-status",
            {
                body: JSON.stringify(params),
                method: "POST",
            }
        );
    }

    /** Adds a person signed in to their server - or, with userId, reconnects an existing one. */
    async connectUserWithJellyfin(
        data: import("@/components/jellyfin/JellyfinSignIn").JellyfinCredentials & {
            username?: string;
            groupName?: string;
            colorIndex?: number;
            userId?: string;
        }
    ) {
        const result = await this.fetch<
            (User | { user: User }) & { household?: HouseholdProfile[] }
        >("/jellyfin/connect", {
            body: JSON.stringify(data),
            method: "POST",
        });
        // The household that came along as profiles, for AIOStreams and AIOMetadata.
        return {
            ...("user" in result ? result.user : result),
            household: result.household || [],
        };
    }

    // --- AIOStreams Collections: SlickSync's catalogs as collections in AIOStreams' apps ---

    // Each AIOStreams login has its own collections; every profile on it sees them.
    async getAioCollectionAccounts() {
        return this.fetch<{ accounts: AioCollectionAccount[] }>("/jellyfin/collections/accounts");
    }

    /** The GET path for one account's (or profile's) collections - also the key api.peekGet reads. */
    aioCollectionsPath(userId: string, profileId?: string | null) {
        return `/jellyfin/collections?userId=${encodeURIComponent(userId)}${profileId ? `&profileId=${encodeURIComponent(profileId)}` : ""}`;
    }

    async getAioCollections(userId: string, profileId?: string | null) {
        return this.fetch<AioCollectionsView>(this.aioCollectionsPath(userId, profileId));
    }

    /** On a profile without collections of its own, the first save sets that up in AIOStreams. */
    async saveAioCollections(
        userId: string,
        collections: Pick<
            AioCollection,
            "id" | "name" | "coverUrl" | "catalogIds" | "hidden" | "order"
        >[],
        profileId?: string | null
    ) {
        return this.fetch<{ success: boolean }>("/jellyfin/collections", {
            body: JSON.stringify({ collections, profileId: profileId || undefined, userId }),
            method: "PUT",
        });
    }

    /** An account: back to one per catalog. A profile: back to its account's collections. */
    async resetAioCollections(userId: string, profileId?: string | null) {
        return this.fetch<{ success: boolean }>("/jellyfin/collections", {
            body: JSON.stringify({ profileId: profileId || undefined, reset: true, userId }),
            method: "PUT",
        });
    }

    // The collections with the catalogs they hold, titles included - what an
    // export file and a share code carry.
    async exportAioCollections(userId: string, profileId?: string | null) {
        const q = new URLSearchParams({ userId, ...(profileId ? { profileId } : {}) });
        return this.fetch<AioCollectionsExport>(`/jellyfin/collections/export?${q}`);
    }

    async importAioCollections(
        userId: string,
        payload: AioCollectionsExport,
        profileId?: string | null,
        mode: "add" | "replace" = "add"
    ) {
        return this.fetch<{ added: number; catalogsCreated: number; catalogsReused: number }>(
            "/jellyfin/collections/import",
            {
                body: JSON.stringify({ mode, payload, profileId: profileId || undefined, userId }),
                method: "POST",
            }
        );
    }

    // --- Jellyfin Collections: catalogs as collections on the household's own Jellyfin servers ---

    async getJellyfinCollectionServers() {
        return this.fetch<{ servers: JellyfinCollectionServer[] }>(
            "/jellyfin/server-collections/servers"
        );
    }

    jellyfinCollectionsPath(server: string) {
        return `/jellyfin/server-collections?server=${encodeURIComponent(server)}`;
    }

    async getJellyfinCollections(server: string) {
        return this.fetch<JellyfinCollectionsView>(this.jellyfinCollectionsPath(server));
    }

    /** Switch a catalog on or off for a server; the server is synced before this answers. */
    async setJellyfinCollection(server: string, catalogId: string, on: boolean) {
        return this.fetch<JellyfinCollectionsView>("/jellyfin/server-collections", {
            body: JSON.stringify({ catalogId, on, server }),
            method: "PUT",
        });
    }

    async syncJellyfinCollections(server: string) {
        return this.fetch<JellyfinCollectionsView>("/jellyfin/server-collections/sync", {
            body: JSON.stringify({ server }),
            method: "POST",
        });
    }

    // --- A Jellyfin sign-in's household (AIOStreams / AIOMetadata users as profiles) ---

    /** Sign a TV in with the Quick Connect code it shows, as this person or one of their household profiles. */
    /** Their SlickSync picture on their Jellyfin, AIOStreams or AIOMetadata server too. */
    async pushServerPicture(userId: string) {
        return this.fetch<{ success: boolean; server: string }>(
            `/jellyfin/users/${encodeURIComponent(userId)}/picture`,
            { method: "POST" }
        );
    }

    // Whether what someone finishes elsewhere is marked played on their real Jellyfin server.
    async getJellyfinMarkPlayed(userId: string) {
        return this.fetch<{ available: boolean; enabled: boolean; lists: boolean }>(
            `/jellyfin/users/${encodeURIComponent(userId)}/mark-played`
        );
    }

    /** `lists`: the household's watchlist and ratings on their server too. */
    async setJellyfinMarkPlayed(userId: string, change: { enabled?: boolean; lists?: boolean }) {
        return this.fetch<{ available: boolean; enabled: boolean; lists: boolean }>(
            `/jellyfin/users/${encodeURIComponent(userId)}/mark-played`,
            { body: JSON.stringify(change), method: "PUT" }
        );
    }

    // Opt-in: Vault key changes also update this AIOStreams person's debrid keys.
    async getAioRotateKeys(userId: string) {
        return this.fetch<{ available: boolean; canWrite?: boolean; enabled?: boolean }>(
            `/jellyfin/users/${encodeURIComponent(userId)}/aio-rotate-keys`
        );
    }

    async setAioRotateKeys(userId: string, enabled: boolean) {
        return this.fetch<{ available: boolean; canWrite?: boolean; enabled?: boolean }>(
            `/jellyfin/users/${encodeURIComponent(userId)}/aio-rotate-keys`,
            { body: JSON.stringify({ enabled }), method: "PUT" }
        );
    }

    // What AIOStreams itself says about this person's configuration (server/utils/aioHealth.js).
    async getAioHealth(userId: string, range: "24h" | "7d" = "24h") {
        return this.fetch<AioHealth>(
            `/jellyfin/users/${encodeURIComponent(userId)}/aio-health?range=${range}`
        );
    }

    // One real search through their AIOStreams configuration - one at a time.
    async runAioTestSearch(userId: string, type: "movie" | "series", id: string) {
        return this.fetch<AioTestSearch>(
            `/jellyfin/users/${encodeURIComponent(userId)}/aio-test-search`,
            { body: JSON.stringify({ id, type }), method: "POST" }
        );
    }

    // "Caught up to here" (server/utils/catchUp.js).
    async getCatchUpShows(userId: string) {
        return this.fetch<{ shows: CatchUpShow[] }>(
            `/users/${encodeURIComponent(userId)}/catch-up/shows`
        );
    }

    async getCatchUpEpisodes(userId: string, showId: string) {
        return this.fetch<CatchUpEpisodes>(
            `/users/${encodeURIComponent(userId)}/catch-up/episodes?showId=${encodeURIComponent(showId)}`
        );
    }

    async startCatchUp(userId: string, showId: string, season: number, episode: number) {
        return this.fetch<CatchUpJob>(`/users/${encodeURIComponent(userId)}/catch-up`, {
            body: JSON.stringify({ episode, season, showId }),
            method: "POST",
        });
    }

    async undoCatchUp(userId: string) {
        return this.fetch<{ job: CatchUpJob | null }>(
            `/users/${encodeURIComponent(userId)}/catch-up/undo`,
            { method: "POST" }
        );
    }

    async dismissCatchUp(userId: string) {
        return this.fetch<{ job: CatchUpJob | null }>(
            `/users/${encodeURIComponent(userId)}/catch-up/dismiss`,
            { method: "POST" }
        );
    }

    async unmarkEpisode(userId: string, showId: string, season: number, episode: number) {
        return this.fetch<{ removed: number; server: "done" | "not-there" | "failed" | null }>(
            `/users/${encodeURIComponent(userId)}/catch-up/unmark`,
            { body: JSON.stringify({ episode, season, showId }), method: "POST" }
        );
    }

    async getCatchUpStatus(userId: string) {
        return this.fetch<{ job: CatchUpJob | null }>(
            `/users/${encodeURIComponent(userId)}/catch-up/status`
        );
    }

    // Copy watch history between a person's sign-ins (server/utils/watchCopy).
    async getWatchCopySides(userId: string, withOthers = false) {
        return this.fetch<{
            sides: WatchCopySide[];
            others: WatchCopySide[];
            person: WatchCopyPerson;
            lastRun: WatchCopyRun | null;
            job: WatchCopyJob | null;
        }>(`/users/${encodeURIComponent(userId)}/watch-copy/sides${withOthers ? "?others=1" : ""}`);
    }

    async previewWatchCopy(userId: string, body: WatchCopyRequest) {
        return this.fetch<WatchCopyPreview>(
            `/users/${encodeURIComponent(userId)}/watch-copy/preview`,
            { body: JSON.stringify(body), method: "POST" }
        );
    }

    async runWatchCopy(
        userId: string,
        body: WatchCopyRequest & {
            keys?: string[];
            matches?: Record<string, string>;
            fromName?: string;
            toName?: string;
        }
    ) {
        return this.fetch<WatchCopyJob>(`/users/${encodeURIComponent(userId)}/watch-copy/run`, {
            body: JSON.stringify(body),
            method: "POST",
        });
    }

    async getWatchCopyStatus(userId: string) {
        return this.fetch<{ job: WatchCopyJob | null; lastRun: WatchCopyRun | null }>(
            `/users/${encodeURIComponent(userId)}/watch-copy/status`
        );
    }

    async undoWatchCopy(userId: string, runId: string) {
        return this.fetch<{ restored: number; kept: number }>(
            `/users/${encodeURIComponent(userId)}/watch-copy/undo`,
            { body: JSON.stringify({ runId }), method: "POST" }
        );
    }

    async getWatchCopyCandidates(userId: string, name: string, type: string) {
        return this.fetch<{
            candidates: { id: string; name: string; year: string | null; poster: string | null }[];
        }>(
            `/users/${encodeURIComponent(userId)}/watch-copy/candidates?name=${encodeURIComponent(name)}&type=${encodeURIComponent(type)}`
        );
    }

    // "Just added a sign-in - bring their history over?" (server/utils/watchCopy/offer.js).
    async getWatchCopyOffer(userId: string) {
        return this.fetch<{ offer: WatchCopyOffer | null }>(
            `/users/${encodeURIComponent(userId)}/watch-copy/offer`
        );
    }

    async dismissWatchCopyOffer(userId: string, provider: string) {
        return this.fetch<{ success: boolean }>(
            `/users/${encodeURIComponent(userId)}/watch-copy/offer/dismiss`,
            { body: JSON.stringify({ provider }), method: "POST" }
        );
    }

    // "Remove from Activity": one viewing (person, title or episode, one day)
    // out of the page and their watch time and history; Undo via the Trash.
    async removeActivityViewing(
        userId: string,
        body: { itemId: string; videoId?: string | null; day: string; from: string; to: string }
    ) {
        return this.fetch<{
            trashId: string;
            label: string;
            removed: { history: number; watchTimeSeconds: number; sessions: number };
        }>(`/users/${encodeURIComponent(userId)}/activity/remove`, {
            body: JSON.stringify(body),
            method: "POST",
        });
    }

    // Who has Keep in step on (the AIOSync card on Tasks).
    async getWatchSyncOverview() {
        return this.fetch<{
            keepInStep: string[];
            synced: { userId: string; name: string; places: string[] }[];
        }>("/users/watch-sync/overview");
    }

    // AIOStreams servers people here sign in to, for "Open in AIOStreams".
    // "Open in …" on a title (lib/openWith.ts): servers, item ids, Play on devices.
    async getOpenTargets(id: string, type: "movie" | "series") {
        return this.fetch<import("./openWith").OpenTargets>(
            `/jellyfin/open-targets?id=${encodeURIComponent(id)}&type=${type}`
        );
    }

    async playOnDevice(body: {
        personId: string;
        credentialId: string | null;
        sessionId: string;
        itemId: string;
    }) {
        return this.fetch<{ success: boolean }>("/jellyfin/play-on", {
            body: JSON.stringify(body),
            method: "POST",
        });
    }

    async getAioStreamsServers() {
        return this.fetch<{ servers: { address: string; people: string[] }[] }>(
            "/jellyfin/aiostreams-servers"
        );
    }

    // Keep in step (server/utils/watchCopy/keepInStep.js).
    async getKeepInStep(userId: string) {
        return this.fetch<KeepInStep>(`/users/${encodeURIComponent(userId)}/keep-in-step`);
    }

    async saveKeepInStep(
        userId: string,
        body: { enabled?: boolean; members?: { side: string; mode: KeepInStepMode }[] }
    ) {
        return this.fetch<KeepInStep>(`/users/${encodeURIComponent(userId)}/keep-in-step`, {
            body: JSON.stringify(body),
            method: "PUT",
        });
    }

    // Their AIOStreams configuration's history (server/utils/aioConfigHistory.js).
    async getAioHistory(userId: string) {
        return this.fetch<AioHistory>(`/jellyfin/users/${encodeURIComponent(userId)}/aio-history`);
    }

    async restoreAioVersion(
        userId: string,
        snapshotId: string,
        keep: { services: boolean; users: boolean; apiKeys: boolean }
    ) {
        return this.fetch<AioHistory>(
            `/jellyfin/users/${encodeURIComponent(userId)}/aio-history/${encodeURIComponent(snapshotId)}/restore`,
            { body: JSON.stringify({ keep }), method: "POST" }
        );
    }

    // A daily screen-time limit for a person (server/utils/screenTime.js).
    async getScreenTime(userId: string) {
        return this.fetch<ScreenTimeView>(`/users/${encodeURIComponent(userId)}/screen-time`);
    }

    async setScreenTime(userId: string, limit: ScreenTimeLimit | null) {
        return this.fetch<ScreenTimeView>(`/users/${encodeURIComponent(userId)}/screen-time`, {
            body: JSON.stringify({ limit }),
            method: "PUT",
        });
    }

    async resumeScreenTime(userId: string) {
        return this.fetch<ScreenTimeView>(
            `/users/${encodeURIComponent(userId)}/screen-time/resume`,
            { method: "POST" }
        );
    }

    /** Who has a limit or a pause, for the Limits pills on the Users page (by person or profile id). */
    async getLimitsOverview() {
        return this.fetch<Record<string, LimitsSummary>>("/users/screen-time/overview");
    }

    /** An age limit for anyone: a real Jellyfin server's own, or SlickSync's (server/utils/ageLimits.js). */
    async getAgeLimit(id: string) {
        return this.fetch<AgeLimitView>(`/users/${encodeURIComponent(id)}/age-limit`);
    }

    async setAgeLimit(id: string, value: number | null, blockUnrated?: boolean) {
        return this.fetch<AgeLimitView>(`/users/${encodeURIComponent(id)}/age-limit`, {
            body: JSON.stringify({
                value,
                ...(blockUnrated === undefined ? {} : { blockUnrated }),
            }),
            method: "PUT",
        });
    }

    // A real Jellyfin person's age limit on their server.
    async getJellyfinAgeLimit(userId: string) {
        return this.fetch<JellyfinAgeLimit>(
            `/jellyfin/users/${encodeURIComponent(userId)}/age-limit`
        );
    }

    async setJellyfinAgeLimit(userId: string, value: number | null, blockUnrated?: boolean) {
        return this.fetch<JellyfinAgeLimit>(
            `/jellyfin/users/${encodeURIComponent(userId)}/age-limit`,
            {
                body: JSON.stringify({
                    value,
                    ...(blockUnrated === undefined ? {} : { blockUnrated }),
                }),
                method: "PUT",
            }
        );
    }

    // Real Jellyfin servers an invitation can make accounts on.
    async getJellyfinInviteServers() {
        return this.fetch<{ servers: { key: string; name: string; canCreate: boolean }[] }>(
            "/jellyfin/invite-servers"
        );
    }

    // What is signed in as someone on a real Jellyfin server, and signing one out.
    async getJellyfinDevices(userId: string) {
        return this.fetch<{ needsAdmin: boolean; devices: JellyfinDevice[] }>(
            `/jellyfin/users/${encodeURIComponent(userId)}/devices`
        );
    }

    async signOutJellyfinDevice(userId: string, deviceId: string) {
        return this.fetch<{ ok: boolean }>(
            `/jellyfin/users/${encodeURIComponent(userId)}/devices/${encodeURIComponent(deviceId)}`,
            { method: "DELETE" }
        );
    }

    // "Their servers in Nuvio" - their Jellyfin / AIOStreams / AIOMetadata in their Nuvio profile.
    async getNuvioMediaServers(userId: string) {
        return this.fetch<NuvioServersState>(
            `/nuvio/users/${encodeURIComponent(userId)}/media-servers`
        );
    }

    async setNuvioMediaServers(userId: string, enabled: boolean) {
        return this.fetch<NuvioServersState>(
            `/nuvio/users/${encodeURIComponent(userId)}/media-servers`,
            {
                body: JSON.stringify({ enabled }),
                method: "PUT",
            }
        );
    }

    // Sign a Nuvio TV or computer in with the code it shows: look the code up
    // first (which device is asking), then approve it.
    async lookupNuvioDeviceLogin(userId: string, code: string) {
        return this.fetch<{
            success: boolean;
            deviceName: string | null;
            deviceType: string | null;
            expiresAt: string | null;
        }>(`/nuvio/users/${encodeURIComponent(userId)}/device-login/lookup`, {
            body: JSON.stringify({ code }),
            method: "POST",
        });
    }

    async approveNuvioDeviceLogin(userId: string, code: string) {
        return this.fetch<{
            success: boolean;
            deviceName: string | null;
            deviceType: string | null;
        }>(`/nuvio/users/${encodeURIComponent(userId)}/device-login/approve`, {
            body: JSON.stringify({ code }),
            method: "POST",
        });
    }

    async authorizeQuickConnect(userId: string, code: string, profileId?: string | null) {
        return this.fetch<{ success: boolean; who: string }>(
            `/jellyfin/users/${encodeURIComponent(userId)}/quick-connect`,
            {
                body: JSON.stringify({ code, profileId: profileId || undefined }),
                method: "POST",
            }
        );
    }

    async getHousehold(userId: string) {
        return this.fetch<{
            profiles: HouseholdProfile[];
            partOf: {
                profileId: string;
                name: string;
                owner: { id: string; username: string };
            } | null;
            kind: string | null;
            canManage?: boolean;
            canPin?: boolean;
            personal?: Record<string, HouseholdPersonal> | null;
        }>(`/jellyfin/users/${encodeURIComponent(userId)}/household`);
    }

    // Keep an AIOStreams household user separate with a sign-in address of
    // their own, stop, or give them a new address (server/utils/aioHousehold.js).
    async setHouseholdPersonalAddress(profileId: string, mode: "on" | "off" | "renew") {
        return this.fetch<{ profiles: HouseholdProfile[]; personal: HouseholdPersonal }>(
            `/jellyfin/household/${encodeURIComponent(profileId)}/personal-address`,
            {
                body: JSON.stringify({ mode }),
                method: "POST",
            }
        );
    }

    async trackHouseholdProfile(profileId: string, tracked: boolean) {
        return this.fetch<{ profiles: HouseholdProfile[] }>(
            `/jellyfin/household/${encodeURIComponent(profileId)}/track`,
            {
                body: JSON.stringify({ tracked }),
                method: "POST",
            }
        );
    }

    // Add an AIOStreams household user (server/utils/aioHousehold.js).
    async addHouseholdUser(
        userId: string,
        data: { name: string; pin?: string | null; history: "own" | "shared"; separate?: boolean }
    ) {
        return this.fetch<{
            profiles: HouseholdProfile[];
            tracked: boolean;
            personal?: HouseholdPersonal;
        }>(`/jellyfin/users/${encodeURIComponent(userId)}/household`, {
            body: JSON.stringify(data),
            method: "POST",
        });
    }

    // Change (or, with null, remove) a household user's PIN.
    async setHouseholdPin(profileId: string, pin: string | null) {
        return this.fetch<{ profiles: HouseholdProfile[]; tracked: boolean }>(
            `/jellyfin/household/${encodeURIComponent(profileId)}/pin`,
            {
                body: JSON.stringify({ pin }),
                method: "POST",
            }
        );
    }

    async signInHouseholdProfile(profileId: string, data: { password: string; pin?: string }) {
        return this.fetch<{ profiles: HouseholdProfile[] }>(
            `/jellyfin/household/${encodeURIComponent(profileId)}/sign-in`,
            {
                body: JSON.stringify(data),
                method: "POST",
            }
        );
    }

    async separateHouseholdProfile(profileId: string) {
        return this.fetch<{
            profiles: HouseholdProfile[];
            person: { id: string; username: string };
        }>(`/jellyfin/household/${encodeURIComponent(profileId)}/separate`, {
            body: JSON.stringify({}),
            method: "POST",
        });
    }

    async mergeHouseholdProfileBack(profileId: string) {
        return this.fetch<{ profiles: HouseholdProfile[] }>(
            `/jellyfin/household/${encodeURIComponent(profileId)}/merge-back`,
            {
                body: JSON.stringify({}),
                method: "POST",
            }
        );
    }

    // --- Nuvio provider ---
    // Mirrors the Stremio pattern above: /nuvio/connect-authkey with create:true
    // is the actual "create a new SlickSync user" endpoint. /nuvio/connect is for
    // reconnecting an *existing* user (requires userId) — not used here.

    async createUserWithNuvioCredentials(data: {
        email: string;
        password: string;
        username: string;
        groupName?: string;
        colorIndex?: number;
        nuvioProfileId?: number;
    }) {
        const result = await this.fetch<User | { user: User }>("/nuvio/connect-authkey", {
            body: JSON.stringify({ ...data, create: true }),
            method: "POST",
        });
        return "user" in result ? result.user : result;
    }

    /** Sign an existing Nuvio person in again - email and password, or the tokens from Nuvio's sign-in code. */
    async reconnectUserNuvio(
        userId: string,
        data:
            | { email: string; password: string }
            | { providerUserId: string; refreshToken: string; email?: string }
    ) {
        return this.fetch<{ success: boolean; user: { id: string; email: string } }>(
            "/nuvio/connect",
            {
                body: JSON.stringify({ userId, ...data }),
                method: "POST",
            }
        );
    }

    async startNuvioOAuth() {
        // Returns { code, webUrl, expiresAt, pollIntervalSeconds, anonToken, deviceNonce }
        return this.fetch<{
            code: string;
            webUrl: string;
            expiresAt: string;
            pollIntervalSeconds: number;
            anonToken: string;
            deviceNonce: string;
        }>("/nuvio/start-oauth", { body: JSON.stringify({}), method: "POST" });
    }

    async pollNuvioOAuth(params: { code: string; deviceNonce: string; anonToken: string }) {
        // Returns { status, expiresAt, pollIntervalSeconds } — status is opaque, passed
        // through from Nuvio's own session state (e.g. pending until approved on the device)
        return this.fetch<{ status: string; expiresAt: string; pollIntervalSeconds: number }>(
            "/nuvio/poll-oauth",
            { body: JSON.stringify(params), method: "POST" }
        );
    }

    async exchangeNuvioOAuth(params: { code: string; deviceNonce: string; anonToken: string }) {
        // Returns { success, user: { id, email }, refreshToken } once the session is approved
        return this.fetch<{
            success: boolean;
            user: { id: string; email: string };
            refreshToken: string;
        }>("/nuvio/exchange-oauth", { body: JSON.stringify(params), method: "POST" });
    }

    async createUserWithNuvioOAuth(data: {
        providerUserId: string;
        refreshToken: string;
        username: string;
        email?: string;
        groupName?: string;
        colorIndex?: number;
        nuvioProfileId?: number;
    }) {
        const result = await this.fetch<User | { user: User }>("/nuvio/connect-authkey", {
            body: JSON.stringify({ ...data, create: true }),
            method: "POST",
        });
        return "user" in result ? result.user : result;
    }

    // --- Avatars ---

    async uploadAvatar(file: File): Promise<{ url: string }> {
        const formData = new FormData();
        formData.append("avatar", file);

        const token = this.getToken();
        const headers: Record<string, string> = {};
        if (token) {
            headers.Authorization = `Bearer ${token}`;
        }
        const csrfToken = getCsrfToken();
        if (csrfToken) {
            headers["X-CSRF-Token"] = csrfToken;
        }

        // Deliberately NOT using this.fetch() here — it forces Content-Type: application/json,
        // which breaks multipart uploads (the browser needs to set its own boundary header).
        const response = await fetch(`${API_BASE}/avatars/upload`, {
            body: formData,
            credentials: "include",
            headers, // no Content-Type — fetch sets the multipart boundary automatically for FormData
            method: "POST",
        });

        if (!response.ok) {
            let errorData: ErrorPayload;
            try {
                errorData = await response.json();
            } catch {
                errorData = { message: `HTTP ${response.status}` };
            }
            throw new Error(errorData.message || errorData.error || `HTTP ${response.status}`);
        }

        return response.json();
    }

    // --- Vault ---

    async getVaultEntries(category?: string) {
        const qs = category ? `?category=${encodeURIComponent(category)}` : "";
        return this.fetch<VaultListResponse>(`/vault${qs}`);
    }

    async getVaultEntry(id: string) {
        return this.fetch<VaultEntry>(`/vault/${id}`);
    }

    async revealVaultSecret(id: string) {
        // POST (not GET): reveal is CSRF-gated + not cacheable + never in referer.
        return this.fetch<{ secret: string }>(`/vault/${id}/reveal`, { method: "POST" });
    }
    async snoozeVaultEntry(id: string) {
        return this.fetch<VaultEntry>(`/vault/${id}/snooze`, { method: "POST" });
    }
    // Live Real-Debrid/TorBox usage (active downloads, premium days left) -
    // usage is null for a non-debrid entry or if the live provider call failed.
    async getVaultEntryUsage(id: string) {
        return this.fetch<{
            usage: { premiumDaysLeft: number | null; activeDownloads: number | null } | null;
        }>(`/vault/${id}/usage`);
    }

    async createVaultEntry(data: VaultEntryInput) {
        return this.fetch<{ id: string; name: string }>("/vault", {
            body: JSON.stringify(data),
            method: "POST",
        });
    }

    async updateVaultEntry(
        id: string,
        data: Partial<VaultEntryInput> & { isActive?: boolean; backupEntryId?: string | null }
    ): Promise<{
        success: boolean;
        rotation?: {
            addonsUpdated: { id: string; name: string }[];
            usersSynced: number;
            userFailures: { username: string; error: string }[];
            aioConfigsUpdated?: { username: string; services: string[] }[];
            aioConfigFailures?: { username: string; error: string }[];
        } | null;
    }> {
        return this.fetch(`/vault/${id}`, {
            body: JSON.stringify(data),
            method: "PUT",
        });
    }

    async deleteVaultEntry(id: string) {
        return this.fetch(`/vault/${id}`, { method: "DELETE" });
    }

    async reorderVaultEntries(category: string, orderedIds: string[]) {
        return this.fetch<{ success: boolean }>("/vault/reorder", {
            body: JSON.stringify({ category, orderedIds }),
            method: "PUT",
        });
    }
    async reorderAddons(orderedIds: string[]) {
        return this.fetch<{ success: boolean }>("/addons/reorder", {
            body: JSON.stringify({ orderedIds }),
            method: "PUT",
        });
    }
    async reorderUsers(orderedIds: string[]) {
        return this.fetch<{ success: boolean }>("/users/reorder", {
            body: JSON.stringify({ orderedIds }),
            method: "PUT",
        });
    }
    async reorderGroups(orderedIds: string[]) {
        return this.fetch<{ success: boolean }>("/groups/reorder", {
            body: JSON.stringify({ orderedIds }),
            method: "PUT",
        });
    }
    // Custom addon tags — drag-to-recategorize, parallel to Vault's categories.
    async getAddonTags() {
        return this.fetch<{ tags: string[]; tagColors: Record<string, string> }>("/addons/tags");
    }
    async createAddonTag(name: string) {
        return this.fetch<{ tags: string[] }>("/addons/tags", {
            body: JSON.stringify({ name }),
            method: "POST",
        });
    }
    async deleteAddonTag(name: string) {
        return this.fetch<{ tags: string[] }>(`/addons/tags/${encodeURIComponent(name)}`, {
            method: "DELETE",
        });
    }
    async setAddonTag(addonId: string, tag: string | null) {
        return this.fetch<{ customTag: string | null }>(`/addons/${addonId}/tag`, {
            body: JSON.stringify({ tag }),
            method: "PUT",
        });
    }
    async setAddonTagColor(name: string, color: string | null) {
        return this.fetch<{ tagColors: Record<string, string> }>(
            `/addons/tags/${encodeURIComponent(name)}/color`,
            {
                body: JSON.stringify({ color }),
                method: "PUT",
            }
        );
    }
    async setAddonProtected(addonId: string, protectedFlag: boolean, unsafe?: boolean) {
        const qs = unsafe ? "?unsafe=true" : "";
        return this.fetch<{ isProtected: boolean }>(`/addons/${addonId}/protect${qs}`, {
            body: JSON.stringify({ protected: protectedFlag }),
            method: "POST",
        });
    }

    async testVaultEntry(id: string) {
        return this.fetch<{ ok: boolean | null; message: string; checkedAt: string }>(
            `/vault/${id}/test`,
            {
                method: "POST",
            }
        );
    }

    // Metrics
    // `deep` lifts the caps on the reads the Activity feed is built from. It is
    // a heavier build and is never cached, so it is only worth asking for once
    // a reader has actually reached the end of the ordinary feed.
    async getMetrics(period = "30d", opts: { deep?: boolean } = {}) {
        const deep = opts.deep ? "&deep=1" : "";
        return this.fetch<MetricsData>(`/users/metrics?period=${period}${deep}`);
    }
    async getYearInReview(year?: number) {
        const q = year ? `?year=${year}` : "";
        return this.fetch<YearInReview>(`/users/year-in-review${q}`);
    }

    async getContinueWatching() {
        return this.fetch<ContinueWatchingItem[]>("/users/continue-watching");
    }

    /** Shows started then dropped - the population Continue Watching's own
     * 120-day window has stopped showing entirely. Burying one reuses
     * dismissContinueWatching below (same table, same meaning). */
    async getAbandonedShows() {
        return this.fetch<
            Array<{
                userId: string;
                username: string;
                providerType: string | null;
                showId: string;
                showName: string;
                poster: string | null;
                lastSeason: number;
                lastEpisode: number;
                episodesWatched: number;
                lastWatchedAt: string;
                daysSince: number;
            }>
        >("/users/abandoned-shows");
    }

    /** The Graveyard: every buried show (Continue Watching dismissals rest
     * here too - both gestures mean "done with this"). */
    async getBuriedShows() {
        return this.fetch<
            {
                userId: string;
                username: string;
                showId: string;
                showName: string;
                poster: string | null;
                lastSeason: number | null;
                lastEpisode: number | null;
                lastWatchedAt: string | null;
                episodesWatched: number;
                buriedAt: string;
            }[]
        >("/users/graveyard");
    }

    /** The permanent exit: erases the show's entire watch history for that
     * user plus the burial. Irreversible - the UI confirms with the count. */
    // Per-user restore - Time Machine scoped to one person. preview:true
    // returns the per-user diff without applying anything.
    async restoreBackupUser(filename: string, userId: string, preview = false) {
        return this.fetch<{
            preview?: boolean;
            applied?: boolean;
            username: string;
            changedFields: string[];
            groupsJoin: string[];
            groupsLeave: string[];
            missingGroups: string[];
            nothingToDo: boolean;
        }>(`/settings/backups/${encodeURIComponent(filename)}/restore-user`, {
            body: JSON.stringify({ preview, userId }),
            method: "POST",
        });
    }

    // Device claims - per-person attribution on a shared provider login.
    // A claim pins a proxy client IP to a managed user, beating the learned
    // affinity guess; `guess` is what the guesser currently thinks when no
    // claim stands.
    async getDeviceClaims() {
        return this.fetch<{
            devices: Array<{
                clientIp: string;
                lastSeenAt: string | null;
                lastTitle: string | null;
                streams: number;
                claim: { userId: string; username: string | null; label: string | null } | null;
                guess: { userId: string; username: string | null } | null;
            }>;
            users: Array<{ id: string; username: string }>;
        }>("/users/device-claims");
    }

    async saveDeviceClaim(clientIp: string, userId: string, label?: string) {
        return this.fetch<{ success: boolean }>("/users/device-claims", {
            body: JSON.stringify({ clientIp, label, userId }),
            method: "POST",
        });
    }

    async deleteDeviceClaim(clientIp: string) {
        return this.fetch<{ success: boolean }>(
            `/users/device-claims/${encodeURIComponent(clientIp)}`,
            {
                method: "DELETE",
            }
        );
    }

    // Finish the Saga - franchises the household is mid-way through, closest
    // to finished first. `unwatched` are the members still to watch.
    async getFinishTheSaga() {
        return this.fetch<
            Array<{
                collectionId: number;
                name: string;
                watchedCount: number;
                total: number;
                unwatched: Array<{
                    id: string;
                    title: string;
                    poster: string | null;
                    releaseYear: string | null;
                }>;
            }>
        >("/users/finish-the-saga");
    }

    // Watch-ahead protection - "watching together" pacts (see
    // server/utils/watchTogether.js). Frontier = furthest episode EVERYONE in
    // the pact has seen; null until every member has started the show.
    async getWatchTogether() {
        return this.fetch<
            Array<{
                showId: string;
                showName: string;
                members: Array<{
                    userId: string;
                    username: string;
                    colorIndex?: number;
                    avatarUrl?: string | null;
                    furthest: { season: number; episode: number } | null;
                }>;
                frontier: { season: number; episode: number } | null;
                waitingOn: string[];
                createdAt: string;
            }>
        >("/watch-together");
    }

    async saveWatchTogether(showId: string, showName: string, userIds: string[]) {
        return this.fetch<{ success: boolean }>("/watch-together", {
            body: JSON.stringify({ showId, showName, userIds }),
            method: "POST",
        });
    }

    async deleteWatchTogether(showId: string) {
        return this.fetch<{ success: boolean }>(`/watch-together/${encodeURIComponent(showId)}`, {
            method: "DELETE",
        });
    }

    // Account Guard - see server/utils/accountGuard.js
    async acceptGuardChange(userId: string) {
        return this.fetch<{ success: boolean }>("/users/guard/accept", {
            body: JSON.stringify({ userId }),
            method: "POST",
        });
    }

    async runGuardSweep() {
        return this.fetch<{
            success: boolean;
            checked: number;
            alerted: number;
            adopted: number;
            skipped: number;
        }>("/users/guard/sweep", { body: JSON.stringify({}), method: "POST" });
    }

    async wipeBuriedShow(userId: string, showId: string, removeFromDevice?: boolean) {
        return this.fetch<{
            success: boolean;
            episodesDeleted: number;
            moviesDeleted?: number;
            deviceRemoved?: boolean;
        }>("/users/graveyard/wipe", {
            body: JSON.stringify({ removeFromDevice: !!removeFromDevice, showId, userId }),
            method: "POST",
        });
    }

    /** Dig a show back up - it returns to Continue Watching or the unfinished list. */
    async unburyShow(userId: string, showId: string) {
        return this.fetch<{ success: boolean }>("/users/graveyard/unbury", {
            body: JSON.stringify({ showId, userId }),
            method: "POST",
        });
    }

    async dismissContinueWatching(userId: string, showId: string) {
        return this.fetch<{ success: boolean }>("/users/continue-watching/dismiss", {
            body: JSON.stringify({ showId, userId }),
            method: "POST",
        });
    }

    async getThemePref() {
        // A preference, not a page's data - and the theme provider asks for it on
        // every page, signed in or not. Without a session the answer is 401 and
        // the colours simply stay as this device has them.
        return this.fetch<{ themePref: ThemePref | null }>("/settings/theme-pref", {
            quiet401: true,
        });
    }
    async saveThemePref(themePref: ThemePref | null) {
        return this.fetch<{ themePref: ThemePref | null }>("/settings/theme-pref", {
            body: JSON.stringify({ themePref }),
            method: "PUT",
        });
    }

    // Personal watchlist — SlickSync's own bookmark list.
    /** Saves a manual watchlist ranking - array order is the order, first is "up next". */
    async setWatchlistOrder(itemIds: string[]) {
        return this.fetch<{ success: boolean; ranked: number }>("/watchlist/order", {
            body: JSON.stringify({ itemIds }),
            method: "PUT",
        });
    }

    async getWatchlist() {
        return this.fetch<WatchlistItem[]>("/watchlist");
    }
    async addToWatchlist(item: {
        itemId: string;
        itemType: "movie" | "series";
        name: string;
        poster?: string | null;
    }) {
        return this.fetch<WatchlistItem>("/watchlist", {
            body: JSON.stringify(item),
            method: "POST",
        });
    }
    async removeFromWatchlist(itemId: string) {
        return this.fetch<{ success: boolean }>(`/watchlist/${encodeURIComponent(itemId)}`, {
            method: "DELETE",
        });
    }
    // Batch check whether these ids have any watch history on this account.
    // POST (not GET) because id lists can be 100+ entries and don't belong in URLs.
    async getWatchedStatus(ids: string[]) {
        if (ids.length === 0) {
            return {};
        }
        return this.fetch<Record<string, boolean>>("/watchlist/watched-status", {
            body: JSON.stringify({ ids }),
            method: "POST",
        });
    }
    // Manual watched-status override — force an item to appear watched or
    // unwatched regardless of what the poller has observed.
    async markWatched(itemId: string, watched: boolean) {
        return this.fetch<{ id: string; itemId: string; watched: boolean; markedAt: string }>(
            "/watchlist/mark",
            { body: JSON.stringify({ itemId, watched }), method: "POST" }
        );
    }
    async clearWatchedOverride(itemId: string) {
        return this.fetch<{ success: boolean }>(`/watchlist/mark/${encodeURIComponent(itemId)}`, {
            method: "DELETE",
        });
    }

    // Custom lists — named collections of titles (the tier above the single
    // watchlist above).
    async getLists() {
        return this.fetch<CustomList[]>("/lists");
    }
    async createList(name: string, description?: string) {
        return this.fetch<CustomList>("/lists", {
            body: JSON.stringify({ description, name }),
            method: "POST",
        });
    }
    // Natural-language catalog building - see server/utils/nlCatalog.js.
    // Preview never touches the database; save takes the exact items the
    // preview already returned rather than re-running the pipeline.
    async previewDescribedCatalog(description: string) {
        return this.fetch<DescribedCatalogPreview>("/lists/describe-preview", {
            body: JSON.stringify({ description }),
            method: "POST",
        });
    }
    async saveDescribedCatalog(data: {
        name: string;
        description: string;
        items: CustomListItem[];
    }) {
        return this.fetch<CustomList>("/lists/from-description", {
            body: JSON.stringify(data),
            method: "POST",
        });
    }
    async updateList(
        id: string,
        data: {
            name?: string;
            description?: string;
            coverImageUrl?: string | null;
            coverColorIndex?: number | null;
            pinned?: boolean;
            autoRefresh?: boolean;
            autoRefreshFrequency?: "daily" | "weekly";
            shared?: boolean;
        }
    ) {
        return this.fetch<CustomList>(`/lists/${encodeURIComponent(id)}`, {
            body: JSON.stringify(data),
            method: "PATCH",
        });
    }
    /** Returns trashId when the catalog was archived first (Undo). */
    async deleteList(id: string) {
        return this.fetch<{ success: boolean; trashId?: string | null }>(
            `/lists/${encodeURIComponent(id)}`,
            { method: "DELETE" }
        );
    }
    // Automation rules ("when X happens, do Y") - see server/utils/automation/registry.js.
    /** The AI rule-writer: plain English -> a validated rule draft for the
     * editor. Server-side the model only proposes; the registry validates. */
    async composeAutomationRule(text: string) {
        return this.fetch<{
            rule: {
                name: string;
                triggerType: string;
                triggerConfig: Record<string, unknown>;
                conditions: AutomationCondition[];
                actions: AutomationActionConfig[];
            };
            warnings: string[];
        }>("/automation/compose", { body: JSON.stringify({ text }), method: "POST" });
    }

    async getAutomationRegistry() {
        return this.fetch<AutomationRegistry>("/automation/registry");
    }
    async getAutomationRules() {
        return this.fetch<AutomationRule[]>("/automation");
    }
    async createAutomationRule(data: AutomationRuleInput) {
        return this.fetch<AutomationRule>("/automation", {
            body: JSON.stringify(data),
            method: "POST",
        });
    }
    async updateAutomationRule(id: string, data: Partial<AutomationRuleInput>) {
        return this.fetch<AutomationRule>(`/automation/${encodeURIComponent(id)}`, {
            body: JSON.stringify(data),
            method: "PATCH",
        });
    }
    async deleteAutomationRule(id: string) {
        return this.fetch<{ success: boolean }>(`/automation/${encodeURIComponent(id)}`, {
            method: "DELETE",
        });
    }
    async testAutomationRule(id: string) {
        return this.fetch<{ payload: Record<string, unknown>; results: AutomationActionResult[] }>(
            `/automation/${encodeURIComponent(id)}/test`,
            { method: "POST" }
        );
    }
    async getAutomationRuns(ruleId?: string) {
        const qs = ruleId ? `?ruleId=${encodeURIComponent(ruleId)}` : "";
        return this.fetch<AutomationRun[]>(`/automation/runs${qs}`);
    }
    // Content rating is now a destructive allowlist (server/utils/
    // contentRating.js) - preview shows what a candidate list would do
    // without changing anything; apply actually removes non-matching items
    // (and snapshots for undo); restore undoes the single most recent apply.
    // What's currently in the catalog by rating, independent of any candidate
    // policy - shown before anyone checks a box, so "what's actually in here"
    // doesn't stay hidden until after picking ratings and hitting Preview.
    async getContentRatingBreakdown(id: string) {
        return this.fetch<{
            counts: Record<string, number>;
            unknownCount: number;
            checked: number;
        }>(`/lists/${encodeURIComponent(id)}/content-rating-breakdown`);
    }
    async previewContentRating(id: string, keptRatings: string[]) {
        const qs = keptRatings.length ? `?keep=${encodeURIComponent(keptRatings.join(","))}` : "";
        return this.fetch<{
            keep: CustomListItem[];
            remove: (CustomListItem & { rated: string })[];
            unknown: CustomListItem[];
            checked: number;
        }>(`/lists/${encodeURIComponent(id)}/preview-content-rating${qs}`);
    }
    async applyContentRating(id: string, keptRatings: string[]) {
        return this.fetch<CustomList & { removedCount: number }>(
            `/lists/${encodeURIComponent(id)}/apply-content-rating`,
            {
                body: JSON.stringify({ keptRatings }),
                method: "POST",
            }
        );
    }
    async restoreContentRatingRemoval(id: string) {
        return this.fetch<CustomList>(`/lists/${encodeURIComponent(id)}/restore-content-rating`, {
            method: "POST",
        });
    }
    async addToList(
        id: string,
        item: {
            id: string;
            type: "movie" | "series";
            name: string;
            poster?: string | null;
            year?: number | string | null;
        }
    ) {
        return this.fetch<CustomList>(`/lists/${encodeURIComponent(id)}/items`, {
            body: JSON.stringify(item),
            method: "POST",
        });
    }

    /** One write for many titles - share-code imports use this instead of
     * hammering the single-item route once per title. */
    async addToListBulk(
        id: string,
        items: Array<{
            id: string;
            type: "movie" | "series";
            name: string;
            poster?: string | null;
            year?: number | string | null;
        }>
    ) {
        return this.fetch<CustomList & { added: number }>(
            `/lists/${encodeURIComponent(id)}/items/bulk`,
            {
                body: JSON.stringify({ items }),
                method: "POST",
            }
        );
    }
    async removeFromList(id: string, itemId: string) {
        return this.fetch<CustomList>(
            `/lists/${encodeURIComponent(id)}/items/${encodeURIComponent(itemId)}`,
            {
                method: "DELETE",
            }
        );
    }
    // Persist a manual drag-reorder - orderedIds must be the list's current
    // item ids, same set, in the new order (server rejects a stale/partial set).
    async reorderListItems(id: string, orderedIds: string[]) {
        return this.fetch<CustomList>(`/lists/${encodeURIComponent(id)}/items/reorder`, {
            body: JSON.stringify({ orderedIds }),
            method: "PATCH",
        });
    }
    // Creates a brand-new MDBList list from this catalog's current items -
    // does not touch the catalog itself, and doesn't wire the result into any
    // addon (that's a manual step in the addon's own config afterward).
    async exportListToMdblist(id: string) {
        return this.fetch<{
            id: string;
            name: string;
            slug: string | null;
            url: string | null;
            added: number | null;
            existing: number | null;
            notFound: number | null;
        }>(`/lists/${encodeURIComponent(id)}/export-mdblist`, { method: "POST" });
    }
    // Import a TMDb or MDBList list (auto-detected from the URL) into a new list.
    // --- Catalog federation -------------------------------------------------
    // Publishing is per-catalog and revocable. The returned `path` is deliberately
    // origin-less: the server can't reliably know its own externally reachable
    // hostname behind a reverse proxy, so the caller joins it onto the origin it
    // is being viewed from.
    async getCatalogShareLink(id: string) {
        return this.fetch<{ published: boolean; federationToken?: string; path?: string }>(
            `/lists/${id}/federation`
        );
    }
    // Called again on an already-published catalog, this ROTATES the token and
    // immediately invalidates the previous URL.
    async publishCatalog(id: string) {
        return this.fetch<{ federationToken: string; rotated: boolean; path: string }>(
            `/lists/${id}/federation`,
            {
                method: "POST",
            }
        );
    }
    // Stops future pulls. Anyone already subscribed keeps whatever they last
    // pulled - this cannot reach into another instance and delete their copy.
    async unpublishCatalog(id: string) {
        return this.fetch<{ ok: true }>(`/lists/${id}/federation`, { method: "DELETE" });
    }

    async importList(url: string, name?: string) {
        return this.fetch<CustomList & { truncated: boolean; totalAvailable: number }>(
            "/lists/import",
            {
                body: JSON.stringify({ name, url }),
                method: "POST",
            }
        );
    }
    // Managed users in this account who've linked a personal SIMKL account -
    // the picker for import/export-to-SIMKL below, since SIMKL has no named
    // Custom Lists API (see server/utils/simklLists.js): both flows act on a
    // specific user's Plan to Watch, not an account-wide list.
    async getSimklLinkedUsers() {
        return this.fetch<
            Array<{
                id: string;
                username: string;
                avatarUrl: string | null;
                colorIndex: number | null;
            }>
        >("/lists/simkl-users");
    }
    // Import a linked user's SIMKL Plan to Watch into a new catalog.
    async importListFromSimkl(userId: string, name?: string) {
        return this.fetch<CustomList & { totalAvailable: number }>("/lists/import-simkl", {
            body: JSON.stringify({ name, userId }),
            method: "POST",
        });
    }
    // Add this catalog's items to a linked user's SIMKL Plan to Watch.
    async exportListToSimkl(id: string, userId: string) {
        return this.fetch<{ added: number; notFound: number; existing: number; username: string }>(
            `/lists/${encodeURIComponent(id)}/export-simkl`,
            { body: JSON.stringify({ userId }), method: "POST" }
        );
    }
    // Re-pull an already-imported catalog's own source URL. Without `apply`,
    // only returns the added/removed/unchanged diff so the caller can show a
    // confirm step before this destructively replaces the catalog's items.
    async refreshList(id: string, apply = false) {
        return this.fetch<
            CustomList & { added: number; removed: number; unchanged: number; applied?: boolean }
        >(`/lists/${encodeURIComponent(id)}/refresh`, {
            body: JSON.stringify({ apply }),
            method: "POST",
        });
    }
    // Propose titles for a catalog by theme (TMDb keyword search) - read-only,
    // never adds anything itself. query defaults server-side to the catalog's
    // own name if omitted.
    async suggestCatalogTitles(id: string, query?: string) {
        const qs = query ? `?query=${encodeURIComponent(query)}` : "";
        return this.fetch<{ suggestions: CatalogSuggestion[]; query: string }>(
            `/lists/${encodeURIComponent(id)}/suggest${qs}`
        );
    }

    // System Health board - one aggregated read of Sync/Addons/Vault/Proxy
    // status, all sourced from state existing background monitors already
    // maintain (no live calls made by this request itself).
    async getHealthStatus() {
        return this.fetch<HealthStatus>("/health");
    }

    // Hides a known, accepted failure from the Health page's Attention list
    // and its notifications - for something like an indexer that blocks this
    // server's IP, where the admin doesn't want repeated pinging about it.
    async setVaultHealthIgnored(id: string, healthIgnored: boolean) {
        return this.fetch(`/vault/${id}`, {
            body: JSON.stringify({ healthIgnored }),
            method: "PUT",
        });
    }

    async setAddonHealthIgnored(id: string, healthIgnored: boolean) {
        return this.fetch<{ success: boolean; data: { id: string; healthIgnored: boolean } }>(
            `/addons/${id}/health-ignore`,
            {
                body: JSON.stringify({ healthIgnored }),
                method: "PATCH",
            }
        );
    }

    /** Per-addon health-check overrides - empty/omitted fields clear back to
     * the global defaults (manifest probe, 1 failure, global interval). */
    async setAddonHealthConfig(
        id: string,
        cfg: {
            probeUrl?: string;
            failureThreshold?: number | string;
            intervalMinutes?: number | string;
        }
    ) {
        return this.fetch<{
            success: boolean;
            data: { id: string; healthConfig: AddonHealthConfig | null };
        }>(`/addons/${id}/health-config`, {
            body: JSON.stringify(cfg),
            method: "PATCH",
        });
    }

    async setUserHealthIgnored(id: string, healthIgnored: boolean) {
        return this.fetch<{ success: boolean; data: { id: string; healthIgnored: boolean } }>(
            `/users/${id}/health-ignore`,
            {
                body: JSON.stringify({ healthIgnored }),
                method: "PATCH",
            }
        );
    }

    // Proxy has no per-item entity (one shared connectivity check) - the mute
    // lives on the account itself instead of a /:id route.
    async setProxyHealthIgnored(healthIgnored: boolean) {
        return this.fetch<{ healthIgnored: boolean }>("/health/proxy-ignore", {
            body: JSON.stringify({ healthIgnored }),
            method: "PATCH",
        });
    }

    async getRecommendations(opts?: {
        mode?: "personal" | "shared";
        userId?: string;
        userId2?: string;
        type?: "movie" | "series";
    }) {
        const params = new URLSearchParams();
        if (opts?.mode) {
            params.set("mode", opts.mode);
        }
        if (opts?.userId) {
            params.set("userId", opts.userId);
        }
        if (opts?.userId2) {
            params.set("userId2", opts.userId2);
        }
        if (opts?.type) {
            params.set("type", opts.type);
        }
        const qs = params.toString();
        return this.fetch<{ rows: RecommendationRow[] }>(
            `/discover/recommendations${qs ? `?${qs}` : ""}`
        );
    }
    async getTasteOverlap() {
        return this.fetch<{ pairs: TasteOverlapPair[] }>("/discover/taste-overlap");
    }
    // Per-user taste profile (extends the flat overlap into a real profile).
    async getTasteProfile() {
        return this.fetch<{ profiles: TasteProfile[] }>("/discover/taste-profile");
    }
    // Household picks: unwatched-by-everyone titles in genres the whole house
    // likes. Empty items when recommendations are off or there's no signal yet.
    async getHouseholdPicks(type: "movie" | "series") {
        return this.fetch<{
            items: DiscoverItem[];
            genres: string[];
            memberCount: number;
            sharedAppeal: boolean;
        }>(`/discover/household-picks?type=${type}`);
    }
    // Person search (needs a TMDb key): type an actor/director's name, get their
    // titles of the requested type. Returns null on 503 (no key) so callers hide
    // the feature. Results carry tmdbId/mediaType for click-through resolution.
    // personId: that person (a cast member's "See more about"),
    // not whoever a search for the name finds first.
    async searchPerson(query: string, type: "movie" | "series", personId?: number | null) {
        try {
            return await this.fetch<{
                person: DiscoverPerson | null;
                results: PersonSearchResult[];
                source?: "lumiere";
                nokey?: boolean;
            }>(
                `/discover/search-person?query=${encodeURIComponent(query)}&type=${type}${personId ? `&personId=${personId}` : ""}`
            );
        } catch (err) {
            // 503: neither a TMDb key nor a LumiereDB to look people up in.
            const status = (err as { response?: { status?: number } })?.response?.status;
            return status === 503 ? { nokey: true, person: null, results: [] } : null;
        }
    }
    // "More Like This" for the detail popup - real household affinity biases
    // which genre(s) get searched, but every returned item is always a fresh
    // Cinemeta pull filtered against the whole household's watch history
    // (never an affinity neighbor directly - see the route's own comment for
    // why that would just recommend already-watched titles back).
    async getSimilarItems(id: string, type: "movie" | "series") {
        const params = new URLSearchParams({ id, type });
        try {
            return await this.fetch<{ items: DiscoverItem[]; hasRealSignal: boolean }>(
                `/discover/similar?${params.toString()}`
            );
        } catch {
            return { hasRealSignal: false, items: [] };
        }
    }
    async markNotInterested(itemId: string, itemType: "movie" | "series") {
        return this.fetch<{ success: boolean }>("/discover/not-interested", {
            body: JSON.stringify({ itemId, itemType }),
            method: "POST",
        });
    }

    // SlickTrax reactions (thumbs up/down) - feeds /recommendations scoring, see
    // server/utils/recommendationEngine.js's computeSignedAdjustments.
    // Deliberately binary, not a 3-tier like/love/dislike - see
    // server/utils/titleFeedback.js's REACTIONS comment for why.
    async setReaction(
        itemId: string,
        itemType: "movie" | "series",
        reaction: "happy" | "sad",
        itemName?: string,
        poster?: string | null
    ) {
        return this.fetch<{ reaction: string }>("/discover/react", {
            body: JSON.stringify({ itemId, itemName, itemType, poster, reaction }),
            method: "POST",
        });
    }
    async clearReaction(itemId: string) {
        return this.fetch<{ success: boolean }>(`/discover/react/${encodeURIComponent(itemId)}`, {
            method: "DELETE",
        });
    }
    async getReactions(ids: string[]) {
        const qs = ids.length ? `?ids=${ids.map(encodeURIComponent).join(",")}` : "";
        return this.fetch<{ reactions: Record<string, "happy" | "sad"> }>(
            `/discover/reactions${qs}`
        );
    }

    // SlickTrax personal ratings (1-10) - season omitted/0 = overall (the only
    // kind movies use; a series may carry an overall rating AND independent
    // per-season ratings at once).
    async setRating(
        itemId: string,
        itemType: "movie" | "series",
        rating: number,
        season?: number,
        itemName?: string,
        poster?: string | null
    ) {
        return this.fetch<{ season: number; rating: number }>("/discover/rate", {
            body: JSON.stringify({ itemId, itemName, itemType, poster, rating, season }),
            method: "POST",
        });
    }
    async clearRating(itemId: string, season?: number) {
        const qs = season === undefined ? "" : `?season=${season}`;
        return this.fetch<{ success: boolean }>(
            `/discover/rate/${encodeURIComponent(itemId)}${qs}`,
            { method: "DELETE" }
        );
    }
    async getRatings(itemId: string) {
        return this.fetch<{ ratings: Record<string, number> }>(
            `/discover/ratings/${encodeURIComponent(itemId)}`
        );
    }
    async getSeasonNumbers(itemId: string) {
        return this.fetch<{ seasons: number[] }>(
            `/discover/${encodeURIComponent(itemId)}/seasons?type=series`
        );
    }

    async getUpcomingEpisodes() {
        return this.fetch<UpcomingEpisode[]>("/users/upcoming-episodes");
    }
    async dismissUpcomingEpisode(showId: string, season: number, episode: number) {
        return this.fetch<{ success: boolean }>("/users/upcoming-episodes/dismiss", {
            body: JSON.stringify({ episode, season, showId }),
            method: "POST",
        });
    }
    async muteShow(showId: string, showName?: string, poster?: string) {
        return this.fetch<{ success: boolean }>("/users/upcoming-episodes/mute", {
            body: JSON.stringify({ poster, showId, showName }),
            method: "POST",
        });
    }
    async unmuteShow(showId: string) {
        return this.fetch<{ success: boolean }>("/users/upcoming-episodes/unmute", {
            body: JSON.stringify({ showId }),
            method: "POST",
        });
    }
    async getMutedShows() {
        return this.fetch<MutedShow[]>("/users/upcoming-episodes/muted");
    }

    // Rotten Tomatoes/Metacritic/IMDb ratings for a batch of IMDb IDs, for grid
    // views (Discover, Activity) that render many poster cards at once. Pass
    // only the deduplicated IDs actually on screen - server caps the batch size.
    async getRatingsBatch(imdbIds: string[]) {
        if (imdbIds.length === 0) {
            return { ratings: {} };
        }
        return this.fetch<{ ratings: Record<string, RatingsBatchEntry> }>("/users/ratings-batch", {
            body: JSON.stringify({ imdbIds }),
            method: "POST",
        });
    }

    // Cinemeta detail lookup (cast/rating/genres/etc) for the poster-click modal.
    // Returns null (rather than throwing) when there's no metadata - proxy-parsed
    // filename titles have no real IMDb ID to look up, and that's an expected,
    // non-error state the UI should just render an empty state for.
    async getMediaDetails(itemId: string, type: string, videoId?: string | null) {
        const key = `${itemId}|${type}|${videoId || ""}`;
        const hit = mediaDetailsCache.get(key);
        if (hit && Date.now() - hit.at < MEDIA_DETAILS_TTL_MS) {
            return hit.promise;
        }

        const params = new URLSearchParams({ itemId, type });
        if (videoId) {
            params.set("videoId", videoId);
        }
        const promise = this.fetch<MediaDetails>(`/users/media-details?${params.toString()}`).catch(
            () => null
        );
        mediaDetailsCache.set(key, { at: Date.now(), promise });
        // Oldest-first eviction; Map keeps insertion order. A grid can be
        // hovered across faster than anyone opens things, so this is bounded
        // rather than left to grow with the session.
        if (mediaDetailsCache.size > MEDIA_DETAILS_MAX) {
            for (const k of mediaDetailsCache.keys()) {
                mediaDetailsCache.delete(k);
                if (mediaDetailsCache.size <= MEDIA_DETAILS_MAX) {
                    break;
                }
            }
        }
        return promise;
    }

    /**
     * Starts the detail fetch before it is asked for - called when a pointer
     * settles on a poster, so the request is already in flight (often already
     * finished) by the time the click opens the modal. The modal's own
     * getMediaDetails then hits the same entry instead of starting over, so
     * the popup opens on content rather than a spinner.
     *
     * Deliberately fire-and-forget and deliberately silent: a prefetch that
     * fails changes nothing, because the real call repeats it after the TTL.
     * Callers must only fire this for a real mouse - prefetching on touch
     * would spend someone's data on titles they merely scrolled past.
     */
    prefetchMediaDetails(itemId: string, type: string, videoId?: string | null) {
        if (!(itemId && type)) {
            return;
        }
        const key = `${itemId}|${type}|${videoId || ""}`;
        const hit = mediaDetailsCache.get(key);
        if (hit && Date.now() - hit.at < MEDIA_DETAILS_TTL_MS) {
            return;
        }
        void this.getMediaDetails(itemId, type, videoId);
    }

    // Cast/crew deep-dive (optional; needs a TMDb key server-side). Returns a
    // person's filmography, or null when no key is configured (503) so the UI
    // hides the feature gracefully.
    // Two different failures used to come back as the same bare null, so the
    // panel told everyone to add a TMDb API key - including people whose key
    // was already set and working, when the real problem was the request
    // failing. Only the route's 503 means the key is actually missing.
    async getPersonCredits(
        personId: number | string
    ): Promise<
        | { ok: true; person: { id: number; name: string | null }; credits: PersonCredit[] }
        | { ok: false; reason: "nokey" | "failed" }
    > {
        try {
            const data = await this.fetch<{
                person: { id: number; name: string | null };
                credits: PersonCredit[];
            }>(`/discover/person/${personId}`);
            return { ok: true, ...data };
        } catch (err) {
            const status = (err as { response?: { status?: number } })?.response?.status;
            return { ok: false, reason: status === 503 ? "nokey" : "failed" };
        }
    }

    // Resolve a TMDb title to its IMDb id so a person-credit click can open the
    // existing Cinemeta-backed detail modal. Returns null on any failure.
    async resolveImdbId(tmdbId: number | string, mediaType: "movie" | "tv") {
        try {
            return await this.fetch<{ imdbId: string | null; type: "movie" | "series" }>(
                `/discover/imdb-id?tmdbId=${tmdbId}&type=${mediaType}`
            );
        } catch {
            return null;
        }
    }

    // Discover - browse/search Cinemeta's real catalogs (Popular/New/Featured).
    /** Whether Discover has a LumiereDB to use, and IMDb's credit line for it. */
    async getDiscoverLumiere() {
        try {
            return await this.fetch<{ ready: boolean; attribution: string }>("/discover/lumiere");
        } catch {
            return { attribution: "", ready: false };
        }
    }

    // Discover's grid, a page at a time: movies, shows or both, with the
    // filters a catalog can't apply itself (the server's, so paging works with
    // any of them on). nextSkip is where the next page starts; failed is "not
    // now", which the page asks again for rather than taking as the end.
    async discoverPage(
        kind: DiscoverKind,
        options: DiscoverFacets & {
            catalog?: string;
            genre?: string;
            skip?: number;
            query?: string;
        }
    ): Promise<{ items: DiscoverItem[]; nextSkip: number | null; failed: boolean }> {
        const params = new URLSearchParams({ paged: "1", type: kind });
        if (options.query) {
            params.set("query", options.query);
        }
        if (options.catalog) {
            params.set("catalog", options.catalog);
        }
        if (options.genre) {
            params.set("genre", options.genre);
        }
        if (options.skip) {
            params.set("skip", String(options.skip));
        }
        if (options.decade) {
            params.set("decade", options.decade);
        }
        if (options.minRating) {
            params.set("minRating", String(options.minRating));
        }
        if (options.length) {
            params.set("length", options.length);
        }
        try {
            const r = await this.fetch<{ items: DiscoverItem[]; nextSkip: number | null }>(
                `/discover/${options.query ? "search" : "browse"}?${params.toString()}`
            );
            return {
                failed: false,
                items: Array.isArray(r?.items) ? r.items : [],
                nextSkip: r?.nextSkip ?? null,
            };
        } catch {
            return { failed: true, items: [], nextSkip: null };
        }
    }

    async discoverBrowse(
        type: "movie" | "series",
        options?: { catalog?: string; genre?: string; skip?: number }
    ) {
        const params = new URLSearchParams({ type });
        if (options?.catalog) {
            params.set("catalog", options.catalog);
        }
        if (options?.genre) {
            params.set("genre", options.genre);
        }
        if (options?.skip) {
            params.set("skip", String(options.skip));
        }
        try {
            return await this.fetch<DiscoverItem[]>(`/discover/browse?${params.toString()}`);
        } catch {
            return [];
        }
    }

    // Discover row backed by SIMKL's public Trending/Most Anticipated feeds -
    // needs only a SIMKL Client ID (Settings -> External API Keys), not a
    // linked user. Returns [] rather than throwing on any failure (missing
    // key, SIMKL down) so callers can render nothing instead of an error
    // state for what's a bonus row, not core functionality.
    async getSimklDiscoverRow(list: "trending" | "anticipated", type: "movies" | "shows") {
        try {
            const result = await this.fetch<{ items: SimklDiscoverItem[] }>(
                `/lists/simkl-discover?list=${list}&type=${type}`
            );
            return result.items || [];
        } catch {
            return [];
        }
    }

    async discoverSearch(type: "movie" | "series", query: string) {
        const params = new URLSearchParams({ query, type });
        try {
            return await this.fetch<DiscoverItem[]>(`/discover/search?${params.toString()}`);
        } catch {
            return [];
        }
    }

    // Manual sync (same as scheduled 5‑minute sync, but on demand)
    async triggerSyncNow() {
        return this.fetch<{ message: string; result?: unknown }>("/settings/sync-now", {
            method: "POST",
        });
    }

    // Activity
    async getActivityLibrary() {
        return this.fetch<ActivityLibraryData>("/users/activity/library");
    }
}

export const api = new ApiClient();

// Types
/** One collection SlickSync serves to AIOStreams' apps. */
export interface AioCollection {
    catalogIds: string[];
    cover: string | null;
    /** Set when the cover is just this title's poster - shown the way poster cards show it. */
    coverTitleId?: string | null;
    coverUrl: string | null;
    hidden: boolean;
    id: string;
    name: string;
    /** Title ids in the order dragged on the collection's page - only for one built from several catalogs. */
    order?: string[];
    titles: number;
}

/** A Jellyfin server someone here signs in to (not AIOStreams / AIOMetadata). */
export interface JellyfinCollectionServer {
    address: string;
    key: string;
    name: string;
    people: { id: string; username: string }[];
}

export interface JellyfinCollectionsView {
    /** The sign-in changes are made through; null when nobody on the server may manage collections. */
    actor: { id: string; username: string; admin: boolean } | null;
    catalogs: {
        id: string;
        name: string;
        titles: number;
        /** How many of its titles the server has; null when the library couldn't be read. */
        onServer: number | null;
        cover: string | null;
        coverTitleId: string | null;
        on: boolean;
        inJellyfin: boolean;
    }[];
    /** 'no-permission', or what went wrong on the last sync. */
    lastError: string | null;
    lastSyncAt: string | null;
    people: { id: string; username: string }[];
    server: { key: string; name: string; address: string };
}

/** A Jellyfin person's age limit (server/utils/jellyfinParental.js). */
export interface JellyfinAgeLimit {
    available: boolean;
    blockUnrated?: boolean;
    current?: number | null;
    levels?: { value: number; label: string }[];
    needsAdmin?: boolean;
}

/** Versions of an AIOStreams configuration, newest first (server/utils/aioConfigHistory.js). */
export interface AioHistory {
    available: boolean;
    versions: {
        id: string;
        at: string;
        reason: "seen" | "slicksync" | "restore";
        current: boolean;
        changes: string[];
        addons: number;
        services: number;
        users: number;
    }[];
}

/** A show's episodes for "Caught up to here" (server/utils/catchUp.js). */
/** A show the picker offers: one they watch whose episodes can be listed. */
export interface CatchUpShow {
    id: string;
    last?: { season: number; episode: number };
    name: string | null;
    poster: string | null;
}

export interface CatchUpEpisodes {
    /** kind: a filler or recap episode, where the server says so (AIOStreams, for anime). */
    episodes: {
        season: number;
        episode: number;
        title: string | null;
        released: string | null;
        watched: boolean;
        kind?: "filler" | "recap";
    }[];
    name: string | null;
    poster: string | null;
    showId: string;
}

/** One of a person's sign-ins, with the profiles inside it (Copy watch history). */
export interface WatchCopySide {
    detail: string | null;
    kind: "stremio" | "nuvio" | "jellyfin" | "aiostreams" | "aiometadata";
    name: string;
    /** Set on another person's sign-in (the "Other people" part of the picker). */
    person?: WatchCopyPerson;
    profiles: {
        side: string;
        name: string;
        avatar?: string | null;
        color?: string | null;
        isPerson?: boolean;
    }[];
    provider: "stremio" | "nuvio" | "jellyfin";
    side: string;
}

/** The person whose sign-ins these are - their picture, as everywhere else. */
export interface WatchCopyPerson {
    avatarUrl: string | null;
    colorIndex: number;
    email: string | null;
    id: string;
    useGravatar: boolean;
    username: string;
}

export interface WatchCopyRequest {
    from: string;
    library?: boolean;
    resume?: boolean;
    sinceDays?: number;
    to: string;
    watched?: boolean;
}

export type WatchCopyOutcome = "copy" | "there" | "further" | "match" | "missing";

export interface WatchCopyItem {
    // What's specific to this title on its card: "62 episodes", "from 1 h 13 m".
    detail?: string | null;
    from: WatchCopyHas;
    id: string | null;
    key: string;
    name: string | null;
    outcome: WatchCopyOutcome;
    poster: string | null;
    to: WatchCopyHas;
    type: "movie" | "series";
}

// What one side has of a title. state + pct drive the avatar on the card.
export interface WatchCopyHas {
    none?: boolean;
    pct?: number;
    state?: "watched" | "partial" | "none";
    text: string;
}

export interface WatchCopyPreview {
    counts: { from: number; to: number };
    items: WatchCopyItem[];
    limits: string[];
    options: { watched: boolean; resume: boolean; library: boolean; libraryAvailable: boolean };
    totals: {
        found: number;
        copy: number;
        there: number;
        further: number;
        match: number;
        missing: number;
    };
}

export interface WatchCopyJob {
    done: number;
    error: string | null;
    failed: number;
    runId: string | null;
    state: "running" | "done" | "failed";
    total: number;
}

export interface WatchCopyRun {
    copied?: number;
    createdAt: string;
    failed?: number;
    from: string;
    fromName?: string | null;
    id: string;
    to: string;
    toName?: string | null;
    undoUntil: string;
}

/** A new, nearly empty sign-in, and the one whose titles could fill it. */
export interface WatchCopyOffer {
    from: { provider: string; side: string; label: string; count: number };
    name: string;
    to: { provider: string; kind: string; side: string; label: string };
}

export type KeepInStepMode = "both" | "receive" | "off";

/** Keep in step for one person: the switch, each place's mode, and what moved. */
export interface KeepInStep {
    enabled: boolean;
    lastError: string | null;
    lastPass: string | null;
    moves: { at: string; title: string; what: string; from: string; to: string[] }[];
    places: {
        side: string;
        provider: string;
        kind: string;
        name: string;
        profile: string | null;
        first: boolean;
        mode: KeepInStepMode;
    }[];
    since: string | null;
}

/** One "Caught up to here" run, as it goes. */
export interface CatchUpJob {
    alreadyWatched: number;
    /** The last run can still be taken back. */
    canUndo?: boolean;
    error: string | null;
    recorded: number;
    server: {
        state: "waiting" | "running" | "done" | "failed" | "not-there";
        marked: number;
        total: number | null;
        how: "played-up-to" | "each" | null;
        error?: string;
    } | null;
    show: string;
    startedAt: string;
    state: "running" | "done" | "failed" | "undoing" | "undone";
    total: number;
    upTo: string;
}

/** A person's daily screen-time limit, and today so far (server/utils/screenTime.js). */
/** No streaming from `from` to `to` ("HH:MM", account clock), on nights starting on `days` (empty = every night). */
export interface ScreenTimeBedtime {
    days: number[];
    from: string;
    to: string;
}

export interface ScreenTimeLimit {
    bedtime?: ScreenTimeBedtime;
    days: number[];
    /** Minutes a day; absent when only a bedtime is set. */
    minutes?: number;
    /** What happens at the limit; alerting when absent. */
    onReach?: "pause";
    /** When a pause ends, "HH:MM" on the account's clock; midnight when absent. */
    resumeAt?: string;
    /** Real Jellyfin: also stop what's playing, after a warning on screen. */
    stopPlaying?: boolean;
}

export interface ScreenTimeView {
    appliesToday: boolean;
    /** Whether a pause can work for this person, and why not. */
    canPause: {
        ok: boolean;
        code?:
            | "no-group"
            | "needs-admin"
            | "needs-config-password"
            | "not-supported"
            | "shares-addons"
            | "needs-address";
        reason?: string;
    };
    /** Whether what's playing can be stopped too (a real Jellyfin server). */
    canStopPlaying?: boolean;
    /** Why devices can't reach the gate, in words. */
    gateProblem?: string | null;
    /** Stremio and Nuvio: whether a pause takes hold without reopening the app (false: devices can't reach SlickSync's gate). */
    instant?: boolean | null;
    limit: ScreenTimeLimit | null;
    /** Streaming paused - by the limit or by bedtime - until untilLabel on the account's clock. */
    paused: { until: string; untilLabel: string; reason: "limit" | "bedtime" } | null;
    /** A profile or household user merged into someone: whose it is. */
    profileOf?: { name: string | null; kind: "nuvio-profile" | "household" } | null;
    todayMinutes: number;
}

/** One row of the Users page's Limits overview. */
export interface LimitsSummary {
    on: boolean;
    paused: { untilLabel: string } | null;
}

/** An age limit, from a real Jellyfin server ('jellyfin') or kept by SlickSync ('streams'). */
export interface AgeLimitView extends JellyfinAgeLimit {
    /** Why, in words. */
    addressProblem?: string | null;
    /** Devices can't reach SlickSync's gate, so it can't be held to yet. */
    needsAddress?: boolean;
    /** No OMDb key: no title has a rating, so everything counts as unrated. */
    needsKey?: boolean;
    /** Unavailable: why. */
    reason?: string;
    source?: "jellyfin" | "streams" | null;
}

/** AIOStreams' own view of a person's configuration (server/utils/aioHealth.js). */
export interface AioHealth {
    analytics?: {
        range: "24h" | "7d";
        requests: number;
        errorRate: number;
        addons: {
            name: string;
            preset: string | null;
            requests: number;
            errorRate: number;
            emptyRate: number;
            avgLatencyMs: number | null;
            share: number;
            slow: boolean;
            redundant: boolean;
        }[];
        services: { id: string; streams: number; cachedShare: number }[];
    } | null;
    analyticsEnabled?: boolean;
    analyticsError?: string;
    apps?: { name: string; lastSeen: string | null }[];
    available: boolean;
    canRead?: boolean;
    reason?: string;
    /** What they watched lately, to test with one click. */
    recent?: { type: "movie" | "series"; id: string; name: string }[];
    searchAvailable?: boolean;
}

/** What one AIOStreams test search found. */
export interface AioTestSearch {
    addons: { name: string; streams: number; cached: number; library: number }[];
    cached: number;
    errors: { title: string; description: string }[];
    p2p: number;
    streams: number;
    tookMs: number;
    usenet: number;
}

/** A device signed in as someone on a Jellyfin server (server/utils/jellyfinDevices.js). */
export interface JellyfinDevice {
    app: string | null;
    id: string;
    lastActive: string | null;
    name: string;
    /** SlickSync's own sign-in - shown, never signed out. */
    slicksync: boolean;
}

/** AIOStreams collections as an export file or share code carries them (server/utils/aioCollections.js). */
export interface AioCollectionsExport {
    catalogs: {
        ref: string;
        name: string;
        description: string | null;
        coverUrl: string | null;
        items: {
            id: string;
            type: "movie" | "series";
            name: string;
            poster: string | null;
            year: number | string | null;
        }[];
    }[];
    collections: {
        name: string;
        coverUrl: string | null;
        hidden: boolean;
        catalogs: string[];
        order?: string[];
    }[];
    v: 1;
}

/** An AIOStreams login whose collections can be arranged, and the profiles that share them. */
export interface AioCollectionAccount {
    avatarUrl: string | null;
    /** Whether SlickSync can set up a profile's own collections in AIOStreams (it kept the configuration password). */
    canSplit: boolean;
    colorIndex: number | null;
    email: string | null;
    id: string;
    linked: boolean;
    name: string;
    /** Household profiles; `own` once they have collections of their own. */
    profiles: { id: string; name: string; own: boolean }[];
    useGravatar?: boolean;
}

export interface AioCollectionsView {
    catalogs: { id: string; name: string; titles: number; cover: string | null }[];
    collections: AioCollection[];
    configured: boolean;
    linked: boolean;
    /** Set when looking at a profile; `own` false means it sees its account's collections. */
    profile?: { id: string; name: string; own: boolean } | null;
}

/** One household user on an AIOStreams or AIOMetadata sign-in, as a profile. */
export interface NuvioServersState {
    available: boolean;
    enabled: boolean;
    hasNuvio: boolean;
    readError: string | null;
    server: { kind: string; kindLabel: string; userName: string | null } | null;
    servers: {
        id: string;
        name: string;
        userName: string | null;
        fromSlickSync: boolean;
        enabled: boolean;
    }[];
}

export interface HouseholdProfile {
    /** Their picture on the server, when it has one. */
    avatarUrl?: string | null;
    id: string;
    /** Whose limits its Limits pill opens: its own person's id, or its own as a merged household user. */
    limitId?: string;
    name: string;
    person: { id: string; username: string } | null;
    status: "tracked" | "own" | "untracked" | "needs-pin" | "needs-sign-in";
}

/** An AIOStreams household user kept separate: their own sign-in address. */
export interface HouseholdPersonal {
    address: string | null;
    separate: boolean;
    /** The full sign-in address to hand to them. */
    url: string | null;
}

export interface User {
    activityVisibility?: "public" | "private";
    addons?: number;
    /** An AIOStreams configuration SlickSync reads to warn about outside changes. */
    aioConfigWatched?: boolean;
    avatarUrl?: string | null;
    colorIndex?: number;
    createdAt?: string;
    discordWebhook?: string;
    email?: string;
    excludedAddons?: string[];
    /** Left out of household numbers - totals, Top Viewers, Wrapped. */
    excludeFromHouseholdStats?: boolean;
    expiresAt?: string | null;
    groupId?: string; // Single group ID (legacy)
    groupIds?: string[];
    groups?: string[]; // Group names array
    // Account Guard: non-null when this user's provider account was changed by
    // something other than SlickSync since our last write - carries the diff
    // for display. Cleared by a sync (re-assert) or by accepting the change.
    guardExternal?: {
        provider: "stremio" | "nuvio";
        detectedAt: string;
        added: Array<{ url: string; name: string }>;
        removed: Array<{ url: string; name: string }>;
    } | null;
    hasStremioConnection?: boolean;
    id: string;
    inviteCode?: string;
    isActive?: boolean;
    jellyfinServer?: string | null;
    /** For a Jellyfin login: which kind of server, where, and the name they sign in with there. */
    jellyfinServerKind?: "jellyfin" | "aiostreams" | "aiometadata";
    jellyfinServerLabel?: string;
    jellyfinUserName?: string | null;
    /** When they were last seen watching anything, from SlickSync's own
     *  records (server/utils/lastSeen.js). Null = never. */
    lastActive?: string | null;
    // When this user's addons were last successfully synced, and the state of
    // that sync. Null until the first sync completes - these columns existed
    // for a long time before anything wrote them, which (together with the
    // response allowlist dropping them) is why the Users list showed a
    // hardcoded 'Unknown'.
    lastSyncedAt?: string | null;
    name?: string; // Legacy field, prefer username
    /** Which Nuvio profile's addon list this user manages (1 is the primary). */
    nuvioProfileId?: number;
    protectedAddons?: string[];
    providerConnectionError?: string | null;
    providerType?: "stremio" | "nuvio" | "jellyfin";
    secondaryProviderType?: "stremio" | "nuvio" | "jellyfin" | null;
    simklConnected?: boolean;
    simklConnectedAt?: string | null;
    status?: "active" | "inactive";
    stremioAddonsCount?: number;
    syncStatus?: string | null;
    /** SlickTrax Addon - per-user Stremio addon toggle + its URL token. */
    traxAddonEnabled?: boolean;
    traxManifestUrl?: string | null;
    /** In-player actions in the SlickTrax addon (opt-in per user). */
    traxToken?: string | null;
    updatedAt?: string;
    /** They switched Gravatar on, so an avatar of them may look their email up there. */
    useGravatar?: boolean;
    username: string;
    watchTime?: number;
}

export interface MergeCandidate {
    avatarUrl?: string | null;
    colorIndex?: number;
    email?: string;
    id: string;
    providerType: "stremio" | "nuvio" | "jellyfin";
    username: string;
}

export interface MergePreview {
    donor: { id: string; username: string; providerType: "stremio" | "nuvio" | "jellyfin" };
    donorGroupName: string | null;
    episodeCount: number;
    groupsDiffer: boolean;
    movieCount: number;
    sessionCount: number;
    snapshotCount: number;
    survivor: { id: string; username: string; providerType: "stremio" | "nuvio" | "jellyfin" };
    survivorGroupName: string | null;
}

export interface MergeInfo {
    donorAvatarUrl: string | null;
    donorColorIndex: number | null;
    donorEmail: string | null;
    donorUseGravatar?: boolean;
    donorUsername: string | null;
    providerType: "stremio" | "nuvio" | "jellyfin";
    undoable: boolean;
}

export interface CreateUserData {
    authKey?: string;
    email?: string;
    name: string;
}

export interface Group {
    addons?: number; // Count of active addons
    avatarUrl?: string | null;
    color?: string;
    colorIndex?: number;
    // Both nullable, and both were typed as required `string` while the API
    // returned neither - so `group.createdAt` type-checked but was always
    // undefined at runtime, which is what made the detail page show a permanent
    // "Created: Unknown". createdAt is now recovered server-side from the cuid
    // primary key; it is null only for a group whose id isn't a cuid.
    createdAt?: string | null;
    description?: string;
    id: string;
    isActive?: boolean;
    // Most recent sync across the group's members - a group has no sync of its
    // own. null when no member has ever synced.
    lastSyncedAt?: string | null;
    name: string;
    updatedAt?: string | null;
    userIds: string[] | string; // Can be array or JSON string
    users?: number; // Count of active users
}

export interface CreateGroupData {
    color?: string;
    colorIndex?: number;
    description?: string;
    name: string;
}

export type VaultCategory =
    | "debrid"
    | "usenet_provider"
    | "usenet_indexer"
    | "stremio"
    | "nuvio"
    | "metadata"
    | "ai"
    | "vpn"
    | "aiostreams"
    | "custom";

export type VaultTestType =
    | "manual"
    | "generic_http"
    | "real_debrid"
    | "torbox"
    | "newznab_caps"
    | "tcp_reachability"
    | "stremio_auth"
    | "nuvio_auth"
    | "openai_compatible";

export interface VaultEntry {
    autoRemoveAfterDays?: number;
    // real_debrid/torbox only - daily sweep that deletes a finished torrent
    // from the provider's own account once it's sat idle this many days.
    autoRemoveEnabled?: boolean;
    /** Failover partner - used when this entry's own health check is failing. */
    backupEntryId?: string | null;
    category: VaultCategory;
    cost?: number | null;
    costCycle?: "monthly" | "yearly";
    dashboardUrl?: string | null;
    expiresAt?: string | null;
    id: string;
    isActive: boolean;
    lastCheckedAt?: string | null;
    lastCheckMessage?: string | null;
    lastCheckStatus?: "ok" | "error" | "unknown" | null;
    name: string;
    notifyDaysBefore: number;
    position?: number;
    provider?: string | null;
    secretLabel: string;
    snoozedUntil?: string | null;
    testConfig?: VaultTestConfig | null;
    testType: VaultTestType;
    updatedAt: string;
}

export interface PushDevice {
    createdAt: string;
    id: string;
    label: string | null;
    lastSeenAt: string | null;
    userAgent: string | null;
}

export interface VaultListResponse {
    categories: Record<string, number>;
    currency?: string;
    entries: VaultEntry[];
    total: number;
}

export interface VaultEntryInput {
    autoRemoveAfterDays?: number;
    autoRemoveEnabled?: boolean;
    category: VaultCategory;
    cost?: number;
    costCycle?: "monthly" | "yearly";
    dashboardUrl?: string;
    expiresAt?: string;
    name: string;
    notifyDaysBefore?: number;
    provider?: string;
    secret: string;
    secretLabel?: string;
    testConfig?: VaultTestConfig;
    testType?: VaultTestType;
}

export interface BackupTargets {
    /** Optional - set to encrypt uploads (.enc); empty uploads plain JSON. Comes back masked. */
    encryptPassphrase: string;
    /** How many local backup files to keep. 0 = keep everything. */
    keepLocal: number;
    s3: {
        endpoint: string;
        region: string;
        bucket: string;
        prefix: string;
        accessKeyId: string;
        secretAccessKey: string;
    };
    type: "none" | "s3" | "webdav";
    webdav: { url: string; username: string; password: string };
}

export interface DataBackupSnapshot {
    createdAt: string;
    encrypted: boolean;
    filename: string;
    sizeBytes: number;
}

export interface DataBackupSettings {
    available?: boolean;
    enabled: boolean;
    frequencyDays: number;
    /** True when an off-site passphrase is set - required before snapshots may leave the box. */
    hasPassphrase?: boolean;
    keepLocal: number;
    lastError: string | null;
    lastOkAt: string | null;
    lastRunAt: string | null;
    lastSizeBytes: number | null;
    lastVerified: boolean | null;
    offsite: boolean;
    snapshots?: DataBackupSnapshot[];
}

export interface DbMaintenanceSettings {
    available?: boolean;
    integrityCheckEnabled: boolean;
    lastIntegrityCheckAt: string | null;
    lastIntegrityOk: boolean | null;
    lastNotificationsPruneAt: string | null;
    lastPruneAt: string | null;
    lastVacuumAt: string | null;
    pruneLogsEnabled: boolean;
    pruneNotificationsDays: number;
    pruneNotificationsEnabled: boolean;
    vacuumEnabled: boolean;
}

export interface UpdateCapability {
    canSelfUpdate: boolean;
    composeProject: string | null;
    image: string | null;
    reason: string;
    socketAvailable: boolean;
}

export interface ProxyActionResult {
    id: string;
    name?: string;
    proxyEnabled?: boolean;
    proxyManifestUrl?: string | null;
    proxyUuid?: string | null;
}

export interface AddonHealthConfig {
    failureThreshold?: number;
    intervalMinutes?: number;
    probeUrl?: string;
}

export interface VaultifyResult {
    entries: string[];
    note: string;
    proxyManifestUrl: string;
    vaultified: boolean;
}

export interface AddonBackup {
    backupAddon?: AddonBackup | null;
    customLogo?: string | null;
    iconUrl?: string;
    id: string;
    isActive: boolean;
    isOnline: boolean;
    lastHealthCheck?: string | null;
    logo?: string;
    manifest?: Partial<StremioManifest>;
    name: string;
    stremioAddonId?: string;
    version?: string;
}

export interface Addon {
    backupAddon?: AddonBackup | null;
    // Backup fields
    backupAddonId?: string;
    catalogs: Array<string | { type: string; id: string; search?: boolean }>;
    createdAt: string;
    customLogo?: string | null;
    customTag?: string | null;
    description?: string;
    groups?:
        | number
        | {
              id: string;
              name: string;
              color?: string;
              users?: number;
              addonCount?: number;
              addons?: number;
          }[];
    hasBackup?: boolean;
    healthCheckError?: string;
    healthConfig?: AddonHealthConfig | null;
    iconUrl?: string;
    id: string;
    isActive?: boolean;
    // Set by getGroupAddons when primary is offline and backup is used
    isBackup?: boolean;
    // Health check fields
    isOnline?: boolean;
    // Account-wide protection (by name, across every user — see
    // routes/addons.js's /:id/protect) and the user-defined custom tag.
    isProtected?: boolean;
    lastHealthCheck?: string;
    logo?: string;
    manifest?: Partial<StremioManifest>;
    manifestUrl: string;
    name: string;
    originalManifest?: Partial<StremioManifest>;
    primaryAddonId?: string;
    primaryAddonName?: string;
    proxyEnabled?: boolean;
    proxyManifestUrl?: string | null;
    proxyUuid?: string | null;
    resources: string[];
    status?: string;
    stremioAddonId?: string;
    transportUrl?: string;
    updatedAt: string;
    url?: string;
    users?: number;
    vaultified?: boolean;
    version?: string;
}

export interface CreateAddonData {
    manifestData?: Partial<StremioManifest>; // Optional pre-fetched manifest data
    manifestUrl: string;
    name?: string;
}

export interface Invitation {
    code?: string; // legacy field (old UI)
    createdAt: string;
    currentUses?: number;
    expiresAt?: string | null;
    groupId?: string;
    groupName?: string;
    id: string;
    inviteCode?: string; // canonical backend field
    isActive?: boolean;
    maxUses?: number | null;
    membershipDuration?: number | null;
    membershipDurationDays?: number | null;
    // Backend currently returns inviteCode + various legacy fields; keep this flexible
    name?: string;
    requests?: InviteRequest[];
    syncOnJoin: boolean;
    uses?: number; // legacy
}

export interface CreateInvitationData {
    expiresAt?: string;
    groupId?: string;
    groupName?: string;
    /** A real Jellyfin server whose account this invitation makes; null for none. */
    jellyfinServerKey?: string | null;
    maxUses?: number;
    membershipDuration?: number;
    name?: string;
    syncOnJoin?: boolean;
}

export interface InviteRequest {
    createdAt: string;
    email: string;
    id: string;
    invitation?: { id: string; name?: string; groupName?: string };
    invitationId: string;
    oauthCode?: string;
    oauthExpiresAt?: string;
    oauthLink?: string;
    requestedAt?: string;
    respondedAt?: string;
    respondedBy?: string;
    status: "pending" | "accepted" | "rejected" | "joined";
    userId?: string;
    username: string;
}

export interface WatchTimeData {
    byDate: {
        date: string;
        watchTimeSeconds: number;
        watchTimeHours: number;
        itemsCount: number;
        movies: number;
        shows: number;
    }[];
    totalWatchTimeHours: number;
    totalWatchTimeSeconds: number;
}

export interface TopItem {
    id: string;
    name: string;
    poster?: string;
    type: "movie" | "series";
    watchTime: number;
}

export interface StreakData {
    currentStreak: number;
    lastWatchDate?: string;
    longestStreak: number;
}

export interface VelocityData {
    daily: number;
    monthly: number;
    trend: "up" | "down" | "stable";
    weekly: number;
}

interface ProviderAddon {
    customLogo?: string | null;
    description?: string;
    iconUrl?: string;
    id?: string;
    logo?: string;
    manifest?: StremioAddon["manifest"];
    manifestUrl?: string;
    name?: string;
    resources?: StremioAddon["manifest"]["resources"];
    transportUrl?: string;
    types?: string[];
    url?: string;
    version?: string;
}

export interface VaultTestConfig {
    baseUrl?: string;
    dataCapGB?: number;
    host?: string;
    model?: string;
    port?: number;
    ssl?: boolean;
    url?: string;
}

export interface ProxyRequestLog {
    addonId?: string;
    addonName?: string;
    cacheHit: boolean;
    error: string | null;
    ip: string | null;
    method: string;
    path: string;
    proxyUuid?: string;
    responseTimeMs: number | null;
    statusCode: number | null;
    timestamp: string;
    upstreamUrl: string | null;
    url: string | null;
    userAgent: string | null;
}

export interface StremioAddon {
    manifest: {
        id: string;
        name: string;
        version: string;
        description?: string;
        logo?: string;
        resources: (string | { name: string; types?: string[]; idPrefixes?: string[] })[];
        types: string[];
        catalogs?: {
            id: string;
            type: string;
            name?: string;
            extra?: { name: string; options?: string[]; isRequired?: boolean }[];
        }[];
    };
    name?: string;
    transportUrl: string;
}

export interface AccountStats {
    avatarUrl?: string | null;
    displayName?: string | null;
    email?: string | null;
    linkedProvider?: "stremio" | "nuvio" | null;
    pendingInvites: number;
    totalAddons: number;
    totalGroups: number;
    totalUsers: number;
    uuid?: string | null;
}

export interface SyncSettings {
    accountTimezone?: string;
    accountTimezoneIsDefault?: boolean;
    /** Opt-in "Airing this season" anime row in Discover (AniList). */
    animeSeasonalRow?: boolean;
    autoplayTrailerStartMuted?: boolean;
    /** Opt-in scheduled self-update (private instances with the socket
     * mounted): checks daily at autoUpdateHour, backs up, updates, and the
     * watchdog rolls back automatically on a failed health check. */
    autoUpdateEnabled?: boolean;
    autoUpdateHour?: number;
    enableAutoplayTrailer?: boolean;
    // Opt-in (default false, unlike the toggles above) - see settings.js's own comment.
    enableAutoThemedCatalogs?: boolean;
    enabled: boolean;
    enablePosterRatings?: boolean;
    enableReactions?: boolean;
    enableRecommendations?: boolean;
    enableWatchedIndicators?: boolean;
    // Personal-features opt-outs (v1.31+). Default true when absent.
    enableWatchlist?: boolean;
    enableWatchProviders?: boolean;
    /** Watching Together (watch-ahead protection) - the show-detail section
     * and its alerts. On by default; per-show pacts are still the real
     * opt-in, this hides the whole feature. */
    enableWatchTogether?: boolean;
    frequency: string;
    /** Result of the last validity check per provider - see checkProviderKeys()
     * and server/utils/metadataKeyHealth.js. Absent for a provider that's
     * never been checked. */
    keyHealth?: Record<
        string,
        {
            ok: boolean;
            message: string;
            rateLimited: boolean;
            checkedAt: string;
            /** MDBList only - the one provider that actually exposes live quota
             * usage (confirmed against their own OpenAPI spec). TMDb has no rate
             * limit to show, OMDb and RPDB expose no usage endpoint at all. */
            usage?: {
                used: number;
                limit: number;
                percentUsed: number;
                plan: string | null;
                approximate?: boolean;
            };
        }
    >;
    /** Key Pool, opt-in: a pool EXTRA failing for 3 straight days is removed
     * from the pool automatically, with one notification. */
    keyPoolAutoRetire?: boolean;
    /** Key Pool, opt-in: spread requests toward the pool key with the most
     * remaining quota (providers that report usage only - MDBList today). */
    keyPoolQuotaWeighting?: boolean;
    /** Read-only: stamped when a kit is actually exported. */
    lastRecoveryKitExportAt?: string | null;
    /** This account's own LumiereDB (Settings -> External API Keys). */
    lumiereDbUrl?: string;
    malClientId?: string;
    mdblistApiKey?: string;
    mdblistApiKeyBackup?: string;
    mdblistApiKeyPool?: string[];
    mode: "normal" | "advanced";
    notifyDigestEnabled?: boolean;
    notifyDigestFrequency?: "daily" | "weekly";
    notifyOnActivity?: boolean;
    notifyOnAddonHealth?: boolean;
    notifyOnAutomation?: boolean;
    notifyOnBackup?: boolean;
    notifyOnConnectionHealth?: boolean;
    notifyOnInvite?: boolean;
    notifyOnKeyHealth?: boolean;
    notifyOnMosaic?: boolean;
    notifyOnNewDevice?: boolean;
    notifyOnProxyHealth?: boolean;
    /** Opt-in nudge when the Disaster Recovery Kit is stale/missing while the
     * Vault holds credentials. Nothing is ever uploaded - see
     * server/utils/recoveryKitReminder.js. */
    notifyOnRecoveryKitStale?: boolean;
    notifyOnSync?: boolean;
    notifyOnUpdateAvailable?: boolean;
    notifyOnVault?: boolean;
    /** Anon key for that backend. Only takes effect alongside nuvioServerUrl. */
    nuvioAnonKey?: string;
    /** Self-hosted Nuvio backend URL, e.g. https://backend.example.com. Blank uses api.nuvio.tv. */
    nuvioServerUrl?: string;
    omdbApiKey?: string;
    omdbApiKeyBackup?: string;
    omdbApiKeyPool?: string[];
    /** The address phones and TVs reach this instance at, as SlickSync uses it (server/utils/ownAddress.js). */
    ownAddress?: string;
    /** An address typed in before SlickSync learned its own; no longer set from the page. */
    publicBaseUrl?: string;
    /** Opt-in: background enrichment stands down past the daily quota threshold. */
    quotaAutopilot?: boolean;
    quotaAutopilotPercent?: number;
    rpdbApiKey?: string;
    rpdbApiKeyBackup?: string;
    rpdbApiKeyPool?: string[];
    safe: boolean;

    simklClientId?: string;
    tmdbApiKey?: string;
    /** Failover keys - used automatically when the matching primary above is
     * found failing or rate-limited by the health check. */
    tmdbApiKeyBackup?: string;
    /** Key Pool extras beyond the primary/backup pair. When any exist, lookups
     * rotate across every healthy key instead of always using the primary. */
    tmdbApiKeyPool?: string[];
    /** Public Trakt list import (client id only - not an account connection). */
    traktClientId?: string;
    useCustomFields?: boolean;
    vaultCurrency?: string;
    webhookUrl?: string;
}

export interface ThemePref {
    // Legacy pre-v1.25 single-slot shape (kept for one-way read compat).
    custom?: {
        base: string;
        primary: string;
        secondary: string;
        text?: string | null;
        fontDisplay?: string | null;
    } | null;
    // New list shape (v1.25+): multiple saved custom themes, each with its own
    // id + display name. Server accepts either this OR the legacy `custom`
    // single-slot shape below, which is auto-migrated on load.
    customThemes?: Array<{
        id: string;
        name: string;
        base: string;
        primary: string;
        secondary: string;
        text?: string | null;
        textMuted?: string | null;
        background?: string | null;
        surface?: string | null;
        bgMuted?: string | null;
        border?: string | null;
        fontDisplay?: string | null;
        radius?: string | null;
    }>;
    themeId: string;
}

export interface RecommendationRow {
    genre: string;
    // True when the item-item affinity map has real neighbors for this row's
    // seed - i.e. actual cross-item viewing behavior backs this row, not just
    // the seed's own decayed watch-time score in isolation. See the /similar
    // route's own comment for the fuller reasoning behind this distinction.
    hasRealSignal?: boolean;
    items: DiscoverItem[];
    reason: string;
    seedId: string;
    seedType: "movie" | "series";
}

export interface TasteOverlapUser {
    avatarUrl?: string | null;
    colorIndex?: number | null;
    email?: string;
    id: string;
    useGravatar?: boolean;
    username: string;
}

export interface TasteOverlapSharedItem {
    key: string;
    name: string | null;
    poster: string | null;
    type: "movie" | "series";
}

export interface TasteOverlapPair {
    shared: TasteOverlapSharedItem[];
    sharedCount: number;
    similarity: number;
    userA: TasteOverlapUser;
    userB: TasteOverlapUser;
}

export interface TasteProfile {
    movieCount: number;
    seriesCount: number;
    tasteTwin: { user: TasteOverlapUser; similarity: number } | null;
    titleCount: number;
    topGenres: Array<{ genre: string; count: number }>;
    topTitles: Array<{
        key: string;
        name: string;
        poster: string | null;
        type: "movie" | "series";
        seconds: number;
    }>;
    totalSeconds: number;
    user: TasteOverlapUser;
}

export interface WatchlistItem {
    addedAt: string;
    id: string;
    itemId: string;
    itemType: "movie" | "series";
    name: string;
    poster: string | null;
    /** Manual rank; null when never reordered (falls to the newest-first tail). */
    sortOrder?: number | null;
}

export interface CustomListItem {
    id: string;
    name: string;
    poster?: string | null;
    type: "movie" | "series";
    year?: number | string | null;
}

// The structured query nlCatalog.js parsed a description into - shown back
// to the admin as "here's what I understood" before they commit to saving.
export interface DescribedCatalogQuery {
    genres: string[];
    keywords: string[];
    maxRuntimeMinutes: number | null;
    type: "movie" | "series" | null;
    yearFrom: number | null;
    yearTo: number | null;
}
export interface DescribedCatalogPreview {
    // Set only when an AI key IS configured but the call itself failed (wrong
    // model/baseUrl pairing, invalid key, provider outage) - null whenever no
    // AI key is configured at all, since that's not an error, just the
    // expected zero-setup path. Lets the UI say *why* it fell back instead of
    // leaving a configured-looking key silently unused with no explanation.
    aiError: string | null;
    engine?: "lumiere" | "tmdb";
    /** Parts of the request this search couldn't use ('keywords' with LumiereDB alone). */
    ignored?: string[];
    items: CustomListItem[];
    mediaType: "movie" | "tv";
    query: DescribedCatalogQuery;
    /** What was understood, in words ("Crime, movies, directed by Martin Scorsese"). */
    summary?: string;
    usedAi: boolean;
}

export interface CatalogSuggestion {
    id: string;
    name: string;
    poster?: string | null;
    type: "movie" | "series";
    year?: number | string | null;
}

export interface CustomList {
    // True for a catalog server/utils/autoThemedCatalogs.js created from a
    // detected taste cluster (Settings -> SlickTrax -> Auto-generated
    // catalogs). Purely informational client-side - deleting it works the
    // same as any other catalog (the server records the dismissal so it
    // doesn't come back).
    autoGenerated: boolean;
    autoRefresh: boolean;
    autoRefreshFrequency: "daily" | "weekly";
    coverColorIndex: number | null;
    coverImageUrl: string | null;
    createdAt: string;
    description: string | null;
    // Published to OTHER SlickSync instances to subscribe to. A different
    // audience from `shared` above (which is other accounts on THIS instance),
    // hence a separate opt-in. Boolean only - the share URL's token is never
    // in this payload; read it with getCatalogShareLink.
    federationPublished: boolean;
    id: string;
    importSourceUrl: string | null;
    isOwner: boolean;
    items: CustomListItem[];
    // Content-rating ALLOWLIST - OMDb "Rated" values to KEEP, e.g. a "Kids"
    // catalog set to ["G","PG"]. Empty = no policy (nothing touched). Only
    // changes via applyContentRating, which also performs the removal - see
    // server/utils/contentRating.js.
    keptRatings: string[];
    lastAutoRefreshAt: string | null;
    // When a content-rating removal is undoable via restoreContentRatingRemoval -
    // null means nothing to restore (never applied, or already restored).
    lastRemovalAt: string | null;
    name: string;
    pinned: boolean;
    // Owner-set opt-in - visible (read-only) to every other account on this
    // instance when true. isOwner is computed server-side per viewer, not
    // stored - a shared catalog you don't own comes back with isOwner: false
    // and the client must hide every mutating affordance for it.
    shared: boolean;
    /** Set when this catalog is a Smart Catalog - the stored criteria it re-evaluates. */
    smartRuleJson?: string | null;
    updatedAt: string;
}

// Automation rules ("when X happens, do Y") - server/utils/automation/registry.js
// is the single source of truth these types mirror; the rule builder UI reads
// AutomationRegistry live from the server rather than hardcoding this shape a
// second time, so a new trigger/action shows up without a client release.
export interface AutomationField {
    hint?: string;
    label: string;
    name: string;
    required?: boolean;
    // 'weekdays' only ever appears in triggerConfigFields, never in a trigger's
    // payload `fields` - it is the day picker on a scheduled trigger, stored as
    // an array of 0-6 (0 = Sunday).
    type: "string" | "number" | "boolean" | "weekdays";
}
export interface AutomationTriggerDef {
    description: string;
    fields: AutomationField[];
    label: string;
    // Only schedule-driven triggers (time.daily) have this - the rule
    // builder shows a config form (writing into rule.triggerConfig) instead
    // of/alongside the normal condition builder when present.
    triggerConfigFields?: AutomationField[];
    type: string;
}
export interface AutomationOperatorDef {
    label: string;
    op: string;
    unary: boolean;
}
export interface AutomationConfigField {
    hint?: string;
    label: string;
    name: string;
    options?: Array<{ value: string; label: string }>;
    required?: boolean;
    // 'select' carries its own fixed `options`; addon/group/user load their
    // choices from the account's data instead.
    type: "string" | "text" | "addon" | "group" | "user" | "select";
}
export interface AutomationActionDef {
    configFields: AutomationConfigField[];
    description: string;
    label: string;
    type: string;
}
export interface AutomationRegistry {
    actions: AutomationActionDef[];
    operators: AutomationOperatorDef[];
    triggers: AutomationTriggerDef[];
}
export interface AutomationCondition {
    field: string;
    op: string;
    value?: string | number;
}
export interface AutomationActionConfig {
    config: Record<string, string>;
    type: string;
}
export interface AutomationRuleInput {
    actions: AutomationActionConfig[];
    conditions?: AutomationCondition[];
    enabled?: boolean;
    name: string;
    triggerConfig?: Record<string, unknown>;
    triggerType: string;
}
export interface AutomationRule {
    actions: AutomationActionConfig[];
    conditions: AutomationCondition[];
    createdAt: string;
    enabled: boolean;
    id: string;
    lastRunAt: string | null;
    name: string;
    runCount: number;
    triggerConfig: Record<string, unknown>;
    triggerType: string;
    updatedAt: string;
}
export interface AutomationActionResult {
    message: string;
    ok: boolean;
    type: string;
}
export interface AutomationRun {
    createdAt: string;
    id: string;
    ok: boolean;
    payload: Record<string, unknown>;
    results: AutomationActionResult[];
    ruleId: string;
    ruleName: string;
    triggerType: string;
}

// Nuvio's own native "Collections" (home-screen folder/catalog-source
// organizer), pulled/pushed live from the account itself — not this app's
// local CustomList above. Index signatures preserve fields this app's v1
// editor doesn't expose (pinToTop, viewMode, coverImageUrl, etc.) untouched
// through a load-edit-save round trip, rather than silently dropping a real
// user's existing settings for those.
export interface NuvioProfile {
    avatar_color_hex?: string | null;
    avatar_id?: string | null;
    canAdd?: boolean;
    created_at: string;
    id: string;
    isThisUser?: boolean;
    managedBy?: { id: string; username: string } | null;
    name: string;
    profile_index: number;
    // Added by /users/:id/nuvio-profiles. A profile using the primary's addons
    // has no list of its own to manage, and one already pointed at by another
    // user here should not be offered a second time - `canAdd` is those two
    // conditions together, so the UI does not have to restate them.
    profileIndex?: number;
    updated_at: string;
    user_id: string;
    uses_primary_addons?: boolean;
    uses_primary_plugins?: boolean;
    usesPrimaryAddons?: boolean;
}

export interface NuvioCatalogSource {
    addonId: string;
    catalogId: string;
    // Present when this source is one broad catalog filtered down to a
    // specific genre (the catalog's own "genre" extra parameter value) -
    // most addons expose genres as a filter on one catalog, not as separate
    // catalogs per genre. "none" (as seen on real, non-genre-filtered
    // sources) or absent both mean "no genre filter."
    genre?: string;
    type: string;
    [key: string]: unknown;
}

export interface NuvioCollectionFolder {
    catalogSources?: NuvioCatalogSource[];
    focusGifEnabled?: boolean;
    // The actual field Nuvio's home-row rendering checks to decide whether to
    // animate a folder's cover - separate from coverImageUrl (the static
    // fallback used everywhere else, e.g. folder detail). coverImageUrl alone,
    // even with a real .gif URL and focusGifEnabled true, never animates -
    // confirmed by reading Nuvio's own HomeCollectionRowSection.kt:
    // isAnimatedCollectionFolderImage() only checks focusGifUrl, and
    // collectionFolderCardImageUrl() only prefers it over coverImageUrl when
    // set. Keep this equal to coverImageUrl whenever that's a .gif, null
    // otherwise.
    focusGifUrl?: string | null;
    hideTitle?: boolean;
    id: string;
    // Confirmed live (2026-08-06): Nuvio's real client only picks up a BRAND
    // NEW folder on its first sync if these are present - a folder missing
    // them entirely (not just falsy) never renders, even after a full app
    // restart, despite the write/read round-tripping correctly everywhere
    // else. Every folder this app creates must set them (see
    // newFolderDefaults() in the Nuvio Collections page).
    tileShape?: "LANDSCAPE" | "SQUARE" | "POSTER";
    title: string;
    [key: string]: unknown;
}

export interface NuvioCollection {
    folders?: NuvioCollectionFolder[];
    id: string;
    title: string;
    [key: string]: unknown;
}

export interface SeriesSeason {
    episodes: Array<{
        season: number;
        episode: number;
        title: string | null;
        released: string | null;
        watched: boolean;
    }>;
    season: number;
    watchedCount: number;
}

export interface SmartCatalogRule {
    /** Actors by name; castMatch says whether all must be in it or any. */
    cast?: string[];
    castMatch?: "all" | "any";
    directors?: string[];
    /** Genres it must not have ("comedy but not romance"). */
    excludeGenres?: string[];
    genres: string[];
    keywords: string[];
    lastAiredFrom?: number | null;
    limit: number;
    maxRuntimeMinutes: number | null;
    minRating: number | null;
    minRuntimeMinutes?: number | null;
    /** Votes on IMDb's scale - keeps a 9.8 with twelve votes out. */
    minVotes?: number | null;
    /** Series only. */
    seriesStatus?: "airing" | "ended" | null;
    sort?: SmartCatalogSort | null;
    type: "movie" | "series" | null;
    /** Excludes anything anyone in the household has already watched. */
    unwatchedOnly: boolean;
    yearFrom: number | null;
    yearTo: number | null;
}

export type SmartCatalogSort = "popular" | "trending" | "top_rated" | "votes" | "newest" | "oldest";

export interface LumiereStatus {
    /** The address in use, without any user name or password. */
    address: string;
    message: string;
    state: "off" | "ready" | "building" | "unreachable" | "login" | "wrong";
}

export interface PersonSearchResult {
    imdbId?: string;
    mediaType: "movie" | "tv";
    poster: string | null;
    /** "Most popular" order: 1 is what they're best known for. */
    rank?: number;
    role: string | null;
    title: string;
    /** null when the result came from LumiereDB, which gives the IMDb id instead. */
    tmdbId: number | null;
    year: string | null;
}

/** A person at the top of their page in Discover - see server/utils/personFacts.js. */
export interface DiscoverPerson {
    bio?: string | null;
    birthday?: string | null;
    deathday?: string | null;
    id: number | null;
    knownFor?: string[] | null;
    name: string;
    placeOfBirth?: string | null;
    profile: string | null;
}

export type DiscoverKind = "movie" | "series" | "both";

/** Discover's filters a catalog can't apply itself (server/utils/discoverFacets.js). */
export interface DiscoverFacets {
    decade?: "2020s" | "2010s" | "2000s" | "1990s" | "1980s" | "older" | null;
    length?: "short" | "mid" | "long" | null;
    minRating?: number | null;
}

export interface FollowedSubject {
    createdAt: string;
    id: string;
    kind: "person" | "show";
    lastCheckedAt: string | null;
    muted: boolean;
    name: string;
    poster: string | null;
    subjectId: string;
}

export interface AnimeEntry {
    anilistId: number;
    episodes: number | null;
    format: string | null;
    name: string;
    year: number | null;
}

export interface SeasonalAnime {
    anilistId: number;
    episodes: number | null;
    format: string | null;
    genres: string[];
    name: string;
    nextEpisode: { episode: number; airingAt: string; label: string } | null;
    poster: string | null;
    score: number | null;
    siteUrl: string | null;
    status: string | null;
}

/** One row of a Nuvio profile's home screen (server/utils/nuvioHomeLayout.js). */
export interface NuvioHomeRow {
    addon_id: string;
    addonName: string;
    /** False for catalogs the saved arrangement has never mentioned. */
    arranged: boolean;
    catalog_id: string;
    catalogName: string;
    collection_id: string;
    custom_title: string;
    enabled: boolean;
    is_collection: boolean;
    /** True when the row's addon is no longer installed on the account. */
    orphaned: boolean;
    type: string;
}

export interface NuvioCommunityCover {
    id: number;
    image_url: string;
    likes_count: number;
    mime_type: string;
    orientation: "landscape" | "portrait" | string;
    title: string;
}

export interface NuvioCommunityCoversResponse {
    items: NuvioCommunityCover[];
    pagination: { page: number; limit: number; total: number; hasNextPage: boolean };
}

export interface YearInReviewTitle {
    episodeCount?: number;
    id: string;
    name: string;
    poster: string | null;
    rewatchCount?: number;
    type: "movie" | "series";
}

export interface YearInReview {
    busiestMonth: number; // 0-11
    byMonth: number[]; // 12 entries, seconds per month (Jan..Dec)
    completedMovies: number;
    episodesWatched: number;
    hasData: boolean;
    mostRewatched: YearInReviewTitle[];
    moviesWatched: number;
    movieWatchTimeSeconds: number;
    perUser: Array<{ userId: string; username: string; seconds: number }>;
    seriesWatchTimeSeconds: number;
    showsWatched: number;
    topShows: YearInReviewTitle[];
    totalWatchTimeSeconds: number;
    year: number;
}

export interface HealthStatus {
    addons: {
        total: number;
        checked: number;
        offlineCount: number;
        offline: Array<{
            id: string;
            name: string;
            error: string | null;
            lastChecked: string | null;
        }>;
        ignored: Array<{ id: string; name: string }>;
        uptime: Array<{ id: string; name: string; uptime7d: number; uptime30d: number }>;
    };
    checkedAt: string;
    /** Jellyfin, AIOStreams and AIOMetadata servers, from each person's last read (server/utils/serverStatus.js). */
    /** The account's LumiereDB, when one is set. */
    lumiere?: (LumiereStatus & { address: string }) | null;
    mismatchCount: number;
    overall: "healthy" | "attention";
    // null on public multi-tenant instances - the AIOStreams proxy monitor is
    // a private-mode, single-shared-instance concept with no per-account
    // Settings field, so there's nothing real to report for a given tenant.
    proxy: {
        ok: boolean | null;
        at: string | null;
        error: string | null;
        configured: boolean;
        healthIgnored: boolean;
    } | null;
    servers?: Array<{
        key: string;
        kind: "jellyfin" | "aiostreams" | "aiometadata";
        label: string;
        address: string;
        status: "up" | "down" | "partial";
        since: string | null;
        failingCount: number;
        people: Array<{
            id: string;
            name: string;
            state: "ok" | "issue" | "reconnect";
            error: string | null;
            since: string | null;
        }>;
        /** What the server runs, its channel (AIOStreams: stable or nightly), and the newest stable release. */
        version?: string | null;
        channel?: string | null;
        commit?: string | null;
        latest?: string | null;
        updateAvailable?: boolean;
    }>;
    sync: {
        usersTracked: number;
        driftCount: number;
        drifted: Array<{
            userId: string;
            title: string;
            body: string;
            url: string | null;
            since: string;
        }>;
        ignored: Array<{ userId: string; title: string; since: string | null }>;
    };
    timeline: Array<{
        id: string;
        source: "addon" | "vault" | "proxy" | "server";
        status: "up" | "down";
        title: string;
        detail: string | null;
        at: string;
    }>;
    vault: {
        total: number;
        failingCount: number;
        failing: Array<{
            id: string;
            name: string;
            provider: string | null;
            message: string | null;
            lastChecked: string | null;
        }>;
        expiringCount: number;
        expiring: Array<{ id: string; name: string; provider: string | null; expiresAt: string }>;
        ignored: Array<{ id: string; name: string; provider: string | null }>;
    };
    version: { running: string; latestRelease: string | null; updateAvailable: boolean };
}

export interface UpcomingEpisode {
    airDate: string;
    episode: number;
    eventId?: string;
    mediaType?: "movie" | "series";
    poster: string | null;
    releaseType?: string | null;
    season: number;
    showId: string;
    showName: string | null;
    title: string | null;
}

export interface MutedShow {
    createdAt: string;
    id: string;
    poster: string | null;
    showId: string;
    showName: string | null;
}

export interface ExportedConfig {
    addons: Addon[];
    groups: Group[];
    invitations: Invitation[];
    users: User[];
}

export interface ImportConfigResult {
    addons: { created: number; reused: number };
    groups: { created: number; reused: number };
    users: { created: number; reused: number };
}

export interface BackupValidation {
    counts: { users: number; groups: number; addons: number } | null;
    issues: string[];
    valid: boolean;
}

export interface BackupFile {
    createdAt: string;
    filename: string;
    size: number;
    validation?: BackupValidation | null;
}

export interface DbSizeReport {
    currentBytes?: number | null;
    growthBytesPerDay?: number | null;
    projectedDaysUntilFull?: number | null;
    samples?: Array<{ bytes: number; createdAt: string }>;
    supported: boolean;
}

export interface DisasterRecoveryKit {
    counts: { users: number; groups: number; addons: number; vaultEntries: number };
    exportedAt: string;
    payload: string;
    salt: string;
}

export interface AddonSnapshot {
    addonCount: number;
    createdAt: string;
    description: string | null;
    id: string;
    name: string;
    sourceId: string;
    sourceType: "user" | "group";
    updatedAt: string;
}

export interface AddonSnapshotDetail extends AddonSnapshot {
    addons: Array<{
        name: string;
        manifestUrl: string | null;
        stremioAddonId: string | null;
        version: string | null;
    }>;
}

export interface EpisodeAlert {
    createdAt: string;
    episode: number;
    id: string;
    poster: string | null;
    season: number;
    showId: string;
    showName: string;
    title: string | null;
}

export interface AddonHealthAlert {
    addonId: string;
    addonName: string;
    backupAddonId: string | null;
    backupAddonName: string | null;
    createdAt: string;
    errorMessage: string | null;
    event: "offline" | "online";
    groupCount: number;
    id: string;
}

// Persistent in-app bell notification (notifications table). Written from the
// same dispatch path as push/Discord; read state is server-side.
export interface StoredNotification {
    body: string;
    createdAt: string;
    data: string | null;
    id: string;
    poster: string | null;
    read: boolean;
    readAt: string | null;
    title: string;
    type: "activity" | "sync" | "invite" | "vault" | "task" | "mismatch";
    url: string | null;
}

export interface ContinueWatchingItem {
    appUrl?: string;
    background?: string | null;
    // 'movie' entries are in-progress movies (resume always true, nextEpisode/
    // lastWatched always null). For 'series', nextEpisode is the episode the
    // card opens - the in-progress one when resume=true, the next unwatched
    // one otherwise (field name kept from when it was always the latter).
    contentType: "series" | "movie";
    imdbRating: string | null;
    lastWatched: { season: number; episode: number } | null;
    lastWatchedAt: string;
    metacritic: string | null;
    nextEpisode: {
        season: number;
        episode: number;
        title: string | null;
        thumbnail: string | null;
    } | null;
    poster: string | null;
    progressPercent?: number | null;
    providerType?: string;
    resume?: boolean;
    rottenTomatoes: string | null;
    showId: string;
    showName: string;
    trackingService?: string;
    userId: string;
    username: string;
    webUrl?: string;
}

export interface DiscoverItem {
    genres: string[];
    id: string;
    imdbRating: string | null;
    metacritic?: string | null;
    name: string;
    poster: string | null;
    releaseInfo: string | null;
    // Merged in client-side after a separate ratings-batch call - Discover's
    // own catalog fetch is Cinemeta-only and has no Rotten Tomatoes/Metacritic.
    rottenTomatoes?: string | null;
    type: "movie" | "series";
}

// getSimklDiscoverRow's item shape - deliberately lighter than DiscoverItem
// (no genres/imdbRating - SIMKL's trending/anticipated payload doesn't
// carry either), matches PosterCardItem's actual minimum requirements.
export interface SimklDiscoverItem {
    id: string;
    name: string;
    poster: string | null;
    type: "movie" | "series";
    year: string | null;
}

export interface RatingsBatchEntry {
    imdbRating: string | null;
    metacritic: string | null;
    rottenTomatoes: string | null;
}

export interface PasskeyRow {
    createdAt: string;
    id: string;
    lastUsedAt: string | null;
    name: string;
    rpId: string | null;
}

export interface MediaDetails {
    awards: string | null;
    // TMDb backdrop (server/routes/users.js's /media-details) - preferred over
    // `background` (Cinemeta's own field) when available, generally higher
    // quality/more consistently present. Free at any TMDb tier, unlike RPDB's
    // equivalent which needs a paid Tier 2+ key. Null when no TMDb key is
    // configured or TMDb has nothing for this title.
    backdrop: string | null;
    background: string | null;
    // OMDb's own field, distinct from Awards - a movie's theatrical gross.
    // Virtually always null for TV (no theatrical release to report).
    boxOffice: string | null;
    cast: Array<{
        name: string;
        character: string | null;
        photo: string | null;
        tmdbId?: number | string | null;
    }>;
    // TMDb "belongs_to_collection" grouping (e.g. Dune -> Dune Collection) -
    // movies only, null for TV and for any movie not part of one.
    collection?: {
        id: number;
        name: string;
        parts: Array<{
            id: string;
            title: string;
            poster: string | null;
            releaseYear: string | null;
        }>;
    } | null;
    country: string | null;
    description: string | null;
    director: string[];
    episode?: {
        title: string | null;
        released: string | null;
        overview: string | null;
        thumbnail: string | null;
    };
    genres: string[];
    imdb_id: string | null;
    imdbRating: string | null;
    // MDBList's own blended score (0-100, weighted across multiple rating
    // sources) - null when no MDBList key is configured or MDBList has
    // nothing for this title, same as every other optional field here.
    mdblistScore?: number | null;
    metacritic: string | null;
    moviedb_id: number | null;
    poster: string | null;
    // Content/age rating (MPAA "PG-13"/"R" or TV parental guidelines
    // "TV-14"/"TV-MA"), NOT a quality score - see server/utils/omdb.js's own
    // comment on why "Not Rated" is kept as a real value distinct from null.
    rated: string | null;
    releaseInfo: string | null;
    rottenTomatoes: string | null;
    runtime: string | null;
    title: string | null;
    trailers: string[];
    // TMDb watch/providers (JustWatch data), US region - subscription/free
    // tiers only (rent/buy excluded, see server's own comment). `link` is
    // TMDb's required JustWatch attribution page for this title.
    watchProviders?: {
        link: string | null;
        providers: Array<{ name: string; logo: string | null }>;
    } | null;
}

export interface MetricsData {
    /** True when the feed was capped and older history can still be asked for. */
    activityTruncated?: boolean;
    admin?: AdminMetrics;
    nowPlaying: Array<{
        user: {
            id: string;
            username: string;
            email: string;
            colorIndex: number;
            avatarUrl?: string | null;
            useGravatar?: boolean;
        };
        item: {
            id: string;
            name: string;
            type: string;
            year?: number;
            poster?: string;
            season?: number;
            episode?: number;
        };
        videoId?: string | null; // videoId for series items (used for session matching)
        watchedAt: string;
        watchedAtTimestamp?: number; // Stable session startTime in ms (used for duration calculation)
        playback?: PlaybackEvidence | null;
        source?: string; // The provider signal used for this entry.
        // Playback position (ms), for the "resume here" quick-launch - native
        // only, a direct snapshot (see server/utils/metricsBuilder.js's comment).
        // Absent/null when unknown, e.g. a title the native pipeline hasn't
        // checkpointed yet.
        lastPosition?: number | null;
        totalDuration?: number | null;
        // Pre-built episode-aware deep links (server/utils/appLinks.js, same
        // builder Continue Watching uses) - absent when we don't have a real
        // item id to link to (e.g. an unmatched proxy-only entry).
        stremioAppUrl?: string;
        nuvioAppUrl?: string;
        // Proxy-sourced entries only: elapsed watch time we can actually stand
        // behind (seconds), frozen once proxy traffic goes quiet rather than
        // climbing forever off raw wall-clock time - see the comment in
        // server/utils/proxyNowPlaying.js for why. Use this (with elapsedFrozen)
        // instead of computing `now - watchedAtTimestamp` for proxy entries.
        elapsedSeconds?: number;
        elapsedFrozen?: boolean;
        // The device and app it's playing on, when the server reports them
        // (a Jellyfin server's sessions do).
        device?: { name: string | null; client: string | null } | null;
    }>;
    period: string;
    recentActivity?: Array<{
        user: {
            id: string;
            username: string;
            email?: string;
            colorIndex: number;
            avatarUrl?: string | null;
            useGravatar?: boolean;
            providerType?: "stremio" | "nuvio" | "jellyfin";
        };
        item: {
            id: string;
            name: string;
            type: string;
            poster?: string;
            season?: number | null;
            episode?: number | null;
        };
        videoId: string | null;
        profileLabel?: string | null;
        // Episode title from Cinemeta, when known - series entries only. See
        // EpisodeWatchHistory.episodeName in the schema for how this gets filled.
        episodeName?: string | null;
        // Real completion: true = genuinely finished (played to ~end), false =
        // started but dropped, null = unknown. See the schema comment.
        completed?: boolean | null;
        // Movies only: times watched to the end AGAIN after first completion
        // (0 = first watch). See MovieWatchHistory.rewatchCount in the schema.
        rewatchCount?: number;
        watchedAt: string;
        watchedAtTimestamp: number;
        // Only present when backfilled from a matching native WatchSession -
        // this feed has no per-event duration of its own (see metricsBuilder.js
        // mergeCrossPipelineDuplicates).
        durationSeconds?: number;
        // Only present when this watch was confidently correlated to a stream
        // seen by the AIOStreams proxy AND its resolved URL matched a known
        // debrid pattern (server/utils/debridDetection.js). e.g. "torbox".
        // Absent doesn't mean "not debrid" - it means not confidently detected.
        debridService?: string;
    }>;
    recentEpisodes?: Array<{
        user: { id: string; username: string; email?: string; colorIndex: number };
        item: {
            id: string;
            name: string;
            type: string;
            poster?: string;
            season?: number | null;
            episode?: number | null;
        };
        videoId: string;
        watchedAt: string;
    }>;
    startedPlaying: Array<{
        user: { id: string; username: string; email: string; colorIndex: number };
        item: {
            id: string;
            name: string;
            type: string;
            year?: number;
            poster?: string;
            season?: number;
            episode?: number;
        };
        startedAt: string;
    }>;
    summary: {
        totalUsers: number;
        activeUsers: number;
        totalMovies: number;
        totalShows: number;
        totalWatched: number;
        totalWatchTimeHours: number;
    };
    // The account's current calendar day (YYYY-MM-DD) in its configured
    // timezone - use this instead of computing "today" client-side (browser
    // local time or UTC) when looking up an entry in watchTime.byDay /
    // watchActivity.byDay, since those arrays are keyed by account-day.
    today?: string;
    userJoins?: {
        byDay: Array<{ date: string; count: number }>;
        byWeek: Array<{ week: string; count: number }>;
        byMonth: Array<{ month: string; count: number }>;
    };
    watchActivity: {
        byDay: Array<{ date: string; movies: number; shows: number; total: number }>;
        byUser: Array<{
            id: string;
            username: string;
            email?: string; // Added email
            avatarUrl?: string | null;
            useGravatar?: boolean;
            movies: number;
            shows: number;
            total: number;
            watchTimeHours: number;
            watchTimeMoviesHours: number;
            watchTimeShowsHours: number;
            streak?: number;
        }>;
    };
    watchSessions?: Array<{
        id: string;
        user: {
            id: string;
            username: string;
            email?: string;
            colorIndex: number;
            avatarUrl?: string | null;
            useGravatar?: boolean;
        };
        item: {
            id: string;
            name: string;
            type: string;
            poster?: string;
            season?: number | null;
            episode?: number | null;
        };
        videoId?: string | null;
        startTime: string;
        endTime?: string | null;
        durationSeconds: number;
        requestCount?: number | null;
        isActive: boolean;
        isSynthetic?: boolean;
    }>;
    watchTime: {
        byDay: Array<{ date: string; hours: number }>;
        trend?: {
            percentage: number;
            direction: "up" | "down";
        };
    };
}

// Admin Analytics Types (Phase 1 + Phase 2)
export interface AdminMetrics {
    // Phase 2: Addon Analytics
    addonAnalytics: {
        totalAddons: number;
        activeAddons: number;
        topAddons: AddonStat[];
        underutilized: AddonStat[];
        byResource: ResourceStat[];
    };
    alerts: {
        critical: Alert[];
        warnings: Alert[];
        operational: OperationalAlert[];
        total: number;
        hasCritical: boolean;
    };
    engagement: {
        hourlyActivity: HourlyActivity[];
        averageSessionMinutes: number;
        totalSessions: number;
        bingeSessions: number;
        peakHour: number;
    };
    interestingMetrics: {
        avgWatchTimePerUser: number;
        mostActiveHour: number;
        weekendWatchPercentage: number;
        completionRate: number;
        totalBingeSessions: number;
        avgSessionDuration: number;
    };
    // Phase 2: Server Health
    serverHealth: {
        status: "healthy" | "warning" | "critical";
        checks: {
            syncQueue?: HealthCheck;
            storage?: HealthCheck;
            database?: HealthCheck;
            activity?: HealthCheck;
        };
        metrics: {
            activeSessions: number;
            serverTime: string;
        };
    };
    topContent: {
        movies: TopContentItem[];
        series: TopContentItem[];
        trending: TopContentItem[];
    };
    // Phase 3: Enhanced Metrics
    topItems: {
        movies: TopItemWithUsers[];
        series: TopItemWithUsers[];
    };
    userLifecycle: {
        retention: {
            total: number;
            active7d: number;
            active30d: number;
            active90d: number;
            rate7d: number;
            rate30d: number;
            rate90d: number;
        };
        atRisk: AtRiskUser[];
        criticalRisk: AtRiskUser[];
    };
    watchVelocity: WatchVelocityItem[];
}

export interface OperationalAlert {
    addons?: string[];
    count?: number;
    message: string;
    severity: "critical" | "warning" | "info";
    sizeMB?: number;
    type: string;
}

export interface AddonStat {
    catalogs: StremioCatalog[];
    enabledGroups: number;
    iconUrl?: string;
    id: string;
    isActive: boolean;
    manifestUrl: string;
    name: string;
    resources: string[];
    totalGroups: number;
    usageRate: number;
    userCount: number;
}

export interface ResourceStat {
    count: number;
    name: string;
}

export interface HealthCheck {
    activeSessions?: number;
    fileCount?: number;
    message: string;
    sizeMB?: number;
    staleUsers?: number;
    status: "healthy" | "warning" | "critical" | "unknown";
    totalUsers?: number;
}

export interface AtRiskUser {
    daysInactive: number;
    email: string;
    id: string;
    lastActivity: string | null;
    neverWatched?: boolean;
    totalWatchTimeHours: number;
    username: string;
}

export interface TopContentItem {
    avgWatchTimeMinutes: number;
    completionRate: number;
    id: string;
    name: string;
    poster: string;
    recentVelocity: number;
    type: "movie" | "series";
    uniqueViewers: string[];
    watchCount: number;
}

export interface TopItemWithUsers {
    itemId: string;
    name: string;
    poster?: string;
    totalWatchTimeHours: number;
    totalWatchTimeSeconds: number;
    type: "movie" | "series";
    userCount: number;
    users: Array<{
        userId: string;
        username: string;
        email?: string;
        avatarUrl?: string | null;
        useGravatar?: boolean;
        colorIndex?: number;
        watchTimeSeconds: number;
        watchTimeHours: number;
        episodesWatched?: number;
    }>;
}

export interface WatchVelocityItem {
    daysActive: number;
    episodesPerDay: number;
    episodesPerWeek: number;
    estimatedEpisodes: number;
    itemId: string;
    name: string;
    poster?: string;
    totalWatchTimeHours: number;
}

export interface HourlyActivity {
    hour: number;
    sessions: number;
    watchTimeMinutes: number;
}

export interface Alert {
    count: number;
    message: string;
    severity: "critical" | "warning";
    type: string;
    users?: string[];
}

export interface ActivityLibraryData {
    count: number;
    library: Array<{
        user: { id: string; username: string; email: string; colorIndex: number };
        item: {
            _id?: string;
            id?: string;
            name: string;
            type: string;
            year?: number;
            poster?: string;
            state?: {
                overallTimeWatched?: number;
                timeOffset?: number;
                lastWatched?: string;
            };
            _mtime?: string;
        };
    }>;
}
