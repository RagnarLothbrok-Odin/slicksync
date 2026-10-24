"use client";

import { motion } from "framer-motion";
import { useEffect, useLayoutEffect, useState } from "react";
import { api } from "@/lib/api";

interface AdminAuthGateProps {
    children: React.ReactNode;
}

// Blocks rendering the admin shell (Sidebar/Dashboard/etc.) until a session
// check resolves. Without this, an anonymous visitor to "/" got a flash of
// the full dashboard - Sidebar, stat cards, everything - before the page's
// own data fetches came back 401 and the global redirect handler in api.ts
// kicked in and sent them to /login. UserAuthGate already solved this same
// problem for the /user routes; the admin routes never got the equivalent.
//
// getSession() hits /auth/me, which resolves three ways: a real account
// (valid session), { account: null } with no error (auth disabled entirely,
// private mode), or a 401 (no/invalid session). api.ts's own handler already
// starts the redirect to /login on that 401 - but window.location.href
// doesn't unmount React synchronously, so there's a real window between
// that redirect firing and the browser actually navigating away. An earlier
// version of this gate only tracked whether the check had *finished*, not
// whether it had *succeeded* - so a 401 still flipped straight to rendering
// children in that window, reproducing the exact flash this gate exists to
// prevent. Tracking the outcome explicitly (not just completion) keeps the
// gate closed for the whole redirect, not just until the request settles.
//
// Someone signed in on this device last time is let straight in while the
// check runs: a blank "Verifying session" screen on every open of the
// installed app was the slowest part of starting it. The pages fetch in
// parallel, and an expired session still goes to the login page the moment
// any request answers 401 (the snapshot that marks "signed in last time" is
// cleared then). A first-time visitor still waits for the check.
export function AdminAuthGate({ children }: AdminAuthGateProps) {
    const [status, setStatus] = useState<"checking" | "ok" | "unauthenticated">("checking");

    // Before the first paint after hydration (the server can't see this
    // device's storage, so the server render always starts at 'checking').
    useLayoutEffect(() => {
        // eslint-disable-next-line react-hooks/set-state-in-effect -- one switch before first paint is the point: deferring it shows the spinner
        if (api.wasSignedIn()) {
            setStatus((s) => (s === "checking" ? "ok" : s));
        }
    }, []);

    useEffect(() => {
        let cancelled = false;
        api.getSession()
            .then(() => {
                if (!cancelled) {
                    setStatus("ok");
                }
            })
            .catch((err: any) => {
                if (cancelled) {
                    return;
                }
                // Only a real 401 means "not authenticated" (redirect already in
                // flight via api.ts). Anything else - a network error, the server
                // being briefly unreachable - fails open rather than stranding the
                // user on a spinner forever over a transient issue unrelated to auth.
                setStatus(err?.response?.status === 401 ? "unauthenticated" : "ok");
            });
        return () => {
            cancelled = true;
        };
    }, []);

    if (status !== "ok") {
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

    return <>{children}</>;
}
