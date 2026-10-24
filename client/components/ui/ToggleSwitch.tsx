'use client';

import { motion, useReducedMotion } from 'framer-motion';

interface ToggleSwitchProps {
  checked: boolean;
  onChange: () => void;
  size?: 'sm' | 'md';
  title?: string;
  disabled?: boolean;
  className?: string;
}

export function ToggleSwitch({
  checked,
  onChange,
  size = 'md',
  title,
  disabled = false,
  className = ''
}: ToggleSwitchProps) {
  const reduceMotion = useReducedMotion();
  const trackBase = size === 'sm' ? 'h-5 w-9' : 'h-6 w-11';
  const knobBase = size === 'sm' ? 'h-4 w-4' : 'h-5 w-5';

  return (
    <button
      onClick={(e) => {
        e.stopPropagation();
        if (!disabled) onChange();
      }}
      disabled={disabled}
      className={`interface-toggle relative inline-flex items-center rounded-full transition-colors ${trackBase} disabled:opacity-50 ${checked ? 'tgl-on' : 'tgl-off'} ${className}`}
      role="switch"
      aria-checked={checked}
      aria-label={title}
      title={title}
      type="button"
    >
      <motion.span
        className={`inline-block rounded-full ${knobBase} ${checked ? 'tgl-knob-on' : 'tgl-knob-off'}`}
        animate={{
          x: checked ? (size === 'sm' ? 16 : 20) : (size === 'sm' ? 2 : 4)
        }}
        transition={reduceMotion ? { duration: 0 } : { type: 'spring', bounce: 0, duration: 0.25 }}
      />
    </button>
  );
}
