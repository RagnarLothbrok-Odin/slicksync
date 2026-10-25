"use client";

import { ArrowPathIcon, ArrowTopRightOnSquareIcon } from "@heroicons/react/24/outline";
import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import { VerificationCode } from "@/components/ui/VerificationCode";
import { copyToClipboard } from "@/lib/clipboard";
import { inviteApi } from "@/lib/invite-api";

interface NuvioOAuthCardProps {
    description?: string;
    disabled?: boolean;
    /** The invitation this sign-in belongs to - the flow is gated on it. */
    inviteCode: string;
    isCompleting?: boolean;
    /** Called with the device code once Nuvio has approved the sign-in. */
    onApproved: (nuvioCode: string) => Promise<void>;
    onError?: (message: string) => void;
    title?: string;
}

/**
 * Nuvio device sign-in for someone joining by invite.
 *
 * Unlike the Stremio card next to it, which talks to Stremio's link service
 * from the browser, this drives SlickSync's own endpoints: the exchange that
 * turns an approved code into a refresh token happens on the server, so the
 * credential never passes through the page.
 */
export function NuvioOAuthCard({
    inviteCode,
    onApproved,
    onError,
    disabled = false,
    isCompleting = false,
    title = "Sign in with Nuvio",
    description = "Open Nuvio on any device and enter this code to complete your request.",
}: NuvioOAuthCardProps) {
    const [code, setCode] = useState<string | null>(null);
    const [webUrl, setWebUrl] = useState<string | null>(null);
    const [expiresAt, setExpiresAt] = useState<number | null>(null);
    const [isStarting, setIsStarting] = useState(false);
    const [isWaiting, setIsWaiting] = useState(false);
    const [failed, setFailed] = useState(false);
    const deadline = useRef<number | null>(null);
    const [copied, setCopied] = useState(false);
    const [secondsLeft, setSecondsLeft] = useState<number | null>(null);

    // Held in a ref rather than state: the poll loop reads them and they must
    // never trigger a re-render, and they must never reach anything rendered.
    const session = useRef<{ code: string; deviceNonce: string; anonToken: string } | null>(null);
    const pollTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
    const cancelled = useRef(false);
    const started = useRef(false);
    const callbacks = useRef({ onApproved, onError });
    callbacks.current = { onApproved, onError };

    useEffect(() => {
        cancelled.current = false;
        return () => {
            cancelled.current = true;
            if (pollTimer.current) {
                clearTimeout(pollTimer.current);
            }
        };
    }, []);

    // Countdown, purely so the code on screen visibly goes stale rather than
    // silently failing when it does.
    useEffect(() => {
        if (!expiresAt) {
            return;
        }
        const tick = () => setSecondsLeft(Math.max(0, Math.round((expiresAt - Date.now()) / 1000)));
        tick();
        const id = setInterval(tick, 1000);
        return () => clearInterval(id);
    }, [expiresAt]);

    const poll = useCallback(
        async (intervalSeconds: number) => {
            if (cancelled.current || !session.current) {
                return;
            }
            if (deadline.current && Date.now() >= deadline.current) {
                setIsWaiting(false);
                return;
            }
            try {
                const res = await inviteApi.pollNuvioLogin(inviteCode, session.current);
                if (cancelled.current) {
                    return;
                }
                if (res?.status === "authorized") {
                    setIsWaiting(false);
                    await callbacks.current.onApproved(session.current.code);
                    return;
                }
                pollTimer.current = setTimeout(() => poll(intervalSeconds), intervalSeconds * 1000);
            } catch (err) {
                if (cancelled.current) {
                    return;
                }
                setIsWaiting(false);
                setFailed(true);
                callbacks.current.onError?.(
                    err instanceof Error ? err.message : "Could not check the Nuvio sign-in"
                );
            }
        },
        [inviteCode]
    );

    const start = useCallback(async () => {
        if (pollTimer.current) {
            clearTimeout(pollTimer.current);
        }
        setIsStarting(true);
        setFailed(false);
        try {
            const s = await inviteApi.startNuvioLogin(inviteCode);
            if (cancelled.current) {
                return;
            }
            session.current = { anonToken: s.anonToken, code: s.code, deviceNonce: s.deviceNonce };
            setCode(s.code);
            setWebUrl(s.webUrl || null);
            deadline.current = s.expiresAt ? new Date(s.expiresAt).getTime() : null;
            setExpiresAt(deadline.current);
            setIsWaiting(true);
            poll(s.pollIntervalSeconds || 5);
        } catch (err) {
            if (cancelled.current) {
                return;
            }
            setFailed(true);
            callbacks.current.onError?.(
                err instanceof Error ? err.message : "Could not start the Nuvio sign-in"
            );
        } finally {
            if (!cancelled.current) {
                setIsStarting(false);
            }
        }
    }, [inviteCode, poll]);

    // Generate once on selection; callback changes must not restart approval.
    useEffect(() => {
        if (disabled || started.current) {
            return;
        }
        started.current = true;
        void start();
    }, [disabled, start]);

    const copy = async () => {
        if (!code) {
            return;
        }
        if (await copyToClipboard(code)) {
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
        }
    };

    const expired = secondsLeft !== null && secondsLeft <= 0;
    const busy = disabled || isCompleting || isStarting;

    return (
        <div className="min-w-0 space-y-4">
            <p className="text-center text-muted text-sm">{description}</p>
            <Button
                className="w-full"
                disabled={!webUrl || busy || expired}
                isLoading={isStarting || isCompleting}
                leftIcon={<ArrowTopRightOnSquareIcon className="h-5 w-5" />}
                onClick={() => {
                    if (webUrl) {
                        window.open(webUrl, "_blank", "noopener,noreferrer");
                    }
                }}
            >
                {isCompleting ? "Submitting request..." : "Open Nuvio"}
            </Button>
            <div className="space-y-3 pt-2 text-center">
                <p className="font-medium text-muted text-xs">Verification Code</p>
                <VerificationCode code={code || ""} copied={copied} onCopy={copy} />
                <p className="text-muted text-xs" role="status">
                    {failed
                        ? "Could not complete sign-in. Please try again."
                        : expired
                          ? "That code has expired."
                          : isWaiting
                            ? `Waiting for authorization${secondsLeft === null ? "" : ` · ${Math.floor(secondsLeft / 60)}:${String(secondsLeft % 60).padStart(2, "0")} left`}`
                            : isStarting
                              ? "Preparing your code..."
                              : code
                                ? "Approved."
                                : "Could not prepare a code."}
                </p>
            </div>
            {(failed || expired || !(code || isStarting)) && (
                <Button
                    className="w-full"
                    disabled={busy}
                    leftIcon={<ArrowPathIcon className="h-4 w-4" />}
                    onClick={start}
                    variant="secondary"
                >
                    Get a new code
                </Button>
            )}
            <span className="sr-only">{title}</span>
        </div>
    );
}
