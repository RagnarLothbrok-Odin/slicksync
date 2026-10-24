"use client";

import { ExclamationTriangleIcon, TrashIcon } from "@heroicons/react/24/outline";
import { motion } from "framer-motion";
import { useState } from "react";
import { InviteLayout } from "@/components/invite/InviteLayout";
import { StatusCard } from "@/components/invite/StatusCard";
import { StremioOAuthCard } from "@/components/invite/StremioOAuthCard";
import { InviteApiError, inviteApi } from "@/lib/invite-api";

type DeleteState = "confirm" | "oauth" | "success" | "error" | "not-found";

/**
 * User self-deletion page
 *
 * Allows users to delete their own account by authenticating with Stremio.
 */
export default function DeleteAccountPage() {
    const [state, setState] = useState<DeleteState>("confirm");
    const [isDeleting, setIsDeleting] = useState(false);
    const [errorMessage, setErrorMessage] = useState<string | null>(null);
    // Set when SlickSync's side is gone but the addons are still on their Stremio account.
    const [addonsLeft, setAddonsLeft] = useState(false);

    // Handle OAuth completion - delete the user
    const handleAuthKey = async (authKey: string) => {
        setIsDeleting(true);
        setErrorMessage(null);

        try {
            const result = await inviteApi.deleteUser(authKey);
            setAddonsLeft(result?.addonsCleared === false);
            setState("success");
        } catch (error) {
            if (error instanceof InviteApiError) {
                if (error.status === 404) {
                    setState("not-found");
                    return;
                }
                setErrorMessage(error.message || "Failed to delete account");
            } else {
                setErrorMessage("An unexpected error occurred");
            }
            setState("error");
        } finally {
            setIsDeleting(false);
        }
    };

    // Handle error from OAuth card
    const handleOAuthError = (message: string) => {
        console.error("OAuth error:", message);
    };

    // Start the deletion flow
    const handleStartDelete = () => {
        setState("oauth");
    };

    // Go back to confirmation
    const handleCancel = () => {
        setState("confirm");
        setErrorMessage(null);
    };

    // Render based on state
    const renderContent = () => {
        switch (state) {
            case "confirm":
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
                        {/* Warning accent */}
                        <div className="h-1" style={{ backgroundColor: "var(--color-error)" }} />

                        <div className="p-8">
                            {/* Icon */}
                            <motion.div
                                animate={{ opacity: 1, scale: 1 }}
                                className="mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-2xl"
                                initial={{ opacity: 0, scale: 0.8 }}
                                style={{ backgroundColor: "var(--color-error-muted)" }}
                                transition={{ delay: 0.1, duration: 0.4 }}
                            >
                                <TrashIcon
                                    className="h-8 w-8"
                                    style={{ color: "var(--color-error)" }}
                                />
                            </motion.div>

                            {/* Title */}
                            <motion.h1
                                animate={{ opacity: 1, y: 0 }}
                                className="mb-4 text-center font-semibold text-2xl"
                                initial={{ opacity: 0, y: 10 }}
                                style={{ color: "var(--color-text)" }}
                                transition={{ delay: 0.15, duration: 0.3 }}
                            >
                                Delete Your Account
                            </motion.h1>

                            {/* Warning */}
                            <motion.div
                                animate={{ opacity: 1, y: 0 }}
                                className="mb-6 flex items-start gap-3 rounded-xl p-4"
                                initial={{ opacity: 0, y: 10 }}
                                style={{ backgroundColor: "var(--color-warning-muted)" }}
                                transition={{ delay: 0.2, duration: 0.3 }}
                            >
                                <ExclamationTriangleIcon
                                    className="mt-0.5 h-5 w-5 flex-shrink-0"
                                    style={{ color: "var(--color-warning)" }}
                                />
                                <div
                                    className="text-sm"
                                    style={{ color: "var(--color-text-muted)" }}
                                >
                                    <p
                                        className="font-medium"
                                        style={{ color: "var(--color-warning)" }}
                                    >
                                        This action cannot be undone
                                    </p>
                                    <p className="mt-1">
                                        Your account and all associated data will be permanently
                                        deleted. You&apos;ll need to request access again if you
                                        want to rejoin.
                                    </p>
                                </div>
                            </motion.div>

                            {/* Actions */}
                            <motion.div
                                animate={{ opacity: 1, y: 0 }}
                                className="space-y-3"
                                initial={{ opacity: 0, y: 10 }}
                                transition={{ delay: 0.25, duration: 0.3 }}
                            >
                                <button
                                    className="flex w-full items-center justify-center gap-2 rounded-xl py-3.5 font-medium transition-all"
                                    onClick={handleStartDelete}
                                    style={{
                                        backgroundColor: "var(--color-error)",
                                        color: "white",
                                    }}
                                >
                                    <TrashIcon className="h-5 w-5" />
                                    <span>Delete My Account</span>
                                </button>

                                <p
                                    className="text-center text-xs"
                                    style={{ color: "var(--color-text-subtle)" }}
                                >
                                    You&apos;ll need to authenticate with Stremio to confirm
                                </p>
                            </motion.div>
                        </div>
                    </motion.div>
                );

            case "oauth":
                return (
                    <div className="space-y-4">
                        <StremioOAuthCard
                            description="Sign in with Stremio to confirm account deletion."
                            isCompleting={isDeleting}
                            onAuthKey={handleAuthKey}
                            onError={handleOAuthError}
                            title="Confirm Deletion"
                        />

                        <motion.button
                            animate={{ opacity: 1, y: 0 }}
                            className="w-full rounded-xl py-3 font-medium transition-all"
                            initial={{ opacity: 0, y: 10 }}
                            onClick={handleCancel}
                            style={{
                                backgroundColor: "var(--color-surface)",
                                border: "1px solid var(--color-surface-border)",
                                color: "var(--color-text-muted)",
                            }}
                            transition={{ delay: 0.1, duration: 0.3 }}
                            whileHover={{ scale: 1.01 }}
                            whileTap={{ scale: 0.99 }}
                        >
                            Cancel
                        </motion.button>
                    </div>
                );

            case "success":
                return (
                    <StatusCard title="Account Deleted" type="completed">
                        <p>Your account has been successfully deleted.</p>
                        {addonsLeft && (
                            <p className="mt-2">
                                We couldn&apos;t remove the SlickSync addons from your Stremio
                                account, so they are still there. To take them off yourself, open
                                Stremio&apos;s Addons page and uninstall the ones SlickSync added.
                            </p>
                        )}
                        <p className="mt-2 opacity-75">
                            Thank you for using SlickSync. You can request access again if you
                            change your mind.
                        </p>
                    </StatusCard>
                );

            case "not-found":
                return (
                    <StatusCard title="Account Not Found" type="not-found">
                        <p>No account was found for this Stremio user.</p>
                        <p className="mt-2 opacity-75">
                            The account may have already been deleted.
                        </p>
                    </StatusCard>
                );

            case "error":
                return (
                    <StatusCard
                        footer={
                            <button
                                className="w-full rounded-xl py-3 font-medium transition-all"
                                onClick={handleCancel}
                                style={{
                                    backgroundColor: "var(--color-surface-hover)",
                                    color: "var(--color-text)",
                                }}
                            >
                                Try Again
                            </button>
                        }
                        title="Deletion Failed"
                        type="error"
                    >
                        <p>{errorMessage || "An error occurred while deleting your account."}</p>
                        <p className="mt-2 opacity-75">
                            Please try again or contact the administrator.
                        </p>
                    </StatusCard>
                );

            default:
                return null;
        }
    };

    return <InviteLayout>{renderContent()}</InviteLayout>;
}
