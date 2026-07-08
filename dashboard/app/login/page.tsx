'use client';
import { useState } from 'react';
import { Lock, Eye, EyeOff, Hexagon } from 'lucide-react';
import Image from 'next/image';

export default function LoginPage() {
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState('');
  const [email, setEmail]     = useState('');
  const [pin, setPin]         = useState('');
  const [showPin, setShowPin] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim() || pin.length !== 4) {
      setError('Email and a 4-digit PIN are required.');
      return;
    }
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim(), pin }),
      });
      const data = await res.json();
      if (res.ok) {
        window.location.href = data.redirect || '/';
      } else {
        setError(data.error || 'Invalid credentials');
        setPin('');
      }
    } catch {
      setError('Cannot reach server — please try again.');
    }
    setLoading(false);
  };

  const ready = pin.length === 4 && email.trim().length > 0;

  return (
    <>
      <style>{`
        * { box-sizing: border-box; margin: 0; padding: 0; }
        html, body { height: 100%; }
        .login-root {
          min-height: 100vh;
          display: flex;
          align-items: center;
          justify-content: center;
          background: #e8edf5;
          font-family: 'Outfit', 'Inter', system-ui, sans-serif;
          padding: 24px;
        }
        .login-card {
          display: flex;
          width: 100%;
          max-width: 900px;
          min-height: 540px;
          border-radius: 20px;
          overflow: hidden;
          box-shadow: 0 24px 80px rgba(0,0,0,0.18), 0 4px 20px rgba(0,0,0,0.08);
        }
        /* LEFT — colourful panel */
        .login-left {
          flex: 1 1 50%;
          background: linear-gradient(145deg, #2563eb 0%, #3b82f6 40%, #60a5fa 75%, #93c5fd 100%);
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: flex-end;
          padding: 40px 32px 0;
          position: relative;
          overflow: hidden;
        }
        .login-left::before {
          content: '';
          position: absolute;
          bottom: -60px;
          left: -60px;
          width: 300px;
          height: 300px;
          border-radius: 50%;
          background: rgba(255,255,255,0.08);
        }
        .login-left::after {
          content: '';
          position: absolute;
          top: -40px;
          right: -40px;
          width: 200px;
          height: 200px;
          border-radius: 50%;
          background: rgba(255,255,255,0.06);
        }
        .login-left-brand {
          display: flex;
          align-items: center;
          gap: 10px;
          position: absolute;
          top: 32px;
          left: 32px;
          z-index: 2;
        }
        .login-left-brand-icon {
          width: 38px;
          height: 38px;
          background: rgba(255,255,255,0.2);
          border-radius: 10px;
          display: flex;
          align-items: center;
          justify-content: center;
          backdrop-filter: blur(8px);
        }
        .login-left-brand span {
          font-size: 18px;
          font-weight: 700;
          color: #fff;
          letter-spacing: -0.02em;
        }
        .login-left-tagline {
          position: absolute;
          bottom: 240px;
          left: 0; right: 0;
          text-align: center;
          color: rgba(255,255,255,0.9);
          font-size: 15px;
          font-weight: 500;
          padding: 0 24px;
          z-index: 2;
        }
        .login-hero-img {
          position: relative;
          z-index: 2;
          width: 100%;
          max-width: 400px;
          object-fit: contain;
        }
        /* RIGHT — form panel */
        .login-right {
          flex: 0 0 380px;
          background: #ffffff;
          display: flex;
          flex-direction: column;
          justify-content: center;
          padding: 52px 44px;
        }
        .login-right h1 {
          font-size: 26px;
          font-weight: 700;
          color: #0f172a;
          letter-spacing: -0.03em;
          margin-bottom: 8px;
        }
        .login-right p.subtitle {
          font-size: 14px;
          color: #64748b;
          line-height: 1.6;
          margin-bottom: 36px;
        }
        .login-label {
          display: block;
          margin-bottom: 7px;
          font-size: 11px;
          font-weight: 700;
          color: #475569;
          text-transform: uppercase;
          letter-spacing: 0.07em;
        }
        .login-input {
          width: 100%;
          padding: 12px 14px;
          border: 1.5px solid #e2e8f0;
          background: #f8fafc;
          color: #0f172a;
          border-radius: 10px;
          font-family: inherit;
          font-size: 15px;
          outline: none;
          transition: border-color 0.2s, box-shadow 0.2s;
        }
        .login-input:focus {
          border-color: #2563eb;
          box-shadow: 0 0 0 3px rgba(37,99,235,0.1);
          background: #fff;
        }
        .login-pin-input {
          font-size: 22px;
          font-weight: 700;
          letter-spacing: 0.35em;
          padding-right: 48px;
        }
        .login-dots {
          display: flex;
          gap: 6px;
          margin-top: 10px;
        }
        .login-dot {
          flex: 1;
          height: 3px;
          border-radius: 3px;
          transition: background 0.2s;
        }
        .login-btn {
          width: 100%;
          padding: 14px;
          border: none;
          border-radius: 10px;
          font-family: inherit;
          font-size: 15px;
          font-weight: 700;
          cursor: pointer;
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 8px;
          transition: all 0.2s;
          letter-spacing: -0.01em;
        }
        .login-btn-ready {
          background: linear-gradient(135deg, #2563eb, #3b82f6);
          color: #fff;
          box-shadow: 0 4px 16px rgba(37,99,235,0.35);
        }
        .login-btn-ready:hover {
          box-shadow: 0 6px 20px rgba(37,99,235,0.45);
          transform: translateY(-1px);
        }
        .login-btn-disabled {
          background: #f1f5f9;
          color: #94a3b8;
          cursor: not-allowed;
        }
        .login-error {
          padding: 12px 14px;
          background: #fef2f2;
          border: 1.5px solid #fecaca;
          color: #dc2626;
          border-radius: 10px;
          margin-bottom: 20px;
          font-size: 14px;
        }
        @media (max-width: 700px) {
          .login-left { display: none; }
          .login-right { flex: 1; padding: 40px 28px; }
          .login-card { max-width: 440px; border-radius: 16px; }
        }
      `}</style>

      <div className="login-root">
        <div className="login-card">

          {/* ── LEFT PANEL ── */}
          <div className="login-left">
            <div className="login-left-brand">
              <div className="login-left-brand-icon">
                <Hexagon size={22} color="#fff" />
              </div>
              <span>Retail OS</span>
            </div>

            <p className="login-left-tagline">
              Smart inventory management for Zambian retail
            </p>

            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/login-hero.png"
              alt="Retail OS illustration"
              className="login-hero-img"
            />
          </div>

          {/* ── RIGHT PANEL ── */}
          <div className="login-right">
            <h1>Welcome back</h1>
            <p className="subtitle">
              Sign in to your Retail OS account using your email address and 4-digit PIN.
            </p>

            {error && <div className="login-error">{error}</div>}

            <form onSubmit={handleSubmit} autoComplete="off" style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>

              {/* Email */}
              <div>
                <label className="login-label">Email Address</label>
                <input
                  className="login-input"
                  type="email"
                  autoComplete="username"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  placeholder="you@yourbusiness.co.zm"
                  required
                />
              </div>

              {/* PIN */}
              <div>
                <label className="login-label">4-Digit PIN</label>
                <div style={{ position: 'relative' }}>
                  <input
                    className={`login-input login-pin-input`}
                    style={{ letterSpacing: showPin ? '0.18em' : '0.4em' }}
                    type={showPin ? 'text' : 'password'}
                    autoComplete="new-password"
                    inputMode="numeric"
                    maxLength={4}
                    value={pin}
                    onChange={e => setPin(e.target.value.replace(/\D/g, '').slice(0, 4))}
                    placeholder={showPin ? '1234' : '••••'}
                    required
                  />
                  <button
                    type="button"
                    onClick={() => setShowPin(v => !v)}
                    tabIndex={-1}
                    style={{
                      position: 'absolute', right: '12px', top: '50%',
                      transform: 'translateY(-50%)',
                      background: 'none', border: 'none', cursor: 'pointer',
                      color: '#94a3b8', padding: '4px', display: 'flex',
                    }}
                    title={showPin ? 'Hide PIN' : 'Show PIN'}
                  >
                    {showPin ? <EyeOff size={18} /> : <Eye size={18} />}
                  </button>
                </div>
                <div className="login-dots">
                  {[0,1,2,3].map(i => (
                    <div key={i} className="login-dot" style={{
                      background: i < pin.length ? '#2563eb' : '#e2e8f0'
                    }} />
                  ))}
                </div>
                <div style={{ fontSize: '12px', color: '#94a3b8', marginTop: '5px' }}>
                  {pin.length === 0 && 'Enter your 4-digit PIN'}
                  {pin.length > 0 && pin.length < 4 && `${4 - pin.length} more digit${4 - pin.length > 1 ? 's' : ''}`}
                  {pin.length === 4 && <span style={{ color: '#16a34a', fontWeight: 600 }}>✓ PIN complete</span>}
                </div>
              </div>

              {/* Submit */}
              <button
                type="submit"
                disabled={loading || !ready}
                className={`login-btn ${ready && !loading ? 'login-btn-ready' : 'login-btn-disabled'}`}
                style={{ marginTop: '4px' }}
              >
                {loading ? (
                  <span style={{ opacity: 0.8 }}>Signing in…</span>
                ) : (
                  <><Lock size={16} /> Sign In</>
                )}
              </button>
            </form>

            <p style={{ marginTop: '28px', textAlign: 'center', fontSize: '13px', color: '#94a3b8' }}>
              Don&apos;t have an account?{' '}
              <a href="/register" style={{ color: '#2563eb', textDecoration: 'none', fontWeight: 600 }}>
                Register here
              </a>
            </p>

            <p style={{ marginTop: '12px', textAlign: 'center', fontSize: '13px', color: '#94a3b8' }}>
              Need help?{' '}
              <a href="mailto:support@lusakaretailos.com" style={{ color: '#64748b', textDecoration: 'none', fontWeight: 500 }}>
                Contact support
              </a>
            </p>
          </div>

        </div>
      </div>
    </>
  );
}
