'use client';

import { usePathname } from 'next/navigation';
import { Card } from '@/components/ui';
import { usePersonalPreferences } from './PersonalPreferences';

const hints: Record<string, string> = {
  '/user': 'This is your account overview. Sync applies the addons supplied by your groups; your provider manages the underlying account.',
  '/user/library': 'Your library comes from your connected provider. Removing a title here can also remove it from that provider.',
  '/user/activity': 'These charts and sessions show your own viewing. Activity Visibility decides whether group members can see your activity.',
  '/user/addons': 'Your groups supply managed addons. Excluding an addon changes what is synced to your account; protecting one keeps your own addon during sync.',
  '/user/shares': 'Share a title with a group member, or browse recommendations they have sent you.',
  '/user/discover': 'Browse or search, then open a poster for details. Your watchlist and reactions belong to your account.',
  '/user/settings': 'These preferences belong to your account. Your household administrator manages shared addons, groups, and server settings.',
};
export function PersonalPageHint() {
  const path = usePathname();
  const { preferences } = usePersonalPreferences();
  const hint = hints[path || ''];
  if (!preferences.beginnerMode || !hint) return null;
  return <Card padding="md" className="mt-6"><p className="text-sm text-muted">{hint} <a className="text-primary hover:underline" href="/user/settings?section=about">Help & About</a></p></Card>;
}
