"use client";

import { ExclamationCircleIcon, InformationCircleIcon } from "@heroicons/react/24/outline";
import { useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { toast as hotToast, Toaster } from "react-hot-toast";

// Re-export toast for easy usage
export { toast } from "react-hot-toast";

export function ToastProvider({ children }: { children: React.ReactNode }) {
    // Portaled to <body>. react-hot-toast renders in place rather than
    // portaling, and this provider lives inside layout.tsx's
    // `<div className="relative z-10">` - which is its own stacking context.
    // Modals portal to body at z-50, so anything trapped inside that z-10
    // context loses to them no matter how high its own z-index is: an error
    // toast raised from inside a modal appeared BEHIND the modal, dimmed and
    // blurred by its backdrop, and could only be read by closing the modal
    // first. Portaling puts the toasts in the same stacking context as the
    // modals so the z-index below actually decides the order.
    // false during SSR, true once hydrated - the sanctioned way to express
    // that without writing state from inside an effect.
    const mounted = useSyncExternalStore(
        () => () => undefined,
        () => true,
        () => false
    );

    const toaster = (
        <Toaster
            // Above modals (z-50) and their backdrops. An error you cannot read
            // is not an error message.
            containerStyle={{ zIndex: 9999 }}
            position="bottom-right"
            toastOptions={{
                duration: 4000,
                error: {
                    iconTheme: {
                        primary: "var(--color-error)",
                        secondary: "var(--color-surface)",
                    },
                },
                style: {
                    background: "var(--color-surface)",
                    border: "1px solid var(--color-surface-border)",
                    borderRadius: "12px",
                    boxShadow: "0 10px 40px -10px rgba(0, 0, 0, 0.5)",
                    color: "var(--color-text)",
                    padding: "12px 16px",
                },
                success: {
                    iconTheme: {
                        primary: "var(--color-success)",
                        secondary: "var(--color-surface)",
                    },
                },
            }}
        />
    );

    return (
        <>
            {children}
            {/* Only after mount - document.body does not exist during SSR. */}
            {mounted && createPortal(toaster, document.body)}
        </>
    );
}

// Helper functions for consistent toast styling
export const showToast = {
    dismiss: (id?: string) => hotToast.dismiss(id),
    error: (message: string) => hotToast.error(message),
    info: (message: string) =>
        hotToast(message, {
            icon: (
                <InformationCircleIcon
                    className="h-5 w-5"
                    style={{ color: "var(--color-secondary)" }}
                />
            ),
        }),
    loading: (message: string) => hotToast.loading(message),
    promise: <T,>(promise: Promise<T>, msgs: { loading: string; success: string; error: string }) =>
        hotToast.promise(promise, msgs),
    success: (message: string) => hotToast.success(message),
    warning: (message: string) =>
        hotToast(message, {
            icon: (
                <ExclamationCircleIcon
                    className="h-5 w-5"
                    style={{ color: "var(--color-warning)" }}
                />
            ),
        }),
};
