'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, CheckCircle2, Loader2, ScanLine, XCircle } from 'lucide-react';
import { Html5Qrcode } from 'html5-qrcode';

type ItemStatus = 'matched' | 'missing' | 'unexpected';

interface ExpectedItem {
  serial: string;
  name: string;
  status: string;
  location_name: string | null;
}

interface ScannedItem {
  serial: string;
  name: string;
  status: ItemStatus;
}

export default function StocktakePage() {
  const [expectedStock, setExpectedStock] = useState<ExpectedItem[]>([]);
  const [scannedItems, setScannedItems] = useState<ScannedItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [stockSessionId, setStockSessionId] = useState<string | null>(null);
  const [isScanning, setIsScanning] = useState(false);
  const [statusMessage, setStatusMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const scannerRef = useRef<Html5Qrcode | null>(null);

  useEffect(() => {
    let active = true;
    fetch('/api/stocktake')
      .then(r => r.json())
      .then(data => {
        if (!active) return;
        setExpectedStock(Array.isArray(data) ? data : []);
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    return () => {
      const scanner = scannerRef.current;
      if (scanner) {
        void scanner.stop().catch(() => undefined);
        scanner.clear();
      }
    };
  }, []);

  const countableStock = useMemo(() => expectedStock.filter(item => item.status === 'in_stock'), [expectedStock]);
  const matched = scannedItems.filter(item => item.status === 'matched').length;
  const unexpected = scannedItems.filter(item => item.status === 'unexpected').length;
  const missing = countableStock.filter(item => !scannedItems.some(scan => scan.serial === item.serial)).length;

  const displayList = useMemo(
    () => [
      ...scannedItems,
      ...countableStock
        .filter(item => !scannedItems.some(scan => scan.serial === item.serial))
        .map(item => ({ serial: item.serial, name: item.name, status: 'missing' as ItemStatus })),
    ],
    [countableStock, scannedItems]
  );

  const recordScan = async (serial: string) => {
    if (!serial.trim() || scannedItems.some(item => item.serial === serial)) return;

    const expected = countableStock.find(item => item.serial === serial);
    const category: ItemStatus = expected ? 'matched' : 'unexpected';

    setBusy(true);
    setStatusMessage('');

    try {
      const res = await fetch('/api/stocktake', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ serial, category, sessionId: stockSessionId || undefined }),
      });
      const data = await res.json();
      if (!res.ok) {
        setStatusMessage(data.error || 'Unable to save scan.');
        return;
      }

      setStockSessionId(data.sessionId || stockSessionId);
      setScannedItems(prev => [{ serial, name: expected?.name || 'Unknown Item', status: category }, ...prev]);
      setStatusMessage(expected ? 'Matched item recorded.' : 'Unexpected item recorded.');
      if (window.navigator?.vibrate) window.navigator.vibrate(40);
    } catch {
      setStatusMessage('Network error while recording scan.');
    } finally {
      setBusy(false);
    }
  };

  const startScanner = async () => {
    if (isScanning) return;
    setIsScanning(true);
    setStatusMessage('Opening camera...');

    const qr = new Html5Qrcode('operations-reader');
    scannerRef.current = qr;

    try {
      await qr.start(
        { facingMode: 'environment' },
        { fps: 10, qrbox: { width: 240, height: 240 } },
        async (decodedText) => {
          await recordScan(decodedText);
          await stopScanner(qr);
        },
        () => undefined
      );
      setStatusMessage('Scan serial labels one at a time.');
    } catch {
      setIsScanning(false);
      setStatusMessage('Camera could not start.');
    }
  };

  const stopScanner = async (inst: Html5Qrcode | null = scannerRef.current) => {
    if (inst) {
      try {
        await inst.stop();
        await inst.clear();
      } catch {
        // ignore
      }
    }
    scannerRef.current = null;
    setIsScanning(false);
  };

  const finishCount = async () => {
    if (!stockSessionId) {
      setStatusMessage('Start scanning before closing the count.');
      return;
    }

    setBusy(true);
    try {
      const res = await fetch('/api/stocktake', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId: stockSessionId }),
      });
      const data = await res.json();
      if (!res.ok) {
        setStatusMessage(data.error || 'Unable to close the session.');
        return;
      }

      setStatusMessage('Stocktake complete.');
      setStockSessionId(null);
      setScannedItems([]);
    } catch {
      setStatusMessage('Network error while closing the count.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="animate-fade-in">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '20px', marginBottom: '24px' }}>
        <div>
          <h1>Stocktake</h1>
          <p className="subtitle">Use the camera to scan inventory and close the count when finished.</p>
        </div>
        <button onClick={isScanning ? () => stopScanner() : startScanner} disabled={busy} style={{ display: 'inline-flex', alignItems: 'center', gap: '8px', padding: '10px 14px', borderRadius: '10px', border: 'none', background: 'var(--primary)', color: '#0f1115', cursor: busy ? 'not-allowed' : 'pointer', fontWeight: 800 }}>
          <ScanLine size={15} />
          {isScanning ? 'Stop Scanner' : 'Start Scanner'}
        </button>
      </div>

      <div className="metrics-grid" style={{ marginTop: 0 }}>
        <div className="glass-panel" style={{ padding: '20px' }}>
          <div className="metric-value" style={{ color: 'var(--primary)' }}>{matched}</div>
          <div className="metric-label">Matched</div>
        </div>
        <div className="glass-panel" style={{ padding: '20px' }}>
          <div className="metric-value" style={{ color: 'var(--danger)' }}>{missing}</div>
          <div className="metric-label">Missing</div>
        </div>
        <div className="glass-panel" style={{ padding: '20px' }}>
          <div className="metric-value" style={{ color: 'var(--warning)' }}>{unexpected}</div>
          <div className="metric-label">Unexpected</div>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1.1fr 0.9fr', gap: '24px', marginTop: '24px', alignItems: 'start' }}>
        <div className="glass-panel">
          <div className="chart-header">
            <div>
              <h3>Count List</h3>
              <p className="subtitle" style={{ fontSize: '13px', marginTop: '2px' }}>{matched} of {countableStock.length} items scanned</p>
            </div>
          </div>

          {loading ? (
            <div style={{ textAlign: 'center', padding: '48px', color: 'var(--text-muted)', display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '8px' }}>
              <Loader2 className="spin" size={18} /> Loading stock list...
            </div>
          ) : countableStock.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '48px', color: 'var(--text-muted)' }}>
              No stock to count yet.
            </div>
          ) : (
            <div style={{ display: 'grid', gap: '10px' }}>
              {displayList.map((item, idx) => (
                <div key={`${item.serial}-${idx}`} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '14px 16px', borderRadius: '12px', background: 'var(--hover-bg)', border: '1px solid var(--panel-border)' }}>
                  <div>
                    <div style={{ fontWeight: 600 }}>{item.name}</div>
                    <div style={{ fontFamily: 'monospace', color: 'var(--text-muted)', fontSize: '13px', marginTop: '3px' }}>{item.serial}</div>
                  </div>
                  <div>
                    {item.status === 'matched' && <CheckCircle2 color="var(--primary)" size={18} />}
                    {item.status === 'missing' && <XCircle color="var(--danger)" size={18} />}
                    {item.status === 'unexpected' && <AlertTriangle color="var(--warning)" size={18} />}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="glass-panel">
          <h3 style={{ marginBottom: '12px' }}>Scanner</h3>
          <div id="operations-reader" style={{ width: '100%', minHeight: '320px', borderRadius: '16px', overflow: 'hidden', background: '#000', marginBottom: '14px' }} />

          {statusMessage && (
            <div style={{ marginBottom: '14px', padding: '12px 14px', borderRadius: '10px', background: 'var(--hover-bg)', border: '1px solid var(--panel-border)', color: 'var(--text-muted)', fontSize: '14px' }}>
              {busy ? <Loader2 size={14} className="spin" style={{ marginRight: '8px', verticalAlign: 'text-bottom' }} /> : null}
              {statusMessage}
            </div>
          )}

          <button onClick={finishCount} disabled={busy || !stockSessionId} style={{ width: '100%', padding: '12px 14px', borderRadius: '10px', border: '1px solid var(--panel-border)', background: 'transparent', color: 'var(--primary)', cursor: busy || !stockSessionId ? 'not-allowed' : 'pointer', fontWeight: 700 }}>
            Close Count
          </button>
        </div>
      </div>
    </div>
  );
}
