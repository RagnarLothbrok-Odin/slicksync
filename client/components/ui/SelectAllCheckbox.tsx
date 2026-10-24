'use client';

import { CheckIcon, MinusIcon } from '@heroicons/react/24/outline';
import clsx from 'clsx';

interface SelectAllCheckboxProps {
  totalCount: number;
  selectedCount: number;
  onSelectAll: () => void;
  onDeselectAll: () => void;
  className?: string;
  title?: string;
}

export function SelectAllCheckbox({ totalCount, selectedCount, onSelectAll, onDeselectAll, className = '', title }: SelectAllCheckboxProps) {
  const allSelected = totalCount > 0 && selectedCount === totalCount;
  const mixed = selectedCount > 0 && !allSelected;
  const selected = allSelected || mixed;
  const label = totalCount === 0 ? 'No items to select' : selected ? 'Deselect all items' : `Select all ${totalCount} items`;
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={mixed ? 'mixed' : allSelected}
      aria-label={label}
      title={title || label}
      disabled={totalCount === 0}
      onClick={selected ? onDeselectAll : onSelectAll}
      className={clsx('interface-checkbox relative w-6 h-6 shrink-0 flex items-center justify-center', selected && 'interface-checkbox-checked', className)}
    >
      {mixed ? <MinusIcon aria-hidden className="w-4 h-4" strokeWidth={2.5} /> : allSelected ? <CheckIcon aria-hidden className="w-4 h-4" strokeWidth={2.5} /> : null}
    </button>
  );
}
