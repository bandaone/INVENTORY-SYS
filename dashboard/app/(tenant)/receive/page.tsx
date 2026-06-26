'use client';

import { useState, useEffect } from 'react';
import { PackagePlus, Printer, Loader2, Plus, CheckCircle2, Box } from 'lucide-react';
import BarcodeLabelPrint, { PrintLabel } from '@/components/BarcodeLabelPrint';

interface Variant {
  id: string;
  name: string;
  color: string | null;
  size: string | null;
  retail_price: number;
}

interface Location {
  id: string;
  name: string;
}

export default function ReceivePage() {
  const [variants, setVariants] = useState<Variant[]>([]);
  const [locations, setLocations] = useState<Location[]>([]);
  const [loading, setLoading] = useState(true);

  // Print state
  const [storeName, setStoreName] = useState('RETAIL OS');
  const [printLabels, setPrintLabels] = useState<PrintLabel[]>([]);

  // Form states
  const [isNewProduct, setIsNewProduct] = useState(false);
  const [selectedVariantId, setSelectedVariantId] = useState('');
  const [selectedLocationId, setSelectedLocationId] = useState('');
  const [quantity, setQuantity] = useState(1);

  // New product form
  const [newProd, setNewProd] = useState({ name: '', color: '', size: '', cost_price: '', retail_price: '' });
  
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  useEffect(() => {
    // Read store name from cookie
    const name = document.cookie.match(new RegExp('(^| )tenant_name=([^;]+)'))?.[2];
    if (name) setStoreName(decodeURIComponent(name));

    Promise.all([
      fetch('/api/catalog').then(r => r.json()),
      fetch('/api/locations').then(r => r.json())
    ]).then(([catRes, locRes]) => {
      setVariants(Array.isArray(catRes) ? catRes : []);
      if (Array.isArray(locRes)) {
        setLocations(locRes);
        if (locRes.length === 1) setSelectedLocationId(locRes[0].id);
      } else {
        setLocations([]);
      }
      setLoading(false);
    }).catch(() => setLoading(false));
  }, []);

  // Trigger browser print exactly when the printLabels state updates and react-barcode finishes rendering
  useEffect(() => {
    if (printLabels.length > 0) {
      setTimeout(() => {
        const originalTitle = document.title;
        // e.g. "Barcodes_Denim_Jacket_QTY5_2026-06-19T13-00-00"
        const productName = printLabels[0].name.replace(/[^a-zA-Z0-9]/g, '_');
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
        document.title = `Barcodes_${productName}_QTY${printLabels.length}_${timestamp}`;
        
        window.print();
        
        // Restore title immediately after print dialog resolves/blocks
        document.title = originalTitle;
      }, 500); // 500ms delay ensures Canvas/SVGs render before spooling to printer
    }
  }, [printLabels]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(''); setSuccess('');
    
    if (quantity < 1 || quantity > 500) {
      setError('Quantity must be between 1 and 500.'); return;
    }
    if (!selectedLocationId) {
      setError('Please select a receiving location.'); return;
    }

    setSubmitting(true);
    try {
      let targetVariantId = selectedVariantId;

      // If they are defining a new product, create it first
      if (isNewProduct) {
        if (!newProd.name || !newProd.cost_price || !newProd.retail_price) {
          setError('Name, Cost Price, and Retail Price are required for new products.');
          setSubmitting(false); return;
        }

        const catRes = await fetch('/api/catalog', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: newProd.name, color: newProd.color, size: newProd.size,
            cost_price: Number(newProd.cost_price), retail_price: Number(newProd.retail_price)
          })
        });
        const catData = await catRes.json();
        
        if (!catRes.ok) {
          setError(catData.error || 'Failed to create new product in catalog.');
          setSubmitting(false); return;
        }
        
        targetVariantId = catData.variant.id;
        // Add to local state so they can use it again without refreshing
        setVariants(prev => [...prev, catData.variant]);
      }

      if (!targetVariantId) {
        setError('Please select a product variant.');
        setSubmitting(false); return;
      }

      // 2. Receive the stock
      const recRes = await fetch('/api/receive', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ variant_id: targetVariantId, location_id: selectedLocationId, quantity })
      });
      const recData = await recRes.json();

      if (!recRes.ok) {
        setError(recData.error || 'Failed to receive stock.');
      } else {
        setSuccess(`Successfully received ${quantity} items. Generating print spool...`);
        setPrintLabels(recData.labels);
        // Reset forms
        setIsNewProduct(false);
        setNewProd({ name: '', color: '', size: '', cost_price: '', retail_price: '' });
        setQuantity(1);
      }

    } catch (err) {
      setError('Network error occurred.');
    }
    setSubmitting(false);
  };

  if (loading) return <div style={{ padding: '40px' }}><Loader2 className="spin" /></div>;

  return (
    <div className="animate-fade-in">
      <h1>Goods Receiving</h1>
      <p className="subtitle">Register new stock into the database and print physical barcode labels for tagging.</p>

      {/* Hidden print renderer — only visible to the printer */}
      <BarcodeLabelPrint storeName={storeName} labels={printLabels} />

      {error && (
        <div style={{ margin: '16px 0', padding: '12px', background: 'rgba(239,68,68,0.1)', border: '1px solid var(--danger)', color: 'var(--danger)', borderRadius: '8px', fontSize: '14px' }}>
          {error}
        </div>
      )}
      
      {success && (
        <div style={{ margin: '16px 0', padding: '12px', background: 'rgba(74,222,128,0.1)', border: '1px solid var(--primary)', color: 'var(--primary)', borderRadius: '8px', fontSize: '14px', display: 'flex', alignItems: 'center', gap: '8px' }}>
          <CheckCircle2 size={16} /> {success}
        </div>
      )}

      <form onSubmit={handleSubmit} style={{ display: 'grid', gridTemplateColumns: '1fr 300px', gap: '24px', marginTop: '32px', alignItems: 'flex-start' }}>
        
        {/* Left Column: Product Selection */}
        <div className="glass-panel" style={{ padding: '24px' }}>
          <h2 style={{ fontSize: '16px', fontWeight: 600, marginBottom: '20px', display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Box size={18} color="var(--primary)" /> Step 1: Select Product
          </h2>

          <div style={{ display: 'flex', gap: '12px', marginBottom: '20px' }}>
            <button type="button" onClick={() => setIsNewProduct(false)}
              style={{ flex: 1, padding: '12px', border: '1px solid ' + (!isNewProduct ? 'var(--primary)' : 'var(--panel-border)'), background: !isNewProduct ? 'rgba(74,222,128,0.1)' : 'var(--bg-color)', color: !isNewProduct ? 'var(--primary)' : 'var(--text-muted)', borderRadius: '8px', cursor: 'pointer', fontWeight: 600, fontFamily: 'Outfit' }}>
              Existing Product
            </button>
            <button type="button" onClick={() => setIsNewProduct(true)}
              style={{ flex: 1, padding: '12px', border: '1px solid ' + (isNewProduct ? 'var(--secondary)' : 'var(--panel-border)'), background: isNewProduct ? 'rgba(96,165,250,0.1)' : 'var(--bg-color)', color: isNewProduct ? 'var(--secondary)' : 'var(--text-muted)', borderRadius: '8px', cursor: 'pointer', fontWeight: 600, fontFamily: 'Outfit', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px' }}>
              <Plus size={16} /> Define New Product
            </button>
          </div>

          {!isNewProduct ? (
            <div>
              <label style={{ display: 'block', fontSize: '13px', color: 'var(--text-muted)', marginBottom: '8px' }}>Choose from Catalog</label>
              <div style={{ maxHeight: '300px', overflowY: 'auto', border: '1px solid var(--panel-border)', borderRadius: '8px', background: 'var(--hover-bg)' }}>
                {variants.length === 0 && <div style={{ padding: '16px', textAlign: 'center', color: 'var(--text-muted)', fontSize: '13px' }}>No products in catalog yet. Define a new product.</div>}
                {variants.map(v => (
                  <div 
                    key={v.id} 
                    onClick={() => setSelectedVariantId(v.id)}
                    style={{ 
                      padding: '12px 16px', 
                      borderBottom: '1px solid var(--panel-border)', 
                      cursor: 'pointer',
                      background: selectedVariantId === v.id ? 'rgba(74,222,128,0.1)' : 'transparent',
                      borderLeft: selectedVariantId === v.id ? '3px solid var(--primary)' : '3px solid transparent',
                      transition: 'all 0.2s ease'
                    }}
                  >
                    <div style={{ fontWeight: 600, fontSize: '14px', color: selectedVariantId === v.id ? 'var(--primary)' : 'var(--text-main)' }}>{v.name}</div>
                    <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginTop: '4px', display: 'flex', justifyContent: 'space-between' }}>
                      <span>{v.size ? `Size: ${v.size} ` : ''}{v.color ? `Color: ${v.color}` : ''}</span>
                      <span style={{ fontWeight: 700, color: 'var(--text-main)' }}>K{Number(v.retail_price).toFixed(2)}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              <div>
                <label style={{ display: 'block', fontSize: '12px', color: 'var(--text-muted)', marginBottom: '6px' }}>Product Name *</label>
                <input value={newProd.name} onChange={e => setNewProd({...newProd, name: e.target.value})} placeholder="e.g. Men's Denim Jacket" style={{ width: '100%', padding: '10px 12px', background: 'var(--hover-bg)', border: '1px solid var(--panel-border)', color: 'var(--text-main)', borderRadius: '8px', fontFamily: 'Outfit' }} />
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
                <div>
                  <label style={{ display: 'block', fontSize: '12px', color: 'var(--text-muted)', marginBottom: '6px' }}>Color (optional)</label>
                  <input value={newProd.color} onChange={e => setNewProd({...newProd, color: e.target.value})} placeholder="e.g. Blue" style={{ width: '100%', padding: '10px 12px', background: 'var(--hover-bg)', border: '1px solid var(--panel-border)', color: 'var(--text-main)', borderRadius: '8px', fontFamily: 'Outfit' }} />
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: '12px', color: 'var(--text-muted)', marginBottom: '6px' }}>Size (optional)</label>
                  <input value={newProd.size} onChange={e => setNewProd({...newProd, size: e.target.value})} placeholder="e.g. XL" style={{ width: '100%', padding: '10px 12px', background: 'var(--hover-bg)', border: '1px solid var(--panel-border)', color: 'var(--text-main)', borderRadius: '8px', fontFamily: 'Outfit' }} />
                </div>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
                <div>
                  <label style={{ display: 'block', fontSize: '12px', color: 'var(--text-muted)', marginBottom: '6px' }}>Cost Price (K) *</label>
                  <input type="number" min="0" step="0.01" value={newProd.cost_price} onChange={e => setNewProd({...newProd, cost_price: e.target.value})} placeholder="0.00" style={{ width: '100%', padding: '10px 12px', background: 'var(--hover-bg)', border: '1px solid var(--panel-border)', color: 'var(--text-main)', borderRadius: '8px', fontFamily: 'Outfit' }} />
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: '12px', color: 'var(--text-muted)', marginBottom: '6px' }}>Retail Price (K) *</label>
                  <input type="number" min="0" step="0.01" value={newProd.retail_price} onChange={e => setNewProd({...newProd, retail_price: e.target.value})} placeholder="0.00" style={{ width: '100%', padding: '10px 12px', background: 'var(--hover-bg)', border: '1px solid var(--panel-border)', color: 'var(--text-main)', borderRadius: '8px', fontFamily: 'Outfit' }} />
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Right Column: Receive & Print Action */}
        <div className="glass-panel" style={{ padding: '24px', background: 'var(--panel-bg)' }}>
          <h2 style={{ fontSize: '16px', fontWeight: 600, marginBottom: '20px', display: 'flex', alignItems: 'center', gap: '8px' }}>
            <PackagePlus size={18} color="var(--primary)" /> Step 2: Receive
          </h2>

          {locations.length > 1 ? (
            <div style={{ marginBottom: '16px' }}>
              <label style={{ display: 'block', fontSize: '12px', color: 'var(--text-muted)', marginBottom: '6px', fontWeight: 600 }}>RECEIVING DESTINATION</label>
              <select 
                value={selectedLocationId} 
                onChange={e => setSelectedLocationId(e.target.value)}
                style={{ width: '100%', padding: '12px', background: 'var(--hover-bg)', border: '1px solid var(--panel-border)', color: 'var(--text-main)', borderRadius: '8px', fontFamily: 'Outfit', fontSize: '14px' }}
              >
                <option value="">-- Select Branch --</option>
                {locations.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
              </select>
            </div>
          ) : (
            locations.length === 1 && (
              <div style={{ marginBottom: '16px', padding: '12px', background: 'rgba(255,255,255,0.05)', border: '1px solid var(--panel-border)', borderRadius: '8px', fontSize: '13px', color: 'var(--text-muted)', display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ fontWeight: 600 }}>DESTINATION</span>
                <span style={{ color: 'var(--primary)', fontWeight: 600 }}>{locations[0].name}</span>
              </div>
            )
          )}

          <div style={{ marginBottom: '24px' }}>
            <label style={{ display: 'block', fontSize: '12px', color: 'var(--text-muted)', marginBottom: '6px', fontWeight: 600 }}>QUANTITY (How many units arrived?)</label>
            <input 
              type="number" min="1" max="500" 
              value={quantity} 
              onChange={e => setQuantity(parseInt(e.target.value) || 1)}
              style={{ width: '100%', padding: '14px', background: 'var(--hover-bg)', border: '1px solid var(--panel-border)', color: 'var(--text-main)', borderRadius: '8px', fontFamily: 'Outfit', fontSize: '18px', fontWeight: 700, textAlign: 'center' }} 
            />
          </div>

          <div style={{ padding: '14px', background: 'rgba(255,255,255,0.03)', borderRadius: '8px', marginBottom: '20px', fontSize: '12px', color: 'var(--text-muted)', lineHeight: 1.5 }}>
            <strong>What happens next?</strong><br/>
            This generates {quantity} unique serial numbers in the database and immediately prints {quantity} barcode labels.
          </div>

          <button 
            type="submit" 
            disabled={submitting}
            style={{ width: '100%', padding: '16px', background: 'var(--primary)', color: '#0f1115', border: 'none', borderRadius: '10px', fontWeight: 700, fontSize: '15px', cursor: submitting ? 'not-allowed' : 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', fontFamily: 'Outfit', boxShadow: '0 4px 14px rgba(74,222,128,0.2)' }}
          >
            {submitting ? <Loader2 size={18} className="spin" /> : <><Printer size={18} /> Receive & Print Labels</>}
          </button>
        </div>

      </form>
    </div>
  );
}
