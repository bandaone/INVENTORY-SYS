import Sidebar from '@/components/Sidebar';
import { cookies } from 'next/headers';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { adminPool } from '@/lib/db';
import { requireTenantSession } from '@/lib/session';

export const dynamic = 'force-dynamic';

export default async function TenantLayout({ children }: { children: React.ReactNode }) {
  const cookieStore = await cookies();
  const pathname = (await headers()).get('x-retail-pathname') || '';
  const session = await requireTenantSession(undefined, { allowSuspended: true }).catch(() => null);
  const tenantId = session?.tenantId;
  const staffRole = session?.role || '';

  if (!session || !tenantId || session.role === 'superadmin') redirect('/login');

  const tenantRestricted = session.tenantStatus === 'SUSPENDED' || session.tenantStatus === 'CANCELLED';
  if (tenantRestricted && (session.role !== 'owner' || pathname !== '/subscription')) {
    redirect(session.role === 'owner' ? '/subscription' : '/login');
  }

  // Role-based routing: cashiers/stock_clerks are sent to their dedicated workspaces
  if (staffRole === 'cashier')     redirect('/pos');
  if (staffRole === 'store_manager') redirect('/operations');
  if (staffRole === 'stock_clerk') redirect('/operations');

  if (staffRole === 'owner') {
    const onboarding = await adminPool.query(`
      SELECT go_live_approved
      FROM onboarding_sessions
      WHERE tenant_id = $1
      LIMIT 1
    `, [tenantId]);
    if (onboarding.rows[0] && !onboarding.rows[0].go_live_approved) redirect('/setup');
  }

  const tenantName = cookieStore.get('tenant_name')?.value || 'Unknown Store';
  const staffName  = cookieStore.get('staff_name')?.value  || 'Staff Member';

  return (
    <div className="app-container">
      <Sidebar tenantName={tenantName} staffName={staffName} staffRole={staffRole} />
      <main className="main-content">{children}</main>
    </div>
  );
}
