'use client';

import React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { 
  Building2, 
  PlusCircle, 
  LayoutDashboard, 
  ShieldCheck,
  LineChart,
  Activity,
  LifeBuoy,
  BarChart3,
  UserCog,
  Hexagon,
  Sun,
  Moon,
  LogOut,
  CreditCard
} from 'lucide-react';
import { useTheme } from '@/components/ThemeProvider';

export default function SuperAdminSidebar() {
  const pathname = usePathname();
  const { theme, toggleTheme } = useTheme();

  // Vercel deployment test trigger
  return (
    <aside className="sidebar" style={{ width: '260px', padding: '24px', display: 'flex', flexDirection: 'column', borderRight: '1px solid var(--panel-border)' }}>
      <div className="sidebar-logo" style={{ marginBottom: '24px' }}>
        <Hexagon className="sidebar-logo-icon" size={28} />
        Retail OS
      </div>

      <div className="tenant-selector" style={{ cursor: 'default', marginBottom: '24px', position: 'relative' }}>
        <div className="tenant-icon" style={{ background: 'rgba(59, 130, 246, 0.1)', color: 'var(--secondary)' }}>
          <ShieldCheck size={16} />
        </div>
        <div className="tenant-info">
          <span className="tenant-name">Retail OS HQ</span>
          <span className="tenant-tier">System Management</span>
        </div>
        <button 
          onClick={() => {
            document.cookie = 'tenant_id=; Max-Age=0; path=/';
            document.cookie = 'staff_role=; Max-Age=0; path=/';
            document.cookie = 'staff_name=; Max-Age=0; path=/';
            window.location.href = '/login';
          }}
          title="Log Out"
          style={{ 
            background: 'transparent', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', 
            padding: '6px', borderRadius: '6px', display: 'flex', alignItems: 'center', justifyContent: 'center',
            transition: 'all 0.2s', marginLeft: 'auto'
          }}
          onMouseEnter={e => { e.currentTarget.style.color = 'var(--danger)'; e.currentTarget.style.background = 'rgba(239,68,68,0.1)'; }}
          onMouseLeave={e => { e.currentTarget.style.color = 'var(--text-muted)'; e.currentTarget.style.background = 'transparent'; }}
        >
          <LogOut size={16} />
        </button>
      </div>

      <nav style={{ display: 'flex', flexDirection: 'column', gap: '8px', flex: 1 }}>
        {[
          { href: '/superadmin', label: 'Overview', icon: LayoutDashboard },
          { href: '/superadmin/revenue', label: 'Revenue', icon: LineChart },
          { href: '/superadmin/tenants', label: 'Tenants', icon: Building2 },
          { href: '/superadmin/onboarding', label: 'Onboarding', icon: PlusCircle },
          { href: '/superadmin/pricing', label: 'Plans & Pricing', icon: CreditCard },
          { href: '/superadmin/health', label: 'Platform Health', icon: Activity },
          { href: '/superadmin/compliance', label: 'Compliance', icon: ShieldCheck },
          { href: '/superadmin/support', label: 'Support', icon: LifeBuoy },
          { href: '/superadmin/intelligence', label: 'Intelligence', icon: BarChart3 },
          { href: '/superadmin/admin', label: 'Admin', icon: UserCog },
        ].map(({ href, label, icon: Icon }) => {
          const active = pathname === href;
          return (
            <Link
              key={href}
              href={href}
              style={{
                display: 'flex', alignItems: 'center', gap: '12px', padding: '12px 16px', borderRadius: '10px', textDecoration: 'none', transition: 'background 0.2s',
                background: active ? 'var(--hover-bg)' : 'transparent',
                color: active ? 'var(--primary)' : 'var(--text-main)',
                fontWeight: active ? 600 : 500
              }}
            >
              <Icon size={19} /> {label}
            </Link>
          );
        })}
      </nav>

      <div style={{ paddingBottom: '20px' }}>
        <button onClick={toggleTheme} className="theme-toggle-btn">
          {theme === 'dark' ? (
            <>
              <Sun size={18} />
              Switch to Light Mode
            </>
          ) : (
            <>
              <Moon size={18} />
              Switch to Dark Mode
            </>
          )}
        </button>
        </button>
      </div>
    </aside>
  );
}
