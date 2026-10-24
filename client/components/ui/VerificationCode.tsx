'use client';

import { CheckIcon, ClipboardIcon } from '@heroicons/react/24/outline';

/** Device approval codes can be long tokens rather than short PINs. */
export function VerificationCode({ code, copied, onCopy }: {
  code: string;
  copied: boolean;
  onCopy: () => void;
}) {
  return (
    <button type="button" onClick={onCopy} disabled={!code} aria-label="Copy verification code"
      className="verification-code flex w-full min-w-0 items-start gap-3 rounded-xl border border-default bg-bg p-4 text-left transition-colors hover:bg-surface-hover disabled:opacity-50">
      <code className="min-w-0 flex-1 whitespace-normal break-all text-sm leading-relaxed text-default">{code || 'Preparing your code...'}</code>
      <span className="shrink-0 pt-0.5" aria-hidden="true">{copied ? <CheckIcon className="w-4 h-4 text-success" /> : <ClipboardIcon className="w-4 h-4 text-muted" />}</span>
      <span className="sr-only" role="status">{copied ? 'Code copied' : ''}</span>
    </button>
  );
}
