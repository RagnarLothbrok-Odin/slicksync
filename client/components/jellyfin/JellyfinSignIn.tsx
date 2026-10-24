"use client";
import { readErrorMessage } from "@/lib/errors";

// Signing in to a Jellyfin-compatible server - a real Jellyfin, the media
// server an AIOStreams configuration runs, or AIOMetadata's. One flow for
// every place it is offered (Add User, the sign-in page, invitations): type
// the address, then either sign in as a user or approve a Quick Connect code.
//
// The parent supplies the calls, because each place reaches the server
// through its own API, and decides what a finished sign-in does. Nothing
// secret comes back to the browser: the server signs in when onSubmit is
// called with what the person typed.

import {
    ArrowPathIcon,
    CheckCircleIcon,
    EyeIcon,
    EyeSlashIcon,
    ServerStackIcon,
} from "@heroicons/react/24/outline";
import { useEffect, useRef, useState } from "react";

export interface JellyfinServerInfo {
    display: string;
    kind: "jellyfin" | "aiostreams" | "aiometadata";
    kindLabel: string;
    pinSignIn?: boolean;
    quickConnect: boolean;
    serverName: string;
    serverUrl: string;
    users: { id: string; name: string; hasPassword?: boolean }[];
    version?: string | null;
}

export type JellyfinCredentials =
    | { serverUrl: string; jellyfinUsername: string; password: string }
    | { serverUrl: string; quickConnectSecret: string; quickConnectDevice: string };

export interface JellyfinSignInApi {
    probe: (serverUrl: string) => Promise<JellyfinServerInfo>;
    quickConnectStatus: (params: {
        serverUrl: string;
        secret: string;
        device: string;
    }) => Promise<{ authenticated: boolean; expired?: boolean }>;
    startQuickConnect: (
        serverUrl: string
    ) => Promise<{ code: string; secret: string; device: string; serverUrl: string }>;
}

interface Props {
    api: JellyfinSignInApi;
    compact?: boolean;
    // Lets the parent prefill and remember the address, e.g. "add another
    // person from the same server".
    initialServerUrl?: string;
    onServerChange?: (server: JellyfinServerInfo | null) => void;
    onSubmit: (credentials: JellyfinCredentials, server: JellyfinServerInfo) => Promise<void>;
    submitLabel?: string;
}

const inputStyle = {
    background: "var(--color-bg)",
    border: "1px solid var(--color-surface-border)",
    color: "var(--color-text)",
} as const;

function initials(name: string) {
    return name.trim().slice(0, 2).toUpperCase();
}

export default function JellyfinSignIn({
    api,
    onSubmit,
    submitLabel = "Sign in",
    initialServerUrl = "",
    onServerChange,
    compact = false,
}: Props) {
    const [address, setAddress] = useState(initialServerUrl);
    const [server, setServer] = useState<JellyfinServerInfo | null>(null);
    const [checking, setChecking] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [method, setMethod] = useState<"password" | "quick">("password");
    const [loginName, setLoginName] = useState("");
    const [typingName, setTypingName] = useState(false);
    const [password, setPassword] = useState("");
    const [showPassword, setShowPassword] = useState(false);
    const [submitting, setSubmitting] = useState(false);
    const [pinHint, setPinHint] = useState(false);
    const [quick, setQuick] = useState<{
        code: string;
        secret: string;
        device: string;
        serverUrl: string;
    } | null>(null);
    const [quickStatus, setQuickStatus] = useState<
        "idle" | "starting" | "waiting" | "approved" | "expired"
    >("idle");
    const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

    useEffect(
        () => () => {
            if (pollRef.current) {
                clearInterval(pollRef.current);
            }
        },
        []
    );

    // Started on a known server (the next person from the same household):
    // go straight to who is signing in.
    useEffect(() => {
        if (initialServerUrl) {
            checkAddress(initialServerUrl);
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const stopPolling = () => {
        if (pollRef.current) {
            clearInterval(pollRef.current);
        }
        pollRef.current = null;
    };

    const checkAddress = async (value = address) => {
        if (!value.trim()) {
            setError("Enter the server address");
            return;
        }
        setChecking(true);
        setError(null);
        try {
            const info = await api.probe(value.trim());
            setServer(info);
            setAddress(info.serverUrl);
            setTypingName(info.users.length === 0);
            setLoginName("");
            setMethod("password");
            onServerChange?.(info);
        } catch (e) {
            setError(readErrorMessage(e, "Could not reach the server"));
        } finally {
            setChecking(false);
        }
    };

    const changeServer = () => {
        stopPolling();
        setServer(null);
        setQuick(null);
        setQuickStatus("idle");
        setError(null);
        onServerChange?.(null);
    };

    const submitPassword = async (e?: React.FormEvent) => {
        e?.preventDefault();
        if (!server) {
            return;
        }
        if (!loginName.trim()) {
            setError("Pick or type the user to sign in as");
            return;
        }
        setSubmitting(true);
        setError(null);
        setPinHint(false);
        try {
            await onSubmit(
                { jellyfinUsername: loginName.trim(), password, serverUrl: server.serverUrl },
                server
            );
        } catch (err: any) {
            setError(err?.message || "Could not sign in");
            if (err?.pinNeeded || err?.data?.pinNeeded || /pin/i.test(err?.message || "")) {
                setPinHint(true);
            }
        } finally {
            setSubmitting(false);
        }
    };

    const startQuick = async () => {
        if (!server) {
            return;
        }
        stopPolling();
        setQuickStatus("starting");
        setError(null);
        try {
            const started = await api.startQuickConnect(server.serverUrl);
            setQuick(started);
            setQuickStatus("waiting");
            pollRef.current = setInterval(async () => {
                try {
                    const status = await api.quickConnectStatus({
                        device: started.device,
                        secret: started.secret,
                        serverUrl: started.serverUrl,
                    });
                    if (status.expired) {
                        stopPolling();
                        setQuickStatus("expired");
                        return;
                    }
                    if (!status.authenticated) {
                        return;
                    }
                    stopPolling();
                    setQuickStatus("approved");
                    setSubmitting(true);
                    try {
                        await onSubmit(
                            {
                                quickConnectDevice: started.device,
                                quickConnectSecret: started.secret,
                                serverUrl: started.serverUrl,
                            },
                            server
                        );
                    } catch (err) {
                        setError(readErrorMessage(err, "Could not sign in"));
                        setQuickStatus("expired");
                    } finally {
                        setSubmitting(false);
                    }
                } catch {
                    /* keep waiting; a blip is not a failure */
                }
            }, 3000);
        } catch (e) {
            setQuickStatus("idle");
            setError(readErrorMessage(e, "Could not start Quick Connect"));
        }
    };

    const pickMethod = (next: "password" | "quick") => {
        setMethod(next);
        setError(null);
        if (next === "quick" && quickStatus === "idle") {
            startQuick();
        }
        if (next === "password") {
            stopPolling();
        }
    };

    const isAio = server && server.kind !== "jellyfin";

    return (
        <div className="space-y-4">
            {server ? (
                <>
                    {/* The server, as a tile */}
                    <div
                        className="flex items-center gap-3 rounded-2xl p-3"
                        style={{
                            background: "var(--color-surface-hover)",
                            border: "1px solid var(--color-surface-border)",
                        }}
                    >
                        <div
                            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl"
                            style={{ background: "var(--color-subtle)" }}
                        >
                            <ServerStackIcon
                                className="h-5 w-5"
                                style={{ color: "var(--color-primary)" }}
                            />
                        </div>
                        <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2">
                                <span
                                    className="truncate font-semibold"
                                    style={{ color: "var(--color-text)" }}
                                >
                                    {server.serverName}
                                </span>
                                <span
                                    className="shrink-0 rounded-full px-2 py-0.5 font-bold text-[10px] uppercase tracking-wider"
                                    style={{
                                        background:
                                            "color-mix(in srgb, var(--color-primary) 18%, transparent)",
                                        color: "var(--color-primary)",
                                    }}
                                >
                                    {server.kindLabel}
                                </span>
                            </div>
                            <p
                                className="truncate text-xs"
                                style={{ color: "var(--color-text-muted)" }}
                            >
                                {server.display}
                            </p>
                        </div>
                        <button
                            className="rounded-lg px-2 py-1 font-medium text-xs"
                            onClick={changeServer}
                            style={{ color: "var(--color-text-muted)" }}
                            type="button"
                        >
                            Change
                        </button>
                    </div>

                    {/* How to sign in */}
                    {server.quickConnect && (
                        <div className="flex gap-2 rounded-lg bg-bg-subtle p-1">
                            <button
                                className={`flex-1 rounded-md px-3 py-1.5 font-medium text-xs transition-all ${method === "password" ? "bg-surface text-default shadow-sm" : "text-muted hover:text-default"}`}
                                onClick={() => pickMethod("password")}
                                type="button"
                            >
                                User and password
                            </button>
                            <button
                                className={`flex-1 rounded-md px-3 py-1.5 font-medium text-xs transition-all ${method === "quick" ? "bg-surface text-default shadow-sm" : "text-muted hover:text-default"}`}
                                onClick={() => pickMethod("quick")}
                                type="button"
                            >
                                Quick Connect
                            </button>
                        </div>
                    )}

                    {method === "password" ? (
                        <form className="space-y-3" onSubmit={submitPassword}>
                            {!typingName && server.users.length > 0 ? (
                                <div>
                                    <span
                                        className="mb-2 block font-medium text-sm"
                                        style={{ color: "var(--color-text)" }}
                                    >
                                        Who is signing in?
                                    </span>
                                    <div
                                        className={`grid gap-2 ${compact ? "grid-cols-3" : "grid-cols-3 sm:grid-cols-4"}`}
                                    >
                                        {server.users.map((u) => {
                                            const selected = loginName === u.name;
                                            return (
                                                <button
                                                    className={`flex flex-col items-center gap-1.5 rounded-xl p-2 transition-all ${selected ? "user-tile-on" : "user-tile-off"}`}
                                                    key={u.id}
                                                    onClick={() => {
                                                        setLoginName(u.name);
                                                        setError(null);
                                                    }}
                                                    type="button"
                                                >
                                                    <span
                                                        className="flex h-10 w-10 items-center justify-center rounded-full font-bold text-sm"
                                                        style={{
                                                            background: "var(--color-subtle)",
                                                            color: "var(--color-text)",
                                                        }}
                                                    >
                                                        {initials(u.name)}
                                                    </span>
                                                    <span
                                                        className="max-w-full truncate font-medium text-xs"
                                                        style={{ color: "var(--color-text)" }}
                                                    >
                                                        {u.name}
                                                    </span>
                                                </button>
                                            );
                                        })}
                                    </div>
                                    <button
                                        className="mt-2 text-xs"
                                        onClick={() => {
                                            setTypingName(true);
                                            setLoginName("");
                                        }}
                                        style={{ color: "var(--color-text-muted)" }}
                                        type="button"
                                    >
                                        Someone not listed? Type their name
                                    </button>
                                </div>
                            ) : (
                                <div>
                                    <label
                                        className="mb-2 block font-medium text-sm"
                                        htmlFor="jellyfin-user"
                                        style={{ color: "var(--color-text)" }}
                                    >
                                        User name
                                    </label>
                                    <input
                                        autoComplete="username"
                                        className="w-full rounded-xl px-4 py-3 text-sm"
                                        id="jellyfin-user"
                                        onChange={(e) => setLoginName(e.target.value)}
                                        placeholder={
                                            isAio
                                                ? "Configuration UUID, or UUID/name"
                                                : "Their Jellyfin user name"
                                        }
                                        style={inputStyle}
                                        type="text"
                                        value={loginName}
                                    />
                                    {isAio && (
                                        <p
                                            className="mt-2 text-xs"
                                            style={{ color: "var(--color-text-muted)" }}
                                        >
                                            On this address, sign in with the configuration UUID (or
                                            its alias). For someone else in the household, add a
                                            slash and their name: UUID/Sam.
                                        </p>
                                    )}
                                    {server.users.length > 0 && (
                                        <button
                                            className="mt-2 text-xs"
                                            onClick={() => setTypingName(false)}
                                            style={{ color: "var(--color-text-muted)" }}
                                            type="button"
                                        >
                                            Pick from the list instead
                                        </button>
                                    )}
                                </div>
                            )}

                            <div>
                                <label
                                    className="mb-2 block font-medium text-sm"
                                    htmlFor="jellyfin-password"
                                    style={{ color: "var(--color-text)" }}
                                >
                                    Password
                                </label>
                                <div className="relative">
                                    <input
                                        autoComplete="current-password"
                                        className="w-full rounded-xl py-3 pr-12 pl-4 text-sm"
                                        id="jellyfin-password"
                                        onChange={(e) => setPassword(e.target.value)}
                                        style={inputStyle}
                                        type={showPassword ? "text" : "password"}
                                        value={password}
                                    />
                                    <button
                                        aria-label={
                                            showPassword ? "Hide password" : "Show password"
                                        }
                                        className="absolute top-1/2 right-3 -translate-y-1/2 p-1"
                                        onClick={() => setShowPassword((v) => !v)}
                                        style={{ color: "var(--color-text-muted)" }}
                                        type="button"
                                    >
                                        {showPassword ? (
                                            <EyeSlashIcon className="h-5 w-5" />
                                        ) : (
                                            <EyeIcon className="h-5 w-5" />
                                        )}
                                    </button>
                                </div>
                                {(isAio || pinHint) && (
                                    <p
                                        className={`mt-2 text-xs ${pinHint ? "pin-hint-on" : "text-muted"}`}
                                    >
                                        {isAio ? "The configuration password. " : ""}A user with a
                                        PIN: add it after the password, like password/1234.
                                    </p>
                                )}
                            </div>

                            {error && (
                                <p
                                    className="text-sm"
                                    style={{ color: "var(--color-error, #ef4444)" }}
                                >
                                    {error}
                                </p>
                            )}

                            <button
                                className="flex w-full items-center justify-center gap-2 rounded-xl py-3 font-medium"
                                disabled={submitting}
                                style={{
                                    background: "var(--color-primary)",
                                    color: "white",
                                    opacity: submitting ? 0.6 : 1,
                                }}
                                type="submit"
                            >
                                {submitting ? (
                                    <span className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
                                ) : null}
                                {submitting ? "Signing in…" : submitLabel}
                            </button>
                        </form>
                    ) : (
                        <div className="space-y-3 text-center">
                            {quickStatus === "starting" && (
                                <div className="flex justify-center py-6">
                                    <span
                                        className="h-6 w-6 animate-spin rounded-full border-2 border-current border-t-transparent"
                                        style={{ color: "var(--color-primary)" }}
                                    />
                                </div>
                            )}
                            {(quickStatus === "waiting" || quickStatus === "approved") && quick && (
                                <>
                                    <div
                                        className="rounded-2xl py-4"
                                        style={{
                                            background: "var(--color-surface-hover)",
                                            border: "1px solid var(--color-surface-border)",
                                        }}
                                    >
                                        <div
                                            className="font-bold font-mono text-4xl tracking-[0.3em]"
                                            style={{ color: "var(--color-text)" }}
                                        >
                                            {quick.code}
                                        </div>
                                    </div>
                                    <p
                                        className="text-sm"
                                        style={{ color: "var(--color-text-muted)" }}
                                    >
                                        {server.kind === "jellyfin"
                                            ? "Approve this code in a Jellyfin app that is already signed in: Settings, then Quick Connect."
                                            : "Approve this code on the configure page, under Jellyfin apps, then Quick Connect."}
                                    </p>
                                    <div
                                        className={`flex items-center justify-center gap-2 text-sm ${quickStatus === "approved" ? "quick-approved" : "text-muted"}`}
                                    >
                                        {quickStatus === "approved" ? (
                                            <>
                                                <CheckCircleIcon className="h-5 w-5" /> Approved,
                                                signing in…
                                            </>
                                        ) : (
                                            <>
                                                <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-t-transparent" />{" "}
                                                Waiting for approval
                                            </>
                                        )}
                                    </div>
                                </>
                            )}
                            {quickStatus === "expired" && (
                                <button
                                    className="flex w-full items-center justify-center gap-2 rounded-xl py-3 font-medium"
                                    onClick={startQuick}
                                    style={{ background: "var(--color-primary)", color: "white" }}
                                    type="button"
                                >
                                    <ArrowPathIcon className="h-5 w-5" /> Get a new code
                                </button>
                            )}
                            {error && (
                                <p
                                    className="text-sm"
                                    style={{ color: "var(--color-error, #ef4444)" }}
                                >
                                    {error}
                                </p>
                            )}
                        </div>
                    )}
                </>
            ) : (
                <form
                    className="space-y-3"
                    onSubmit={(e) => {
                        e.preventDefault();
                        checkAddress();
                    }}
                >
                    <div>
                        <label
                            className="mb-2 block font-medium text-sm"
                            htmlFor="jellyfin-address"
                            style={{ color: "var(--color-text)" }}
                        >
                            Server address
                        </label>
                        <input
                            autoComplete="url"
                            className="w-full rounded-xl px-4 py-3 text-sm"
                            id="jellyfin-address"
                            inputMode="url"
                            onChange={(e) => setAddress(e.target.value)}
                            placeholder="jellyfin.example.com"
                            style={inputStyle}
                            type="text"
                            value={address}
                        />
                        <p className="mt-2 text-xs" style={{ color: "var(--color-text-muted)" }}>
                            The address you open Jellyfin at. For AIOStreams or AIOMetadata, the
                            address shown under Jellyfin apps on its configure page.
                        </p>
                    </div>
                    <button
                        className="flex w-full items-center justify-center gap-2 rounded-xl py-3 font-medium"
                        disabled={checking}
                        style={{
                            background: "var(--color-primary)",
                            color: "white",
                            opacity: checking ? 0.6 : 1,
                        }}
                        type="submit"
                    >
                        {checking ? (
                            <span className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
                        ) : null}
                        {checking ? "Checking…" : "Continue"}
                    </button>
                </form>
            )}
            {!server && error && (
                <p className="text-sm" style={{ color: "var(--color-error, #ef4444)" }}>
                    {error}
                </p>
            )}
        </div>
    );
}
