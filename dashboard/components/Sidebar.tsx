'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import {
  LayoutDashboard, Package, History, AlertTriangle,
  Users, Settings, Hexagon, Sun, Moon, Building2, ChevronDown, LogOut
} from 'lucide-react';
import { useTheme } from '@/components/ThemeProvider';

interface SidebarProps {
  tenantName?: string;
  staffName?: string;
  staffRole?: string;
}

const ALL_NAV = [
  { name: 'Overview',        path: '/',          icon: LayoutDashboard, roles: ['owner'] },
  { name: 'Inventory',       path: '/inventory',  icon: Package,         roles: ['owner'] },
  { name: 'Audit Trail',     path: '/audit',      icon: History,         roles: ['owner'] },
  { name: 'Sync Monitoring', path: '/conflicts',  icon: AlertTriangle,   roles: ['owner'] },
  { name: 'Staff',           path: '/staff',      icon: Users,           roles: ['owner'] },
  { name: 'Settings',        path: '/settings',   icon: Settings,        roles: ['owner'] },
];

const ROLE_BADGE: Record<string, { label: string; color: string }> = {
  owner:         { label: 'Owner',         color: '#4ade80' },
  store_manager: { label: 'Store Manager', color: '#60a5fa' },
  cashier:       { label: 'Cashier',       color: '#fbbf24' },
  stock_clerk:   { label: 'Stock Clerk',   color: '#a78bfa' },
};

export default function Sidebar({
  tenantName = 'Retail OS HQ',
  staffName = 'Owner',
  staffRole = 'owner',
}: SidebarProps) {
  const pathname = usePathname();
  const router   = useRouter();
  const { theme, toggleTheme } = useTheme();

  const navItems = ALL_NAV.filter(item => item.roles.includes(staffRole));
  const initials = staffName.split(' ').map(n => n[0]).join('').substring(0, 2).toUpperCase();
  const badge = ROLE_BADGE[staffRole] || { label: staffRole, color: 'var(--text-muted)' };

  const handleLogout = async () => {
    await fetch('/api/auth/logout', { method: 'POST' });
    router.push('/login');
  };

  return (
    <aside className="sidebar">
      <div className="sidebar-logo" style={{ marginBottom: '24px' }}>
        <Hexagon className="sidebar-logo-icon" size={26} />
        Retail OS
      </div>

      {/* Store badge */}
      <div className="tenant-selector" style={{ marginBottom: '16px' }}>
        <div className="tenant-icon"><Building2 size={15} /></div>
        <div className="tenant-info">
          <span className="tenant-name">{tenantName}</span>
          <span className="tenant-tier">Owner Workspace</span>
        </div>
        <ChevronDown size={14} className="tenant-chevron" />
      </div>

      {/* User profile */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '10px 12px', background: 'var(--hover-bg)', borderRadius: '10px', marginBottom: '24px' }}>
        <div style={{ width: '36px', height: '36px', borderRadius: '50%', background: badge.color + '22', border: `2px solid ${badge.color}`, color: badge.color, display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontSize: '13px', flexShrink: 0 }}>
          {initials}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 600, fontSize: '13px', color: 'var(--text-main)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{staffName}</div>
          <div style={{ fontSize: '11px', color: badge.color, fontWeight: 600, marginTop: '1px' }}>{badge.label}</div>
        </div>
      </div>

      {/* Navigation */}
      <nav style={{ flex: 1 }}>
        {navItems.map(item => {
          const active = pathname === item.path;
          const Icon = item.icon;
          return (
            <Link key={item.name} href={item.path} className={`nav-item ${active ? 'active' : ''}`}>
              <Icon size={18} strokeWidth={active ? 2.5 : 2} />
              {item.name}
            </Link>
          );
        })}
      </nav>

      {/* Bottom controls */}
      <div style={{ paddingBottom: '16px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
        <button onClick={toggleTheme} className="theme-toggle-btn">
          {theme === 'dark' ? <><Sun size={16} /> Light Mode</> : <><Moon size={16} /> Dark Mode</>}
        </button>
        <button onClick={handleLogout} style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '10px 14px', background: 'transparent', border: '1px solid var(--panel-border)', color: 'var(--danger)', borderRadius: '8px', cursor: 'pointer', fontSize: '13px', fontWeight: 500, width: '100%', fontFamily: 'inherit', transition: 'background 0.15s' }}
          onMouseEnter={e => (e.currentTarget.style.background = 'rgba(239,68,68,0.08)')}
          onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}>
          <LogOut size={15} /> End Session
        </button>
      </div>
    </aside>
  );
}
