"use client";

import { Bars3Icon } from "@heroicons/react/24/outline";
import { motion } from "framer-motion";
import { useMobileMenu } from "@/app/(admin)/AdminClientLayout";
import type { NotificationsDropdownProps } from "@/components/ui/NotificationsDropdown";
import { TopbarActions } from "./TopbarActions";

interface HeaderProps
    extends Pick<NotificationsDropdownProps, "activities" | "inviteHistory" | "taskHistory"> {
    actions?: React.ReactNode;
    isMobileMenuOpen?: boolean;
    // Navigation controls precede the title; page actions stay at the end
    // of the row, matching NebulaPageHeading.
    leading?: React.ReactNode;
    onMenuClick?: () => void;
    subtitle?: string;
    title: React.ReactNode;
}

export function Header({
    title,
    subtitle,
    actions,
    leading,
    activities = [],
    inviteHistory = [],
    taskHistory = [],
    onMenuClick: onMenuClickProp,
    isMobileMenuOpen: isMobileMenuOpenProp,
}: HeaderProps) {
    const { onOpen: onMenuClickContext, isOpen: isMobileMenuOpenContext } = useMobileMenu();

    // Use provided props or fall back to context
    const onMenuClick = onMenuClickProp || onMenuClickContext;
    const isMobileMenuOpen =
        isMobileMenuOpenProp === undefined ? isMobileMenuOpenContext : isMobileMenuOpenProp;

    return (
        <header className="interface-page-header sticky top-0 z-30">
            <div className="flex flex-wrap items-center justify-between gap-4 px-4 py-5 md:px-8">
                <div className="flex min-w-0 items-center gap-3">
                    <button
                        aria-expanded={isMobileMenuOpen}
                        aria-label="Open navigation"
                        className="rounded-xl p-2 text-default hover:bg-surface-hover md:hidden"
                        onClick={onMenuClick}
                        type="button"
                    >
                        <Bars3Icon className="h-5 w-5" />
                    </button>
                    <div>
                        {leading && <div className="mb-3">{leading}</div>}
                        <h1 className="font-bold font-display text-2xl text-default md:text-3xl">
                            {title}
                        </h1>
                        {subtitle && <p className="mt-2 text-muted text-sm">{subtitle}</p>}
                    </div>
                </div>
                <div className="ml-auto flex flex-wrap items-center justify-end gap-3">
                    {actions}
                    <TopbarActions
                        activities={activities}
                        inviteHistory={inviteHistory}
                        taskHistory={taskHistory}
                    />
                </div>
            </div>
        </header>
    );
}

// Breadcrumbs component
interface BreadcrumbItem {
    href?: string;
    label: string;
}

interface BreadcrumbsProps {
    className?: string;
    items: BreadcrumbItem[];
}

export function Breadcrumbs({ items, className }: BreadcrumbsProps) {
    return (
        <nav
            className={`flex items-center gap-2 ${className || "text-sm"}`}
            style={{ color: "var(--color-text-muted)" }}
        >
            {items.map((item, index) => (
                <motion.div
                    animate={{ opacity: 1, x: 0 }}
                    className="flex items-center gap-2"
                    initial={{ opacity: 0, x: -10 }}
                    key={index}
                    transition={{ delay: index * 0.05 }}
                >
                    {index > 0 && <span style={{ color: "var(--color-text-subtle)" }}>/</span>}
                    {item.href ? (
                        <a
                            className="transition-colors hover:text-[var(--color-text)]"
                            href={item.href}
                            style={{ color: "var(--color-text-muted)" }}
                        >
                            {item.label}
                        </a>
                    ) : (
                        <span style={{ color: "var(--color-text)" }}>{item.label}</span>
                    )}
                </motion.div>
            ))}
        </nav>
    );
}
