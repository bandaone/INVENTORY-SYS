'use client';
import './login.css';
import { useState, useRef } from 'react';
import { Lock, Hexagon } from 'lucide-react';

export default function LoginPage() {
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState('');
  const [email, setEmail]     = useState('');
  const [pin, setPin]         = useState(['', '', '', '']);

  const pinRefs = [
    useRef<HTMLInputElement>(null),
    useRef<HTMLInputElement>(null),
    useRef<HTMLInputElement>(null),
    useRef<HTMLInputElement>(null),
  ];

  const pinValue = pin.join('');

  const handlePinChange = (index: number, val: string) => {
    const digit = val.replace(/\D/g, '').slice(-1);
    const next = [...pin];
    next[index] = digit;
    setPin(next);
    if (digit && index < 3) pinRefs[index + 1].current?.focus();
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
    if (e.key === 'ArrowLeft'  && index > 0) pinRefs[index - 1].current?.focus();
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
    <div className="login-root">
      <div className="login-card">

        {/* ── LEFT PANEL ── */}
        <div className="login-left">
          <div className="login-logo">
            <div className="login-logo-icon">
              <Hexagon size={22} color="#fff" strokeWidth={2} />
            </div>
            <span className="login-logo-text">Retail OS</span>
          </div>

          <p className="login-tagline">Smart inventory management for Zambian retail</p>

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

            {/* PIN — individual boxes */}
            <div>
              <label className="login-label">4-Digit Security PIN</label>
              <div className="pin-boxes" onPaste={handlePinPaste}>
                {[0, 1, 2, 3].map(i => (
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
  );
}
