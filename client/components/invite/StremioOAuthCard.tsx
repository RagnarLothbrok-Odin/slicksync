"use client";

import {
    ArrowPathIcon,
    ArrowTopRightOnSquareIcon,
    CheckCircleIcon,
    CheckIcon,
    ClipboardIcon,
} from "@heroicons/react/24/outline";
import { motion } from "framer-motion";
import { useCallback, useEffect, useRef, useState } from "react";
import { copyToClipboard } from "@/lib/clipboard";
import { stremioOAuth } from "@/lib/invite-api";

interface StremioOAuthCardProps {
    /** Description for the card */
    description?: string;
    /** Whether the card is disabled */
    disabled?: boolean;
    /** OAuth code provided by admin */
    initialCode?: string | null;
    /** Expiration timestamp */
    initialExpiresAt?: string | null;
    /** OAuth link provided by admin (if already generated) */
    initialLink?: string | null;
    /** Whether we're in completing state (called from parent) */
    isCompleting?: boolean;
    /** Called when OAuth completes with auth key */
    onAuthKey: (authKey: string) => Promise<void>;
    /** Called on error */
    onError?: (message: string) => void;
    /** Title for the card */
    title?: string;
}

/**
 * Stremio OAuth card for authenticating with Stremio
 *
 * Supports two modes:
 * 1. Admin-generated link: Uses initialLink/initialCode props
 * 2. Self-generated link: Creates link via Stremio API
 */
export function StremioOAuthCard({
    initialLink,
    initialCode,
    initialExpiresAt,
    onAuthKey,
    onError,
    disabled = false,
    isCompleting = false,
    title = "Complete with Stremio",
    description = "Sign in with your Stremio account to complete the setup.",
}: StremioOAuthCardProps) {
    // OAuth state
    const [oauthLink, setOAuthLink] = useState<string | null>(initialLink || null);
    const [oauthCode, setOAuthCode] = useState<string>(initialCode || "");
    const [oauthExpiresAt, setOAuthExpiresAt] = useState<number | null>(
        initialExpiresAt ? new Date(initialExpiresAt).getTime() : null
    );

    // UI state
    const [isGenerating, setIsGenerating] = useState(false);
    const [isPolling, setIsPolling] = useState(!!initialCode);
    const [copied, setCopied] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [timeLeft, setTimeLeft] = useState<string | null>(null);

    // Refs for cleanup
    const pollIntervalRef = useRef<number | null>(null);
    const timerIntervalRef = useRef<number | null>(null);

    // Check if OAuth is expired
    const isExpired = oauthExpiresAt ? oauthExpiresAt < Date.now() : false;

    // Has admin-provided link (can't refresh)
    const hasAdminLink = !!initialCode;

    // Update state when initial props change
    useEffect(() => {
        if (initialLink) {
            setOAuthLink(initialLink);
            setIsPolling(true);
        }
        if (initialCode) {
            setOAuthCode(initialCode);
            setIsPolling(true);
        }
        if (initialExpiresAt) {
            setOAuthExpiresAt(new Date(initialExpiresAt).getTime());
        }
    }, [initialLink, initialCode, initialExpiresAt]);

    // Timer for countdown
    useEffect(() => {
        if (!oauthExpiresAt || isExpired) {
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
    }, [oauthExpiresAt, isExpired]);

    // Poll for OAuth completion
    useEffect(() => {
        if (!(isPolling && oauthCode) || isExpired || disabled || isCompleting) {
            return;
        }

        const poll = async () => {
            try {
                const result = await stremioOAuth.poll(oauthCode);

                if (result.success && result.authKey) {
                    setIsPolling(false);
                    if (pollIntervalRef.current) {
                        window.clearInterval(pollIntervalRef.current);
                    }
                    await onAuthKey(result.authKey);
                } else if (result.error) {
                    setError(result.error);
                    onError?.(result.error);
                }
            } catch {
                // Silently handle polling errors
            }
        };

        // Initial poll
        poll();

        // Set up interval
        pollIntervalRef.current = window.setInterval(poll, 3000);

        return () => {
            if (pollIntervalRef.current) {
                window.clearInterval(pollIntervalRef.current);
            }
        };
    }, [isPolling, oauthCode, isExpired, disabled, isCompleting, onAuthKey, onError]);

    // Generate new OAuth link
    const generateLink = useCallback(async () => {
        if (isGenerating || disabled || hasAdminLink) {
            return;
        }

        setIsGenerating(true);
        setError(null);

        try {
            const result = await stremioOAuth.create();
            setOAuthLink(result.link);
            setOAuthCode(result.code);
            setOAuthExpiresAt(result.expiresAt);
            setIsPolling(true);
        } catch (err: any) {
            const message = err?.message || "Failed to generate OAuth link";
            setError(message);
            onError?.(message);
        } finally {
            setIsGenerating(false);
        }
    }, [isGenerating, disabled, hasAdminLink, onError]);

    // Auto-generate if no initial link
    useEffect(() => {
        if (!(initialLink || initialCode || oauthLink)) {
            generateLink();
        }
    }, [initialLink, initialCode, oauthLink, generateLink]);

    // Copy code to clipboard
    const copyCode = useCallback(() => {
        if (!oauthCode) {
            return;
        }
        copyToClipboard(oauthCode);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    }, [oauthCode]);

    // Open OAuth link
    const openLink = useCallback(() => {
        if (!oauthLink || disabled) {
            return;
        }
        window.open(oauthLink, "_blank", "noopener,noreferrer");
    }, [oauthLink, disabled]);

    // Time left color based on urgency
    const getTimeColor = () => {
        if (!oauthExpiresAt) {
            return "var(--color-text-subtle)";
        }
        const diff = oauthExpiresAt - Date.now();
        if (diff < 60_000) {
            return "var(--color-error)"; // < 1 min
        }
        if (diff < 120_000) {
            return "var(--color-warning)"; // < 2 min
        }
        return "var(--color-text-subtle)";
    };

    return (
        <motion.div
            animate={{ opacity: 1, scale: 1 }}
            className="overflow-hidden rounded-2xl"
            initial={{ opacity: 0, scale: 0.98 }}
            style={{
                backgroundColor: "var(--color-surface)",
                border: "1px solid var(--color-surface-border)",
            }}
            transition={{ duration: 0.3 }}
        >
            {/* Top accent */}
            <div className="h-1" style={{ backgroundColor: "var(--color-success)" }} />

            <div className="p-8">
                {/* Icon */}
                <motion.div
                    animate={{ opacity: 1, scale: 1 }}
                    className="mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-2xl"
                    initial={{ opacity: 0, scale: 0.8 }}
                    style={{ backgroundColor: "var(--color-success-muted)" }}
                    transition={{ delay: 0.1, duration: 0.4 }}
                >
                    <CheckCircleIcon
                        className="h-8 w-8"
                        style={{ color: "var(--color-success)" }}
                    />
                </motion.div>

                {/* Title */}
                <motion.h2
                    animate={{ opacity: 1, y: 0 }}
                    className="mb-2 text-center font-semibold text-2xl"
                    initial={{ opacity: 0, y: 10 }}
                    style={{ color: "var(--color-text)" }}
                    transition={{ delay: 0.15, duration: 0.3 }}
                >
                    {title}
                </motion.h2>

                {/* Description */}
                <motion.p
                    animate={{ opacity: 1, y: 0 }}
                    className="mb-6 text-center text-sm"
                    initial={{ opacity: 0, y: 10 }}
                    style={{ color: "var(--color-text-muted)" }}
                    transition={{ delay: 0.2, duration: 0.3 }}
                >
                    {description}
                </motion.p>

                {/* OAuth Actions */}
                <motion.div
                    animate={{ opacity: 1, y: 0 }}
                    className="space-y-4"
                    initial={{ opacity: 0, y: 10 }}
                    transition={{ delay: 0.25, duration: 0.3 }}
                >
                    {/* Main button - Open Stremio */}
                    <button
                        className="flex w-full items-center justify-center gap-2 rounded-xl py-3.5 font-medium transition-all"
                        disabled={!oauthLink || disabled || isExpired || isCompleting}
                        onClick={openLink}
                        style={{
                            backgroundColor: "var(--color-primary)",
                            color: "var(--color-bg)",
                            opacity: !oauthLink || disabled || isExpired || isCompleting ? 0.5 : 1,
                        }}
                    >
                        {isCompleting ? (
                            <>
                                <span className="h-5 w-5 animate-spin rounded-full border-2 border-current border-t-transparent" />
                                <span>Creating Account...</span>
                            </>
                        ) : isGenerating ? (
                            <>
                                <span className="h-5 w-5 animate-spin rounded-full border-2 border-current border-t-transparent" />
                                <span>Generating Link...</span>
                            </>
                        ) : (
                            <>
                                <ArrowTopRightOnSquareIcon className="h-5 w-5" />
                                <span>Open Stremio</span>
                            </>
                        )}
                    </button>

                    {/* Divider */}
                    <div className="flex items-center gap-3">
                        <div
                            className="h-px flex-1"
                            style={{ backgroundColor: "var(--color-surface-border)" }}
                        />
                        <span
                            className="text-xs uppercase tracking-wider"
                            style={{ color: "var(--color-text-subtle)" }}
                        >
                            or
                        </span>
                        <div
                            className="h-px flex-1"
                            style={{ backgroundColor: "var(--color-surface-border)" }}
                        />
                    </div>

                    {/* Manual code entry */}
                    <div className="space-y-3 text-center">
                        <p className="text-sm" style={{ color: "var(--color-text-muted)" }}>
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

                        {/* Code display */}
                        <button
                            className="inline-flex items-center gap-2 rounded-lg px-4 py-2 transition-all"
                            disabled={!oauthCode}
                            onClick={copyCode}
                            style={{
                                backgroundColor: "var(--color-bg-subtle)",
                                border: "1px solid var(--color-surface-border)",
                            }}
                        >
                            <span
                                className="font-mono text-lg tracking-widest"
                                style={{ color: "var(--color-text)" }}
                            >
                                {oauthCode || "----"}
                            </span>
                            {copied ? (
                                <CheckIcon
                                    className="h-4 w-4"
                                    style={{ color: "var(--color-success)" }}
                                />
                            ) : (
                                <ClipboardIcon
                                    className="h-4 w-4"
                                    style={{ color: "var(--color-text-muted)" }}
                                />
                            )}
                        </button>
                    </div>

                    {/* Timer and refresh */}
                    <div className="flex items-center justify-center gap-4 pt-2">
                        {timeLeft && (
                            <span className="font-mono text-sm" style={{ color: getTimeColor() }}>
                                {timeLeft}
                            </span>
                        )}

                        {!hasAdminLink && (
                            <button
                                className="flex items-center gap-1 text-sm transition-all hover:underline"
                                disabled={isGenerating || disabled}
                                onClick={generateLink}
                                style={{ color: "var(--color-text-muted)" }}
                            >
                                <ArrowPathIcon
                                    className={`h-4 w-4 ${isGenerating ? "animate-spin" : ""}`}
                                />
                                <span>Refresh</span>
                            </button>
                        )}
                    </div>

                    {/* Error message */}
                    {error && (
                        <motion.p
                            animate={{ opacity: 1, y: 0 }}
                            className="text-center text-sm"
                            initial={{ opacity: 0, y: -5 }}
                            style={{ color: "var(--color-error)" }}
                        >
                            {error}
                        </motion.p>
                    )}

                    {/* Polling indicator */}
                    {isPolling && !isExpired && !error && (
                        <div className="flex items-center justify-center gap-2">
                            <div className="flex gap-1">
                                {[0, 1, 2].map((i) => (
                                    <motion.div
                                        animate={{
                                            opacity: [0.4, 1, 0.4],
                                            scale: [1, 1.3, 1],
                                        }}
                                        className="h-1.5 w-1.5 rounded-full"
                                        key={i}
                                        style={{ backgroundColor: "var(--color-success)" }}
                                        transition={{
                                            delay: i * 0.2,
                                            duration: 1,
                                            repeat: Number.POSITIVE_INFINITY,
                                        }}
                                    />
                                ))}
                            </div>
                            <span className="text-xs" style={{ color: "var(--color-text-subtle)" }}>
                                Waiting for authorization...
                            </span>
                        </div>
                    )}
                </motion.div>
            </div>
        </motion.div>
    );
}
