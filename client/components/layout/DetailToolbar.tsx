'use client';

import Link from 'next/link';
import { ReactNode } from 'react';
import { ChevronLeftIcon } from '@heroicons/react/24/outline';
import { TopbarActions } from './TopbarActions';

interface DetailToolbarProps {
  title: string;
  backHref: string;
  backLabel: string;
  actions?: ReactNode;
}

/** Detail pages let the editable identity lead instead of repeating a title. */
export function DetailToolbar({ title, backHref, backLabel, actions }: DetailToolbarProps) {
  return (
    <div className="detail-toolbar flex items-center justify-between gap-4 flex-wrap mb-6">
      <h1 className="sr-only">{title}</h1>
      <Link href={backHref} className="detail-back-link inline-flex items-center gap-1.5 text-sm font-medium text-muted rounded-xl py-2.5 pr-3">
        <ChevronLeftIcon className="w-4 h-4" />{backLabel}
      </Link>
      <div className="detail-toolbar-controls flex items-center justify-end gap-3 flex-wrap min-w-0 ml-auto">
        <div className="detail-actions min-w-0">{actions}</div>
        <TopbarActions />
      </div>
    </div>
  );
}
