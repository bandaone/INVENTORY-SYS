import SuperAdminSidebar from '@/components/SuperAdminSidebar';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';

export default function SuperAdminLayout({ children }: { children: React.ReactNode }) {
  const staffRole = cookies().get('staff_role')?.value || '';
  if (staffRole !== 'superadmin') redirect('/login');

  return (
    <div className="app-container">
      <SuperAdminSidebar />
      <main className="main-content">
        {children}
      </main>
    </div>
  );
}
