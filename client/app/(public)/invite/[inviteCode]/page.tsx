"use client";

import { UserIcon } from "@heroicons/react/24/outline";
import { motion } from "framer-motion";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { InviteLayout } from "@/components/invite/InviteLayout";
import { NuvioOAuthCard } from "@/components/invite/NuvioOAuthCard";
import { StatusCards } from "@/components/invite/StatusCard";
import { StremioOAuthCard } from "@/components/invite/StremioOAuthCard";
import JellyfinSignIn, { type JellyfinCredentials } from "@/components/jellyfin/JellyfinSignIn";
import { NewJellyfinAccountForm } from "@/components/jellyfin/NewJellyfinAccountForm";
import { FilterTabs } from "@/components/ui/FilterTabs";
import { InviteApiError, inviteApi } from "@/lib/invite-api";

/**
 * Invite state machine states
 */
type InviteState =
    | "loading" // Initial load, checking invitation
    | "not-found" // Invitation doesn't exist
    | "disabled" // Invitation is disabled/expired/maxed
    | "form" // Show request form (username + Stremio OAuth)
    | "pending" // Request submitted, waiting for admin approval
    | "rejected" // Request was rejected
    | "completed"; // Successfully joined (admin accepted, user auto-created)

/**
 * Public invite request page - Simplified flow
 *
 * Step 1: User enters username + does Stremio OAuth (single step)
 * Step 2: Admin accepts → user auto-created
 */
export default function InviteRequestPage() {
    const params = useParams();
    const inviteCode = params?.inviteCode as string;

    // Core state
    const [state, setState] = useState<InviteState>("loading");
    const [username, setUsername] = useState("");
    const [usernameError, setUsernameError] = useState<string | null>(null);
    const [email, setEmail] = useState("");
    const [isSubmitting, setIsSubmitting] = useState(false);
    // Which provider the person is joining with. Invites could only ever
    // create Stremio users before, so that stays the default.
    const [joinProvider, setJoinProvider] = useState<"stremio" | "nuvio" | "jellyfin">("stremio");
    const [groupName, setGroupName] = useState<string | undefined>();
    // An invitation that makes Jellyfin accounts, and whether this person wants one.
    const [jellyfinOffer, setJellyfinOffer] = useState<{ server: string } | null>(null);
    const [jellyfinMode, setJellyfinMode] = useState<"new" | "existing">("new");
    const [submitError, setSubmitError] = useState<string | null>(null);

    // Track if Stremio OAuth is ready (username entered)
    const [usernameConfirmed, setUsernameConfirmed] = useState(false);

    // LocalStorage key for persistence
    const storageKey = `invite_request_${inviteCode}`;

    // Polling ref
    const statusPollRef = useRef<number | null>(null);

    // Load saved state from localStorage
    useEffect(() => {
        if (typeof window === "undefined") {
            return;
        }

        const saved = localStorage.getItem(storageKey);
        if (saved) {
            try {
                const parsed = JSON.parse(saved);
                if (parsed.username) {
                    setUsername(parsed.username);
                }
                if (parsed.email) {
                    setEmail(parsed.email);
                }
            } catch {
                // Ignore parse errors
            }
        }
    }, [storageKey]);

    // Save state to localStorage
    const saveToStorage = useCallback(
        (
            data: Partial<{
                username: string;
                email: string;
            }>
        ) => {
            if (typeof window === "undefined") {
                return;
            }

            const existing = localStorage.getItem(storageKey);
            let current = {};
            if (existing) {
                try {
                    current = JSON.parse(existing);
                } catch {
                    // Ignore
                }
            }
            localStorage.setItem(storageKey, JSON.stringify({ ...current, ...data }));
        },
        [storageKey]
    );

    // Clear localStorage
    const clearStorage = useCallback(() => {
        if (typeof window === "undefined") {
            return;
        }
        localStorage.removeItem(storageKey);
    }, [storageKey]);

    useEffect(() => {
        if (!inviteCode) {
            setState("not-found");
            return;
        }
        document.title = "SlickSync - Invitation";
    }, [inviteCode]);

    useEffect(() => {
        if (groupName) {
            document.title = `SlickSync - Join ${groupName}`;
        }
    }, [groupName]);

    // Check invitation validity on mount
    useEffect(() => {
        if (!inviteCode) {
            setState("not-found");
            return;
        }

        const checkInvitation = async () => {
            try {
                const data = await inviteApi.checkInvitation(inviteCode);

                if (data.groupName) {
                    setGroupName(data.groupName);
                }
                if (data.jellyfinNewAccount) {
                    setJellyfinOffer(data.jellyfinNewAccount);
                }

                // If we have saved username+email, check their status FIRST
                const saved = localStorage.getItem(storageKey);
                if (saved) {
                    try {
                        const parsed = JSON.parse(saved);
                        if (parsed.email && parsed.username) {
                            const status = await inviteApi.checkStatus(
                                inviteCode,
                                parsed.email,
                                parsed.username
                            );
                            if (status.groupName) {
                                setGroupName(status.groupName);
                            }
                            if (status.status === "pending") {
                                setEmail(parsed.email);
                                setUsername(parsed.username);
                                setState("pending");
                                return;
                            }
                            if (status.status === "completed") {
                                setState("completed");
                                return;
                            }
                            if (status.status === "rejected") {
                                setState("rejected");
                                return;
                            }
                            // For 'accepted' in legacy flow, also treat as pending (will become completed soon)
                            if (status.status === "accepted") {
                                setEmail(parsed.email);
                                setUsername(parsed.username);
                                setState("pending");
                                return;
                            }
                        }
                    } catch {
                        // Fall through to validation check
                    }
                }

                // Check if invitation is usable for NEW requests
                const isMaxUsesReached =
                    data.maxUses != null && data.maxUses > 0 && data.currentUses >= data.maxUses;
                const isExpired = data.expiresAt && new Date(data.expiresAt) < new Date();

                if (!data.isActive || isMaxUsesReached || isExpired) {
                    setState("disabled");
                    return;
                }

                setState("form");
            } catch (error) {
                if (error instanceof InviteApiError && error.status === 404) {
                    setState("not-found");
                } else {
                    setState("form");
                }
            }
        };

        checkInvitation();
    }, [inviteCode, storageKey]);

    // Poll for status updates (pending state only)
    useEffect(() => {
        if (state !== "pending") {
            if (statusPollRef.current) {
                window.clearInterval(statusPollRef.current);
                statusPollRef.current = null;
            }
            return;
        }

        if (!(email && username)) {
            return;
        }

        const poll = async () => {
            try {
                const status = await inviteApi.checkStatus(inviteCode, email, username);
                if (status.status === "completed") {
                    setState("completed");
                    clearStorage();
                } else if (status.status === "rejected") {
                    setState("rejected");
                }
                // 'pending' or 'accepted' — keep polling
            } catch {
                // Silently handle polling errors
            }
        };

        statusPollRef.current = window.setInterval(poll, 3000);

        return () => {
            if (statusPollRef.current) {
                window.clearInterval(statusPollRef.current);
                statusPollRef.current = null;
            }
        };
    }, [state, email, username, inviteCode, clearStorage]);

    // Handle Stremio OAuth completion — submit the invite request
    // The Nuvio half of handleAuthKey below. What the card hands back is the
    // device code, not a credential - the server exchanged that already.
    const handleNuvioApproved = async (nuvioCode: string) => {
        if (!username.trim()) {
            setUsernameError("Username is required");
            return;
        }
        setIsSubmitting(true);
        setSubmitError(null);
        try {
            const result = await inviteApi.submitNuvioRequest(
                inviteCode,
                username.trim(),
                nuvioCode
            );
            const requestEmail = result?.email || "";
            saveToStorage({ email: requestEmail, username: username.trim() });
            setEmail(requestEmail);
            setState("pending");
        } catch (error) {
            setSubmitError(
                error instanceof Error ? error.message : "Could not complete the request"
            );
        } finally {
            setIsSubmitting(false);
        }
    };

    // Joining with a Jellyfin-compatible server. Errors are thrown back so the
    // sign-in form can show them where the person typed (a wrong password, a
    // missing PIN).
    // A new account the invitation makes: the same request, with a password instead of a sign-in.
    const handleNewJellyfinAccount = async (password: string) => {
        if (!username.trim()) {
            setUsernameError("Username is required");
            throw new Error("Pick a username first");
        }
        setSubmitError(null);
        try {
            const result = await inviteApi.submitNewJellyfinAccountRequest(
                inviteCode,
                username.trim(),
                password
            );
            const requestEmail = result?.email || "";
            saveToStorage({ email: requestEmail, username: username.trim() });
            setEmail(requestEmail);
            setState("pending");
        } catch (error) {
            if (error instanceof InviteApiError && error.code === "USERNAME_EXISTS") {
                setUsernameError("This username is already taken");
                setUsernameConfirmed(false);
            }
            throw error;
        }
    };

    const handleJellyfinCredentials = async (credentials: JellyfinCredentials) => {
        if (!username.trim()) {
            setUsernameError("Username is required");
            throw new Error("Pick a username first");
        }
        setSubmitError(null);
        try {
            const result = await inviteApi.submitJellyfinRequest(
                inviteCode,
                username.trim(),
                credentials as unknown as Record<string, string>
            );
            const requestEmail = result?.email || "";
            saveToStorage({ email: requestEmail, username: username.trim() });
            setEmail(requestEmail);
            setState("pending");
        } catch (error) {
            if (error instanceof InviteApiError) {
                if (error.code === "USERNAME_EXISTS") {
                    setUsernameError("This username is already taken");
                    setUsernameConfirmed(false);
                }
                if (error.code === "EMAIL_EXISTS" || error.code === "EMAIL_AND_USERNAME_EXIST") {
                    throw new Error("This server user is already registered", { cause: error });
                }
            }
            throw error;
        }
    };

    const handleAuthKey = async (authKey: string) => {
        if (!username.trim()) {
            setUsernameError("Username is required");
            return;
        }

        setIsSubmitting(true);
        setSubmitError(null);

        try {
            const result = await inviteApi.submitRequest(inviteCode, username.trim(), authKey);

            // The server returns the request with email derived from Stremio
            const requestEmail = result?.email || "";

            // Save to localStorage
            saveToStorage({ email: requestEmail, username: username.trim() });
            setEmail(requestEmail);

            // Move to pending state
            setState("pending");
        } catch (error) {
            if (error instanceof InviteApiError) {
                const code = error.code;

                if (code === "EMAIL_EXISTS" || code === "EMAIL_AND_USERNAME_EXIST") {
                    setSubmitError("This Stremio account is already registered");
                } else if (code === "USERNAME_EXISTS") {
                    setUsernameError("This username is already taken");
                    setUsernameConfirmed(false); // Let them change the username
                } else if (
                    error.message?.toLowerCase().includes("request already exists") ||
                    error.status === 409
                ) {
                    // Request already exists — recover by checking status
                    saveToStorage({ username: username.trim() });
                    try {
                        // We need email to check status — try to get it from the error or from the stored state
                        const savedData = localStorage.getItem(storageKey);
                        const parsedEmail = savedData ? JSON.parse(savedData).email : null;
                        if (parsedEmail) {
                            const status = await inviteApi.checkStatus(
                                inviteCode,
                                parsedEmail,
                                username.trim()
                            );
                            setEmail(parsedEmail);
                            if (status.status === "completed") {
                                setState("completed");
                            } else if (status.status === "rejected") {
                                setState("rejected");
                            } else {
                                setState("pending");
                            }
                        } else {
                            setState("pending");
                        }
                    } catch {
                        setState("pending");
                    }
                } else if (
                    error.message?.toLowerCase().includes("not active") ||
                    error.status === 400
                ) {
                    setState("disabled");
                } else {
                    setSubmitError(error.message || "Failed to submit request");
                }
            } else {
                setSubmitError("An unexpected error occurred");
            }
        } finally {
            setIsSubmitting(false);
        }
    };

    // Handle confirming the username before OAuth
    const handleConfirmUsername = () => {
        setUsernameError(null);
        if (!username.trim()) {
            setUsernameError("Username is required");
            return;
        }
        if (username.trim().length < 2) {
            setUsernameError("Username must be at least 2 characters");
            return;
        }
        setUsernameConfirmed(true);
    };

    // Handle new request (reset everything)
    const handleNewRequest = () => {
        clearStorage();
        setUsername("");
        setEmail("");
        setUsernameError(null);
        setSubmitError(null);
        setUsernameConfirmed(false);
        setState("form");
    };

    // Determine if we should show the "New Request" button
    const showNewRequestButton = state !== "loading" && state !== "form" && state !== "not-found";

    // Render content based on state
    const renderContent = () => {
        switch (state) {
            case "loading":
                return (
                    <div className="animate-pulse space-y-4">
                        <div
                            className="h-20 rounded-2xl"
                            style={{ backgroundColor: "var(--color-surface)" }}
                        />
                        <div
                            className="h-40 rounded-2xl"
                            style={{ backgroundColor: "var(--color-surface)" }}
                        />
                    </div>
                );

            case "not-found":
                return <StatusCards.NotFound />;

            case "disabled":
                return <StatusCards.Disabled />;

            case "form":
                return (
                    <motion.div
                        animate={{ opacity: 1, scale: 1 }}
                        className="interface-login-panel min-w-0 rounded-2xl p-6"
                        initial={{ opacity: 0, scale: 0.98 }}
                        style={{
                            backgroundColor: "var(--color-surface)",
                            border: "1px solid var(--color-surface-border)",
                        }}
                        transition={{ duration: 0.3 }}
                    >
                        {/* Header */}
                        <div className="mb-8 text-center">
                            <motion.div
                                animate={{ opacity: 1, scale: 1 }}
                                className="mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-2xl"
                                initial={{ opacity: 0, scale: 0.8 }}
                                style={{
                                    backgroundColor: "var(--color-primary-muted)",
                                }}
                                transition={{ delay: 0.1, duration: 0.4 }}
                            >
                                <UserIcon
                                    className="h-8 w-8"
                                    style={{ color: "var(--color-primary)" }}
                                />
                            </motion.div>
                            <motion.h1
                                animate={{ opacity: 1, y: 0 }}
                                className="mb-2 font-semibold text-2xl"
                                initial={{ opacity: 0, y: 10 }}
                                style={{ color: "var(--color-text)" }}
                                transition={{ delay: 0.15, duration: 0.3 }}
                            >
                                Request Access
                            </motion.h1>
                            <motion.p
                                animate={{ opacity: 1, y: 0 }}
                                className="text-sm"
                                initial={{ opacity: 0, y: 10 }}
                                style={{ color: "var(--color-text-muted)" }}
                                transition={{ delay: 0.2, duration: 0.3 }}
                            >
                                Choose a username and connect your account to request access.
                            </motion.p>
                        </div>

                        {/* Step 1: Username input */}
                        <motion.div
                            animate={{ opacity: 1, y: 0 }}
                            className="space-y-4"
                            initial={{ opacity: 0, y: 10 }}
                            transition={{ delay: 0.25, duration: 0.3 }}
                        >
                            {/* Username field */}
                            <div>
                                <div className="relative">
                                    <div
                                        className={`absolute top-1/2 left-4 -translate-y-1/2 ${usernameError ? "text-error" : "text-subtle"}`}
                                    >
                                        <UserIcon className="h-5 w-5" />
                                    </div>
                                    <input
                                        className={`slicksync-input w-full rounded-xl py-3.5 pr-4 pl-12 transition-all duration-200 focus:outline-none ${usernameError ? "bd-err" : "bd-ok"}`}
                                        disabled={isSubmitting}
                                        onChange={(e) => {
                                            setUsername(e.target.value);
                                            setUsernameError(null);
                                            if (usernameConfirmed) {
                                                setUsernameConfirmed(false);
                                            }
                                        }}
                                        onKeyDown={(e) => {
                                            if (e.key === "Enter") {
                                                e.preventDefault();
                                                handleConfirmUsername();
                                            }
                                        }}
                                        placeholder="Username"
                                        required
                                        style={{
                                            backgroundColor: "var(--color-bg-subtle)",
                                            color: "var(--color-text)",
                                        }}
                                        type="text"
                                        value={username}
                                    />
                                </div>
                                {usernameError && (
                                    <motion.p
                                        animate={{ opacity: 1, y: 0 }}
                                        className="mt-2 text-sm"
                                        initial={{ opacity: 0, y: -5 }}
                                        style={{ color: "var(--color-error)" }}
                                    >
                                        {usernameError}
                                    </motion.p>
                                )}
                            </div>

                            {/* Step 2: Stremio OAuth (shown after username confirmed) */}
                            {usernameConfirmed ? (
                                <motion.div
                                    animate={{ opacity: 1, y: 0 }}
                                    initial={{ opacity: 0, y: 10 }}
                                    transition={{ duration: 0.3 }}
                                >
                                    {submitError && (
                                        <motion.p
                                            animate={{ opacity: 1, y: 0 }}
                                            className="mb-4 rounded-xl px-4 py-3 text-center text-sm"
                                            initial={{ opacity: 0, y: -5 }}
                                            style={{
                                                backgroundColor:
                                                    "var(--color-error-muted, rgba(239, 68, 68, 0.1))",
                                                color: "var(--color-error)",
                                            }}
                                        >
                                            {submitError}
                                        </motion.p>
                                    )}
                                    {/* Either provider can join, and the one picked here
                      decides what kind of user the invite creates. */}
                                    <FilterTabs
                                        activeKey={joinProvider}
                                        className="login-provider-tabs mb-5 w-full"
                                        fill
                                        onChange={(key) => {
                                            if (
                                                key === "stremio" ||
                                                key === "nuvio" ||
                                                key === "jellyfin"
                                            ) {
                                                setJoinProvider(key);
                                            }
                                        }}
                                        options={[
                                            { key: "stremio", label: "Stremio" },
                                            { key: "nuvio", label: "Nuvio" },
                                            { key: "jellyfin", label: "Jellyfin" },
                                        ]}
                                    />

                                    {joinProvider === "jellyfin" ? (
                                        <div className="space-y-3">
                                            {jellyfinOffer && (
                                                <div className="flex justify-center gap-2">
                                                    {(
                                                        [
                                                            ["new", "Make me an account"],
                                                            ["existing", "I already have one"],
                                                        ] as const
                                                    ).map(([mode, label]) => (
                                                        <button
                                                            aria-pressed={jellyfinMode === mode}
                                                            className={`rounded-lg px-3 py-1.5 font-medium text-xs transition-colors ${jellyfinMode === mode ? "bg-primary/20 text-primary" : "bg-white/[0.03] text-muted hover:bg-white/[0.06]"}`}
                                                            key={mode}
                                                            onClick={() => setJellyfinMode(mode)}
                                                            type="button"
                                                        >
                                                            {label}
                                                        </button>
                                                    ))}
                                                </div>
                                            )}
                                            {jellyfinOffer && jellyfinMode === "new" ? (
                                                <NewJellyfinAccountForm
                                                    onSubmit={handleNewJellyfinAccount}
                                                    server={jellyfinOffer.server}
                                                    username={username.trim()}
                                                />
                                            ) : (
                                                <>
                                                    <p
                                                        className="text-center text-sm"
                                                        style={{ color: "var(--color-text-muted)" }}
                                                    >
                                                        Sign in with the server you watch on -
                                                        Jellyfin, or the media server AIOStreams or
                                                        AIOMetadata runs for your apps.
                                                    </p>
                                                    <JellyfinSignIn
                                                        api={inviteApi.jellyfinSignIn(inviteCode)}
                                                        compact
                                                        onSubmit={handleJellyfinCredentials}
                                                        submitLabel="Request access"
                                                    />
                                                </>
                                            )}
                                        </div>
                                    ) : joinProvider === "stremio" ? (
                                        <StremioOAuthCard
                                            description="Connect your Stremio account to complete your request."
                                            isCompleting={isSubmitting}
                                            onAuthKey={handleAuthKey}
                                            onError={(msg) => setSubmitError(msg)}
                                            title="Sign in with Stremio"
                                        />
                                    ) : (
                                        <NuvioOAuthCard
                                            inviteCode={inviteCode}
                                            isCompleting={isSubmitting}
                                            onApproved={handleNuvioApproved}
                                            onError={(msg) => setSubmitError(msg)}
                                        />
                                    )}
                                </motion.div>
                            ) : (
                                <motion.button
                                    className="flex w-full items-center justify-center gap-2 rounded-xl py-3.5 font-medium transition-all duration-200"
                                    disabled={!username.trim() || isSubmitting}
                                    onClick={handleConfirmUsername}
                                    style={{
                                        backgroundColor: "var(--color-primary)",
                                        color: "var(--color-bg)",
                                        opacity: !username.trim() || isSubmitting ? 0.6 : 1,
                                    }}
                                    whileHover={username.trim() ? { scale: 1.01 } : {}}
                                    whileTap={username.trim() ? { scale: 0.99 } : {}}
                                >
                                    Continue
                                </motion.button>
                            )}
                        </motion.div>

                        {/* Info text */}
                        <motion.p
                            animate={{ opacity: 1 }}
                            className="mt-6 text-center text-xs"
                            initial={{ opacity: 0 }}
                            style={{ color: "var(--color-text-subtle)" }}
                            transition={{ delay: 0.4, duration: 0.3 }}
                        >
                            Your request will be reviewed by an administrator.
                            {!usernameConfirmed && (
                                <>
                                    <br />
                                    Choose your service in the next step.
                                </>
                            )}
                        </motion.p>
                    </motion.div>
                );

            case "pending":
                return <StatusCards.Pending />;

            case "rejected":
                return <StatusCards.Rejected />;

            case "completed":
                return <StatusCards.Completed />;

            default:
                return null;
        }
    };

    return (
        <InviteLayout onNewRequest={handleNewRequest} showNewRequestButton={showNewRequestButton}>
            {renderContent()}
        </InviteLayout>
    );
}
