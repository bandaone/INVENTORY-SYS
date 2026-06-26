'use client';
import { useEffect, useRef, useState } from 'react';
import { Save, Loader2, CheckCircle2, MapPin, Plus, CreditCard, ArrowRight, ShieldCheck, Zap } from 'lucide-react';

interface BillingEvent {
  id: string;
  event_type: string;
  amount: number;
  currency: string;
  status: string;
  due_at: string;
  effective_at: string;
}

interface Settings {
  business_name: string;
  owner_email: string;
  owner_phone: string;
  currency: string;
  tax_rate: string;
  receipt_footer: string;
  receipt_logo_data_url: string;
  mtn_momo_enabled: boolean;
  mtn_momo_number: string;
  airtel_enabled: boolean;
  airtel_number: string;
  zra_enabled: boolean;
  zra_tpin: string;
}

interface TenantInfo {
  name: string;
  subscription_tier: string;
  status: string;
  max_locations: number;
}

interface Location {
  id: string;
  name: string;
  address: string;
  is_active: boolean;
}

export default function SettingsPage() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');
  
  const [tenant, setTenant] = useState<TenantInfo | null>(null);
  const [billingHistory, setBillingHistory] = useState<BillingEvent[]>([]);
  const [locations, setLocations] = useState<Location[]>([]);
  const [newLocationName, setNewLocationName] = useState('');
  const [newLocationAddress, setNewLocationAddress] = useState('');
  const [addingLocation, setAddingLocation] = useState(false);
  const [logoDragActive, setLogoDragActive] = useState(false);
  const [logoError, setLogoError] = useState('');
  const logoInputRef = useRef<HTMLInputElement | null>(null);

  const [form, setForm] = useState<Settings>({
    business_name: '', owner_email: '', owner_phone: '',
    currency: 'ZMW', tax_rate: '16', receipt_footer: 'Thank you for your business!',
    receipt_logo_data_url: '',
    mtn_momo_enabled: false, mtn_momo_number: '',
    airtel_enabled: false, airtel_number: '',
    zra_enabled: false, zra_tpin: ''
  });

  useEffect(() => {
    Promise.all([
      fetch('/api/settings').then(r => r.json()),
      fetch('/api/locations').then(r => r.json())
    ]).then(([settingsData, locationsData]) => {
      if (settingsData.settings) {
        setForm(f => ({ 
          ...f, 
          ...settingsData.settings, 
          tax_rate: String(settingsData.settings.tax_rate || 16),
          receipt_logo_data_url: settingsData.settings.receipt_logo_data_url || '',
          mtn_momo_number: settingsData.settings.mtn_momo_number || '',
          airtel_number: settingsData.settings.airtel_number || '',
          zra_tpin: settingsData.settings.zra_tpin || ''
        }));
      }
      if (settingsData.tenant) setTenant(settingsData.tenant);
      if (settingsData.billing_history) setBillingHistory(settingsData.billing_history);
      if (Array.isArray(locationsData)) setLocations(locationsData);
      setLoading(false);
    }).catch(() => setLoading(false));
  }, []);

  const handleSave = async () => {
    setSaving(true);
    setError('');
    try {
      const res = await fetch('/api/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form)
      });
      const data = await res.json();
      if (res.ok) { setSaved(true); setTimeout(() => setSaved(false), 3000); }
      else setError(data.error || 'Failed to save settings.');
    } catch (err) {
      setError('Network error occurred.');
    }
    setSaving(false);
  };

  const handleAddLocation = async () => {
    if (!newLocationName) return;
    setAddingLocation(true);
    setError('');
    try {
      const res = await fetch('/api/locations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newLocationName, address: newLocationAddress })
      });
      const data = await res.json();
      if (res.ok) {
        setLocations(prev => [...prev, data.location]);
        setNewLocationName('');
        setNewLocationAddress('');
      } else {
        setError(data.error || 'Failed to add location.');
      }
    } catch (err) {
      setError('Network error occurred.');
    }
    setAddingLocation(false);
  };

  const readLogoFile = (file: File) =>
    new Promise<string>((resolve, reject) => {
      if (!file.type.startsWith('image/')) {
        reject(new Error('Please upload a PNG, JPG, WEBP, or SVG image.'));
        return;
      }

      const maxBytes = 1024 * 1024;
      if (file.size > maxBytes) {
        reject(new Error('Logo must be 1 MB or smaller.'));
        return;
      }

      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ''));
      reader.onerror = () => reject(new Error('Unable to read the logo file.'));
      reader.readAsDataURL(file);
    });

  const handleLogoFile = async (file?: File | null) => {
    if (!file) return;
    setLogoError('');
    try {
      const dataUrl = await readLogoFile(file);
      setForm((f) => ({ ...f, receipt_logo_data_url: dataUrl }));
    } catch (err: any) {
      setLogoError(err?.message || 'Unable to load the logo.');
    }
  };

  const inputStyle = { width: '100%', padding: '10px 14px', background: 'var(--bg-color)', border: '1px solid var(--panel-border)', color: 'var(--text-main)', borderRadius: '8px', fontFamily: 'inherit', fontSize: '14px' };
  const labelStyle = { display: 'block', fontSize: '13px', color: 'var(--text-muted)', marginBottom: '6px', fontWeight: 500 } as const;

  const ToggleSwitch = ({ enabled, onChange, id }: { enabled: boolean; onChange: (v: boolean) => void; id: string }) => (
    <button id={id} onClick={() => onChange(!enabled)} style={{ width: '44px', height: '24px', background: enabled ? 'var(--primary)' : 'var(--panel-border)', borderRadius: '12px', border: 'none', cursor: 'pointer', position: 'relative', flexShrink: 0, transition: 'background 0.2s' }}>
      <div style={{ position: 'absolute', top: '2px', left: enabled ? '22px' : '2px', width: '20px', height: '20px', background: enabled ? '#0f1115' : 'var(--text-muted)', borderRadius: '50%', transition: 'left 0.2s' }} />
    </button>
  );

  if (loading) return (
    <div className="animate-fade-in" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '300px', gap: '8px', color: 'var(--text-muted)' }}>
      <Loader2 size={20} className="spin" /> Loading settings...
    </div>
  );

  return (
    <div className="animate-fade-in" style={{ paddingBottom: '40px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <h1>System Settings</h1>
          <p className="subtitle">Configure your store environment. All changes save directly to the database.</p>
        </div>
        <button onClick={handleSave} disabled={saving} style={{ display: 'flex', alignItems: 'center', gap: '8px', background: 'var(--primary)', color: '#0f1115', border: 'none', padding: '10px 20px', borderRadius: '8px', fontWeight: 600, cursor: saving ? 'not-allowed' : 'pointer', transition: 'all 0.2s', boxShadow: '0 4px 14px rgba(74,222,128,0.2)' }}>
          {saving ? <><Loader2 size={16} className="spin" /> Saving...</> : saved ? <><CheckCircle2 size={16} /> Saved!</> : <><Save size={16} /> Save Changes</>}
        </button>
      </div>

      {error && <div style={{ margin: '16px 0', padding: '12px 16px', background: 'rgba(239,68,68,0.1)', border: '1px solid var(--danger)', borderRadius: '8px', color: 'var(--danger)', fontSize: '14px' }}>{error}</div>}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(400px, 1fr))', gap: '24px', marginTop: '32px' }}>
        
        {/* LEFT COLUMN */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
          
          <div className="glass-panel">
            <h3 style={{ marginBottom: '24px', fontSize: '16px' }}>Business Profile</h3>
            <div style={{ display: 'grid', gap: '16px' }}>
              <div>
                <label style={labelStyle}>Business Name</label>
                <input style={inputStyle} value={form.business_name} onChange={e => setForm(f => ({ ...f, business_name: e.target.value }))} placeholder="Your Store Name" />
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
                <div>
                  <label style={labelStyle}>Owner Email</label>
                  <input style={inputStyle} type="email" value={form.owner_email} onChange={e => setForm(f => ({ ...f, owner_email: e.target.value }))} placeholder="owner@yourstore.com" />
                </div>
                <div>
                  <label style={labelStyle}>Contact Phone</label>
                  <input style={inputStyle} value={form.owner_phone} onChange={e => setForm(f => ({ ...f, owner_phone: e.target.value }))} placeholder="+260 9X XXX XXXX" />
                </div>
              </div>
              <div>
                <label style={labelStyle}>ZRA TPIN</label>
                <input style={inputStyle} value={form.zra_tpin} onChange={e => setForm(f => ({ ...f, zra_tpin: e.target.value }))} placeholder="Enter your 10-digit TPIN" />
              </div>
            </div>
          </div>

          <div className="glass-panel">
            <h3 style={{ marginBottom: '24px', fontSize: '16px' }}>Financial Settings</h3>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
              <div>
                <label style={labelStyle}>Currency</label>
                <select style={inputStyle} value={form.currency} onChange={e => setForm(f => ({ ...f, currency: e.target.value }))}>
                  <option value="ZMW">ZMW — Zambian Kwacha</option>
                  <option value="USD">USD — US Dollar</option>
                  <option value="KES">KES — Kenyan Shilling</option>
                  <option value="ZAR">ZAR — South African Rand</option>
                </select>
              </div>
              <div>
                <label style={labelStyle}>VAT / Tax Rate (%)</label>
                <input style={inputStyle} type="number" step="0.01" min="0" max="100" value={form.tax_rate} onChange={e => setForm(f => ({ ...f, tax_rate: e.target.value }))} />
              </div>
            </div>
          </div>

          {/* BILLING AND SUBSCRIPTION PANEL */}
          <div className="glass-panel">
            <h3 style={{ marginBottom: '24px', fontSize: '16px', display: 'flex', alignItems: 'center', gap: '8px' }}>
              <CreditCard size={18} className="text-secondary" />
              Billing & Subscription
            </h3>
            
            {/* Current Plan Overview */}
            <div style={{ padding: '20px', background: 'var(--hover-bg)', borderRadius: '12px', border: '1px solid var(--panel-border)', marginBottom: '20px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <div style={{ fontSize: '13px', color: 'var(--text-muted)', marginBottom: '4px' }}>Current Plan</div>
                <div style={{ fontWeight: 700, fontSize: '20px', textTransform: 'capitalize', display: 'flex', alignItems: 'center', gap: '8px' }}>
                  {tenant?.subscription_tier?.replace('_', ' ') || 'Unknown'} 
                  {tenant?.status === 'active' ? (
                    <span style={{ fontSize: '12px', background: 'rgba(34, 197, 94, 0.1)', color: '#22c55e', padding: '2px 8px', borderRadius: '12px', display: 'flex', alignItems: 'center', gap: '4px' }}><ShieldCheck size={14}/> Active</span>
                  ) : (
                    <span style={{ fontSize: '12px', background: 'rgba(239, 68, 68, 0.1)', color: '#ef4444', padding: '2px 8px', borderRadius: '12px' }}>{tenant?.status || 'Pending'}</span>
                  )}
                </div>
                <div style={{ fontSize: '13px', color: 'var(--text-muted)', marginTop: '6px' }}>Includes up to {tenant?.max_locations ?? '—'} branch locations.</div>
              </div>
              <div style={{ display: 'flex', gap: '12px' }}>
                <button 
                  onClick={() => window.location.href = 'mailto:billing@retailos.com?subject=Upgrade%20Request'}
                  style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '10px 20px', background: 'var(--primary)', color: 'white', borderRadius: '8px', border: 'none', cursor: 'pointer', fontWeight: 500 }}
                >
                  <Zap size={16} /> Upgrade Plan
                </button>
              </div>
            </div>

            {/* Billing History */}
            <div style={{ marginTop: '24px' }}>
              <h4 style={{ fontSize: '14px', fontWeight: 600, marginBottom: '16px' }}>Payment History</h4>
              
              {billingHistory.length === 0 ? (
                <div style={{ padding: '32px', textAlign: 'center', color: 'var(--text-muted)', background: 'rgba(0,0,0,0.2)', borderRadius: '8px', border: '1px dashed var(--panel-border)' }}>
                  No billing history found.
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  {billingHistory.map(event => (
                    <div key={event.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 16px', background: 'rgba(0,0,0,0.2)', borderRadius: '8px', border: '1px solid var(--panel-border)' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                        <div style={{ width: '36px', height: '36px', borderRadius: '8px', background: 'rgba(96,165,250,0.1)', color: 'var(--secondary)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                          <CreditCard size={18} />
                        </div>
                        <div>
                          <div style={{ fontWeight: 500, fontSize: '14px', textTransform: 'capitalize' }}>{event.event_type.replace(/_/g, ' ')}</div>
                          <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginTop: '2px' }}>
                            {new Date(event.due_at || event.effective_at).toLocaleDateString()}
                          </div>
                        </div>
                      </div>
                      <div style={{ textAlign: 'right' }}>
                        <div style={{ fontWeight: 600 }}>{event.currency} {Number(event.amount).toLocaleString(undefined, { minimumFractionDigits: 2 })}</div>
                        <div style={{ fontSize: '12px', color: event.status === 'paid' ? '#22c55e' : '#f59e0b', textTransform: 'capitalize', marginTop: '2px' }}>
                          {event.status}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          <div className="glass-panel">
            <h3 style={{ marginBottom: '24px', fontSize: '16px' }}>Locations Management</h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              {locations.map(loc => (
                <div key={loc.id} style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '16px', background: 'var(--hover-bg)', borderRadius: '12px', border: '1px solid var(--panel-border)' }}>
                  <div style={{ width: '40px', height: '40px', borderRadius: '8px', background: 'rgba(96,165,250,0.1)', color: 'var(--secondary)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <MapPin size={20} />
                  </div>
                  <div>
                    <div style={{ fontWeight: 600, fontSize: '14px' }}>{loc.name}</div>
                    <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginTop: '2px' }}>{loc.address || 'No address provided'}</div>
                  </div>
                </div>
              ))}

              <div style={{ marginTop: '12px', paddingTop: '20px', borderTop: '1px solid var(--panel-border)' }}>
                <h4 style={{ fontSize: '13px', fontWeight: 500, color: 'var(--text-muted)', marginBottom: '12px' }}>Add New Location</h4>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '12px' }}>
                  <input style={inputStyle} placeholder="Branch Name" value={newLocationName} onChange={e => setNewLocationName(e.target.value)} />
                  <input style={inputStyle} placeholder="Address (optional)" value={newLocationAddress} onChange={e => setNewLocationAddress(e.target.value)} />
                </div>
                <button 
                  onClick={handleAddLocation} 
                  disabled={addingLocation || !newLocationName}
                  style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: '100%', gap: '8px', padding: '10px', background: 'var(--hover-bg)', border: '1px solid var(--panel-border)', color: 'var(--text-main)', borderRadius: '8px', cursor: (addingLocation || !newLocationName) ? 'not-allowed' : 'pointer' }}
                >
                  {addingLocation ? <Loader2 size={16} className="spin" /> : <Plus size={16} />}
                  Register New Location
                </button>
              </div>
            </div>
          </div>

        </div>

        {/* RIGHT COLUMN */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
          
          <div className="glass-panel">
            <h3 style={{ marginBottom: '24px', fontSize: '16px' }}>Payment Integrations</h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              
              {/* MTN MOMO */}
              <div style={{ padding: '16px', background: 'var(--hover-bg)', borderRadius: '12px', border: '1px solid var(--panel-border)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: form.mtn_momo_enabled ? '16px' : '0' }}>
                  <div>
                    <div style={{ fontWeight: 600, fontSize: '14px' }}>MTN Mobile Money</div>
                    <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginTop: '2px' }}>{form.mtn_momo_enabled ? 'Active — accepting payments' : 'Disabled'}</div>
                  </div>
                  <ToggleSwitch id="mtn_enabled" enabled={form.mtn_momo_enabled} onChange={v => setForm(f => ({ ...f, mtn_momo_enabled: v }))} />
                </div>
                {form.mtn_momo_enabled && (
                  <div>
                    <label style={labelStyle}>MTN Receiving Number *</label>
                    <input style={inputStyle} value={form.mtn_momo_number} onChange={e => setForm(f => ({ ...f, mtn_momo_number: e.target.value }))} placeholder="e.g. 096X XXX XXX" />
                  </div>
                )}
              </div>

              {/* AIRTEL MONEY */}
              <div style={{ padding: '16px', background: 'var(--hover-bg)', borderRadius: '12px', border: '1px solid var(--panel-border)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: form.airtel_enabled ? '16px' : '0' }}>
                  <div>
                    <div style={{ fontWeight: 600, fontSize: '14px' }}>Airtel Money</div>
                    <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginTop: '2px' }}>{form.airtel_enabled ? 'Active — accepting payments' : 'Disabled'}</div>
                  </div>
                  <ToggleSwitch id="airtel_enabled" enabled={form.airtel_enabled} onChange={v => setForm(f => ({ ...f, airtel_enabled: v }))} />
                </div>
                {form.airtel_enabled && (
                  <div>
                    <label style={labelStyle}>Airtel Receiving Number *</label>
                    <input style={inputStyle} value={form.airtel_number} onChange={e => setForm(f => ({ ...f, airtel_number: e.target.value }))} placeholder="e.g. 097X XXX XXX" />
                  </div>
                )}
              </div>

              {/* ZRA */}
              <div style={{ padding: '16px', background: 'var(--hover-bg)', borderRadius: '12px', border: '1px solid var(--panel-border)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: form.zra_enabled ? '16px' : '0' }}>
                  <div>
                    <div style={{ fontWeight: 600, fontSize: '14px' }}>ZRA Smart Invoice</div>
                    <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginTop: '2px' }}>{form.zra_enabled ? 'Active — submitting to VSDC' : 'Disabled'}</div>
                  </div>
                  <ToggleSwitch id="zra_enabled" enabled={form.zra_enabled} onChange={v => setForm(f => ({ ...f, zra_enabled: v }))} />
                </div>
                {form.zra_enabled && (
                  <div>
                    <label style={labelStyle}>ZRA TPIN *</label>
                    <input style={inputStyle} value={form.zra_tpin} onChange={e => setForm(f => ({ ...f, zra_tpin: e.target.value }))} placeholder="Your ZRA Taxpayer PIN" />
                  </div>
                )}
              </div>
            </div>
          </div>

          <div className="glass-panel">
            <h3 style={{ marginBottom: '24px', fontSize: '16px' }}>Receipt Design</h3>
            <p style={{ fontSize: '13px', color: 'var(--text-muted)', marginBottom: '16px' }}>Configure what your customers see at the bottom of their thermal receipts.</p>
            
            <label style={labelStyle}>Receipt Logo</label>
            <input
              ref={logoInputRef}
              type="file"
              accept="image/png,image/jpeg,image/jpg,image/webp,image/svg+xml"
              style={{ display: 'none' }}
              onChange={(e) => handleLogoFile(e.target.files?.[0])}
            />
            <div
              onDragEnter={(e) => { e.preventDefault(); setLogoDragActive(true); }}
              onDragOver={(e) => { e.preventDefault(); setLogoDragActive(true); }}
              onDragLeave={(e) => { e.preventDefault(); setLogoDragActive(false); }}
              onDrop={async (e) => {
                e.preventDefault();
                setLogoDragActive(false);
                await handleLogoFile(e.dataTransfer.files?.[0]);
              }}
              onClick={() => logoInputRef.current?.click()}
              style={{
                border: `1.5px dashed ${logoDragActive ? 'var(--primary)' : 'var(--panel-border)'}`,
                borderRadius: '14px',
                padding: '16px',
                background: logoDragActive ? 'rgba(74,222,128,0.08)' : 'var(--hover-bg)',
                cursor: 'pointer',
                marginBottom: '12px',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: '12px', alignItems: 'center', flexWrap: 'wrap' }}>
                <div>
                  <div style={{ fontWeight: 700, marginBottom: '4px' }}>Drag and drop a logo here</div>
                  <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>PNG, JPG, WEBP, or SVG. Max 1 MB. It will print at the top of receipts.</div>
                </div>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    logoInputRef.current?.click();
                  }}
                  style={{ padding: '10px 14px', borderRadius: '10px', border: '1px solid var(--panel-border)', background: 'var(--bg-color)', color: 'var(--text-main)', cursor: 'pointer', fontWeight: 700 }}
                >
                  Upload Logo
                </button>
              </div>
              {form.receipt_logo_data_url && (
                <div style={{ marginTop: '16px', background: '#fff', borderRadius: '12px', padding: '16px', border: '1px solid var(--panel-border)', display: 'grid', placeItems: 'center' }}>
                  <img
                    src={form.receipt_logo_data_url}
                    alt="Receipt logo preview"
                    style={{ maxHeight: '80px', maxWidth: '100%', objectFit: 'contain' }}
                  />
                </div>
              )}
            </div>
            <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', marginBottom: '14px' }}>
              <button
                type="button"
                onClick={() => logoInputRef.current?.click()}
                style={{ padding: '8px 12px', borderRadius: '10px', border: '1px solid var(--panel-border)', background: 'var(--hover-bg)', color: 'var(--text-main)', cursor: 'pointer', fontWeight: 700 }}
              >
                Replace Logo
              </button>
              {form.receipt_logo_data_url && (
                <button
                  type="button"
                  onClick={() => setForm((f) => ({ ...f, receipt_logo_data_url: '' }))}
                  style={{ padding: '8px 12px', borderRadius: '10px', border: '1px solid var(--panel-border)', background: 'transparent', color: 'var(--text-muted)', cursor: 'pointer', fontWeight: 700 }}
                >
                  Remove Logo
                </button>
              )}
            </div>
            {logoError && (
              <div style={{ marginBottom: '14px', padding: '10px 12px', borderRadius: '10px', border: '1px solid rgba(239,68,68,0.25)', background: 'rgba(239,68,68,0.08)', color: 'var(--danger)', fontSize: '13px' }}>
                {logoError}
              </div>
            )}

            <label style={labelStyle}>Receipt Footer Message</label>
            <textarea 
              style={{ ...inputStyle, minHeight: '80px', resize: 'vertical', marginBottom: '24px' } as any} 
              value={form.receipt_footer} 
              onChange={e => setForm(f => ({ ...f, receipt_footer: e.target.value }))} 
              placeholder="Thank you for your business!"
            />

            <div style={{ padding: '24px', background: '#fff', color: '#000', borderRadius: '8px', width: '280px', margin: '0 auto', fontFamily: 'monospace', fontSize: '12px', boxShadow: '0 4px 12px rgba(0,0,0,0.1)' }}>
              {form.receipt_logo_data_url ? (
                <div style={{ display: 'flex', justifyContent: 'center', marginBottom: '10px' }}>
                  <img
                    src={form.receipt_logo_data_url}
                    alt="Receipt logo preview"
                    style={{ maxHeight: '48px', maxWidth: '180px', objectFit: 'contain' }}
                  />
                </div>
              ) : null}
              <div style={{ textAlign: 'center', fontWeight: 'bold', fontSize: '16px', marginBottom: '8px' }}>{form.business_name || 'STORE NAME'}</div>
              <div style={{ textAlign: 'center', marginBottom: '16px' }}>Receipt Preview</div>
              <div style={{ borderTop: '1px dashed #ccc', margin: '8px 0' }} />
              <div style={{ display: 'flex', justifyContent: 'space-between' }}><span>Item 1</span><span>K100.00</span></div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}><span>Item 2</span><span>K50.00</span></div>
              <div style={{ borderTop: '1px dashed #ccc', margin: '8px 0' }} />
              <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 'bold' }}><span>TOTAL</span><span>K150.00</span></div>
              <div style={{ borderTop: '1px dashed #ccc', margin: '8px 0' }} />
              <div style={{ textAlign: 'center', marginTop: '16px', whiteSpace: 'pre-wrap' }}>{form.receipt_footer || 'Thank you for your business!'}</div>
            </div>
          </div>

        </div>
      </div>
    </div>
  );
}
