import { useEffect, useMemo, useRef, useState } from 'react';
import { ScanLine, Package, ShoppingCart, Trash2, CheckCircle2, LogOut, Hexagon, Lock, Plus, Minus, Search, Wifi, WifiOff, RefreshCcw } from 'lucide-react';

interface CatalogItem {
  serial: string;
  variant_id: string;
  name: string;
  category: string | null;
  subtype: string | null;
  color: string | null;
  size: string | null;
  retail_price: number;
  barcode: string;
  display_name: string;
  display_variant: string;
  search_blob: string;
  available_count?: number;
}

interface CartItem {
  id: string;
  variant_id: string;
  serial?: string | null;
  name: string;
  price: number;
  quantity: number;
}

interface SessionUser {
  name: string;
  role: string;
  tenant_name: string;
  location_name: string | null;
}

const API = '';

function normalize(value: unknown) {
  return String(value ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
}

export default function App() {
  const [session, setSession] = useState<SessionUser | null>(null);
  const [loginError, setLoginError] = useState('');
  const [loginLoading, setLoginLoading] = useState(false);
  const [pinEntry, setPinEntry] = useState('');
  const [emailEntry, setEmailEntry] = useState('');
  const [showEmailField, setShowEmailField] = useState(false);

  const [catalog, setCatalog] = useState<CatalogItem[]>([]);
  const [catalogError, setCatalogError] = useState('');
  const [cart, setCart] = useState<CartItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [receipt, setReceipt] = useState<{ number: string; total: number } | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [scanValue, setScanValue] = useState('');
  const scanInputRef = useRef<HTMLInputElement>(null);

  const [offlineQueue, setOfflineQueue] = useState<any[]>(() => {
    try {
      const stored = localStorage.getItem('pos_offline_queue');
      return stored ? JSON.parse(stored) : [];
    } catch { return []; }
  });
  const [isOnline, setIsOnline] = useState(navigator.onLine);

  useEffect(() => {
    localStorage.setItem('pos_offline_queue', JSON.stringify(offlineQueue));
  }, [offlineQueue]);

  useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  useEffect(() => {
    if (offlineQueue.length === 0 || !isOnline) return;

    const syncQueue = async () => {
      try {
        const item = offlineQueue[0];
        const res = await fetch(`${API}/api/pos`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify(item.payload),
        });
        if (res.ok) {
          setOfflineQueue(q => q.slice(1));
        } else {
          console.error('Offline sync failed permanently, removing item to prevent blocking queue.');
          setOfflineQueue(q => q.slice(1));
        }
      } catch (err) {
        // Still offline or network error, leave in queue
      }
    };

    const interval = setInterval(syncQueue, 3000);
    return () => clearInterval(interval);
  }, [offlineQueue, isOnline]);

  useEffect(() => {
    const name = getCookie('staff_name');
    const role = getCookie('staff_role');
    const tenant = getCookie('tenant_name');
    const location = getCookie('location_name');
    if (name && role && tenant) {
      setSession({ name, role, tenant_name: tenant, location_name: location });
    }
  }, []);

  useEffect(() => {
    if (!session) return;
    const loadCatalog = async () => {
      try {
        setCatalogError('');
        const res = await fetch(`${API}/api/pos/catalog`, {
          credentials: 'include',
          cache: 'no-store',
        });
        const data = await res.json();
        if (!res.ok) {
          setCatalog([]);
          setCatalogError(data.error || 'Unable to load products');
          return;
        }
        setCatalog(Array.isArray(data) ? data : []);
      } catch {
        setCatalog([]);
        setCatalogError('Unable to connect to the product catalog');
      }
    };

    loadCatalog();
    window.setTimeout(() => scanInputRef.current?.focus(), 50);
  }, [session]);

  const getCookie = (name: string) => {
    const match = document.cookie.match(new RegExp('(^| )' + name + '=([^;]+)'));
    return match ? decodeURIComponent(match[2]) : '';
  };

  const handleLogin = async () => {
    if (pinEntry.length !== 4) {
      setLoginError('PIN must be 4 digits');
      return;
    }
    setLoginLoading(true);
    setLoginError('');
    try {
      const body: any = { pin: pinEntry };
      if (emailEntry.trim()) body.email = emailEntry.trim();

      const res = await fetch(`${API}/api/pos/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (res.ok) {
        setSession(data.user);
        setPinEntry('');
        setEmailEntry('');
      } else {
        setLoginError(data.error || 'Invalid credentials');
        setPinEntry('');
      }
    } catch {
      setLoginError('Cannot connect to server');
    }
    setLoginLoading(false);
  };

  const handleLogout = async () => {
    await fetch(`${API}/api/pos/login`, { method: 'DELETE', credentials: 'include' });
    setSession(null);
    setCart([]);
    setCatalog([]);
    setCatalogError('');
    setPinEntry('');
    setSearchQuery('');
    setScanValue('');
  };

  const addToCart = (item: CatalogItem) => {
    setCart((prev) => {
      const existing = prev.find((entry) => entry.serial && entry.serial === item.serial);
      if (existing) return prev;

      return [
        ...prev,
        {
          id: Math.random().toString(36).substr(2, 9),
          variant_id: item.variant_id,
          serial: item.serial,
          name: item.display_name || item.name,
          price: item.retail_price,
          quantity: 1,
        },
      ];
    });
  };

  const adjustQty = (id: string, delta: number) => {
    setCart((prev) =>
      prev.map((item) =>
        item.id === id
          ? {
              ...item,
              quantity: item.serial ? 1 : Math.max(1, item.quantity + delta),
            }
          : item
      )
    );
  };

  const removeFromCart = (id: string) => setCart((prev) => prev.filter((item) => item.id !== id));

  const total = cart.reduce((sum, item) => sum + item.price * item.quantity, 0);

  const checkout = async (method: 'CASH' | 'MOBILE_MONEY') => {
    if (cart.length === 0) return;
    setLoading(true);

    const payload = {
      cart: cart.map((item) => ({
        variant_id: item.variant_id,
        serial: item.serial || null,
        name: item.name,
        price: item.price,
        quantity: item.quantity,
      })),
      method,
      offlineId: Math.random().toString(36).substring(2, 9).toUpperCase(),
      timestamp: Date.now()
    };

    try {
      if (!isOnline) throw new Error('Offline Mode');

      const res = await fetch(`${API}/api/pos`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (data.success) {
        setReceipt({ number: data.receipt, total: data.total });
        setCart([]);
        setTimeout(() => setReceipt(null), 6000);
      } else {
        alert(data.error || 'Checkout failed');
      }
    } catch (e: any) {
      console.log('Network error, saving to offline queue', e);
      setOfflineQueue(prev => [...prev, { payload }]);
      setReceipt({ number: `OFFLINE-${payload.offlineId}`, total });
      setCart([]);
      setTimeout(() => setReceipt(null), 6000);
    }
    setLoading(false);
  };

  // total calculated above

  const filteredCatalog = useMemo(() => {
    const query = normalize(searchQuery || scanValue);
    const base = [...catalog];

    if (!query) {
      return base.sort((a, b) => a.display_name.localeCompare(b.display_name));
    }

    const ranked = base
      .filter((item) => {
        const haystack = normalize([
          item.serial,
          item.barcode,
          item.name,
          item.display_name,
          item.display_variant,
          item.category,
          item.subtype,
          item.color,
          item.size,
          item.search_blob,
          item.retail_price,
        ].filter(Boolean).join(' '));
        return haystack.includes(query);
      })
      .sort((a, b) => {
        const aExact = [a.serial, a.barcode].some((value) => normalize(value) === query) ? 0 : 1;
        const bExact = [b.serial, b.barcode].some((value) => normalize(value) === query) ? 0 : 1;
        if (aExact !== bExact) return aExact - bExact;
        return a.display_name.localeCompare(b.display_name);
      });

    return ranked;
  }, [catalog, searchQuery, scanValue]);

  const handleScanEnter = () => {
    const query = normalize(scanValue);
    if (!query) return;
    const exact = catalog.find((item) => normalize(item.serial) === query || normalize(item.barcode) === query);
    const fallback = exact || filteredCatalog[0];
    if (fallback) {
      addToCart(fallback);
      setScanValue('');
      if (scanInputRef.current) scanInputRef.current.value = '';
    } else {
      setCatalogError(`No item matched "${scanValue}"`);
    }
  };

  if (!session) {
    const pinDots = Array.from({ length: 4 }, (_, i) => pinEntry[i] !== undefined);
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--bg-color)', fontFamily: 'Outfit, sans-serif', padding: '20px' }}>
        <div style={{ width: '100%', maxWidth: '360px' }}>
          <div style={{ textAlign: 'center', marginBottom: '32px' }}>
            <div style={{ display: 'inline-flex', alignItems: 'center', gap: '10px', marginBottom: '8px' }}>
              <Hexagon size={28} color="var(--primary)" />
              <span style={{ fontSize: '22px', fontWeight: 700, color: 'var(--text-main)' }}>Retail OS</span>
            </div>
            <p style={{ color: 'var(--text-muted)', fontSize: '14px' }}>Cashier Point of Sale</p>
          </div>

          <div className="glass-panel" style={{ padding: '32px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '24px', justifyContent: 'center' }}>
              <Lock size={16} color="var(--text-muted)" />
              <span style={{ color: 'var(--text-muted)', fontSize: '14px' }}>Enter your shift PIN</span>
            </div>

            <div style={{ display: 'flex', justifyContent: 'center', gap: '12px', marginBottom: '28px' }}>
              {pinDots.map((filled, i) => (
                <div key={i} style={{ width: '18px', height: '18px', borderRadius: '50%', background: filled ? 'var(--primary)' : 'transparent', border: '2px solid ' + (filled ? 'var(--primary)' : 'var(--panel-border)'), transition: 'all 0.15s' }} />
              ))}
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '10px', marginBottom: '16px' }}>
              {[1, 2, 3, 4, 5, 6, 7, 8, 9, '', 0, '⌫'].map((k, i) => (
                <button
                  key={i}
                  onClick={() => {
                    if (k === '⌫') setPinEntry((p) => p.slice(0, -1));
                    else if (k !== '' && pinEntry.length < 4) setPinEntry((p) => p + String(k));
                  }}
                  style={{ padding: '16px', fontSize: '20px', fontWeight: 600, background: k === '' ? 'transparent' : 'var(--hover-bg)', border: '1px solid ' + (k === '' ? 'transparent' : 'var(--panel-border)'), color: 'var(--text-main)', borderRadius: '10px', cursor: k === '' ? 'default' : 'pointer', fontFamily: 'Outfit, sans-serif', transition: 'background 0.1s' }}
                >
                  {k}
                </button>
              ))}
            </div>

            {loginError && <div style={{ color: 'var(--danger)', fontSize: '13px', textAlign: 'center', marginBottom: '12px' }}>{loginError}</div>}

            {showEmailField && (
              <input
                type="email"
                placeholder="Your email (if first login)"
                value={emailEntry}
                onChange={(e) => setEmailEntry(e.target.value)}
                style={{ width: '100%', padding: '10px 14px', background: 'var(--bg-color)', border: '1px solid var(--panel-border)', color: 'var(--text-main)', borderRadius: '8px', fontFamily: 'Outfit, sans-serif', fontSize: '14px', marginBottom: '12px' }}
              />
            )}

            <button
              onClick={handleLogin}
              disabled={loginLoading || pinEntry.length < 4}
              style={{ width: '100%', padding: '14px', background: pinEntry.length === 4 ? 'var(--primary)' : 'var(--hover-bg)', color: pinEntry.length === 4 ? '#0f1115' : 'var(--text-muted)', border: 'none', borderRadius: '10px', fontWeight: 700, fontSize: '16px', cursor: pinEntry.length < 4 ? 'not-allowed' : 'pointer', transition: 'all 0.2s', fontFamily: 'Outfit, sans-serif' }}
            >
              {loginLoading ? 'Verifying...' : 'Start Shift'}
            </button>

            <div style={{ textAlign: 'center', marginTop: '16px' }}>
              <button onClick={() => setShowEmailField((v) => !v)} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', fontSize: '12px', cursor: 'pointer', textDecoration: 'underline' }}>
                {showEmailField ? 'Hide email field' : 'First time on this device? Enter email too'}
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="pos-layout">
      <div className="catalog-panel">
        <div className="catalog-header">
          <div>
            <h1 style={{ fontSize: '24px', fontWeight: 700, color: 'var(--text-main)', marginBottom: '2px' }}>Cashier Desk</h1>
            <p style={{ color: 'var(--text-muted)', fontSize: '13px' }}>{session.tenant_name} {session.location_name ? `· ${session.location_name}` : ''}</p>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <div style={{ display: 'flex', gap: '8px', alignItems: 'center', marginRight: '16px' }}>
              {!isOnline && (
                <div style={{ display: 'flex', alignItems: 'center', gap: '4px', background: 'rgba(239, 68, 68, 0.1)', color: '#ef4444', padding: '4px 10px', borderRadius: '12px', fontSize: '12px', fontWeight: 600 }}>
                  <WifiOff size={14} /> Offline Mode
                </div>
              )}
              {offlineQueue.length > 0 && (
                <div style={{ display: 'flex', alignItems: 'center', gap: '4px', background: 'rgba(245, 158, 11, 0.1)', color: '#f59e0b', padding: '4px 10px', borderRadius: '12px', fontSize: '12px', fontWeight: 600 }}>
                  <RefreshCcw size={14} className={isOnline ? "spin" : ""} /> {offlineQueue.length} Pending
                </div>
              )}
            </div>
            <div style={{ textAlign: 'right' }}>
              <div style={{ fontWeight: 600, fontSize: '14px', color: 'var(--text-main)' }}>{session.name}</div>
              <div style={{ fontSize: '12px', color: 'var(--text-muted)', textTransform: 'capitalize' }}>{session.role.replace('_', ' ')}</div>
            </div>
            <button onClick={handleLogout} title="End Shift" style={{ background: 'var(--hover-bg)', border: '1px solid var(--panel-border)', color: 'var(--danger)', borderRadius: '8px', padding: '8px', cursor: 'pointer', display: 'flex', alignItems: 'center' }}>
              <LogOut size={16} />
            </button>
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: '12px', marginBottom: '14px' }}>
          <div className="scanner-input">
            <ScanLine color="var(--primary)" />
            <input
              ref={scanInputRef}
              value={scanValue}
              type="text"
              placeholder="Scan code, barcode, color, or description..."
              onChange={(e) => setScanValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  handleScanEnter();
                }
              }}
              onBlur={(e) => setTimeout(() => e.target.focus(), 100)}
            />
          </div>
          <button
            onClick={handleScanEnter}
            style={{ padding: '12px 14px', borderRadius: '10px', border: '1px solid var(--panel-border)', background: 'var(--hover-bg)', color: 'var(--text-main)', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: '8px', fontWeight: 700 }}
          >
            <Package size={16} />
            Add Exact
          </button>
        </div>

        <div style={{ marginBottom: '16px' }}>
          <div style={{ position: 'relative' }}>
            <Search size={16} style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
            <input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search all items by color, description, code, or price..."
              style={{ width: '100%', padding: '12px 14px 12px 38px', borderRadius: '10px', border: '1px solid var(--panel-border)', background: 'var(--bg-color)', color: 'var(--text-main)' }}
            />
          </div>
          <div style={{ marginTop: '8px', color: 'var(--text-muted)', fontSize: '12px' }}>
            Exact code matches win first. Broad searches return matching items across the full catalog.
          </div>
        </div>

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
          <h3 style={{ fontSize: '16px', fontWeight: 600 }}>Products ({filteredCatalog.length})</h3>
          {catalogError && <span style={{ color: 'var(--warning)', fontSize: '12px' }}>{catalogError}</span>}
        </div>

        <div className="grid-catalog">
          {filteredCatalog.map((item) => (
            <div key={item.serial} className="product-card" onClick={() => addToCart(item)}>
              <div className="product-icon"><Package size={22} /></div>
              <div style={{ marginTop: '12px' }}>
                <div style={{ fontWeight: 600, fontSize: '14px', lineHeight: 1.3, marginBottom: '4px' }}>{item.display_name}</div>
                <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginBottom: '4px' }}>{item.display_variant}</div>
                <div style={{ color: 'var(--primary)', fontWeight: 700 }}>K{Number(item.retail_price).toFixed(2)}</div>
                <div style={{ marginTop: '6px', fontSize: '11px', color: 'var(--text-muted)' }}>{item.serial}</div>
              </div>
            </div>
          ))}

          {filteredCatalog.length === 0 && (
            <div style={{ gridColumn: '1 / -1', textAlign: 'center', color: 'var(--text-muted)', padding: '40px' }}>
              {catalogError || 'No matching items found.'}
            </div>
          )}
        </div>
      </div>

      <div className="cart-panel">
        <div className="cart-header">
          <ShoppingCart size={22} />
          <h2 style={{ fontSize: '20px', fontWeight: 700 }}>Current Sale</h2>
        </div>

        <div className="cart-items">
          {cart.length === 0 ? (
            <div style={{ textAlign: 'center', color: 'var(--text-muted)', marginTop: '40px', fontSize: '14px' }}>Cart is empty - scan or tap an item to add it</div>
          ) : cart.map((item) => (
            <div key={item.id} className="cart-item">
              <div className="cart-item-info">
                <span className="cart-item-title">{item.name}</span>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '4px' }}>
                  <button
                    onClick={() => adjustQty(item.id, -1)}
                    disabled={Boolean(item.serial)}
                    style={{ background: 'var(--hover-bg)', border: '1px solid var(--panel-border)', color: 'var(--text-main)', width: '24px', height: '24px', borderRadius: '6px', cursor: item.serial ? 'not-allowed' : 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', opacity: item.serial ? 0.5 : 1 }}
                  >
                    <Minus size={12} />
                  </button>
                  <span style={{ fontSize: '14px', fontWeight: 600, minWidth: '20px', textAlign: 'center' }}>{item.quantity}</span>
                  <button
                    onClick={() => adjustQty(item.id, 1)}
                    disabled={Boolean(item.serial)}
                    style={{ background: 'var(--hover-bg)', border: '1px solid var(--panel-border)', color: 'var(--text-main)', width: '24px', height: '24px', borderRadius: '6px', cursor: item.serial ? 'not-allowed' : 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', opacity: item.serial ? 0.5 : 1 }}
                  >
                    <Plus size={12} />
                  </button>
                  <span className="cart-item-meta">× K{Number(item.price).toFixed(2)}</span>
                </div>
                {item.serial && <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '4px' }}>Code: {item.serial}</div>}
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                <span className="cart-item-price">K{(item.price * item.quantity).toFixed(2)}</span>
                <button onClick={() => removeFromCart(item.id)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--danger)' }}><Trash2 size={16} /></button>
              </div>
            </div>
          ))}
        </div>

        <div className="checkout-section">
          {receipt && (
            <div style={{ background: 'rgba(16,185,129,0.1)', border: '1px solid var(--primary)', padding: '12px', borderRadius: '8px', marginBottom: '16px', color: 'var(--primary)', display: 'flex', alignItems: 'center', gap: '8px', fontSize: '14px' }}>
              <CheckCircle2 size={18} />
              <div>
                <div style={{ fontWeight: 700 }}>Sale Complete!</div>
                <div style={{ fontSize: '12px' }}>Receipt: {receipt.number} · Total: K{Number(receipt.total).toFixed(2)}</div>
              </div>
            </div>
          )}

          <div className="checkout-totals">
            <span style={{ fontSize: '18px', fontWeight: 600 }}>Total</span>
            <h2>K{total.toFixed(2)}</h2>
          </div>

          <div className="checkout-buttons">
            <button className="btn-checkout btn-cash" onClick={() => checkout('CASH')} disabled={loading || cart.length === 0}>
              {loading ? 'Processing...' : 'CASH'}
            </button>
            <button className="btn-checkout btn-momo" onClick={() => checkout('MOBILE_MONEY')} disabled={loading || cart.length === 0}>
              {loading ? '...' : 'MOBILE MONEY'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
