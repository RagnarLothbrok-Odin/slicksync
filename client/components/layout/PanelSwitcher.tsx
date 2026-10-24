"use client";

import {
    ArrowRightOnRectangleIcon,
    ArrowsRightLeftIcon,
    ChevronDownIcon,
    Cog6ToothIcon,
    NewspaperIcon,
    QueueListIcon,
    ShieldCheckIcon,
    UserIcon,
} from "@heroicons/react/24/outline";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState } from "react";
import { Avatar } from "@/components/ui";
import { useLayoutMode } from "@/lib/layout-mode";
import { AccountModal } from "./AccountModal";

interface PanelSwitcherProps {
    /** Which edge of the compact trigger the dropdown's own edge anchors to.
     *  'right' (default) suits a trigger near the right edge of the screen -
     *  the menu opens leftward, staying on-screen. A trigger near the left
     *  edge (e.g. Nebula's bottom-left account button) needs 'left' instead,
     *  or the menu opens leftward off the edge of the viewport. Only affects
     *  variant="compact" - the full-width sidebar trigger always spans
     *  left-0 right-0 regardless. */
    align?: "left" | "right";
    /** Whether the component is collapsed (for sidebar) */
    collapsed?: boolean;
    /** Sidebar trigger sits at the bottom of the screen, so its dropdown opens
     *  upward ('up', the default). A topbar trigger sits at the top, so it
     *  needs the dropdown to open downward instead - otherwise it renders
     *  off the top of the viewport. */
    dropdownPosition?: "up" | "down";
    /** Current panel mode */
    mode: "admin" | "user";
    /** Called when logout is clicked */
    onLogout?: () => void;
    onSwitchProfile?: () => void;
    /** User info for display (optional) */
    userInfo?: {
        username?: string;
        email?: string | null;
        colorIndex?: number;
        uuid?: string | null;
        linkedProvider?: "stremio" | "nuvio" | null;
        avatarUrl?: string | null;
        /** Only a signed-in person has this (an admin account has no Gravatar switch). */
        useGravatar?: boolean;
    } | null;
    /** 'compact' renders a small icon-only trigger (topbar use) instead of the
     *  full-width name/email row the sidebar uses. */
    variant?: "full" | "compact";
}

/**
 * Panel switcher component for switching between Admin and User panels
 * Appears in the sidebar of both panels
 */
export function PanelSwitcher({
    mode,
    userInfo,
    onLogout,
    onSwitchProfile,
    collapsed = false,
    variant = "full",
    dropdownPosition = "up",
    align = "right",
}: PanelSwitcherProps) {
    const router = useRouter();
    const _pathname = usePathname();
    const [isOpen, setIsOpen] = useState(false);
    const [accountModalOpen, setAccountModalOpen] = useState(false);
    const menuRef = useRef<HTMLDivElement>(null);
    const triggerRef = useRef<HTMLButtonElement>(null);
    const dropdownId = useId();
    const reduceMotion = useReducedMotion();

    // Close menu when clicking outside
    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
                setIsOpen(false);
            }
        };

        document.addEventListener("mousedown", handleClickOutside);
        return () => document.removeEventListener("mousedown", handleClickOutside);
    }, []);

    // Close on escape
    useEffect(() => {
        const handleEscape = (event: KeyboardEvent) => {
            if (event.key === "Escape" && isOpen) {
                setIsOpen(false);
                triggerRef.current?.focus();
            }
        };

        window.addEventListener("keydown", handleEscape);
        return () => window.removeEventListener("keydown", handleEscape);
    }, [isOpen]);

    const handleSwitchPanel = async () => {
        if (mode === "admin") {
            setIsOpen(false);
            // Switching from Admin to User
            // Check if user is logged in (has auth in localStorage)
            const userAuth = localStorage.getItem("slicksync-user-auth");
            if (userAuth) {
                try {
                    const data = JSON.parse(userAuth);
                    // Nuvio sessions have no client-held authKey (see useUserAuth.tsx) -
                    // userId + provider:'nuvio' is a valid session on its own.
                    if (data.userId && (data.authKey || data.provider === "nuvio")) {
                        window.location.href = "/user";
                        return;
                    }
                } catch {
                    // Malformed optional data leaves the existing fallback in place.
                }
            }
            // Not logged in as user, go to login
            window.location.href = "/login?mode=user";
        } else {
            // Switching from User to Admin
            // Check if admin is logged in (localStorage)
            const adminToken = localStorage.getItem("slicksync-admin-token");
            if (adminToken) {
                setIsOpen(false);
                window.location.href = "/";
                return;
            }

            // If no token, verify session via API (cookie check) to avoid login page flash
            try {
                const response = await fetch("/api/ext/account");
                if (response.ok) {
                    setIsOpen(false);
                    window.location.href = "/";
                    return;
                }
            } catch {
                // Optional remote data does not prevent the current operation from completing.
            }

            // Not logged in as admin, go to login
            setIsOpen(false);
            window.location.href = "/login?mode=admin";
        }
    };

    const handleLogout = () => {
        setIsOpen(false);
        onLogout?.();
    };

    const isAdmin = mode === "admin";
    const isPublicInstance = (process.env.NEXT_PUBLIC_INSTANCE_TYPE || "private") === "public";
    // Original layout's own Sidebar already has a "System" section with Tasks/
    // Settings/Changelog directly in the nav - only Nebula moved them
    // into this dropdown, specifically because its topbar has no room to
    // spare for a fourth nav row. Showing them here too on Original was pure
    // duplication of something already one click away in the sidebar.
    const { layoutMode } = useLayoutMode();
    const showSystemLinks = layoutMode === "nebula";
    const targetPanel = isAdmin ? "User" : "Admin";
    const TargetIcon = isAdmin ? UserIcon : ShieldCheckIcon;
    const isCompact = variant === "compact";

    return (
        <div className="relative" ref={menuRef}>
            {/* Trigger Button */}
            <motion.button
                aria-controls={isOpen ? dropdownId : undefined}
                aria-expanded={isOpen}
                aria-label="Account and settings"
                className={`${
                    isCompact
                        ? "flex h-9 w-9 items-center justify-center rounded-lg transition-all duration-200"
                        : "flex w-full items-center gap-3 rounded-lg px-3 py-2.5 transition-all duration-200"
                } ${isOpen ? "panel-btn-open" : "panel-btn"}`}
                onClick={() => setIsOpen(!isOpen)}
                ref={triggerRef}
                style={{
                    color: "var(--color-text)",
                }}
                title="Account and settings"
                type="button"
                whileTap={reduceMotion ? undefined : { scale: 0.97 }}
            >
                {/* Current Mode Icon */}
                <div className="flex-shrink-0">
                    {isAdmin ? (
                        userInfo ? (
                            <Avatar
                                avatarClassName="rounded-lg"
                                className="h-8 w-8"
                                email={userInfo.email || undefined}
                                fallbackIcon={
                                    <ShieldCheckIcon
                                        className="h-4 w-4"
                                        style={{ color: "white" }}
                                    />
                                }
                                name={userInfo.username || "A"}
                                size="sm"
                                src={userInfo.avatarUrl || undefined}
                            />
                        ) : (
                            <div
                                className="flex h-8 w-8 items-center justify-center rounded-lg"
                                style={{ background: "var(--color-primary-muted)" }}
                            >
                                <ShieldCheckIcon
                                    className="h-4 w-4"
                                    style={{ color: "var(--color-primary)" }}
                                />
                            </div>
                        )
                    ) : userInfo ? (
                        <Avatar
                            avatarClassName="rounded-lg"
                            className="h-8 w-8"
                            colorIndex={userInfo.colorIndex || 0}
                            email={userInfo.email || undefined}
                            name={userInfo.username || "U"}
                            size="sm"
                            src={userInfo.avatarUrl || undefined}
                            useGravatar={userInfo.useGravatar}
                        />
                    ) : (
                        <div
                            className="flex h-8 w-8 items-center justify-center rounded-lg"
                            style={{ background: "var(--color-success-muted)" }}
                        >
                            <UserIcon
                                className="h-4 w-4"
                                style={{ color: "var(--color-success)" }}
                            />
                        </div>
                    )}
                </div>

                {!(collapsed || isCompact) && (
                    <>
                        <div className="min-w-0 flex-1 text-left">
                            <p className="truncate font-medium text-sm">
                                {isAdmin
                                    ? userInfo?.username || "Admin Panel"
                                    : userInfo?.username || "User Panel"}
                            </p>
                            <p
                                className="truncate text-xs"
                                style={{ color: "var(--color-text-muted)" }}
                            >
                                {isAdmin
                                    ? userInfo?.email || "Administrator"
                                    : userInfo?.email || "Signed in"}
                            </p>
                        </div>

                        <ChevronDownIcon
                            className={`h-4 w-4 transition-transform duration-200 ${isOpen ? "rotate-180" : ""}`}
                            style={{ color: "var(--color-text-muted)" }}
                        />
                    </>
                )}
            </motion.button>

            {/* Dropdown Menu */}
            <AnimatePresence>
                {isOpen && (
                    <motion.div
                        animate={{ opacity: 1, scale: 1, y: 0 }}
                        className={`absolute z-50 overflow-y-auto rounded-xl shadow-xl ${dropdownPosition === "down" ? "top-full mt-2" : "bottom-full mb-2"} ${
                            isCompact
                                ? `${align === "left" ? "left-0" : "right-0"} w-72`
                                : "right-0 left-0"
                        }`}
                        exit={
                            reduceMotion
                                ? { opacity: 0 }
                                : {
                                      opacity: 0,
                                      scale: 0.98,
                                      y: dropdownPosition === "down" ? -4 : 4,
                                  }
                        }
                        id={dropdownId}
                        initial={
                            reduceMotion
                                ? { opacity: 0 }
                                : {
                                      opacity: 0,
                                      scale: 0.98,
                                      y: dropdownPosition === "down" ? -4 : 4,
                                  }
                        }
                        style={{
                            background: "var(--color-surface)",
                            border: "1px solid var(--color-surface-border)",
                            maxHeight: "calc(100dvh - 7rem)",
                            maxWidth: "calc(100vw - 2rem)",
                            transformOrigin: `${dropdownPosition === "down" ? "top" : "bottom"} ${align}`,
                        }}
                        transition={{ duration: 0.15 }}
                    >
                        {/* Switch Panel Button */}
                        <button
                            className="nav-item-hover-pill flex w-full items-center gap-3 rounded-lg px-4 py-3 focus-visible:outline-2 focus-visible:outline-primary focus-visible:-outline-offset-2"
                            onClick={handleSwitchPanel}
                            style={{ color: "var(--color-text)" }}
                            type="button"
                        >
                            <div
                                className="flex h-8 w-8 items-center justify-center rounded-lg"
                                style={{
                                    background: isAdmin
                                        ? "var(--color-success-muted)"
                                        : "var(--color-primary-muted)",
                                }}
                            >
                                <TargetIcon
                                    className="nav-item-icon h-4 w-4"
                                    style={{
                                        color: isAdmin
                                            ? "var(--color-success)"
                                            : "var(--color-primary)",
                                    }}
                                />
                            </div>
                            <div className="flex-1 text-left">
                                <p className="nav-item-label font-medium text-sm">
                                    Switch to {targetPanel} Panel
                                </p>
                                <p
                                    className="nav-item-label text-xs"
                                    style={{ color: "var(--color-text-muted)" }}
                                >
                                    {isAdmin
                                        ? "Access your library and settings"
                                        : "Manage users and system"}
                                </p>
                            </div>
                            <ArrowsRightLeftIcon
                                className="nav-item-icon h-4 w-4"
                                style={{ color: "var(--color-text-muted)" }}
                            />
                        </button>

                        {onSwitchProfile && (
                            <button
                                className="nav-item-hover-pill flex w-full items-center gap-3 rounded-lg px-4 py-3 text-default"
                                onClick={() => {
                                    setIsOpen(false);
                                    onSwitchProfile();
                                }}
                                type="button"
                            >
                                <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-surface-hover">
                                    <ArrowsRightLeftIcon className="nav-item-icon h-4 w-4 text-muted" />
                                </div>
                                <span className="nav-item-label font-medium text-sm">
                                    Switch profile
                                </span>
                            </button>
                        )}

                        {isAdmin && (
                            <>
                                <div
                                    className="h-px"
                                    style={{ background: "var(--color-surface-border)" }}
                                />
                                {showSystemLinks && (
                                    <>
                                        <button
                                            className="nav-item-hover-pill flex w-full items-center gap-3 rounded-lg px-4 py-3"
                                            onClick={() => {
                                                setIsOpen(false);
                                                router.push("/tasks");
                                            }}
                                            style={{ color: "var(--color-text)" }}
                                            type="button"
                                        >
                                            <div
                                                className="flex h-8 w-8 items-center justify-center rounded-lg"
                                                style={{ background: "var(--color-surface-hover)" }}
                                            >
                                                <QueueListIcon
                                                    className="nav-item-icon h-4 w-4"
                                                    style={{ color: "var(--color-text-muted)" }}
                                                />
                                            </div>
                                            <span className="nav-item-label font-medium text-sm">
                                                Tasks
                                            </span>
                                        </button>
                                        <button
                                            className="nav-item-hover-pill flex w-full items-center gap-3 rounded-lg px-4 py-3"
                                            onClick={() => {
                                                setIsOpen(false);
                                                router.push("/settings");
                                            }}
                                            style={{ color: "var(--color-text)" }}
                                            type="button"
                                        >
                                            <div
                                                className="flex h-8 w-8 items-center justify-center rounded-lg"
                                                style={{ background: "var(--color-surface-hover)" }}
                                            >
                                                <Cog6ToothIcon
                                                    className="nav-item-icon h-4 w-4"
                                                    style={{ color: "var(--color-text-muted)" }}
                                                />
                                            </div>
                                            <span className="nav-item-label font-medium text-sm">
                                                Settings
                                            </span>
                                        </button>
                                        <button
                                            className="nav-item-hover-pill flex w-full items-center gap-3 rounded-lg px-4 py-3"
                                            onClick={() => {
                                                setIsOpen(false);
                                                router.push("/changelog");
                                            }}
                                            style={{ color: "var(--color-text)" }}
                                            type="button"
                                        >
                                            <div
                                                className="flex h-8 w-8 items-center justify-center rounded-lg"
                                                style={{ background: "var(--color-surface-hover)" }}
                                            >
                                                <NewspaperIcon
                                                    className="nav-item-icon h-4 w-4"
                                                    style={{ color: "var(--color-text-muted)" }}
                                                />
                                            </div>
                                            <span className="nav-item-label font-medium text-sm">
                                                Changelog
                                            </span>
                                        </button>
                                    </>
                                )}
                            </>
                        )}

                        {/* Account Button (Admin Mode / Public Instance only) */}
                        {isAdmin && isPublicInstance && (
                            <>
                                <div
                                    className="h-px"
                                    style={{ background: "var(--color-surface-border)" }}
                                />
                                <button
                                    className="hov-surface flex w-full items-center gap-3 px-4 py-3 transition-all duration-200"
                                    onClick={() => {
                                        setIsOpen(false);
                                        setAccountModalOpen(true);
                                    }}
                                    style={{ color: "var(--color-text)" }}
                                    type="button"
                                >
                                    <div
                                        className="flex h-8 w-8 items-center justify-center rounded-lg"
                                        style={{ background: "var(--color-surface-hover)" }}
                                    >
                                        <Cog6ToothIcon
                                            className="h-4 w-4"
                                            style={{ color: "var(--color-text-muted)" }}
                                        />
                                    </div>
                                    <div className="flex-1 text-left">
                                        <p className="font-medium text-sm">Account</p>
                                        <p
                                            className="text-xs"
                                            style={{ color: "var(--color-text-muted)" }}
                                        >
                                            Manage login methods
                                        </p>
                                    </div>
                                </button>
                            </>
                        )}

                        {/* Divider */}
                        <div
                            className="h-px"
                            style={{ background: "var(--color-surface-border)" }}
                        />

                        {/* Logout Button */}
                        <button
                            className="hov-error flex w-full items-center gap-3 px-4 py-3 transition-all duration-200"
                            onClick={handleLogout}
                            style={{ color: "var(--color-error)" }}
                            type="button"
                        >
                            <div
                                className="flex h-8 w-8 items-center justify-center rounded-lg"
                                style={{ background: "var(--color-error-muted)" }}
                            >
                                <ArrowRightOnRectangleIcon
                                    className="h-4 w-4"
                                    style={{ color: "var(--color-error)" }}
                                />
                            </div>
                            <span className="font-medium text-sm">Logout</span>
                        </button>
                    </motion.div>
                )}
            </AnimatePresence>

            {/* Account Modal */}
            {isAdmin && isPublicInstance && (
                <AccountModal
                    accountInfo={{
                        email: userInfo?.email,
                        linkedProvider: userInfo?.linkedProvider,
                        uuid: userInfo?.uuid,
                    }}
                    isOpen={accountModalOpen}
                    onAccountUpdated={() => {
                        // Refresh page to update account info
                        window.location.reload();
                    }}
                    onClose={() => setAccountModalOpen(false)}
                />
            )}
        </div>
    );
}
