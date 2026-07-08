'use client';
import { useState } from 'react';
import { Lock, Eye, EyeOff, Package, BarChart3, RefreshCw, ShieldCheck } from 'lucide-react';

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
      setError('Cannot reach server — is the system running?');
    }
    setLoading(false);
  };

  return (
    // Hard-coded light theme — never inherits user theme
    <div style={{
      minHeight: '100vh',
      display: 'flex',
      fontFamily: "'Outfit', 'Inter', sans-serif",
      background: '#f8fafc',
      color: '#0f172a',
    }}>

      {/* ── LEFT PANEL — Flat Art ── */}
      <div style={{
        flex: '1 1 55%',
        display: 'flex',
        flexDirection: 'column',
        background: '#ffffff',
        borderRight: '1px solid #e2e8f0',
        padding: '48px',
        position: 'relative',
        overflow: 'hidden',
      }}
        className="login-left-panel"
      >
        {/* Logo */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: 'auto' }}>
          <div style={{ width: '36px', height: '36px', background: '#1e293b', borderRadius: '8px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <Package size={20} color="#f8fafc" />
          </div>
          <span style={{ fontWeight: 700, fontSize: '18px', color: '#0f172a', letterSpacing: '-0.02em' }}>Retail OS</span>
        </div>

        {/* Inline SVG Flat Art — Inventory Dashboard Scene */}
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '40px 0' }}>
          <svg viewBox="0 0 520 420" fill="none" xmlns="http://www.w3.org/2000/svg" style={{ width: '100%', maxWidth: '520px' }}>
            {/* Background grid dots */}
            {[...Array(8)].map((_, r) => [...Array(10)].map((_, c) => (
              <circle key={`${r}-${c}`} cx={30 + c * 52} cy={20 + r * 52} r="2" fill="#e2e8f0" />
            )))}

            {/* Main dashboard card */}
            <rect x="40" y="60" width="340" height="230" rx="14" fill="#f8fafc" stroke="#e2e8f0" strokeWidth="1.5" />
            {/* Dashboard header bar */}
            <rect x="40" y="60" width="340" height="42" rx="14" fill="#1e293b" />
            <rect x="40" y="88" width="340" height="14" fill="#1e293b" />
            <circle cx="64" cy="81" r="5" fill="#475569" />
            <circle cx="82" cy="81" r="5" fill="#475569" />
            <circle cx="100" cy="81" r="5" fill="#475569" />
            <rect x="140" y="74" width="120" height="14" rx="7" fill="#334155" />
            {/* Sidebar strip */}
            <rect x="40" y="102" width="70" height="188" fill="#f1f5f9" />
            {/* Sidebar items */}
            {[0,1,2,3,4].map(i => (
              <rect key={i} x="52" y={118 + i * 30} width="46" height="16" rx="4" fill={i === 0 ? '#1e293b' : '#cbd5e1'} />
            ))}
            {/* Main content area */}
            {/* Metric cards row */}
            <rect x="128" y="112" width="78" height="48" rx="8" fill="#fff" stroke="#e2e8f0" strokeWidth="1" />
            <rect x="218" y="112" width="78" height="48" rx="8" fill="#fff" stroke="#e2e8f0" strokeWidth="1" />
            <rect x="308" y="112" width="62" height="48" rx="8" fill="#fff" stroke="#e2e8f0" strokeWidth="1" />
            {/* Metric values */}
            <rect x="137" y="122" width="32" height="10" rx="3" fill="#94a3b8" />
            <rect x="137" y="137" width="52" height="14" rx="3" fill="#1e293b" />
            <rect x="227" y="122" width="32" height="10" rx="3" fill="#94a3b8" />
            <rect x="227" y="137" width="52" height="14" rx="3" fill="#1e293b" />
            <rect x="317" y="122" width="32" height="10" rx="3" fill="#94a3b8" />
            <rect x="317" y="137" width="42" height="14" rx="3" fill="#1e293b" />
            {/* Bar chart */}
            <rect x="128" y="172" width="176" height="108" rx="8" fill="#fff" stroke="#e2e8f0" strokeWidth="1" />
            <rect x="138" y="182" width="70" height="10" rx="3" fill="#94a3b8" />
            {/* Bars */}
            {[
              { x: 142, h: 52, fill: '#1e293b' },
              { x: 162, h: 38, fill: '#94a3b8' },
              { x: 182, h: 64, fill: '#1e293b' },
              { x: 202, h: 44, fill: '#94a3b8' },
              { x: 222, h: 72, fill: '#1e293b' },
              { x: 242, h: 30, fill: '#94a3b8' },
              { x: 262, h: 58, fill: '#1e293b' },
              { x: 282, h: 50, fill: '#94a3b8' },
            ].map((b, i) => (
              <rect key={i} x={b.x} y={262 - b.h} width="14" height={b.h} rx="3" fill={b.fill} opacity="0.85" />
            ))}
            {/* Base line */}
            <line x1="136" y1="262" x2="296" y2="262" stroke="#e2e8f0" strokeWidth="1" />
            {/* Donut / ring chart */}
            <rect x="308" y="172" width="62" height="108" rx="8" fill="#fff" stroke="#e2e8f0" strokeWidth="1" />
            <circle cx="339" cy="220" r="26" stroke="#e2e8f0" strokeWidth="14" fill="none" />
            <circle cx="339" cy="220" r="26" stroke="#1e293b" strokeWidth="14" fill="none"
              strokeDasharray="70 94" strokeDashoffset="23" strokeLinecap="round" />
            <rect x="317" y="255" width="44" height="8" rx="3" fill="#e2e8f0" />

            {/* Floating inventory card (right side) */}
            <rect x="400" y="80" width="108" height="136" rx="12" fill="#fff" stroke="#e2e8f0" strokeWidth="1.5" />
            <rect x="400" y="80" width="108" height="32" rx="12" fill="#1e293b" />
            <rect x="400" y="100" width="108" height="12" fill="#1e293b" />
            <rect x="412" y="90" width="60" height="10" rx="3" fill="#475569" />
            {/* Product rows */}
            {[0,1,2].map(i => (
              <g key={i}>
                <rect x="412" y={126 + i * 26} width="20" height="20" rx="4" fill="#f1f5f9" stroke="#e2e8f0" strokeWidth="1" />
                <rect x="438" y={129 + i * 26} width="44" height="7" rx="3" fill="#94a3b8" />
                <rect x="438" y={140 + i * 26} width="30" height="5" rx="3" fill="#cbd5e1" />
              </g>
            ))}

            {/* Floating sync / ZRA badge */}
            <rect x="400" y="232" width="108" height="56" rx="12" fill="#f0fdf4" stroke="#bbf7d0" strokeWidth="1.5" />
            <rect x="414" y="245" width="26" height="26" rx="6" fill="#dcfce7" />
            {/* check icon placeholder */}
            <polyline points="418,258 421,262 428,254" stroke="#16a34a" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            <rect x="448" y="248" width="48" height="8" rx="3" fill="#166534" opacity="0.7" />
            <rect x="448" y="260" width="36" height="6" rx="3" fill="#16a34a" opacity="0.5" />

            {/* Floating alert card bottom left */}
            <rect x="40" y="302" width="160" height="56" rx="12" fill="#fff" stroke="#e2e8f0" strokeWidth="1.5" />
            <rect x="54" y="316" width="24" height="24" rx="6" fill="#f1f5f9" />
            <rect x="53" y="315" width="26" height="26" rx="6" fill="#fef3c7" />
            <text x="60" y="333" fontSize="14" fill="#92400e">⚠</text>
            <rect x="87" y="319" width="96" height="8" rx="3" fill="#94a3b8" />
            <rect x="87" y="331" width="70" height="6" rx="3" fill="#cbd5e1" />

            {/* Decorative corner accent */}
            <circle cx="476" cy="50" r="40" fill="#f1f5f9" opacity="0.6" />
            <circle cx="476" cy="50" r="24" fill="#e2e8f0" opacity="0.7" />
          </svg>
        </div>

        {/* Feature bullets */}
        <div style={{ display: 'flex', gap: '24px', flexWrap: 'wrap' }}>
          {[
            { icon: BarChart3, text: 'Real-time analytics' },
            { icon: RefreshCw, text: 'ZRA VSDC sync' },
            { icon: ShieldCheck, text: 'Enterprise security' },
          ].map(({ icon: Icon, text }) => (
            <div key={text} style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px', color: '#64748b' }}>
              <Icon size={15} color="#94a3b8" />
              {text}
            </div>
          ))}
        </div>
      </div>

      {/* ── RIGHT PANEL — Form ── */}
      <div style={{
        flex: '0 0 400px',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '48px 40px',
        background: '#f8fafc',
      }}>
        <div style={{ width: '100%', maxWidth: '340px' }}>

          {/* Header */}
          <h1 style={{ fontSize: '26px', fontWeight: 700, marginBottom: '8px', color: '#0f172a', letterSpacing: '-0.03em' }}>
            Welcome back
          </h1>
          <p style={{ color: '#64748b', marginBottom: '36px', fontSize: '14px', lineHeight: '1.6' }}>
            Sign in with your email and PIN to access your workspace.
          </p>

          {/* Error */}
          {error && (
            <div style={{ padding: '12px 14px', background: '#fef2f2', border: '1px solid #fecaca', color: '#dc2626', borderRadius: '8px', marginBottom: '20px', fontSize: '14px' }}>
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit} autoComplete="off" style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>

            {/* Email */}
            <div>
              <label style={{ display: 'block', marginBottom: '7px', fontSize: '12px', fontWeight: 600, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                Email Address
              </label>
              <input
                type="email"
                autoComplete="username"
                value={email}
                onChange={e => setEmail(e.target.value)}
                placeholder="you@yourbusiness.co.zm"
                required
                style={{
                  width: '100%', padding: '12px 14px',
                  border: '1px solid #e2e8f0',
                  background: '#ffffff', color: '#0f172a',
                  borderRadius: '8px', fontFamily: 'inherit',
                  fontSize: '15px', outline: 'none', boxSizing: 'border-box',
                  transition: 'border-color 0.2s',
                }}
                onFocus={e => e.target.style.borderColor = '#1e293b'}
                onBlur={e => e.target.style.borderColor = '#e2e8f0'}
              />
            </div>

            {/* PIN */}
            <div>
              <label style={{ display: 'block', marginBottom: '7px', fontSize: '12px', fontWeight: 600, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                4-Digit PIN
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
                    width: '100%', padding: '12px 48px 12px 14px',
                    border: '1px solid #e2e8f0',
                    background: '#ffffff', color: '#0f172a',
                    borderRadius: '8px', fontFamily: 'inherit',
                    fontSize: '22px', fontWeight: 700,
                    letterSpacing: showPin ? '0.15em' : '0.4em',
                    outline: 'none', boxSizing: 'border-box',
                    transition: 'border-color 0.2s',
                  }}
                  onFocus={e => e.target.style.borderColor = '#1e293b'}
                  onBlur={e => e.target.style.borderColor = '#e2e8f0'}
                />
                <button type="button" onClick={() => setShowPin(v => !v)} tabIndex={-1}
                  style={{ position: 'absolute', right: '12px', top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', color: '#94a3b8', padding: '4px', display: 'flex' }}
                  title={showPin ? 'Hide PIN' : 'Show PIN'}
                >
                  {showPin ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              </div>
              {/* PIN progress dots */}
              <div style={{ display: 'flex', gap: '6px', marginTop: '10px' }}>
                {[0,1,2,3].map(i => (
                  <div key={i} style={{ flex: 1, height: '3px', borderRadius: '2px', background: i < pin.length ? '#1e293b' : '#e2e8f0', transition: 'background 0.2s' }} />
                ))}
              </div>
              <div style={{ fontSize: '12px', color: '#94a3b8', marginTop: '5px' }}>
                {pin.length === 0 && 'Enter your 4-digit PIN'}
                {pin.length > 0 && pin.length < 4 && `${4 - pin.length} digit${4 - pin.length > 1 ? 's' : ''} remaining`}
                {pin.length === 4 && <span style={{ color: '#16a34a', fontWeight: 600 }}>✓ PIN complete</span>}
              </div>
            </div>

            {/* Submit */}
            <button
              type="submit"
              disabled={loading || pin.length < 4 || !email.trim()}
              style={{
                marginTop: '4px', width: '100%', padding: '14px',
                background: (pin.length === 4 && email.trim()) ? '#1e293b' : '#e2e8f0',
                color: (pin.length === 4 && email.trim()) ? '#f8fafc' : '#94a3b8',
                border: 'none', borderRadius: '10px', fontWeight: 700, fontSize: '15px',
                cursor: (loading || pin.length < 4 || !email.trim()) ? 'not-allowed' : 'pointer',
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px',
                fontFamily: 'inherit', transition: 'all 0.2s',
                letterSpacing: '-0.01em',
              }}
            >
              {loading ? 'Signing in…' : <><Lock size={16} /> Sign In</>}
            </button>
          </form>

          <p style={{ marginTop: '28px', textAlign: 'center', fontSize: '13px', color: '#94a3b8' }}>
            No account?{' '}
            <a href="/register" style={{ color: '#1e293b', textDecoration: 'none', fontWeight: 600 }}>Register your store →</a>
          </p>
        </div>
      </div>

      {/* Responsive: hide left panel on small screens */}
      <style>{`
        @media (max-width: 768px) {
          .login-left-panel { display: none !important; }
        }
      `}</style>
    </div>
  );
}
