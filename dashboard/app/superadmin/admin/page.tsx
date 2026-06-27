'use client';

import { useEffect, useState } from 'react';
import { Shield, Mail, Lock, Calendar, CheckCircle2, Save, Loader, AlertCircle, User } from 'lucide-react';

type Profile = {
  id: string;
  name: string;
  email: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
};

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '12px 16px',
  borderRadius: '10px',
  border: '1px solid var(--panel-border)',
  background: 'rgba(255,255,255,0.04)',
  color: 'var(--text-main)',
  fontSize: '15px',
  fontFamily: 'Outfit, sans-serif',
  outline: 'none',
  boxSizing: 'border-box',
  transition: 'border-color 0.2s',
};

const labelStyle: React.CSSProperties = {
  fontSize: '12px',
  fontWeight: 700,
  letterSpacing: '0.06em',
  color: 'var(--text-muted)',
  textTransform: 'uppercase',
  marginBottom: '8px',
  display: 'block',
};

export default function SuperAdminProfilePage() {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [pin, setPin] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    fetch('/api/superadmin/profile')
      .then((r) => r.json())
      .then((data) => {
        if (data.profile) {
          setProfile(data.profile);
          setName(data.profile.name || '');
          setEmail(data.profile.email || '');
        }
      })
      .catch(() => setError('Unable to load profile.'))
      .finally(() => setLoading(false));
  }, []);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true); setError(''); setMessage('');
    try {
      const res = await fetch('/api/superadmin/profile', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, email, pin: pin.trim() || undefined }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error || 'Failed to update credentials'); return; }
      setMessage('Admin credentials updated successfully.');
      setPin('');
      setProfile((prev) => (prev ? { ...prev, name, email } : prev));
    } catch {
      setError('Network error while saving.');
    } finally { setSaving(false); }
  };

  const StatCard = ({ icon: Icon, label, value, tone }: { icon: any; label: string; value: string; tone: 'green' | 'blue' | 'muted' }) => {
    const colors = {
      green: { bg: 'rgba(74,222,128,0.08)', border: 'rgba(74,222,128,0.2)', icon: '#4ade80', val: '#4ade80' },
      blue:  { bg: 'rgba(96,165,250,0.08)', border: 'rgba(96,165,250,0.2)', icon: '#60a5fa', val: 'var(--text-main)' },
      muted: { bg: 'rgba(255,255,255,0.03)', border: 'var(--panel-border)', icon: 'var(--text-muted)', val: 'var(--text-main)' },
    }[tone];
    return (
      <div style={{ background: colors.bg, border: `1px solid ${colors.border}`, borderRadius: '14px', padding: '20px 22px', display: 'flex', gap: '16px', alignItems: 'center' }}>
        <div style={{ width: '40px', height: '40px', borderRadius: '10px', background: `${colors.icon}18`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
          <Icon size={18} color={colors.icon} />
        </div>
        <div>
          <div style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '4px' }}>{label}</div>
          <div style={{ fontSize: '15px', fontWeight: 700, color: colors.val, wordBreak: 'break-all' }}>{value}</div>
        </div>
      </div>
    );
  };

  return (
    <div className="animate-fade-in" style={{ maxWidth: '820px', display: 'flex', flexDirection: 'column', gap: '28px' }}>

      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '12px' }}>
        <div>
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: '8px', padding: '5px 10px', borderRadius: '999px', background: 'rgba(74,222,128,0.1)', color: 'var(--primary)', fontSize: '11px', fontWeight: 700, letterSpacing: '0.05em', marginBottom: '12px' }}>
            <Shield size={11} /> SUPERADMIN ACCOUNT
          </div>
          <h1 style={{ margin: 0, fontSize: '30px' }}>Admin Profile</h1>
          <p className="subtitle" style={{ marginTop: '6px' }}>
            Manage your platform operator credentials. Changes take effect immediately.
          </p>
        </div>
        <div style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', padding: '8px 14px', borderRadius: '999px', background: 'rgba(74,222,128,0.1)', border: '1px solid rgba(74,222,128,0.25)', color: '#4ade80', fontSize: '13px', fontWeight: 700 }}>
          <CheckCircle2 size={13} />
          {loading ? 'Loading...' : profile?.is_active ? 'Active' : 'Disabled'}
        </div>
      </div>

      {/* Stat Cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '14px' }}>
        <StatCard icon={Mail}     label="Sign-in Email"  value={loading ? '—' : profile?.email || '—'}                                            tone="blue" />
        <StatCard icon={Lock}     label="PIN"            value="••••  (change below)"                                                               tone="muted" />
        <StatCard icon={Calendar} label="Account Created" value={loading ? '—' : new Date(profile?.created_at || '').toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })} tone="muted" />
      </div>

      {/* Edit Form */}
      <div className="glass-panel" style={{ padding: '28px 30px' }}>
        <div style={{ marginBottom: '24px' }}>
          <h2 style={{ margin: 0, fontSize: '18px', fontWeight: 700 }}>Edit Credentials</h2>
          <p className="subtitle" style={{ marginTop: '6px', fontSize: '13px' }}>
            Keep your login details up to date. PIN is only required if you want to change it.
          </p>
        </div>

        {error && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '20px', padding: '12px 16px', borderRadius: '10px', border: '1px solid rgba(239,68,68,0.3)', background: 'rgba(239,68,68,0.08)', color: '#f87171', fontSize: '14px' }}>
            <AlertCircle size={16} /> {error}
          </div>
        )}
        {message && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '20px', padding: '12px 16px', borderRadius: '10px', border: '1px solid rgba(74,222,128,0.3)', background: 'rgba(74,222,128,0.08)', color: '#4ade80', fontSize: '14px' }}>
            <CheckCircle2 size={16} /> {message}
          </div>
        )}

        <form onSubmit={onSubmit} style={{ display: 'grid', gap: '20px' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
            <div>
              <label style={labelStyle}><User size={10} style={{ display: 'inline', marginRight: '4px' }} />Full Name</label>
              <input value={name} onChange={(e) => setName(e.target.value)} style={inputStyle} placeholder="Dennis Banda" />
            </div>
            <div>
              <label style={labelStyle}><Mail size={10} style={{ display: 'inline', marginRight: '4px' }} />Email Address</label>
              <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} style={inputStyle} placeholder="admin@retailos.com" />
            </div>
          </div>

          <div style={{ maxWidth: '260px' }}>
            <label style={labelStyle}><Lock size={10} style={{ display: 'inline', marginRight: '4px' }} />New PIN (leave blank to keep current)</label>
            <input
              inputMode="numeric" maxLength={4}
              value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 4))}
              style={{ ...inputStyle, letterSpacing: '0.35em', fontWeight: 800, fontSize: '20px' }}
              placeholder="••••"
            />
          </div>

          <div>
            <button
              type="submit" disabled={saving}
              style={{ display: 'inline-flex', alignItems: 'center', gap: '8px', padding: '13px 28px', borderRadius: '10px', border: 'none', background: saving ? 'rgba(74,222,128,0.4)' : 'var(--primary)', color: '#0f1115', fontWeight: 800, fontSize: '14px', cursor: saving ? 'not-allowed' : 'pointer', transition: 'all 0.2s' }}
            >
              {saving ? <><Loader size={15} style={{ animation: 'spin 1s linear infinite' }} /> Saving...</> : <><Save size={15} /> Save Changes</>}
            </button>
          </div>
        </form>
      </div>

    </div>
  );
}
