'use client';

import { useEffect, useMemo, useState } from 'react';
import type { CSSProperties } from 'react';
import {
  ArrowRight,
  BadgeCheck,
  Banknote,
  Boxes,
  Building2,
  CheckCircle2,
  ClipboardCheck,
  Loader2,
  ReceiptText,
  ShieldCheck,
  Store,
  Users,
} from 'lucide-react';

type OnboardingData = {
  session: Record<string, any> | null;
  tenant: Record<string, any> | null;
  settings: Record<string, any> | null;
  location: Record<string, any> | null;
  staff: Array<Record<string, any>>;
  counts: { products: number; stock: number };
};

const steps = [
  { key: 'business', title: 'Business', icon: Building2, field: 'business_profile_completed' },
  { key: 'location', title: 'Location', icon: Store, field: 'location_created' },
  { key: 'team', title: 'Team', icon: Users, field: 'staff_created' },
  { key: 'catalog', title: 'Catalog', icon: Boxes, field: 'products_loaded' },
  { key: 'payments', title: 'Payments', icon: Banknote, field: 'hardware_paired' },
  { key: 'tax', title: 'Tax', icon: ShieldCheck, field: 'first_stock_received' },
  { key: 'launch', title: 'Launch', icon: BadgeCheck, field: 'go_live_approved' },
];

const inputStyle: CSSProperties = {
  width: '100%',
  padding: '12px 14px',
  borderRadius: '8px',
  border: '1px solid var(--panel-border)',
  background: 'var(--hover-bg)',
  color: 'var(--text-main)',
  fontFamily: 'inherit',
  fontSize: '14px',
  outline: 'none',
};

const labelStyle: CSSProperties = {
  display: 'grid',
  gap: '8px',
  fontSize: '13px',
  color: 'var(--text-muted)',
  fontWeight: 600,
};

export default function SetupWizard() {
  const [data, setData] = useState<OnboardingData | null>(null);
  const [active, setActive] = useState('business');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  const [business, setBusiness] = useState({ business_name: '', owner_email: '', owner_phone: '', receipt_footer: '' });
  const [location, setLocation] = useState({ name: 'Main Store', address: '' });
  const [team, setTeam] = useState({ name: '', email: '', role: 'cashier', pin: '' });
  const [catalog, setCatalog] = useState({ product_name: '', category: 'Clothing', color: '', size: '', retail_price: '' });
  const [payments, setPayments] = useState({ mtn_momo_enabled: false, mtn_momo_number: '', airtel_enabled: false, airtel_number: '' });
  const [tax, setTax] = useState({ zra_enabled: false, zra_tpin: '' });

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/onboarding');
      const next = await res.json();
      if (!res.ok) throw new Error(next.error || 'Failed to load onboarding');
      setData(next);
      setBusiness({
        business_name: next.settings?.business_name || next.tenant?.name || '',
        owner_email: next.settings?.owner_email || '',
        owner_phone: next.settings?.owner_phone || '',
        receipt_footer: next.settings?.receipt_footer || 'Thank you for shopping with us.',
      });
      setLocation({
        name: next.location?.name || 'Main Store',
        address: next.location?.address || '',
      });
      setPayments({
        mtn_momo_enabled: Boolean(next.settings?.mtn_momo_enabled),
        mtn_momo_number: next.settings?.mtn_momo_number || '',
        airtel_enabled: Boolean(next.settings?.airtel_enabled),
        airtel_number: next.settings?.airtel_number || '',
      });
      setTax({
        zra_enabled: Boolean(next.settings?.zra_enabled),
        zra_tpin: next.settings?.zra_tpin || '',
      });
      const current = steps.find((step) => !next.session?.[step.field])?.key || 'launch';
      setActive(current);
    } catch (err: any) {
      setError(err.message || 'Unable to load onboarding.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const completedCount = useMemo(() => {
    if (!data?.session) return 0;
    return steps.filter((step) => Boolean(data.session?.[step.field])).length;
  }, [data]);

  const progress = Math.round((completedCount / steps.length) * 100);
  const activeIndex = Math.max(0, steps.findIndex((step) => step.key === active));
  const activeStep = steps[activeIndex] || steps[0];
  const ActiveIcon = activeStep.icon;

  const save = async (step: string, payload: Record<string, unknown>) => {
    setSaving(true);
    setError('');
    setMessage('');
    try {
      const res = await fetch('/api/onboarding', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ step, payload }),
      });
      const result = await res.json();
      if (!res.ok) throw new Error(result.error || 'Could not save this step');
      await load();
      const nextStep = steps[Math.min(activeIndex + 1, steps.length - 1)];
      setActive(nextStep.key);
      setMessage('Saved.');
    } catch (err: any) {
      setError(err.message || 'Unable to save this step.');
    } finally {
      setSaving(false);
    }
  };

  const finish = async () => {
    await save('launch', {});
    window.location.href = '/';
  };

  if (loading) {
    return (
      <main style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', background: 'var(--bg-color)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', color: 'var(--text-muted)' }}>
          <Loader2 size={18} className="spin" /> Loading setup
        </div>
      </main>
    );
  }

  return (
    <main style={{ minHeight: '100vh', background: 'var(--bg-color)', color: 'var(--text-main)', padding: '32px' }}>
      <div style={{ maxWidth: '1180px', margin: '0 auto', display: 'grid', gap: '24px' }}>
        <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '18px', flexWrap: 'wrap' }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', color: 'var(--primary)', fontWeight: 800, marginBottom: '10px' }}>
              <ClipboardCheck size={20} /> Retail OS Setup
            </div>
            <h1 style={{ fontSize: '30px', margin: 0 }}>Prepare {data?.tenant?.name || 'your store'}</h1>
            <p className="subtitle" style={{ marginTop: '8px', maxWidth: '640px' }}>
              Complete the essentials for a clean launch. Payment and tax connections can be finished as soon as the provider details are ready.
            </p>
          </div>
          <div className="glass-panel" style={{ padding: '16px 18px', minWidth: '220px', borderRadius: '8px' }}>
            <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginBottom: '8px' }}>Launch readiness</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
              <div style={{ flex: 1, height: '8px', background: 'var(--hover-bg)', borderRadius: '999px', overflow: 'hidden' }}>
                <div style={{ width: `${progress}%`, height: '100%', background: 'linear-gradient(90deg, var(--primary), var(--secondary))' }} />
              </div>
              <strong style={{ color: 'var(--text-main)' }}>{progress}%</strong>
            </div>
          </div>
        </header>

        <section style={{ display: 'grid', gridTemplateColumns: '280px minmax(0, 1fr)', gap: '22px', alignItems: 'start' }}>
          <aside style={{ display: 'grid', gap: '8px' }}>
            {steps.map((step) => {
              const Icon = step.icon;
              const isActive = active === step.key;
              const isDone = Boolean(data?.session?.[step.field]);
              return (
                <button
                  key={step.key}
                  type="button"
                  onClick={() => setActive(step.key)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '12px',
                    width: '100%',
                    padding: '13px 14px',
                    borderRadius: '8px',
                    border: `1px solid ${isActive ? 'rgba(74,222,128,0.35)' : 'var(--panel-border)'}`,
                    background: isActive ? 'rgba(74,222,128,0.10)' : 'var(--panel-bg)',
                    color: isActive ? 'var(--primary)' : 'var(--text-main)',
                    cursor: 'pointer',
                    fontFamily: 'inherit',
                    textAlign: 'left',
                  }}
                >
                  <Icon size={18} />
                  <span style={{ flex: 1, fontWeight: 700 }}>{step.title}</span>
                  {isDone && <CheckCircle2 size={17} color="var(--primary)" />}
                </button>
              );
            })}
          </aside>

          <section className="glass-panel" style={{ borderRadius: '8px', padding: '26px', minHeight: '560px' }}>
            {error && <div style={{ marginBottom: '16px', padding: '12px 14px', borderRadius: '8px', background: 'rgba(239,68,68,0.10)', color: 'var(--danger)', border: '1px solid rgba(239,68,68,0.22)' }}>{error}</div>}
            {message && <div style={{ marginBottom: '16px', padding: '12px 14px', borderRadius: '8px', background: 'rgba(74,222,128,0.10)', color: 'var(--primary)', border: '1px solid rgba(74,222,128,0.22)' }}>{message}</div>}

            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '22px' }}>
              <ActiveIcon size={22} color="var(--primary)" />
              <h2 style={{ margin: 0, fontSize: '22px' }}>{activeStep.title}</h2>
            </div>

            {active === 'business' && (
              <div style={{ display: 'grid', gap: '16px' }}>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '16px' }}>
                  <label style={labelStyle}>Business name<input style={inputStyle} value={business.business_name} onChange={(e) => setBusiness({ ...business, business_name: e.target.value })} /></label>
                  <label style={labelStyle}>Owner email<input style={inputStyle} type="email" value={business.owner_email} onChange={(e) => setBusiness({ ...business, owner_email: e.target.value })} /></label>
                  <label style={labelStyle}>Owner phone<input style={inputStyle} value={business.owner_phone} onChange={(e) => setBusiness({ ...business, owner_phone: e.target.value })} /></label>
                </div>
                <label style={labelStyle}>Receipt footer<input style={inputStyle} value={business.receipt_footer} onChange={(e) => setBusiness({ ...business, receipt_footer: e.target.value })} /></label>
                <ActionButton saving={saving} onClick={() => save('business', business)} />
              </div>
            )}

            {active === 'location' && (
              <div style={{ display: 'grid', gap: '16px' }}>
                <label style={labelStyle}>Store name<input style={inputStyle} value={location.name} onChange={(e) => setLocation({ ...location, name: e.target.value })} /></label>
                <label style={labelStyle}>Store address<input style={inputStyle} value={location.address} onChange={(e) => setLocation({ ...location, address: e.target.value })} /></label>
                <ActionButton saving={saving} onClick={() => save('location', location)} />
              </div>
            )}

            {active === 'team' && (
              <div style={{ display: 'grid', gap: '16px' }}>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))', gap: '16px' }}>
                  <label style={labelStyle}>Staff name<input style={inputStyle} value={team.name} onChange={(e) => setTeam({ ...team, name: e.target.value })} /></label>
                  <label style={labelStyle}>Email<input style={inputStyle} type="email" value={team.email} onChange={(e) => setTeam({ ...team, email: e.target.value })} /></label>
                  <label style={labelStyle}>Role<select style={inputStyle} value={team.role} onChange={(e) => setTeam({ ...team, role: e.target.value })}><option value="cashier">Cashier</option><option value="stock_clerk">Stock Clerk</option><option value="store_manager">Store Manager</option></select></label>
                  <label style={labelStyle}>PIN<input style={inputStyle} inputMode="numeric" maxLength={4} value={team.pin} onChange={(e) => setTeam({ ...team, pin: e.target.value.replace(/\D/g, '').slice(0, 4) })} /></label>
                </div>
                <div style={{ color: 'var(--text-muted)', fontSize: '13px' }}>{data?.staff?.length || 0} active team member(s) on this tenant.</div>
                <ActionButton saving={saving} label={team.name ? 'Save Team Member' : 'Continue'} onClick={() => save('team', team)} />
              </div>
            )}

            {active === 'catalog' && (
              <div style={{ display: 'grid', gap: '16px' }}>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '16px' }}>
                  <label style={labelStyle}>Product name<input style={inputStyle} value={catalog.product_name} onChange={(e) => setCatalog({ ...catalog, product_name: e.target.value })} /></label>
                  <label style={labelStyle}>Category<input style={inputStyle} value={catalog.category} onChange={(e) => setCatalog({ ...catalog, category: e.target.value })} /></label>
                  <label style={labelStyle}>Color<input style={inputStyle} value={catalog.color} onChange={(e) => setCatalog({ ...catalog, color: e.target.value })} /></label>
                  <label style={labelStyle}>Size<input style={inputStyle} value={catalog.size} onChange={(e) => setCatalog({ ...catalog, size: e.target.value })} /></label>
                  <label style={labelStyle}>Retail price<input style={inputStyle} type="number" min="0" value={catalog.retail_price} onChange={(e) => setCatalog({ ...catalog, retail_price: e.target.value })} /></label>
                </div>
                <div style={{ color: 'var(--text-muted)', fontSize: '13px' }}>{data?.counts.products || 0} product variants loaded.</div>
                <ActionButton saving={saving} label={catalog.product_name ? 'Save Product' : 'Continue'} onClick={() => save('catalog', catalog)} />
              </div>
            )}

            {active === 'payments' && (
              <div style={{ display: 'grid', gap: '16px' }}>
                <ProviderToggle title="MTN MoMo" checked={payments.mtn_momo_enabled} value={payments.mtn_momo_number} onCheck={(checked) => setPayments({ ...payments, mtn_momo_enabled: checked })} onValue={(value) => setPayments({ ...payments, mtn_momo_number: value })} />
                <ProviderToggle title="Airtel Money" checked={payments.airtel_enabled} value={payments.airtel_number} onCheck={(checked) => setPayments({ ...payments, airtel_enabled: checked })} onValue={(value) => setPayments({ ...payments, airtel_number: value })} />
                <ActionButton saving={saving} onClick={() => save('payments', payments)} />
              </div>
            )}

            {active === 'tax' && (
              <div style={{ display: 'grid', gap: '16px' }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: '10px', color: 'var(--text-main)', fontWeight: 700 }}>
                  <input type="checkbox" checked={tax.zra_enabled} onChange={(e) => setTax({ ...tax, zra_enabled: e.target.checked })} /> ZRA Smart Invoice setup started
                </label>
                <label style={labelStyle}>TPIN<input style={inputStyle} value={tax.zra_tpin} onChange={(e) => setTax({ ...tax, zra_tpin: e.target.value })} /></label>
                <ActionButton saving={saving} onClick={() => save('tax', tax)} />
              </div>
            )}

            {active === 'launch' && (
              <div style={{ display: 'grid', gap: '18px' }}>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '12px' }}>
                  <LaunchCheck label="Business profile" done={Boolean(data?.session?.business_profile_completed)} />
                  <LaunchCheck label="Location" done={Boolean(data?.session?.location_created)} />
                  <LaunchCheck label="Team" done={Boolean(data?.session?.staff_created)} />
                  <LaunchCheck label="Catalog" done={Boolean(data?.session?.products_loaded)} />
                  <LaunchCheck label="Payments" done={Boolean(data?.session?.hardware_paired)} />
                  <LaunchCheck label="Tax reviewed" done={Boolean(data?.session?.first_stock_received)} />
                </div>
                <button
                  onClick={finish}
                  disabled={saving}
                  style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: '8px', padding: '14px 18px', borderRadius: '8px', border: 'none', background: 'var(--primary)', color: '#0f1115', fontWeight: 800, cursor: saving ? 'not-allowed' : 'pointer' }}
                >
                  {saving ? 'Launching...' : 'Enter Owner Dashboard'} <ArrowRight size={18} />
                </button>
              </div>
            )}
          </section>
        </section>
      </div>
    </main>
  );
}

function ActionButton({ saving, onClick, label = 'Save & Continue' }: { saving: boolean; onClick: () => void; label?: string }) {
  return (
    <button
      onClick={onClick}
      disabled={saving}
      style={{ justifySelf: 'start', display: 'inline-flex', alignItems: 'center', gap: '8px', padding: '13px 16px', borderRadius: '8px', border: 'none', background: 'var(--primary)', color: '#0f1115', fontWeight: 800, cursor: saving ? 'not-allowed' : 'pointer' }}
    >
      {saving ? <Loader2 size={16} className="spin" /> : <ArrowRight size={16} />} {saving ? 'Saving...' : label}
    </button>
  );
}

function ProviderToggle({ title, checked, value, onCheck, onValue }: { title: string; checked: boolean; value: string; onCheck: (checked: boolean) => void; onValue: (value: string) => void }) {
  return (
    <div style={{ display: 'grid', gap: '12px', padding: '16px', border: '1px solid var(--panel-border)', borderRadius: '8px', background: 'var(--hover-bg)' }}>
      <label style={{ display: 'flex', alignItems: 'center', gap: '10px', fontWeight: 800, color: 'var(--text-main)' }}>
        <input type="checkbox" checked={checked} onChange={(e) => onCheck(e.target.checked)} /> {title}
      </label>
      <input style={inputStyle} value={value} onChange={(e) => onValue(e.target.value)} placeholder="Business wallet number" />
    </div>
  );
}

function LaunchCheck({ label, done }: { label: string; done: boolean }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '12px', borderRadius: '8px', border: '1px solid var(--panel-border)', background: done ? 'rgba(74,222,128,0.10)' : 'var(--hover-bg)', color: done ? 'var(--primary)' : 'var(--text-muted)', fontWeight: 700 }}>
      {done ? <CheckCircle2 size={17} /> : <ReceiptText size={17} />} {label}
    </div>
  );
}
