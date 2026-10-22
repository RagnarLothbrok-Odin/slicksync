'use client';

import { motion, HTMLMotionProps } from 'framer-motion';
import { forwardRef } from 'react';
import clsx from 'clsx';

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'aurora' | 'cyan' | 'glass';
type ButtonSize = 'sm' | 'md' | 'lg';

interface ButtonProps extends Omit<HTMLMotionProps<'button'>, 'children'> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  isLoading?: boolean;
  leftIcon?: React.ReactNode;
  rightIcon?: React.ReactNode;
  children: React.ReactNode;
}

const sizes: Record<ButtonSize, string> = {
  sm: 'px-3 py-1.5 text-xs rounded-lg gap-1.5',
  md: 'px-4 py-2 text-sm rounded-lg gap-2',
  lg: 'px-5 py-2.5 text-sm rounded-xl gap-2',
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ variant = 'primary', size = 'md', isLoading, leftIcon, rightIcon, children, className, disabled, style, ...props }, ref) => {
    
    // Colours and hover live in globals.css (.btn-v-*): classes rather than
    // inline styles repainted on hover, which a colour-freezing extension
    // could leave stuck.
    const variantClass = {
      primary: 'btn-v-primary', aurora: 'btn-v-primary',
      secondary: 'btn-v-secondary', glass: 'btn-v-secondary',
      ghost: 'btn-v-ghost', danger: 'btn-v-danger', cyan: 'btn-v-cyan',
    }[variant];

    return (
      <motion.button
        ref={ref}
        whileHover={{ scale: disabled || isLoading ? 1 : 1.02 }}
        whileTap={{ scale: disabled || isLoading ? 1 : 0.98 }}
        transition={{ type: 'spring', stiffness: 400, damping: 17 }}
        className={clsx(
          'relative inline-flex items-center justify-center font-medium transition-all duration-200',
          'focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2',
          'disabled:opacity-50 disabled:cursor-not-allowed',
          variantClass,
          sizes[size],
          className
        )}
        style={style}
        disabled={disabled || isLoading}
        {...props}
      >
        {/* Content */}
        <span className="relative flex items-center" style={{ gap: 'inherit' }}>
          {isLoading ? (
            <motion.span
              className="w-4 h-4 border-2 border-current border-t-transparent rounded-full"
              animate={{ rotate: 360 }}
              transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}
            />
          ) : leftIcon}
          {children}
          {!isLoading && rightIcon}
        </span>
      </motion.button>
    );
  }
);

Button.displayName = 'Button';
