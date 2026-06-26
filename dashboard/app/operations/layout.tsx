import OperationsSidebar from './_components/OperationsSidebar';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';

export const dynamic = 'force-dynamic';

export default function OperationsLayout({ children }: { children: React.ReactNode }) {
  const cookieStore = cookies();
  const tenantId = cookieStore.get('tenant_id')?.value;
  const staffRole = cookieStore.get('staff_role')?.value || '';

  if (!tenantId) redirect('/login');
  if (staffRole === 'cashier') redirect('/pos');
  if (staffRole === 'owner') redirect('/');

  const tenantName = cookieStore.get('tenant_name')?.value || 'Unknown Store';
  const staffName = cookieStore.get('staff_name')?.value || 'Operations';

  return (
    <div className="app-container">
      <OperationsSidebar tenantName={tenantName} staffName={staffName} staffRole={staffRole} />
      <main className="main-content">{children}</main>
    </div>
  );
}
