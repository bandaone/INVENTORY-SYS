'use client';
import { useState, useEffect } from 'react';
import { UserPlus, Edit2, UserX, UserCheck, X, Loader2, Eye, EyeOff } from 'lucide-react';

interface StaffMember {
  id: string;
  name: string;
  email: string;
  role: string;
  is_active: boolean;
  location_name: string | null;
}

interface Location {
  id: string;
  name: string;
}

const ROLE_COLORS: Record<string, string> = {
  owner:         'rgba(74,222,128,0.15)',
  store_manager: 'rgba(96,165,250,0.15)',
  cashier:       'rgba(245,158,11,0.15)',
  stock_clerk:   'rgba(167,139,250,0.15)',
};
const ROLE_TEXT: Record<string, string> = {
  owner: '#4ade80', store_manager: '#60a5fa', cashier: '#fbbf24', stock_clerk: '#a78bfa',
};

export default function StaffPage() {
  const [staff, setStaff]           = useState<StaffMember[]>([]);
  const [locations, setLocations]   = useState<Location[]>([]);
  const [loading, setLoading]       = useState(true);
  const [showModal, setShowModal]   = useState(false);
  const [editTarget, setEditTarget] = useState<StaffMember | null>(null);
  const [saving, setSaving]         = useState(false);
  const [error, setError]           = useState('');
  const [success, setSuccess]       = useState('');
  const [showPin, setShowPin]       = useState(false);

  const [form, setForm] = useState({ name: '', email: '', role: 'cashier', pin: '', location_id: '' });

  const fetchStaff = async () => {
    setLoading(true);
    const [staffRes, locRes] = await Promise.all([
      fetch('/api/staff').then(r => r.json()),
      fetch('/api/locations').then(r => r.json()).catch(() => []),
    ]);
    setStaff(Array.isArray(staffRes) ? staffRes : []);
    setLocations(Array.isArray(locRes) ? locRes : []);
    setLoading(false);
  };

  useEffect(() => { fetchStaff(); }, []);

  const flash = (msg: string) => { setSuccess(msg); setTimeout(() => setSuccess(''), 4000); };

  const openAdd = () => {
    setEditTarget(null);
    setForm({ name: '', email: '', role: 'cashier', pin: '', location_id: '' });
    setError(''); setShowPin(false); setShowModal(true);
  };

  const openEdit = (s: StaffMember) => {
    setEditTarget(s);
    setForm({ name: s.name, email: s.email || '', role: s.role, pin: '', location_id: '' });
    setError(''); setShowPin(false); setShowModal(true);
  };

  const handleSave = async () => {
    setError('');
    if (!form.name.trim()) { setError('Name is required'); return; }
    if (!editTarget && (!form.pin || !/^\d{4}$/.test(form.pin))) {
      setError('A 4-digit numeric PIN is required for new staff'); return;
    }
    if (form.pin && !/^\d{4}$/.test(form.pin)) {
      setError('PIN must be exactly 4 digits'); return;
    }

    setSaving(true);
    try {
      let body: any;
      let method: string;

      if (editTarget) {
        // Edit: only send changed fields
        body = { id: editTarget.id, name: form.name, email: form.email, role: form.role };
        if (form.pin) body.pin = form.pin;
        if (form.location_id) body.location_id = form.location_id;
        method = 'PATCH';
      } else {
        body = { ...form };
        method = 'POST';
      }

      const res = await fetch('/api/staff', {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json();

      if (!res.ok) {
        setError(data.error || 'Save failed');
      } else {
        setShowModal(false);
        fetchStaff();
        flash(editTarget ? `${form.name} updated successfully.` : `${form.name} added to your team.`);
      }
    } catch {
      setError('Network error — please try again');
    }
    setSaving(false);
  };

  const toggleActive = async (s: StaffMember) => {
    const res = await fetch('/api/staff', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: s.id, is_active: !s.is_active }),
    });
    if (res.ok) {
      fetchStaff();
      flash(s.is_active ? `${s.name} has been deactivated.` : `${s.name} has been reactivated.`);
    }
  };

  const inputStyle: React.CSSProperties = {
    width: '100%', padding: '10px 14px',
    background: 'var(--bg-color)', border: '1px solid var(--panel-border)',
    color: 'var(--text-main)', borderRadius: '8px',
    fontFamily: 'Outfit, sans-serif', fontSize: '14px', boxSizing: 'border-box',
  };
  const labelStyle: React.CSSProperties = {
    display: 'block', fontSize: '12px', color: 'var(--text-muted)',
    marginBottom: '6px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em',
  };

  return (
    <div className="animate-fade-in">
      <h1>Staff Management</h1>
      <p className="subtitle">Create and manage users who can log in to this store's systems.</p>

      {success && (
        <div style={{ margin: '16px 0', padding: '12px 16px', background: 'rgba(74,222,128,0.1)', border: '1px solid var(--primary)', borderRadius: '8px', color: 'var(--primary)', fontSize: '14px' }}>
          ✓ {success}
        </div>
      )}

      <div className="glass-panel" style={{ marginTop: '24px' }}>
        <div className="chart-header">
          <h3>
            Team Members
            <span style={{ marginLeft: '8px', fontSize: '13px', color: 'var(--text-muted)', fontWeight: 400 }}>
              {staff.filter(s => s.is_active).length} active
            </span>
          </h3>
          <button onClick={openAdd} style={{ display: 'flex', alignItems: 'center', gap: '8px', background: 'var(--primary)', color: '#0f1115', border: 'none', padding: '8px 16px', borderRadius: '8px', fontWeight: 600, cursor: 'pointer', fontSize: '14px', fontFamily: 'Outfit, sans-serif' }}>
            <UserPlus size={15} /> Add Staff Member
          </button>
        </div>

        {loading ? (
          <div style={{ textAlign: 'center', padding: '40px', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}>
            <Loader2 size={18} className="spin" /> Loading...
          </div>
        ) : (
          <table className="data-table">
            <thead>
              <tr><th>Name</th><th>Email</th><th>Role</th><th>Location</th><th>Status</th><th>Actions</th></tr>
            </thead>
            <tbody>
              {staff.length === 0 && (
                <tr><td colSpan={6} style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '32px' }}>
                  No staff yet. Add your first team member to get started.
                </td></tr>
              )}
              {staff.map(s => (
                <tr key={s.id} style={{ opacity: s.is_active ? 1 : 0.5 }}>
                  <td style={{ fontWeight: 600 }}>{s.name}</td>
                  <td style={{ color: 'var(--text-muted)', fontSize: '13px' }}>{s.email || '—'}</td>
                  <td>
                    <span style={{ padding: '3px 10px', borderRadius: '12px', fontSize: '12px', fontWeight: 600, background: ROLE_COLORS[s.role] || 'var(--hover-bg)', color: ROLE_TEXT[s.role] || 'var(--text-muted)', textTransform: 'capitalize' }}>
                      {s.role.replace('_', ' ')}
                    </span>
                  </td>
                  <td style={{ color: 'var(--text-muted)', fontSize: '13px' }}>{s.location_name || '—'}</td>
                  <td>
                    <span style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '13px', fontWeight: 500, color: s.is_active ? 'var(--primary)' : 'var(--text-muted)' }}>
                      <div style={{ width: '6px', height: '6px', borderRadius: '50%', background: s.is_active ? 'var(--primary)' : 'var(--text-muted)' }} />
                      {s.is_active ? 'Active' : 'Inactive'}
                    </span>
                  </td>
                  <td>
                    <div style={{ display: 'flex', gap: '6px' }}>
                      <button onClick={() => openEdit(s)} style={{ background: 'none', border: '1px solid var(--panel-border)', color: 'var(--secondary)', cursor: 'pointer', borderRadius: '6px', padding: '4px 10px', fontSize: '12px', display: 'flex', alignItems: 'center', gap: '4px', fontFamily: 'Outfit' }}>
                        <Edit2 size={11} /> Edit
                      </button>
                      <button onClick={() => toggleActive(s)} style={{ background: 'none', border: '1px solid var(--panel-border)', color: s.is_active ? 'var(--danger)' : 'var(--primary)', cursor: 'pointer', borderRadius: '6px', padding: '4px 10px', fontSize: '12px', display: 'flex', alignItems: 'center', gap: '4px', fontFamily: 'Outfit' }}>
                        {s.is_active ? <><UserX size={11} /> Disable</> : <><UserCheck size={11} /> Enable</>}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* ── Modal ── */}
      {showModal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.65)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px' }}>
          <div className="glass-panel" style={{ width: '100%', maxWidth: '500px', padding: '32px', maxHeight: '90vh', overflowY: 'auto' }}>

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' }}>
              <h3 style={{ margin: 0, fontSize: '18px' }}>{editTarget ? `Edit — ${editTarget.name}` : 'Add New Staff Member'}</h3>
              <button onClick={() => setShowModal(false)} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', padding: '4px' }}><X size={20} /></button>
            </div>

            {error && (
              <div style={{ padding: '10px 14px', background: 'rgba(239,68,68,0.1)', border: '1px solid var(--danger)', color: 'var(--danger)', borderRadius: '8px', marginBottom: '18px', fontSize: '13px' }}>
                {error}
              </div>
            )}

            <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              {/* Name */}
              <div>
                <label style={labelStyle}>Full Name *</label>
                <input
                  style={inputStyle} value={form.name}
                  onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                  placeholder="e.g. Jane Mwansa"
                  autoComplete="off"
                />
              </div>

              {/* Email */}
              <div>
                <label style={labelStyle}>Email Address</label>
                <input
                  style={inputStyle} type="email" value={form.email}
                  onChange={e => setForm(f => ({ ...f, email: e.target.value }))}
                  placeholder="jane@yourstore.com (used for login)"
                  autoComplete="off"
                />
              </div>

              {/* Role */}
              <div>
                <label style={labelStyle}>Role *</label>
                <select style={inputStyle} value={form.role} onChange={e => setForm(f => ({ ...f, role: e.target.value }))}>
                  <option value="cashier">Cashier — POS access only</option>
                  <option value="stock_clerk">Stock Clerk — Stocktake access only</option>
                  <option value="store_manager">Store Manager — Dashboard + reports</option>
                  <option value="owner">Owner — Full access</option>
                </select>
              </div>

              {/* Location */}
              {locations.length > 0 && (
                <div>
                  <label style={labelStyle}>Assign to Location</label>
                  <select style={inputStyle} value={form.location_id} onChange={e => setForm(f => ({ ...f, location_id: e.target.value }))}>
                    <option value="">— No specific location —</option>
                    {locations.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
                  </select>
                </div>
              )}

              {/* PIN with show/hide */}
              <div>
                <label style={labelStyle}>
                  {editTarget ? 'New PIN (leave blank to keep current)' : '4-Digit PIN *'}
                </label>
                <div style={{ position: 'relative' }}>
                  <input
                    style={{ ...inputStyle, paddingRight: '44px', letterSpacing: showPin ? '0.15em' : '0.35em', fontWeight: 700, fontSize: '18px' }}
                    type={showPin ? 'text' : 'password'}
                    inputMode="numeric"
                    maxLength={4}
                    value={form.pin}
                    onChange={e => setForm(f => ({ ...f, pin: e.target.value.replace(/\D/g, '').slice(0, 4) }))}
                    placeholder={editTarget ? 'unchanged' : '••••'}
                    autoComplete="new-password"
                  />
                  <button type="button" onClick={() => setShowPin(v => !v)} tabIndex={-1}
                    style={{ position: 'absolute', right: '12px', top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', display: 'flex' }}>
                    {showPin ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                </div>
                {/* PIN progress dots */}
                <div style={{ display: 'flex', gap: '5px', marginTop: '7px' }}>
                  {[0,1,2,3].map(i => (
                    <div key={i} style={{ flex: 1, height: '3px', borderRadius: '2px', transition: 'background 0.2s', background: i < form.pin.length ? 'var(--primary)' : 'var(--panel-border)' }} />
                  ))}
                </div>
                <p style={{ fontSize: '12px', color: 'var(--text-muted)', marginTop: '6px' }}>
                  Cashiers use their PIN to log in to the POS. All staff use email + PIN to access the dashboard.
                </p>
              </div>
            </div>

            <div style={{ display: 'flex', gap: '10px', marginTop: '24px' }}>
              <button onClick={handleSave} disabled={saving}
                style={{ flex: 1, padding: '12px', background: 'var(--primary)', color: '#0f1115', border: 'none', borderRadius: '8px', fontWeight: 700, cursor: saving ? 'not-allowed' : 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', fontFamily: 'Outfit' }}>
                {saving ? <><Loader2 size={15} className="spin" /> Saving...</> : (editTarget ? 'Save Changes' : 'Create Staff Member')}
              </button>
              <button onClick={() => setShowModal(false)}
                style={{ padding: '12px 20px', background: 'transparent', border: '1px solid var(--panel-border)', color: 'var(--text-main)', borderRadius: '8px', cursor: 'pointer', fontFamily: 'Outfit', fontWeight: 500 }}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
