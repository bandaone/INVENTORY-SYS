'use client';
import { useState, useRef } from 'react';
import { Lock, Hexagon } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { clearPosTerminalSession, storePosTerminalSession } from '@/lib/pos-constants';

export default function LoginPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState('');
  const [email, setEmail]     = useState('');
  const [pin, setPin]         = useState(['', '', '', '']);

  const p0 = useRef<HTMLInputElement>(null);
  const p1 = useRef<HTMLInputElement>(null);
  const p2 = useRef<HTMLInputElement>(null);
  const p3 = useRef<HTMLInputElement>(null);
  const pinRefs = [p0, p1, p2, p3];

  const pinValue = pin.join('');

  const handlePinChange = (i: number, val: string) => {
    const digit = val.replace(/\D/g, '').slice(-1);
    const next = [...pin]; next[i] = digit; setPin(next);
    if (digit && i < 3) pinRefs[i + 1].current?.focus();
  };

  const handlePinKey = (i: number, e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Backspace') {
      if (pin[i]) { const n = [...pin]; n[i] = ''; setPin(n); }
      else if (i > 0) { pinRefs[i - 1].current?.focus(); const n = [...pin]; n[i - 1] = ''; setPin(n); }
    }
    if (e.key === 'ArrowLeft'  && i > 0) pinRefs[i - 1].current?.focus();
    if (e.key === 'ArrowRight' && i < 3) pinRefs[i + 1].current?.focus();
  };

  const handlePinPaste = (e: React.ClipboardEvent) => {
    const pasted = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, 4);
    if (pasted.length === 4) { setPin(pasted.split('')); pinRefs[3].current?.focus(); }
    e.preventDefault();
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim() || pinValue.length !== 4) { setError('Email and a 4-digit PIN are required.'); return; }
    setLoading(true); setError('');
    try {
      const res  = await fetch('/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: email.trim(), pin: pinValue }) });
      const data = await res.json();
      if (res.ok) {
        if (data.terminalToken) storePosTerminalSession(data.terminalToken);
        else clearPosTerminalSession();
        router.replace(data.redirect || '/');
      }
      else        { setError(data.error || 'Invalid credentials'); setPin(['', '', '', '']); pinRefs[0].current?.focus(); }
    } catch { setError('Cannot reach server — please try again.'); }
    setLoading(false);
  };

  const ready = pinValue.length === 4 && email.trim().length > 0;

  /* ── Shared styles ── */
  const label: React.CSSProperties = { display: 'block', marginBottom: 8, fontSize: 11, fontWeight: 700, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.08em' };
  const textInput: React.CSSProperties = { width: '100%', padding: '12px 14px', border: '1.5px solid #e2e8f0', background: '#f8fafc', color: '#0f172a', borderRadius: 10, fontFamily: 'inherit', fontSize: 15, outline: 'none', boxSizing: 'border-box' };

  return (
    /* Root — forces its own background, ignores ThemeProvider / globals.css */
    <div style={{
      minHeight: '100vh',
      width: '100%',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      background: '#dde4f0',
      fontFamily: "'Outfit','Inter',system-ui,sans-serif",
      padding: 24,
      boxSizing: 'border-box',
    }}>
      {/* Card */}
      <div style={{
        display: 'flex',
        width: '100%',
        maxWidth: 940,
        minHeight: 560,
        borderRadius: 22,
        overflow: 'hidden',
        boxShadow: '0 32px 80px rgba(0,0,0,0.18), 0 4px 24px rgba(0,0,0,0.08)',
      }}>

        {/* ── LEFT — blue gradient + illustration ── */}
        <div style={{
          flex: '1 1 0%',
          minWidth: 0,
          position: 'relative',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          overflow: 'hidden',
          background: 'linear-gradient(160deg,#1d4ed8 0%,#2563eb 38%,#3b82f6 65%,#93c5fd 86%,#fff 100%)',
        }}>

          {/* Logo — centered */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10, paddingTop: 36, paddingBottom: 8, width: '100%', position: 'relative', zIndex: 3 }}>
            <div style={{ width: 40, height: 40, background: 'rgba(255,255,255,0.22)', borderRadius: 10, display: 'flex', alignItems: 'center', justifyContent: 'center', border: '1px solid rgba(255,255,255,0.3)' }}>
              <Hexagon size={22} color="#fff" strokeWidth={2} />
            </div>
            <span style={{ fontSize: 20, fontWeight: 700, color: '#fff', letterSpacing: '-0.03em' }}>Retail OS</span>
          </div>

          {/* Tagline */}
          <p style={{ position: 'relative', zIndex: 3, color: 'rgba(255,255,255,0.85)', fontSize: 13, fontWeight: 500, textAlign: 'center', padding: '0 32px 12px' }}>
            Smart inventory management for Zambian retail
          </p>

          {/* Hero image — bottom-anchored, fades into white */}
          <div style={{ flex: 1, width: '100%', display: 'flex', alignItems: 'flex-end', justifyContent: 'center', padding: '0 16px', position: 'relative', zIndex: 3 }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/login-hero.png"
              alt="Retail OS illustration"
              style={{
                width: '100%',
                maxWidth: 420,
                objectFit: 'contain',
                display: 'block',
                WebkitMaskImage: 'linear-gradient(to bottom, black 55%, transparent 100%)',
                maskImage: 'linear-gradient(to bottom, black 55%, transparent 100%)',
              }}
            />
          </div>
        </div>

        {/* ── RIGHT — white form panel ── */}
        <div style={{
          width: 400,
          flexShrink: 0,
          background: '#ffffff',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
          padding: '52px 44px',
          boxSizing: 'border-box',
        }}>
          <h1 style={{ fontSize: 28, fontWeight: 700, color: '#0f172a', letterSpacing: '-0.03em', margin: '0 0 8px' }}>Welcome back</h1>
          <p style={{ fontSize: 14, color: '#64748b', lineHeight: 1.65, margin: '0 0 36px' }}>
            Sign in to your Retail OS account using your email address and 4-digit PIN.
          </p>

          {error && (
            <div style={{ padding: '12px 14px', background: '#fef2f2', border: '1.5px solid #fecaca', color: '#dc2626', borderRadius: 10, marginBottom: 20, fontSize: 13 }}>
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit} autoComplete="off" style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>

            {/* Email */}
            <div>
              <label htmlFor="login-email" style={label}>Email Address</label>
              <input
                id="login-email"
                style={textInput}
                type="email"
                autoComplete="username"
                value={email}
                onChange={e => setEmail(e.target.value)}
                placeholder="you@yourbusiness.co.zm"
                required
                onFocus={e  => { e.target.style.borderColor = '#2563eb'; e.target.style.boxShadow = '0 0 0 3px rgba(37,99,235,0.12)'; e.target.style.background = '#fff'; }}
                onBlur={e   => { e.target.style.borderColor = '#e2e8f0'; e.target.style.boxShadow = 'none'; e.target.style.background = '#f8fafc'; }}
              />
            </div>

            {/* PIN boxes */}
            <div>
              <label style={label}>4-Digit Security PIN</label>
              <div role="group" aria-label="4-Digit Security PIN" style={{ display: 'flex', gap: 10, width: '100%', overflow: 'hidden' }} onPaste={handlePinPaste}>
                {[0,1,2,3].map(i => (
                  <input
                    key={i}
                    ref={pinRefs[i]}
                    type="password"
                    inputMode="numeric"
                    maxLength={1}
                    value={pin[i]}
                    onChange={e => handlePinChange(i, e.target.value)}
                    onKeyDown={e => handlePinKey(i, e)}
                    autoComplete="new-password"
                    aria-label={`PIN digit ${i + 1}`}
                    style={{
                      flex: '1 1 0%',
                      minWidth: 0,
                      height: 56,
                      border: `1.5px solid ${pin[i] ? '#1d4ed8' : '#e2e8f0'}`,
                      borderRadius: 10,
                      background: pin[i] ? '#eff6ff' : '#f8fafc',
                      fontFamily: 'inherit',
                      fontSize: 26,
                      fontWeight: 700,
                      textAlign: 'center',
                      color: '#0f172a',
                      outline: 'none',
                      caretColor: 'transparent',
                      boxSizing: 'border-box',
                      transition: 'border-color 0.15s, background 0.15s',
                      padding: 0,
                    }}
                    onFocus={e  => { e.target.style.borderColor = '#2563eb'; e.target.style.boxShadow = '0 0 0 3px rgba(37,99,235,0.12)'; }}
                    onBlur={e   => { e.target.style.boxShadow = 'none'; e.target.style.borderColor = pin[i] ? '#1d4ed8' : '#e2e8f0'; }}
                  />
                ))}
              </div>
              <div style={{ fontSize: 12, color: '#94a3b8', marginTop: 8 }}>
                {pinValue.length === 0 && 'Enter your 4-digit PIN'}
                {pinValue.length > 0 && pinValue.length < 4 && `${4 - pinValue.length} more digit${4 - pinValue.length > 1 ? 's' : ''} remaining`}
                {pinValue.length === 4 && <span style={{ color: '#16a34a', fontWeight: 600 }}>✓ PIN complete</span>}
              </div>
            </div>

            {/* Submit */}
            <button
              type="submit"
              disabled={loading || !ready}
              style={{
                marginTop: 4,
                width: '100%',
                padding: 14,
                border: 'none',
                borderRadius: 10,
                fontFamily: 'inherit',
                fontSize: 15,
                fontWeight: 700,
                cursor: ready && !loading ? 'pointer' : 'not-allowed',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 8,
                background: ready && !loading ? 'linear-gradient(135deg,#1d4ed8,#2563eb)' : '#f1f5f9',
                color: ready && !loading ? '#fff' : '#94a3b8',
                boxShadow: ready && !loading ? '0 4px 18px rgba(37,99,235,0.38)' : 'none',
                transition: 'all 0.2s',
                letterSpacing: '-0.01em',
              }}
            >
              {loading ? 'Signing in…' : <><Lock size={16} /> Sign In</>}
            </button>
          </form>

          {/* Footer links */}
          <div style={{ marginTop: 28, display: 'flex', flexDirection: 'column', gap: 10, alignItems: 'center' }}>
            <p style={{ fontSize: 13, color: '#94a3b8' }}>
              Don&apos;t have an account?{' '}
              <a href="/register" style={{ color: '#2563eb', textDecoration: 'none', fontWeight: 600 }}>Register here</a>
            </p>
            <p style={{ fontSize: 13, color: '#94a3b8' }}>
              Need help?{' '}
              <a href="mailto:01dennisbanda@gmail.com?subject=Retail%20OS%20Support%20Request" style={{ color: '#475569', textDecoration: 'none', fontWeight: 600 }}>Contact support</a>
            </p>
          </div>
        </div>

      </div>
    </div>
  );
}
