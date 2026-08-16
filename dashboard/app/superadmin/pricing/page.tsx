'use client';

import { useState, useEffect } from 'react';
import { CreditCard, Save, CheckCircle2, Edit3, X, AlertCircle } from 'lucide-react';

interface Plan {
  id: string;
  name: string;
  price_zmw: number;
  max_locations: number;
  max_users: number;
  features: string[];
}

export default function PricingPage() {
  const [plans, setPlans] = useState<Plan[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<Partial<Plan>>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    fetchPlans();
  }, []);

  const fetchPlans = async () => {
    try {
      const res = await fetch('/api/superadmin/plans');
      if (!res.ok) throw new Error('Failed to fetch plans');
      const data = await res.json();
      setPlans(data);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const startEditing = (plan: Plan) => {
    setEditingId(plan.id);
    setEditForm({ ...plan });
  };

  const cancelEditing = () => {
    setEditingId(null);
    setEditForm({});
  };

  const savePlan = async (id: string) => {
    setSaving(true);
    setError('');
    try {
      const res = await fetch('/api/superadmin/plans', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, ...editForm }),
      });
      const result = await res.json();
      if (!res.ok) throw new Error(result.error || 'Failed to update plan');
      await fetchPlans();
      setEditingId(null);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <div style={{ padding: 40, color: 'var(--text-muted)' }}>Loading pricing engine...</div>;

  return (
    <div style={{ maxWidth: 1000, margin: '0 auto', padding: '24px 0' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 32 }}>
        <div>
          <h1 style={{ fontSize: 28, fontWeight: 700, margin: '0 0 8px 0', color: 'var(--text-main)', display: 'flex', alignItems: 'center', gap: 10 }}>
            <CreditCard color="var(--primary)" size={28} />
            Subscription Plans
          </h1>
          <p style={{ margin: 0, color: 'var(--text-muted)' }}>Prices apply to future invoices. Capacity changes are enforced across tenants and rejected when current usage would be invalid.</p>
        </div>
      </div>

      {error && (
        <div style={{ padding: 16, background: 'rgba(239, 68, 68, 0.1)', color: 'var(--danger)', borderRadius: 12, marginBottom: 24, display: 'flex', alignItems: 'center', gap: 10 }}>
          <AlertCircle size={18} /> {error}
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 24 }}>
        {plans.map(plan => {
          const isEditing = editingId === plan.id;

          return (
            <div key={plan.id} className="glass-panel" style={{ display: 'flex', flexDirection: 'column', position: 'relative' }}>
              
              {/* Header */}
              <div style={{ borderBottom: '1px solid var(--panel-border)', paddingBottom: 16, marginBottom: 16 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                  <h3 style={{ margin: 0, fontSize: 20, fontWeight: 700, color: 'var(--text-main)' }}>{plan.name}</h3>
                  {!isEditing ? (
                    <button onClick={() => startEditing(plan)} style={{ background: 'var(--hover-bg)', border: 'none', color: 'var(--primary)', padding: '6px 10px', borderRadius: 8, cursor: 'pointer', display: 'flex', gap: 6, alignItems: 'center', fontSize: 12, fontWeight: 600 }}>
                      <Edit3 size={14} /> Edit
                    </button>
                  ) : (
                    <button onClick={cancelEditing} style={{ background: 'transparent', border: 'none', color: 'var(--text-muted)', cursor: 'pointer' }}>
                      <X size={18} />
                    </button>
                  )}
                </div>

                {isEditing ? (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ fontSize: 24, fontWeight: 700, color: 'var(--text-main)' }}>ZMW</span>
                    <input 
                      type="number"
                      value={editForm.price_zmw || ''}
                      onChange={e => setEditForm({ ...editForm, price_zmw: Number(e.target.value) })}
                      style={{ background: 'var(--bg-color)', border: '1px solid var(--primary)', color: 'var(--text-main)', padding: '8px 12px', borderRadius: 8, fontSize: 24, fontWeight: 700, width: 120, outline: 'none' }}
                    />
                  </div>
                ) : (
                  <div style={{ fontSize: 32, fontWeight: 800, color: 'var(--text-main)', letterSpacing: '-0.02em' }}>
                    <span style={{ fontSize: 20, color: 'var(--text-muted)', fontWeight: 600 }}>ZMW</span> {Number(plan.price_zmw).toLocaleString()} <span style={{ fontSize: 14, color: 'var(--text-muted)', fontWeight: 500 }}>/ mo</span>
                  </div>
                )}
              </div>

              {/* Limits Editor */}
              <div style={{ marginBottom: 24, display: 'flex', gap: 16 }}>
                <div style={{ flex: 1, background: 'var(--hover-bg)', padding: 12, borderRadius: 10 }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: 8 }}>Max Locations</div>
                  {isEditing ? (
                    <input type="number" value={editForm.max_locations || ''} onChange={e => setEditForm({...editForm, max_locations: Number(e.target.value)})} style={{ width: '100%', background: 'var(--bg-color)', border: '1px solid var(--panel-border)', padding: '4px 8px', borderRadius: 6, color: 'var(--text-main)' }} />
                  ) : (
                    <div style={{ fontSize: 18, fontWeight: 600 }}>{plan.max_locations > 100 ? 'Unlimited' : plan.max_locations}</div>
                  )}
                </div>
                <div style={{ flex: 1, background: 'var(--hover-bg)', padding: 12, borderRadius: 10 }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: 8 }}>Max Users</div>
                  {isEditing ? (
                    <input type="number" value={editForm.max_users || ''} onChange={e => setEditForm({...editForm, max_users: Number(e.target.value)})} style={{ width: '100%', background: 'var(--bg-color)', border: '1px solid var(--panel-border)', padding: '4px 8px', borderRadius: 6, color: 'var(--text-main)' }} />
                  ) : (
                    <div style={{ fontSize: 18, fontWeight: 600 }}>{plan.max_users > 100 ? 'Unlimited' : plan.max_users}</div>
                  )}
                </div>
              </div>

              {/* Features List */}
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-muted)', marginBottom: 12 }}>INCLUDED FEATURES</div>
                {isEditing ? (
                  <textarea 
                    value={(editForm.features || []).join('\\n')}
                    onChange={e => setEditForm({...editForm, features: e.target.value.split('\\n').filter(Boolean)})}
                    style={{ width: '100%', height: 120, background: 'var(--bg-color)', border: '1px solid var(--panel-border)', padding: '8px', borderRadius: 8, color: 'var(--text-main)', fontSize: 14, fontFamily: 'inherit', resize: 'vertical' }}
                    placeholder="One feature per line..."
                  />
                ) : (
                  <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 10 }}>
                    {plan.features.map((feat, i) => (
                      <li key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 10, fontSize: 14, color: 'var(--text-main)' }}>
                        <CheckCircle2 size={16} color="var(--primary)" style={{ flexShrink: 0, marginTop: 2 }} />
                        <span>{feat}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              {/* Save Button */}
              {isEditing && (
                <button 
                  onClick={() => savePlan(plan.id)}
                  disabled={saving}
                  style={{ 
                    marginTop: 24, width: '100%', padding: '12px', background: 'var(--primary)', color: '#fff', border: 'none', borderRadius: 10, fontWeight: 600, cursor: saving ? 'not-allowed' : 'pointer',
                    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8
                  }}
                >
                  {saving ? 'Saving...' : <><Save size={16} /> Save Changes</>}
                </button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
