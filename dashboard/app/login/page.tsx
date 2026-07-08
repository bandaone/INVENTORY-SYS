'use client';
import { useState, useRef } from 'react';
import { Lock, Hexagon } from 'lucide-react';

export default function LoginPage() {
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState('');
  const [email, setEmail]     = useState('');
  const [pin, setPin]         = useState(['', '', '', '']);
  const pinRefs               = [useRef<HTMLInputElement>(null), useRef<HTMLInputElement>(null), useRef<HTMLInputElement>(null), useRef<HTMLInputElement>(null)];

  const pinValue = pin.join('');

  const handlePinChange = (index: number, val: string) => {
    const digit = val.replace(/\D/g, '').slice(-1);
    const next = [...pin];
    next[index] = digit;
    setPin(next);
    if (digit && index < 3) {
      pinRefs[index + 1].current?.focus();
    }
  };

  const handlePinKey = (index: number, e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Backspace') {
      if (pin[index]) {
        const next = [...pin]; next[index] = ''; setPin(next);
      } else if (index > 0) {
        pinRefs[index - 1].current?.focus();
        const next = [...pin]; next[index - 1] = ''; setPin(next);
      }
    }
    if (e.key === 'ArrowLeft' && index > 0) pinRefs[index - 1].current?.focus();
    if (e.key === 'ArrowRight' && index < 3) pinRefs[index + 1].current?.focus();
  };

  const handlePinPaste = (e: React.ClipboardEvent) => {
    const pasted = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, 4);
    if (pasted.length === 4) {
      setPin(pasted.split(''));
      pinRefs[3].current?.focus();
    }
    e.preventDefault();
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim() || pinValue.length !== 4) {
      setError('Email and a 4-digit PIN are required.');
      return;
    }
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim(), pin: pinValue }),
      });
      const data = await res.json();
      if (res.ok) {
        window.location.href = data.redirect || '/';
      } else {
        setError(data.error || 'Invalid credentials');
        setPin(['', '', '', '']);
        pinRefs[0].current?.focus();
      }
    } catch {
      setError('Cannot reach server — please try again.');
    }
    setLoading(false);
  };

  const ready = pinValue.length === 4 && email.trim().length > 0;

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Outfit:wght@400;500;600;700&display=swap');
        *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
        html, body { height: 100%; }

        .login-root {
          min-height: 100vh;
          display: flex;
          align-items: center;
          justify-content: center;
          background: #dde4f0;
          font-family: 'Outfit', 'Inter', system-ui, sans-serif;
          padding: 24px;
        }

        .login-card {
          display: flex;
          width: 100%;
          max-width: 920px;
          min-height: 560px;
          border-radius: 22px;
          overflow: hidden;
          box-shadow: 0 32px 80px rgba(0,0,0,0.2), 0 4px 24px rgba(0,0,0,0.08);
        }

        /* ─── LEFT PANEL ─── */
        .login-left {
          flex: 1 1 52%;
          position: relative;
          display: flex;
          flex-direction: column;
          align-items: center;
          overflow: hidden;
          /* Blue gradient background */
          background: linear-gradient(160deg, #1d4ed8 0%, #2563eb 35%, #3b82f6 65%, #93c5fd 88%, #ffffff 100%);
        }

        /* Logo row — centered at top */
        .login-logo {
          position: relative;
          z-index: 3;
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 10px;
          padding-top: 36px;
          padding-bottom: 8px;
          width: 100%;
        }
        .login-logo-icon {
          width: 40px;
          height: 40px;
          background: rgba(255,255,255,0.22);
          border-radius: 10px;
          display: flex;
          align-items: center;
          justify-content: center;
          backdrop-filter: blur(10px);
          border: 1px solid rgba(255,255,255,0.3);
        }
        .login-logo-text {
          font-size: 20px;
          font-weight: 700;
          color: #fff;
          letter-spacing: -0.03em;
        }

        /* Tagline */
        .login-tagline {
          position: relative;
          z-index: 3;
          color: rgba(255,255,255,0.85);
          font-size: 13px;
          font-weight: 500;
          text-align: center;
          padding: 0 32px 16px;
        }

        /* The illustration — fills the bottom portion */
        .login-hero-wrap {
          position: relative;
          z-index: 3;
          width: 100%;
          flex: 1;
          display: flex;
          align-items: flex-end;
          justify-content: center;
          padding: 0 12px;
        }
        .login-hero-img {
          width: 100%;
          max-width: 420px;
          object-fit: contain;
          display: block;
          /* Fade bottom of image into the white-ish gradient */
          -webkit-mask-image: linear-gradient(to bottom, black 60%, transparent 100%);
          mask-image: linear-gradient(to bottom, black 60%, transparent 100%);
        }

        /* ─── RIGHT PANEL ─── */
        .login-right {
          flex: 0 0 380px;
          background: #ffffff;
          display: flex;
          flex-direction: column;
          justify-content: center;
          padding: 52px 44px;
        }
        .login-right h1 {
          font-size: 28px;
          font-weight: 700;
          color: #0f172a;
          letter-spacing: -0.03em;
          margin-bottom: 8px;
        }
        .login-subtitle {
          font-size: 14px;
          color: #64748b;
          line-height: 1.65;
          margin-bottom: 36px;
        }
        .login-label {
          display: block;
          margin-bottom: 8px;
          font-size: 11px;
          font-weight: 700;
          color: #475569;
          text-transform: uppercase;
          letter-spacing: 0.08em;
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
          box-shadow: 0 0 0 3px rgba(37,99,235,0.12);
          background: #fff;
        }

        /* HELSB-style PIN boxes */
        .pin-boxes {
          display: flex;
          gap: 10px;
        }
        .pin-box {
          flex: 1;
          height: 54px;
          border: 1.5px solid #e2e8f0;
          border-radius: 10px;
          background: #f8fafc;
          font-family: inherit;
          font-size: 24px;
          font-weight: 700;
          text-align: center;
          color: #0f172a;
          outline: none;
          transition: border-color 0.2s, box-shadow 0.2s;
          caret-color: transparent;
        }
        .pin-box:focus {
          border-color: #2563eb;
          box-shadow: 0 0 0 3px rgba(37,99,235,0.12);
          background: #fff;
        }
        .pin-box.filled {
          border-color: #1d4ed8;
          background: #eff6ff;
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
          background: linear-gradient(135deg, #1d4ed8, #2563eb);
          color: #fff;
          box-shadow: 0 4px 18px rgba(37,99,235,0.38);
        }
        .login-btn-ready:hover {
          box-shadow: 0 6px 22px rgba(37,99,235,0.5);
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
          font-size: 13px;
        }
        .login-links {
          margin-top: 28px;
          display: flex;
          flex-direction: column;
          gap: 10px;
          align-items: center;
        }
        .login-links p {
          font-size: 13px;
          color: #94a3b8;
        }
        .login-links a {
          text-decoration: none;
          font-weight: 600;
        }
        .link-primary { color: #2563eb; }
        .link-muted { color: #475569; }

        @media (max-width: 700px) {
          .login-left { display: none; }
          .login-right { flex: 1; padding: 40px 28px; }
          .login-card { max-width: 440px; border-radius: 18px; min-height: unset; }
        }
      `}</style>

      <div className="login-root">
        <div className="login-card">

          {/* ── LEFT PANEL ── */}
          <div className="login-left">

            {/* Logo — centered at top */}
            <div className="login-logo">
              <div className="login-logo-icon">
                <Hexagon size={22} color="#fff" strokeWidth={2} />
              </div>
              <span className="login-logo-text">Retail OS</span>
            </div>

            <p className="login-tagline">Smart inventory management for Zambian retail</p>

            {/* Hero illustration — fades into the white at the bottom */}
            <div className="login-hero-wrap">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src="/login-hero.png"
                alt="Two people discussing inventory management"
                className="login-hero-img"
              />
            </div>
          </div>

          {/* ── RIGHT PANEL ── */}
          <div className="login-right">
            <h1>Welcome back</h1>
            <p className="login-subtitle">
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

              {/* PIN — HELSB-style individual boxes */}
              <div>
                <label className="login-label">4-Digit Security PIN</label>
                <div className="pin-boxes" onPaste={handlePinPaste}>
                  {[0,1,2,3].map(i => (
                    <input
                      key={i}
                      ref={pinRefs[i]}
                      className={`pin-box${pin[i] ? ' filled' : ''}`}
                      type="password"
                      inputMode="numeric"
                      maxLength={1}
                      value={pin[i]}
                      onChange={e => handlePinChange(i, e.target.value)}
                      onKeyDown={e => handlePinKey(i, e)}
                      autoComplete="new-password"
                    />
                  ))}
                </div>
                <div style={{ fontSize: '12px', color: '#94a3b8', marginTop: '8px' }}>
                  {pinValue.length === 0 && 'Enter your 4-digit PIN'}
                  {pinValue.length > 0 && pinValue.length < 4 && `${4 - pinValue.length} more digit${4 - pinValue.length > 1 ? 's' : ''} remaining`}
                  {pinValue.length === 4 && <span style={{ color: '#16a34a', fontWeight: 600 }}>✓ PIN complete</span>}
                </div>
              </div>

              {/* Submit */}
              <button
                type="submit"
                disabled={loading || !ready}
                className={`login-btn ${ready && !loading ? 'login-btn-ready' : 'login-btn-disabled'}`}
                style={{ marginTop: '4px' }}
              >
                {loading ? 'Signing in…' : <><Lock size={16} /> Sign In</>}
              </button>
            </form>

            <div className="login-links">
              <p>
                Don&apos;t have an account?{' '}
                <a href="/register" className="link-primary">Register here</a>
              </p>
              <p>
                Need help?{' '}
                <a
                  href="mailto:01dennisbanda@gmail.com?subject=Retail%20OS%20Support%20Request"
                  className="link-muted"
                >
                  Contact support
                </a>
              </p>
            </div>
          </div>

        </div>
      </div>
    </>
  );
}
