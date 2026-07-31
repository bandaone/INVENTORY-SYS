import OperationsSidebar from './_components/OperationsSidebar';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { requireTenantSession } from '@/lib/session';

export const dynamic = 'force-dynamic';

export default async function OperationsLayout({ children }: { children: React.ReactNode }) {
  const cookieStore = cookies();
  const session = await requireTenantSession(['store_manager', 'stock_clerk']).catch(() => null);
  const tenantId = session?.tenantId;
  const staffRole = session?.role || '';

  if (!session || !tenantId || session.role === 'superadmin') redirect('/login');

  const tenantName = cookieStore.get('tenant_name')?.value || 'Unknown Store';
  const staffName = cookieStore.get('staff_name')?.value || 'Operations';

  return (
    <div className="app-container">
      <OperationsSidebar tenantName={tenantName} staffName={staffName} staffRole={staffRole} />
      <main className="main-content">{children}</main>
    </div>
  );
}
