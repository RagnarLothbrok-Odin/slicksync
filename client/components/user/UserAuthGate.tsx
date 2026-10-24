"use client";

import { motion } from "framer-motion";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { useUserAuth } from "@/lib/hooks/useUserAuth";

interface UserAuthGateProps {
    children: React.ReactNode;
}

/**
 * Auth gate for user panel routes
 * Redirects to login if not authenticated
 */
export function UserAuthGate({ children }: UserAuthGateProps) {
    const { isAuthenticated, isLoading, error, errorCode } = useUserAuth();
    const router = useRouter();

    useEffect(() => {
        if (!(isLoading || isAuthenticated) && errorCode !== "SESSION_CHECK_UNAVAILABLE") {
            // Redirect to login with user mode
            router.push("/login?mode=user");
        }
    }, [isLoading, isAuthenticated, errorCode, router]);

    // Loading state
    if (isLoading) {
        return (
            <div
                className="flex min-h-screen items-center justify-center"
                style={{ background: "var(--color-bg)" }}
            >
                <motion.div
                    animate={{ opacity: 1, scale: 1 }}
                    className="flex flex-col items-center gap-4"
                    initial={{ opacity: 0, scale: 0.9 }}
                >
                    {/* Animated loader */}
                    <div className="relative h-12 w-12">
                        <motion.div
                            animate={{ rotate: 360 }}
                            className="absolute inset-0 rounded-full"
                            style={{
                                border: "3px solid var(--color-surface-border)",
                                borderTopColor: "var(--color-primary)",
                            }}
                            transition={{
                                duration: 1,
                                ease: "linear",
                                repeat: Number.POSITIVE_INFINITY,
                            }}
                        />
                    </div>
                    <p className="text-sm" style={{ color: "var(--color-text-muted)" }}>
                        Verifying session...
                    </p>
                </motion.div>
            </div>
        );
    }

    if (errorCode === "SESSION_CHECK_UNAVAILABLE") {
        return (
            <div
                className="flex min-h-screen flex-col items-center justify-center gap-4 bg-background p-6 text-default"
                role="alert"
            >
                <p className="text-center text-muted text-sm">{error}</p>
                <button
                    className="rounded-full bg-primary px-5 py-2 font-medium text-primary-foreground"
                    onClick={() => window.location.reload()}
                    type="button"
                >
                    Try again
                </button>
            </div>
        );
    }

    // Error state (e.g., user deleted, banned)
    if (error && errorCode) {
        return (
            <div
                className="flex min-h-screen items-center justify-center p-6"
                style={{ background: "var(--color-bg)" }}
            >
                {/* max-w-md no-ops under globals.css's unlayered `* { max-width: 100vw }` - see NebulaTopbar.tsx */}
                <motion.div
                    animate={{ opacity: 1, y: 0 }}
                    className="w-full rounded-xl p-6 text-center"
                    initial={{ opacity: 0, y: 20 }}
                    style={{
                        background: "var(--color-surface)",
                        border: "1px solid var(--color-error)",
                        maxWidth: "448px",
                    }}
                >
                    <div
                        className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full"
                        style={{ background: "var(--color-error-muted)" }}
                    >
                        <svg
                            aria-hidden="true"
                            className="h-8 w-8"
                            fill="none"
                            focusable="false"
                            stroke="currentColor"
                            style={{ color: "var(--color-error)" }}
                            viewBox="0 0 24 24"
                        >
                            <path
                                d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                strokeWidth={2}
                            />
                        </svg>
                    </div>
                    <h2 className="mb-2 font-bold text-xl" style={{ color: "var(--color-text)" }}>
                        Access Denied
                    </h2>
                    <p className="mb-6" style={{ color: "var(--color-text-muted)" }}>
                        {error}
                    </p>
                    <button
                        className="rounded-lg px-6 py-2 font-medium transition-all duration-200"
                        onClick={() => router.push("/login?mode=user")}
                        onMouseEnter={(e) => {
                            e.currentTarget.style.opacity = "0.9";
                        }}
                        onMouseLeave={(e) => {
                            e.currentTarget.style.opacity = "1";
                        }}
                        style={{
                            background: "var(--color-primary)",
                            color: "white",
                        }}
                        type="button"
                    >
                        Back to Login
                    </button>
                </motion.div>
            </div>
        );
    }

    // Not authenticated - will redirect
    if (!isAuthenticated) {
        return null;
    }

    // Authenticated - render children
    return <>{children}</>;
}
