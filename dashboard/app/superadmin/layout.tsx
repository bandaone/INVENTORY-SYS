import SuperAdminSidebar from '@/components/SuperAdminSidebar';
import { redirect } from 'next/navigation';
import { requirePlatformSession } from '@/lib/session';

export default async function SuperAdminLayout({ children }: { children: React.ReactNode }) {
  const session = await requirePlatformSession().catch(() => null);
  if (!session || session.type !== 'platform' || session.role !== 'superadmin') redirect('/login');

  return (
    <div className="app-container">
      <SuperAdminSidebar />
      <main className="main-content">
        {children}
      </main>
    </div>
  );
}
