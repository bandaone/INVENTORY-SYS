'use client';

import posthog from 'posthog-js';
import { PostHogProvider as PHProvider } from 'posthog-js/react';
import { useEffect } from 'react';
import { usePathname } from 'next/navigation';

const analyticsEnabled = process.env.NEXT_PUBLIC_ANALYTICS_ENABLED === 'true'
  && Boolean(process.env.NEXT_PUBLIC_POSTHOG_KEY)

if (typeof window !== 'undefined' && analyticsEnabled) {
  posthog.init(process.env.NEXT_PUBLIC_POSTHOG_KEY as string, {
    api_host: process.env.NEXT_PUBLIC_POSTHOG_HOST || 'https://us.i.posthog.com',
    person_profiles: 'identified_only',
    capture_pageview: false,
    autocapture: false,
    disable_session_recording: true,
    secure_cookie: process.env.NODE_ENV === 'production',
  });
}

function PageviewTracker() {
  const pathname = usePathname();

  useEffect(() => {
    if (analyticsEnabled && pathname && typeof window !== 'undefined') {
      // Query strings can contain search terms or provider references, so only
      // the route pathname is sent to product analytics.
      posthog.capture('$pageview', { $current_url: window.origin + pathname });
    }
  }, [pathname]);

  return null;
}

export function PostHogProvider({ children }: { children: React.ReactNode }) {
  return (
    <PHProvider client={posthog}>
      <PageviewTracker />
      {children}
    </PHProvider>
  );
}
