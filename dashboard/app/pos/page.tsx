'use client';
import { useState, useEffect, useRef } from 'react';
import { ScanLine, Package, ShoppingCart, Trash2, CheckCircle2, LogOut, Hexagon, Plus, Minus, Clock, Sun, Moon, ReceiptText, RotateCcw, Tag } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useTheme } from '@/components/ThemeProvider';
import ReceiptPrint, { ReceiptData } from '@/components/ReceiptPrint';

interface Variant {
  id: string;
  variant_id?: string;
  name: string;
  category: string | null;
  subtype: string | null;
  color: string | null;
  size: string | null;
  retail_price: number;
  discount_percent?: number;
  barcode_token?: string | null;
  search_text?: string | null;
  available_count?: number;
  display_name?: string;
  display_variant?: string;
  barcode?: string | null;
}
interface CartItem { id: string; variant_id: string; name: string; size: string | null; color: string | null; price: number; quantity: number; discount_percent: number; }
interface Session { staffName: string; staffRole: string; tenantName: string; locationName: string; }
interface LocationOption { id: string; name: string; }
interface ReturnLookupItem {
  id: string;
  garment_serial: string | null;
  variant_id: string;
  description: string | null;
  quantity: number;
  unit_price: number;
  discount_percent: number;
  discount_amount: number;
  total_price: number;
  variant_name: string | null;
  color: string | null;
  size: string | null;
  returned_quantity: number;
  returnable_quantity: number;
}

function getCookie(name: string) {
  if (typeof document === 'undefined') return '';
  const m = document.cookie.match(new RegExp('(^| )' + name + '=([^;]+)'));
  return m ? decodeURIComponent(m[2]) : '';
}

export default function POSPage() {
  const router = useRouter();
  const { theme, toggleTheme } = useTheme();

  // Defer cookie reads to client — fixes hydration mismatch
  const [session, setSession] = useState<Session>({ staffName: '', staffRole: '', tenantName: '', locationName: '' });
  const [mounted, setMounted] = useState(false);

  const [catalog, setCatalog] = useState<Variant[]>([]);
  const [cart, setCart] = useState<CartItem[]>([]);
  const [processing, setProcessing] = useState(false);
  const [receipt, setReceipt] = useState<ReceiptData | null>(null);
  const [receiptFooter, setReceiptFooter] = useState('Thank you for your business!');
  const [amountTenderedStr, setAmountTenderedStr] = useState('');
  const [customerEmail, setCustomerEmail] = useState('');
  const [shiftTime, setShiftTime] = useState('00:00:00');
  const [locations, setLocations] = useState<LocationOption[]>([]);
  const [selectedLocationId, setSelectedLocationId] = useState('');
  const [returnReceiptNo, setReturnReceiptNo] = useState('');
  const [returnReason, setReturnReason] = useState('');
  const [returnRefundMethod, setReturnRefundMethod] = useState<'CASH' | 'MOBILE_MONEY' | 'STORE_CREDIT' | 'VOID'>('CASH');
  const [returnLookupLoading, setReturnLookupLoading] = useState(false);
  const [returnProcessing, setReturnProcessing] = useState(false);
  const [returnLookup, setReturnLookup] = useState<{ transaction: any; items: ReturnLookupItem[] } | null>(null);
  const [selectedReturnItems, setSelectedReturnItems] = useState<Record<string, number>>({});
  const [searchTerm, setSearchTerm] = useState('');
  const scanRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    // Read cookies only on client
    setSession({
      staffName:    getCookie('staff_name'),
      staffRole:    getCookie('staff_role'),
      tenantName:   getCookie('tenant_name'),
      locationName: getCookie('location_name'),
    });
    setSelectedLocationId(getCookie('location_id'));
    setMounted(true);

    if (scanRef.current) scanRef.current.focus();

    const start = Date.now();
    const t = setInterval(() => {
      const e = Math.floor((Date.now() - start) / 1000);
      setShiftTime(
        `${String(Math.floor(e / 3600)).padStart(2, '0')}:${String(Math.floor((e % 3600) / 60)).padStart(2, '0')}:${String(e % 60).padStart(2, '0')}`
      );
    }, 1000);
    return () => {
      clearInterval(t);
    };
  }, []);

  useEffect(() => {
    fetch('/api/locations')
      .then((r) => r.json())
      .then((data) => {
        const nextLocations = Array.isArray(data) ? data : [];
        setLocations(nextLocations);
        setSelectedLocationId((current) => current || nextLocations[0]?.id || '');
      })
      .catch((err) => console.error(err));
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      const params = new URLSearchParams();
      const search = searchTerm.trim();
      if (search) params.set('q', search);
      if (selectedLocationId) params.set('location_id', selectedLocationId);
      const qs = params.toString() ? `?${params.toString()}` : '';
      fetch(`/api/pos/catalog${qs}`, { signal: controller.signal })
        .then(r => r.json())
        .then(d => setCatalog(Array.isArray(d) ? d : []))
        .catch((err) => {
          if (err?.name !== 'AbortError') console.error(err);
        });
    }, 220);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [searchTerm, selectedLocationId]);

  const addToCart = (v: Variant) => {
    const variantId = v.id || v.variant_id;
    if (!variantId) {
      alert('This product is missing its catalog identity. Please refresh the POS catalog.');
      return;
    }
    setCart(prev => {
      const ex = prev.find(i => i.variant_id === variantId);
      if (ex) return prev.map(i => i.variant_id === variantId ? { ...i, quantity: i.quantity + 1 } : i);
      return [...prev, {
        id: crypto.randomUUID(),
        variant_id: variantId,
        name: v.name,
        size: v.size || null,
        color: v.color || null,
        price: Number(v.retail_price),
        quantity: 1,
        discount_percent: Number(v.discount_percent || 0),
      }];
    });
  };

  const adjustQty = (id: string, d: number) =>
    setCart(prev => prev.map(i => i.id === id ? { ...i, quantity: Math.max(1, i.quantity + d) } : i));

  const removeItem = (id: string) => setCart(prev => prev.filter(i => i.id !== id));

  const applyDiscount = (id: string) => {
    const current = cart.find(i => i.id === id);
    if (!current) return;
    const raw = window.prompt('Enter discount percent for this item (0-100):', String(current.discount_percent || 0));
    if (raw === null) return;
    const next = Math.max(0, Math.min(100, Number(raw)));
    if (!Number.isFinite(next)) return;
    setCart(prev => prev.map(i => i.id === id ? { ...i, discount_percent: next } : i));
  };

  const lineTotal = (item: CartItem) => item.price * (1 - (item.discount_percent || 0) / 100) * item.quantity;
  const discountTotal = cart.reduce((sum, item) => sum + item.price * (item.discount_percent || 0) / 100 * item.quantity, 0);
  const total = cart.reduce((s, i) => s + lineTotal(i), 0);

  const checkout = async (method: 'CASH' | 'MOBILE_MONEY') => {
    if (!cart.length) return;
    if (cart.some((item) => !item.variant_id)) {
      alert('Refresh POS and add the products again. One cart item is missing its product identity.');
      setCart([]);
      return;
    }
    if (!selectedLocationId) {
      alert('Select the sale location before checkout.');
      return;
    }
    setProcessing(true);
    try {
      const res = await fetch('/api/pos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          cart: cart.map(i => ({ variant_id: i.variant_id, name: i.name, price: i.price, quantity: i.quantity, discount_percent: i.discount_percent })),
          method,
          location_id: selectedLocationId || undefined,
          customer_email: customerEmail.trim() || undefined,
        }),
      });
      const data = await res.json();
      if (data.success) {
        setReceiptFooter(data.receiptFooter || 'Thank you for your business!');
        
        const tendered = method === 'CASH' && amountTenderedStr ? Number(amountTenderedStr) : data.total;
        const change = tendered >= data.total ? tendered - data.total : 0;

        setReceipt({
          number: data.receipt,
          total: data.total,
          subtotal: data.subtotal,
          tax: data.tax,
          taxRatePercent: data.taxRatePercent,
          discountTotal: data.discountTotal || 0,
          businessName: data.businessName,
          businessPhone: data.businessPhone,
          receiptLogoDataUrl: data.receiptLogoDataUrl || null,
          zraTpin: data.zraTpin,
          zraEnabled: data.zraEnabled,
          items: cart.map(i => ({
            name: i.name,
            size: i.size,
            color: i.color,
            price: i.price * (1 - (i.discount_percent || 0) / 100),
            quantity: i.quantity,
            discountPercent: i.discount_percent,
            discountAmount: i.price * (i.discount_percent || 0) / 100,
            lineTotal: lineTotal(i),
          })),
          payment_method: method,
          cashierName: session.staffName,
          locationName: session.locationName,
          amountTendered: tendered,
          change: change
        });
        setCart([]);
        setAmountTenderedStr('');
        setCustomerEmail('');
      } else {
        alert(data.error || 'Checkout failed');
      }
    } catch { alert('Network error'); }
    setProcessing(false);
  };

  const lookupReturn = async () => {
    const receipt = returnReceiptNo.trim();
    if (!receipt) return;
    setReturnLookupLoading(true);
    setReturnLookup(null);
    setSelectedReturnItems({});
    try {
      const res = await fetch(`/api/pos/returns?receipt=${encodeURIComponent(receipt)}`);
      const data = await res.json();
      if (!res.ok) {
        alert(data.error || 'Unable to find receipt');
        return;
      }
      setReturnLookup(data);
      const initial: Record<string, number> = {};
      (data.items || []).forEach((item: ReturnLookupItem) => {
        if (item.returnable_quantity > 0) initial[item.id] = 0;
      });
      setSelectedReturnItems(initial);
    } catch {
      alert('Network error while looking up receipt');
    } finally {
      setReturnLookupLoading(false);
    }
  };

  const processReturn = async () => {
    if (!returnLookup?.transaction) return;
    const items = Object.entries(selectedReturnItems)
      .map(([transaction_item_id, quantity]) => ({ transaction_item_id, quantity: Number(quantity) }))
      .filter(item => item.quantity > 0);
    if (!items.length) {
      alert('Select at least one item to return.');
      return;
    }
    setReturnProcessing(true);
    try {
      const res = await fetch('/api/pos/returns', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          transaction_id: returnLookup.transaction.id,
          items,
          refund_method: returnRefundMethod,
          reason: returnReason,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        alert(data.error || 'Return failed');
        return;
      }
      alert(`Return completed. Refund total: K${Number(data.refund_total).toFixed(2)}`);
      setReturnLookup(null);
      setReturnReceiptNo('');
      setReturnReason('');
      setSelectedReturnItems({});
    } catch {
      alert('Network error during return');
    } finally {
      setReturnProcessing(false);
    }
  };

  const endShift = async () => {
    if (!confirm('End your shift and log out?')) return;
    await fetch('/api/auth/logout', { method: 'POST' });
    router.push('/login');
  };
  const tenderedNum = Number(amountTenderedStr) || 0;
  const currentChange = tenderedNum >= total ? tenderedNum - total : 0;

  if (!mounted) return null;

  return (
    <div style={{ display: 'flex', height: '100vh', fontFamily: 'Outfit, sans-serif', background: 'var(--bg-color)', color: 'var(--text-main)' }}>
      {receipt && (
        <ReceiptPrint 
          storeName={session.tenantName || 'STORE'} 
          footerMessage={receiptFooter} 
          receipt={receipt} 
          onPrintComplete={() => setReceipt(null)} 
        />
      )}

      {/* ── LEFT: Catalog ── */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', padding: '20px', overflowY: 'auto', borderRight: '1px solid var(--panel-border)' }}>

        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '20px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <Hexagon size={24} color="var(--primary)" />
            <div>
              <div style={{ fontWeight: 700, fontSize: '18px' }}>Cashier Desk</div>
              <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                {session.tenantName}{session.locationName ? ` · ${session.locationName}` : ''}
              </div>
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <select
              value={selectedLocationId}
              onChange={(e) => setSelectedLocationId(e.target.value)}
              style={{ background: 'var(--hover-bg)', border: '1px solid var(--panel-border)', color: 'var(--text-main)', borderRadius: '8px', padding: '8px 10px', minWidth: '180px' }}
              title="Sale location"
            >
              <option value="">Select location</option>
              {locations.map((loc) => (
                <option key={loc.id} value={loc.id}>{loc.name}</option>
              ))}
            </select>

            {/* Theme toggle */}
            <button onClick={toggleTheme} title="Toggle theme"
              style={{ background: 'var(--hover-bg)', border: '1px solid var(--panel-border)', color: 'var(--text-muted)', borderRadius: '8px', padding: '8px', cursor: 'pointer', display: 'flex' }}>
              {theme === 'dark' ? <Sun size={15} /> : <Moon size={15} />}
            </button>

            <div style={{ textAlign: 'right' }}>
              <div style={{ fontWeight: 600, fontSize: '14px' }}>{session.staffName}</div>
              <div style={{ fontSize: '12px', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: '4px', justifyContent: 'flex-end' }}>
                <Clock size={11} /> {shiftTime}
              </div>
              <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '2px' }}>
                {session.locationName || 'No location set'}
              </div>
            </div>
            <button onClick={endShift}
              style={{ background: 'var(--hover-bg)', border: '1px solid var(--panel-border)', color: 'var(--danger)', borderRadius: '8px', padding: '8px 12px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '6px', fontSize: '13px', fontWeight: 500 }}>
              <LogOut size={14} /> End Shift
            </button>
          </div>
        </div>

        {/* Scanner */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '10px 14px', background: 'var(--hover-bg)', border: '1px solid var(--panel-border)', borderRadius: '10px', marginBottom: '20px' }}>
          <ScanLine size={18} color="var(--primary)" />
          <input ref={scanRef} type="text" placeholder="Waiting for barcode scanner..."
            onBlur={e => setTimeout(() => e.target.focus(), 100)}
            style={{ flex: 1, background: 'none', border: 'none', color: 'var(--text-main)', fontSize: '14px', outline: 'none', fontFamily: 'Outfit' }} />
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '10px 14px', background: 'var(--panel-bg)', border: '1px solid var(--panel-border)', borderRadius: '10px', marginBottom: '16px' }}>
          <Tag size={18} color="var(--primary)" />
          <input
            type="text"
            placeholder="Search by code, color, size, description, price..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            style={{ flex: 1, background: 'none', border: 'none', color: 'var(--text-main)', fontSize: '14px', outline: 'none', fontFamily: 'Outfit' }}
          />
        </div>

        <div style={{ fontWeight: 600, fontSize: '13px', marginBottom: '14px', color: 'var(--text-muted)', letterSpacing: '0.05em' }}>
          PRODUCTS ({catalog.length})
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(148px, 1fr))', gap: '12px' }}>
          {catalog.map(v => (
          <button key={v.id} onClick={() => addToCart(v)}
              style={{ background: 'var(--panel-bg)', border: '1px solid var(--panel-border)', borderRadius: '12px', padding: '14px 12px', cursor: 'pointer', textAlign: 'left', transition: 'border-color 0.15s, transform 0.1s', fontFamily: 'Outfit', display: 'flex', flexDirection: 'column', gap: 0 }}
              onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--primary)'; e.currentTarget.style.transform = 'translateY(-2px)'; }}
              onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--panel-border)'; e.currentTarget.style.transform = 'none'; }}>
              <div style={{ width: '40px', height: '40px', background: 'rgba(74,222,128,0.12)', borderRadius: '10px', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: '10px' }}>
                <Package size={20} color="var(--primary)" />
              </div>
              <div style={{ fontWeight: 600, fontSize: '13px', marginBottom: '6px', color: 'var(--text-main)', lineHeight: 1.3 }}>{v.name}</div>

              {/* Size + Color badges */}
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px', marginBottom: '8px' }}>
                {v.size && (
                  <span style={{ fontSize: '11px', fontWeight: 700, padding: '2px 8px', borderRadius: '6px', background: 'var(--hover-bg)', border: '1px solid var(--panel-border)', color: 'var(--text-main)', letterSpacing: '0.04em' }}>
                    {v.size}
                  </span>
                )}
                {v.color && (
                  <span style={{ fontSize: '11px', fontWeight: 600, padding: '2px 8px', borderRadius: '6px', background: 'var(--hover-bg)', border: '1px solid var(--panel-border)', color: 'var(--text-muted)' }}>
                    {v.color}
                  </span>
                )}
              </div>

              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div style={{ fontWeight: 700, color: 'var(--primary)', fontSize: '15px' }}>K{Number(v.retail_price).toFixed(2)}</div>
                {typeof v.available_count === 'number' && (
                  <div style={{ fontSize: '11px', color: v.available_count < 3 ? 'var(--warning)' : 'var(--text-muted)', fontWeight: 600 }}>
                    {v.available_count} left
                  </div>
                )}
              </div>
            </button>
          ))}
          {catalog.length === 0 && (
            <div style={{ gridColumn: '1/-1', textAlign: 'center', padding: '48px', color: 'var(--text-muted)' }}>
              <Package size={32} style={{ marginBottom: '12px', opacity: 0.4 }} />
              <div style={{ fontWeight: 600 }}>No products in stock</div>
              <div style={{ fontSize: '13px', marginTop: '4px' }}>Add inventory from the Owner Dashboard</div>
            </div>
          )}
        </div>
      </div>

      {/* ── RIGHT: Cart ── */}
      <div style={{ width: '390px', display: 'flex', flexDirection: 'column', background: 'var(--panel-bg)' }}>
        <div style={{ padding: '20px', borderBottom: '1px solid var(--panel-border)', display: 'flex', alignItems: 'center', gap: '10px' }}>
          <ShoppingCart size={20} color="var(--primary)" />
          <span style={{ fontWeight: 700, fontSize: '18px' }}>Current Sale</span>
          {cart.length > 0 && (
            <span style={{ marginLeft: 'auto', background: 'var(--primary)', color: '#0f1115', borderRadius: '12px', padding: '2px 10px', fontSize: '12px', fontWeight: 700 }}>
              {cart.length}
            </span>
          )}
        </div>

        <div style={{ flex: 1, overflowY: 'auto', padding: '16px' }}>
          {cart.length === 0 ? (
            <div style={{ textAlign: 'center', color: 'var(--text-muted)', marginTop: '60px' }}>
              <ShoppingCart size={40} style={{ opacity: 0.2, marginBottom: '12px' }} />
              <div>Cart is empty</div>
              <div style={{ fontSize: '13px', marginTop: '4px' }}>Tap a product to add it</div>
            </div>
          ) : cart.map(item => (
            <div key={item.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 0', borderBottom: '1px solid var(--panel-border)' }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 600, fontSize: '14px', marginBottom: '4px' }}>{item.name}</div>
                {/* Size / Color in cart */}
                {(item.size || item.color) && (
                  <div style={{ display: 'flex', gap: '6px', marginBottom: '6px' }}>
                    {item.size && (
                      <span style={{ fontSize: '11px', fontWeight: 700, padding: '2px 8px', borderRadius: '6px', background: 'var(--hover-bg)', border: '1px solid var(--panel-border)', color: 'var(--text-main)' }}>
                        {item.size}
                      </span>
                    )}
                    {item.color && (
                      <span style={{ fontSize: '11px', fontWeight: 600, padding: '2px 8px', borderRadius: '6px', background: 'var(--hover-bg)', border: '1px solid var(--panel-border)', color: 'var(--text-muted)' }}>
                        {item.color}
                      </span>
                    )}
                  </div>
                )}
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px', fontSize: '12px', color: 'var(--text-muted)' }}>
                  {item.discount_percent > 0 ? (
                    <>
                      <span style={{ textDecoration: 'line-through' }}>K{item.price.toFixed(2)}</span>
                      <span style={{ color: 'var(--primary)', fontWeight: 700 }}>K{(item.price * (1 - item.discount_percent / 100)).toFixed(2)}</span>
                      <span style={{ padding: '2px 8px', borderRadius: '999px', background: 'rgba(74,222,128,0.12)', color: 'var(--primary)', fontWeight: 700 }}>{item.discount_percent}% off</span>
                    </>
                  ) : (
                    <span>K{item.price.toFixed(2)} each</span>
                  )}
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <button onClick={() => adjustQty(item.id, -1)} style={{ width: '26px', height: '26px', border: '1px solid var(--panel-border)', background: 'var(--hover-bg)', color: 'var(--text-main)', borderRadius: '6px', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Minus size={12} /></button>
                  <span style={{ fontWeight: 700, minWidth: '20px', textAlign: 'center' }}>{item.quantity}</span>
                  <button onClick={() => adjustQty(item.id, 1)} style={{ width: '26px', height: '26px', border: '1px solid var(--panel-border)', background: 'var(--hover-bg)', color: 'var(--text-main)', borderRadius: '6px', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Plus size={12} /></button>
                  <button onClick={() => applyDiscount(item.id)} style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', padding: '4px 8px', borderRadius: '8px', border: '1px solid var(--panel-border)', background: 'var(--hover-bg)', color: 'var(--text-muted)', cursor: 'pointer', fontSize: '12px' }}>
                    <Tag size={12} /> Discount
                  </button>
                </div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginLeft: '12px' }}>
                <span style={{ fontWeight: 700, fontSize: '15px' }}>K{lineTotal(item).toFixed(2)}</span>
                <button onClick={() => removeItem(item.id)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--danger)', padding: '4px' }}><Trash2 size={15} /></button>
              </div>
            </div>
          ))}
        </div>

        <div style={{ padding: '16px', borderTop: '1px solid var(--panel-border)' }}>
          {receipt && (
            <div style={{ background: 'rgba(74,222,128,0.12)', border: '1px solid var(--primary)', borderRadius: '10px', padding: '12px', marginBottom: '14px', display: 'flex', gap: '8px', alignItems: 'flex-start' }}>
              <CheckCircle2 size={18} color="var(--primary)" style={{ flexShrink: 0, marginTop: '1px' }} />
              <div>
                <div style={{ fontWeight: 700, color: 'var(--primary)', fontSize: '14px' }}>Sale Complete!</div>
                <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginTop: '2px' }}>{receipt.number} · K{Number(receipt.total).toFixed(2)}</div>
              </div>
            </div>
          )}

          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '14px', alignItems: 'center' }}>
            <span style={{ fontSize: '16px', fontWeight: 500, color: 'var(--text-muted)' }}>Total</span>
            <span style={{ fontSize: '28px', fontWeight: 800 }}>K{total.toFixed(2)}</span>
          </div>
          {discountTotal > 0 && (
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '14px', alignItems: 'center' }}>
              <span style={{ fontSize: '14px', fontWeight: 500, color: 'var(--text-muted)' }}>Discounts</span>
              <span style={{ fontSize: '16px', fontWeight: 700, color: 'var(--primary)' }}>-K{discountTotal.toFixed(2)}</span>
            </div>
          )}

          <div style={{ marginBottom: '14px' }}>
            <label style={{ display: 'block', fontSize: '12px', color: 'var(--text-muted)', marginBottom: '4px' }}>Amount Tendered (Cash)</label>
            <input 
              type="number" 
              value={amountTenderedStr} 
              onChange={e => setAmountTenderedStr(e.target.value)}
              placeholder="Enter amount given..." 
              style={{ width: '100%', padding: '10px', borderRadius: '8px', border: '1px solid var(--panel-border)', background: 'var(--bg-color)', color: 'var(--text-main)', fontSize: '16px', fontFamily: 'Outfit' }} 
            />
          </div>

          <div style={{ marginBottom: '14px' }}>
            <label style={{ display: 'block', fontSize: '12px', color: 'var(--text-muted)', marginBottom: '4px' }}>Email Receipt (Optional)</label>
            <input 
              type="email" 
              value={customerEmail} 
              onChange={e => setCustomerEmail(e.target.value)}
              placeholder="customer@email.com" 
              style={{ width: '100%', padding: '10px', borderRadius: '8px', border: '1px solid var(--panel-border)', background: 'var(--bg-color)', color: 'var(--text-main)', fontSize: '14px', fontFamily: 'Outfit' }} 
            />
          </div>

          {amountTenderedStr && tenderedNum >= total && (
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '14px', alignItems: 'center', background: 'rgba(74,222,128,0.1)', padding: '8px 12px', borderRadius: '8px', border: '1px solid rgba(74,222,128,0.3)' }}>
              <span style={{ fontSize: '14px', fontWeight: 600, color: 'var(--primary)' }}>Change Due</span>
              <span style={{ fontSize: '18px', fontWeight: 800, color: 'var(--primary)' }}>K{currentChange.toFixed(2)}</span>
            </div>
          )}
          {amountTenderedStr && tenderedNum < total && (
            <div style={{ fontSize: '12px', color: 'var(--danger)', marginBottom: '14px', textAlign: 'right' }}>
              Insufficient amount tendered
            </div>
          )}

          <button onClick={() => checkout('CASH')} disabled={processing || !cart.length || (!!amountTenderedStr && tenderedNum < total)}
            style={{ width: '100%', padding: '14px', marginBottom: '10px', background: cart.length && !processing ? 'var(--primary)' : 'var(--hover-bg)', color: cart.length && !processing ? '#0f1115' : 'var(--text-muted)', border: 'none', borderRadius: '10px', fontWeight: 700, fontSize: '15px', cursor: cart.length ? 'pointer' : 'not-allowed', fontFamily: 'Outfit', transition: 'all 0.15s', letterSpacing: '0.05em' }}>
            {processing ? 'Processing...' : 'CASH'}
          </button>
          <button onClick={() => checkout('MOBILE_MONEY')} disabled={processing || !cart.length}
            style={{ width: '100%', padding: '14px', background: cart.length && !processing ? 'rgba(96,165,250,0.15)' : 'var(--hover-bg)', color: cart.length && !processing ? 'var(--secondary)' : 'var(--text-muted)', border: cart.length ? '1px solid var(--secondary)' : '1px solid var(--panel-border)', borderRadius: '10px', fontWeight: 700, fontSize: '15px', cursor: cart.length ? 'pointer' : 'not-allowed', fontFamily: 'Outfit', transition: 'all 0.15s', letterSpacing: '0.05em' }}>
            {processing ? '...' : 'MOBILE MONEY'}
          </button>

          <div style={{ marginTop: '16px', paddingTop: '16px', borderTop: '1px solid var(--panel-border)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '10px', fontWeight: 700 }}>
              <ReceiptText size={16} color="var(--secondary)" /> Returns
            </div>
            <div style={{ display: 'flex', gap: '8px', marginBottom: '10px' }}>
              <input
                value={returnReceiptNo}
                onChange={e => setReturnReceiptNo(e.target.value)}
                placeholder="Receipt number"
                style={{ flex: 1, padding: '10px', borderRadius: '8px', border: '1px solid var(--panel-border)', background: 'var(--bg-color)', color: 'var(--text-main)' }}
              />
              <button
                onClick={lookupReturn}
                disabled={returnLookupLoading}
                style={{ padding: '10px 12px', borderRadius: '8px', border: 'none', background: 'var(--secondary)', color: '#0f1115', fontWeight: 700, cursor: 'pointer' }}
              >
                {returnLookupLoading ? '...' : 'Find'}
              </button>
            </div>

            {returnLookup && (
              <div style={{ display: 'grid', gap: '10px' }}>
                <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                  {returnLookup.transaction.receipt_number} · {returnLookup.transaction.location_name || '—'} · {returnLookup.transaction.cashier_name || '—'}
                </div>
                <div style={{ maxHeight: '220px', overflowY: 'auto', display: 'grid', gap: '8px' }}>
                  {returnLookup.items.map(item => (
                    <label key={item.id} style={{ display: 'grid', gridTemplateColumns: '22px 1fr 70px', gap: '8px', alignItems: 'center', padding: '10px', border: '1px solid var(--panel-border)', borderRadius: '10px', background: 'var(--bg-color)' }}>
                      <input
                        type="number"
                        min={0}
                        max={item.returnable_quantity}
                        value={selectedReturnItems[item.id] ?? 0}
                        onChange={e => setSelectedReturnItems(prev => ({ ...prev, [item.id]: Math.max(0, Math.min(item.returnable_quantity, Number(e.target.value) || 0)) }))}
                        style={{ width: '100%', padding: '8px', borderRadius: '8px', border: '1px solid var(--panel-border)', background: 'var(--hover-bg)', color: 'var(--text-main)' }}
                      />
                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontWeight: 600, fontSize: '13px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.variant_name || item.description || item.garment_serial || 'Item'}</div>
                        <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                          {item.garment_serial || 'Manual'} · {item.returnable_quantity} left
                        </div>
                      </div>
                      <div style={{ textAlign: 'right', fontSize: '12px', color: 'var(--text-muted)' }}>
                        K{(Number(item.unit_price || 0) - Number(item.discount_amount || 0)).toFixed(2)}
                      </div>
                    </label>
                  ))}
                </div>
                <textarea
                  value={returnReason}
                  onChange={e => setReturnReason(e.target.value)}
                  placeholder="Reason for return"
                  rows={2}
                  style={{ width: '100%', padding: '10px', borderRadius: '8px', border: '1px solid var(--panel-border)', background: 'var(--bg-color)', color: 'var(--text-main)', resize: 'vertical' }}
                />
                <select
                  value={returnRefundMethod}
                  onChange={e => setReturnRefundMethod(e.target.value as any)}
                  style={{ width: '100%', padding: '10px', borderRadius: '8px', border: '1px solid var(--panel-border)', background: 'var(--bg-color)', color: 'var(--text-main)' }}
                >
                  <option value="CASH">Cash Refund</option>
                  <option value="MOBILE_MONEY">Mobile Money Refund</option>
                  <option value="STORE_CREDIT">Store Credit</option>
                  <option value="VOID">Void</option>
                </select>
                <button
                  onClick={processReturn}
                  disabled={returnProcessing}
                  style={{ width: '100%', padding: '12px', borderRadius: '10px', border: 'none', background: 'var(--secondary)', color: '#0f1115', fontWeight: 700, cursor: 'pointer' }}
                >
                  {returnProcessing ? 'Processing...' : 'Process Return'}
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
