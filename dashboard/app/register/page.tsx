'use client';
import { useState } from 'react';
import { Hexagon, CheckCircle2 } from 'lucide-react';

export default function PublicRegistration() {
  const [step, setStep] = useState(1);
  const [loading, setLoading] = useState(false);

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
        setStep(2); // Success screen
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
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--bg-color)' }}>
        <div className="glass-panel" style={{ maxWidth: '500px', padding: '40px', textAlign: 'center' }}>
          <CheckCircle2 size={64} color="var(--primary)" style={{ margin: '0 auto 24px' }} />
          <h2 style={{ fontSize: '28px', color: 'var(--text-main)', marginBottom: '16px' }}>Store Created</h2>
          <p style={{ color: 'var(--text-muted)', marginBottom: '32px', lineHeight: 1.6 }}>
            Your 7-day trial has started. Continue into setup to confirm the store profile,
            team, catalog, payments, and tax readiness before launch.
          </p>
          <a href="/setup" style={{ display: 'inline-block', padding: '16px 32px', background: 'var(--primary)', color: '#0f1115', textDecoration: 'none', borderRadius: '8px', fontWeight: 700 }}>
            Continue Setup
          </a>
        </div>
      </div>
    );
  }

  return (
    <div style={{ minHeight: '100vh', display: 'flex', background: 'var(--bg-color)', color: 'var(--text-main)' }}>
      {/* Left side info */}
      <div style={{ flex: 1, padding: '60px', background: 'var(--panel-bg)', color: 'var(--text-main)', display: 'flex', flexDirection: 'column', borderRight: '1px solid var(--panel-border)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '60px' }}>
          <Hexagon size={32} color="var(--primary)" />
          <span style={{ fontSize: '24px', fontWeight: 700 }}>Retail OS</span>
        </div>
        <h1 style={{ fontSize: '48px', fontWeight: 700, marginBottom: '24px', lineHeight: 1.1 }}>
          The operating system for physical retail.
        </h1>
        <p style={{ fontSize: '20px', color: 'var(--text-muted)', maxWidth: '400px', lineHeight: 1.5 }}>
          Start your 7-day trial with clean stock intake, cashier workflows, owner reporting, and guided tax readiness.
        </p>
        <div style={{ marginTop: 'auto', color: 'var(--text-muted)' }}>
          No credit card required for trial.
        </div>
      </div>

      {/* Right side form */}
      <div style={{ flex: 1, padding: '60px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ width: '100%', maxWidth: '480px' }}>
          <h2 style={{ fontSize: '32px', marginBottom: '8px' }}>Create your store</h2>
          <p style={{ color: 'var(--text-muted)', marginBottom: '40px' }}>Self-service onboarding takes less than 2 minutes.</p>
          
          <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
            
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px' }}>
              <div>
                <label style={{ display: 'block', marginBottom: '8px', fontSize: '14px', fontWeight: 500 }}>Business Name</label>
                <input required name="business_name" type="text" className="glass-panel" style={{ width: '100%', padding: '12px 16px', border: '1px solid var(--panel-border)', background: 'var(--panel-bg)', color: 'var(--text-main)', borderRadius: '8px' }} />
              </div>
              <div>
                <label style={{ display: 'block', marginBottom: '8px', fontSize: '14px', fontWeight: 500 }}>Owner Full Name</label>
                <input required name="owner_name" type="text" className="glass-panel" style={{ width: '100%', padding: '12px 16px', border: '1px solid var(--panel-border)', background: 'var(--panel-bg)', color: 'var(--text-main)', borderRadius: '8px' }} />
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px' }}>
              <div>
                <label style={{ display: 'block', marginBottom: '8px', fontSize: '14px', fontWeight: 500 }}>Phone Number</label>
                <input required name="phone" type="tel" className="glass-panel" style={{ width: '100%', padding: '12px 16px', border: '1px solid var(--panel-border)', background: 'var(--panel-bg)', color: 'var(--text-main)', borderRadius: '8px' }} />
              </div>
              <div>
                <label style={{ display: 'block', marginBottom: '8px', fontSize: '14px', fontWeight: 500 }}>Email Address</label>
                <input required name="email" type="email" className="glass-panel" style={{ width: '100%', padding: '12px 16px', border: '1px solid var(--panel-border)', background: 'var(--panel-bg)', color: 'var(--text-main)', borderRadius: '8px' }} />
              </div>
            </div>

            <div>
              <label style={{ display: 'block', marginBottom: '8px', fontSize: '14px', fontWeight: 500 }}>Physical Store Address</label>
              <input required name="address" type="text" className="glass-panel" style={{ width: '100%', padding: '12px 16px', border: '1px solid var(--panel-border)', background: 'var(--panel-bg)', color: 'var(--text-main)', borderRadius: '8px' }} />
            </div>

            <div>
              <label style={{ display: 'block', marginBottom: '8px', fontSize: '14px', fontWeight: 500 }}>Select Plan (Free 7-day Trial)</label>
              <select required name="tier" className="glass-panel" style={{ width: '100%', padding: '12px 16px', border: '1px solid var(--panel-border)', background: 'var(--panel-bg)', color: 'var(--text-main)', borderRadius: '8px' }}>
                <option value="boutique_starter">Boutique Starter (1 Location) - K1,200/mo</option>
                <option value="growth">Growth (Up to 5 Locations) - K3,500/mo</option>
                <option value="enterprise_fleet">Enterprise Fleet (Unlimited) - K9,500/mo</option>
              </select>
            </div>

            <button disabled={loading} type="submit" style={{ marginTop: '12px', width: '100%', padding: '16px', background: 'var(--primary)', color: 'white', border: 'none', borderRadius: '8px', fontWeight: 600, fontSize: '16px', cursor: loading ? 'not-allowed' : 'pointer' }}>
              {loading ? 'Provisioning Store...' : 'Start 7-Day Free Trial'}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
