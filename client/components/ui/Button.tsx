"use client";

import clsx from "clsx";
import { type HTMLMotionProps, motion, useReducedMotion } from "framer-motion";
import { forwardRef } from "react";

type ButtonVariant = "primary" | "secondary" | "ghost" | "danger" | "aurora" | "cyan" | "glass";
type ButtonSize = "sm" | "md" | "lg";

interface ButtonProps extends Omit<HTMLMotionProps<"button">, "children"> {
    children: React.ReactNode;
    isLoading?: boolean;
    leftIcon?: React.ReactNode;
    rightIcon?: React.ReactNode;
    size?: ButtonSize;
    variant?: ButtonVariant;
}

const sizes: Record<ButtonSize, string> = {
    lg: "min-h-12 px-5 py-3 text-sm rounded-2xl gap-2",
    md: "min-h-11 px-4 py-2.5 text-sm rounded-xl gap-2",
    sm: "min-h-9 px-3.5 py-2 text-sm rounded-xl gap-1.5",
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
    (
        {
            variant = "primary",
            size = "md",
            isLoading,
            leftIcon,
            rightIcon,
            children,
            className,
            disabled,
            style,
            ...props
        },
        ref
    ) => {
        const reduceMotion = useReducedMotion();

        // Colours and hover live in globals.css (.btn-v-*): classes rather than
        // inline styles repainted on hover, which a colour-freezing extension
        // could leave stuck.
        const variantClass = {
            aurora: "btn-v-primary",
            cyan: "btn-v-cyan",
            danger: "btn-v-danger",
            ghost: "btn-v-ghost",
            glass: "btn-v-secondary",
            primary: "btn-v-primary",
            secondary: "btn-v-secondary",
        }[variant];

        return (
            <motion.button
                aria-busy={isLoading || undefined}
                className={clsx(
                    "interface-button relative inline-flex items-center justify-center font-semibold transition-colors duration-150",
                    "focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2",
                    "disabled:cursor-not-allowed disabled:opacity-50",
                    variantClass,
                    sizes[size],
                    className
                )}
                disabled={disabled || isLoading}
                ref={ref}
                style={style}
                transition={{ bounce: 0, duration: 0.3, type: "spring" }}
                whileHover={undefined}
                whileTap={reduceMotion || disabled || isLoading ? undefined : { scale: 0.97 }}
                {...props}
            >
                {/* Content */}
                <span className="relative flex items-center" style={{ gap: "inherit" }}>
                    {isLoading ? (
                        <motion.span
                            animate={reduceMotion ? undefined : { rotate: 360 }}
                            aria-hidden
                            className="h-4 w-4 rounded-full border-2 border-current border-t-transparent"
                            transition={{
                                duration: 1,
                                ease: "linear",
                                repeat: Number.POSITIVE_INFINITY,
                            }}
                        />
                    ) : (
                        leftIcon
                    )}
                    {children}
                    {!isLoading && rightIcon}
                </span>
            </motion.button>
        );
    }
);

Button.displayName = "Button";
