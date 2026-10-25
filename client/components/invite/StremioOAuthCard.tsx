"use client";

import { ArrowPathIcon, ArrowTopRightOnSquareIcon } from "@heroicons/react/24/outline";
import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import { VerificationCode } from "@/components/ui/VerificationCode";
import { copyToClipboard } from "@/lib/clipboard";
import { readErrorMessage } from "@/lib/errors";
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
        } catch (err) {
            const message = readErrorMessage(err, "Failed to generate OAuth link");
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

    return (
        <div className="min-w-0 space-y-4">
            <p className="text-center text-muted text-sm">{description}</p>
            <Button
                className="w-full"
                disabled={!oauthLink || disabled || isExpired || isCompleting}
                isLoading={isCompleting || isGenerating}
                leftIcon={<ArrowTopRightOnSquareIcon className="h-5 w-5" />}
                onClick={openLink}
            >
                {isCompleting ? "Submitting request..." : "Open Stremio"}
            </Button>
            <div className="space-y-3 pt-2 text-center">
                <p className="text-muted text-sm">
                    Copy the code and paste it at{" "}
                    <a
                        className="text-primary underline hover:no-underline"
                        href="https://link.stremio.com"
                        rel="noopener noreferrer"
                        target="_blank"
                    >
                        link.stremio.com
                    </a>
                </p>
                <VerificationCode code={oauthCode} copied={copied} onCopy={copyCode} />
                {timeLeft && (
                    <p className="text-muted text-xs">
                        {isExpired ? "Expired" : `Expires in ${timeLeft}`}
                    </p>
                )}
            </div>
            {error && (
                <p className="text-center text-error text-sm" role="alert">
                    {error}
                </p>
            )}
            {!hasAdminLink && (isExpired || error) && (
                <Button
                    className="w-full"
                    disabled={disabled}
                    isLoading={isGenerating}
                    leftIcon={<ArrowPathIcon className="h-4 w-4" />}
                    onClick={generateLink}
                    variant="secondary"
                >
                    Get a new code
                </Button>
            )}
            {isPolling && !isExpired && !error && (
                <p className="text-center text-muted text-xs" role="status">
                    Waiting for authorization...
                </p>
            )}
            <span className="sr-only">{title}</span>
        </div>
    );
}
