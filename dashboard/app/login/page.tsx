'use client';
import { useState } from 'react';
import { Hexagon, Lock, Eye, EyeOff } from 'lucide-react';

export default function LoginPage() {
  const [loading, setLoading]   = useState(false);
  const [error, setError]       = useState('');
  const [email, setEmail]       = useState('');
  const [pin, setPin]           = useState('');
  const [showPin, setShowPin]   = useState(false);

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
      setError('Cannot reach server — is the system running?');
    }
    setLoading(false);
  };

  const inputStyle: React.CSSProperties = {
    width: '100%', padding: '12px 16px',
    border: '1px solid var(--panel-border)',
    background: 'var(--bg-color)', color: 'var(--text-main)',
    borderRadius: '8px', fontFamily: 'Outfit, sans-serif',
    fontSize: '15px', outline: 'none', boxSizing: 'border-box',
  };

  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--bg-color)', fontFamily: 'Outfit, sans-serif' }}>
      <div className="glass-panel" style={{ width: '100%', maxWidth: '420px', padding: '44px 40px' }}>

        {/* Logo */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '32px', justifyContent: 'center' }}>
          <Hexagon size={30} color="var(--primary)" />
          <span style={{ fontSize: '24px', fontWeight: 700, color: 'var(--text-main)' }}>Retail OS</span>
        </div>

        <h1 style={{ fontSize: '22px', marginBottom: '6px', textAlign: 'center', color: 'var(--text-main)' }}>Welcome back</h1>
        <p style={{ color: 'var(--text-muted)', marginBottom: '28px', textAlign: 'center', fontSize: '14px' }}>
          Sign in with your email and PIN. You’ll land in the right workspace automatically.
        </p>

        {error && (
          <div style={{ padding: '12px 14px', background: 'rgba(239,68,68,0.1)', border: '1px solid var(--danger)', color: 'var(--danger)', borderRadius: '8px', marginBottom: '20px', fontSize: '14px' }}>
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} autoComplete="off" style={{ display: 'flex', flexDirection: 'column', gap: '18px' }}>

          {/* Email */}
          <div>
            <label style={{ display: 'block', marginBottom: '7px', fontSize: '13px', fontWeight: 600, color: 'var(--text-muted)' }}>
              EMAIL ADDRESS
            </label>
            <input
              type="email"
              autoComplete="username"
              value={email}
              onChange={e => setEmail(e.target.value)}
              placeholder="you@yourbusiness.co.zm"
              required
              style={inputStyle}
            />
          </div>

          {/* PIN with show/hide toggle */}
          <div>
            <label style={{ display: 'block', marginBottom: '7px', fontSize: '13px', fontWeight: 600, color: 'var(--text-muted)' }}>
              4-DIGIT PIN
            </label>
            <div style={{ position: 'relative' }}>
              <input
                type={showPin ? 'text' : 'password'}
                autoComplete="new-password"
                inputMode="numeric"
                maxLength={4}
                value={pin}
                onChange={e => setPin(e.target.value.replace(/\D/g, '').slice(0, 4))}
                placeholder={showPin ? '1234' : '••••'}
                required
                style={{
                  ...inputStyle,
                  letterSpacing: showPin ? '0.15em' : '0.35em',
                  paddingRight: '48px',
                  fontWeight: 700,
                  fontSize: '20px',
                }}
              />
              <button
                type="button"
                onClick={() => setShowPin(v => !v)}
                style={{
                  position: 'absolute', right: '12px', top: '50%', transform: 'translateY(-50%)',
                  background: 'none', border: 'none', cursor: 'pointer',
                  color: 'var(--text-muted)', padding: '4px', display: 'flex',
                }}
                tabIndex={-1}
                title={showPin ? 'Hide PIN' : 'Show PIN'}
              >
                {showPin ? <EyeOff size={18} /> : <Eye size={18} />}
              </button>
            </div>
            {/* Live strength indicator */}
            <div style={{ display: 'flex', gap: '6px', marginTop: '8px' }}>
              {[0,1,2,3].map(i => (
                <div key={i} style={{ flex: 1, height: '3px', borderRadius: '2px', background: i < pin.length ? 'var(--primary)' : 'var(--panel-border)', transition: 'background 0.2s' }} />
              ))}
            </div>
            <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginTop: '5px' }}>
              {pin.length === 0 && 'Enter your 4-digit PIN'}
              {pin.length > 0 && pin.length < 4 && `${4 - pin.length} digit${4 - pin.length > 1 ? 's' : ''} remaining`}
              {pin.length === 4 && <span style={{ color: 'var(--primary)' }}>✓ PIN complete</span>}
            </div>
          </div>

          <button
            type="submit"
            disabled={loading || pin.length < 4 || !email.trim()}
            style={{
              marginTop: '8px', width: '100%', padding: '14px',
              background: (pin.length === 4 && email.trim()) ? 'var(--primary)' : 'var(--hover-bg)',
              color: (pin.length === 4 && email.trim()) ? '#0f1115' : 'var(--text-muted)',
              border: 'none', borderRadius: '10px', fontWeight: 700, fontSize: '16px',
              cursor: (loading || pin.length < 4 || !email.trim()) ? 'not-allowed' : 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px',
              fontFamily: 'Outfit, sans-serif', transition: 'all 0.2s',
            }}
          >
            {loading ? 'Signing in...' : <><Lock size={16} /> Sign In</>}
          </button>
        </form>

        <p style={{ marginTop: '28px', textAlign: 'center', fontSize: '14px', color: 'var(--text-muted)' }}>
          No account?{' '}
          <a href="/register" style={{ color: 'var(--primary)', textDecoration: 'none', fontWeight: 600 }}>Register your store</a>
        </p>
      </div>
    </div>
  );
}
