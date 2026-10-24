'use client';

import { cloneElement, isValidElement } from 'react';
import { motion } from 'framer-motion';

export function ToggleSwitch({
  enabled,
  onChange,
  label,
  disabled,
}: {
  enabled: boolean;
  onChange: (value: boolean) => void;
  label?: string;
  disabled?: boolean;
}) {
  return (
    <button
      onClick={() => !disabled && onChange(!enabled)}
      className={`flex items-center gap-3 ${disabled ? 'opacity-50 cursor-not-allowed' : ''}`}
      role="switch"
      aria-checked={enabled}
      aria-label={label}
      disabled={disabled}
    >
      <div
        className={`relative w-10 h-5 rounded-full transition-colors ${
          enabled ? 'bg-primary' : 'bg-muted'
        }`}
      >
        <motion.div
          initial={false}
          animate={{ x: enabled ? 20 : 2 }}
          transition={{ type: 'spring', stiffness: 500, damping: 30 }}
          className="absolute top-0.5 w-4 h-4 rounded-full shadow-md bg-surface"
          style={{ backgroundColor: 'var(--color-text)' }}
        />
      </div>
    </button>
  );
}

// Setting row component
export function SettingRow({
  label,
  description,
  children,
  disabled,
}: {
  label: string;
  description: React.ReactNode;
  children: React.ReactNode;
  disabled?: boolean;
}) {
  return (
    // data-setting carries the visible label verbatim so the command
    // palette's settings deep-search (lib/settingsIndex.ts) can scroll to
    // and flash this exact row via /settings?highlight=<label>.
    <div data-setting={label} className={`settings-row flex items-center justify-between gap-6 p-4 rounded-lg bg-subtle ${disabled ? 'opacity-50 pointer-events-none' : ''}`}>
      <div className="min-w-0 flex-1">
        <p className="font-medium text-sm text-default">{label}</p>
        <div className="text-xs text-muted">{description}</div>
      </div>
      {isValidElement<{ label?: string }>(children) && children.type === ToggleSwitch
        ? cloneElement(children, { label }) : children}
    </div>
  );
}

