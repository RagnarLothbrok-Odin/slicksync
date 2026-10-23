'use client';

import { CheckIcon } from '@heroicons/react/24/outline';
import clsx from 'clsx';

interface SelectionCheckboxProps {
  checked: boolean;
  onChange?: () => void;
  className?: string;
  visible?: boolean;
}

export function SelectionCheckbox({ checked, onChange, className = '', visible = true }: SelectionCheckboxProps) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      aria-label={checked ? 'Deselect item' : 'Select item'}
      onClick={(event) => { event.stopPropagation(); onChange?.(); }}
      className={clsx(
        'interface-checkbox relative w-6 h-6 flex items-center justify-center',
        checked && 'interface-checkbox-checked',
        !visible && !checked && 'opacity-0 focus-visible:opacity-100',
        className
      )}
    >
      {checked && <CheckIcon aria-hidden className="w-4 h-4" strokeWidth={2.5} />}
    </button>
  );
}
