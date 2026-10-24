"use client";

import {
    ArrowPathIcon,
    CheckCircleIcon,
    ClockIcon,
    ExclamationTriangleIcon,
    NoSymbolIcon,
    XCircleIcon,
} from "@heroicons/react/24/outline";
import { motion } from "framer-motion";
import Link from "next/link";
import type { ComponentType, ReactNode } from "react";
import { Button } from "@/components/ui";

type StatusType =
    | "pending"
    | "accepted"
    | "rejected"
    | "completed"
    | "error"
    | "disabled"
    | "expired"
    | "email-mismatch"
    | "not-found";

interface StatusCardProps {
    children?: ReactNode;
    footer?: ReactNode;
    title: string;
    type: StatusType;
}

// Icon component type for Heroicons
type HeroIconComponent = ComponentType<{ className?: string; style?: React.CSSProperties }>;

const statusConfig: Record<
    StatusType,
    {
        icon: HeroIconComponent;
        iconColor: string;
        bgColor: string;
        borderColor: string;
    }
> = {
    accepted: {
        bgColor: "var(--color-success-muted)",
        borderColor: "var(--color-success)",
        icon: CheckCircleIcon,
        iconColor: "var(--color-success)",
    },
    completed: {
        bgColor: "var(--color-success-muted)",
        borderColor: "var(--color-success)",
        icon: CheckCircleIcon,
        iconColor: "var(--color-success)",
    },
    disabled: {
        bgColor: "var(--color-error-muted)",
        borderColor: "var(--color-error)",
        icon: NoSymbolIcon,
        iconColor: "var(--color-error)",
    },
    "email-mismatch": {
        bgColor: "var(--color-error-muted)",
        borderColor: "var(--color-error)",
        icon: XCircleIcon,
        iconColor: "var(--color-error)",
    },
    error: {
        bgColor: "var(--color-error-muted)",
        borderColor: "var(--color-error)",
        icon: ExclamationTriangleIcon,
        iconColor: "var(--color-error)",
    },
    expired: {
        bgColor: "var(--color-error-muted)",
        borderColor: "var(--color-error)",
        icon: ArrowPathIcon,
        iconColor: "var(--color-error)",
    },
    "not-found": {
        bgColor: "var(--color-error-muted)",
        borderColor: "var(--color-error)",
        icon: XCircleIcon,
        iconColor: "var(--color-error)",
    },
    pending: {
        bgColor: "var(--color-warning-muted)",
        borderColor: "var(--color-warning)",
        icon: ClockIcon,
        iconColor: "var(--color-warning)",
    },
    rejected: {
        bgColor: "var(--color-error-muted)",
        borderColor: "var(--color-error)",
        icon: XCircleIcon,
        iconColor: "var(--color-error)",
    },
};

/**
 * Status card for displaying various states in the invite flow
 */
export function StatusCard({ type, title, children, footer }: StatusCardProps) {
    const config = statusConfig[type];
    const Icon = config.icon;

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
            {/* Top accent border */}
            <div className="h-1" style={{ backgroundColor: config.borderColor }} />

            <div className="p-8">
                {/* Icon */}
                <motion.div
                    animate={{ opacity: 1, scale: 1 }}
                    className="mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-2xl"
                    initial={{ opacity: 0, scale: 0.8 }}
                    style={{ backgroundColor: config.bgColor }}
                    transition={{ delay: 0.1, duration: 0.4 }}
                >
                    <Icon className="h-8 w-8" style={{ color: config.iconColor }} />
                </motion.div>

                {/* Title */}
                <motion.h1
                    animate={{ opacity: 1, y: 0 }}
                    className="mb-4 text-center font-semibold text-2xl"
                    initial={{ opacity: 0, y: 10 }}
                    style={{ color: "var(--color-text)" }}
                    transition={{ delay: 0.15, duration: 0.3 }}
                >
                    {title}
                </motion.h1>

                {/* Content */}
                {children && (
                    <motion.div
                        animate={{ opacity: 1, y: 0 }}
                        className="text-center text-sm"
                        initial={{ opacity: 0, y: 10 }}
                        style={{ color: "var(--color-text-muted)" }}
                        transition={{ delay: 0.2, duration: 0.3 }}
                    >
                        {children}
                    </motion.div>
                )}

                {/* Pending pulse animation */}
                {type === "pending" && (
                    <motion.div
                        animate={{ opacity: 1 }}
                        className="mt-6 flex items-center justify-center gap-2"
                        initial={{ opacity: 0 }}
                        transition={{ delay: 0.3, duration: 0.3 }}
                    >
                        <div className="flex gap-1">
                            {[0, 1, 2].map((i) => (
                                <motion.div
                                    animate={{
                                        opacity: [0.5, 1, 0.5],
                                        scale: [1, 1.3, 1],
                                    }}
                                    className="h-2 w-2 rounded-full"
                                    key={i}
                                    style={{ backgroundColor: "var(--color-warning)" }}
                                    transition={{
                                        delay: i * 0.2,
                                        duration: 1,
                                        repeat: Number.POSITIVE_INFINITY,
                                    }}
                                />
                            ))}
                        </div>
                        <span className="text-xs" style={{ color: "var(--color-text-subtle)" }}>
                            Auto-updates when reviewed
                        </span>
                    </motion.div>
                )}

                {/* Footer */}
                {footer && (
                    <motion.div
                        animate={{ opacity: 1, y: 0 }}
                        className="mt-6"
                        initial={{ opacity: 0, y: 10 }}
                        transition={{ delay: 0.25, duration: 0.3 }}
                    >
                        {footer}
                    </motion.div>
                )}
            </div>
        </motion.div>
    );
}

/**
 * Preset status cards for common states
 */
export const StatusCards = {
    Completed: () => (
        <StatusCard
            footer={
                <div className="flex w-full justify-center">
                    <Link className="w-full sm:w-auto" href="/login">
                        <Button className="w-full" variant="primary">
                            Go to Dashboard
                        </Button>
                    </Link>
                </div>
            }
            title="Welcome to SlickSync!"
            type="completed"
        >
            <p>Your account has been created successfully.</p>
            <p className="mt-2 opacity-75">
                You can now use SlickSync to manage your Stremio addons.
            </p>
        </StatusCard>
    ),

    Disabled: () => (
        <StatusCard title="Invite Link Disabled" type="disabled">
            <p>This invitation has been disabled by the administrator.</p>
            <p className="mt-2 opacity-75">
                The invitation needs to be re-enabled or a new one generated.
            </p>
        </StatusCard>
    ),

    EmailMismatch: () => (
        <StatusCard title="Wrong Stremio Account" type="email-mismatch">
            <p>The Stremio account you used has a different email than your request.</p>
            <p className="mt-2 opacity-75">
                Please start a new request with the correct email address.
            </p>
        </StatusCard>
    ),

    NotFound: () => (
        <StatusCard title="Invalid Invite Link" type="not-found">
            <p>This invitation link doesn&apos;t exist or has been removed.</p>
            <p className="mt-2 opacity-75">Please check the link and try again.</p>
        </StatusCard>
    ),

    OAuthExpired: () => (
        <StatusCard title="OAuth Link Expired" type="expired">
            <p>The authentication link has expired.</p>
            <p className="mt-2 opacity-75">
                Contact your administrator to generate a new one. This page will refresh
                automatically.
            </p>
        </StatusCard>
    ),
    Pending: () => (
        <StatusCard title="Request Pending" type="pending">
            <p>Your request is waiting for admin approval.</p>
            <p className="mt-2 opacity-75">
                This page will update automatically when your request is reviewed.
            </p>
        </StatusCard>
    ),

    Rejected: () => (
        <StatusCard title="Request Rejected" type="rejected">
            <p>Your request has been rejected by the administrator.</p>
            <p className="mt-2 opacity-75">Contact the administrator for more information.</p>
        </StatusCard>
    ),
};
