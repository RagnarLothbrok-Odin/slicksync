"use client";

import {
    ArrowPathIcon,
    ArrowRightIcon,
    ArrowTopRightOnSquareIcon,
    FingerPrintIcon,
    ShieldCheckIcon,
    UserIcon,
} from "@heroicons/react/24/outline";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import JellyfinSignIn, {
    type JellyfinCredentials,
    type JellyfinSignInApi,
} from "@/components/jellyfin/JellyfinSignIn";
import { FilterTabs } from "@/components/ui/FilterTabs";
import { PasswordToggleButton } from "@/components/ui/Input";
import { SlickSyncLogo } from "@/components/ui/SlickSyncLogo";
import { VerificationCode } from "@/components/ui/VerificationCode";
import { api } from "@/lib/api";
import { copyToClipboard } from "@/lib/clipboard";
import { readErrorMessage, readErrorName } from "@/lib/errors";
import { useIsTV } from "@/lib/hooks/useIsTV";
import { UserAuthProvider, useUserAuth } from "@/lib/hooks/useUserAuth";
import { userAuth as userAuthApi, userOAuth } from "@/lib/user-api";

type LoginMode = "user" | "admin";

// The public admin sign-in through a Jellyfin-compatible server talks to
// /api/auth directly, like the 2FA step below - a session does not exist yet.
async function jellyfinAuthPost(path: string, body: unknown) {
    const response = await fetch(path, {
        body: JSON.stringify(body),
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        method: "POST",
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
        const error = new Error(data?.message || data?.error || "Could not sign in") as Error & {
            pinNeeded?: boolean;
        };
        error.pinNeeded = data?.pinNeeded === true;
        throw error;
    }
    return data;
}

// The answer of an admin sign-in route as an object. A rate limit or a proxy in
// front of the server can answer an error with plain text or a page of HTML,
// and that must not read as "cannot reach the server" - the status already says
// what happened (see failureLine). A success that is not JSON is another
// matter: it is not a sign-in at all, so it still counts as unreachable.
async function readAuthAnswer(response: Response): Promise<any> {
    const data = await response.json().catch(() => undefined);
    if (data && typeof data === "object") {
        return data;
    }
    if (response.ok) {
        throw new Error("Failed to connect to server");
    }
    return {};
}

// What to tell the person when a sign-in step failed: the server's own words
// when it gave some, otherwise a line chosen by the status.
function failureLine(response: Response, data: any, fallback: string): string {
    if (typeof data?.message === "string" && data.message) {
        return data.message;
    }
    if (response.status === 429) {
        return "Too many sign-in attempts. Please wait a few minutes and try again.";
    }
    if (response.status >= 500) {
        return "The server ran into a problem. Please try again in a moment.";
    }
    return fallback;
}

// Where an admin sign-in that went through the cookies lands. A bearer token
// left in storage by an earlier session is sent with every request and
// outranks the cookies the new sign-in just set, so signing in as another
// account would keep showing the previous one - it is dropped first.
function startAdminSession(token?: string) {
    api.clearToken();
    if (token) {
        localStorage.setItem("slicksync-admin-token", token);
    }
}

function LoginContent() {
    const searchParams = useSearchParams();
    const reduceMotion = useReducedMotion();
    const router = useRouter();
    const { login: userLogin, loginNuvio, loginJellyfin, isAuthenticated } = useUserAuth();
    const isTV = useIsTV();

    // Mode state
    const initialMode = (searchParams.get("mode") as LoginMode) || "user";
    const [mode, setMode] = useState<LoginMode>(initialMode);
    const INSTANCE_TYPE = (process.env.NEXT_PUBLIC_INSTANCE_TYPE || "private") as
        | "public"
        | "private";

    // Admin login state
    const [adminUsername, setAdminUsername] = useState("");
    const [adminPassword, setAdminPassword] = useState("");
    const [adminPasswordVisible, setAdminPasswordVisible] = useState(false);
    const [adminError, setAdminError] = useState<string | null>(null);
    const [adminLoading, setAdminLoading] = useState(false);
    // 2FA step - set only when /login or /private-login responds with
    // requiresTwoFactor (see server/utils/twoFactor.js). pendingToken is a
    // one-shot opaque token, not a session credential - it's useless for
    // anything except completing this one login via /verify-2fa.
    const [twoFactorPendingToken, setTwoFactorPendingToken] = useState<string | null>(null);
    const [twoFactorCode, setTwoFactorCode] = useState("");
    const [twoFactorVerifying, setTwoFactorVerifying] = useState(false);

    // OIDC/SSO - operator-configured via env vars (server/utils/oidc.js), so
    // the only client-side state is "is it configured at all" (from a public
    // config endpoint) plus whatever the callback redirect handed back.
    const [oidcConfigured, setOidcConfigured] = useState(false);
    const [oidcDisplayName, setOidcDisplayName] = useState("SSO");
    const [adminLoginType, setAdminLoginType] = useState<
        "credentials" | "stremio" | "nuvio" | "jellyfin"
    >(
        searchParams.get("linkStremio") === "1" && initialMode === "admin"
            ? "stremio"
            : searchParams.get("linkNuvio") === "1" && initialMode === "admin"
              ? "nuvio"
              : "credentials"
    );
    // User-mode's own provider tab - separate from adminLoginType since a
    // managed User has no "credentials" option (no UUID/password), just
    // Stremio or Nuvio. Shares the same underlying nuvio*/oauth* state below
    // with the admin flows (start/poll mechanics are identical either way,
    // only the exchange step at the end differs by mode).
    // ?app=nuvio / ?app=jellyfin opens on that app - the link a household
    // sends someone whose sign-in needs renewing (signing in here renews it).
    const [userLoginType, setUserLoginType] = useState<"stremio" | "nuvio" | "jellyfin">(
        searchParams.get("app") === "nuvio"
            ? "nuvio"
            : searchParams.get("app") === "jellyfin"
              ? "jellyfin"
              : "stremio"
    );

    // Jellyfin-compatible servers: the person's portal signs in through
    // /public-library, an admin on a public instance through /public-auth.
    const userJellyfinApi: JellyfinSignInApi = userAuthApi.jellyfinSignIn;
    const adminJellyfinApi: JellyfinSignInApi = {
        probe: (serverUrl) => jellyfinAuthPost("/api/public-auth/jellyfin-probe", { serverUrl }),
        quickConnectStatus: (params) =>
            jellyfinAuthPost("/api/public-auth/jellyfin-quick-connect-status", params),
        startQuickConnect: (serverUrl) =>
            jellyfinAuthPost("/api/public-auth/jellyfin-quick-connect", { serverUrl }),
    };
    const handleUserJellyfin = async (credentials: JellyfinCredentials) => {
        const result = await loginJellyfin(credentials as unknown as Record<string, string>);
        if (!result.success) {
            throw new Error(result.error || "Could not sign in");
        }
        router.push("/user");
    };
    const handleAdminJellyfin = async (credentials: JellyfinCredentials) => {
        const data = await jellyfinAuthPost("/api/public-auth/jellyfin-login", credentials);
        startAdminSession(data?.token);
        router.push("/");
    };
    const [checkingAuth, setCheckingAuth] = useState(INSTANCE_TYPE !== "public");

    // Nuvio admin OAuth state - separate from the Stremio OAuth state below
    // since Nuvio's device-code flow needs its own code/deviceNonce/anonToken
    // tracked across start -> poll -> login, unlike Stremio's single-code poll.
    const [nuvioCode, setNuvioCode] = useState<string>("");
    const [nuvioWebUrl, setNuvioWebUrl] = useState<string | null>(null);
    const [_nuvioExpiresAt, setNuvioExpiresAt] = useState<string | null>(null);
    const [_nuvioDeviceNonce, setNuvioDeviceNonce] = useState<string>("");
    const [_nuvioAnonToken, setNuvioAnonToken] = useState<string>("");
    const [isNuvioGenerating, setIsNuvioGenerating] = useState(false);
    const [isNuvioPolling, setIsNuvioPolling] = useState(false);
    const [isNuvioAuthenticating, setIsNuvioAuthenticating] = useState(false);
    const [nuvioError, setNuvioError] = useState<string | null>(null);
    const [nuvioTimeLeft, setNuvioTimeLeft] = useState<string | null>(null);
    const [nuvioCopied, setNuvioCopied] = useState(false);
    const nuvioPollIntervalRef = useRef<number | null>(null);
    const nuvioTimerIntervalRef = useRef<number | null>(null);
    // Guards the auto-generate effect below against retry-storming: on a
    // failed generate (network hiccup, rate limit), isNuvioGenerating resets
    // to false while nuvioCode stays empty, so without this the effect's own
    // dependency change re-fires it immediately, forever, with no backoff -
    // confirmed hitting the rate limiter within seconds while testing this.
    const nuvioAutoStartedRef = useRef(false);
    // Same guard, same reason, for the Stremio auto-generate effect further
    // down - a failed generateOAuthLink() leaves oauthLink empty and
    // isGenerating false, so the effect would otherwise re-fire immediately
    // with no backoff. The always-visible "Refresh" button below is the
    // manual retry path once auto-generate has given up for this tab-visit.
    const stremioAutoStartedRef = useRef(false);

    // OIDC config + handling the redirect back from /api/auth/oidc/callback:
    // ?otp=<pendingToken> means the OIDC identity checked out but this
    // account also has 2FA enabled - drop straight into the code-entry step
    // rather than making them pick "Admin" and hit a password form they
    // don't need. ?oidcError=<message> surfaces a failure the same way a
    // failed password attempt would.
    useEffect(() => {
        fetch("/api/auth/oidc/config")
            .then((r) => r.json())
            .then((data) => {
                setOidcConfigured(!!data.configured);
                if (data.displayName) {
                    setOidcDisplayName(data.displayName);
                }
            })
            .catch(() => undefined);

        const otp = searchParams.get("otp");
        const oidcError = searchParams.get("oidcError");
        if (otp) {
            setMode("admin");
            setAdminLoginType("credentials");
            setTwoFactorPendingToken(otp);
        } else if (oidcError) {
            setMode("admin");
            setAdminLoginType("credentials");
            setAdminError(oidcError);
        }
        // Strip these from the URL so a refresh doesn't resubmit/re-show them.
        if (otp || oidcError) {
            const cleaned = new URLSearchParams(searchParams.toString());
            cleaned.delete("otp");
            cleaned.delete("oidcError");
            router.replace(`/login${cleaned.toString() ? `?${cleaned.toString()}` : ""}`);
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const handleStartOidc = () => {
        // The sign-in finishes on the server and lands straight on the app, so
        // this is the last point where the old token can be dropped.
        api.clearToken();
        window.location.href = "/api/auth/oidc/start";
    };

    // Check if auth is required for private instance
    useEffect(() => {
        if (INSTANCE_TYPE !== "public" && mode === "admin") {
            const checkAuth = async () => {
                try {
                    // Try to access a protected endpoint
                    // If it succeeds, auth is disabled
                    const response = await fetch("/api/ext/account");
                    if (response.ok) {
                        router.push("/");
                    }
                } catch {
                    // Ignore error, show login form
                } finally {
                    setCheckingAuth(false);
                }
            };
            checkAuth();
        } else {
            setCheckingAuth(false);
        }
    }, [INSTANCE_TYPE, router, mode]);

    // User OAuth state
    const [oauthLink, setOAuthLink] = useState<string | null>(null);
    const [oauthCode, setOAuthCode] = useState<string>("");
    const [oauthExpiresAt, setOAuthExpiresAt] = useState<number | null>(null);
    const [isGenerating, setIsGenerating] = useState(false);
    const [isPolling, setIsPolling] = useState(false);
    const [isAuthenticating, setIsAuthenticating] = useState(false);
    const [copied, setCopied] = useState(false);
    const [userError, setUserError] = useState<string | null>(null);
    const [timeLeft, setTimeLeft] = useState<string | null>(null);

    // Refs for cleanup
    const pollIntervalRef = useRef<number | null>(null);
    const timerIntervalRef = useRef<number | null>(null);

    // Check if OAuth is expired
    const isExpired = oauthExpiresAt ? oauthExpiresAt < Date.now() : false;

    // Redirect if already authenticated in user mode
    useEffect(() => {
        if (mode === "user" && isAuthenticated) {
            router.push("/user");
        }
    }, [mode, isAuthenticated, router]);

    // Timer countdown
    useEffect(() => {
        // Timer applies to Stremio login only, in either mode
        const onStremioTab =
            mode === "admin" ? adminLoginType === "stremio" : userLoginType === "stremio";
        if (!oauthExpiresAt || isExpired || !onStremioTab) {
            setTimeLeft(null);
            return;
        }

        const updateTimer = () => {
            const diff = Math.max(0, oauthExpiresAt - Date.now());
            if (diff === 0) {
                setTimeLeft("Expired");
                setIsPolling(false);
                return;
            }
            const minutes = Math.floor(diff / 60_000);
            const seconds = Math.floor((diff % 60_000) / 1000);
            setTimeLeft(`${minutes}:${seconds.toString().padStart(2, "0")}`);
        };

        updateTimer();
        timerIntervalRef.current = window.setInterval(updateTimer, 1000);

        return () => {
            if (timerIntervalRef.current) {
                window.clearInterval(timerIntervalRef.current);
            }
        };
    }, [oauthExpiresAt, isExpired, mode]);

    // Poll for OAuth completion
    useEffect(() => {
        if (!(isPolling && oauthCode) || isExpired || isAuthenticating) {
            return;
        }

        const poll = async () => {
            try {
                const pollResult = await userOAuth.poll(oauthCode);

                if (pollResult.success && pollResult.authKey) {
                    setIsPolling(false);
                    if (pollIntervalRef.current) {
                        window.clearInterval(pollIntervalRef.current);
                    }

                    setIsAuthenticating(true);

                    if (mode === "admin") {
                        // Admin Stremio Login
                        try {
                            const result = await api.stremioLogin(pollResult.authKey);
                            if (result.token || result.account) {
                                if (result.token) {
                                    localStorage.setItem("slicksync-admin-token", result.token);
                                }
                                router.push("/");
                            } else {
                                setAdminError("Failed to link Stremio account to admin");
                                setIsAuthenticating(false);
                            }
                        } catch (err) {
                            setAdminError(readErrorMessage(err, "Stremio login failed"));
                            setIsAuthenticating(false);
                        }
                    } else {
                        // User Stremio Login
                        const authResult = await userLogin(pollResult.authKey);
                        if (authResult.success) {
                            router.push("/user");
                        } else {
                            setUserError(
                                authResult.error || "Failed to authenticate. Please try again."
                            );
                            setIsAuthenticating(false);
                        }
                    }
                } else if (pollResult.error) {
                    if (mode === "admin") {
                        setAdminError(pollResult.error);
                    } else {
                        setUserError(pollResult.error);
                    }
                }
            } catch {
                // Silently handle polling errors
            }
        };

        poll();
        pollIntervalRef.current = window.setInterval(poll, 3000);

        return () => {
            if (pollIntervalRef.current) {
                window.clearInterval(pollIntervalRef.current);
            }
        };
    }, [isPolling, oauthCode, isExpired, isAuthenticating, mode, userLogin, router]);

    // Generate OAuth link
    const generateOAuthLink = useCallback(async () => {
        if (isGenerating) {
            return;
        }

        setIsGenerating(true);
        setAdminError(null);
        setUserError(null);

        try {
            const result = await userOAuth.create();
            setOAuthLink(result.link);
            setOAuthCode(result.code);
            setOAuthExpiresAt(result.expiresAt);
            setIsPolling(true);
        } catch (err) {
            if (mode === "admin") {
                setAdminError(readErrorMessage(err, "Failed to generate link"));
            } else {
                setUserError(readErrorMessage(err, "Failed to generate OAuth link"));
            }
        } finally {
            setIsGenerating(false);
        }
    }, [isGenerating, mode]);

    // Auto-generate OAuth link. Fires at most once per tab-selection - see
    // stremioAutoStartedRef's own comment for why a plain !oauthLink check
    // isn't safe here.
    useEffect(() => {
        // Generate if user mode on the stremio tab, OR admin mode on its stremio tab
        const shouldGenerate =
            (mode === "user" && userLoginType === "stremio") ||
            (mode === "admin" && adminLoginType === "stremio");
        if (!shouldGenerate) {
            stremioAutoStartedRef.current = false;
            return;
        }
        if (!(oauthLink || isGenerating || stremioAutoStartedRef.current)) {
            stremioAutoStartedRef.current = true;
            generateOAuthLink();
        }
    }, [mode, adminLoginType, userLoginType, oauthLink, isGenerating, generateOAuthLink]);

    // Nuvio admin OAuth - kept as one self-contained function (start, countdown,
    // poll, login) rather than split across effects like the Stremio flow
    // above, matching how the same start/poll/exchange sequence is already
    // done in CreateUserModal's Nuvio OAuth step.
    const stopNuvioPolling = useCallback(() => {
        setIsNuvioPolling(false);
        if (nuvioPollIntervalRef.current) {
            window.clearInterval(nuvioPollIntervalRef.current);
            nuvioPollIntervalRef.current = null;
        }
    }, []);

    const startNuvioCountdown = useCallback(
        (expiresAt: string) => {
            if (nuvioTimerIntervalRef.current) {
                window.clearInterval(nuvioTimerIntervalRef.current);
            }
            const update = () => {
                const diff = Math.max(0, new Date(expiresAt).getTime() - Date.now());
                if (diff === 0) {
                    setNuvioTimeLeft("Expired");
                    stopNuvioPolling();
                    if (nuvioTimerIntervalRef.current) {
                        window.clearInterval(nuvioTimerIntervalRef.current);
                        nuvioTimerIntervalRef.current = null;
                    }
                    return;
                }
                const minutes = Math.floor(diff / 60_000);
                const seconds = Math.floor((diff % 60_000) / 1000);
                setNuvioTimeLeft(`${minutes}:${seconds.toString().padStart(2, "0")}`);
            };
            update();
            nuvioTimerIntervalRef.current = window.setInterval(update, 1000);
        },
        [stopNuvioPolling]
    );

    const handleStartNuvioOAuth = useCallback(async () => {
        if (isNuvioGenerating) {
            return;
        }
        setIsNuvioGenerating(true);
        setNuvioError(null);
        try {
            const result =
                mode === "admin" ? await api.startNuvioAdminOAuth() : await userOAuth.createNuvio();
            setNuvioCode(result.code);
            setNuvioWebUrl(result.webUrl);
            setNuvioExpiresAt(result.expiresAt);
            setNuvioDeviceNonce(result.deviceNonce);
            setNuvioAnonToken(result.anonToken);
            setIsNuvioPolling(true);
            startNuvioCountdown(result.expiresAt);

            const intervalMs = Math.max(2, result.pollIntervalSeconds || 3) * 1000;
            nuvioPollIntervalRef.current = window.setInterval(async () => {
                try {
                    const poll =
                        mode === "admin"
                            ? await api.pollNuvioAdminOAuth({
                                  anonToken: result.anonToken,
                                  code: result.code,
                                  deviceNonce: result.deviceNonce,
                              })
                            : await userOAuth.pollNuvio(
                                  result.code,
                                  result.deviceNonce,
                                  result.anonToken
                              );
                    // Status is opaque (passed through from Nuvio's own session state) -
                    // 'pending' means keep waiting; anything else, attempt the login.
                    if (poll.status === "pending") {
                        return;
                    }

                    stopNuvioPolling();
                    if (nuvioTimerIntervalRef.current) {
                        window.clearInterval(nuvioTimerIntervalRef.current);
                        nuvioTimerIntervalRef.current = null;
                    }
                    setIsNuvioAuthenticating(true);

                    if (mode === "admin") {
                        try {
                            const loginResult = await api.nuvioLogin({
                                anonToken: result.anonToken,
                                code: result.code,
                                deviceNonce: result.deviceNonce,
                            });
                            if (loginResult.token || loginResult.account) {
                                router.push("/");
                            } else {
                                setNuvioError("Failed to link Nuvio account to admin");
                                setIsNuvioAuthenticating(false);
                            }
                        } catch (err) {
                            setNuvioError(readErrorMessage(err, "Nuvio login failed"));
                            setIsNuvioAuthenticating(false);
                        }
                    } else {
                        // User Nuvio Login - the completed exchange itself is the proof
                        // of identity (see getPublicUserNuvio server-side), unlike the
                        // admin path which links/creates an AppAccount.
                        const authResult = await loginNuvio(
                            result.code,
                            result.deviceNonce,
                            result.anonToken
                        );
                        if (authResult.success) {
                            router.push("/user");
                        } else {
                            setNuvioError(
                                authResult.error || "Failed to authenticate. Please try again."
                            );
                            setIsNuvioAuthenticating(false);
                        }
                    }
                } catch {
                    // Silently handle polling errors, same as the Stremio flow above
                }
            }, intervalMs);
        } catch (err) {
            setNuvioError(readErrorMessage(err, "Failed to start Nuvio login"));
        } finally {
            setIsNuvioGenerating(false);
        }
    }, [
        isNuvioGenerating,
        router,
        startNuvioCountdown,
        stopNuvioPolling,
        mode,
        loginNuvio,
        userOAuth,
    ]);

    // Auto-generate Nuvio OAuth session when its tab is selected (admin's own
    // tab, or the user-mode equivalent). Fires at most once per tab-selection -
    // see nuvioAutoStartedRef's own comment for why a plain !nuvioCode check
    // isn't safe here. A failed attempt leaves the manual "Generate a new
    // code" button (rendered below whenever nuvioError is set) as the retry
    // path instead.
    useEffect(() => {
        const shouldStart =
            (mode === "admin" && adminLoginType === "nuvio") ||
            (mode === "user" && userLoginType === "nuvio");
        if (!shouldStart) {
            nuvioAutoStartedRef.current = false;
            return;
        }
        if (!(nuvioCode || isNuvioGenerating || nuvioAutoStartedRef.current)) {
            nuvioAutoStartedRef.current = true;
            handleStartNuvioOAuth();
        }
    }, [mode, adminLoginType, userLoginType, nuvioCode, isNuvioGenerating, handleStartNuvioOAuth]);

    // Clean up Nuvio timers on unmount
    useEffect(
        () => () => {
            if (nuvioPollIntervalRef.current) {
                window.clearInterval(nuvioPollIntervalRef.current);
            }
            if (nuvioTimerIntervalRef.current) {
                window.clearInterval(nuvioTimerIntervalRef.current);
            }
        },
        []
    );

    const copyNuvioCode = useCallback(() => {
        if (!nuvioCode) {
            return;
        }
        copyToClipboard(nuvioCode);
        setNuvioCopied(true);
        setTimeout(() => setNuvioCopied(false), 2000);
    }, [nuvioCode]);

    const openNuvioLink = useCallback(() => {
        if (!nuvioWebUrl) {
            return;
        }
        window.open(nuvioWebUrl, "_blank", "noopener,noreferrer");
    }, [nuvioWebUrl]);

    // Handle auto-linking stremio
    useEffect(() => {
        if (searchParams.get("linkStremio") === "1" && oauthLink && !isAuthenticating) {
            window.open(oauthLink, "_blank", "noopener,noreferrer"); // Redirect in a new tab so they don't lose the polling slicksync page
        }
    }, [searchParams, oauthLink, isAuthenticating]);

    // Copy code
    const copyCode = useCallback(() => {
        if (!oauthCode) {
            return;
        }
        copyToClipboard(oauthCode);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    }, [oauthCode]);

    // Open OAuth link
    const openOAuthLink = useCallback(() => {
        if (!oauthLink) {
            return;
        }
        window.open(oauthLink, "_blank", "noopener,noreferrer");
    }, [oauthLink]);

    // Passkey sign-in. Only offered once the server confirms a passkey exists
    // for THIS hostname - a passkey belongs to the address it was made on, so
    // offering the button everywhere would mean a prompt that can only fail.
    const [passkeyAvailable, setPasskeyAvailable] = useState(false);
    const [passkeyLoading, setPasskeyLoading] = useState(false);
    useEffect(() => {
        if (typeof window === "undefined" || !window.PublicKeyCredential) {
            return;
        }
        fetch("/api/public-auth/passkey/options", {
            body: "{}",
            headers: { "Content-Type": "application/json" },
            method: "POST",
        })
            .then((r) => (r.ok ? r.json() : null))
            .then((d) => {
                if (d?.available) {
                    setPasskeyAvailable(true);
                }
            })
            .catch(() => undefined);
    }, []);

    const handlePasskeyLogin = async () => {
        setPasskeyLoading(true);
        setAdminError(null);
        try {
            const { startAuthentication } = await import("@simplewebauthn/browser");
            // A fresh challenge for the real attempt - the one fetched above was
            // only asking whether to show this button, and a challenge is
            // single-use.
            const optionsRes = await fetch("/api/public-auth/passkey/options", {
                body: "{}",
                headers: { "Content-Type": "application/json" },
                method: "POST",
            });
            const optionsData = await optionsRes.json();
            if (!optionsData?.available) {
                setAdminError("No passkey is registered for this address");
                return;
            }
            const credential = await startAuthentication({ optionsJSON: optionsData.options });
            const verifyRes = await fetch("/api/public-auth/passkey/verify", {
                body: JSON.stringify({ challengeId: optionsData.challengeId, credential }),
                headers: { "Content-Type": "application/json" },
                method: "POST",
            });
            const data = await readAuthAnswer(verifyRes);
            if (verifyRes.ok && data.requiresTwoFactor && data.pendingToken) {
                setTwoFactorPendingToken(data.pendingToken);
                setTwoFactorCode("");
                return;
            }
            if (verifyRes.ok && (data.token || data.account)) {
                startAdminSession(data.token);
                router.push("/");
                return;
            }
            setAdminError(failureLine(verifyRes, data, "That passkey was not accepted"));
        } catch (e) {
            // Cancelling the browser prompt is a choice, not an error.
            if (
                readErrorName(e) === "NotAllowedError" ||
                /cancel|abort/i.test(readErrorMessage(e, ""))
            ) {
                return;
            }
            setAdminError(readErrorMessage(e, "Passkey sign-in failed"));
        } finally {
            setPasskeyLoading(false);
        }
    };

    // Admin login
    const handleAdminLogin = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!(adminUsername && adminPassword)) {
            return;
        }

        setAdminLoading(true);
        setAdminError(null);

        try {
            const isPublic = INSTANCE_TYPE === "public";
            const endpoint = isPublic ? "/api/auth/login" : "/api/auth/private-login";
            const payload = isPublic
                ? { password: adminPassword, uuid: adminUsername }
                : { password: adminPassword, username: adminUsername };

            const response = await fetch(endpoint, {
                body: JSON.stringify(payload),
                headers: { "Content-Type": "application/json" },
                method: "POST",
            });

            const data = await readAuthAnswer(response);

            if (response.ok && data.requiresTwoFactor && data.pendingToken) {
                setTwoFactorPendingToken(data.pendingToken);
                setTwoFactorCode("");
            } else if (response.ok && (data.token || data.account)) {
                // Store admin token and redirect
                // Backend returns token in different fields depending on route
                const _token = data.token || response.headers.get("set-cookie");
                startAdminSession(data.token);
                router.push("/");
            } else {
                setAdminError(failureLine(response, data, "Invalid credentials"));
            }
        } catch {
            setAdminError("Failed to connect to server");
        } finally {
            setAdminLoading(false);
        }
    };

    const handleVerify2fa = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!twoFactorPendingToken || twoFactorCode.trim().length < 6) {
            return;
        }

        setTwoFactorVerifying(true);
        setAdminError(null);
        try {
            const response = await fetch("/api/auth/verify-2fa", {
                body: JSON.stringify({
                    code: twoFactorCode.trim(),
                    pendingToken: twoFactorPendingToken,
                }),
                headers: { "Content-Type": "application/json" },
                method: "POST",
            });
            const data = await readAuthAnswer(response);
            if (response.ok && (data.token || data.account)) {
                startAdminSession(data.token);
                router.push("/");
            } else {
                setAdminError(failureLine(response, data, "Incorrect code"));
                // An expired/consumed pendingToken can't be retried - back to the
                // password step rather than looping on a dead token.
                if (response.status === 401) {
                    setTwoFactorPendingToken(null);
                }
            }
        } catch {
            setAdminError("Failed to connect to server");
        } finally {
            setTwoFactorVerifying(false);
        }
    };

    // Time color based on urgency
    const getTimeColor = () => {
        if (!oauthExpiresAt) {
            return "var(--color-text-muted)";
        }
        const diff = oauthExpiresAt - Date.now();
        if (diff < 60_000) {
            return "var(--color-error)";
        }
        if (diff < 120_000) {
            return "var(--color-warning)";
        }
        return "var(--color-text-muted)";
    };

    // Switch mode
    const switchMode = (newMode: LoginMode) => {
        setMode(newMode);
        setAdminError(null);
        setUserError(null);
        setNuvioError(null);
        // Update URL while preserving other search params
        const newParams = new URLSearchParams(searchParams.toString());
        newParams.set("mode", newMode);
        router.replace(`/login?${newParams.toString()}`);
    };

    if (checkingAuth) {
        return (
            <div
                className="interface-login flex min-h-screen items-center justify-center p-6"
                style={{ background: "var(--color-bg)" }}
            >
                <div
                    className="h-8 w-8 animate-spin rounded-full border-2 border-current border-t-transparent"
                    style={{ color: "var(--color-primary)" }}
                />
            </div>
        );
    }

    return (
        <div
            className="interface-login flex min-h-screen items-center justify-center p-6"
            style={{ background: "var(--color-bg)" }}
        >
            <motion.div
                animate={{ opacity: 1, y: 0 }}
                className="relative w-full"
                initial={reduceMotion ? false : { opacity: 0 }}
                style={{ maxWidth: "480px" }}
            >
                <div className="login-intro mb-7 text-center">
                    <div className="mb-7 inline-flex items-center gap-2.5">
                        <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary">
                            <SlickSyncLogo className="h-6 w-6 text-white" />
                        </span>
                        <span className="font-semibold text-base text-default">SlickSync</span>
                    </div>
                    <h1 className="mb-2 font-semibold text-3xl text-default tracking-tight">
                        Welcome back.
                    </h1>
                    <p className="text-muted text-sm">Your media, together. Sign in to continue.</p>
                </div>
                <FilterTabs
                    activeKey={mode}
                    className="mb-5 w-full"
                    fill
                    onChange={(key) => {
                        if (key === "user" || key === "admin") {
                            switchMode(key);
                        }
                    }}
                    options={[
                        { icon: <UserIcon className="h-4 w-4" />, key: "user", label: "Personal" },
                        {
                            icon: <ShieldCheckIcon className="h-4 w-4" />,
                            key: "admin",
                            label: "Admin",
                        },
                    ]}
                />

                {/* Login Card */}
                <motion.div
                    className="interface-login-panel overflow-hidden rounded-2xl"
                    style={{
                        background: "var(--color-surface)",
                        border: "1px solid var(--color-surface-border)",
                    }}
                >
                    <div className="p-6">
                        <AnimatePresence initial={false} mode="wait">
                            {mode === "admin" ? (
                                /* Admin Login Form */
                                <motion.div
                                    animate={{ opacity: 1, x: 0 }}
                                    className="space-y-4"
                                    exit={{ opacity: 0 }}
                                    initial={{ opacity: 0 }}
                                    key="admin"
                                >
                                    {/* Admin Login Type Selector (Public Mode only) */}
                                    {INSTANCE_TYPE === "public" && (
                                        <FilterTabs
                                            activeKey={adminLoginType}
                                            className="login-provider-tabs mb-5 w-full"
                                            fill
                                            onChange={(key) => {
                                                if (
                                                    key === "credentials" ||
                                                    key === "stremio" ||
                                                    key === "nuvio" ||
                                                    key === "jellyfin"
                                                ) {
                                                    setAdminLoginType(key);
                                                }
                                                if (key === "stremio" && !oauthLink) {
                                                    generateOAuthLink();
                                                }
                                                if (key === "nuvio" && !nuvioCode) {
                                                    handleStartNuvioOAuth();
                                                }
                                                if (key === "jellyfin") {
                                                    setAdminError(null);
                                                }
                                            }}
                                            options={[
                                                { key: "credentials", label: "Account" },
                                                { key: "stremio", label: "Stremio" },
                                                { key: "nuvio", label: "Nuvio" },
                                                { key: "jellyfin", label: "Jellyfin" },
                                            ]}
                                        />
                                    )}

                                    {adminLoginType === "jellyfin" ? (
                                        <div className="space-y-4">
                                            <p
                                                className="text-center text-sm"
                                                style={{ color: "var(--color-text-muted)" }}
                                            >
                                                Sign in with your Jellyfin server, or the media
                                                server AIOStreams or AIOMetadata runs.
                                            </p>
                                            <JellyfinSignIn
                                                api={adminJellyfinApi}
                                                compact
                                                onSubmit={handleAdminJellyfin}
                                                submitLabel="Sign in"
                                            />
                                        </div>
                                    ) : adminLoginType === "credentials" &&
                                      twoFactorPendingToken ? (
                                        <form className="space-y-4" onSubmit={handleVerify2fa}>
                                            <p
                                                className="text-center text-sm"
                                                style={{ color: "var(--color-text-muted)" }}
                                            >
                                                Enter the 6-digit code from your authenticator app,
                                                or one of your backup codes.
                                            </p>
                                            <div>
                                                <label
                                                    className="mb-2 block font-medium text-sm"
                                                    htmlFor="twoFactorCode"
                                                    style={{ color: "var(--color-text)" }}
                                                >
                                                    Code
                                                </label>
                                                <input
                                                    autoComplete="one-time-code"
                                                    autoFocus
                                                    className="w-full rounded-xl px-4 py-3 text-center font-mono text-sm tracking-widest transition-all"
                                                    id="twoFactorCode"
                                                    inputMode="numeric"
                                                    onChange={(e) =>
                                                        setTwoFactorCode(
                                                            e.target.value.replace(/\s+/g, "")
                                                        )
                                                    }
                                                    placeholder="123456"
                                                    style={{
                                                        background: "var(--color-bg)",
                                                        border: "1px solid var(--color-surface-border)",
                                                        color: "var(--color-text)",
                                                    }}
                                                    type="text"
                                                    value={twoFactorCode}
                                                />
                                            </div>

                                            {adminError && (
                                                <p
                                                    className="text-center text-sm"
                                                    style={{ color: "var(--color-error)" }}
                                                >
                                                    {adminError}
                                                </p>
                                            )}

                                            <button
                                                className="flex w-full items-center justify-center gap-2 rounded-xl py-3.5 font-medium transition-all"
                                                disabled={
                                                    twoFactorVerifying ||
                                                    twoFactorCode.trim().length < 6
                                                }
                                                style={{
                                                    background: "var(--color-primary)",
                                                    color: "var(--login-action-text)",
                                                    opacity:
                                                        twoFactorVerifying ||
                                                        twoFactorCode.trim().length < 6
                                                            ? 0.5
                                                            : 1,
                                                }}
                                                type="submit"
                                            >
                                                {twoFactorVerifying ? (
                                                    <>
                                                        <span className="h-5 w-5 animate-spin rounded-full border-2 border-current border-t-transparent" />
                                                        Verifying...
                                                    </>
                                                ) : (
                                                    <>
                                                        <ArrowRightIcon className="h-5 w-5" />
                                                        Verify
                                                    </>
                                                )}
                                            </button>

                                            <button
                                                className="w-full text-center text-sm hover:underline"
                                                onClick={() => {
                                                    setTwoFactorPendingToken(null);
                                                    setTwoFactorCode("");
                                                    setAdminError(null);
                                                }}
                                                style={{ color: "var(--color-text-muted)" }}
                                                type="button"
                                            >
                                                Back
                                            </button>
                                        </form>
                                    ) : adminLoginType === "credentials" ? (
                                        <form className="space-y-4" onSubmit={handleAdminLogin}>
                                            <div>
                                                <label
                                                    className="mb-2 block font-medium text-sm"
                                                    htmlFor="username"
                                                    style={{ color: "var(--color-text)" }}
                                                >
                                                    {INSTANCE_TYPE === "public"
                                                        ? "UUID"
                                                        : "Username"}
                                                </label>
                                                <input
                                                    autoComplete={
                                                        INSTANCE_TYPE === "public"
                                                            ? "off"
                                                            : "username"
                                                    }
                                                    className="w-full rounded-xl px-4 py-3 text-sm transition-all"
                                                    id="username"
                                                    onChange={(e) =>
                                                        setAdminUsername(e.target.value)
                                                    }
                                                    placeholder={
                                                        INSTANCE_TYPE === "public"
                                                            ? "00000000-0000-..."
                                                            : "admin"
                                                    }
                                                    style={{
                                                        background: "var(--color-bg)",
                                                        border: "1px solid var(--color-surface-border)",
                                                        color: "var(--color-text)",
                                                    }}
                                                    type="text"
                                                    value={adminUsername}
                                                />
                                            </div>

                                            <div>
                                                <label
                                                    className="mb-2 block font-medium text-sm"
                                                    htmlFor="password"
                                                    style={{ color: "var(--color-text)" }}
                                                >
                                                    Password
                                                </label>
                                                <div className="relative">
                                                    <input
                                                        autoComplete="current-password"
                                                        className="w-full rounded-xl py-3 pr-12 pl-4 text-sm transition-all"
                                                        id="password"
                                                        onChange={(e) =>
                                                            setAdminPassword(e.target.value)
                                                        }
                                                        placeholder="********"
                                                        style={{
                                                            background: "var(--color-bg)",
                                                            border: "1px solid var(--color-surface-border)",
                                                            color: "var(--color-text)",
                                                        }}
                                                        type={
                                                            adminPasswordVisible
                                                                ? "text"
                                                                : "password"
                                                        }
                                                        value={adminPassword}
                                                    />
                                                    <PasswordToggleButton
                                                        onToggle={() =>
                                                            setAdminPasswordVisible((v) => !v)
                                                        }
                                                        visible={adminPasswordVisible}
                                                    />
                                                </div>
                                            </div>

                                            {adminError && (
                                                <motion.p
                                                    animate={{ opacity: 1, y: 0 }}
                                                    className="text-sm"
                                                    initial={{ opacity: 0, y: -5 }}
                                                    style={{ color: "var(--color-error)" }}
                                                >
                                                    {adminError}
                                                </motion.p>
                                            )}

                                            <button
                                                className="flex w-full items-center justify-center gap-2 rounded-xl py-3.5 font-medium transition-all"
                                                disabled={
                                                    adminLoading || !adminUsername || !adminPassword
                                                }
                                                style={{
                                                    background: "var(--color-primary)",
                                                    color: "var(--login-action-text)",
                                                    opacity:
                                                        adminLoading ||
                                                        !adminUsername ||
                                                        !adminPassword
                                                            ? 0.5
                                                            : 1,
                                                }}
                                                type="submit"
                                            >
                                                {adminLoading ? (
                                                    <>
                                                        <span className="h-5 w-5 animate-spin rounded-full border-2 border-current border-t-transparent" />
                                                        Signing in...
                                                    </>
                                                ) : (
                                                    <>
                                                        <ArrowRightIcon className="h-5 w-5" />
                                                        Sign in
                                                    </>
                                                )}
                                            </button>

                                            {passkeyAvailable && (
                                                <button
                                                    className="flex w-full items-center justify-center gap-2 rounded-xl py-3.5 font-medium transition-all"
                                                    disabled={passkeyLoading}
                                                    onClick={handlePasskeyLogin}
                                                    style={{
                                                        background: "transparent",
                                                        border: "1px solid var(--color-surface-border)",
                                                        color: "var(--color-text)",
                                                        opacity: passkeyLoading ? 0.5 : 1,
                                                    }}
                                                    type="button"
                                                >
                                                    <FingerPrintIcon className="h-5 w-5" />
                                                    {passkeyLoading
                                                        ? "Waiting for your device..."
                                                        : "Use a passkey"}
                                                </button>
                                            )}

                                            {oidcConfigured && (
                                                <>
                                                    <div className="flex items-center gap-3">
                                                        <div
                                                            className="h-px flex-1"
                                                            style={{
                                                                background:
                                                                    "var(--color-surface-border)",
                                                            }}
                                                        />
                                                        <span
                                                            className="text-xs uppercase tracking-wider"
                                                            style={{
                                                                color: "var(--color-text-muted)",
                                                            }}
                                                        >
                                                            or
                                                        </span>
                                                        <div
                                                            className="h-px flex-1"
                                                            style={{
                                                                background:
                                                                    "var(--color-surface-border)",
                                                            }}
                                                        />
                                                    </div>
                                                    <button
                                                        className="flex w-full items-center justify-center gap-2 rounded-xl py-3.5 font-medium transition-all"
                                                        onClick={handleStartOidc}
                                                        style={{
                                                            background: "transparent",
                                                            border: "1px solid var(--color-surface-border)",
                                                            color: "var(--color-text)",
                                                        }}
                                                        type="button"
                                                    >
                                                        <ShieldCheckIcon className="h-5 w-5" />
                                                        Continue with {oidcDisplayName}
                                                    </button>
                                                </>
                                            )}

                                            {INSTANCE_TYPE === "public" && (
                                                <p
                                                    className="text-center text-sm"
                                                    style={{ color: "var(--color-text-muted)" }}
                                                >
                                                    Don&apos;t have an account?{" "}
                                                    <button
                                                        className="hover:underline"
                                                        onClick={() => router.push("/register")}
                                                        style={{ color: "var(--color-primary)" }}
                                                        type="button"
                                                    >
                                                        Create one
                                                    </button>
                                                </p>
                                            )}
                                        </form>
                                    ) : adminLoginType === "stremio" ? (
                                        /* Admin Stremio Login UI */
                                        <div className="space-y-4">
                                            <p
                                                className="mb-4 text-center text-sm"
                                                style={{ color: "var(--color-text-muted)" }}
                                            >
                                                Link your Stremio account to your administrator
                                                profile.
                                            </p>

                                            <button
                                                className="flex w-full items-center justify-center gap-2 rounded-xl py-3.5 font-medium transition-all"
                                                disabled={
                                                    !oauthLink || isExpired || isAuthenticating
                                                }
                                                onClick={openOAuthLink}
                                                style={{
                                                    background: "var(--color-primary)",
                                                    color: "var(--login-action-text)",
                                                    opacity:
                                                        !oauthLink || isExpired || isAuthenticating
                                                            ? 0.5
                                                            : 1,
                                                }}
                                                type="button"
                                            >
                                                {isAuthenticating ? (
                                                    <>
                                                        <span className="h-5 w-5 animate-spin rounded-full border-2 border-current border-t-transparent" />
                                                        Verifying...
                                                    </>
                                                ) : isGenerating ? (
                                                    <>
                                                        <span className="h-5 w-5 animate-spin rounded-full border-2 border-current border-t-transparent" />
                                                        Generating Link...
                                                    </>
                                                ) : (
                                                    <>
                                                        <ArrowTopRightOnSquareIcon className="h-5 w-5" />
                                                        Open Stremio
                                                    </>
                                                )}
                                            </button>

                                            {/* TV only: scan with a phone instead of fighting a
                          D-pad remote with window.open() or the manual code
                          below. */}
                                            {isTV && oauthLink && !isExpired && (
                                                <div className="flex flex-col items-center gap-2 pt-2">
                                                    <div
                                                        className="rounded-xl p-3"
                                                        style={{ background: "white" }}
                                                    >
                                                        {/* eslint-disable-next-line @next/next/no-img-element */}
                                                        <img
                                                            alt="Scan with your phone to open Stremio"
                                                            height={160}
                                                            src={`/api/qr?data=${encodeURIComponent(oauthLink)}`}
                                                            width={160}
                                                        />
                                                    </div>
                                                    <p
                                                        className="text-xs"
                                                        style={{ color: "var(--color-text-muted)" }}
                                                    >
                                                        Scan with your phone to continue
                                                    </p>
                                                </div>
                                            )}

                                            {/* Manual code UI reused */}
                                            <div className="space-y-3 pt-2 text-center">
                                                <p
                                                    className="font-medium text-xs"
                                                    style={{ color: "var(--color-text-muted)" }}
                                                >
                                                    Verification Code
                                                </p>
                                                <VerificationCode
                                                    code={oauthCode}
                                                    copied={copied}
                                                    onCopy={copyCode}
                                                />
                                            </div>

                                            {adminError && (
                                                <p
                                                    className="text-center text-sm"
                                                    style={{ color: "var(--color-error)" }}
                                                >
                                                    {adminError}
                                                </p>
                                            )}

                                            {/* Polling indicator reused */}
                                            {isPolling &&
                                                !isExpired &&
                                                !adminError &&
                                                !isAuthenticating && (
                                                    <div className="flex items-center justify-center gap-2 pt-2">
                                                        <div className="flex gap-1">
                                                            {[0, 1, 2].map((i) => (
                                                                <motion.div
                                                                    animate={
                                                                        reduceMotion
                                                                            ? { opacity: 1 }
                                                                            : {
                                                                                  opacity: [
                                                                                      0.4, 1, 0.4,
                                                                                  ],
                                                                                  scale: [
                                                                                      1, 1.3, 1,
                                                                                  ],
                                                                              }
                                                                    }
                                                                    className="h-1.5 w-1.5 rounded-full"
                                                                    key={i}
                                                                    style={{
                                                                        background:
                                                                            "var(--color-success)",
                                                                    }}
                                                                    transition={{
                                                                        delay: i * 0.2,
                                                                        duration: 1,
                                                                        repeat: Number.POSITIVE_INFINITY,
                                                                    }}
                                                                />
                                                            ))}
                                                        </div>
                                                        <span
                                                            className="text-xs"
                                                            style={{
                                                                color: "var(--color-text-muted)",
                                                            }}
                                                        >
                                                            Waiting for authorization...
                                                        </span>
                                                    </div>
                                                )}
                                        </div>
                                    ) : (
                                        /* Admin Nuvio Login UI - same shape as the Stremio panel
                       above, but backed by Nuvio's own device-code fields */
                                        <div className="space-y-4">
                                            <p
                                                className="text-center text-sm"
                                                style={{ color: "var(--color-text-muted)" }}
                                            >
                                                Sign in to the <strong>admin dashboard</strong> with
                                                Nuvio, as an alternative to a UUID and password.
                                            </p>
                                            <p
                                                className="mb-4 text-center text-xs"
                                                style={{ color: "var(--color-text-muted)" }}
                                            >
                                                Looking to connect a user's Nuvio library instead?
                                                Do that from Users, not here.
                                            </p>

                                            <button
                                                className="flex w-full items-center justify-center gap-2 rounded-xl py-3.5 font-medium transition-all"
                                                disabled={
                                                    !nuvioWebUrl ||
                                                    nuvioTimeLeft === "Expired" ||
                                                    isNuvioAuthenticating
                                                }
                                                onClick={openNuvioLink}
                                                style={{
                                                    background: "var(--color-primary)",
                                                    color: "var(--login-action-text)",
                                                    opacity:
                                                        !nuvioWebUrl ||
                                                        nuvioTimeLeft === "Expired" ||
                                                        isNuvioAuthenticating
                                                            ? 0.5
                                                            : 1,
                                                }}
                                                type="button"
                                            >
                                                {isNuvioAuthenticating ? (
                                                    <>
                                                        <span className="h-5 w-5 animate-spin rounded-full border-2 border-current border-t-transparent" />
                                                        Verifying...
                                                    </>
                                                ) : isNuvioGenerating ? (
                                                    <>
                                                        <span className="h-5 w-5 animate-spin rounded-full border-2 border-current border-t-transparent" />
                                                        Generating Link...
                                                    </>
                                                ) : (
                                                    <>
                                                        <ArrowTopRightOnSquareIcon className="h-5 w-5" />
                                                        Open Nuvio
                                                    </>
                                                )}
                                            </button>

                                            {/* TV only: scan with a phone instead of typing the
                          code below with a D-pad remote. */}
                                            {isTV && nuvioWebUrl && nuvioTimeLeft !== "Expired" && (
                                                <div className="flex flex-col items-center gap-2 pt-2">
                                                    <div
                                                        className="rounded-xl p-3"
                                                        style={{ background: "white" }}
                                                    >
                                                        {/* eslint-disable-next-line @next/next/no-img-element */}
                                                        <img
                                                            alt="Scan with your phone to open Nuvio"
                                                            height={160}
                                                            src={`/api/qr?data=${encodeURIComponent(nuvioWebUrl)}`}
                                                            width={160}
                                                        />
                                                    </div>
                                                    <p
                                                        className="text-xs"
                                                        style={{ color: "var(--color-text-muted)" }}
                                                    >
                                                        Scan with your phone to continue
                                                    </p>
                                                </div>
                                            )}

                                            <div className="space-y-3 pt-2 text-center">
                                                <p
                                                    className="font-medium text-xs"
                                                    style={{ color: "var(--color-text-muted)" }}
                                                >
                                                    Verification Code
                                                </p>
                                                <VerificationCode
                                                    code={nuvioCode}
                                                    copied={nuvioCopied}
                                                    onCopy={copyNuvioCode}
                                                />
                                                {nuvioTimeLeft && (
                                                    <p
                                                        className="text-xs"
                                                        style={{ color: "var(--color-text-muted)" }}
                                                    >
                                                        {nuvioTimeLeft === "Expired"
                                                            ? "Expired"
                                                            : `Expires in ${nuvioTimeLeft}`}
                                                    </p>
                                                )}
                                            </div>

                                            {nuvioError && (
                                                <p
                                                    className="text-center text-sm"
                                                    style={{ color: "var(--color-error)" }}
                                                >
                                                    {nuvioError}
                                                </p>
                                            )}

                                            {(nuvioTimeLeft === "Expired" || nuvioError) &&
                                                !isNuvioGenerating && (
                                                    <button
                                                        className="w-full text-center text-sm hover:underline"
                                                        onClick={handleStartNuvioOAuth}
                                                        style={{ color: "var(--color-primary)" }}
                                                        type="button"
                                                    >
                                                        Generate a new code
                                                    </button>
                                                )}

                                            {isNuvioPolling &&
                                                nuvioTimeLeft !== "Expired" &&
                                                !nuvioError &&
                                                !isNuvioAuthenticating && (
                                                    <div className="flex items-center justify-center gap-2 pt-2">
                                                        <div className="flex gap-1">
                                                            {[0, 1, 2].map((i) => (
                                                                <motion.div
                                                                    animate={
                                                                        reduceMotion
                                                                            ? { opacity: 1 }
                                                                            : {
                                                                                  opacity: [
                                                                                      0.4, 1, 0.4,
                                                                                  ],
                                                                                  scale: [
                                                                                      1, 1.3, 1,
                                                                                  ],
                                                                              }
                                                                    }
                                                                    className="h-1.5 w-1.5 rounded-full"
                                                                    key={i}
                                                                    style={{
                                                                        background:
                                                                            "var(--color-success)",
                                                                    }}
                                                                    transition={{
                                                                        delay: i * 0.2,
                                                                        duration: 1,
                                                                        repeat: Number.POSITIVE_INFINITY,
                                                                    }}
                                                                />
                                                            ))}
                                                        </div>
                                                        <span
                                                            className="text-xs"
                                                            style={{
                                                                color: "var(--color-text-muted)",
                                                            }}
                                                        >
                                                            Waiting for authorization...
                                                        </span>
                                                    </div>
                                                )}
                                        </div>
                                    )}
                                </motion.div>
                            ) : (
                                /* User OAuth */
                                <motion.div
                                    animate={{ opacity: 1, x: 0 }}
                                    className="space-y-4"
                                    exit={{ opacity: 0 }}
                                    initial={{ opacity: 0 }}
                                    key="user"
                                >
                                    {/* Provider switcher */}
                                    <div className="mb-5 space-y-2">
                                        <p className="font-medium text-muted text-xs">
                                            Choose your service
                                        </p>
                                        <FilterTabs
                                            activeKey={userLoginType}
                                            className="login-provider-tabs w-full"
                                            fill
                                            onChange={(key) => {
                                                if (
                                                    key === "stremio" ||
                                                    key === "nuvio" ||
                                                    key === "jellyfin"
                                                ) {
                                                    setUserLoginType(key);
                                                }
                                                if (key === "stremio" && !oauthLink) {
                                                    generateOAuthLink();
                                                }
                                                if (key === "nuvio" && !nuvioCode) {
                                                    handleStartNuvioOAuth();
                                                }
                                            }}
                                            options={[
                                                { key: "stremio", label: "Stremio" },
                                                { key: "nuvio", label: "Nuvio" },
                                                { key: "jellyfin", label: "Jellyfin" },
                                            ]}
                                        />
                                    </div>

                                    {userLoginType === "jellyfin" ? (
                                        <>
                                            <p
                                                className="mb-4 text-center text-sm"
                                                style={{ color: "var(--color-text-muted)" }}
                                            >
                                                Sign in with the server you watch on - Jellyfin, or
                                                the media server AIOStreams or AIOMetadata runs for
                                                your apps.
                                            </p>
                                            <JellyfinSignIn
                                                api={userJellyfinApi}
                                                compact
                                                onSubmit={handleUserJellyfin}
                                                submitLabel="Sign in"
                                            />
                                        </>
                                    ) : userLoginType === "stremio" ? (
                                        <>
                                            <p
                                                className="mb-4 text-center text-sm"
                                                style={{ color: "var(--color-text-muted)" }}
                                            >
                                                Sign in with your Stremio account to access your
                                                library and settings.
                                            </p>

                                            {/* Open Stremio Button */}
                                            <button
                                                className="flex w-full items-center justify-center gap-2 rounded-xl py-3.5 font-medium transition-all"
                                                disabled={
                                                    !oauthLink || isExpired || isAuthenticating
                                                }
                                                onClick={openOAuthLink}
                                                style={{
                                                    background: "var(--color-primary)",
                                                    color: "var(--login-action-text)",
                                                    opacity:
                                                        !oauthLink || isExpired || isAuthenticating
                                                            ? 0.5
                                                            : 1,
                                                }}
                                                type="button"
                                            >
                                                {isAuthenticating ? (
                                                    <>
                                                        <span className="h-5 w-5 animate-spin rounded-full border-2 border-current border-t-transparent" />
                                                        Signing in...
                                                    </>
                                                ) : isGenerating ? (
                                                    <>
                                                        <span className="h-5 w-5 animate-spin rounded-full border-2 border-current border-t-transparent" />
                                                        Generating Link...
                                                    </>
                                                ) : (
                                                    <>
                                                        <ArrowTopRightOnSquareIcon className="h-5 w-5" />
                                                        Open Stremio
                                                    </>
                                                )}
                                            </button>

                                            {/* TV only: scan with a phone instead of fighting a D-pad
                      remote with window.open() or the manual code below. */}
                                            {isTV && oauthLink && !isExpired && (
                                                <div className="flex flex-col items-center gap-2">
                                                    <div
                                                        className="rounded-xl p-3"
                                                        style={{ background: "white" }}
                                                    >
                                                        {/* eslint-disable-next-line @next/next/no-img-element */}
                                                        <img
                                                            alt="Scan with your phone to open Stremio"
                                                            height={160}
                                                            src={`/api/qr?data=${encodeURIComponent(oauthLink)}`}
                                                            width={160}
                                                        />
                                                    </div>
                                                    <p
                                                        className="text-xs"
                                                        style={{ color: "var(--color-text-muted)" }}
                                                    >
                                                        Scan with your phone to continue
                                                    </p>
                                                </div>
                                            )}

                                            {/* Divider */}
                                            <div className="flex items-center gap-3">
                                                <div
                                                    className="h-px flex-1"
                                                    style={{
                                                        background: "var(--color-surface-border)",
                                                    }}
                                                />
                                                <span
                                                    className="text-xs uppercase tracking-wider"
                                                    style={{ color: "var(--color-text-muted)" }}
                                                >
                                                    or
                                                </span>
                                                <div
                                                    className="h-px flex-1"
                                                    style={{
                                                        background: "var(--color-surface-border)",
                                                    }}
                                                />
                                            </div>

                                            {/* Manual code */}
                                            <div className="space-y-3 text-center">
                                                <p
                                                    className="text-sm"
                                                    style={{ color: "var(--color-text-muted)" }}
                                                >
                                                    Copy the code and paste it at{" "}
                                                    <a
                                                        className="underline hover:no-underline"
                                                        href="https://link.stremio.com"
                                                        rel="noopener noreferrer"
                                                        style={{ color: "var(--color-primary)" }}
                                                        target="_blank"
                                                    >
                                                        link.stremio.com
                                                    </a>
                                                </p>

                                                <VerificationCode
                                                    code={oauthCode}
                                                    copied={copied}
                                                    onCopy={copyCode}
                                                />
                                            </div>

                                            {/* Timer and refresh */}
                                            <div className="flex items-center justify-center gap-4 pt-2">
                                                {timeLeft && (
                                                    <span
                                                        className="font-mono text-sm"
                                                        style={{ color: getTimeColor() }}
                                                    >
                                                        {timeLeft}
                                                    </span>
                                                )}
                                                <button
                                                    className="flex items-center gap-1 text-sm transition-all hover:underline"
                                                    disabled={isGenerating}
                                                    onClick={generateOAuthLink}
                                                    style={{ color: "var(--color-text-muted)" }}
                                                    type="button"
                                                >
                                                    <ArrowPathIcon
                                                        className={`h-4 w-4 ${isGenerating ? "animate-spin" : ""}`}
                                                    />
                                                    Refresh
                                                </button>
                                            </div>

                                            {/* Error */}
                                            {userError && (
                                                <motion.p
                                                    animate={{ opacity: 1, y: 0 }}
                                                    className="text-center text-sm"
                                                    initial={{ opacity: 0, y: -5 }}
                                                    style={{ color: "var(--color-error)" }}
                                                >
                                                    {userError}
                                                </motion.p>
                                            )}

                                            {/* Polling indicator */}
                                            {isPolling &&
                                                !isExpired &&
                                                !userError &&
                                                !isAuthenticating && (
                                                    <div className="flex items-center justify-center gap-2">
                                                        <div className="flex gap-1">
                                                            {[0, 1, 2].map((i) => (
                                                                <motion.div
                                                                    animate={
                                                                        reduceMotion
                                                                            ? { opacity: 1 }
                                                                            : {
                                                                                  opacity: [
                                                                                      0.4, 1, 0.4,
                                                                                  ],
                                                                                  scale: [
                                                                                      1, 1.3, 1,
                                                                                  ],
                                                                              }
                                                                    }
                                                                    className="h-1.5 w-1.5 rounded-full"
                                                                    key={i}
                                                                    style={{
                                                                        background:
                                                                            "var(--color-success)",
                                                                    }}
                                                                    transition={{
                                                                        delay: i * 0.2,
                                                                        duration: 1,
                                                                        repeat: Number.POSITIVE_INFINITY,
                                                                    }}
                                                                />
                                                            ))}
                                                        </div>
                                                        <span
                                                            className="text-xs"
                                                            style={{
                                                                color: "var(--color-text-muted)",
                                                            }}
                                                        >
                                                            Waiting for authorization...
                                                        </span>
                                                    </div>
                                                )}
                                        </>
                                    ) : (
                                        <>
                                            <p
                                                className="text-center text-sm"
                                                style={{ color: "var(--color-text-muted)" }}
                                            >
                                                Sign in with <strong>your own</strong> Nuvio account
                                                to watch here and share it with your group.
                                            </p>
                                            <p
                                                className="mb-4 text-center text-xs"
                                                style={{ color: "var(--color-text-muted)" }}
                                            >
                                                Your library and watch history will be ready after
                                                you approve access.
                                            </p>

                                            <button
                                                className="flex w-full items-center justify-center gap-2 rounded-xl py-3.5 font-medium transition-all"
                                                disabled={
                                                    !nuvioWebUrl ||
                                                    nuvioTimeLeft === "Expired" ||
                                                    isNuvioAuthenticating
                                                }
                                                onClick={openNuvioLink}
                                                style={{
                                                    background: "var(--color-primary)",
                                                    color: "var(--login-action-text)",
                                                    opacity:
                                                        !nuvioWebUrl ||
                                                        nuvioTimeLeft === "Expired" ||
                                                        isNuvioAuthenticating
                                                            ? 0.5
                                                            : 1,
                                                }}
                                                type="button"
                                            >
                                                {isNuvioAuthenticating ? (
                                                    <>
                                                        <span className="h-5 w-5 animate-spin rounded-full border-2 border-current border-t-transparent" />
                                                        Signing in...
                                                    </>
                                                ) : isNuvioGenerating ? (
                                                    <>
                                                        <span className="h-5 w-5 animate-spin rounded-full border-2 border-current border-t-transparent" />
                                                        Generating Link...
                                                    </>
                                                ) : (
                                                    <>
                                                        <ArrowTopRightOnSquareIcon className="h-5 w-5" />
                                                        Open Nuvio
                                                    </>
                                                )}
                                            </button>

                                            {/* TV only: scan with a phone instead of typing the code
                      below with a D-pad remote. */}
                                            {isTV && nuvioWebUrl && nuvioTimeLeft !== "Expired" && (
                                                <div className="flex flex-col items-center gap-2">
                                                    <div
                                                        className="rounded-xl p-3"
                                                        style={{ background: "white" }}
                                                    >
                                                        {/* eslint-disable-next-line @next/next/no-img-element */}
                                                        <img
                                                            alt="Scan with your phone to open Nuvio"
                                                            height={160}
                                                            src={`/api/qr?data=${encodeURIComponent(nuvioWebUrl)}`}
                                                            width={160}
                                                        />
                                                    </div>
                                                    <p
                                                        className="text-xs"
                                                        style={{ color: "var(--color-text-muted)" }}
                                                    >
                                                        Scan with your phone to continue
                                                    </p>
                                                </div>
                                            )}

                                            <div className="space-y-3 pt-2 text-center">
                                                <p
                                                    className="font-medium text-xs"
                                                    style={{ color: "var(--color-text-muted)" }}
                                                >
                                                    Verification Code
                                                </p>
                                                <VerificationCode
                                                    code={nuvioCode}
                                                    copied={nuvioCopied}
                                                    onCopy={copyNuvioCode}
                                                />
                                                {nuvioTimeLeft && (
                                                    <p
                                                        className="text-xs"
                                                        style={{ color: "var(--color-text-muted)" }}
                                                    >
                                                        {nuvioTimeLeft === "Expired"
                                                            ? "Expired"
                                                            : `Expires in ${nuvioTimeLeft}`}
                                                    </p>
                                                )}
                                            </div>

                                            {nuvioError && (
                                                <p
                                                    className="text-center text-sm"
                                                    style={{ color: "var(--color-error)" }}
                                                >
                                                    {nuvioError}
                                                </p>
                                            )}

                                            {(nuvioTimeLeft === "Expired" || nuvioError) &&
                                                !isNuvioGenerating && (
                                                    <button
                                                        className="w-full text-center text-sm hover:underline"
                                                        onClick={handleStartNuvioOAuth}
                                                        style={{ color: "var(--color-primary)" }}
                                                        type="button"
                                                    >
                                                        Generate a new code
                                                    </button>
                                                )}

                                            {isNuvioPolling &&
                                                nuvioTimeLeft !== "Expired" &&
                                                !nuvioError &&
                                                !isNuvioAuthenticating && (
                                                    <div className="flex items-center justify-center gap-2 pt-2">
                                                        <div className="flex gap-1">
                                                            {[0, 1, 2].map((i) => (
                                                                <motion.div
                                                                    animate={
                                                                        reduceMotion
                                                                            ? { opacity: 1 }
                                                                            : {
                                                                                  opacity: [
                                                                                      0.4, 1, 0.4,
                                                                                  ],
                                                                                  scale: [
                                                                                      1, 1.3, 1,
                                                                                  ],
                                                                              }
                                                                    }
                                                                    className="h-1.5 w-1.5 rounded-full"
                                                                    key={i}
                                                                    style={{
                                                                        background:
                                                                            "var(--color-success)",
                                                                    }}
                                                                    transition={{
                                                                        delay: i * 0.2,
                                                                        duration: 1,
                                                                        repeat: Number.POSITIVE_INFINITY,
                                                                    }}
                                                                />
                                                            ))}
                                                        </div>
                                                        <span
                                                            className="text-xs"
                                                            style={{
                                                                color: "var(--color-text-muted)",
                                                            }}
                                                        >
                                                            Waiting for authorization...
                                                        </span>
                                                    </div>
                                                )}
                                        </>
                                    )}
                                </motion.div>
                            )}
                        </AnimatePresence>
                    </div>
                </motion.div>

                {/* Footer */}
                <p
                    className="mt-6 text-center text-sm"
                    style={{ color: "var(--color-text-muted)" }}
                >
                    {mode === "user"
                        ? "Sign in to access your library and share with your group."
                        : "Admin access for managing users, groups, and addons."}
                </p>
            </motion.div>
        </div>
    );
}

export default function LoginPage() {
    return (
        <UserAuthProvider>
            <Suspense
                fallback={
                    <div
                        className="flex min-h-screen items-center justify-center"
                        style={{ background: "var(--color-bg)" }}
                    >
                        <div
                            className="h-8 w-8 animate-spin rounded-full border-2 border-current border-t-transparent"
                            style={{ color: "var(--color-primary)" }}
                        />
                    </div>
                }
            >
                <LoginContent />
            </Suspense>
        </UserAuthProvider>
    );
}
