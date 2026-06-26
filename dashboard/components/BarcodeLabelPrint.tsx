'use client';

import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import Barcode from 'react-barcode';
import { QRCodeSVG } from 'qrcode.react';

export interface PrintLabel {
  serial: string;
  barcodeToken?: string;
  barcodePayload?: string;
  name: string;
  category?: string | null;
  subtype?: string | null;
  size: string | null;
  color: string | null;
  retail_price: number;
}

interface Props {
  storeName: string;
  labels: PrintLabel[];
}

export default function BarcodeLabelPrint({ storeName, labels }: Props) {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted || !labels || labels.length === 0) return null;

  const content = (
    <div className="print-only-labels">
      <style dangerouslySetInnerHTML={{ __html: `
        @media screen {
          .print-only-labels { display: none !important; }
        }
        @media print {
          @page { size: 60mm 35mm; margin: 0; }
          body { background: white !important; margin: 0 !important; padding: 0 !important; color: black !important; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
          body > *:not(.print-only-labels) { display: none !important; }
          body > .print-only-labels { display: block !important; width: 60mm !important; }
          .label-page { width: 60mm; height: 35mm; page-break-after: always; box-sizing: border-box; padding: 2mm; display: flex; flex-direction: column; justify-content: space-between; overflow: hidden; font-family: sans-serif; }
          .label-header { display: flex; justify-content: space-between; align-items: flex-start; line-height: 1.1; }
          .label-store { font-weight: 800; font-size: 5pt; text-transform: uppercase; letter-spacing: 0.5px; }
          .label-product { font-size: 5pt; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 42mm; margin-top: 1px; }
          .label-price { font-weight: 900; font-size: 7pt; }
          .label-barcode-container { display: flex; justify-content: center; align-items: center; width: 100%; height: 18mm; overflow: hidden; gap: 3mm; }
          .label-serial { font-size: 4.5pt; text-align: center; letter-spacing: 0.3px; margin-top: -1mm; }
        }
      `}} />
      {labels.map((label, i) => (
        <div key={i} className="label-page">
          <div className="label-header">
            <div style={{ minWidth: 0, flex: 1, paddingRight: '2mm' }}>
              <div className="label-store">{storeName}</div>
              <div className="label-product">
                {label.name} {label.size ? `· ${label.size}` : ''} {label.color ? `· ${label.color}` : ''}
              </div>
            </div>
            <div className="label-price">K{Number(label.retail_price).toFixed(2)}</div>
          </div>
          <div className="label-barcode-container">
            {label.barcodePayload ? (
              <QRCodeSVG value={label.barcodePayload} size={72} level="M" includeMargin={false} />
            ) : (
              <Barcode 
                value={label.barcodeToken || label.serial} 
                format="CODE128"
                width={1.05}
                height={26}
                displayValue={false}
                margin={0}
                background="transparent"
              />
            )}
          </div>
          <div className="label-serial">
            {label.category ? `${label.category}${label.subtype ? ` · ${label.subtype}` : ''} · ` : ''}{label.serial}
          </div>
        </div>
      ))}
    </div>
  );

  return createPortal(content, document.body);
}
