'use client';

import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import { ArrowLeftRight, CheckCircle2, Loader2, Package2, Search, ShieldCheck, Store, Truck } from 'lucide-react';

interface Location {
  id: string;
  name: string;
}

interface StockItem {
  serial: string;
  product_name: string;
  color?: string | null;
  size?: string | null;
  status: 'in_stock' | 'transferred';
  updated_at?: string;
  source_location_name?: string | null;
  transferred_at?: string;
  transfer_notes?: string | null;
}

type TabKey = 'send' | 'receive';

function formatItemLabel(item: StockItem) {
  return [item.product_name, item.color, item.size].filter(Boolean).join(' · ');
}

export default function TransfersPage() {
  const [activeTab, setActiveTab] = useState<TabKey>('send');
  const [locations, setLocations] = useState<Location[]>([]);
  const [loadingLocations, setLoadingLocations] = useState(true);

  const [sourceLocationId, setSourceLocationId] = useState('');
  const [destinationLocationId, setDestinationLocationId] = useState('');

  const [sourceStock, setSourceStock] = useState<StockItem[]>([]);
  const [incomingStock, setIncomingStock] = useState<StockItem[]>([]);

  const [loadingSource, setLoadingSource] = useState(false);
  const [loadingIncoming, setLoadingIncoming] = useState(false);
  const [sourceSearch, setSourceSearch] = useState('');
  const [incomingSearch, setIncomingSearch] = useState('');

  const [selectedSourceSerials, setSelectedSourceSerials] = useState<string[]>([]);
  const [selectedIncomingSerials, setSelectedIncomingSerials] = useState<string[]>([]);

  const [sending, setSending] = useState(false);
  const [accepting, setAccepting] = useState(false);
  const [sendError, setSendError] = useState('');
  const [sendSuccess, setSendSuccess] = useState('');
  const [receiveError, setReceiveError] = useState('');
  const [receiveSuccess, setReceiveSuccess] = useState('');

  useEffect(() => {
    fetch('/api/locations')
      .then((response) => response.json())
      .then((data) => {
        const nextLocations = Array.isArray(data) ? data : [];
        setLocations(nextLocations);
        const first = nextLocations[0]?.id || '';
        const second = nextLocations[1]?.id || first;
        setSourceLocationId(first);
        setDestinationLocationId(second);
      })
      .finally(() => setLoadingLocations(false));
  }, []);

  const selectedSourceCount = selectedSourceSerials.length;
  const selectedIncomingCount = selectedIncomingSerials.length;

  const filteredSourceStock = useMemo(() => {
    const query = sourceSearch.trim().toLowerCase();
    if (!query) return sourceStock;
    return sourceStock.filter((item) => {
      const haystack = `${item.serial} ${item.product_name} ${item.color || ''} ${item.size || ''}`.toLowerCase();
      return haystack.includes(query);
    });
  }, [sourceSearch, sourceStock]);

  const filteredIncomingStock = useMemo(() => {
    const query = incomingSearch.trim().toLowerCase();
    if (!query) return incomingStock;
    return incomingStock.filter((item) => {
      const haystack = `${item.serial} ${item.product_name} ${item.color || ''} ${item.size || ''} ${item.source_location_name || ''}`.toLowerCase();
      return haystack.includes(query);
    });
  }, [incomingSearch, incomingStock]);

  const sourceLocation = locations.find((loc) => loc.id === sourceLocationId);
  const destinationLocation = locations.find((loc) => loc.id === destinationLocationId);

  const loadSourceStock = async (locationId: string) => {
    if (!locationId) {
      setSourceStock([]);
      return;
    }

    setLoadingSource(true);
    try {
      const response = await fetch(`/api/transfers?kind=source&location_id=${encodeURIComponent(locationId)}`);
      const data = await response.json();
      if (!response.ok) {
        setSendError(data.error || 'Failed to load source stock.');
        setSourceStock([]);
        return;
      }

      setSourceStock(Array.isArray(data.items) ? data.items : []);
    } catch {
      setSendError('Failed to load source stock.');
      setSourceStock([]);
    } finally {
      setLoadingSource(false);
    }
  };

  const loadIncomingStock = async (locationId: string) => {
    if (!locationId) {
      setIncomingStock([]);
      return;
    }

    setLoadingIncoming(true);
    try {
      const response = await fetch(`/api/transfers?kind=incoming&location_id=${encodeURIComponent(locationId)}`);
      const data = await response.json();
      if (!response.ok) {
        setReceiveError(data.error || 'Failed to load incoming transfers.');
        setIncomingStock([]);
        return;
      }

      setIncomingStock(Array.isArray(data.items) ? data.items : []);
    } catch {
      setReceiveError('Failed to load incoming transfers.');
      setIncomingStock([]);
    } finally {
      setLoadingIncoming(false);
    }
  };

  useEffect(() => {
    void loadSourceStock(sourceLocationId);
  }, [sourceLocationId]);

  useEffect(() => {
    void loadIncomingStock(destinationLocationId);
  }, [destinationLocationId]);

  useEffect(() => {
    setSelectedSourceSerials([]);
  }, [sourceLocationId]);

  useEffect(() => {
    setSelectedIncomingSerials([]);
  }, [destinationLocationId]);

  const toggleSourceSerial = (serial: string) => {
    setSelectedSourceSerials((current) =>
      current.includes(serial) ? current.filter((item) => item !== serial) : [...current, serial]
    );
  };

  const toggleIncomingSerial = (serial: string) => {
    setSelectedIncomingSerials((current) =>
      current.includes(serial) ? current.filter((item) => item !== serial) : [...current, serial]
    );
  };

  const handleSend = async () => {
    setSendError('');
    setSendSuccess('');

    if (!sourceLocationId || !destinationLocationId) {
      setSendError('Select both locations.');
      return;
    }
    if (sourceLocationId === destinationLocationId) {
      setSendError('Source and destination must be different.');
      return;
    }
    if (selectedSourceSerials.length === 0) {
      setSendError('Select at least one stock item.');
      return;
    }

    setSending(true);
    try {
      const response = await fetch('/api/transfers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from_location_id: sourceLocationId,
          to_location_id: destinationLocationId,
          serials: selectedSourceSerials,
        }),
      });
      const data = await response.json();
      if (!response.ok) {
        setSendError(data.error || 'Transfer failed.');
        return;
      }

      const count = data.count || selectedSourceSerials.length;
      setSendSuccess(`Transferred ${count} item${count === 1 ? '' : 's'} to pending stock.`);
      setSelectedSourceSerials([]);
      await Promise.all([
        loadSourceStock(sourceLocationId),
        loadIncomingStock(destinationLocationId),
      ]);
    } catch {
      setSendError('Network error. Please try again.');
    } finally {
      setSending(false);
    }
  };

  const handleAccept = async () => {
    setReceiveError('');
    setReceiveSuccess('');

    if (!destinationLocationId) {
      setReceiveError('Select a destination location.');
      return;
    }
    if (selectedIncomingSerials.length === 0) {
      setReceiveError('Select at least one pending item.');
      return;
    }

    setAccepting(true);
    try {
      const response = await fetch('/api/transfers/accept', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          location_id: destinationLocationId,
          serials: selectedIncomingSerials,
        }),
      });
      const data = await response.json();
      if (!response.ok) {
        setReceiveError(data.error || 'Failed to accept transfer stock.');
        return;
      }

      const count = data.count || selectedIncomingSerials.length;
      setReceiveSuccess(`Accepted ${count} item${count === 1 ? '' : 's'} into active stock.`);
      setSelectedIncomingSerials([]);
      await loadIncomingStock(destinationLocationId);
    } catch {
      setReceiveError('Network error. Please try again.');
    } finally {
      setAccepting(false);
    }
  };

  const tabButtonStyle = (active: boolean): CSSProperties => ({
    padding: '11px 14px',
    borderRadius: '999px',
    border: `1px solid ${active ? 'rgba(74,222,128,0.35)' : 'var(--panel-border)'}`,
    background: active ? 'rgba(74,222,128,0.12)' : 'var(--hover-bg)',
    color: 'var(--text-main)',
    fontWeight: 700,
    fontSize: '13px',
    cursor: 'pointer',
    display: 'inline-flex',
    alignItems: 'center',
    gap: '8px',
  });

  return (
    <div className="animate-fade-in">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '20px', marginBottom: '24px' }}>
        <div>
          <h1>Transfers</h1>
          <p className="subtitle">Move stock between locations, then activate it at the destination when ready.</p>
        </div>
        <div className="tenant-badge">
          <ArrowLeftRight size={13} color="var(--secondary)" />
          Stock Movement
        </div>
      </div>

      <div style={{ display: 'flex', gap: '10px', marginBottom: '18px', flexWrap: 'wrap' }}>
        <button type="button" style={tabButtonStyle(activeTab === 'send')} onClick={() => setActiveTab('send')}>
          <Truck size={15} /> Send Stock
        </button>
        <button type="button" style={tabButtonStyle(activeTab === 'receive')} onClick={() => setActiveTab('receive')}>
          <ShieldCheck size={15} /> Receive Stock
        </button>
      </div>

      {activeTab === 'send' ? (
        <div className="glass-panel" style={{ display: 'grid', gap: '18px', maxWidth: '1180px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '16px', flexWrap: 'wrap' }}>
            <div>
              <h3 style={{ marginBottom: '8px' }}>Source stock</h3>
              <p className="subtitle" style={{ fontSize: '14px' }}>
                Choose stock from the source location and move it to the destination as pending inventory.
              </p>
            </div>
            <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
              <span className="tenant-badge"><Store size={13} /> {sourceLocation?.name || 'Source'}</span>
              <span className="tenant-badge"><Package2 size={13} /> {destinationLocation?.name || 'Destination'}</span>
            </div>
          </div>

          {loadingLocations ? (
            <div style={{ padding: '28px 0', textAlign: 'center', color: 'var(--text-muted)' }}>
              <Loader2 className="spin" size={18} /> Loading locations...
            </div>
          ) : (
            <>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px' }}>
                <div>
                  <label className="subtitle" style={{ display: 'block', marginBottom: '8px', fontSize: '13px', fontWeight: 600 }}>From</label>
                  <select value={sourceLocationId} onChange={(e) => setSourceLocationId(e.target.value)} style={{ width: '100%', padding: '12px 14px', borderRadius: '10px', border: '1px solid var(--panel-border)', background: 'var(--bg-color)', color: 'var(--text-main)' }}>
                    {locations.map((loc) => <option key={loc.id} value={loc.id}>{loc.name}</option>)}
                  </select>
                </div>
                <div>
                  <label className="subtitle" style={{ display: 'block', marginBottom: '8px', fontSize: '13px', fontWeight: 600 }}>To</label>
                  <select value={destinationLocationId} onChange={(e) => setDestinationLocationId(e.target.value)} style={{ width: '100%', padding: '12px 14px', borderRadius: '10px', border: '1px solid var(--panel-border)', background: 'var(--bg-color)', color: 'var(--text-main)' }}>
                    {locations.map((loc) => <option key={loc.id} value={loc.id}>{loc.name}</option>)}
                  </select>
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 0.8fr', gap: '18px', alignItems: 'start' }}>
                <div style={{ display: 'grid', gap: '14px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px', color: 'var(--text-muted)', fontSize: '13px' }}>
                      <span>{sourceStock.length} available</span>
                      <span>•</span>
                      <span>{selectedSourceCount} selected</span>
                    </div>
                    <div style={{ position: 'relative', minWidth: '240px', flex: '1 1 240px', maxWidth: '420px' }}>
                      <Search size={14} style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
                      <input
                        value={sourceSearch}
                        onChange={(e) => setSourceSearch(e.target.value)}
                        placeholder="Search source stock"
                        style={{ width: '100%', padding: '11px 12px 11px 36px', borderRadius: '10px', border: '1px solid var(--panel-border)', background: 'var(--bg-color)', color: 'var(--text-main)' }}
                      />
                    </div>
                  </div>

                  <div style={{ display: 'grid', gap: '10px', maxHeight: '520px', overflow: 'auto', paddingRight: '4px' }}>
                    {loadingSource ? (
                      <div style={{ padding: '28px 0', textAlign: 'center', color: 'var(--text-muted)' }}>
                        <Loader2 className="spin" size={18} /> Loading source stock...
                      </div>
                    ) : filteredSourceStock.length === 0 ? (
                      <div className="subtitle" style={{ fontSize: '13px' }}>No active stock found at this location.</div>
                    ) : filteredSourceStock.map((item) => {
                      const selected = selectedSourceSerials.includes(item.serial);
                      return (
                        <button
                          key={item.serial}
                          type="button"
                          onClick={() => toggleSourceSerial(item.serial)}
                          style={{
                            textAlign: 'left',
                            padding: '14px',
                            borderRadius: '14px',
                            border: `1px solid ${selected ? 'rgba(74,222,128,0.45)' : 'var(--panel-border)'}`,
                            background: selected ? 'rgba(74,222,128,0.08)' : 'var(--hover-bg)',
                            color: 'var(--text-main)',
                            cursor: 'pointer',
                            display: 'flex',
                            justifyContent: 'space-between',
                            gap: '14px',
                            alignItems: 'center',
                          }}
                        >
                          <div>
                            <div style={{ fontWeight: 700, marginBottom: '4px' }}>{formatItemLabel(item)}</div>
                            <div style={{ fontFamily: 'monospace', fontSize: '12px', color: 'var(--text-muted)' }}>{item.serial}</div>
                          </div>
                          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '6px' }}>
                            <span className="tenant-badge">{selected ? 'Selected' : 'Available'}</span>
                            <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>Tap to {selected ? 'remove' : 'add'}</span>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div className="glass-panel" style={{ padding: '18px', position: 'sticky', top: '18px' }}>
                  <h3 style={{ marginBottom: '8px' }}>Transfer queue</h3>
                  <p className="subtitle" style={{ fontSize: '13px', lineHeight: 1.6, marginBottom: '14px' }}>
                    Selected stock will move to the destination as pending inventory until it is accepted there.
                  </p>

                  <div style={{ display: 'grid', gap: '8px', marginBottom: '16px' }}>
                    {selectedSourceSerials.length === 0 ? (
                      <div className="subtitle" style={{ fontSize: '13px' }}>No stock selected.</div>
                    ) : selectedSourceSerials.map((serial) => {
                      const item = sourceStock.find((row) => row.serial === serial);
                      return (
                        <div key={serial} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '10px', padding: '10px 12px', borderRadius: '10px', border: '1px solid var(--panel-border)', background: 'var(--bg-color)' }}>
                          <div style={{ minWidth: 0 }}>
                            <div style={{ fontWeight: 700, fontSize: '13px' }}>{item ? formatItemLabel(item) : serial}</div>
                            <div style={{ fontFamily: 'monospace', fontSize: '12px', color: 'var(--text-muted)' }}>{serial}</div>
                          </div>
                          <button type="button" onClick={() => toggleSourceSerial(serial)} style={{ border: 'none', background: 'transparent', color: 'var(--text-muted)', cursor: 'pointer' }}>
                            Remove
                          </button>
                        </div>
                      );
                    })}
                  </div>

                  {sendError && <div style={{ marginBottom: '12px', padding: '12px 14px', borderRadius: '10px', border: '1px solid rgba(239,68,68,0.25)', background: 'rgba(239,68,68,0.08)', color: 'var(--danger)', fontSize: '14px' }}>{sendError}</div>}
                  {sendSuccess && <div style={{ marginBottom: '12px', padding: '12px 14px', borderRadius: '10px', border: '1px solid rgba(74,222,128,0.25)', background: 'rgba(74,222,128,0.08)', color: 'var(--primary)', fontSize: '14px', display: 'flex', alignItems: 'center', gap: '8px' }}><CheckCircle2 size={16} />{sendSuccess}</div>}

                  <button onClick={handleSend} disabled={sending} style={{ width: '100%', padding: '13px 18px', borderRadius: '10px', border: 'none', background: 'var(--primary)', color: '#0f1115', cursor: 'pointer', fontWeight: 800, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}>
                    {sending ? <Loader2 size={15} className="spin" /> : <ArrowLeftRight size={15} />}
                    Queue Transfer
                  </button>

                  <div style={{ display: 'flex', gap: '10px', color: 'var(--text-muted)', fontSize: '13px', marginTop: '14px' }}>
                    <span>{sourceLocation?.name || 'Source'}</span>
                    <span>→</span>
                    <span>{destinationLocation?.name || 'Destination'}</span>
                  </div>
                </div>
              </div>
            </>
          )}
        </div>
      ) : (
        <div className="glass-panel" style={{ display: 'grid', gap: '18px', maxWidth: '1180px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '16px', flexWrap: 'wrap' }}>
            <div>
              <h3 style={{ marginBottom: '8px' }}>Pending destination stock</h3>
              <p className="subtitle" style={{ fontSize: '14px' }}>
                Accept transferred items into active stock after labels are prepared.
              </p>
            </div>
            <span className="tenant-badge"><Package2 size={13} /> {destinationLocation?.name || 'Destination'}</span>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: '14px', alignItems: 'center' }}>
            <div>
              <label className="subtitle" style={{ display: 'block', marginBottom: '8px', fontSize: '13px', fontWeight: 600 }}>Destination</label>
              <select value={destinationLocationId} onChange={(e) => setDestinationLocationId(e.target.value)} style={{ width: '100%', padding: '12px 14px', borderRadius: '10px', border: '1px solid var(--panel-border)', background: 'var(--bg-color)', color: 'var(--text-main)' }}>
                {locations.map((loc) => <option key={loc.id} value={loc.id}>{loc.name}</option>)}
              </select>
            </div>
            <div style={{ display: 'grid', gap: '4px', textAlign: 'right' }}>
              <div style={{ fontSize: '13px', color: 'var(--text-muted)' }}>Awaiting acceptance</div>
              <div style={{ fontSize: '24px', fontWeight: 800, color: 'var(--text-main)' }}>{incomingStock.length}</div>
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '18px' }}>
            <div style={{ display: 'grid', gap: '10px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px', color: 'var(--text-muted)', fontSize: '13px' }}>
                  <span>{incomingStock.length} pending</span>
                  <span>•</span>
                  <span>{selectedIncomingCount} selected</span>
                </div>
                <div style={{ position: 'relative', minWidth: '240px', flex: '1 1 240px', maxWidth: '420px' }}>
                  <Search size={14} style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
                  <input
                    value={incomingSearch}
                    onChange={(e) => setIncomingSearch(e.target.value)}
                    placeholder="Search pending stock"
                    style={{ width: '100%', padding: '11px 12px 11px 36px', borderRadius: '10px', border: '1px solid var(--panel-border)', background: 'var(--bg-color)', color: 'var(--text-main)' }}
                  />
                </div>
              </div>

              <div style={{ display: 'grid', gap: '10px', maxHeight: '520px', overflow: 'auto', paddingRight: '4px' }}>
                {loadingIncoming ? (
                  <div style={{ padding: '28px 0', textAlign: 'center', color: 'var(--text-muted)' }}>
                    <Loader2 className="spin" size={18} /> Loading incoming stock...
                  </div>
                ) : filteredIncomingStock.length === 0 ? (
                  <div className="subtitle" style={{ fontSize: '13px' }}>No transferred stock is waiting here.</div>
                ) : filteredIncomingStock.map((item) => {
                  const selected = selectedIncomingSerials.includes(item.serial);
                  return (
                    <button
                      key={item.serial}
                      type="button"
                      onClick={() => toggleIncomingSerial(item.serial)}
                      style={{
                        textAlign: 'left',
                        padding: '14px',
                        borderRadius: '14px',
                        border: `1px solid ${selected ? 'rgba(96,165,250,0.45)' : 'var(--panel-border)'}`,
                        background: selected ? 'rgba(96,165,250,0.08)' : 'var(--hover-bg)',
                        color: 'var(--text-main)',
                        cursor: 'pointer',
                        display: 'flex',
                        justifyContent: 'space-between',
                        gap: '14px',
                        alignItems: 'center',
                      }}
                    >
                      <div>
                        <div style={{ fontWeight: 700, marginBottom: '4px' }}>{formatItemLabel(item)}</div>
                        <div style={{ fontFamily: 'monospace', fontSize: '12px', color: 'var(--text-muted)' }}>{item.serial}</div>
                        <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginTop: '4px' }}>
                          From {item.source_location_name || 'unknown'}
                        </div>
                      </div>
                      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '6px' }}>
                        <span className="tenant-badge">{selected ? 'Selected' : 'Pending'}</span>
                        <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>Tap to {selected ? 'remove' : 'add'}</span>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="glass-panel" style={{ padding: '18px' }}>
              <h3 style={{ marginBottom: '8px' }}>Acceptance queue</h3>
              <p className="subtitle" style={{ fontSize: '13px', lineHeight: 1.6, marginBottom: '14px' }}>
                Mark staged items as active stock once labels are ready and the destination is ready to account for them.
              </p>

              <div style={{ display: 'grid', gap: '8px', marginBottom: '16px' }}>
                {selectedIncomingSerials.length === 0 ? (
                  <div className="subtitle" style={{ fontSize: '13px' }}>No pending items selected.</div>
                ) : selectedIncomingSerials.map((serial) => {
                  const item = incomingStock.find((row) => row.serial === serial);
                  return (
                    <div key={serial} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '10px', padding: '10px 12px', borderRadius: '10px', border: '1px solid var(--panel-border)', background: 'var(--bg-color)' }}>
                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontWeight: 700, fontSize: '13px' }}>{item ? formatItemLabel(item) : serial}</div>
                        <div style={{ fontFamily: 'monospace', fontSize: '12px', color: 'var(--text-muted)' }}>{serial}</div>
                      </div>
                      <button type="button" onClick={() => toggleIncomingSerial(serial)} style={{ border: 'none', background: 'transparent', color: 'var(--text-muted)', cursor: 'pointer' }}>
                        Remove
                      </button>
                    </div>
                  );
                })}
              </div>

              {receiveError && <div style={{ marginBottom: '12px', padding: '12px 14px', borderRadius: '10px', border: '1px solid rgba(239,68,68,0.25)', background: 'rgba(239,68,68,0.08)', color: 'var(--danger)', fontSize: '14px' }}>{receiveError}</div>}
              {receiveSuccess && <div style={{ marginBottom: '12px', padding: '12px 14px', borderRadius: '10px', border: '1px solid rgba(74,222,128,0.25)', background: 'rgba(74,222,128,0.08)', color: 'var(--primary)', fontSize: '14px', display: 'flex', alignItems: 'center', gap: '8px' }}><CheckCircle2 size={16} />{receiveSuccess}</div>}

              <button onClick={handleAccept} disabled={accepting} style={{ width: '100%', padding: '13px 18px', borderRadius: '10px', border: 'none', background: 'var(--primary)', color: '#0f1115', cursor: 'pointer', fontWeight: 800, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}>
                {accepting ? <Loader2 size={15} className="spin" /> : <ShieldCheck size={15} />}
                Activate Stock
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
