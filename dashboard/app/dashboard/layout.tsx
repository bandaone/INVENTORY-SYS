import { redirect } from 'next/navigation'

export default function LegacyDashboardLayout() {
  // This route tree was an early static prototype and included fabricated
  // activity and health signals. Preserve old bookmarks by redirecting them
  // into the authenticated production dashboard.
  redirect('/')
}
