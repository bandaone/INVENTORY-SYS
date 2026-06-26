'use client';

import { useEffect, useState } from 'react';
import { OwnerBadge, OwnerMetricCard, OwnerSection } from '@/components/SuperAdminBlocks';

type Profile = {
  id: string;
  name: string;
  email: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
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
    let mounted = true;
    fetch('/api/superadmin/profile')
      .then((res) => res.json())
      .then((data) => {
        if (!mounted) return;
        if (data.profile) {
          setProfile(data.profile);
          setName(data.profile.name || '');
          setEmail(data.profile.email || '');
        }
      })
      .catch(() => {
        if (mounted) setError('Unable to load superadmin profile.');
      })
      .finally(() => {
        if (mounted) setLoading(false);
      });
    return () => {
      mounted = false;
    };
  }, []);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError('');
    setMessage('');
    try {
      const res = await fetch('/api/superadmin/profile', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, email, pin: pin.trim() || undefined }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || 'Failed to update credentials');
        return;
      }
      setMessage('Admin credentials updated.');
      setPin('');
      setProfile((prev) => (prev ? { ...prev, name, email } : prev));
      window.localStorage.setItem('superadmin_name', name);
    } catch {
      setError('Network error while saving credentials.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="animate-fade-in" style={{ display: 'flex', flexDirection: 'column', gap: '24px', maxWidth: '820px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: '16px', alignItems: 'flex-start', flexWrap: 'wrap' }}>
        <div>
          <h1 style={{ fontSize: '32px', margin: 0, color: 'var(--text-main)' }}>Admin</h1>
          <p className="subtitle" style={{ marginTop: '8px' }}>
            Update the platform superadmin login details without leaving the control plane.
          </p>
        </div>
        <OwnerBadge tone="secondary">Superadmin account</OwnerBadge>
      </div>

      <section style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '18px' }}>
        <OwnerMetricCard label="Status" value={loading ? 'Loading' : profile?.is_active ? 'Active' : 'Disabled'} note="Platform operator access" tone="primary" />
        <OwnerMetricCard label="Email" value={loading ? '—' : (profile?.email || '—')} note="Current sign-in email" tone="secondary" />
        <OwnerMetricCard label="PIN" value="••••" note="Change it here when needed" tone="primary" />
        <OwnerMetricCard label="Created" value={loading ? '—' : new Date(profile?.created_at || '').toLocaleDateString()} note="Account record" tone="secondary" />
      </section>

      <OwnerSection title="Edit credentials" subtitle="Keep your admin details current.">
        {error && (
          <div style={{ marginBottom: '16px', padding: '12px 14px', borderRadius: '10px', border: '1px solid rgba(239,68,68,0.24)', background: 'rgba(239,68,68,0.08)', color: 'var(--danger)' }}>
            {error}
          </div>
        )}
        {message && (
          <div style={{ marginBottom: '16px', padding: '12px 14px', borderRadius: '10px', border: '1px solid rgba(74,222,128,0.24)', background: 'rgba(74,222,128,0.08)', color: 'var(--primary)' }}>
            {message}
          </div>
        )}
        <form onSubmit={onSubmit} style={{ display: 'grid', gap: '16px' }}>
          <label style={{ display: 'grid', gap: '8px' }}>
            <span style={{ fontSize: '13px', color: 'var(--text-muted)', fontWeight: 600 }}>Name</span>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              style={{ width: '100%', padding: '12px 14px', borderRadius: '10px', border: '1px solid var(--panel-border)', background: 'var(--hover-bg)', color: 'var(--text-main)' }}
              placeholder="Super Admin"
            />
          </label>
          <label style={{ display: 'grid', gap: '8px' }}>
            <span style={{ fontSize: '13px', color: 'var(--text-muted)', fontWeight: 600 }}>Email</span>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              style={{ width: '100%', padding: '12px 14px', borderRadius: '10px', border: '1px solid var(--panel-border)', background: 'var(--hover-bg)', color: 'var(--text-main)' }}
              placeholder="superadmin@company.com"
            />
          </label>
          <label style={{ display: 'grid', gap: '8px' }}>
            <span style={{ fontSize: '13px', color: 'var(--text-muted)', fontWeight: 600 }}>New PIN</span>
            <input
              inputMode="numeric"
              maxLength={4}
              value={pin}
              onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 4))}
              style={{ width: '100%', padding: '12px 14px', borderRadius: '10px', border: '1px solid var(--panel-border)', background: 'var(--hover-bg)', color: 'var(--text-main)', letterSpacing: '0.25em', fontWeight: 700 }}
              placeholder="Optional"
            />
          </label>
          <button
            type="submit"
            disabled={saving}
            style={{ padding: '14px 16px', borderRadius: '10px', border: 'none', background: 'var(--primary)', color: '#0f1115', fontWeight: 800, cursor: saving ? 'not-allowed' : 'pointer' }}
          >
            {saving ? 'Saving...' : 'Save Admin Details'}
          </button>
        </form>
      </OwnerSection>
    </div>
  );
}
