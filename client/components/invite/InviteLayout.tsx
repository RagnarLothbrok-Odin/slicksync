"use client";

import { motion } from "framer-motion";
import type { ReactNode } from "react";
import { SlickSyncLogo } from "@/components/ui/SlickSyncLogo";

interface InviteLayoutProps {
    children: ReactNode;
    onNewRequest?: () => void;
    showNewRequestButton?: boolean;
}

/**
 * Public invite page layout with SlickSync branding
 *
 * Design direction: Clean, minimal, professional with subtle depth.
 * Focus on the content with a refined atmosphere.
 */
export function InviteLayout({
    children,
    showNewRequestButton = false,
    onNewRequest,
}: InviteLayoutProps) {
    return (
        <div
            className="relative min-h-screen overflow-hidden"
            style={{ backgroundColor: "var(--color-bg)" }}
        >
            {/* Subtle gradient mesh background */}
            <div
                className="pointer-events-none absolute inset-0"
                style={{
                    background: `
            radial-gradient(ellipse 80% 50% at 20% -10%, var(--color-primary-muted) 0%, transparent 50%),
            radial-gradient(ellipse 60% 40% at 80% 110%, var(--color-secondary-muted) 0%, transparent 50%)
          `,
                    opacity: 0.5,
                }}
            />

            {/* Subtle grid pattern overlay */}
            <div
                className="pointer-events-none absolute inset-0 opacity-[0.02]"
                style={{
                    backgroundImage: `
            linear-gradient(var(--color-text) 1px, transparent 1px),
            linear-gradient(90deg, var(--color-text) 1px, transparent 1px)
          `,
                    backgroundSize: "60px 60px",
                }}
            />

            {/* Header with logo and optional new request button */}
            <motion.header
                animate={{ opacity: 1, y: 0 }}
                className="absolute top-0 right-0 left-0 z-10 flex items-center justify-between p-6"
                initial={{ opacity: 0, y: -20 }}
                transition={{ duration: 0.5, ease: "easeOut" }}
            >
                {/* Logo */}
                <div className="flex items-center gap-3">
                    <div
                        className="flex h-9 w-9 items-center justify-center overflow-hidden rounded-lg"
                        style={{
                            backgroundColor: "var(--color-primary)",
                        }}
                    >
                        <SlickSyncLogo className="h-7 w-7" />
                    </div>
                    <span
                        className="font-semibold text-lg tracking-tight"
                        style={{ color: "var(--color-text)" }}
                    >
                        SlickSync
                    </span>
                </div>

                {/* New Request button */}
                {showNewRequestButton && onNewRequest && (
                    <motion.button
                        animate={{ opacity: 1, x: 0 }}
                        className="rounded-lg px-4 py-2 font-medium text-sm transition-all"
                        initial={{ opacity: 0, x: 20 }}
                        onClick={onNewRequest}
                        style={{
                            backgroundColor: "var(--color-surface)",
                            border: "1px solid var(--color-surface-border)",
                            color: "var(--color-text-muted)",
                        }}
                        transition={{ delay: 0.2, duration: 0.3 }}
                        whileHover={{
                            backgroundColor: "var(--color-surface-hover)",
                            scale: 1.02,
                        }}
                        whileTap={{ scale: 0.98 }}
                    >
                        New Request
                    </motion.button>
                )}
            </motion.header>

            {/* Main content */}
            <main className="flex min-h-screen items-center justify-center p-6 pt-24 pb-12">
                {/* max-w-md no-ops under globals.css's unlayered `* { max-width: 100vw }` - see NebulaTopbar.tsx */}
                <motion.div
                    animate={{ opacity: 1, y: 0 }}
                    className="relative w-full"
                    initial={{ opacity: 0, y: 20 }}
                    style={{ maxWidth: "448px" }}
                    transition={{ delay: 0.1, duration: 0.5, ease: "easeOut" }}
                >
                    {children}
                </motion.div>
            </main>

            {/* Footer */}
            <motion.footer
                animate={{ opacity: 1 }}
                className="absolute right-0 bottom-0 left-0 p-6 text-center"
                initial={{ opacity: 0 }}
                transition={{ delay: 0.3, duration: 0.5 }}
            >
                <p className="text-xs" style={{ color: "var(--color-text-subtle)" }}>
                    SlickSync manages your Stremio addons across devices
                </p>
            </motion.footer>
        </div>
    );
}
