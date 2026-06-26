import React, { useState, useEffect } from 'react';
import { Hexagon, Building2, ScanLine, CheckCircle2, AlertCircle, XCircle, X, Lock, LogOut, Loader } from 'lucide-react';
import { Html5Qrcode } from 'html5-qrcode';

type ItemStatus = 'matched' | 'missing' | 'unexpected';

interface ScannedItem { serial: string; name: string; status: ItemStatus; }
interface ExpectedItem { serial: string; name: string; status: string; }
interface SessionUser { name: string; role: string; tenant_name: string; location_name: string | null; }

const API = '';

function getCookie(name: string) {
  const m = document.cookie.match(new RegExp('(^| )' + name + '=([^;]+)'));
  return m ? decodeURIComponent(m[2]) : '';
}

function App() {
  // ── Auth state
  const [session, setSession] = useState<SessionUser | null>(null);
  const [pin, setPin] = useState('');
  const [email, setEmail] = useState('');
  const [showEmail, setShowEmail] = useState(false);
  const [authError, setAuthError] = useState('');
  const [authLoading, setAuthLoading] = useState(false);

  // ── Stocktake state
  const [expectedStock, setExpectedStock] = useState<ExpectedItem[]>([]);
  const [stockLoading, setStockLoading] = useState(true);
  const [isScanning, setIsScanning] = useState(false);
  const [scannedItems, setScannedItems] = useState<ScannedItem[]>([]);
  const [scanner, setScanner] = useState<Html5Qrcode | null>(null);

  // Check for existing session on mount
  useEffect(() => {
    const name = getCookie('staff_name');
    const role = getCookie('staff_role');
    const tenant = getCookie('tenant_name');
    const location = getCookie('location_name');
    if (name && role && tenant) {
      setSession({ name, role, tenant_name: tenant, location_name: location });
    }
  }, []);

  // Load stock list when logged in
  useEffect(() => {
    if (!session) return;
    setStockLoading(true);
    fetch(`${API}/api/stocktake`, { credentials: 'include' })
      .then(r => r.json())
      .then(data => { setExpectedStock(Array.isArray(data) ? data : []); setStockLoading(false); })
      .catch(() => setStockLoading(false));
  }, [session]);

  const handleLogin = async () => {
    if (pin.length !== 4) { setAuthError('PIN must be 4 digits'); return; }
    setAuthLoading(true);
    setAuthError('');
    try {
      const body: any = { pin };
      if (email.trim()) body.email = email.trim();
      const res = await fetch(`${API}/api/pos/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (res.ok) { setSession(data.user); setPin(''); setEmail(''); }
      else { setAuthError(data.error || 'Invalid credentials'); setPin(''); }
    } catch { setAuthError('Cannot connect to server'); }
    setAuthLoading(false);
  };

  const handleLogout = async () => {
    await fetch(`${API}/api/pos/login`, { method: 'DELETE', credentials: 'include' });
    setSession(null);
    setExpectedStock([]);
    setScannedItems([]);
    setPin('');
  };

  // Scan logic
  const handleScan = (decodedText: string) => {
    if (scannedItems.some(i => i.serial === decodedText)) return;
    const expected = expectedStock.find(i => i.serial === decodedText);
    setScannedItems(prev => [{ serial: decodedText, name: expected?.name || 'Unknown Item', status: expected ? 'matched' : 'unexpected' }, ...prev]);
    if (window.navigator?.vibrate) window.navigator.vibrate(50);
  };

  const startScanner = async () => {
    setIsScanning(true);
    const qr = new Html5Qrcode('reader');
    setScanner(qr);
    try {
      await qr.start({ facingMode: 'environment' }, { fps: 10, qrbox: { width: 250, height: 250 } },
        (text) => { handleScan(text); stopScanner(qr); },
        () => {}
      );
    } catch { setIsScanning(false); }
  };

  const stopScanner = async (inst: Html5Qrcode | null = scanner) => {
    if (inst) { try { await inst.stop(); inst.clear(); } catch {} }
    setIsScanning(false);
  };

  const totalExpected = expectedStock.length;
  const matched    = scannedItems.filter(i => i.status === 'matched').length;
  const unexpected = scannedItems.filter(i => i.status === 'unexpected').length;
  const missing    = expectedStock.filter(e => !scannedItems.some(s => s.serial === e.serial)).length;

  const displayList = [
    ...scannedItems,
    ...expectedStock
      .filter(e => !scannedItems.some(s => s.serial === e.serial))
      .map(e => ({ serial: e.serial, name: e.name, status: 'missing' as ItemStatus })),
  ];

  // ── LOGIN SCREEN ──
  if (!session) {
    const dots = Array.from({ length: 4 }, (_, i) => pin[i] !== undefined);
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--bg-color)', fontFamily: 'Outfit, sans-serif', padding: '20px' }}>
        <div style={{ width: '100%', maxWidth: '340px' }}>
          <div style={{ textAlign: 'center', marginBottom: '28px' }}>
            <div style={{ display: 'inline-flex', alignItems: 'center', gap: '10px', marginBottom: '6px' }}>
              <Hexagon size={26} color="var(--primary)" />
              <span style={{ fontSize: '20px', fontWeight: 700, color: 'var(--text-main)' }}>Retail OS</span>
            </div>
            <p style={{ color: 'var(--text-muted)', fontSize: '13px' }}>Stocktake Mobile App</p>
          </div>

          <div className="glass-panel" style={{ padding: '28px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '20px', justifyContent: 'center' }}>
              <Lock size={14} color="var(--text-muted)" />
              <span style={{ color: 'var(--text-muted)', fontSize: '13px' }}>Enter your staff PIN</span>
            </div>

            <div style={{ display: 'flex', justifyContent: 'center', gap: '12px', marginBottom: '24px' }}>
              {dots.map((filled, i) => (
                <div key={i} style={{ width: '16px', height: '16px', borderRadius: '50%', background: filled ? 'var(--primary)' : 'transparent', border: '2px solid ' + (filled ? 'var(--primary)' : 'var(--panel-border)'), transition: 'all 0.15s' }} />
              ))}
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '8px', marginBottom: '14px' }}>
              {[1,2,3,4,5,6,7,8,9,'',0,'⌫'].map((k, i) => (
                <button key={i} onClick={() => {
                  if (k === '⌫') setPin(p => p.slice(0, -1));
                  else if (k !== '' && pin.length < 4) setPin(p => p + String(k));
                }} style={{ padding: '14px', fontSize: '18px', fontWeight: 600, background: k === '' ? 'transparent' : 'var(--hover-bg)', border: '1px solid ' + (k === '' ? 'transparent' : 'var(--panel-border)'), color: 'var(--text-main)', borderRadius: '10px', cursor: k === '' ? 'default' : 'pointer', fontFamily: 'Outfit, sans-serif' }}>
                  {k}
                </button>
              ))}
            </div>

            {authError && <div style={{ color: 'var(--danger)', fontSize: '12px', textAlign: 'center', marginBottom: '10px' }}>{authError}</div>}

            {showEmail && (
              <input type="email" placeholder="Email (first login on this device)" value={email} onChange={e => setEmail(e.target.value)}
                style={{ width: '100%', padding: '10px 12px', background: 'var(--bg-color)', border: '1px solid var(--panel-border)', color: 'var(--text-main)', borderRadius: '8px', fontFamily: 'Outfit', fontSize: '13px', marginBottom: '10px' }} />
            )}

            <button onClick={handleLogin} disabled={authLoading || pin.length < 4}
              style={{ width: '100%', padding: '13px', background: pin.length === 4 ? 'var(--primary)' : 'var(--hover-bg)', color: pin.length === 4 ? '#0f1115' : 'var(--text-muted)', border: 'none', borderRadius: '10px', fontWeight: 700, fontSize: '15px', cursor: pin.length < 4 ? 'not-allowed' : 'pointer', fontFamily: 'Outfit', transition: 'all 0.2s' }}>
              {authLoading ? 'Verifying...' : 'Login'}
            </button>

            <div style={{ textAlign: 'center', marginTop: '12px' }}>
              <button onClick={() => setShowEmail(v => !v)} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', fontSize: '11px', cursor: 'pointer', textDecoration: 'underline' }}>
                {showEmail ? 'Hide email' : 'First login? Enter email too'}
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ── STOCKTAKE SCREEN ──
  return (
    <div className="app-container">
      <header className="header">
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <Hexagon color="var(--primary)" size={22} />
          <h1 style={{ fontSize: '18px' }}>Stocktake</h1>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <div className="tenant-badge">
            <Building2 size={13} color="var(--primary)" />
            {session.location_name || session.tenant_name}
          </div>
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-main)' }}>{session.name}</div>
          </div>
          <button onClick={handleLogout} title="End Session" style={{ background: 'var(--hover-bg)', border: '1px solid var(--panel-border)', color: 'var(--danger)', borderRadius: '8px', padding: '6px', cursor: 'pointer', display: 'flex' }}>
            <LogOut size={14} />
          </button>
        </div>
      </header>

      {stockLoading ? (
        <div style={{ textAlign: 'center', padding: '60px', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}>
          <Loader size={18} /> Loading stock list...
        </div>
      ) : (
        <>
          <div className="metrics-row">
            <div className="glass-panel metric-card" style={{ borderColor: 'rgba(74,222,128,0.3)' }}>
              <div className="metric-value" style={{ color: 'var(--primary)' }}>{matched}</div>
              <div className="metric-label">Matched</div>
            </div>
            <div className="glass-panel metric-card" style={{ borderColor: 'rgba(239,68,68,0.3)' }}>
              <div className="metric-value" style={{ color: 'var(--danger)' }}>{missing}</div>
              <div className="metric-label">Missing</div>
            </div>
            <div className="glass-panel metric-card" style={{ borderColor: 'rgba(245,158,11,0.3)' }}>
              <div className="metric-value" style={{ color: 'var(--warning)' }}>{unexpected}</div>
              <div className="metric-label">Extra</div>
            </div>
          </div>

          <div style={{ marginBottom: '12px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <h2 style={{ fontSize: '16px', fontWeight: 600 }}>Audit List</h2>
            <span className="subtitle">{matched} / {totalExpected} Scanned</span>
          </div>

          {totalExpected === 0 ? (
            <div style={{ textAlign: 'center', padding: '40px 20px', color: 'var(--text-muted)' }}>
              <p style={{ fontWeight: 600, marginBottom: '8px' }}>No stock to audit</p>
              <p style={{ fontSize: '13px' }}>This store has no inventory records yet. Add stock from the Owner Dashboard first.</p>
            </div>
          ) : (
            <div className="scan-list">
              {displayList.map((item, idx) => (
                <div key={idx} className={`scan-item status-${item.status}`}>
                  <div>
                    <div style={{ fontWeight: 600, fontSize: '14px' }}>{item.name}</div>
                    <div className="item-serial">{item.serial}</div>
                  </div>
                  <div>
                    {item.status === 'matched'    && <CheckCircle2 color="var(--primary)" size={18} />}
                    {item.status === 'missing'    && <XCircle color="var(--danger)" size={18} />}
                    {item.status === 'unexpected' && <AlertCircle color="var(--warning)" size={18} />}
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      <div className="scan-fab-container">
        <button className="scan-fab" onClick={startScanner} disabled={isScanning}>
          <ScanLine size={26} strokeWidth={2.5} />
        </button>
      </div>

      {isScanning && (
        <div className="camera-overlay">
          <div className="camera-header">
            <h2 style={{ color: '#fff', fontSize: '17px' }}>Scan Barcode</h2>
            <button onClick={() => stopScanner()} style={{ background: 'none', border: 'none', color: '#fff', cursor: 'pointer' }}>
              <X size={26} />
            </button>
          </div>
          <div id="reader" />
          <div style={{ position: 'absolute', bottom: '36px', left: 0, right: 0, textAlign: 'center' }}>
            <div style={{ display: 'inline-block', background: 'rgba(0,0,0,0.6)', padding: '10px 20px', borderRadius: '20px', color: '#fff', backdropFilter: 'blur(8px)', fontSize: '14px' }}>
              Align barcode within the frame
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
