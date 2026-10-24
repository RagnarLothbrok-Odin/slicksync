"use client";

import { Dialog, DialogPanel, DialogTitle } from "@headlessui/react";
import {
    ArrowPathIcon,
    CheckIcon,
    ClipboardIcon,
    ClockIcon,
    UsersIcon,
    XMarkIcon,
} from "@heroicons/react/24/outline";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { useEffect, useId, useRef, useState } from "react";
import JellyfinSignIn, {
    type JellyfinCredentials,
    type JellyfinServerInfo,
    type JellyfinSignInApi,
} from "@/components/jellyfin/JellyfinSignIn";
import { Button, PasswordToggleButton, SlickSyncLogo } from "@/components/ui";
import { toast } from "@/components/ui/Toast";
import { api } from "@/lib/api";
import { copyToClipboard } from "@/lib/clipboard";
import { readErrorMessage } from "@/lib/errors";
import { useIsTV } from "@/lib/hooks/useIsTV";

// Provider sign-in and reconnect share the same flow and account handlers.
export function CreateUserModal({
    isOpen,
    onClose,
    mode = "create",
    userId,
    userName,
    onReconnectSuccess,
    providerType,
}: {
    isOpen: boolean;
    onClose: () => void;
    mode?: "create" | "reconnect";
    userId?: string;
    userName?: string;
    onReconnectSuccess?: () => void;
    /** The provider of the user being reconnected; a Jellyfin login reconnects through its own sign-in. */
    providerType?: string;
}) {
    const fieldId1 = useId();
    const isReconnect = mode === "reconnect";
    const isJellyfinReconnect = isReconnect && providerType === "jellyfin";
    // A Nuvio person signs in to Nuvio again - never offered Stremio's options.
    const isNuvioReconnect = isReconnect && providerType === "nuvio";
    const isTV = useIsTV();
    const reduceMotion = useReducedMotion();
    const [step, setStep] = useState<"tabs" | "oauth" | "success" | "nuvio-oauth">("tabs");
    const [provider, setProvider] = useState<"stremio" | "nuvio" | "jellyfin">("stremio");
    // Jellyfin: the name the person gets here (their server name if left
    // empty), and the server last used, so a household can be added one
    // person after another without retyping the address.
    const [jellyfinDisplayName, setJellyfinDisplayName] = useState("");
    const [jellyfinServer, setJellyfinServer] = useState<JellyfinServerInfo | null>(null);
    const [jellyfinAdded, setJellyfinAdded] = useState<
        { id: string; username: string; household: { name: string; status: string }[] }[]
    >([]);
    const [jellyfinFormKey, setJellyfinFormKey] = useState(0);
    const [authMethod, setAuthMethod] = useState<"credentials" | "authKey" | "oauth">("oauth");

    // Shared identity fields
    const [username, setUsername] = useState("");
    const [email, setEmail] = useState("");

    // Auth key field
    const [authKey, setAuthKey] = useState("");
    const [password, setPassword] = useState("");
    const [passwordVisible, setPasswordVisible] = useState(false);
    const [authKeyVisible, setAuthKeyVisible] = useState(false);

    // Credentials only - register new Stremio account
    const [registerNew, setRegisterNew] = useState(false);

    // OAuth flow state
    const [_oauthCode, setOauthCode] = useState<string | null>(null);
    const [oauthLink, setOauthLink] = useState<string | null>(null);
    const [_oauthExpiresAt, setOauthExpiresAt] = useState<string | null>(null);
    const [oauthStatus, setOauthStatus] = useState<
        "idle" | "connecting" | "waiting" | "completed" | "error"
    >("idle");
    const [oauthError, setOauthError] = useState<string | null>(null);
    const [countdown, setCountdown] = useState<number>(0);

    const pollIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
    const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null);

    const [isSubmitting, setIsSubmitting] = useState(false);

    // --- Nuvio-specific state (kept separate from Stremio fields above) ---
    const [nuvioAuthMethod, setNuvioAuthMethod] = useState<"credentials" | "oauth">("oauth");
    const [nuvioEmail, setNuvioEmail] = useState("");
    const [nuvioPassword, setNuvioPassword] = useState("");
    const [nuvioPasswordVisible, setNuvioPasswordVisible] = useState(false);
    const [nuvioOauthStatus, setNuvioOauthStatus] = useState<
        "idle" | "connecting" | "waiting" | "completed" | "error"
    >("idle");
    const [nuvioOauthError, setNuvioOauthError] = useState<string | null>(null);
    const [nuvioWebUrl, setNuvioWebUrl] = useState<string | null>(null);
    const [nuvioCode, setNuvioCode] = useState<string | null>(null);
    const [_nuvioDeviceNonce, setNuvioDeviceNonce] = useState<string | null>(null);
    const [_nuvioAnonToken, setNuvioAnonToken] = useState<string | null>(null);
    const [_nuvioExpiresAt, setNuvioExpiresAt] = useState<string | null>(null);
    const [nuvioCountdown, setNuvioCountdown] = useState<number>(0);
    const nuvioPollRef = useRef<ReturnType<typeof setInterval> | null>(null);
    const nuvioCountdownRef = useRef<ReturnType<typeof setInterval> | null>(null);

    // Reset state when modal closes
    useEffect(() => {
        if (!isOpen) {
            setTimeout(() => {
                setStep("tabs");
                setProvider("stremio");
                setAuthMethod("oauth");
                setUsername("");
                setEmail("");
                setAuthKey("");
                setPassword("");
                setRegisterNew(false);
                setOauthCode(null);
                setOauthLink(null);
                setOauthExpiresAt(null);
                setOauthStatus("idle");
                setOauthError(null);
                setCountdown(0);
                stopPolling();
                if (countdownRef.current) {
                    clearInterval(countdownRef.current);
                }
                // Jellyfin reset
                setJellyfinDisplayName("");
                setJellyfinServer(null);
                setJellyfinAdded([]);
                // Nuvio reset
                setNuvioAuthMethod("oauth");
                setNuvioEmail("");
                setNuvioPassword("");
                setNuvioOauthStatus("idle");
                setNuvioOauthError(null);
                setNuvioWebUrl(null);
                setNuvioCode(null);
                setNuvioDeviceNonce(null);
                setNuvioAnonToken(null);
                setNuvioExpiresAt(null);
                setNuvioCountdown(0);
                if (nuvioPollRef.current) {
                    clearInterval(nuvioPollRef.current);
                }
                if (nuvioCountdownRef.current) {
                    clearInterval(nuvioCountdownRef.current);
                }
            }, 300);
        }
    }, [isOpen]);

    // Clean up polling on unmount
    useEffect(
        () => () => {
            if (pollIntervalRef.current) {
                clearInterval(pollIntervalRef.current);
            }
            if (countdownRef.current) {
                clearInterval(countdownRef.current);
            }
            if (nuvioPollRef.current) {
                clearInterval(nuvioPollRef.current);
            }
            if (nuvioCountdownRef.current) {
                clearInterval(nuvioCountdownRef.current);
            }
        },
        []
    );

    // Every way of adding someone ends here: a moment on the success step,
    // then their page.
    const finishAdding = (created: any) => {
        setStep("success");
        setTimeout(() => {
            onClose();
            if (created?.id) {
                window.location.href = `/users/${created.id}`;
            } else {
                window.location.reload();
            }
        }, 800);
    };

    const stopPolling = () => {
        if (pollIntervalRef.current) {
            clearInterval(pollIntervalRef.current);
            pollIntervalRef.current = null;
        }
    };

    const startCountdown = (expiresAt: string) => {
        if (countdownRef.current) {
            clearInterval(countdownRef.current);
        }

        const updateCountdown = () => {
            const remaining = Math.max(
                0,
                Math.floor((new Date(expiresAt).getTime() - Date.now()) / 1000)
            );
            setCountdown(remaining);
            if (remaining <= 0 && countdownRef.current) {
                clearInterval(countdownRef.current);
            }
        };

        updateCountdown();
        countdownRef.current = setInterval(updateCountdown, 1000);
    };

    const startPolling = (code: string, expiresAt?: string | null) => {
        stopPolling();
        setOauthStatus("waiting");

        const expiryTime = expiresAt ? new Date(expiresAt).getTime() : null;

        pollIntervalRef.current = setInterval(async () => {
            try {
                if (expiryTime && Date.now() > expiryTime) {
                    stopPolling();
                    setOauthStatus("error");
                    setOauthError("Link expired. Please try again.");
                    return;
                }

                const result = await api.pollStremioOAuth(code);
                if (!(result.success && result.authKey)) {
                    return;
                }

                stopPolling();
                setOauthStatus("completed");
                setOauthError(null);

                if (isReconnect && userId) {
                    // Auto-reconnect when OAuth completes
                    try {
                        await api.connectUserStremioWithAuthKey(userId, result.authKey);
                        toast.success("Reconnected successfully");
                        if (onReconnectSuccess) {
                            onReconnectSuccess();
                        }
                    } catch (err) {
                        console.error("Failed to reconnect:", err);
                        setOauthStatus("error");
                        setOauthError(readErrorMessage(err, "Failed to reconnect"));
                    }
                } else {
                    // Added straight away: the server names them after their Stremio
                    // account (a number on the end if someone here has it already),
                    // and the name can be changed later on their page.
                    try {
                        finishAdding(
                            await api.createUserWithStremio({
                                authKey: result.authKey,
                                email: "",
                                username: "",
                            })
                        );
                    } catch (err) {
                        setOauthStatus("error");
                        setOauthError(readErrorMessage(err, "Could not add them"));
                    }
                }
            } catch (err) {
                console.error("Error while polling Stremio OAuth:", err);
                stopPolling();
                setOauthStatus("error");
                setOauthError(readErrorMessage(err, "Connection failed"));
            }
        }, 2500);
    };

    const handleStartOAuth = async () => {
        setOauthStatus("connecting");
        setOauthError(null);
        // Open the tab synchronously, in the same tick as the click, before any
        // await - Safari (especially iOS) only treats window.open as part of the
        // original tap if there's no async gap first; once you await an API
        // call before calling it, Safari silently opens/leaves a blank tab
        // instead of navigating it. Point this pre-opened tab at the real link
        // once the API call resolves instead of opening a fresh one then.
        //
        // Deliberately WITHOUT 'noopener' here: per spec, window.open() returns
        // null whenever noopener is set, so passing it meant this always got a
        // null reference - the blank tab opened and then nothing ever navigated
        // it, and the post-await fallback below fired outside the user gesture
        // where the browser blocks it. That is exactly the reported "first click
        // opens a blank page with no URL, second click works". The opener is
        // severed manually below instead, which keeps the reverse-tabnabbing
        // protection noopener was there for.
        const preOpenedTab = typeof window === "undefined" ? null : window.open("", "_blank");
        if (preOpenedTab) {
            // Sever the back-reference while the tab is still blank/same-origin,
            // before the external OAuth page loads into it.
            try {
                preOpenedTab.opener = null;
            } catch {
                /* cross-origin guard */
            }
        }
        try {
            const data = await api.generateStremioOAuth();
            if (!(data?.code && data?.link)) {
                throw new Error("Failed to generate link");
            }

            setOauthCode(data.code);
            setOauthLink(data.link);
            setOauthExpiresAt(data.expiresAt || null);

            if (data.expiresAt) {
                startCountdown(data.expiresAt);
            }

            if (preOpenedTab) {
                preOpenedTab.location.href = data.link;
            } else if (typeof window !== "undefined") {
                window.open(data.link, "_blank", "noopener,noreferrer");
            }

            startPolling(data.code, data.expiresAt || null);
        } catch (err) {
            console.error("Failed to start Stremio OAuth:", err);
            setOauthStatus("error");
            setOauthError(readErrorMessage(err, "Failed to connect"));
            preOpenedTab?.close();
        }
    };

    const handleSubmit = async () => {
        if (isReconnect) {
            if (!userId) {
                toast.error("Choose a user before reconnecting");
                return;
            }
            // Reconnect mode - manual entry
            if (!(email && password)) {
                toast.error("Email and password are required");
                return;
            }
            setIsSubmitting(true);
            try {
                await api.connectUserStremio(userId, {
                    email: email.trim(),
                    password,
                });
                toast.success("Reconnected successfully");
                if (onReconnectSuccess) {
                    onReconnectSuccess();
                }
            } catch (err) {
                toast.error(readErrorMessage(err, "Failed to reconnect"));
            } finally {
                setIsSubmitting(false);
            }
            return;
        }

        // Create mode. An empty name is fine: the server takes the account's own.
        setIsSubmitting(true);
        try {
            let created: any;
            if (authMethod === "authKey") {
                // Auth Key method
                if (!authKey.trim()) {
                    toast.error("Auth key is required");
                    setIsSubmitting(false);
                    return;
                }
                created = await api.createUserWithStremio({
                    authKey: authKey.trim(),
                    email: (email || "").trim(),
                    username: username.trim(),
                });
            } else if (authMethod === "credentials") {
                // Credentials method (email/password)
                if (!(email.trim() && password)) {
                    toast.error("Email and password are required");
                    setIsSubmitting(false);
                    return;
                }
                created = await api.createUserWithCredentials({
                    email: email.trim(),
                    password,
                    registerNew,
                    username: username.trim(),
                });
            }
            finishAdding(created);
        } catch (err) {
            toast.error(readErrorMessage(err, "Failed to create user"));
        } finally {
            setIsSubmitting(false);
        }
    };

    const formatCountdown = (seconds: number) => {
        const m = Math.floor(seconds / 60);
        const s = seconds % 60;
        return `${m}:${s.toString().padStart(2, "0")}`;
    };

    // --- Nuvio handlers ---

    const stopNuvioPolling = () => {
        if (nuvioPollRef.current) {
            clearInterval(nuvioPollRef.current);
            nuvioPollRef.current = null;
        }
    };

    const startNuvioCountdown = (expiresAt: string) => {
        if (nuvioCountdownRef.current) {
            clearInterval(nuvioCountdownRef.current);
        }
        const update = () => {
            const remaining = Math.max(
                0,
                Math.floor((new Date(expiresAt).getTime() - Date.now()) / 1000)
            );
            setNuvioCountdown(remaining);
            if (remaining <= 0 && nuvioCountdownRef.current) {
                clearInterval(nuvioCountdownRef.current);
                nuvioCountdownRef.current = null;
            }
        };
        update();
        nuvioCountdownRef.current = setInterval(update, 1000);
    };

    const handleStartNuvioOAuth = async () => {
        setStep("nuvio-oauth");
        setNuvioOauthStatus("connecting");
        setNuvioOauthError(null);
        try {
            const result = await api.startNuvioOAuth();
            setNuvioCode(result.code);
            setNuvioWebUrl(result.webUrl);
            setNuvioExpiresAt(result.expiresAt);
            setNuvioDeviceNonce(result.deviceNonce);
            setNuvioAnonToken(result.anonToken);
            setNuvioOauthStatus("waiting");
            startNuvioCountdown(result.expiresAt);

            const intervalMs = Math.max(2, result.pollIntervalSeconds || 3) * 1000;
            nuvioPollRef.current = setInterval(async () => {
                try {
                    const poll = await api.pollNuvioOAuth({
                        anonToken: result.anonToken,
                        code: result.code,
                        deviceNonce: result.deviceNonce,
                    });
                    // Status is opaque (passed through from Nuvio's own session state) —
                    // 'pending' means keep waiting; anything else, attempt the exchange.
                    if (poll.status === "pending") {
                        return;
                    }

                    stopNuvioPolling();
                    if (nuvioCountdownRef.current) {
                        clearInterval(nuvioCountdownRef.current);
                    }

                    const exchanged = await api.exchangeNuvioOAuth({
                        anonToken: result.anonToken,
                        code: result.code,
                        deviceNonce: result.deviceNonce,
                    });
                    setNuvioOauthStatus("completed");
                    if (isNuvioReconnect && userId) {
                        await api.reconnectUserNuvio(userId, {
                            email: exchanged.user.email,
                            providerUserId: exchanged.user.id,
                            refreshToken: exchanged.refreshToken,
                        });
                        toast.success(`${userName || "They"} is connected again`);
                        onReconnectSuccess?.();
                        return;
                    }
                    // Added straight away, named after the start of their email.
                    finishAdding(
                        await api.createUserWithNuvioOAuth({
                            email: exchanged.user.email,
                            providerUserId: exchanged.user.id,
                            refreshToken: exchanged.refreshToken,
                            username: "",
                        })
                    );
                } catch (err) {
                    stopNuvioPolling();
                    if (nuvioCountdownRef.current) {
                        clearInterval(nuvioCountdownRef.current);
                    }
                    setNuvioOauthStatus("error");
                    setNuvioOauthError(readErrorMessage(err, "Nuvio approval failed or expired"));
                }
            }, intervalMs);
        } catch (err) {
            setNuvioOauthStatus("error");
            setNuvioOauthError(readErrorMessage(err, "Failed to start Nuvio login"));
        }
    };

    // Email and password; the approval-code sign-in adds them as soon as it is
    // approved. An empty name is fine: the server takes the start of the email.
    const handleNuvioSubmit = async () => {
        if (!(nuvioEmail.trim() && nuvioPassword)) {
            toast.error("Email and password are required");
            return;
        }
        setIsSubmitting(true);
        try {
            finishAdding(
                await api.createUserWithNuvioCredentials({
                    email: nuvioEmail.trim(),
                    password: nuvioPassword,
                    username: username.trim(),
                })
            );
        } catch (err) {
            toast.error(readErrorMessage(err, "Failed to create Nuvio user"));
        } finally {
            setIsSubmitting(false);
        }
    };

    // Reconnect by email and password: the same account (the server refuses another).
    const handleNuvioReconnect = async () => {
        if (!userId) {
            return;
        }
        if (!(nuvioEmail.trim() && nuvioPassword)) {
            toast.error("Email and password are required");
            return;
        }
        setIsSubmitting(true);
        try {
            await api.reconnectUserNuvio(userId, {
                email: nuvioEmail.trim(),
                password: nuvioPassword,
            });
            toast.success(`${userName || "They"} is connected again`);
            onReconnectSuccess?.();
        } catch (err) {
            toast.error((err as Error)?.message || "Could not reconnect them");
        } finally {
            setIsSubmitting(false);
        }
    };

    // --- Jellyfin handlers ---
    const jellyfinApi: JellyfinSignInApi = {
        probe: (serverUrl) => api.jellyfinProbe(serverUrl),
        quickConnectStatus: (params) => api.jellyfinQuickConnectStatus(params),
        startQuickConnect: (serverUrl) => api.jellyfinStartQuickConnect(serverUrl),
    };

    const handleJellyfinSubmit = async (credentials: JellyfinCredentials) => {
        if (isJellyfinReconnect) {
            await api.connectUserWithJellyfin({ ...credentials, userId });
            toast.success(`${userName || "User"} is connected again`);
            onReconnectSuccess?.();
            return;
        }
        const created = await api.connectUserWithJellyfin({
            ...credentials,
            ...(jellyfinDisplayName.trim() ? { username: jellyfinDisplayName.trim() } : {}),
        });
        toast.success(`${created?.username || "User"} added`);
        setJellyfinAdded((list) => [
            ...list,
            {
                household: created?.household || [],
                id: created?.id,
                username: created?.username,
            },
        ]);
        setJellyfinDisplayName("");
        // A fresh form on the same server, for the next person in the household.
        setJellyfinFormKey((k) => k + 1);
    };

    return (
        <AnimatePresence>
            {isOpen && (
                <Dialog className="relative z-50" onClose={onClose} open={isOpen}>
                    {/* A simple scrim keeps attention on the connection flow. */}
                    <motion.div
                        animate={{ opacity: 1 }}
                        className="fixed inset-0"
                        exit={{ opacity: 0 }}
                        initial={{ opacity: 0 }}
                        style={{
                            background: "rgba(0,0,0,0.55)",
                        }}
                    />

                    <div className="fixed inset-0 flex items-center justify-center p-4">
                        <motion.div
                            animate={{ opacity: 1, scale: 1, y: 0 }}
                            className="w-full"
                            exit={reduceMotion ? { opacity: 0 } : { opacity: 0, scale: 0.98, y: 8 }}
                            initial={
                                reduceMotion ? { opacity: 0 } : { opacity: 0, scale: 0.98, y: 8 }
                            }
                            style={{ maxWidth: "512px" }}
                            transition={{ bounce: 0, duration: 0.3, type: "spring" }}
                        >
                            <DialogPanel
                                className="interface-connect interface-modal relative flex max-h-[85dvh] w-full flex-col overflow-hidden"
                                style={{
                                    background: "var(--color-surface)",
                                    border: "1px solid var(--color-surface-border)",
                                    borderRadius: "24px",
                                    boxShadow:
                                        "0 0 0 1px rgba(255,255,255,0.05), 0 40px 80px -20px rgba(0,0,0,0.5)",
                                    maxWidth: "512px",
                                }}
                            >
                                <DialogTitle className="sr-only">
                                    {isReconnect ? "Reconnect user" : "Add user"}
                                </DialogTitle>
                                <button
                                    aria-label="Close add user"
                                    className="absolute top-3 right-3 z-20 flex h-11 w-11 items-center justify-center rounded-full text-muted hover:bg-surface-hover"
                                    onClick={onClose}
                                    type="button"
                                >
                                    <XMarkIcon className="h-5 w-5" />
                                </button>

                                {/* Content */}
                                <div className="overflow-y-auto p-6 md:p-8">
                                    <AnimatePresence mode="wait">
                                        {/* Step: Select Method - 3 Tabs */}
                                        {step === "tabs" && (
                                            <motion.div
                                                animate={{ opacity: 1, x: 0 }}
                                                exit={{ opacity: 0, x: 20 }}
                                                initial={{ opacity: 0, x: -20 }}
                                                key="tabs"
                                                transition={{ duration: 0.2 }}
                                            >
                                                <div className="mb-6 pr-6">
                                                    <motion.div
                                                        animate={{ scale: 1 }}
                                                        className="mb-4 flex h-11 w-11 items-center justify-center rounded-xl"
                                                        initial={false}
                                                        style={{
                                                            background:
                                                                "var(--color-primary-muted)",
                                                        }}
                                                        transition={{ delay: 0.1, type: "spring" }}
                                                    >
                                                        {isReconnect ? (
                                                            <ArrowPathIcon className="h-5 w-5 text-primary" />
                                                        ) : (
                                                            <UsersIcon className="h-5 w-5 text-primary" />
                                                        )}
                                                    </motion.div>
                                                    <h2
                                                        className="mb-2 font-bold text-2xl"
                                                        style={{ color: "var(--color-text)" }}
                                                    >
                                                        {isJellyfinReconnect
                                                            ? "Reconnect Server Sign-in"
                                                            : isNuvioReconnect
                                                              ? "Reconnect Nuvio Account"
                                                              : isReconnect
                                                                ? "Reconnect Stremio Account"
                                                                : "Add a user"}
                                                    </h2>
                                                    <p
                                                        className="text-sm"
                                                        style={{ color: "var(--color-text-muted)" }}
                                                    >
                                                        {isJellyfinReconnect
                                                            ? `Sign ${userName} in to their server again`
                                                            : isNuvioReconnect
                                                              ? `Sign ${userName} in to Nuvio again`
                                                              : isReconnect
                                                                ? `Choose how you'd like to reconnect ${userName}'s Stremio account`
                                                                : "Choose how you'd like to add this user"}
                                                    </p>
                                                    {/* Without their password: signing in on their own page renews
                            the sign-in SlickSync holds (server/routes/publicLibrary.js). */}
                                                    {isReconnect && (
                                                        <button
                                                            className="mt-3 inline-flex items-center gap-1.5 text-primary text-xs hover:underline"
                                                            onClick={() => {
                                                                const app =
                                                                    providerType === "nuvio"
                                                                        ? "nuvio"
                                                                        : providerType ===
                                                                            "jellyfin"
                                                                          ? "jellyfin"
                                                                          : "stremio";
                                                                copyToClipboard(
                                                                    `${window.location.origin}/login?app=${app}`
                                                                );
                                                                toast.success(
                                                                    `Link copied - when ${userName} signs in there, they're reconnected`
                                                                );
                                                            }}
                                                            type="button"
                                                        >
                                                            <ClipboardIcon className="h-3.5 w-3.5" />
                                                            Or copy a link for {userName} to sign in
                                                            themselves
                                                        </button>
                                                    )}
                                                </div>

                                                {/* The selected tab's colour is a class, never an inline style:
                          a page-recolouring browser extension (Dark Reader and the
                          like) freezes inline backgrounds it has already rewritten,
                          which left every tab clicked lit up at once in Firefox. */}
                                                {!isReconnect && (
                                                    <div
                                                        className="mb-5 flex gap-2 rounded-xl p-1"
                                                        style={{
                                                            background: "var(--color-bg-muted)",
                                                        }}
                                                    >
                                                        <button
                                                            aria-pressed={provider === "stremio"}
                                                            className={`flex-1 rounded-lg py-2 font-semibold text-sm transition-colors ${provider === "stremio" ? "bg-primary text-white" : "bg-transparent text-muted hover:text-default"}`}
                                                            onClick={() => setProvider("stremio")}
                                                            type="button"
                                                        >
                                                            Stremio
                                                        </button>
                                                        <button
                                                            aria-pressed={provider === "nuvio"}
                                                            className={`flex-1 rounded-lg py-2 font-semibold text-sm transition-colors ${provider === "nuvio" ? "bg-primary text-white" : "bg-transparent text-muted hover:text-default"}`}
                                                            onClick={() => setProvider("nuvio")}
                                                            type="button"
                                                        >
                                                            Nuvio
                                                        </button>
                                                        <button
                                                            aria-pressed={provider === "jellyfin"}
                                                            className={`flex-1 rounded-lg py-2 font-semibold text-sm transition-colors ${provider === "jellyfin" ? "bg-primary text-white" : "bg-transparent text-muted hover:text-default"}`}
                                                            onClick={() => setProvider("jellyfin")}
                                                            type="button"
                                                        >
                                                            Jellyfin | AIOStreams
                                                        </button>
                                                    </div>
                                                )}

                                                {(provider === "jellyfin" ||
                                                    isJellyfinReconnect) && (
                                                    <div className="space-y-4">
                                                        {!isJellyfinReconnect && (
                                                            <p
                                                                className="text-sm"
                                                                style={{
                                                                    color: "var(--color-text-muted)",
                                                                }}
                                                            >
                                                                For anyone who watches through a
                                                                Jellyfin app - a Jellyfin server, or
                                                                the media server AIOStreams and
                                                                AIOMetadata run for Infuse,
                                                                Swiftfin, Findroid and their own
                                                                apps.
                                                            </p>
                                                        )}
                                                        {jellyfinAdded.length > 0 &&
                                                            (() => {
                                                                const household =
                                                                    jellyfinAdded.flatMap((u) =>
                                                                        u.household.map((h) => ({
                                                                            ...h,
                                                                            owner: u.username,
                                                                        }))
                                                                    );
                                                                const tracked = household
                                                                    .filter(
                                                                        (h) =>
                                                                            h.status === "tracked"
                                                                    )
                                                                    .map((h) => h.name);
                                                                const waiting = household
                                                                    .filter(
                                                                        (h) =>
                                                                            h.status ===
                                                                                "needs-pin" ||
                                                                            h.status ===
                                                                                "needs-sign-in"
                                                                    )
                                                                    .map((h) => h.name);
                                                                return (
                                                                    <div
                                                                        className="space-y-1 rounded-xl p-3 text-sm"
                                                                        style={{
                                                                            background:
                                                                                "color-mix(in srgb, var(--color-secondary) 15%, transparent)",
                                                                            color: "var(--color-text)",
                                                                        }}
                                                                    >
                                                                        <p>
                                                                            Added{" "}
                                                                            {jellyfinAdded
                                                                                .map(
                                                                                    (u) =>
                                                                                        u.username
                                                                                )
                                                                                .join(", ")}
                                                                            {tracked.length > 0
                                                                                ? `, with ${tracked.join(", ")} as ${tracked.length === 1 ? "a profile" : "profiles"}`
                                                                                : ""}
                                                                            .
                                                                        </p>
                                                                        {waiting.length > 0 && (
                                                                            <p
                                                                                className="text-xs"
                                                                                style={{
                                                                                    color: "var(--color-text-muted)",
                                                                                }}
                                                                            >
                                                                                {waiting.join(", ")}{" "}
                                                                                {waiting.length ===
                                                                                1
                                                                                    ? "needs"
                                                                                    : "need"}{" "}
                                                                                a PIN or the
                                                                                password - finish{" "}
                                                                                {waiting.length ===
                                                                                1
                                                                                    ? "it"
                                                                                    : "them"}{" "}
                                                                                from the household
                                                                                card on the Users
                                                                                page.
                                                                            </p>
                                                                        )}
                                                                        <p
                                                                            className="text-xs"
                                                                            style={{
                                                                                color: "var(--color-text-muted)",
                                                                            }}
                                                                        >
                                                                            Add someone else from{" "}
                                                                            {jellyfinServer?.serverName ||
                                                                                "this server"}
                                                                            , or close when you are
                                                                            done.
                                                                        </p>
                                                                    </div>
                                                                );
                                                            })()}
                                                        {!isJellyfinReconnect && jellyfinServer && (
                                                            <div>
                                                                <label
                                                                    className="mb-2 block font-medium text-sm"
                                                                    htmlFor={`${fieldId1}-1`}
                                                                    style={{
                                                                        color: "var(--color-text)",
                                                                    }}
                                                                >
                                                                    Name in SlickSync
                                                                </label>
                                                                <input
                                                                    className="w-full rounded-xl px-4 py-3 text-sm"
                                                                    id={`${fieldId1}-1`}
                                                                    onChange={(e) =>
                                                                        setJellyfinDisplayName(
                                                                            e.target.value
                                                                        )
                                                                    }
                                                                    placeholder="Their name on the server, if left empty"
                                                                    style={{
                                                                        background:
                                                                            "var(--color-bg)",
                                                                        border: "1px solid var(--color-surface-border)",
                                                                        color: "var(--color-text)",
                                                                    }}
                                                                    type="text"
                                                                    value={jellyfinDisplayName}
                                                                />
                                                            </div>
                                                        )}
                                                        <JellyfinSignIn
                                                            api={jellyfinApi}
                                                            compact
                                                            initialServerUrl={
                                                                jellyfinServer?.serverUrl || ""
                                                            }
                                                            key={jellyfinFormKey}
                                                            onServerChange={(info) => {
                                                                if (info) {
                                                                    setJellyfinServer(info);
                                                                }
                                                            }}
                                                            onSubmit={handleJellyfinSubmit}
                                                            submitLabel={
                                                                isJellyfinReconnect
                                                                    ? "Reconnect"
                                                                    : "Add user"
                                                            }
                                                        />
                                                        {jellyfinAdded.length > 0 && (
                                                            <button
                                                                className="w-full rounded-xl py-3 font-medium text-sm"
                                                                onClick={() => {
                                                                    onClose();
                                                                    const last =
                                                                        jellyfinAdded.at(-1);
                                                                    if (
                                                                        jellyfinAdded.length ===
                                                                            1 &&
                                                                        last?.id
                                                                    ) {
                                                                        window.location.href = `/users/${last.id}`;
                                                                    } else {
                                                                        window.location.reload();
                                                                    }
                                                                }}
                                                                style={{
                                                                    background:
                                                                        "var(--color-bg-muted)",
                                                                    color: "var(--color-text)",
                                                                }}
                                                                type="button"
                                                            >
                                                                Done
                                                            </button>
                                                        )}
                                                    </div>
                                                )}

                                                {provider === "stremio" &&
                                                    !isJellyfinReconnect &&
                                                    !isNuvioReconnect && (
                                                        <>
                                                            {/* 3 Tab Options */}
                                                            <div className="space-y-3">
                                                                {/* Credentials Option (Email/Password) */}
                                                                <motion.button
                                                                    className={`group relative w-full overflow-hidden rounded-2xl p-4 text-left transition-all ${authMethod === "credentials" ? "auth-opt-on" : "auth-opt-off"}`}
                                                                    onClick={() =>
                                                                        setAuthMethod("credentials")
                                                                    }
                                                                    style={{
                                                                        opacity:
                                                                            authMethod ===
                                                                            "credentials"
                                                                                ? 1
                                                                                : 0.85,
                                                                    }}
                                                                    type="button"
                                                                    whileHover={{
                                                                        scale: 1.02,
                                                                        y: -2,
                                                                    }}
                                                                    whileTap={{ scale: 0.98 }}
                                                                >
                                                                    <div className="relative flex items-center gap-4">
                                                                        <div className="ao-icon flex h-10 w-10 shrink-0 items-center justify-center rounded-xl">
                                                                            <svg
                                                                                aria-hidden="true"
                                                                                className="ao-glyph h-5 w-5"
                                                                                fill="none"
                                                                                focusable="false"
                                                                                stroke="currentColor"
                                                                                strokeWidth="2"
                                                                                viewBox="0 0 24 24"
                                                                            >
                                                                                <path
                                                                                    d="M21 12a9 9 0 01-9 9m9-9a9 9 0 00-9-9m9 9H3m9 9a9 9 0 01-9-9m9 9c1.657 0 3-4.03 3-9s-1.343-9-3-9m0 18c-1.657 0-3-4.03-3-9s1.343-9 3-9m-9 9a9 9 0 019-9"
                                                                                    strokeLinecap="round"
                                                                                    strokeLinejoin="round"
                                                                                />
                                                                            </svg>
                                                                        </div>
                                                                        <div className="min-w-0 flex-1">
                                                                            <span className="ao-title font-semibold">
                                                                                Credentials
                                                                            </span>
                                                                            <p className="ao-sub mt-0.5 text-sm">
                                                                                Email and password
                                                                            </p>
                                                                        </div>
                                                                    </div>
                                                                </motion.button>

                                                                {/* Auth Key Option */}
                                                                <motion.button
                                                                    className={`group relative w-full overflow-hidden rounded-2xl p-4 text-left transition-all ${authMethod === "authKey" ? "auth-opt-on" : "auth-opt-off"}`}
                                                                    onClick={() =>
                                                                        setAuthMethod("authKey")
                                                                    }
                                                                    style={{
                                                                        opacity:
                                                                            authMethod === "authKey"
                                                                                ? 1
                                                                                : 0.85,
                                                                    }}
                                                                    type="button"
                                                                    whileHover={{
                                                                        scale: 1.02,
                                                                        y: -2,
                                                                    }}
                                                                    whileTap={{ scale: 0.98 }}
                                                                >
                                                                    <div className="relative flex items-center gap-4">
                                                                        <div className="ao-icon flex h-10 w-10 shrink-0 items-center justify-center rounded-xl">
                                                                            <svg
                                                                                aria-hidden="true"
                                                                                className="ao-glyph h-5 w-5"
                                                                                fill="none"
                                                                                focusable="false"
                                                                                stroke="currentColor"
                                                                                strokeWidth="2"
                                                                                viewBox="0 0 24 24"
                                                                            >
                                                                                <path
                                                                                    d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z"
                                                                                    strokeLinecap="round"
                                                                                    strokeLinejoin="round"
                                                                                />
                                                                            </svg>
                                                                        </div>
                                                                        <div className="min-w-0 flex-1">
                                                                            <span className="ao-title font-semibold">
                                                                                Auth Key
                                                                            </span>
                                                                            <p className="ao-sub mt-0.5 text-sm">
                                                                                Paste from Stremio
                                                                                settings
                                                                            </p>
                                                                        </div>
                                                                    </div>
                                                                </motion.button>

                                                                {/* Stremio OAuth Option */}
                                                                <motion.button
                                                                    className={`group relative w-full overflow-hidden rounded-2xl p-4 text-left transition-all ${authMethod === "oauth" ? "auth-opt-on" : "auth-opt-off"}`}
                                                                    onClick={() => {
                                                                        setAuthMethod("oauth");
                                                                        setStep("oauth");
                                                                        handleStartOAuth();
                                                                    }}
                                                                    style={{
                                                                        opacity:
                                                                            authMethod === "oauth"
                                                                                ? 1
                                                                                : 0.85,
                                                                    }}
                                                                    type="button"
                                                                    whileHover={{
                                                                        scale: 1.02,
                                                                        y: -2,
                                                                    }}
                                                                    whileTap={{ scale: 0.98 }}
                                                                >
                                                                    <div
                                                                        className="absolute inset-0 opacity-0 transition-opacity group-hover:opacity-100"
                                                                        style={{
                                                                            background:
                                                                                "linear-gradient(135deg, color-mix(in srgb, var(--color-primary) 10%, transparent) 0%, transparent 50%)",
                                                                        }}
                                                                    />
                                                                    <div className="relative flex items-center gap-4">
                                                                        <div className="ao-icon-grad flex h-10 w-10 shrink-0 items-center justify-center rounded-xl">
                                                                            <svg
                                                                                aria-hidden="true"
                                                                                className="h-5 w-5 text-white"
                                                                                fill="none"
                                                                                focusable="false"
                                                                                stroke="currentColor"
                                                                                strokeWidth="2"
                                                                                viewBox="0 0 24 24"
                                                                            >
                                                                                <path
                                                                                    d="M13.5 6H5.25A2.25 2.25 0 003 8.25v10.5A2.25 2.25 0 005.25 21h10.5A2.25 2.25 0 0018 18.75V10.5m-10.5 6L21 3m0 0h-5.25M21 3v5.25"
                                                                                    strokeLinecap="round"
                                                                                    strokeLinejoin="round"
                                                                                />
                                                                            </svg>
                                                                        </div>
                                                                        <div className="min-w-0 flex-1">
                                                                            <div className="flex items-center gap-2">
                                                                                <span className="ao-title font-semibold">
                                                                                    Stremio OAuth
                                                                                </span>
                                                                                <span className="ao-badge rounded-full px-2 py-0.5 font-bold text-[10px] uppercase tracking-wider">
                                                                                    Recommended
                                                                                </span>
                                                                            </div>
                                                                            <p className="ao-sub mt-0.5 text-sm">
                                                                                Securely link via
                                                                                OAuth
                                                                            </p>
                                                                        </div>
                                                                    </div>
                                                                </motion.button>
                                                            </div>

                                                            {/* Show form based on selected auth method (except OAuth which goes to separate step) */}
                                                            {authMethod !== "oauth" && (
                                                                <div
                                                                    className="mt-6 rounded-xl p-4"
                                                                    style={{
                                                                        background:
                                                                            "var(--color-bg-muted)",
                                                                    }}
                                                                >
                                                                    <div className="space-y-4">
                                                                        {!isReconnect && (
                                                                            <div>
                                                                                <label
                                                                                    className="mb-2 block font-medium text-sm"
                                                                                    htmlFor={`${fieldId1}-2`}
                                                                                    style={{
                                                                                        color: "var(--color-text-muted)",
                                                                                    }}
                                                                                >
                                                                                    Name in
                                                                                    SlickSync
                                                                                </label>
                                                                                <input
                                                                                    className="w-full rounded-xl px-4 py-3 transition-all duration-200 focus:outline-none"
                                                                                    id={`${fieldId1}-2`}
                                                                                    onChange={(e) =>
                                                                                        setUsername(
                                                                                            e.target
                                                                                                .value
                                                                                        )
                                                                                    }
                                                                                    placeholder="The start of their email, if left empty"
                                                                                    style={{
                                                                                        background:
                                                                                            "var(--color-surface-hover)",
                                                                                        border: "1px solid var(--color-surface-border)",
                                                                                        color: "var(--color-text)",
                                                                                    }}
                                                                                    type="text"
                                                                                    value={username}
                                                                                />
                                                                            </div>
                                                                        )}

                                                                        {authMethod ===
                                                                            "credentials" && (
                                                                            <>
                                                                                <div>
                                                                                    <label
                                                                                        className="mb-2 block font-medium text-sm"
                                                                                        htmlFor={`${fieldId1}-3`}
                                                                                        style={{
                                                                                            color: "var(--color-text-muted)",
                                                                                        }}
                                                                                    >
                                                                                        Email{" "}
                                                                                        <span
                                                                                            style={{
                                                                                                color: "var(--color-error)",
                                                                                            }}
                                                                                        >
                                                                                            *
                                                                                        </span>
                                                                                    </label>
                                                                                    <input
                                                                                        className="w-full rounded-xl px-4 py-3 transition-all duration-200 focus:outline-none"
                                                                                        id={`${fieldId1}-3`}
                                                                                        onChange={(
                                                                                            e
                                                                                        ) =>
                                                                                            setEmail(
                                                                                                e
                                                                                                    .target
                                                                                                    .value
                                                                                            )
                                                                                        }
                                                                                        placeholder={
                                                                                            isReconnect
                                                                                                ? "Enter Stremio email"
                                                                                                : "Enter Stremio account email"
                                                                                        }
                                                                                        style={{
                                                                                            background:
                                                                                                "var(--color-surface-hover)",
                                                                                            border: "1px solid var(--color-surface-border)",
                                                                                            color: "var(--color-text)",
                                                                                        }}
                                                                                        type="email"
                                                                                        value={
                                                                                            email
                                                                                        }
                                                                                    />
                                                                                </div>

                                                                                <div>
                                                                                    <label
                                                                                        className="mb-2 block font-medium text-sm"
                                                                                        htmlFor={`${fieldId1}-4`}
                                                                                        style={{
                                                                                            color: "var(--color-text-muted)",
                                                                                        }}
                                                                                    >
                                                                                        Password{" "}
                                                                                        <span
                                                                                            style={{
                                                                                                color: "var(--color-error)",
                                                                                            }}
                                                                                        >
                                                                                            *
                                                                                        </span>
                                                                                    </label>
                                                                                    <div className="relative">
                                                                                        <input
                                                                                            className="w-full rounded-xl py-3 pr-12 pl-4 transition-all duration-200 focus:outline-none"
                                                                                            id={`${fieldId1}-4`}
                                                                                            onChange={(
                                                                                                e
                                                                                            ) =>
                                                                                                setPassword(
                                                                                                    e
                                                                                                        .target
                                                                                                        .value
                                                                                                )
                                                                                            }
                                                                                            placeholder={
                                                                                                isReconnect
                                                                                                    ? "Enter Stremio password"
                                                                                                    : "Enter password"
                                                                                            }
                                                                                            style={{
                                                                                                background:
                                                                                                    "var(--color-surface-hover)",
                                                                                                border: "1px solid var(--color-surface-border)",
                                                                                                color: "var(--color-text)",
                                                                                            }}
                                                                                            type={
                                                                                                passwordVisible
                                                                                                    ? "text"
                                                                                                    : "password"
                                                                                            }
                                                                                            value={
                                                                                                password
                                                                                            }
                                                                                        />
                                                                                        <PasswordToggleButton
                                                                                            onToggle={() =>
                                                                                                setPasswordVisible(
                                                                                                    (
                                                                                                        v
                                                                                                    ) =>
                                                                                                        !v
                                                                                                )
                                                                                            }
                                                                                            visible={
                                                                                                passwordVisible
                                                                                            }
                                                                                        />
                                                                                    </div>
                                                                                </div>

                                                                                {!isReconnect && (
                                                                                    <div className="flex items-center gap-2">
                                                                                        <input
                                                                                            checked={
                                                                                                registerNew
                                                                                            }
                                                                                            className="h-4 w-4 rounded"
                                                                                            id="register-new"
                                                                                            onChange={(
                                                                                                e
                                                                                            ) =>
                                                                                                setRegisterNew(
                                                                                                    e
                                                                                                        .target
                                                                                                        .checked
                                                                                                )
                                                                                            }
                                                                                            type="checkbox"
                                                                                        />
                                                                                        <label
                                                                                            className="text-sm"
                                                                                            htmlFor="register-new"
                                                                                            style={{
                                                                                                color: "var(--color-text-muted)",
                                                                                            }}
                                                                                        >
                                                                                            Register
                                                                                            new
                                                                                            Stremio
                                                                                            account
                                                                                        </label>
                                                                                    </div>
                                                                                )}
                                                                            </>
                                                                        )}

                                                                        {authMethod ===
                                                                            "authKey" && (
                                                                            <div>
                                                                                <label
                                                                                    className="mb-2 block font-medium text-sm"
                                                                                    htmlFor={`${fieldId1}-5`}
                                                                                    style={{
                                                                                        color: "var(--color-text-muted)",
                                                                                    }}
                                                                                >
                                                                                    Stremio Auth Key
                                                                                </label>
                                                                                <div className="relative">
                                                                                    <input
                                                                                        className="w-full rounded-xl py-3 pr-12 pl-4 transition-all duration-200 focus:outline-none"
                                                                                        id={`${fieldId1}-5`}
                                                                                        onChange={(
                                                                                            e
                                                                                        ) =>
                                                                                            setAuthKey(
                                                                                                e
                                                                                                    .target
                                                                                                    .value
                                                                                            )
                                                                                        }
                                                                                        placeholder="Paste from Stremio settings"
                                                                                        style={{
                                                                                            background:
                                                                                                "var(--color-surface-hover)",
                                                                                            border: "1px solid var(--color-surface-border)",
                                                                                            color: "var(--color-text)",
                                                                                        }}
                                                                                        type={
                                                                                            authKeyVisible
                                                                                                ? "text"
                                                                                                : "password"
                                                                                        }
                                                                                        value={
                                                                                            authKey
                                                                                        }
                                                                                    />
                                                                                    <PasswordToggleButton
                                                                                        onToggle={() =>
                                                                                            setAuthKeyVisible(
                                                                                                (
                                                                                                    v
                                                                                                ) =>
                                                                                                    !v
                                                                                            )
                                                                                        }
                                                                                        visible={
                                                                                            authKeyVisible
                                                                                        }
                                                                                    />
                                                                                </div>
                                                                                <p
                                                                                    className="mt-2 text-xs"
                                                                                    style={{
                                                                                        color: "var(--color-text-subtle)",
                                                                                    }}
                                                                                >
                                                                                    Find this in
                                                                                    Stremio →
                                                                                    Settings →
                                                                                    Account
                                                                                </p>
                                                                            </div>
                                                                        )}
                                                                    </div>

                                                                    <div className="mt-6 flex gap-3">
                                                                        <button
                                                                            className="flex-1 rounded-xl py-3 font-medium text-sm transition-colors"
                                                                            onClick={onClose}
                                                                            style={{
                                                                                background:
                                                                                    "var(--color-surface-hover)",
                                                                                color: "var(--color-text)",
                                                                            }}
                                                                            type="button"
                                                                        >
                                                                            Cancel
                                                                        </button>
                                                                        <Button
                                                                            className="flex-1"
                                                                            isLoading={isSubmitting}
                                                                            onClick={handleSubmit}
                                                                            variant="primary"
                                                                        >
                                                                            {isReconnect
                                                                                ? "Reconnect"
                                                                                : "Add User"}
                                                                        </Button>
                                                                    </div>
                                                                </div>
                                                            )}
                                                        </>
                                                    )}

                                                {(provider === "nuvio" || isNuvioReconnect) && (
                                                    <>
                                                        <div className="space-y-3">
                                                            {/* Nuvio Credentials Option */}
                                                            <button
                                                                className={`w-full rounded-2xl p-4 text-left transition-all ${nuvioAuthMethod === "credentials" ? "auth-opt-on" : "auth-opt-off"}`}
                                                                onClick={() =>
                                                                    setNuvioAuthMethod(
                                                                        "credentials"
                                                                    )
                                                                }
                                                                type="button"
                                                            >
                                                                <span className="ao-title font-semibold">
                                                                    Credentials
                                                                </span>
                                                                <p className="ao-sub mt-0.5 text-sm">
                                                                    Email and password
                                                                </p>
                                                            </button>

                                                            {/* Nuvio OAuth Option */}
                                                            <button
                                                                className={`w-full rounded-2xl p-4 text-left transition-all ${nuvioAuthMethod === "oauth" ? "auth-opt-on" : "auth-opt-off"}`}
                                                                onClick={() => {
                                                                    setNuvioAuthMethod("oauth");
                                                                    handleStartNuvioOAuth();
                                                                }}
                                                                type="button"
                                                            >
                                                                <div className="flex items-center gap-2">
                                                                    <span className="ao-title font-semibold">
                                                                        Nuvio OAuth
                                                                    </span>
                                                                    <span className="ao-badge rounded-full px-2 py-0.5 font-bold text-[10px] uppercase tracking-wider">
                                                                        Recommended
                                                                    </span>
                                                                </div>
                                                                <p className="ao-sub mt-0.5 text-sm">
                                                                    Approve on your device — no
                                                                    password shared
                                                                </p>
                                                            </button>
                                                        </div>

                                                        {nuvioAuthMethod === "credentials" && (
                                                            <div
                                                                className="mt-6 rounded-xl p-4"
                                                                style={{
                                                                    background:
                                                                        "var(--color-bg-muted)",
                                                                }}
                                                            >
                                                                <div className="space-y-4">
                                                                    {!isNuvioReconnect && (
                                                                        <div>
                                                                            <label
                                                                                className="mb-2 block font-medium text-sm"
                                                                                htmlFor={`${fieldId1}-6`}
                                                                                style={{
                                                                                    color: "var(--color-text-muted)",
                                                                                }}
                                                                            >
                                                                                Name in SlickSync
                                                                            </label>
                                                                            <input
                                                                                className="w-full rounded-xl px-4 py-3 focus:outline-none"
                                                                                id={`${fieldId1}-6`}
                                                                                onChange={(e) =>
                                                                                    setUsername(
                                                                                        e.target
                                                                                            .value
                                                                                    )
                                                                                }
                                                                                placeholder="The start of their email, if left empty"
                                                                                style={{
                                                                                    background:
                                                                                        "var(--color-surface-hover)",
                                                                                    border: "1px solid var(--color-surface-border)",
                                                                                    color: "var(--color-text)",
                                                                                }}
                                                                                type="text"
                                                                                value={username}
                                                                            />
                                                                        </div>
                                                                    )}
                                                                    <div>
                                                                        <label
                                                                            className="mb-2 block font-medium text-sm"
                                                                            htmlFor={`${fieldId1}-7`}
                                                                            style={{
                                                                                color: "var(--color-text-muted)",
                                                                            }}
                                                                        >
                                                                            Email{" "}
                                                                            <span
                                                                                style={{
                                                                                    color: "var(--color-error)",
                                                                                }}
                                                                            >
                                                                                *
                                                                            </span>
                                                                        </label>
                                                                        <input
                                                                            className="w-full rounded-xl px-4 py-3 focus:outline-none"
                                                                            id={`${fieldId1}-7`}
                                                                            onChange={(e) =>
                                                                                setNuvioEmail(
                                                                                    e.target.value
                                                                                )
                                                                            }
                                                                            placeholder="Enter Nuvio account email"
                                                                            style={{
                                                                                background:
                                                                                    "var(--color-surface-hover)",
                                                                                border: "1px solid var(--color-surface-border)",
                                                                                color: "var(--color-text)",
                                                                            }}
                                                                            type="email"
                                                                            value={nuvioEmail}
                                                                        />
                                                                    </div>
                                                                    <div>
                                                                        <label
                                                                            className="mb-2 block font-medium text-sm"
                                                                            htmlFor={`${fieldId1}-8`}
                                                                            style={{
                                                                                color: "var(--color-text-muted)",
                                                                            }}
                                                                        >
                                                                            Password{" "}
                                                                            <span
                                                                                style={{
                                                                                    color: "var(--color-error)",
                                                                                }}
                                                                            >
                                                                                *
                                                                            </span>
                                                                        </label>
                                                                        <div className="relative">
                                                                            <input
                                                                                className="w-full rounded-xl py-3 pr-12 pl-4 focus:outline-none"
                                                                                id={`${fieldId1}-8`}
                                                                                onChange={(e) =>
                                                                                    setNuvioPassword(
                                                                                        e.target
                                                                                            .value
                                                                                    )
                                                                                }
                                                                                placeholder="Enter password"
                                                                                style={{
                                                                                    background:
                                                                                        "var(--color-surface-hover)",
                                                                                    border: "1px solid var(--color-surface-border)",
                                                                                    color: "var(--color-text)",
                                                                                }}
                                                                                type={
                                                                                    nuvioPasswordVisible
                                                                                        ? "text"
                                                                                        : "password"
                                                                                }
                                                                                value={
                                                                                    nuvioPassword
                                                                                }
                                                                            />
                                                                            <PasswordToggleButton
                                                                                onToggle={() =>
                                                                                    setNuvioPasswordVisible(
                                                                                        (v) => !v
                                                                                    )
                                                                                }
                                                                                visible={
                                                                                    nuvioPasswordVisible
                                                                                }
                                                                            />
                                                                        </div>
                                                                    </div>
                                                                </div>
                                                                <div className="mt-6 flex gap-3">
                                                                    <button
                                                                        className="flex-1 rounded-xl py-3 font-medium text-sm transition-colors"
                                                                        onClick={onClose}
                                                                        style={{
                                                                            background:
                                                                                "var(--color-surface-hover)",
                                                                            color: "var(--color-text)",
                                                                        }}
                                                                        type="button"
                                                                    >
                                                                        Cancel
                                                                    </button>
                                                                    <Button
                                                                        className="flex-1"
                                                                        isLoading={isSubmitting}
                                                                        onClick={
                                                                            isNuvioReconnect
                                                                                ? handleNuvioReconnect
                                                                                : handleNuvioSubmit
                                                                        }
                                                                        variant="primary"
                                                                    >
                                                                        {isNuvioReconnect
                                                                            ? "Reconnect"
                                                                            : "Add User"}
                                                                    </Button>
                                                                </div>
                                                            </div>
                                                        )}
                                                    </>
                                                )}
                                            </motion.div>
                                        )}

                                        {/* Step: OAuth Flow */}
                                        {step === "oauth" && (
                                            <motion.div
                                                animate={{ opacity: 1, x: 0 }}
                                                className="text-center"
                                                exit={{ opacity: 0, x: -20 }}
                                                initial={{ opacity: 0, x: 20 }}
                                                key="oauth"
                                                transition={{ duration: 0.2 }}
                                            >
                                                {/* Animated connection visual with SlickSync + Stremio logos */}
                                                <div className="relative mb-6 flex h-40 items-center justify-center">
                                                    {/* Left orb - SlickSync */}
                                                    <motion.div
                                                        animate={{
                                                            scale:
                                                                oauthStatus === "completed"
                                                                    ? 1.1
                                                                    : 1,
                                                            x: oauthStatus === "completed" ? 20 : 0,
                                                        }}
                                                        className="z-10 flex h-16 w-16 items-center justify-center overflow-hidden rounded-2xl"
                                                        style={{
                                                            background:
                                                                "var(--color-primary-muted)",
                                                        }}
                                                        transition={{ damping: 20, type: "spring" }}
                                                    >
                                                        <SlickSyncLogo className="h-10 w-10" />
                                                    </motion.div>

                                                    {/* Connection line */}
                                                    <div className="absolute left-1/2 h-0.5 w-24 -translate-x-1/2 overflow-hidden">
                                                        <motion.div
                                                            animate={{
                                                                opacity:
                                                                    oauthStatus === "completed"
                                                                        ? 1
                                                                        : oauthStatus === "error"
                                                                          ? 0.3
                                                                          : 1,
                                                                x:
                                                                    oauthStatus === "waiting"
                                                                        ? ["0%", "100%"]
                                                                        : oauthStatus ===
                                                                            "completed"
                                                                          ? "0%"
                                                                          : "-100%",
                                                            }}
                                                            className={`h-full w-full ${oauthStatus === "completed" ? "oauth-bar-done" : oauthStatus === "error" ? "bg-error" : "oauth-bar-wait"}`}
                                                            transition={{
                                                                x:
                                                                    oauthStatus === "waiting"
                                                                        ? {
                                                                              duration: 1,
                                                                              ease: "linear",
                                                                              repeat: Number.POSITIVE_INFINITY,
                                                                          }
                                                                        : { duration: 0.3 },
                                                            }}
                                                        />
                                                    </div>

                                                    {/* Right orb - Stremio */}
                                                    <motion.div
                                                        animate={{
                                                            scale:
                                                                oauthStatus === "completed"
                                                                    ? 1.1
                                                                    : 1,
                                                            x:
                                                                oauthStatus === "completed"
                                                                    ? -20
                                                                    : 0,
                                                        }}
                                                        className="z-10 ml-16 flex h-16 w-16 items-center justify-center rounded-2xl"
                                                        style={{
                                                            background:
                                                                "linear-gradient(135deg, #6C4ECF 0%, #8B5CF6 100%)",
                                                            border: "1px solid color-mix(in srgb, #8B5CF6 50%, transparent)",
                                                        }}
                                                        transition={{ damping: 20, type: "spring" }}
                                                    >
                                                        <img
                                                            alt="Stremio"
                                                            className="h-10 w-10 object-contain"
                                                            height={40}
                                                            src="/stremio-logo.svg"
                                                            width={40}
                                                        />
                                                    </motion.div>

                                                    {/* Success burst */}
                                                    {oauthStatus === "completed" && (
                                                        <motion.div
                                                            animate={{ opacity: 0, scale: 1.5 }}
                                                            className="absolute inset-0 flex items-center justify-center"
                                                            initial={{ opacity: 0, scale: 0 }}
                                                            transition={{ duration: 0.6 }}
                                                        >
                                                            <div
                                                                className="h-32 w-32 rounded-full"
                                                                style={{
                                                                    background:
                                                                        "var(--color-primary)",
                                                                }}
                                                            />
                                                        </motion.div>
                                                    )}
                                                </div>

                                                {/* Status text */}
                                                <motion.div className="mb-6" layout>
                                                    <h3
                                                        className="mb-2 font-bold text-xl"
                                                        style={{ color: "var(--color-text)" }}
                                                    >
                                                        {oauthStatus === "connecting" &&
                                                            "Connecting..."}
                                                        {oauthStatus === "waiting" &&
                                                            "Waiting for Stremio"}
                                                        {oauthStatus === "completed" &&
                                                            (isReconnect
                                                                ? "Reconnected!"
                                                                : "Connected!")}
                                                        {oauthStatus === "error" &&
                                                            "Connection Failed"}
                                                    </h3>
                                                    <p
                                                        className="text-sm"
                                                        style={{ color: "var(--color-text-muted)" }}
                                                    >
                                                        {oauthStatus === "connecting" &&
                                                            "Opening Stremio..."}
                                                        {oauthStatus === "waiting" &&
                                                            "Complete the authorization in the Stremio tab"}
                                                        {oauthStatus === "completed" &&
                                                            (isReconnect
                                                                ? "Stremio account reconnected successfully"
                                                                : "Adding them to SlickSync...")}
                                                        {oauthStatus === "error" &&
                                                            (oauthError || "Please try again")}
                                                    </p>
                                                </motion.div>

                                                {/* TV only: a phone camera fixes the worst part of this
                          flow - fighting a D-pad remote with window.open() in
                          a TV WebView browser, or copy/pasting a link with no
                          keyboard. Scans straight to the same oauthLink a
                          PC/mobile user would just click. */}
                                                {isTV && oauthLink && oauthStatus === "waiting" && (
                                                    <div className="mb-6 flex flex-col items-center gap-2">
                                                        <div className="rounded-xl bg-white p-3">
                                                            {/* eslint-disable-next-line @next/next/no-img-element */}
                                                            <img
                                                                alt="Scan with your phone to complete Stremio authorization"
                                                                height={160}
                                                                src={`/api/qr?data=${encodeURIComponent(oauthLink)}`}
                                                                width={160}
                                                            />
                                                        </div>
                                                        <p
                                                            className="text-xs"
                                                            style={{
                                                                color: "var(--color-text-muted)",
                                                            }}
                                                        >
                                                            Scan with your phone to continue
                                                        </p>
                                                    </div>
                                                )}

                                                {/* Countdown timer */}
                                                {(oauthStatus === "waiting" ||
                                                    oauthStatus === "connecting") &&
                                                    countdown > 0 && (
                                                        <div className="mb-6">
                                                            <div
                                                                className="inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm"
                                                                style={{
                                                                    background:
                                                                        "var(--color-bg-muted)",
                                                                }}
                                                            >
                                                                <ClockIcon
                                                                    className="h-4 w-4"
                                                                    style={{
                                                                        color: "var(--color-text-muted)",
                                                                    }}
                                                                />
                                                                <span
                                                                    style={{
                                                                        color: "var(--color-text-muted)",
                                                                    }}
                                                                >
                                                                    Link expires in{" "}
                                                                    <span
                                                                        className="font-medium font-mono"
                                                                        style={{
                                                                            color: "var(--color-text)",
                                                                        }}
                                                                    >
                                                                        {formatCountdown(countdown)}
                                                                    </span>
                                                                </span>
                                                            </div>
                                                        </div>
                                                    )}

                                                {/* Actions */}
                                                <div className="flex gap-3">
                                                    <button
                                                        className="flex-1 rounded-xl py-3 font-medium text-sm transition-colors"
                                                        onClick={() => setStep("tabs")}
                                                        style={{
                                                            background: "var(--color-bg-muted)",
                                                            color: "var(--color-text)",
                                                        }}
                                                        type="button"
                                                    >
                                                        Back
                                                    </button>
                                                    {oauthStatus === "error" && (
                                                        <Button
                                                            className="flex-1"
                                                            onClick={handleStartOAuth}
                                                            variant="primary"
                                                        >
                                                            Try Again
                                                        </Button>
                                                    )}
                                                    {oauthLink && oauthStatus === "waiting" && (
                                                        <Button
                                                            className="flex-1"
                                                            onClick={() =>
                                                                window.open(oauthLink, "_blank")
                                                            }
                                                            variant="secondary"
                                                        >
                                                            Open Stremio Again
                                                        </Button>
                                                    )}
                                                </div>
                                            </motion.div>
                                        )}

                                        {/* Step: Nuvio OAuth Flow */}
                                        {step === "nuvio-oauth" && (
                                            <motion.div
                                                animate={{ opacity: 1, x: 0 }}
                                                className="text-center"
                                                exit={{ opacity: 0, x: -20 }}
                                                initial={{ opacity: 0, x: 20 }}
                                                key="nuvio-oauth"
                                                transition={{ duration: 0.2 }}
                                            >
                                                <div
                                                    className="mx-auto mb-6 flex h-16 w-16 items-center justify-center rounded-2xl"
                                                    style={{
                                                        background:
                                                            "linear-gradient(135deg, var(--color-primary) 0%, color-mix(in srgb, var(--color-primary) 70%, var(--color-secondary)) 100%)",
                                                        boxShadow:
                                                            "0 8px 32px -8px var(--color-primary)",
                                                    }}
                                                >
                                                    <SlickSyncLogo className="h-10 w-10" />
                                                </div>

                                                <div className="mb-6">
                                                    <h3
                                                        className="mb-2 font-bold text-xl"
                                                        style={{ color: "var(--color-text)" }}
                                                    >
                                                        {nuvioOauthStatus === "connecting" &&
                                                            "Connecting..."}
                                                        {nuvioOauthStatus === "waiting" &&
                                                            "Waiting for Nuvio"}
                                                        {nuvioOauthStatus === "completed" &&
                                                            "Connected!"}
                                                        {nuvioOauthStatus === "error" &&
                                                            "Connection Failed"}
                                                    </h3>
                                                    <p
                                                        className="text-sm"
                                                        style={{ color: "var(--color-text-muted)" }}
                                                    >
                                                        {nuvioOauthStatus === "connecting" &&
                                                            "Starting Nuvio login..."}
                                                        {nuvioOauthStatus === "waiting" &&
                                                            "Open the link below and approve this login on your device"}
                                                        {nuvioOauthStatus === "completed" &&
                                                            "Adding them to SlickSync..."}
                                                        {nuvioOauthStatus === "error" &&
                                                            (nuvioOauthError || "Please try again")}
                                                    </p>
                                                </div>

                                                {nuvioOauthStatus === "waiting" && nuvioCode && (
                                                    <div
                                                        className="mb-6 rounded-xl p-4"
                                                        style={{
                                                            background: "var(--color-bg-muted)",
                                                        }}
                                                    >
                                                        {/* TV only: scan straight to the approval page
                              instead of typing this code somewhere else with
                              a D-pad remote. */}
                                                        {isTV && nuvioWebUrl && (
                                                            <div className="mb-4 flex flex-col items-center gap-2">
                                                                <div className="rounded-xl bg-white p-3">
                                                                    {/* eslint-disable-next-line @next/next/no-img-element */}
                                                                    <img
                                                                        alt="Scan with your phone to approve Nuvio"
                                                                        height={160}
                                                                        src={`/api/qr?data=${encodeURIComponent(nuvioWebUrl)}`}
                                                                        width={160}
                                                                    />
                                                                </div>
                                                                <p
                                                                    className="text-xs"
                                                                    style={{
                                                                        color: "var(--color-text-muted)",
                                                                    }}
                                                                >
                                                                    Scan with your phone to continue
                                                                </p>
                                                            </div>
                                                        )}
                                                        <p
                                                            className="mb-2 text-xs"
                                                            style={{
                                                                color: "var(--color-text-muted)",
                                                            }}
                                                        >
                                                            Approval code
                                                        </p>
                                                        <p
                                                            className="mb-4 font-bold font-mono text-2xl tracking-widest"
                                                            style={{ color: "var(--color-text)" }}
                                                        >
                                                            {nuvioCode}
                                                        </p>
                                                        {nuvioWebUrl && (
                                                            <Button
                                                                className="w-full"
                                                                onClick={() =>
                                                                    window.open(
                                                                        nuvioWebUrl,
                                                                        "_blank"
                                                                    )
                                                                }
                                                                variant="secondary"
                                                            >
                                                                Open Nuvio Approval Page
                                                            </Button>
                                                        )}
                                                    </div>
                                                )}

                                                {(nuvioOauthStatus === "waiting" ||
                                                    nuvioOauthStatus === "connecting") &&
                                                    nuvioCountdown > 0 && (
                                                        <div className="mb-6">
                                                            <div
                                                                className="inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm"
                                                                style={{
                                                                    background:
                                                                        "var(--color-bg-muted)",
                                                                }}
                                                            >
                                                                <ClockIcon
                                                                    className="h-4 w-4"
                                                                    style={{
                                                                        color: "var(--color-text-muted)",
                                                                    }}
                                                                />
                                                                <span
                                                                    style={{
                                                                        color: "var(--color-text-muted)",
                                                                    }}
                                                                >
                                                                    Expires in{" "}
                                                                    <span
                                                                        className="font-medium font-mono"
                                                                        style={{
                                                                            color: "var(--color-text)",
                                                                        }}
                                                                    >
                                                                        {formatCountdown(
                                                                            nuvioCountdown
                                                                        )}
                                                                    </span>
                                                                </span>
                                                            </div>
                                                        </div>
                                                    )}

                                                <div className="flex gap-3">
                                                    <button
                                                        className="flex-1 rounded-xl py-3 font-medium text-sm transition-colors"
                                                        onClick={() => {
                                                            stopNuvioPolling();
                                                            setStep("tabs");
                                                        }}
                                                        style={{
                                                            background: "var(--color-bg-muted)",
                                                            color: "var(--color-text)",
                                                        }}
                                                        type="button"
                                                    >
                                                        Back
                                                    </button>
                                                    {nuvioOauthStatus === "error" && (
                                                        <Button
                                                            className="flex-1"
                                                            onClick={handleStartNuvioOAuth}
                                                            variant="primary"
                                                        >
                                                            Try Again
                                                        </Button>
                                                    )}
                                                </div>
                                            </motion.div>
                                        )}

                                        {/* Step: Success - only for create mode */}
                                        {!isReconnect && step === "success" && (
                                            <motion.div
                                                animate={{ opacity: 1, scale: 1 }}
                                                className="py-8 text-center"
                                                exit={{ opacity: 0 }}
                                                initial={{ opacity: 0, scale: 0.9 }}
                                                key="success"
                                                transition={{ damping: 20, type: "spring" }}
                                            >
                                                <motion.div
                                                    animate={{ scale: 1 }}
                                                    className="mx-auto mb-6 flex h-20 w-20 items-center justify-center rounded-full"
                                                    initial={{ scale: 0 }}
                                                    style={{
                                                        background:
                                                            "linear-gradient(135deg, var(--color-secondary) 0%, color-mix(in srgb, var(--color-secondary) 80%, var(--color-primary)) 100%)",
                                                        boxShadow:
                                                            "0 12px 40px -8px var(--color-secondary)",
                                                    }}
                                                    transition={{
                                                        damping: 10,
                                                        delay: 0.1,
                                                        type: "spring",
                                                    }}
                                                >
                                                    <motion.div
                                                        animate={{ pathLength: 1 }}
                                                        initial={{ pathLength: 0 }}
                                                        transition={{ delay: 0.3, duration: 0.4 }}
                                                    >
                                                        <CheckIcon className="h-10 w-10 text-white" />
                                                    </motion.div>
                                                </motion.div>
                                                <h3
                                                    className="mb-2 font-bold text-2xl"
                                                    style={{ color: "var(--color-text)" }}
                                                >
                                                    User Created!
                                                </h3>
                                                <p
                                                    className="text-sm"
                                                    style={{ color: "var(--color-text-muted)" }}
                                                >
                                                    {username} has been added successfully
                                                </p>
                                            </motion.div>
                                        )}
                                    </AnimatePresence>
                                </div>
                            </DialogPanel>
                        </motion.div>
                    </div>
                </Dialog>
            )}
        </AnimatePresence>
    );
}
