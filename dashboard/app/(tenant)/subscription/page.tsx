'use client';

import { useEffect, useState } from 'react';
import { CreditCard, CheckCircle2, ShieldCheck, Loader2, Store, CalendarDays, Lock } from 'lucide-react';

export default function SubscriptionPage() {
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<any>(null);
  const [paying, setPaying] = useState(false);
  const [success, setSuccess] = useState(false);

  useEffect(() => {
    loadBilling();
  }, []);

  const loadBilling = async () => {
    try {
      // Re-using the locations API we theoretically have, or we can fetch a specific billing endpoint.
      // Since we didn't build a specific GET endpoint for billing yet, I'll fetch settings which has billing_history and tenant info.
      const res = await fetch('/api/settings');
      const json = await res.json();
      
      // Let's also fetch locations to get the active count
      const locRes = await fetch('/api/locations');
      const locJson = await locRes.json();

      setData({
        tenant: json.tenant,
        history: json.billing_history || [],
        locations: locJson.locations?.filter((l: any) => l.is_active)?.length || 1,
      });
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const handleSandboxPayment = async (method: string) => {
    setPaying(true);
    try {
      const amount = data.locations * 2500;
      const res = await fetch('/api/subscription/sandbox-pay', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ amount, method })
      });
      if (!res.ok) throw new Error('Payment failed');
      
      setSuccess(true);
      await loadBilling();
      setTimeout(() => setSuccess(false), 5000);
    } catch (err) {
      alert('Sandbox payment failed.');
    } finally {
      setPaying(false);
    }
  };

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center text-emerald-500">
        <Loader2 className="animate-spin w-8 h-8" />
      </div>
    );
  }

  const isTrial = data?.tenant?.status === 'TRIAL';
  const isActive = data?.tenant?.status === 'ACTIVE';
  const amountDue = data?.locations * 2500;

  return (
    <div className="max-w-4xl mx-auto p-8">
      <div className="mb-8">
        <h1 className="text-3xl font-extrabold text-white mb-2">Billing & Subscription</h1>
        <p className="text-white/50">Manage your Retail OS plan and payment methods.</p>
      </div>

      {success && (
        <div className="mb-8 p-4 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 flex items-center gap-3 animate-in fade-in slide-in-from-top-4">
          <CheckCircle2 size={20} />
          <span className="font-bold">Payment Successful!</span> Your store is now fully active.
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        
        {/* Left Col: Current Plan */}
        <div className="lg:col-span-2 space-y-8">
          
          <div className="bg-[#16181d] border border-white/5 rounded-3xl p-8 relative overflow-hidden">
            {/* Status Badge */}
            <div className="absolute top-8 right-8">
              {isTrial ? (
                <div className="px-4 py-1.5 rounded-full bg-yellow-500/10 text-yellow-500 text-sm font-bold border border-yellow-500/20">
                  Free Trial
                </div>
              ) : isActive ? (
                <div className="px-4 py-1.5 rounded-full bg-emerald-500/10 text-emerald-400 text-sm font-bold border border-emerald-500/20 flex items-center gap-2">
                  <CheckCircle2 size={16} /> Active Plan
                </div>
              ) : (
                <div className="px-4 py-1.5 rounded-full bg-red-500/10 text-red-500 text-sm font-bold border border-red-500/20">
                  Suspended
                </div>
              )}
            </div>

            <div className="flex items-center gap-4 mb-6">
              <div className="w-14 h-14 bg-gradient-to-br from-indigo-500/20 to-purple-500/10 rounded-2xl flex items-center justify-center text-indigo-400 border border-indigo-400/20">
                <Store size={28} />
              </div>
              <div>
                <h2 className="text-2xl font-bold">Premium SaaS Plan</h2>
                <p className="text-white/50 text-sm">{data?.locations} Active Location{data?.locations > 1 ? 's' : ''}</p>
              </div>
            </div>

            <div className="flex items-end gap-2 mb-8">
              <span className="text-5xl font-black tracking-tight">ZMW {amountDue.toLocaleString()}</span>
              <span className="text-white/40 mb-2 font-semibold">/ month</span>
            </div>

            <div className="space-y-4 mb-8 text-sm text-white/70">
              <div className="flex items-center gap-3"><CheckCircle2 size={18} className="text-emerald-400" /> Unlimited Users & Cashiers</div>
              <div className="flex items-center gap-3"><CheckCircle2 size={18} className="text-emerald-400" /> Unlimited Products & Sales</div>
              <div className="flex items-center gap-3"><CheckCircle2 size={18} className="text-emerald-400" /> Advanced Stock Analytics</div>
              <div className="flex items-center gap-3"><CheckCircle2 size={18} className="text-emerald-400" /> ZRA Smart Invoice Integration</div>
            </div>

            {isTrial && (
              <div className="p-5 rounded-2xl bg-gradient-to-r from-emerald-500/10 to-teal-500/5 border border-emerald-500/20">
                <h3 className="font-bold text-white mb-2 flex items-center gap-2">
                  <Lock size={16} className="text-emerald-400" /> Activate your subscription
                </h3>
                <p className="text-sm text-white/60 mb-5">Your trial will expire soon. Secure your store's data by activating your plan today.</p>
                
                <div className="flex flex-wrap gap-3">
                  <button 
                    onClick={() => handleSandboxPayment('MTN MoMo')}
                    disabled={paying}
                    className="flex-1 bg-[#ffcc00] hover:bg-[#e6b800] text-black font-bold py-3 px-4 rounded-xl flex items-center justify-center gap-2 transition-transform active:scale-95 disabled:opacity-50"
                  >
                    {paying ? <Loader2 className="animate-spin w-5 h-5" /> : 'Pay via MTN MoMo'}
                  </button>
                  <button 
                    onClick={() => handleSandboxPayment('Airtel Money')}
                    disabled={paying}
                    className="flex-1 bg-[#ff0000] hover:bg-[#cc0000] text-white font-bold py-3 px-4 rounded-xl flex items-center justify-center gap-2 transition-transform active:scale-95 disabled:opacity-50"
                  >
                    {paying ? <Loader2 className="animate-spin w-5 h-5" /> : 'Pay via Airtel'}
                  </button>
                </div>
                <div className="mt-4 text-xs text-center text-white/40 uppercase tracking-widest font-bold">
                  (Test Sandbox Mode)
                </div>
              </div>
            )}
          </div>

        </div>

        {/* Right Col: Ledger & History */}
        <div className="bg-[#16181d] border border-white/5 rounded-3xl p-6 h-fit">
          <h3 className="text-lg font-bold mb-6 flex items-center gap-2">
            <CalendarDays size={20} className="text-white/50" /> Billing History
          </h3>
          
          <div className="space-y-4">
            {data?.history?.length === 0 ? (
              <div className="text-sm text-white/40 text-center py-8">No billing events yet.</div>
            ) : (
              data?.history?.map((evt: any) => (
                <div key={evt.id} className="p-4 rounded-xl bg-white/5 border border-white/5 flex flex-col gap-2">
                  <div className="flex justify-between items-center">
                    <span className="font-semibold text-sm">
                      {evt.event_type.replace('_', ' ')}
                    </span>
                    <span className={\`text-xs font-bold px-2 py-1 rounded \${
                      evt.status === 'POSTED' ? 'bg-emerald-500/20 text-emerald-400' : 'bg-yellow-500/20 text-yellow-500'
                    }\`}>
                      {evt.status}
                    </span>
                  </div>
                  <div className="text-xl font-bold">
                    ZMW {Number(evt.amount).toLocaleString()}
                  </div>
                  <div className="text-xs text-white/40">
                    {new Date(evt.due_at || evt.effective_at).toLocaleDateString()}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

      </div>
    </div>
  );
}
