'use client';

import { useState } from 'react';
import { Store, Loader2, CheckCircle2, ChevronRight, Sparkles } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { DashboardIllustration } from '@/components/Illustrations';

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
    } catch (e) {
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
            
            <h2 className="text-3xl font-extrabold mb-4">Account Created!</h2>
            <p className="text-white/60 mb-8 leading-relaxed">
              Your 5-day free trial has been activated. Let's finish setting up your store profile, inventory, and payment methods.
            </p>
            
            <button 
              onClick={() => router.push('/setup')}
              className="w-full bg-emerald-500 hover:bg-emerald-400 text-black font-bold py-4 rounded-xl flex items-center justify-center gap-2 transition-transform active:scale-95"
            >
              Continue to Setup <ChevronRight size={20} />
            </button>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-[#0a0a0b] text-white selection:bg-emerald-500/30 flex">
      {/* Left Sidebar - Brand & Value Prop */}
      <aside className="hidden lg:flex flex-col w-2/5 border-r border-white/5 bg-[#0f1115] p-12 relative overflow-hidden justify-between">
        <div className="absolute top-0 left-0 w-full h-96 bg-emerald-500/5 blur-[120px] rounded-full pointer-events-none" />
        
        <div className="relative z-10">
          <div className="flex items-center gap-3 text-emerald-400 font-bold text-xl mb-16">
            <Sparkles size={24} /> Retail OS
          </div>

          <h1 className="text-5xl font-black mb-6 leading-[1.1] tracking-tight">
            The modern operating system for physical retail.
          </h1>
          <p className="text-xl text-white/50 leading-relaxed max-w-md">
            Start your 5-day trial with clean stock intake, cashier workflows, owner reporting, and guided tax readiness.
          </p>
          <DashboardIllustration />
        </div>

        <div className="relative z-10 space-y-6">
          <div className="flex items-center gap-4 text-white/70">
            <CheckCircle2 className="text-emerald-500" size={24} />
            <span>No credit card required for trial.</span>
          </div>
          <div className="flex items-center gap-4 text-white/70">
            <CheckCircle2 className="text-emerald-500" size={24} />
            <span>Setup takes less than 2 minutes.</span>
          </div>
        </div>
      </aside>

      {/* Right side - Form */}
      <section className="flex-1 flex flex-col justify-center items-center p-8 relative">
        <div className="w-full max-w-lg">
          
          <div className="mb-10 text-center lg:text-left">
            <div className="w-16 h-16 bg-gradient-to-br from-indigo-500/20 to-purple-500/10 rounded-2xl flex items-center justify-center text-indigo-400 border border-indigo-400/20 mb-6 mx-auto lg:mx-0">
              <Store size={32} />
            </div>
            <h2 className="text-3xl font-extrabold mb-2">Create your store</h2>
            <p className="text-white/50">Enter your core business details to get started.</p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-5">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
              <div className="space-y-2">
                <label className="block text-sm font-semibold text-white/70">Business Name</label>
                <input required name="business_name" type="text" placeholder="e.g. Lusaka Fashion" className="w-full bg-[#16181d] border border-white/10 rounded-xl px-4 py-3 text-white placeholder-white/20 focus:border-emerald-500/50 focus:ring-2 focus:ring-emerald-500/20 outline-none transition-all" />
              </div>
              <div className="space-y-2">
                <label className="block text-sm font-semibold text-white/70">Owner Full Name</label>
                <input required name="owner_name" type="text" placeholder="John Doe" className="w-full bg-[#16181d] border border-white/10 rounded-xl px-4 py-3 text-white placeholder-white/20 focus:border-emerald-500/50 focus:ring-2 focus:ring-emerald-500/20 outline-none transition-all" />
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
              <div className="space-y-2">
                <label className="block text-sm font-semibold text-white/70">Phone Number</label>
                <input required name="phone" type="tel" placeholder="+260 97 ..." className="w-full bg-[#16181d] border border-white/10 rounded-xl px-4 py-3 text-white placeholder-white/20 focus:border-emerald-500/50 focus:ring-2 focus:ring-emerald-500/20 outline-none transition-all" />
              </div>
              <div className="space-y-2">
                <label className="block text-sm font-semibold text-white/70">Email Address</label>
                <input required name="email" type="email" placeholder="owner@store.com" className="w-full bg-[#16181d] border border-white/10 rounded-xl px-4 py-3 text-white placeholder-white/20 focus:border-emerald-500/50 focus:ring-2 focus:ring-emerald-500/20 outline-none transition-all" />
              </div>
            </div>

            <div className="space-y-2">
              <label className="block text-sm font-semibold text-white/70">Physical Address</label>
              <input required name="address" type="text" placeholder="123 Main St, Lusaka" className="w-full bg-[#16181d] border border-white/10 rounded-xl px-4 py-3 text-white placeholder-white/20 focus:border-emerald-500/50 focus:ring-2 focus:ring-emerald-500/20 outline-none transition-all" />
            </div>

            <div className="space-y-2">
              <label className="block text-sm font-semibold text-white/70">Select Plan</label>
              <select required name="tier" className="w-full bg-[#16181d] border border-white/10 rounded-xl px-4 py-3 text-white focus:border-emerald-500/50 focus:ring-2 focus:ring-emerald-500/20 outline-none transition-all appearance-none cursor-pointer">
                <option value="boutique_starter">Boutique Starter (1 Location) - ZMW 2,500/mo</option>
                <option value="growth">Growth (Up to 5 Locations) - ZMW 3,500/mo</option>
                <option value="enterprise_fleet">Enterprise Fleet (Unlimited) - ZMW 9,500/mo</option>
              </select>
            </div>

            <button 
              type="submit" 
              disabled={loading}
              className="w-full mt-4 bg-emerald-500 hover:bg-emerald-400 text-black font-bold py-4 rounded-xl flex items-center justify-center gap-2 transition-transform active:scale-95 disabled:opacity-50"
            >
              {loading ? <Loader2 className="animate-spin w-5 h-5" /> : 'Start 5-Day Free Trial'}
            </button>
          </form>

        </div>
      </section>
    </main>
  );
}
