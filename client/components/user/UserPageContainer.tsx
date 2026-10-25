"use client";

import { motion } from "framer-motion";
import type { ReactNode } from "react";
import { PageContainer } from "@/components/layout/PageContainer";

interface UserPageContainerProps {
    children: ReactNode;
    className?: string;
}

/**
 * Page container for a person's own pages: the admin pages' own container
 * and background under the shared top bar (PersonTopbar), with the content
 * as wide as the bar so the two line up.
 */
export function UserPageContainer({ children, className }: UserPageContainerProps) {
    return (
        <PageContainer className={className} noSidebarOffset>
            <div className="mx-auto" style={{ maxWidth: "var(--interface-content-width)" }}>
                {children}
            </div>
        </PageContainer>
    );
}

// Page header component for user pages
interface UserPageHeaderProps {
    actions?: ReactNode;
    subtitle?: string;
    title: string;
}

export function UserPageHeader({ title, subtitle, actions }: UserPageHeaderProps) {
    // No menu button here any more - the top bar above carries the navigation.
    return (
        <motion.div
            animate={{ opacity: 1, y: 0 }}
            className="interface-heading mb-7 flex flex-wrap items-end justify-between gap-4"
            initial={false}
        >
            <div className="flex min-w-0 items-center gap-3">
                <div className="min-w-0">
                    <h1
                        className="break-words font-bold font-display"
                        style={{ color: "var(--color-text)" }}
                    >
                        {title}
                    </h1>
                    {subtitle && (
                        <p className="mt-1 text-sm" style={{ color: "var(--color-text-muted)" }}>
                            {subtitle}
                        </p>
                    )}
                </div>
            </div>
            {actions && (
                <div className="ml-auto flex max-w-full flex-wrap items-center justify-end gap-3">
                    {actions}
                </div>
            )}
        </motion.div>
    );
}
