'use client';

import { CheckIcon, ClipboardIcon } from '@heroicons/react/24/outline';

/** Device approval codes can be long tokens rather than short PINs. */
export function VerificationCode({ code, copied, onCopy }: {
  code: string;
  copied: boolean;
  onCopy: () => void;
}) {
  const shortCode = /^[a-z0-9-]{1,8}$/i.test(code);

  return (
    <button type="button" onClick={onCopy} disabled={!code} aria-label="Copy verification code"
      className="verification-code grid w-full min-w-0 grid-cols-[1.25rem_minmax(0,1fr)_1.25rem] items-center min-h-16 gap-3 rounded-xl border border-default bg-bg p-4 transition-colors hover:bg-surface-hover disabled:opacity-50">
      <span aria-hidden="true" className="w-5" />
      <code className={`min-w-0 whitespace-normal text-center text-default ${shortCode ? 'text-2xl font-medium tracking-[0.2em] pl-[0.2em]' : 'break-all text-sm leading-relaxed'}`}>{code || 'Preparing your code...'}</code>
      <span className="shrink-0 pt-0.5" aria-hidden="true">{copied ? <CheckIcon className="w-4 h-4 text-success" /> : <ClipboardIcon className="w-4 h-4 text-muted" />}</span>
      <span className="sr-only" role="status">{copied ? 'Code copied' : ''}</span>
    </button>
  );
}
