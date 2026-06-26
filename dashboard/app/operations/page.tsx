import Link from 'next/link';
import { ArrowRight, PackagePlus, ScanLine, ArrowLeftRight, LayoutDashboard } from 'lucide-react';

const ACTIONS = [
  {
    title: 'Receive Goods',
    href: '/operations/receive',
    icon: PackagePlus,
    description: 'Register incoming stock, create serials, and print labels.',
  },
  {
    title: 'Stocktake',
    href: '/operations/stocktake',
    icon: ScanLine,
    description: 'Scan serials and close counts against live stock.',
  },
  {
    title: 'Transfers',
    href: '/operations/transfers',
    icon: ArrowLeftRight,
    description: 'Move stock between locations with a guided handoff.',
  },
];

export default function OperationsOverviewPage() {
  return (
    <div className="animate-fade-in">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '20px', marginBottom: '28px' }}>
        <div>
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: '8px', padding: '6px 10px', borderRadius: '999px', background: 'rgba(74,222,128,0.1)', color: 'var(--primary)', fontSize: '12px', fontWeight: 700, marginBottom: '14px' }}>
            <LayoutDashboard size={13} /> Operations Workspace
          </div>
          <h1>Overview</h1>
          <p className="subtitle">Operational work is grouped by function so each team can stay in its own lane.</p>
        </div>
      </div>

      <div className="metrics-grid" style={{ marginTop: 0 }}>
        {ACTIONS.map((action, index) => {
          const Icon = action.icon;
          return (
            <Link key={action.title} href={action.href} className="glass-panel" style={{ textDecoration: 'none', color: 'inherit', padding: '22px', minHeight: '170px' }}>
              <div style={{ width: '44px', height: '44px', borderRadius: '14px', background: index % 2 === 0 ? 'rgba(74,222,128,0.12)' : 'rgba(96,165,250,0.12)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: index % 2 === 0 ? 'var(--primary)' : 'var(--secondary)', marginBottom: '18px' }}>
                <Icon size={22} />
              </div>
              <h3 style={{ marginBottom: '8px' }}>{action.title}</h3>
              <p className="subtitle" style={{ fontSize: '13px', lineHeight: 1.6 }}>{action.description}</p>
            </Link>
          );
        })}
      </div>

    </div>
  );
}
