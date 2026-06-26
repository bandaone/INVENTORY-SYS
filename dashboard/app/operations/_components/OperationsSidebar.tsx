'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import {
  ArrowLeftRight,
  Building2,
  ChevronDown,
  Hexagon,
  LayoutDashboard,
  LogOut,
  PackagePlus,
  ScanLine,
  Moon,
  Sun,
} from 'lucide-react';
import { useTheme } from '@/components/ThemeProvider';

interface OperationsSidebarProps {
  tenantName?: string;
  staffName?: string;
  staffRole?: string;
}

const NAV = [
  { name: 'Overview', path: '/operations', icon: LayoutDashboard },
  { name: 'Receive Goods', path: '/operations/receive', icon: PackagePlus },
  { name: 'Stocktake', path: '/operations/stocktake', icon: ScanLine },
  { name: 'Transfers', path: '/operations/transfers', icon: ArrowLeftRight },
];

const ROLE_BADGE: Record<string, { label: string; color: string }> = {
  owner: { label: 'Owner', color: '#4ade80' },
  store_manager: { label: 'Store Manager', color: '#60a5fa' },
  stock_clerk: { label: 'Stock Clerk', color: '#a78bfa' },
};

export default function OperationsSidebar({
  tenantName = 'Retail OS',
  staffName = 'Operations',
  staffRole = 'stock_clerk',
}: OperationsSidebarProps) {
  const pathname = usePathname();
  const router = useRouter();
  const { theme, toggleTheme } = useTheme();
  const badge = ROLE_BADGE[staffRole] || { label: staffRole, color: 'var(--text-muted)' };
  const initials = staffName
    .split(' ')
    .map((part) => part[0])
    .join('')
    .substring(0, 2)
    .toUpperCase();

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

      <div className="tenant-selector" style={{ marginBottom: '16px' }}>
        <div className="tenant-icon"><Building2 size={15} /></div>
        <div className="tenant-info">
          <span className="tenant-name">{tenantName}</span>
          <span className="tenant-tier">Operations Workspace</span>
        </div>
        <ChevronDown size={14} className="tenant-chevron" />
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '10px 12px', background: 'var(--hover-bg)', borderRadius: '10px', marginBottom: '24px' }}>
        <div style={{ width: '36px', height: '36px', borderRadius: '50%', background: badge.color + '22', border: `2px solid ${badge.color}`, color: badge.color, display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontSize: '13px', flexShrink: 0 }}>
          {initials}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 600, fontSize: '13px', color: 'var(--text-main)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{staffName}</div>
          <div style={{ fontSize: '11px', color: badge.color, fontWeight: 600, marginTop: '1px' }}>{badge.label}</div>
        </div>
      </div>

      <nav style={{ flex: 1 }}>
        {NAV.map((item) => {
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

      <div style={{ paddingBottom: '16px' }}>
        <button onClick={toggleTheme} className="theme-toggle-btn" style={{ marginBottom: '8px' }}>
          {theme === 'dark' ? <><Sun size={16} /> Light Mode</> : <><Moon size={16} /> Dark Mode</>}
        </button>
        <button onClick={handleLogout} style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '10px 14px', background: 'transparent', border: '1px solid var(--panel-border)', color: 'var(--danger)', borderRadius: '8px', cursor: 'pointer', fontSize: '13px', fontWeight: 500, width: '100%', fontFamily: 'inherit', transition: 'background 0.15s' }}>
          <LogOut size={15} /> End Session
        </button>
      </div>
    </aside>
  );
}
