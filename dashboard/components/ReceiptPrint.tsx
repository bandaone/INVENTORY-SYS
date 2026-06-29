'use client';
import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { QRCodeSVG } from 'qrcode.react';

export interface ReceiptItem {
  name: string;
  size?: string | null;
  color?: string | null;
  price: number;
  quantity: number;
  discountPercent?: number;
  discountAmount?: number;
  lineTotal?: number;
}

export interface ReceiptData {
  number: string;
  total: number;
  subtotal: number;
  tax: number;
  taxRatePercent: number;
  discountTotal: number;
  businessName: string;
  businessPhone: string;
  receiptLogoDataUrl?: string | null;
  zraTpin: string;
  zraEnabled: boolean;
  items: ReceiptItem[];
  payment_method: string;
  cashierName: string;
  locationName: string;
  amountTendered: number;
  change: number;
}

interface Props {
  storeName: string;
  footerMessage: string;
  receipt: ReceiptData | null;
  onPrintComplete?: () => void;
}

// Right-align a value in a fixed-width mono column
function row(label: string, value: string, width = 32): string {
  const gap = width - label.length - value.length;
  return label + ' '.repeat(Math.max(gap, 1)) + value;
}

export default function ReceiptPrint({ storeName, footerMessage, receipt, onPrintComplete }: Props) {
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    if (receipt && mounted) {
      const timer = setTimeout(() => {
        const originalTitle = document.title;
        document.title = `Receipt_${receipt.number}_${new Date().toISOString().slice(0,10)}`;
        window.print();
        document.title = originalTitle;
        if (onPrintComplete) onPrintComplete();
      }, 600);
      return () => clearTimeout(timer);
    }
  }, [receipt, mounted, onPrintComplete]);

  if (!mounted || !receipt) return null;

  const now = new Date();
  const dateStr = now.toLocaleDateString('en-ZM', { day: '2-digit', month: 'short', year: 'numeric' });
  const timeStr = now.toLocaleTimeString('en-ZM', { hour: '2-digit', minute: '2-digit', second: '2-digit' });

  // QR code payload — encodes the key receipt identifiers for ZRA validation
  const qrPayload = JSON.stringify({
    receipt: receipt.number,
    tpin: receipt.zraTpin || 'N/A',
    total: Number(receipt.total).toFixed(2),
    vat: Number(receipt.tax).toFixed(2),
    date: now.toISOString(),
  });

  const printStyle = `
    @media screen {
      .zra-receipt-root { display: none !important; }
    }
    @media print {
      @page { margin: 4mm 2mm; }

      * { box-sizing: border-box; }

      body {
        background: white !important;
        margin: 0 !important;
        padding: 0 !important;
        color: black !important;
        -webkit-print-color-adjust: exact;
        print-color-adjust: exact;
      }

      /* Hide everything in the app layout */
      body > div:not(.zra-receipt-root) { display: none !important; }
      #__next { display: none !important; }

      .zra-receipt-root {
        display: block !important;
        width: 100%;
        max-width: 58mm;
        margin: 0 auto;
        font-family: 'Courier New', Courier, monospace;
        font-size: 8pt;
        line-height: 1.35;
        color: #000;
        background: #fff;
      }

      .r-center  { text-align: center; }
      .r-bold    { font-weight: bold; }
      .r-large   { font-size: 11pt; font-weight: bold; }
      .r-xlarge  { font-size: 13pt; font-weight: bold; letter-spacing: 1px; }
      .r-small   { font-size: 7pt; color: #333; }
      .r-dash    { border-top: 1px dashed #000; margin: 4px 0; }
      .r-solid   { border-top: 1px solid #000; margin: 4px 0; }
      .r-double  { border-top: 3px double #000; margin: 4px 0; }
      .r-row     { display: flex; justify-content: space-between; margin-bottom: 1px; }
      .r-row-bold { display: flex; justify-content: space-between; font-weight: bold; font-size: 10pt; margin: 3px 0; }
      .r-indent  { padding-left: 4mm; font-size: 7pt; color: #444; }
      .r-tag     { background: #000; color: #fff; padding: 1px 4px; font-size: 7pt; display: inline-block; }
      .r-qr      { display: flex; justify-content: center; margin: 6px 0 4px; }
      .r-block   { margin: 4px 0; }
      .r-logo    { display: flex; justify-content: center; align-items: center; margin-bottom: 3px; }
      .r-logo img { max-width: 42mm; max-height: 18mm; object-fit: contain; display: block; }
    }
  `;

  const content = (
    <div className="zra-receipt-root">
      <style dangerouslySetInnerHTML={{ __html: printStyle }} />

      {/* ── HEADER ── */}
      <div className="r-center r-block">
        {receipt.receiptLogoDataUrl && (
          <div className="r-logo">
            <img src={receipt.receiptLogoDataUrl} alt={`${receipt.businessName || storeName} logo`} />
          </div>
        )}
        <div className="r-xlarge">{(receipt.businessName || storeName).toUpperCase()}</div>
        {receipt.locationName && <div className="r-small">{receipt.locationName}</div>}
        {receipt.businessPhone && <div className="r-small">Tel: {receipt.businessPhone}</div>}
        {receipt.zraTpin && (
          <div className="r-small r-bold">TPIN: {receipt.zraTpin}</div>
        )}
      </div>

      <div className="r-solid" />

      {/* ── TRANSACTION META ── */}
      <div className="r-block">
        <div className="r-row r-small">
          <span>Date:</span><span>{dateStr}</span>
        </div>
        <div className="r-row r-small">
          <span>Time:</span><span>{timeStr}</span>
        </div>
        <div className="r-row r-small">
          <span>Receipt No:</span><span className="r-bold">{receipt.number}</span>
        </div>
        <div className="r-row r-small">
          <span>Cashier:</span><span>{receipt.cashierName || 'Staff'}</span>
        </div>
      </div>

      <div className="r-solid" />

      {/* ── COLUMN HEADERS ── */}
      <div className="r-small r-bold" style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
        <span style={{ width: '24px', textAlign: 'left' }}>QTY</span>
        <span style={{ flex: 1 }}>ITEM</span>
        <span style={{ width: '50px', textAlign: 'right' }}>TOTAL</span>
      </div>

      <div className="r-solid" />

      {/* ── LINE ITEMS ── */}
      {receipt.items.map((item, idx) => (
        <div key={idx} className="r-block" style={{ marginBottom: '6px', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <span style={{ width: '24px', textAlign: 'left' }}>{item.quantity}</span>
          <span style={{ flex: 1, paddingRight: '6px', wordBreak: 'break-word', lineHeight: '1.2' }}>
            {item.name} {receipt.zraEnabled ? (receipt.taxRatePercent > 0 ? ' (A)' : ' (E)') : ''}
            
            {(item.size || item.color) && (
              <div style={{ fontSize: '7pt', color: '#555', marginTop: '1px', fontStyle: 'italic' }}>
                {[
                  item.size && `Size: ${item.size}`,
                  item.color && `Color: ${item.color}`
                ].filter(Boolean).join(' | ')}
              </div>
            )}

            {item.quantity > 1 && (
              <div style={{ fontSize: '7pt', color: '#444', marginTop: '2px' }}>
                @ K{Number(item.price).toFixed(2)}
              </div>
            )}
          </span>
          <span style={{ width: '50px', textAlign: 'right' }}>
            {Number(item.price * item.quantity).toFixed(2)}
          </span>
        </div>
      ))}

      <div className="r-solid" />

      {/* ── FINANCIAL SUMMARY ── */}
      <div className="r-block">
        <div className="r-row r-small">
          <span>Subtotal (Excl. VAT):</span>
          <span>K{Number(receipt.subtotal).toFixed(2)}</span>
        </div>
        {Number(receipt.discountTotal) > 0 && (
          <div className="r-row r-small">
            <span>Discounts:</span>
            <span>-K{Number(receipt.discountTotal).toFixed(2)}</span>
          </div>
        )}
        <div className="r-row r-small">
          <span>VAT @ {receipt.taxRatePercent}% (Incl.):</span>
          <span>K{Number(receipt.tax).toFixed(2)}</span>
        </div>
      </div>

      <div className="r-solid" />

      <div className="r-row-bold">
        <span>TOTAL PAYABLE:</span>
        <span>K{Number(receipt.total).toFixed(2)}</span>
      </div>

      <div className="r-solid" />

      {/* ── PAYMENT ── */}
      <div className="r-block">
        <div className="r-row r-small">
          <span>Payment Method:</span>
          <span className="r-bold">{receipt.payment_method.replace('_', ' ')}</span>
        </div>
        <div className="r-row r-small">
          <span>Amount Tendered:</span>
          <span>K{Number(receipt.amountTendered).toFixed(2)}</span>
        </div>
        <div className="r-row r-small">
          <span>Change:</span>
          <span>K{Number(receipt.change).toFixed(2)}</span>
        </div>
      </div>

      <div className="r-solid" />

      {/* ── FOOTER ── */}
      <div className="r-center r-block" style={{ marginTop: '6px' }}>
        <div className="r-small" style={{ whiteSpace: 'pre-wrap' }}>{footerMessage}</div>
      </div>

      {/* Physical cut line for thermal roll */}
      <div style={{ marginTop: '12px', textAlign: 'center', fontSize: '7pt' }}>✂ - - - - - - - - - - - - - - - -</div>

    </div>
  );

  return createPortal(content, document.body);
}
