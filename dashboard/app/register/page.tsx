'use client';
import { useState } from 'react';
import { Hexagon, CheckCircle2 } from 'lucide-react';
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

  const inputStyle: React.CSSProperties = {
    width: '100%', padding: '14px 16px',
    border: '1px solid var(--panel-border)',
    background: 'var(--bg-color)', color: 'var(--text-main)',
    borderRadius: '8px', fontFamily: 'Outfit, sans-serif',
    fontSize: '15px', outline: 'none', boxSizing: 'border-box',
    transition: 'border-color 0.2s',
  };

  const labelStyle: React.CSSProperties = {
    display: 'block', marginBottom: '8px', 
    fontSize: '13px', fontWeight: 600, 
    color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em'
  };

  if (step === 2) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--bg-color)', fontFamily: 'Outfit, sans-serif', padding: '20px' }}>
        <div className="glass-panel" style={{ maxWidth: '480px', padding: '48px 40px', textAlign: 'center', width: '100%' }}>
          <CheckCircle2 size={56} color="var(--primary)" style={{ margin: '0 auto 24px' }} />
          <h2 style={{ fontSize: '28px', color: 'var(--text-main)', marginBottom: '12px' }}>Workspace Created!</h2>
          <p style={{ color: 'var(--text-muted)', marginBottom: '32px', lineHeight: 1.6, fontSize: '15px' }}>
            Your 5-day free trial is now active. Next, we will walk you through setting up your store profile, adding products, and configuring ZRA compliance.
          </p>
          <button 
            onClick={() => router.push('/setup')}
            style={{ display: 'inline-block', width: '100%', padding: '16px 32px', background: 'var(--primary)', color: '#0f1115', border: 'none', borderRadius: '8px', fontWeight: 700, fontSize: '16px', cursor: 'pointer', fontFamily: 'Outfit, sans-serif' }}
          >
            Continue to Store Setup
          </button>
        </div>
      </div>
    );
  }

  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexWrap: 'wrap', background: 'var(--bg-color)', color: 'var(--text-main)', fontFamily: 'Outfit, sans-serif' }}>
      
      {/* Left side info */}
      <div style={{ flex: '1 1 400px', padding: '80px 60px', background: 'var(--sidebar-bg)', display: 'flex', flexDirection: 'column', borderRight: '1px solid var(--panel-border)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '80px' }}>
          <Hexagon size={32} color="var(--primary)" />
          <span style={{ fontSize: '24px', fontWeight: 700 }}>Retail OS</span>
        </div>
        
        <h1 style={{ fontSize: '42px', fontWeight: 700, marginBottom: '24px', lineHeight: 1.15 }}>
          Run your shop smarter,<br />from anywhere.
        </h1>
        <p style={{ fontSize: '18px', color: 'var(--text-muted)', maxWidth: '420px', lineHeight: 1.6, marginBottom: '40px' }}>
          Retail OS gives you real-time stock control, cashier management, and daily sales reports — built for how business works in Zambia.
        </p>
        
        <div style={{ marginTop: 'auto', display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', color: 'var(--text-muted)' }}>
            <CheckCircle2 size={20} color="var(--primary)" />
            <span>No credit card required to start</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', color: 'var(--text-muted)' }}>
            <CheckCircle2 size={20} color="var(--primary)" />
            <span>Setup takes less than 2 minutes</span>
          </div>
        </div>
      </div>

      {/* Right side form */}
      <div style={{ flex: '1 1 500px', padding: '60px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div className="glass-panel" style={{ width: '100%', maxWidth: '520px', padding: '40px' }}>
          <h2 style={{ fontSize: '28px', marginBottom: '8px' }}>Create your store</h2>
          <p style={{ color: 'var(--text-muted)', marginBottom: '32px', fontSize: '15px' }}>
            Fill in a few details and your workspace will be ready in seconds.
          </p>
          
          <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
            
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '20px' }}>
              <div>
                <label style={labelStyle}>Business Name</label>
                <input required name="business_name" type="text" placeholder="Mwape General Trading" style={inputStyle} />
              </div>
              <div>
                <label style={labelStyle}>Owner Full Name</label>
                <input required name="owner_name" type="text" placeholder="Mwila Chanda" style={inputStyle} />
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '20px' }}>
              <div>
                <label style={labelStyle}>Phone Number</label>
                <input required name="phone" type="tel" placeholder="0977 123 456" style={inputStyle} />
              </div>
              <div>
                <label style={labelStyle}>Email Address</label>
                <input required name="email" type="email" placeholder="mwila@mwapetrading.co.zm" style={inputStyle} />
              </div>
            </div>

            <div>
              <label style={labelStyle}>Store Address</label>
              <input required name="address" type="text" placeholder="Plot 42, Cairo Road, Lusaka" style={inputStyle} />
            </div>

            <div>
              <label style={labelStyle}>Plan</label>
              <select required name="tier" style={{...inputStyle, cursor: 'pointer', appearance: 'none'}}>
                <option value="boutique_starter">Starter — 1 Location — ZMW 2,500/mo</option>
                <option value="growth">Growth — Up to 5 Locations — ZMW 3,500/mo</option>
                <option value="enterprise_fleet">Enterprise — Unlimited Locations — ZMW 9,500/mo</option>
              </select>
            </div>

            <button 
              disabled={loading} 
              type="submit" 
              style={{ 
                marginTop: '12px', width: '100%', padding: '16px', 
                background: 'var(--primary)', color: '#0f1115', 
                border: 'none', borderRadius: '8px', fontWeight: 700, 
                fontSize: '16px', cursor: loading ? 'not-allowed' : 'pointer',
                fontFamily: 'Outfit, sans-serif'
              }}
            >
              {loading ? 'Provisioning Workspace...' : 'Start Free Trial'}
            </button>
            
            <p style={{ textAlign: 'center', fontSize: '14px', color: 'var(--text-muted)', marginTop: '8px' }}>
              Already have an account? <a href="/login" style={{ color: 'var(--primary)', textDecoration: 'none' }}>Sign in</a>
            </p>
          </form>
        </div>
      </div>
    </div>
  );
}
