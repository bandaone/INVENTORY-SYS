'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  ArrowRight, BadgeCheck, Banknote, Boxes, Building2, CheckCircle2,
  Loader2, ShieldCheck, Store, Users, Sparkles
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
  { key: 'business', title: 'Business Profile', desc: 'Your store identity and contact details', icon: Building2, field: 'business_profile_completed' },
  { key: 'location', title: 'Store Location', desc: 'Where customers find you', icon: Store, field: 'location_created' },
  { key: 'team', title: 'Staff Access', desc: 'Set up POS login for your team', icon: Users, field: 'staff_created' },
  { key: 'catalog', title: 'First Product', desc: 'Add an item to your inventory', icon: Boxes, field: 'products_loaded' },
  { key: 'payments', title: 'Mobile Money', desc: 'MTN and Airtel merchant wallets', icon: Banknote, field: 'hardware_paired' },
  { key: 'tax', title: 'ZRA Compliance', desc: 'TPIN and Smart Invoice setup', icon: ShieldCheck, field: 'first_stock_received' },
  { key: 'launch', title: 'Go Live', desc: 'Open your store for business', icon: BadgeCheck, field: 'go_live_approved' },
];

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
        receipt_footer: next.settings?.receipt_footer || 'Thank you for shopping with us!',
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

  useEffect(() => { load(); }, []);

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
      setMessage('Progress saved successfully.');
      setTimeout(() => setMessage(''), 3000);
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
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--bg-color)', color: 'var(--primary)', fontFamily: 'Outfit, sans-serif' }}>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '16px' }}>
          <Loader2 size={36} className="spin" />
          <div style={{ fontWeight: 600, color: 'var(--text-muted)' }}>Preparing your workspace...</div>
        </div>
      </div>
    );
  }

  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexWrap: 'wrap', background: 'var(--bg-color)', color: 'var(--text-main)', fontFamily: 'Outfit, sans-serif' }}>
      
      {/* Left Sidebar */}
      <div style={{ flex: '1 1 380px', maxWidth: '400px', background: 'var(--sidebar-bg)', borderRight: '1px solid var(--panel-border)', padding: '48px 40px', display: 'flex', flexDirection: 'column' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '40px', color: 'var(--primary)' }}>
          <Sparkles size={24} /> 
          <span style={{ fontSize: '20px', fontWeight: 700 }}>Retail OS Setup</span>
        </div>

        <h2 style={{ fontSize: '24px', fontWeight: 700, marginBottom: '8px' }}>Welcome aboard!</h2>
        <p style={{ color: 'var(--text-muted)', fontSize: '14px', lineHeight: 1.5, marginBottom: '40px' }}>
          Complete these steps to configure your store. Each section saves automatically so you can come back any time.
        </p>

        {/* Progress Bar */}
        <div className="glass-panel" style={{ padding: '16px 20px', marginBottom: '32px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '12px', fontSize: '14px', fontWeight: 600 }}>
            <span style={{ color: 'var(--text-muted)' }}>Setup Progress</span>
            <span style={{ color: 'var(--primary)' }}>{progress}%</span>
          </div>
          <div style={{ height: '8px', background: 'var(--panel-border)', borderRadius: '4px', overflow: 'hidden' }}>
            <div style={{ height: '100%', width: `${progress}%`, background: 'var(--primary)', transition: 'width 0.4s ease' }} />
          </div>
        </div>

        {/* Navigation */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', flex: 1 }}>
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
                  display: 'flex', alignItems: 'center', gap: '16px', padding: '16px', borderRadius: '12px',
                  background: isActive ? 'var(--hover-bg)' : 'transparent',
                  border: isActive ? '1px solid var(--panel-border)' : '1px solid transparent',
                  cursor: 'pointer', textAlign: 'left', transition: 'all 0.2s', fontFamily: 'Outfit, sans-serif'
                }}
              >
                <div style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'center', width: '40px', height: '40px', borderRadius: '10px',
                  background: isActive ? 'var(--primary-glow)' : isDone ? 'var(--hover-bg)' : 'var(--hover-bg)',
                  color: isActive ? 'var(--primary)' : isDone ? 'var(--primary)' : 'var(--text-muted)'
                }}>
                  {isDone && !isActive ? <CheckCircle2 size={20} /> : <Icon size={20} />}
                </div>
                <div>
                  <div style={{ fontWeight: 700, fontSize: '14px', color: isActive ? 'var(--text-main)' : 'var(--text-muted)', marginBottom: '2px' }}>{step.title}</div>
                  <div style={{ fontSize: '12px', color: 'var(--text-muted)', opacity: 0.8 }}>{step.desc}</div>
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* Right Content */}
      <div style={{ flex: '1 1 500px', display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '60px 40px', overflowY: 'auto' }}>
        <div className="glass-panel" style={{ width: '100%', maxWidth: '640px', padding: '48px', position: 'relative' }}>
          
          <div style={{ display: 'flex', alignItems: 'center', gap: '20px', marginBottom: '40px' }}>
            <div style={{ width: '56px', height: '56px', background: 'var(--primary-glow)', borderRadius: '16px', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--primary)' }}>
              <ActiveIcon size={28} />
            </div>
            <div>
              <h2 style={{ fontSize: '28px', fontWeight: 700, marginBottom: '4px' }}>{activeStep.title}</h2>
              <p style={{ color: 'var(--text-muted)', fontSize: '14px' }}>{activeStep.desc}</p>
            </div>
          </div>

          {error && (
            <div style={{ padding: '16px', background: 'rgba(239,68,68,0.1)', border: '1px solid var(--danger)', color: 'var(--danger)', borderRadius: '12px', marginBottom: '24px', fontSize: '14px', display: 'flex', gap: '12px', alignItems: 'center' }}>
              <ShieldCheck size={20} /> {error}
            </div>
          )}
          
          {message && (
            <div style={{ padding: '16px', background: 'var(--primary-glow)', border: '1px solid var(--primary)', color: 'var(--primary)', borderRadius: '12px', marginBottom: '24px', fontSize: '14px', display: 'flex', gap: '12px', alignItems: 'center' }}>
              <CheckCircle2 size={20} /> {message}
            </div>
          )}

          {/* Form Content */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
            {active === 'business' && (
              <>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '24px' }}>
                  <InputField label="Store / Business Name" value={business.business_name} onChange={(e) => setBusiness({ ...business, business_name: e.target.value })} placeholder="Mwape General Trading" />
                  <InputField label="Owner Email" type="email" value={business.owner_email} onChange={(e) => setBusiness({ ...business, owner_email: e.target.value })} placeholder="mwape@trading.co.zm" />
                </div>
                <InputField label="Owner Phone Number" value={business.owner_phone} onChange={(e) => setBusiness({ ...business, owner_phone: e.target.value })} placeholder="0977 123 456" />
                <InputField label="Receipt Footer Message" value={business.business_name ? `Thank you for shopping at ${business.business_name}!` : business.receipt_footer} onChange={(e) => setBusiness({ ...business, receipt_footer: e.target.value })} />
                <div style={{ marginTop: '16px' }}>
                  <ActionButton saving={saving} onClick={() => save('business', business)} />
                </div>
              </>
            )}

            {active === 'location' && (
              <>
                <div style={{ padding: '16px', borderRadius: '12px', background: 'rgba(59,130,246,0.1)', border: '1px solid rgba(59,130,246,0.2)', color: '#60a5fa', fontSize: '14px', marginBottom: '8px' }}>
                  <strong>Pro tip:</strong> Start with your main headquarters. You can easily add more branch locations later from your dashboard.
                </div>
                <InputField label="Location Name" value={location.name} onChange={(e) => setLocation({ ...location, name: e.target.value })} placeholder="Main Branch — Manda Hill" />
                <InputField label="Physical Address" value={location.address} onChange={(e) => setLocation({ ...location, address: e.target.value })} placeholder="Shop 12, Manda Hill Mall, Lusaka" />
                <div style={{ marginTop: '16px' }}>
                  <ActionButton saving={saving} onClick={() => save('location', location)} />
                </div>
              </>
            )}

            {active === 'team' && (
              <>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '24px' }}>
                  <InputField label="Staff Full Name" value={team.name} onChange={(e) => setTeam({ ...team, name: e.target.value })} placeholder="Bwalya Mutale" />
                  <InputField label="Email (Optional)" type="email" value={team.email} onChange={(e) => setTeam({ ...team, email: e.target.value })} placeholder="bwalya@yourstore.co.zm" />
                  
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    <label style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase' }}>Role</label>
                    <select 
                      style={{ width: '100%', padding: '14px 16px', background: 'var(--bg-color)', border: '1px solid var(--panel-border)', color: 'var(--text-main)', borderRadius: '8px', fontSize: '15px', fontFamily: 'Outfit, sans-serif', appearance: 'none', cursor: 'pointer' }}
                      value={team.role} 
                      onChange={(e) => setTeam({ ...team, role: e.target.value })}
                    >
                      <option value="cashier">Cashier</option>
                      <option value="stock_clerk">Stock Clerk</option>
                      <option value="store_manager">Store Manager</option>
                    </select>
                  </div>

                  <InputField 
                    label="4-Digit POS Login PIN" 
                    value={team.pin} 
                    onChange={(e) => setTeam({ ...team, pin: e.target.value.replace(/\D/g, '').slice(0, 4) })} 
                    placeholder="e.g. 1234" 
                    maxLength={4}
                  />
                </div>
                
                <div style={{ marginTop: '16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <ActionButton saving={saving} label={team.name ? 'Save Team Member' : 'Skip & Continue'} onClick={() => save('team', team)} />
                  <span style={{ fontSize: '14px', color: 'var(--text-muted)' }}>{data?.staff?.length || 0} active members</span>
                </div>
              </>
            )}

            {active === 'catalog' && (
              <>
                <div style={{ padding: '16px', borderRadius: '12px', background: 'var(--hover-bg)', border: '1px solid var(--panel-border)', color: 'var(--text-muted)', fontSize: '14px', marginBottom: '8px' }}>
                  Add your first product to see how the POS looks. You can bulk-import hundreds of products later using Excel.
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '24px' }}>
                  <InputField label="Product Name" value={catalog.product_name} onChange={(e) => setCatalog({ ...catalog, product_name: e.target.value })} placeholder="Chitenge Fabric — 6 Yards" />
                  <InputField label="Category" value={catalog.category} onChange={(e) => setCatalog({ ...catalog, category: e.target.value })} placeholder="Fabrics" />
                  <InputField label="Color (Optional)" value={catalog.color} onChange={(e) => setCatalog({ ...catalog, color: e.target.value })} placeholder="Green & Gold" />
                  <InputField label="Size (Optional)" value={catalog.size} onChange={(e) => setCatalog({ ...catalog, size: e.target.value })} placeholder="6 yds" />
                </div>
                <InputField label="Retail Price (ZMW)" type="number" value={catalog.retail_price} onChange={(e) => setCatalog({ ...catalog, retail_price: e.target.value })} placeholder="250" />
                
                <div style={{ marginTop: '16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <ActionButton saving={saving} label={catalog.product_name ? 'Save Product' : 'Skip & Continue'} onClick={() => save('catalog', catalog)} />
                  <span style={{ fontSize: '14px', color: 'var(--text-muted)' }}>{data?.counts.products || 0} products loaded</span>
                </div>
              </>
            )}

            {active === 'payments' && (
              <>
                <ProviderToggle 
                  title="MTN Mobile Money" 
                  desc="Accept payments directly to your Merchant Wallet"
                  logo="M"
                  color="#f59e0b"
                  checked={payments.mtn_momo_enabled} 
                  value={payments.mtn_momo_number} 
                  onCheck={(c) => setPayments({ ...payments, mtn_momo_enabled: c })} 
                  onValue={(v) => setPayments({ ...payments, mtn_momo_number: v })} 
                />
                <ProviderToggle 
                  title="Airtel Money" 
                  desc="Accept Airtel merchant payments"
                  logo="A"
                  color="#ef4444"
                  checked={payments.airtel_enabled} 
                  value={payments.airtel_number} 
                  onCheck={(c) => setPayments({ ...payments, airtel_enabled: c })} 
                  onValue={(v) => setPayments({ ...payments, airtel_number: v })} 
                />
                <div style={{ marginTop: '16px' }}>
                  <ActionButton saving={saving} onClick={() => save('payments', payments)} />
                </div>
              </>
            )}

            {active === 'tax' && (
              <>
                <div className="glass-panel" style={{ display: 'flex', gap: '20px', padding: '24px' }}>
                  <div style={{ width: '48px', height: '48px', background: 'var(--primary-glow)', borderRadius: '24px', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                    <ShieldCheck color="var(--primary)" size={24} />
                  </div>
                  <div>
                    <h3 style={{ fontWeight: 700, marginBottom: '8px' }}>Zambia Revenue Authority</h3>
                    <p style={{ fontSize: '14px', color: 'var(--text-muted)', marginBottom: '20px' }}>
                      Retail OS is fully compatible with ZRA Smart Invoice. Enter your TPIN to begin the automated compliance integration.
                    </p>
                    
                    <label style={{ display: 'flex', alignItems: 'center', gap: '12px', cursor: 'pointer', fontSize: '14px', fontWeight: 600, marginBottom: '20px' }}>
                      <input 
                        type="checkbox" 
                        style={{ width: '20px', height: '20px', cursor: 'pointer' }}
                        checked={tax.zra_enabled} 
                        onChange={(e) => setTax({ ...tax, zra_enabled: e.target.checked })} 
                      /> 
                      Enable ZRA Smart Invoice Integration
                    </label>

                    {tax.zra_enabled && (
                      <InputField label="Company TPIN" value={tax.zra_tpin} onChange={(e) => setTax({ ...tax, zra_tpin: e.target.value })} placeholder="1001234567" />
                    )}
                  </div>
                </div>
                <div style={{ marginTop: '16px' }}>
                  <ActionButton saving={saving} onClick={() => save('tax', tax)} />
                </div>
              </>
            )}

            {active === 'launch' && (
              <div style={{ textAlign: 'center', padding: '40px 0' }}>
                <div style={{ width: '80px', height: '80px', background: 'var(--primary)', borderRadius: '40px', margin: '0 auto 32px', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 0 40px var(--primary-glow)' }}>
                  <Sparkles size={40} color="#0f1115" />
                </div>
                
                <h2 style={{ fontSize: '32px', fontWeight: 700, marginBottom: '16px' }}>You are ready to launch!</h2>
                <p style={{ color: 'var(--text-muted)', maxWidth: '400px', margin: '0 auto 40px', lineHeight: 1.6 }}>
                  Your Retail OS environment has been configured. You can now access the POS, run your operations, and monitor analytics.
                </p>

                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '16px', maxWidth: '500px', margin: '0 auto 48px', textAlign: 'left' }}>
                  <LaunchCheck label="Business Profile" done={Boolean(data?.session?.business_profile_completed)} />
                  <LaunchCheck label="Location" done={Boolean(data?.session?.location_created)} />
                  <LaunchCheck label="Team Members" done={Boolean(data?.session?.staff_created)} />
                  <LaunchCheck label="Product Catalog" done={Boolean(data?.session?.products_loaded)} />
                  <LaunchCheck label="Payments" done={Boolean(data?.session?.hardware_paired)} />
                  <LaunchCheck label="ZRA Tax" done={Boolean(data?.session?.first_stock_received)} />
                </div>

                <button
                  onClick={finish}
                  disabled={saving}
                  style={{
                    display: 'inline-flex', alignItems: 'center', gap: '12px',
                    background: 'var(--text-main)', color: 'var(--bg-color)',
                    padding: '20px 40px', borderRadius: '12px', fontWeight: 700, fontSize: '18px',
                    border: 'none', cursor: saving ? 'not-allowed' : 'pointer', fontFamily: 'Outfit, sans-serif',
                    boxShadow: '0 10px 30px var(--shadow-color)'
                  }}
                >
                  {saving ? 'Finalizing Setup...' : 'Enter Owner Dashboard'} <ArrowRight size={20} />
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function InputField({ label, value, onChange, placeholder, type = "text", maxLength }: {
  label: string;
  value: string | number;
  onChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  placeholder?: string;
  type?: string;
  maxLength?: number;
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', width: '100%' }}>
      <label style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{label}</label>
      <input 
        type={type}
        style={{ width: '100%', padding: '14px 16px', background: 'var(--bg-color)', border: '1px solid var(--panel-border)', color: 'var(--text-main)', borderRadius: '8px', fontSize: '15px', fontFamily: 'Outfit, sans-serif', outline: 'none' }}
        value={value} 
        onChange={onChange} 
        placeholder={placeholder}
        maxLength={maxLength}
      />
    </div>
  );
}

function ActionButton({ saving, onClick, label = 'Save & Continue' }: { saving: boolean; onClick: () => void; label?: string }) {
  return (
    <button
      onClick={onClick}
      disabled={saving}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: '12px',
        background: 'var(--primary)', color: '#0f1115',
        padding: '16px 32px', borderRadius: '8px', fontWeight: 700, fontSize: '16px',
        border: 'none', cursor: saving ? 'not-allowed' : 'pointer', fontFamily: 'Outfit, sans-serif'
      }}
    >
      {saving ? <Loader2 size={18} className="spin" /> : <ArrowRight size={18} />} 
      {saving ? 'Saving...' : label}
    </button>
  );
}

function ProviderToggle({ title, desc, logo, color, checked, value, onCheck, onValue }: {
  title: string; desc: string; logo: string; color: string; checked: boolean; value: string;
  onCheck: (c: boolean) => void; onValue: (v: string) => void;
}) {
  return (
    <div style={{ padding: '24px', borderRadius: '16px', border: checked ? '1px solid var(--primary)' : '1px solid var(--panel-border)', background: checked ? 'var(--primary-glow)' : 'var(--hover-bg)', transition: 'all 0.3s' }}>
      <div style={{ display: 'flex', gap: '20px' }}>
        <div style={{ width: '56px', height: '56px', borderRadius: '16px', background: color, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '24px', fontWeight: 900, color: '#fff', flexShrink: 0 }}>
          {logo}
        </div>
        <div style={{ flex: 1 }}>
          <label style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', cursor: 'pointer', width: '100%' }}>
            <div>
              <h3 style={{ fontWeight: 700, fontSize: '18px', marginBottom: '6px' }}>{title}</h3>
              <p style={{ fontSize: '14px', color: 'var(--text-muted)' }}>{desc}</p>
            </div>
            <input type="checkbox" checked={checked} onChange={(e) => onCheck(e.target.checked)} style={{ width: '24px', height: '24px', cursor: 'pointer' }} />
          </label>
        </div>
      </div>
      
      {checked && (
        <div style={{ marginTop: '24px', paddingTop: '24px', borderTop: '1px solid var(--panel-border)' }}>
          <InputField label="Merchant Wallet / Till Number" value={value} onChange={(e) => onValue(e.target.value)} placeholder="Enter business number" />
        </div>
      )}
    </div>
  );
}

function LaunchCheck({ label, done }: { label: string; done: boolean }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '16px', borderRadius: '12px', background: done ? 'var(--primary-glow)' : 'var(--hover-bg)', border: done ? '1px solid var(--primary)' : '1px solid var(--panel-border)', color: done ? 'var(--primary)' : 'var(--text-muted)' }}>
      {done ? <CheckCircle2 size={18} /> : <div style={{ width: '18px', height: '18px', borderRadius: '9px', border: '1px solid currentColor', opacity: 0.3 }} />} 
      <span style={{ fontSize: '14px', fontWeight: 600 }}>{label}</span>
    </div>
  );
}
