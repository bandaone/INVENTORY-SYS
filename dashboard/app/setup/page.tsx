'use client';

import { useEffect, useMemo, useState } from 'react';
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
  Sparkles,
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
      <main className="min-h-screen flex items-center justify-center bg-[#0a0a0b]">
        <div className="flex flex-col items-center gap-4 text-emerald-400">
          <Loader2 size={32} className="animate-spin" />
          <div className="font-semibold text-white/70">Preparing your workspace...</div>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-[#0a0a0b] text-white selection:bg-emerald-500/30 flex">
      {/* Left Sidebar - Progress & Brand */}
      <aside className="hidden lg:flex flex-col w-[380px] border-r border-white/5 bg-[#0f1115] p-10 relative overflow-hidden">
        {/* Decorative background blob */}
        <div className="absolute top-0 left-0 w-full h-96 bg-emerald-500/5 blur-[120px] rounded-full pointer-events-none" />
        
        <div className="relative z-10 flex flex-col h-full">
          <div className="flex items-center gap-3 text-emerald-400 font-bold text-xl mb-12">
            <Sparkles size={24} /> Retail OS
          </div>

          <div className="mb-10">
            <h2 className="text-2xl font-bold mb-2">Welcome aboard!</h2>
            <p className="text-white/50 text-sm leading-relaxed">
              Complete these steps to configure your store. Each section saves automatically so you can come back any time.
            </p>
          </div>

          <div className="bg-white/5 border border-white/10 rounded-2xl p-5 mb-8">
            <div className="flex justify-between items-center mb-3 text-sm font-semibold">
              <span className="text-white/70">Setup Progress</span>
              <span className="text-emerald-400">{progress}%</span>
            </div>
            <div className="h-2 bg-black/50 rounded-full overflow-hidden">
              <div 
                className="h-full bg-gradient-to-r from-emerald-500 to-teal-400 transition-all duration-700 ease-out"
                style={{ width: `${progress}%` }}
              />
            </div>
          </div>

          <nav className="flex flex-col gap-2 flex-1">
            {steps.map((step) => {
              const Icon = step.icon;
              const isActive = active === step.key;
              const isDone = Boolean(data?.session?.[step.field]);
              
              return (
                <button
                  key={step.key}
                  type="button"
                  onClick={() => setActive(step.key)}
                  className={`flex items-center gap-4 p-4 rounded-xl text-left transition-all duration-200 ${
                    isActive 
                      ? 'bg-emerald-500/10 border border-emerald-500/20 shadow-[0_0_15px_rgba(16,185,129,0.05)]' 
                      : 'hover:bg-white/5 border border-transparent'
                  }`}
                >
                  <div className={`flex items-center justify-center w-10 h-10 rounded-lg ${
                    isActive ? 'bg-emerald-500/20 text-emerald-400' : isDone ? 'bg-white/5 text-emerald-400' : 'bg-white/5 text-white/40'
                  }`}>
                    {isDone && !isActive ? <CheckCircle2 size={20} /> : <Icon size={20} />}
                  </div>
                  <div className="flex-1">
                    <div className={`font-bold text-sm ${isActive ? 'text-white' : 'text-white/70'}`}>{step.title}</div>
                    <div className="text-xs text-white/40 mt-0.5">{step.desc}</div>
                  </div>
                </button>
              );
            })}
          </nav>
        </div>
      </aside>

      {/* Right Content Area */}
      <section className="flex-1 flex flex-col h-screen overflow-y-auto">
        <div className="flex-1 max-w-3xl w-full mx-auto p-8 lg:p-16 flex flex-col justify-center">
          
          {/* Header Mobile Only */}
          <div className="lg:hidden mb-8">
            <div className="flex items-center gap-2 text-emerald-400 font-bold mb-4"><Sparkles size={20} /> Retail OS Setup</div>
            <div className="h-1.5 bg-white/5 rounded-full overflow-hidden w-full max-w-xs">
              <div className="h-full bg-emerald-500" style={{ width: `${progress}%` }} />
            </div>
          </div>

          <div className="bg-[#0f1115] border border-white/5 shadow-2xl rounded-3xl p-8 md:p-12 relative overflow-hidden">
            {/* Subtle glow effect top right */}
            <div className="absolute -top-24 -right-24 w-48 h-48 bg-emerald-500/10 blur-[60px] rounded-full pointer-events-none" />

            <div className="flex items-center gap-4 mb-8">
              <div className="w-14 h-14 bg-gradient-to-br from-emerald-400/20 to-teal-500/10 rounded-2xl flex items-center justify-center text-emerald-400 border border-emerald-400/20 shadow-inner">
                <ActiveIcon size={28} />
              </div>
              <div>
                <h2 className="text-3xl font-extrabold tracking-tight">{activeStep.title}</h2>
                <p className="text-white/50 text-sm mt-1">{activeStep.desc}</p>
              </div>
            </div>

            {error && (
              <div className="mb-6 p-4 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-sm flex items-start gap-3">
                <ShieldCheck size={18} className="mt-0.5 shrink-0" />
                {error}
              </div>
            )}
            
            {message && (
              <div className="mb-6 p-4 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-sm flex items-start gap-3">
                <CheckCircle2 size={18} className="mt-0.5 shrink-0" />
                {message}
              </div>
            )}

            <div className="relative z-10">
              {active === 'business' && (
                <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <InputField label="Store / Business Name" value={business.business_name} onChange={(e) => setBusiness({ ...business, business_name: e.target.value })} placeholder="Mwape General Trading" />
                    <InputField label="Owner Email" type="email" value={business.owner_email} onChange={(e) => setBusiness({ ...business, owner_email: e.target.value })} placeholder="mwape@trading.co.zm" />
                  </div>
                  <InputField label="Owner Phone Number" value={business.owner_phone} onChange={(e) => setBusiness({ ...business, owner_phone: e.target.value })} placeholder="0977 123 456" />
                  <InputField label="Receipt Footer Message" value={business.business_name ? `Thank you for shopping at ${business.business_name}!` : business.receipt_footer} onChange={(e) => setBusiness({ ...business, receipt_footer: e.target.value })} />
                  
                  <div className="pt-4">
                    <ActionButton saving={saving} onClick={() => save('business', business)} />
                  </div>
                </div>
              )}

              {active === 'location' && (
                <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
                  <div className="p-4 rounded-xl bg-blue-500/10 border border-blue-500/20 text-blue-400 text-sm mb-4">
                    <strong>Pro tip:</strong> Start with your main headquarters. You can easily add more branch locations later from your dashboard.
                  </div>
                  <InputField label="Location Name" value={location.name} onChange={(e) => setLocation({ ...location, name: e.target.value })} placeholder="Main Branch — Manda Hill" />
                  <InputField label="Physical Address" value={location.address} onChange={(e) => setLocation({ ...location, address: e.target.value })} placeholder="Shop 12, Manda Hill Mall, Lusaka" />
                  
                  <div className="pt-4">
                    <ActionButton saving={saving} onClick={() => save('location', location)} />
                  </div>
                </div>
              )}

              {active === 'team' && (
                <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <InputField label="Staff Full Name" value={team.name} onChange={(e) => setTeam({ ...team, name: e.target.value })} placeholder="Bwalya Mutale" />
                    <InputField label="Email (Optional)" type="email" value={team.email} onChange={(e) => setTeam({ ...team, email: e.target.value })} placeholder="bwalya@yourstore.co.zm" />
                    
                    <div className="space-y-2">
                      <label className="block text-sm font-semibold text-white/70">Role</label>
                      <select 
                        className="w-full bg-[#16181d] border border-white/10 rounded-xl px-4 py-3 text-white focus:border-emerald-500/50 focus:ring-2 focus:ring-emerald-500/20 outline-none transition-all appearance-none"
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
                      onChange={(e) => setTeam({ ...team, pin: e.target.value.replace(/\\D/g, '').slice(0, 4) })} 
                      placeholder="e.g. 1234" 
                      maxLength={4}
                    />
                  </div>
                  
                  <div className="pt-4 flex items-center justify-between">
                    <ActionButton saving={saving} label={team.name ? 'Save Team Member' : 'Skip & Continue'} onClick={() => save('team', team)} />
                    <span className="text-sm text-white/40">{data?.staff?.length || 0} active members</span>
                  </div>
                </div>
              )}

              {active === 'catalog' && (
                <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
                  <div className="p-4 rounded-xl bg-white/5 border border-white/10 text-white/60 text-sm mb-4">
                    Add your first product to see how the POS looks. You can bulk-import hundreds of products later using Excel.
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <InputField label="Product Name" value={catalog.product_name} onChange={(e) => setCatalog({ ...catalog, product_name: e.target.value })} placeholder="Chitenge Fabric — 6 Yards" />
                    <InputField label="Category" value={catalog.category} onChange={(e) => setCatalog({ ...catalog, category: e.target.value })} placeholder="Fabrics" />
                    <InputField label="Color (Optional)" value={catalog.color} onChange={(e) => setCatalog({ ...catalog, color: e.target.value })} placeholder="Green & Gold" />
                    <InputField label="Size (Optional)" value={catalog.size} onChange={(e) => setCatalog({ ...catalog, size: e.target.value })} placeholder="6 yds" />
                  </div>
                  <InputField label="Retail Price (ZMW)" type="number" value={catalog.retail_price} onChange={(e) => setCatalog({ ...catalog, retail_price: e.target.value })} placeholder="250" />
                  
                  <div className="pt-4 flex items-center justify-between">
                    <ActionButton saving={saving} label={catalog.product_name ? 'Save Product' : 'Skip & Continue'} onClick={() => save('catalog', catalog)} />
                    <span className="text-sm text-white/40">{data?.counts.products || 0} products loaded</span>
                  </div>
                </div>
              )}

              {active === 'payments' && (
                <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
                  <ProviderToggle 
                    title="MTN Mobile Money" 
                    desc="Accept payments directly to your Merchant Wallet"
                    logo="M"
                    color="bg-yellow-500"
                    checked={payments.mtn_momo_enabled} 
                    value={payments.mtn_momo_number} 
                    onCheck={(c) => setPayments({ ...payments, mtn_momo_enabled: c })} 
                    onValue={(v) => setPayments({ ...payments, mtn_momo_number: v })} 
                  />
                  <ProviderToggle 
                    title="Airtel Money" 
                    desc="Accept Airtel merchant payments"
                    logo="A"
                    color="bg-red-500"
                    checked={payments.airtel_enabled} 
                    value={payments.airtel_number} 
                    onCheck={(c) => setPayments({ ...payments, airtel_enabled: c })} 
                    onValue={(v) => setPayments({ ...payments, airtel_number: v })} 
                  />
                  
                  <div className="pt-4">
                    <ActionButton saving={saving} onClick={() => save('payments', payments)} />
                  </div>
                </div>
              )}

              {active === 'tax' && (
                <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
                  <div className="p-5 rounded-2xl bg-[#16181d] border border-white/5 flex gap-5">
                    <div className="w-12 h-12 bg-white/5 rounded-full flex items-center justify-center shrink-0">
                      <ShieldCheck className="text-emerald-400" size={24} />
                    </div>
                    <div>
                      <h3 className="font-bold text-white mb-1">Zambia Revenue Authority</h3>
                      <p className="text-sm text-white/50 mb-4">Retail OS is fully compatible with ZRA Smart Invoice. Enter your TPIN to begin the automated compliance integration.</p>
                      
                      <label className="flex items-center gap-3 cursor-pointer text-sm font-semibold mb-5">
                        <input 
                          type="checkbox" 
                          className="w-5 h-5 rounded border-white/20 bg-white/5 text-emerald-500 focus:ring-emerald-500/30 focus:ring-offset-0"
                          checked={tax.zra_enabled} 
                          onChange={(e) => setTax({ ...tax, zra_enabled: e.target.checked })} 
                        /> 
                        Enable ZRA Smart Invoice Integration
                      </label>

                      {tax.zra_enabled && (
                        <div className="animate-in fade-in slide-in-from-top-2 duration-300">
                          <InputField label="Company TPIN" value={tax.zra_tpin} onChange={(e) => setTax({ ...tax, zra_tpin: e.target.value })} placeholder="1001234567" />
                        </div>
                      )}
                    </div>
                  </div>
                  
                  <div className="pt-4">
                    <ActionButton saving={saving} onClick={() => save('tax', tax)} />
                  </div>
                </div>
              )}

              {active === 'launch' && (
                <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500 text-center py-8">
                  <div className="w-24 h-24 bg-gradient-to-br from-emerald-400 to-teal-500 rounded-full mx-auto flex items-center justify-center shadow-[0_0_40px_rgba(16,185,129,0.3)] border-4 border-[#0f1115]">
                    <Sparkles size={40} className="text-[#0f1115]" />
                  </div>
                  
                  <div>
                    <h2 className="text-3xl font-extrabold mb-3">You are ready to launch!</h2>
                    <p className="text-white/60 max-w-md mx-auto">Your Retail OS environment has been configured. You can now access the POS, run your operations, and monitor analytics.</p>
                  </div>

                  <div className="grid grid-cols-2 md:grid-cols-3 gap-3 max-w-lg mx-auto text-left">
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
                    className="mt-8 inline-flex items-center gap-3 bg-white text-black hover:bg-gray-100 px-8 py-4 rounded-xl font-bold text-lg transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed hover:scale-105 active:scale-95 shadow-xl"
                  >
                    {saving ? 'Finalizing Setup...' : 'Enter Owner Dashboard'} <ArrowRight size={20} />
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}

// Reusable Components

function InputField({ label, value, onChange, placeholder, type = "text", maxLength }: {
  label: string;
  value: string | number;
  onChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  placeholder?: string;
  type?: string;
  maxLength?: number;
}) {
  return (
    <div className="space-y-2 w-full">
      <label className="block text-sm font-semibold text-white/70">{label}</label>
      <input 
        type={type}
        className="w-full bg-[#16181d] border border-white/10 rounded-xl px-4 py-3 text-white placeholder-white/20 focus:border-emerald-500/50 focus:ring-2 focus:ring-emerald-500/20 outline-none transition-all"
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
      className="inline-flex items-center gap-2 bg-emerald-500 hover:bg-emerald-400 text-[#0f1115] px-6 py-3.5 rounded-xl font-bold transition-all duration-200 disabled:opacity-70 disabled:cursor-not-allowed active:scale-95 shadow-[0_4px_14px_0_rgba(16,185,129,0.39)] hover:shadow-[0_6px_20px_rgba(16,185,129,0.23)]"
    >
      {saving ? <Loader2 size={18} className="animate-spin" /> : <ArrowRight size={18} />} 
      {saving ? 'Saving...' : label}
    </button>
  );
}

function ProviderToggle({ title, desc, logo, color, checked, value, onCheck, onValue }: {
  title: string;
  desc: string;
  logo: string;
  color: string;
  checked: boolean;
  value: string;
  onCheck: (c: boolean) => void;
  onValue: (v: string) => void;
}) {
  return (
    <div className={`p-5 rounded-2xl border transition-all duration-300 ${checked ? 'bg-[#16181d] border-emerald-500/30' : 'bg-white/5 border-white/5'}`}>
      <div className="flex items-start gap-4 mb-4">
        <div className={`w-12 h-12 rounded-xl flex items-center justify-center font-black text-xl text-white ${color}`}>
          {logo}
        </div>
        <div className="flex-1">
          <label className="flex justify-between items-start cursor-pointer group">
            <div>
              <h3 className="font-bold text-white mb-1 group-hover:text-emerald-400 transition-colors">{title}</h3>
              <p className="text-sm text-white/50">{desc}</p>
            </div>
            <div className={`w-12 h-6 rounded-full transition-colors relative ${checked ? 'bg-emerald-500' : 'bg-white/20'}`}>
              <div className={`absolute top-1 w-4 h-4 rounded-full bg-white transition-all ${checked ? 'left-7' : 'left-1'}`} />
            </div>
            <input type="checkbox" className="hidden" checked={checked} onChange={(e) => onCheck(e.target.checked)} />
          </label>
        </div>
      </div>
      
      {checked && (
        <div className="animate-in fade-in slide-in-from-top-2 duration-300 pt-2 border-t border-white/5 mt-4">
          <InputField label="Merchant Wallet / Till Number" value={value} onChange={(e) => onValue(e.target.value)} placeholder="Enter business number" />
        </div>
      )}
    </div>
  );
}

function LaunchCheck({ label, done }: { label: string; done: boolean }) {
  return (
    <div className={`flex items-center gap-2.5 p-3 rounded-lg border transition-all ${done ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400' : 'bg-white/5 border-white/5 text-white/40'}`}>
      {done ? <CheckCircle2 size={16} /> : <div className="w-4 h-4 rounded-full border border-current opacity-30" />} 
      <span className="text-sm font-semibold">{label}</span>
    </div>
  );
}
