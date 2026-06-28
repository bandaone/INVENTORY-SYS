'use client';

import { useState } from 'react';
import { Store, Loader2, CheckCircle2, ChevronRight, Sparkles, ShieldCheck, Clock, BarChart3 } from 'lucide-react';
import { useRouter } from 'next/navigation';

export default function PublicRegistration() {
  const [step, setStep] = useState(1);
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setLoading(true);
    
    const formData = new FormData(e.currentTarget);
    const data = Object.fromEntries(formData);

    try {
      const res = await fetch('/api/register/tenant', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
      });
      
      if (res.ok) {
        setStep(2);
      } else {
        alert('Registration failed. Please try again.');
      }
    } catch {
      alert('Network error');
    }
    setLoading(false);
  };

  if (step === 2) {
    return (
      <main className="min-h-screen bg-[#0a0a0b] text-white flex items-center justify-center p-6">
        <div className="max-w-md w-full bg-[#16181d] border border-white/10 p-10 rounded-3xl text-center relative overflow-hidden">
          <div className="absolute top-0 left-0 w-full h-32 bg-emerald-500/10 blur-[50px] pointer-events-none" />
          
          <div className="relative z-10">
            <div className="w-20 h-20 bg-emerald-500/20 text-emerald-400 rounded-full flex items-center justify-center mx-auto mb-6">
              <CheckCircle2 size={40} />
            </div>
            
            <h2 className="text-3xl font-extrabold mb-3">Workspace Created!</h2>
            <p className="text-white/60 mb-2 leading-relaxed">
              Your 5-day free trial is now active.
            </p>
            <p className="text-white/40 text-sm mb-8">
              Next, we will walk you through setting up your store profile, adding your first products, and configuring your payment methods.
            </p>
            
            <button 
              onClick={() => router.push('/setup')}
              className="w-full bg-emerald-500 hover:bg-emerald-400 text-black font-bold py-4 rounded-xl flex items-center justify-center gap-2 transition-all active:scale-[0.98]"
            >
              Continue to Store Setup <ChevronRight size={20} />
            </button>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-[#0a0a0b] text-white flex flex-col lg:flex-row">
      {/* Left Panel - Brand & Value */}
      <div className="lg:w-[45%] bg-[#0f1115] border-b lg:border-b-0 lg:border-r border-white/5 p-8 lg:p-12 flex flex-col justify-between relative overflow-hidden">
        <div className="absolute top-0 left-0 w-72 h-72 bg-emerald-500/5 blur-[100px] rounded-full pointer-events-none" />
        
        <div className="relative z-10">
          <div className="flex items-center gap-3 text-emerald-400 font-bold text-lg mb-10 lg:mb-16">
            <Sparkles size={22} /> Retail OS
          </div>

          <h1 className="text-3xl lg:text-4xl font-black mb-4 leading-tight tracking-tight">
            Run your shop smarter, from anywhere.
          </h1>
          <p className="text-base lg:text-lg text-white/50 leading-relaxed mb-8 lg:mb-12">
            Retail OS gives you real-time stock control, cashier management, and daily sales reports — built for how business works in Zambia.
          </p>

          {/* Feature highlights instead of oversized SVG */}
          <div className="space-y-5 mb-8">
            <div className="flex items-start gap-4">
              <div className="w-10 h-10 rounded-xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center flex-shrink-0">
                <BarChart3 size={18} className="text-emerald-400" />
              </div>
              <div>
                <p className="font-semibold text-sm text-white/90">Live Sales Dashboard</p>
                <p className="text-xs text-white/40">Track daily revenue and top-selling products across all your branches.</p>
              </div>
            </div>
            <div className="flex items-start gap-4">
              <div className="w-10 h-10 rounded-xl bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center flex-shrink-0">
                <ShieldCheck size={18} className="text-indigo-400" />
              </div>
              <div>
                <p className="font-semibold text-sm text-white/90">ZRA-Ready Receipting</p>
                <p className="text-xs text-white/40">Generate tax-compliant receipts with your TPIN automatically included.</p>
              </div>
            </div>
            <div className="flex items-start gap-4">
              <div className="w-10 h-10 rounded-xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center flex-shrink-0">
                <Clock size={18} className="text-amber-400" />
              </div>
              <div>
                <p className="font-semibold text-sm text-white/90">Get Started in Minutes</p>
                <p className="text-xs text-white/40">No hardware needed. Sign up, add your products, and start selling today.</p>
              </div>
            </div>
          </div>
        </div>

        <div className="relative z-10 pt-4 border-t border-white/5">
          <p className="text-xs text-white/30">No card required to start your trial. Cancel any time.</p>
        </div>
      </div>

      {/* Right Panel - Form */}
      <div className="flex-1 flex flex-col justify-center items-center p-8 lg:p-12">
        <div className="w-full max-w-md">
          
          <div className="mb-8">
            <h2 className="text-2xl font-extrabold mb-2">Create your store</h2>
            <p className="text-white/50 text-sm">Fill in a few details and your workspace will be ready in seconds.</p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <label className="block text-xs font-semibold text-white/60 uppercase tracking-wide">Business Name</label>
                <input required name="business_name" type="text" placeholder="Mwape General Trading" className="w-full bg-[#16181d] border border-white/10 rounded-xl px-4 py-3 text-sm text-white placeholder-white/25 focus:border-emerald-500/50 focus:ring-2 focus:ring-emerald-500/20 outline-none transition-all" />
              </div>
              <div className="space-y-1.5">
                <label className="block text-xs font-semibold text-white/60 uppercase tracking-wide">Owner Full Name</label>
                <input required name="owner_name" type="text" placeholder="Mwila Chanda" className="w-full bg-[#16181d] border border-white/10 rounded-xl px-4 py-3 text-sm text-white placeholder-white/25 focus:border-emerald-500/50 focus:ring-2 focus:ring-emerald-500/20 outline-none transition-all" />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <label className="block text-xs font-semibold text-white/60 uppercase tracking-wide">Phone Number</label>
                <input required name="phone" type="tel" placeholder="0977 123 456" className="w-full bg-[#16181d] border border-white/10 rounded-xl px-4 py-3 text-sm text-white placeholder-white/25 focus:border-emerald-500/50 focus:ring-2 focus:ring-emerald-500/20 outline-none transition-all" />
              </div>
              <div className="space-y-1.5">
                <label className="block text-xs font-semibold text-white/60 uppercase tracking-wide">Email Address</label>
                <input required name="email" type="email" placeholder="mwila@mwapetrading.co.zm" className="w-full bg-[#16181d] border border-white/10 rounded-xl px-4 py-3 text-sm text-white placeholder-white/25 focus:border-emerald-500/50 focus:ring-2 focus:ring-emerald-500/20 outline-none transition-all" />
              </div>
            </div>

            <div className="space-y-1.5">
              <label className="block text-xs font-semibold text-white/60 uppercase tracking-wide">Store Address</label>
              <input required name="address" type="text" placeholder="Plot 42, Cairo Road, Lusaka" className="w-full bg-[#16181d] border border-white/10 rounded-xl px-4 py-3 text-sm text-white placeholder-white/25 focus:border-emerald-500/50 focus:ring-2 focus:ring-emerald-500/20 outline-none transition-all" />
            </div>

            <div className="space-y-1.5">
              <label className="block text-xs font-semibold text-white/60 uppercase tracking-wide">Plan</label>
              <select required name="tier" className="w-full bg-[#16181d] border border-white/10 rounded-xl px-4 py-3 text-sm text-white focus:border-emerald-500/50 focus:ring-2 focus:ring-emerald-500/20 outline-none transition-all appearance-none cursor-pointer">
                <option value="boutique_starter">Starter — 1 Location — ZMW 2,500/mo</option>
                <option value="growth">Growth — Up to 5 Locations — ZMW 3,500/mo</option>
                <option value="enterprise_fleet">Enterprise — Unlimited Locations — ZMW 9,500/mo</option>
              </select>
            </div>

            <button 
              type="submit" 
              disabled={loading}
              className="w-full mt-2 bg-emerald-500 hover:bg-emerald-400 text-black font-bold py-4 rounded-xl flex items-center justify-center gap-2 transition-all active:scale-[0.98] disabled:opacity-50"
            >
              {loading ? <Loader2 className="animate-spin w-5 h-5" /> : 'Start Free Trial'}
            </button>

            <p className="text-center text-xs text-white/30 mt-4">
              Already have an account? <a href="/login" className="text-emerald-400 hover:underline">Sign in</a>
            </p>
          </form>
        </div>
      </div>
    </main>
  );
}
