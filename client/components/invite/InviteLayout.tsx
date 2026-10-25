"use client";

import type { ReactNode } from "react";
import { Button } from "@/components/ui/Button";
import { SlickSyncLogo } from "@/components/ui/SlickSyncLogo";

interface InviteLayoutProps {
    children: ReactNode;
    onNewRequest?: () => void;
    showNewRequestButton?: boolean;
}

/** Invitations share the normal login surface and responsive content width. */
export function InviteLayout({
    children,
    showNewRequestButton = false,
    onNewRequest,
}: InviteLayoutProps) {
    return (
        <div className="interface-login flex min-h-screen flex-col items-center justify-center bg-bg px-6 py-12">
            <main className="w-full min-w-0" style={{ maxWidth: "480px" }}>
                <div className="login-intro mb-7 text-center">
                    <div className="inline-flex items-center gap-2.5">
                        <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary">
                            <SlickSyncLogo className="h-6 w-6 text-white" />
                        </span>
                        <span className="font-semibold text-base text-default">SlickSync</span>
                    </div>
                </div>
                {children}
                {showNewRequestButton && onNewRequest && (
                    <Button className="mt-5 w-full" onClick={onNewRequest} variant="secondary">
                        New Request
                    </Button>
                )}
            </main>
            <p className="mt-6 text-center text-subtle text-xs">Your media, together.</p>
        </div>
    );
}
