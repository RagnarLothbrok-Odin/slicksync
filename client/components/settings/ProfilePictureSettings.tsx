'use client';

import type { ComponentProps, ReactNode } from 'react';
import { UserCircleIcon } from '@heroicons/react/24/outline';
import { Avatar, Button, Card } from '@/components/ui';

// Keep the account picture and its action identical for both account roles.
export function ProfilePictureSettings({ onChange, children, ...avatar }: Omit<ComponentProps<typeof Avatar>, 'size'> & { onChange: () => void; children?: ReactNode }) {
  return <Card padding="lg">
    <div className="flex items-center gap-3 mb-5">
      <div className="w-9 h-9 rounded-lg flex items-center justify-center bg-primary-muted">
        <UserCircleIcon className="w-5 h-5 text-primary" />
      </div>
      <div>
        <h3 className="text-base font-semibold font-display text-default">Profile Picture</h3>
        <p className="text-xs text-muted">Shown on your account button and its menu</p>
      </div>
    </div>
    <div className="flex items-center gap-4">
      <Avatar {...avatar} size="xl" />
      <div className="flex-1">
        <Button variant="secondary" size="sm" onClick={onChange}>Change Picture</Button>
        <p className="text-xs text-muted mt-2">Choose an avatar, upload an image, or paste a link.</p>
      </div>
    </div>
    {children}
  </Card>;
}
