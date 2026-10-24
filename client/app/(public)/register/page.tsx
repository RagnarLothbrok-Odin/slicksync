"use client";

import { ArrowRightIcon, CheckIcon, ClipboardIcon } from "@heroicons/react/24/outline";
import { motion } from "framer-motion";
import { useRouter } from "next/navigation";
import { useEffect, useId, useState } from "react";
import { PasswordToggleButton } from "@/components/ui/Input";
import { SlickSyncLogo } from "@/components/ui/SlickSyncLogo";
import { api } from "@/lib/api";
import { copyToClipboard } from "@/lib/clipboard";

// Public-mode (multi-tenant) self-registration - the flow the README already
// documented ("first visit shows a registration screen") but that had no
// actual page behind it: the backend's POST /auth/register endpoint existed
// and worked, there was just nothing in the frontend that could reach it.
export default function RegisterPage() {
    const groupLabelId1 = useId();
    const router = useRouter();
    const INSTANCE_TYPE = (process.env.NEXT_PUBLIC_INSTANCE_TYPE || "private") as
        | "public"
        | "private";

    const [uuid, setUuid] = useState<string | null>(null);
    const [uuidError, setUuidError] = useState<string | null>(null);
    const [copied, setCopied] = useState(false);
    const [password, setPassword] = useState("");
    const [confirmPassword, setConfirmPassword] = useState("");
    const [passwordVisible, setPasswordVisible] = useState(false);
    const [confirmPasswordVisible, setConfirmPasswordVisible] = useState(false);
    const [formError, setFormError] = useState<string | null>(null);
    const [isSubmitting, setIsSubmitting] = useState(false);

    const loadUuid = async () => {
        setUuidError(null);
        try {
            const result = await api.generateAccountUuid();
            setUuid(result.uuid);
        } catch {
            setUuidError("Failed to generate an account ID. Please refresh and try again.");
        }
    };

    useEffect(() => {
        if (INSTANCE_TYPE === "public") {
            loadUuid();
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [INSTANCE_TYPE]);

    const copyUuid = () => {
        if (!uuid) {
            return;
        }
        copyToClipboard(uuid);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!uuid) {
            return;
        }
        setFormError(null);

        if (password.length < 4) {
            setFormError("Password must be at least 4 characters.");
            return;
        }
        if (password !== confirmPassword) {
            setFormError("Passwords do not match.");
            return;
        }

        setIsSubmitting(true);
        try {
            const data = await api.register(uuid, password);
            if (data.token) {
                localStorage.setItem("slicksync-admin-token", data.token);
            }
            router.push("/");
        } catch (err: any) {
            if (err?.response?.status === 409) {
                // Vanishingly unlikely (server-generated UUID collision), but
                // recoverable - just get a fresh one and let them retry.
                setFormError(
                    "That account ID was just taken - generated a new one, please try again."
                );
                loadUuid();
            } else {
                setFormError(err?.message || "Registration failed. Please try again.");
            }
        } finally {
            setIsSubmitting(false);
        }
    };

    if (INSTANCE_TYPE !== "public") {
        return (
            <div
                className="flex min-h-screen items-center justify-center p-6"
                style={{ background: "var(--color-bg)" }}
            >
                {/* max-w-md no-ops under globals.css's unlayered `* { max-width: 100vw }` - see NebulaTopbar.tsx */}
                <div className="w-full text-center" style={{ maxWidth: "448px" }}>
                    <h1
                        className="mb-2 font-semibold text-xl"
                        style={{ color: "var(--color-text)" }}
                    >
                        Registration isn't available
                    </h1>
                    <p className="mb-6 text-sm" style={{ color: "var(--color-text-muted)" }}>
                        This instance is running in private mode, which uses a single shared login
                        rather than separate self-registered accounts.
                    </p>
                    <button
                        className="text-sm hover:underline"
                        onClick={() => router.push("/login?mode=admin")}
                        style={{ color: "var(--color-primary)" }}
                        type="button"
                    >
                        Go to sign in
                    </button>
                </div>
            </div>
        );
    }

    return (
        <div
            className="flex min-h-screen items-center justify-center p-6"
            style={{ background: "var(--color-bg)" }}
        >
            {/* Background gradient - matches the login page */}
            <div className="pointer-events-none fixed inset-0 overflow-hidden">
                {/* Drawn without a blur filter - see .glow in globals.css. */}
                <div className="glow glow-corner-a" />
                <div className="glow glow-corner-b" />
            </div>

            <motion.div
                animate={{ opacity: 1, y: 0 }}
                className="relative w-full"
                initial={{ opacity: 0, y: 20 }}
                style={{ maxWidth: "448px" }}
            >
                {/* Logo */}
                <div className="mb-8 text-center">
                    <motion.div
                        animate={{ opacity: 1, scale: 1 }}
                        className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl"
                        initial={{ opacity: 0, scale: 0.8 }}
                        style={{ background: "var(--color-primary)" }}
                        transition={{ delay: 0.1 }}
                    >
                        <SlickSyncLogo className="h-10 w-10" />
                    </motion.div>
                    <h1
                        className="mb-2 font-bold font-display text-3xl"
                        style={{ color: "var(--color-text)" }}
                    >
                        SlickSync
                    </h1>
                    <p style={{ color: "var(--color-text-muted)" }}>Create your admin account</p>
                </div>

                <motion.div
                    className="overflow-hidden rounded-2xl"
                    style={{
                        background: "var(--color-surface)",
                        border: "1px solid var(--color-surface-border)",
                    }}
                >
                    <div className="h-1" style={{ background: "var(--color-primary)" }} />

                    <div className="space-y-4 p-6">
                        {/* Account ID - server-generated, not user-chosen. This is the
                permanent login identifier with no recovery flow, so it's
                shown up front with a copy button and a clear warning rather
                than buried until after registration completes. */}
                        <fieldset
                            aria-labelledby={`${groupLabelId1}-1`}
                            className="mx-0 min-w-0 border-0 p-0"
                        >
                            <p
                                className="mb-2 block font-medium text-sm"
                                id={`${groupLabelId1}-1`}
                                style={{ color: "var(--color-text)" }}
                            >
                                Your account ID
                            </p>
                            <div className="flex items-center gap-2">
                                <div
                                    className="flex-1 truncate rounded-xl px-4 py-3 font-mono text-sm"
                                    style={{
                                        background: "var(--color-bg)",
                                        border: "1px solid var(--color-surface-border)",
                                        color: "var(--color-text)",
                                    }}
                                >
                                    {uuid || (uuidError ? "—" : "Generating…")}
                                </div>
                                <button
                                    aria-label="Copy account ID"
                                    className="shrink-0 rounded-xl p-3 transition-all"
                                    disabled={!uuid}
                                    onClick={copyUuid}
                                    style={{
                                        background: "var(--color-bg)",
                                        border: "1px solid var(--color-surface-border)",
                                        opacity: uuid ? 1 : 0.5,
                                    }}
                                    type="button"
                                >
                                    {copied ? (
                                        <CheckIcon
                                            className="h-4 w-4"
                                            style={{ color: "var(--color-success)" }}
                                        />
                                    ) : (
                                        <ClipboardIcon
                                            className="h-4 w-4"
                                            style={{ color: "var(--color-text-muted)" }}
                                        />
                                    )}
                                </button>
                            </div>
                            <p className="mt-2 text-xs" style={{ color: "var(--color-warning)" }}>
                                Save this somewhere safe - it's your login ID, and there's no way to
                                recover it if lost.
                            </p>
                            {uuidError && (
                                <p className="mt-2 text-xs" style={{ color: "var(--color-error)" }}>
                                    {uuidError}{" "}
                                    <button className="underline" onClick={loadUuid} type="button">
                                        Retry
                                    </button>
                                </p>
                            )}
                        </fieldset>

                        <form className="space-y-4" onSubmit={handleSubmit}>
                            <div>
                                <label
                                    className="mb-2 block font-medium text-sm"
                                    htmlFor="password"
                                    style={{ color: "var(--color-text)" }}
                                >
                                    Password
                                </label>
                                <div className="relative">
                                    <input
                                        autoComplete="new-password"
                                        className="w-full rounded-xl py-3 pr-12 pl-4 text-sm transition-all"
                                        id="password"
                                        onChange={(e) => setPassword(e.target.value)}
                                        placeholder="At least 4 characters"
                                        style={{
                                            background: "var(--color-bg)",
                                            border: "1px solid var(--color-surface-border)",
                                            color: "var(--color-text)",
                                        }}
                                        type={passwordVisible ? "text" : "password"}
                                        value={password}
                                    />
                                    <PasswordToggleButton
                                        onToggle={() => setPasswordVisible((v) => !v)}
                                        visible={passwordVisible}
                                    />
                                </div>
                            </div>

                            <div>
                                <label
                                    className="mb-2 block font-medium text-sm"
                                    htmlFor="confirmPassword"
                                    style={{ color: "var(--color-text)" }}
                                >
                                    Confirm password
                                </label>
                                <div className="relative">
                                    <input
                                        autoComplete="new-password"
                                        className="w-full rounded-xl py-3 pr-12 pl-4 text-sm transition-all"
                                        id="confirmPassword"
                                        onChange={(e) => setConfirmPassword(e.target.value)}
                                        placeholder="********"
                                        style={{
                                            background: "var(--color-bg)",
                                            border: "1px solid var(--color-surface-border)",
                                            color: "var(--color-text)",
                                        }}
                                        type={confirmPasswordVisible ? "text" : "password"}
                                        value={confirmPassword}
                                    />
                                    <PasswordToggleButton
                                        onToggle={() => setConfirmPasswordVisible((v) => !v)}
                                        visible={confirmPasswordVisible}
                                    />
                                </div>
                            </div>

                            {formError && (
                                <motion.p
                                    animate={{ opacity: 1, y: 0 }}
                                    className="text-sm"
                                    initial={{ opacity: 0, y: -5 }}
                                    style={{ color: "var(--color-error)" }}
                                >
                                    {formError}
                                </motion.p>
                            )}

                            <button
                                className="flex w-full items-center justify-center gap-2 rounded-xl py-3.5 font-medium transition-all"
                                disabled={isSubmitting || !uuid || !password || !confirmPassword}
                                style={{
                                    background: "var(--color-primary)",
                                    color: "white",
                                    opacity:
                                        isSubmitting || !uuid || !password || !confirmPassword
                                            ? 0.5
                                            : 1,
                                }}
                                type="submit"
                            >
                                {isSubmitting ? (
                                    <>
                                        <span className="h-5 w-5 animate-spin rounded-full border-2 border-current border-t-transparent" />
                                        Creating account...
                                    </>
                                ) : (
                                    <>
                                        <ArrowRightIcon className="h-5 w-5" />
                                        Create account
                                    </>
                                )}
                            </button>
                        </form>
                    </div>
                </motion.div>

                <p
                    className="mt-6 text-center text-sm"
                    style={{ color: "var(--color-text-subtle)" }}
                >
                    Already have an account?{" "}
                    <button
                        className="hover:underline"
                        onClick={() => router.push("/login?mode=admin")}
                        style={{ color: "var(--color-primary)" }}
                        type="button"
                    >
                        Sign in
                    </button>
                </p>
            </motion.div>
        </div>
    );
}
