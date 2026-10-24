"use client";

import { EyeIcon, EyeSlashIcon, MagnifyingGlassIcon } from "@heroicons/react/24/outline";
import clsx from "clsx";
import {
    forwardRef,
    type InputHTMLAttributes,
    type TextareaHTMLAttributes,
    useId,
    useState,
} from "react";

interface InputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "size"> {
    error?: string;
    hint?: string;
    label?: string;
    leftIcon?: React.ReactNode;
    // Fires right before the eye icon reveals (not on hide) a password field -
    // lets a caller lazy-fetch a real stored value first instead of the eye
    // just toggling visibility of whatever's already typed (which is nothing,
    // for an edit form's deliberately-blank "leave empty to keep current"
    // field - confirmed real confusion: the field LOOKS like it holds the
    // current secret since it shows placeholder dots, but reveal showed
    // nothing because there was nothing typed to reveal). Optional; every
    // existing caller keeps the plain show/hide toggle unchanged.
    onRevealClick?: () => void;
    rightIcon?: React.ReactNode;
    size?: "sm" | "md";
}

export const Input = forwardRef<HTMLInputElement, InputProps>(
    (
        {
            label,
            error,
            hint,
            leftIcon,
            rightIcon,
            size = "md",
            className,
            onRevealClick,
            ...props
        },
        ref
    ) => {
        const generatedId = useId();
        const inputId = props.id || generatedId;
        const messageId = `${inputId}-message`;
        const sizeStyles = {
            md: "px-4 py-3",
            sm: "px-3 py-1.5 text-sm",
        };

        const iconSizeStyles = {
            md: "left-4",
            sm: "left-3",
        };

        // Every password field in the app was unreadable dots with no way to
        // check what was actually typed - real feedback that this made typing
        // (and copy-pasting into) credential fields error-prone. type="password"
        // gets this automatically rather than needing every caller to opt in -
        // toggling swaps the native input type itself (not just a CSS mask), so
        // browser/password-manager autofill still behaves correctly either way.
        // rightIcon is ignored in this combination (no current caller passes
        // both together) since there's only one slot to put an icon in.
        const isPassword = props.type === "password";
        const [passwordVisible, setPasswordVisible] = useState(false);
        const effectiveRightIcon = isPassword ? (
            <button
                aria-label={passwordVisible ? "Hide password" : "Show password"}
                className="pointer-events-auto -m-1 rounded-md p-1 transition-colors hover:bg-surface-hover"
                onClick={() => {
                    if (!passwordVisible) {
                        onRevealClick?.();
                    }
                    setPasswordVisible((v) => !v);
                }}
                title={passwordVisible ? "Hide password" : "Show password"}
                type="button"
            >
                {passwordVisible ? (
                    <EyeSlashIcon className={size === "sm" ? "h-4 w-4" : "h-5 w-5"} />
                ) : (
                    <EyeIcon className={size === "sm" ? "h-4 w-4" : "h-5 w-5"} />
                )}
            </button>
        ) : (
            rightIcon
        );

        return (
            <div className="w-full">
                {label && (
                    <label
                        className="mb-2 block font-medium text-sm"
                        htmlFor={inputId}
                        style={{ color: "var(--color-text-muted)" }}
                    >
                        {label}
                    </label>
                )}
                <div className="relative">
                    {leftIcon && (
                        <div
                            className={clsx(
                                "absolute top-1/2 -translate-y-1/2",
                                iconSizeStyles[size]
                            )}
                            style={{ color: "var(--color-text-subtle)" }}
                        >
                            {leftIcon}
                        </div>
                    )}
                    <input
                        aria-describedby={error || hint ? messageId : undefined}
                        aria-invalid={error ? true : undefined}
                        className={clsx(
                            "slicksync-input w-full rounded-xl transition-colors duration-150",
                            sizeStyles[size],
                            "focus:shadow-none focus:outline-none focus:ring-0 focus-visible:shadow-none focus-visible:outline-none focus-visible:ring-0",
                            "border",
                            error
                                ? "border-theme-error focus:border-theme-error"
                                : "border-theme-surface-border focus:border-theme-primary-muted",
                            leftIcon && (size === "sm" ? "pl-9" : "pl-12"),
                            effectiveRightIcon && (size === "sm" ? "pr-9" : "pr-12"),
                            className
                        )}
                        id={inputId}
                        ref={ref}
                        style={{
                            backgroundColor: "var(--color-bg-subtle)",
                            borderColor: "var(--color-surface-border)",
                            color: "var(--color-text)",
                            ...props.style,
                        }}
                        {...props}
                        type={isPassword ? (passwordVisible ? "text" : "password") : props.type}
                    />
                    {effectiveRightIcon && (
                        <div
                            className="absolute top-1/2 right-4 -translate-y-1/2"
                            style={{ color: "var(--color-text-subtle)" }}
                        >
                            {effectiveRightIcon}
                        </div>
                    )}
                </div>
                {(error || hint) && (
                    <p
                        className={`mt-2 text-sm ${error ? "text-error" : "text-subtle"}`}
                        id={messageId}
                        role={error ? "alert" : undefined}
                    >
                        {error || hint}
                    </p>
                )}
            </div>
        );
    }
);

Input.displayName = "Input";

// Show/hide toggle for a plain, hand-rolled `<input type="password">` -
// callers that don't go through the Input component above (a few pages
// build their own styled input directly instead) still get the same
// eye-icon toggle by wiring this in themselves: track a `visible` boolean,
// pass `type={visible ? 'text' : 'password'}` to the input, position this
// button absolutely inside a `relative` wrapper, right-pad the input so
// typed text doesn't run under the icon. Same markup/behavior Input uses
// internally, factored out so both paths render identically instead of
// two hand-maintained copies of the same button.
export function PasswordToggleButton({
    visible,
    onToggle,
    size = "md",
}: {
    visible: boolean;
    onToggle: () => void;
    size?: "sm" | "md";
}) {
    return (
        <button
            aria-label={visible ? "Hide password" : "Show password"}
            className="absolute top-1/2 right-4 -m-1 -translate-y-1/2 rounded-md p-1 transition-colors hover:bg-surface-hover"
            onClick={onToggle}
            style={{ color: "var(--color-text-subtle)" }}
            tabIndex={-1}
            title={visible ? "Hide password" : "Show password"}
            type="button"
        >
            {visible ? (
                <EyeSlashIcon className={size === "sm" ? "h-4 w-4" : "h-5 w-5"} />
            ) : (
                <EyeIcon className={size === "sm" ? "h-4 w-4" : "h-5 w-5"} />
            )}
        </button>
    );
}

// Textarea component
interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
    error?: string;
    hint?: string;
    label?: string;
}

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(
    ({ label, error, hint, className, ...props }, ref) => {
        const generatedId = useId();
        const inputId = props.id || generatedId;
        const messageId = `${inputId}-message`;
        return (
            <div className="w-full">
                {label && (
                    <label
                        className="mb-2 block font-medium text-sm"
                        htmlFor={inputId}
                        style={{ color: "var(--color-text-muted)" }}
                    >
                        {label}
                    </label>
                )}
                <textarea
                    aria-describedby={error || hint ? messageId : undefined}
                    aria-invalid={error ? true : undefined}
                    className={clsx(
                        "interface-field w-full resize-none rounded-xl px-4 py-3 transition-all duration-300",
                        "focus:outline-none focus:ring-0 focus-visible:outline-none focus-visible:ring-0",
                        "border",
                        error
                            ? "border-theme-error focus:border-theme-error"
                            : "border-theme-surface-border focus:border-theme-secondary",
                        className
                    )}
                    id={inputId}
                    ref={ref}
                    style={{
                        backgroundColor: "var(--color-bg-subtle)",
                        color: "var(--color-text)",
                    }}
                    {...props}
                />
                {(error || hint) && (
                    <p
                        className={`mt-2 text-sm ${error ? "text-error" : "text-subtle"}`}
                        id={messageId}
                        role={error ? "alert" : undefined}
                    >
                        {error || hint}
                    </p>
                )}
            </div>
        );
    }
);

Textarea.displayName = "Textarea";

// Search input with animation
interface SearchInputProps extends Omit<InputProps, "leftIcon"> {
    onSearch?: (value: string) => void;
    size?: "sm" | "md";
}

export function SearchInput({ onSearch, size = "md", ...props }: SearchInputProps) {
    return (
        <Input
            leftIcon={
                <MagnifyingGlassIcon
                    className={size === "sm" ? "h-4 w-4" : "h-5 w-5"}
                    style={{ color: "var(--color-text-muted)" }}
                />
            }
            placeholder="Search..."
            size={size}
            style={{
                backgroundColor: "var(--color-surface)",
                borderColor: "var(--color-surface-border)",
                color: "var(--color-text)",
            }}
            {...props}
        />
    );
}

// Select component
interface SelectOption {
    label: string;
    value: string;
}

interface SelectProps {
    error?: string;
    label?: string;
    onChange?: (value: string) => void;
    options: SelectOption[];
    placeholder?: string;
    value?: string;
}

export function Select({ label, options, value, onChange, placeholder, error }: SelectProps) {
    const inputId = useId();
    return (
        <div className="w-full">
            {label && (
                <label
                    className="mb-2 block font-medium text-sm"
                    htmlFor={inputId}
                    style={{ color: "var(--color-text-muted)" }}
                >
                    {label}
                </label>
            )}
            <select
                aria-invalid={error ? true : undefined}
                className={clsx(
                    "interface-field w-full rounded-xl px-4 py-3 transition-all duration-300",
                    "cursor-pointer appearance-none",
                    "focus:outline-none focus:ring-0 focus-visible:outline-none focus-visible:ring-0",
                    "border",
                    error
                        ? "border-theme-error focus:border-theme-error"
                        : "border-theme-surface-border focus:border-theme-secondary",
                    "xmlns='http://www.w3.org/2000/svg' fill='none' viewBox='0 0 24 24' stroke='%2394a3b8'%3E%3Cpath d='M19 9l-7 7-7-7'/%3E%3C/svg%3E\")] bg-[url(\"data:image/svg+xml,%3Csvg stroke-linecap='round' stroke-linejoin='round' stroke-width='2'",
                    "bg-[length:1.25rem] bg-[right_1rem_center] bg-no-repeat"
                )}
                id={inputId}
                onChange={(e) => onChange?.(e.target.value)}
                style={{
                    backgroundColor: "var(--color-bg-subtle)",
                    color: "var(--color-text)",
                }}
                value={value}
            >
                {placeholder && (
                    <option disabled value="">
                        {placeholder}
                    </option>
                )}
                {options.map((opt) => (
                    <option
                        key={opt.value}
                        style={{ backgroundColor: "var(--color-surface)" }}
                        value={opt.value}
                    >
                        {opt.label}
                    </option>
                ))}
            </select>
            {error && (
                <p className="mt-2 text-sm" style={{ color: "var(--color-error)" }}>
                    {error}
                </p>
            )}
        </div>
    );
}
