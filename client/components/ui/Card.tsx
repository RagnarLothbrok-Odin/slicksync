'use client';

import { motion, HTMLMotionProps, useReducedMotion } from 'framer-motion';
import clsx from 'clsx';
import { useLayoutMode } from '@/lib/layout-mode';

interface CardProps extends HTMLMotionProps<'div'> {
  variant?: 'default' | 'elevated' | 'bordered' | 'interactive' | 'aurora';
  padding?: 'none' | 'sm' | 'md' | 'lg';
  children: React.ReactNode;
}

const paddingStyles = {
  none: '',
  sm: 'p-3',
  md: 'p-4',
  lg: 'p-5',
};

// Card and StatCard both check layoutMode directly rather than requiring
// every page that renders one to pass a prop through - pages like Settings
// and Tasks are built almost entirely out of independent <Card> sections
// (not the toolbar+grid shape Dashboard/Activity/Users/Groups/Addons have),
// so making the shared component itself Nebula-aware upgrades all of them
// to the glass-panel look for free, instead of needing a second styled
// copy of every section on every such page.
export function Card({
  variant = 'default',
  padding = 'md',
  children,
  className,
  style,
  ...props
}: CardProps) {
  const { layoutMode } = useLayoutMode();
  const reduceMotion = useReducedMotion();
  const isInteractive = variant === 'interactive';
  const isAurora = variant === 'aurora';
  const isNebula = layoutMode === 'nebula' && !isAurora;

  return (
    <motion.div
      whileHover={isInteractive && !reduceMotion ? { y: -2 } : undefined}
      transition={{ type: 'spring', bounce: 0, duration: 0.3 }}
      className={clsx(
        'interface-card rounded-2xl relative overflow-hidden',
        paddingStyles[padding],
        variant === 'bordered' && 'accent-border',
        !isAurora && (isNebula ? 'card-bg-nebula' : 'card-bg-plain'),
        className
      )}
      style={{
        background: isAurora
          ? 'linear-gradient(135deg, var(--color-primary) 0%, var(--color-secondary) 100%)'
          : undefined,


        border: isAurora ? 'none' : '1px solid var(--color-surface-border)',
        boxShadow: isAurora
          ? '0 12px 32px -12px var(--color-primary)'
          : '0 1px 0 0 rgba(255,255,255,0.02) inset, 0 8px 24px -16px rgba(0,0,0,0.4)',
        ...style,
      }}
      {...props}
    >
      {children}
    </motion.div>
  );
}

// Stat Card Component
interface StatCardProps {
  label: string;
  value: string | number;
  icon?: React.ReactNode;
  trend?: { value: number; isPositive: boolean };
  delay?: number;
  onClick?: () => void;
}

export function StatCard({ label, value, icon, trend, delay = 0, onClick }: StatCardProps) {
  const { layoutMode } = useLayoutMode();
  const reduceMotion = useReducedMotion();
  const isNebula = layoutMode === 'nebula';
  return (
    <motion.div
      initial={false}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, delay }}
      whileHover={onClick && !reduceMotion ? { y: -2 } : undefined}
      onClick={onClick}
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      onKeyDown={onClick ? (event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onClick(); } } : undefined}
      className={`interface-card rounded-2xl p-5 relative overflow-hidden min-h-[112px] group ${onClick ? 'cursor-pointer' : ''} ${isNebula ? 'card-bg-nebula' : 'card-bg-plain'}`}
      style={{


        border: '1px solid var(--color-surface-border)',
      }}
    >
      {/* Hover glow */}
      <div
        className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-300"
        style={{ background: 'var(--color-primaryMuted)' }}
      />

      <div className="relative flex items-start justify-between h-full">
        <div className="flex flex-col justify-between h-full">
          <p className="text-xs font-medium" style={{ color: 'var(--color-text-muted)' }}>
            {label}
          </p>
          <div>
            <motion.p
              className="text-2xl font-bold font-display"
              style={{ color: 'var(--color-text)' }}
              initial={false}
              animate={{ scale: 1 }}
              transition={{ type: 'spring', stiffness: 200, delay: delay + 0.1 }}
            >
              {typeof value === 'number' ? value.toLocaleString() : value}
            </motion.p>
            {trend ? (
              <div
                className={`flex items-center gap-1 text-xs font-medium mt-0.5 ${trend.isPositive ? 'text-success' : 'text-error'}`}
              >
                <span>{trend.isPositive ? '↑' : '↓'}</span>
                <span>{Math.abs(trend.value)}%</span>
              </div>
            ) : (
              <div className="h-4" /> /* Spacer for consistent height */
            )}
          </div>
        </div>
        {icon && (
          <div
            className="w-9 h-9 rounded-lg flex items-center justify-center"
            style={{
              background: 'var(--color-primaryMuted)',
              color: 'var(--color-primary)'
            }}
          >
            {icon}
          </div>
        )}
      </div>
    </motion.div>
  );
}
