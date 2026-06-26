'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import {
  CheckCircle2,
  Download,
  FileSpreadsheet,
  Loader2,
  PackagePlus,
  PencilLine,
  Upload,
  XCircle,
} from 'lucide-react';
import * as XLSX from 'xlsx';
import BarcodeLabelPrint, { type PrintLabel } from '@/components/BarcodeLabelPrint';
import {
  buildSourceColumns,
  groupRowsByFamily,
  inferColumnMap,
  normalizeHeader,
  resolveSheetRow,
  type CanonicalField,
  type ColumnMap,
  type ParsedSheetRow,
  type SourceColumn,
} from '@/lib/smart-import';

interface Variant {
  id: string;
  name: string;
  category: string | null;
  subtype: string | null;
  color: string | null;
  size: string | null;
  retail_price: number;
  barcode_token?: string | null;
  search_text?: string | null;
  metadata?: Record<string, unknown> | null;
  missing_fields?: string[] | string | null;
  detail_status?: 'complete' | 'needs_review' | null;
}

interface Location {
  id: string;
  name: string;
}

interface SheetPreviewRow extends ParsedSheetRow {
  status: 'ready' | 'warning' | 'invalid';
  message?: string;
  matchedVariant: Variant | null;
}

const QUICK_TEMPLATE_HEADERS = [
  'product_name',
  'category',
  'subtype',
  'color',
  'size',
  'code',
  'quantity',
  'retail_price',
  'description',
];

const FIELD_LABELS: Record<CanonicalField, string> = {
  product_name: 'Product Name',
  category: 'Category',
  subtype: 'Subtype',
  description: 'Description',
  color: 'Color',
  size: 'Size',
  code: 'Code / SKU',
  quantity: 'Quantity',
  cost_price: 'Cost Price',
  retail_price: 'Retail Price',
};

function normalize(value: unknown) {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

function formatVariantLabel(v: Pick<Variant, 'name' | 'category' | 'subtype' | 'color' | 'size'>) {
  return [v.category, v.subtype, v.name, v.size, v.color].filter(Boolean).join(' · ');
}

function getVariantDescription(value: Variant['metadata']) {
  if (!value || typeof value !== 'object') return '';
  const metadata = value as Record<string, unknown>;
  return String(metadata.description ?? metadata.notes ?? metadata.note ?? '').trim();
}

function getVariantFamilyLabel(v: Pick<Variant, 'name' | 'category' | 'subtype'>) {
  return [v.category, v.subtype, v.name].filter(Boolean).join(' / ') || v.name;
}

function parseMissingFields(value: Variant['missing_fields']) {
  if (Array.isArray(value)) return value.map((entry) => String(entry).trim()).filter(Boolean);
  if (!value) return [];
  try {
    const parsed = JSON.parse(String(value));
    return Array.isArray(parsed) ? parsed.map((entry) => String(entry).trim()).filter(Boolean) : [];
  } catch {
    return String(value)
      .replace(/^\[/, '')
      .replace(/\]$/, '')
      .split(',')
      .map((entry) => entry.trim().replace(/^"|"$/g, ''))
      .filter(Boolean);
  }
}

function toNumber(value: unknown) {
  const parsed = Number(String(value ?? '').replace(/[, ]+/g, ''));
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeHeadersFromRawRows(rows: Record<string, unknown>[]) {
  const headers = new Set<string>();
  rows.forEach((row) => Object.keys(row || {}).forEach((key) => headers.add(key)));
  return Array.from(headers);
}

function mergeColumnMap(base: ColumnMap, override: Partial<ColumnMap>) {
  return { ...base, ...override };
}

function downloadTemplate() {
  const workbook = XLSX.utils.book_new();
  const worksheet = XLSX.utils.json_to_sheet(
    [
      {
        product_name: 'Blue Denim Jacket',
        category: 'Jackets',
        subtype: 'Denim',
        color: 'Blue',
        size: 'M',
        code: 'DJ-001',
        quantity: 12,
        retail_price: 450,
        description: 'Optional description',
      },
    ],
    { header: QUICK_TEMPLATE_HEADERS }
  );

  XLSX.utils.book_append_sheet(workbook, worksheet, 'Receive Template');
  const output = XLSX.write(workbook, { bookType: 'xlsx', type: 'array' });
  const blob = new Blob([output], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = 'stock-receive-template.xlsx';
  link.click();
  URL.revokeObjectURL(url);
}

export default function ReceivePage() {
  const searchParams = useSearchParams();
  const [variants, setVariants] = useState<Variant[]>([]);
  const [locations, setLocations] = useState<Location[]>([]);
  const [loading, setLoading] = useState(true);
  const [mode, setMode] = useState<'quick' | 'sheet'>('quick');
  const [quickMode, setQuickMode] = useState<'existing' | 'new'>('existing');
  const [selectedVariantId, setSelectedVariantId] = useState('');
  const [selectedLocationId, setSelectedLocationId] = useState('');
  const [quantity, setQuantity] = useState(1);
  const [newStock, setNewStock] = useState({ name: '', category: '', subtype: '', color: '', size: '', retail_price: '' });
  const [stockSearch, setStockSearch] = useState('');
  const [editingVariant, setEditingVariant] = useState<Variant | null>(null);
  const [editDraft, setEditDraft] = useState({
    name: '',
    category: '',
    subtype: '',
    color: '',
    size: '',
    barcode_token: '',
    retail_price: '',
    description: '',
  });
  const [submitting, setSubmitting] = useState(false);
  const [savingVariant, setSavingVariant] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [storeName, setStoreName] = useState('Retail OS');
  const [printLabels, setPrintLabels] = useState<PrintLabel[]>([]);

  const [sheetName, setSheetName] = useState('');
  const [sheetRows, setSheetRows] = useState<SheetPreviewRow[]>([]);
  const [sheetHeaders, setSheetHeaders] = useState<string[]>([]);
  const [sheetColumns, setSheetColumns] = useState<SourceColumn[]>([]);
  const [parsingSheet, setParsingSheet] = useState(false);
  const [sheetError, setSheetError] = useState('');
  const [sourceSignature, setSourceSignature] = useState('');
  const [profileName, setProfileName] = useState('');
  const [columnMap, setColumnMap] = useState<ColumnMap>({});
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const openedEditIdRef = useRef<string | null>(null);

  useEffect(() => {
    const name = document.cookie.match(new RegExp('(^| )tenant_name=([^;]+)'))?.[2];
    if (name) setStoreName(decodeURIComponent(name));

    Promise.all([
      fetch('/api/catalog').then((r) => r.json()),
      fetch('/api/locations').then((r) => r.json()),
    ])
      .then(([catalogData, locData]) => {
        const nextVariants = Array.isArray(catalogData) ? catalogData : [];
        const nextLocations = Array.isArray(locData) ? locData : [];
        setVariants(nextVariants);
        setLocations(nextLocations);
        if (nextVariants[0]) setSelectedVariantId(nextVariants[0].id);
        if (nextLocations[0]) setSelectedLocationId(nextLocations[0].id);
      })
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    const editId = searchParams.get('edit');
    if (!editId || !variants.length || editingVariant || openedEditIdRef.current === editId) return;
    const variant = variants.find((item) => item.id === editId);
    if (!variant) return;
    setSelectedVariantId(variant.id);
    openedEditIdRef.current = editId;
    openVariantEditor(variant);
  }, [editingVariant, searchParams, variants]);

  useEffect(() => {
    if (!printLabels.length) return;
    const timer = window.setTimeout(() => window.print(), 450);
    return () => window.clearTimeout(timer);
  }, [printLabels]);

  const selectedVariant = useMemo(
    () => variants.find((v) => v.id === selectedVariantId) || null,
    [selectedVariantId, variants]
  );

  const groupedRows = useMemo(
    () => groupRowsByFamily(sheetRows) as Record<string, SheetPreviewRow[]>,
    [sheetRows]
  );

  const groupedVariants = useMemo(() => {
    const term = normalize(stockSearch);
    const filtered = variants.filter((variant) => {
      if (!term) return true;
      const missing = parseMissingFields(variant.missing_fields).join(' ');
      return normalize([
        variant.name,
        variant.category,
        variant.subtype,
        variant.color,
        variant.size,
        variant.barcode_token,
        variant.search_text,
        missing,
      ].filter(Boolean).join(' ')).includes(term);
    });

    const grouped = filtered.reduce<Record<string, Variant[]>>((acc, variant) => {
      const key = getVariantFamilyLabel(variant);
      if (!acc[key]) acc[key] = [];
      acc[key].push(variant);
      return acc;
    }, {});

    return Object.entries(grouped)
      .map(([familyLabel, items]) => ({
        familyLabel,
        items: items.sort((a, b) => formatVariantLabel(a).localeCompare(formatVariantLabel(b))),
        attentionCount: items.filter((item) => {
          const missing = parseMissingFields(item.missing_fields);
          return (item.detail_status || 'complete') !== 'complete' || missing.length > 0;
        }).length,
      }))
      .sort((a, b) => a.familyLabel.localeCompare(b.familyLabel));
  }, [stockSearch, variants]);

  const importSummary = useMemo(() => {
    const readyRows = sheetRows.filter((row) => row.status === 'ready');
    const reviewRows = sheetRows.filter((row) => row.status === 'warning');
    const blockedRows = sheetRows.filter((row) => row.status === 'invalid');
    const receivableRows = [...readyRows, ...reviewRows];
    const totalUnits = receivableRows.reduce((sum, row) => sum + row.quantity, 0);
    const newItems = receivableRows.filter((row) => !row.matchedVariant).length;

    return {
      totalRows: sheetRows.length,
      readyRows: receivableRows.length,
      invalidRows: reviewRows.length,
      blockedRows: blockedRows.length,
      totalUnits,
      newItems,
    };
  }, [sheetRows]);

  const openVariantEditor = (variant: Variant) => {
    setEditingVariant(variant);
    const description = getVariantDescription(variant.metadata);
    setEditDraft({
      name: variant.name || '',
      category: variant.category || '',
      subtype: variant.subtype || '',
      color: variant.color || '',
      size: variant.size || '',
      barcode_token: variant.barcode_token || '',
      retail_price: String(variant.retail_price ?? ''),
      description,
    });
  };

  const saveVariantEdit = async () => {
    if (!editingVariant) return;
    setSavingVariant(true);
    setError('');
    try {
      const missingFields = [
        !editDraft.name.trim() && 'name',
        !editDraft.category.trim() && 'category',
        !editDraft.subtype.trim() && 'subtype',
        !editDraft.color.trim() && 'color',
        !editDraft.size.trim() && 'size',
        !editDraft.barcode_token.trim() && 'code',
        (!editDraft.retail_price || !Number.isFinite(Number(editDraft.retail_price))) && 'retail_price',
      ].filter(Boolean) as string[];

      const res = await fetch(`/api/catalog/${editingVariant.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: editDraft.name.trim(),
          category: editDraft.category.trim() || null,
          subtype: editDraft.subtype.trim() || null,
          color: editDraft.color.trim() || null,
          size: editDraft.size.trim() || null,
          barcode_token: editDraft.barcode_token.trim() || null,
          retail_price: Number(editDraft.retail_price),
          description: editDraft.description.trim() || null,
          missing_fields: missingFields,
          detail_status: missingFields.length > 0 ? 'needs_review' : 'complete',
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || 'Failed to update stock item.');
        return;
      }

      setVariants((prev) =>
        prev
          .map((variant) => (variant.id === editingVariant.id ? data.variant : variant))
          .sort((a, b) => formatVariantLabel(a).localeCompare(formatVariantLabel(b)))
      );
      setSelectedVariantId(data.variant?.id || editingVariant.id);
      setEditingVariant(null);
      setSuccess('Stock item updated successfully.');
    } catch {
      setError('Failed to update stock item.');
    } finally {
      setSavingVariant(false);
    }
  };

  const matchVariant = (row: ParsedSheetRow) => {
    const code = normalize(row.code);
    const productName = normalize(row.productName);
    const color = normalize(row.color);
    const size = normalize(row.size);

    if (code) {
      const exactByCode = variants.find((variant) => {
        const haystack = normalize([
          variant.barcode_token,
          variant.search_text,
          variant.name,
          variant.category,
          variant.subtype,
          variant.color,
          variant.size,
        ].filter(Boolean).join(' '));
        return haystack.includes(code) || normalize(variant.barcode_token) === code;
      });
      if (exactByCode) return exactByCode;
    }

    if (productName) {
      const exactByName = variants.find((variant) =>
        normalize(variant.name) === productName &&
        normalize(variant.color) === color &&
        normalize(variant.size) === size
      );
      if (exactByName) return exactByName;
    }

    return null;
  };

  const parseSheet = async (file: File) => {
    setParsingSheet(true);
    setSheetError('');
    setSheetRows([]);
    setSheetName(file.name);
    setSuccess('');
    setError('');
    setProfileName('');
    setSourceSignature('');

    try {
      const buffer = await file.arrayBuffer();
      const workbook = XLSX.read(buffer, { type: 'array' });
      const sheet = workbook.Sheets[workbook.SheetNames[0]];

      if (!sheet) {
        setSheetError('No sheet found in the file.');
        return;
      }

      const rawRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: '' });
      if (!rawRows.length) {
        setSheetError('The selected file does not contain any data rows.');
        return;
      }

      const headers = normalizeHeadersFromRawRows(rawRows);
      const normalizedRows = rawRows.map((row) => {
        const normalized: Record<string, unknown> = {};
        Object.entries(row).forEach(([key, value]) => {
          normalized[normalizeHeader(key)] = value;
        });
        return normalized;
      });

      const signature = headers.map((header) => normalizeHeader(header)).join('|');
      setSheetHeaders(headers);
      setSheetColumns(buildSourceColumns(headers));
      setSourceSignature(signature);

      const profileRes = await fetch(`/api/import-profiles?source_signature=${encodeURIComponent(signature)}`);
      let nextMap = inferColumnMap(headers, normalizedRows);

      if (profileRes.ok) {
        const profileData = await profileRes.json();
        const profile = profileData?.profile;
        if (profile?.mapping) {
          nextMap = mergeColumnMap(nextMap, profile.mapping);
          setProfileName(profile.profile_name || file.name);
        }
      }

      setColumnMap(nextMap);

      const previewRows = normalizedRows.map((row, index) => {
        const resolved = resolveSheetRow(index + 2, row, nextMap, headers);
        const matchedVariant = matchVariant(resolved);
        const hasLabel = Boolean(
          resolved.productName ||
          resolved.category ||
          resolved.subtype ||
          resolved.description ||
          resolved.color ||
          resolved.size ||
          resolved.code
        );
        const hasPrice = resolved.retailPrice !== null || resolved.costPrice !== null;
        const hasIdentity = Boolean(resolved.productName || resolved.description || resolved.code || resolved.familyLabel);
        const isReceivable = Boolean(hasIdentity || matchedVariant);
        const hasMissingDetails = resolved.missingFields.length > 0;

        return {
          ...resolved,
          matchedVariant,
          status: isReceivable ? (hasMissingDetails || !hasPrice ? 'warning' : 'ready') : 'invalid',
          message: isReceivable
            ? matchedVariant
              ? hasMissingDetails
                ? `Matched to an existing catalog item. Missing: ${resolved.missingFields.join(', ')}`
                : 'Matched to an existing catalog item.'
              : hasMissingDetails || !hasPrice
                ? `Will save and flag this item for review. ${resolved.missingFields.length ? `Missing: ${resolved.missingFields.join(', ')}` : 'Price will be set to 0 until reviewed.'}`
                : 'Will create a new catalog item from this row.'
            : 'No product identity found. Map a name, description, code, or identifying column before receiving.',
        } as SheetPreviewRow;
      });

      setSheetRows(previewRows);
    } catch {
      setSheetError('This file could not be read.');
    } finally {
      setParsingSheet(false);
    }
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    await parseSheet(file);
    e.target.value = '';
  };

  const handleSubmitQuick = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSuccess('');

    if (!selectedLocationId) {
      setError('Choose a location.');
      return;
    }
    if (quantity < 1) {
      setError('Quantity must be at least 1.');
      return;
    }

    const isNewStock = quickMode === 'new';
    const retailPrice = Number(newStock.retail_price);

    if (isNewStock) {
      if (!newStock.name.trim()) {
        setError('Product name is required.');
        return;
      }
      if (!Number.isFinite(retailPrice) || retailPrice < 0) {
        setError('Retail price is required for a new item.');
        return;
      }
    } else if (!selectedVariantId) {
      setError('Choose a product.');
      return;
    }

    setSubmitting(true);
    try {
      const payload = isNewStock
        ? {
            location_id: selectedLocationId,
            quantity,
            new_variant: {
              name: newStock.name.trim(),
              category: newStock.category.trim() || null,
              subtype: newStock.subtype.trim() || null,
              color: newStock.color.trim() || null,
              size: newStock.size.trim() || null,
              retail_price: retailPrice,
            },
          }
        : {
            variant_id: selectedVariantId,
            location_id: selectedLocationId,
            quantity,
          };

      const res = await fetch('/api/receive', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      const data = await res.json();
      if (!res.ok) {
        setError(data.error || 'Failed to receive stock.');
        return;
      }

      setSuccess(`Received ${quantity} item${quantity === 1 ? '' : 's'} successfully.`);
      setPrintLabels(data.labels || []);
      setQuantity(1);
      if (isNewStock && data.variant?.id) {
        setVariants((prev) => {
          const filtered = prev.filter((v) => v.id !== data.variant.id);
          return [...filtered, data.variant].sort((a, b) => formatVariantLabel(a).localeCompare(formatVariantLabel(b)));
        });
        setSelectedVariantId(data.variant.id);
        setQuickMode('existing');
        setNewStock({ name: '', category: '', subtype: '', color: '', size: '', retail_price: '' });
      }
    } catch {
      setError('Network error. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  const updateColumnMap = (field: CanonicalField, headerKey: string) => {
    setColumnMap((prev) => ({
      ...prev,
      [field]: headerKey || null,
    }));
  };

  const submitSheet = async () => {
    setError('');
    setSuccess('');

    if (!selectedLocationId) {
      setError('Choose a location.');
      return;
    }
    if (!sheetRows.length) {
      setError('Upload a spreadsheet first.');
      return;
    }

    const readyRows = sheetRows.filter((row) => row.status === 'ready' || row.status === 'warning');
    if (!readyRows.length) {
      setError('No rows are ready to receive.');
      return;
    }
    const blockedRows = sheetRows.filter((row) => row.status === 'invalid');
    if (blockedRows.length) {
      setError(`${blockedRows.length} row${blockedRows.length === 1 ? '' : 's'} cannot be received because no product identity was found. Rows with missing details can still be received and reviewed later.`);
      return;
    }

    const totalUnits = readyRows.reduce((sum, row) => sum + row.quantity, 0);

    setSubmitting(true);
    try {
      const res = await fetch('/api/receive', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          location_id: selectedLocationId,
          sheet_import: {
            rows: readyRows,
            headers: sheetHeaders,
            mapping: columnMap,
            source_signature: sourceSignature,
            source_name: sheetName,
            profile_name: profileName || sheetName,
          },
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        setError(data.error || 'Failed to receive spreadsheet.');
        return;
      }

      setSuccess(`Received ${totalUnits} item${totalUnits === 1 ? '' : 's'} from spreadsheet.`);
      setPrintLabels(data.labels || []);
      setSheetRows([]);
      setSheetName('');
      setSheetHeaders([]);
      setSheetColumns([]);
      setColumnMap({});
      setProfileName('');
      setSourceSignature('');
    } catch {
      setError('Network error. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  const clearSheet = () => {
    setSheetRows([]);
    setSheetName('');
    setSheetHeaders([]);
    setSheetColumns([]);
    setColumnMap({});
    setProfileName('');
    setSourceSignature('');
    setSheetError('');
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const fieldOptions = [{ key: '', label: 'Not mapped' }, ...sheetColumns.map((column) => ({ key: column.key, label: column.label }))];

  const selectedVariantAttention = selectedVariant
    ? parseMissingFields(selectedVariant.missing_fields)
    : [];

  if (loading) {
    return (
      <div className="animate-fade-in" style={{ padding: '40px', color: 'var(--text-muted)' }}>
        <Loader2 className="spin" size={18} /> Loading catalog and locations...
      </div>
    );
  }

  return (
    <div className="animate-fade-in">
      <BarcodeLabelPrint storeName={storeName} labels={printLabels} />

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '20px', marginBottom: '24px' }}>
        <div>
          <h1>Receive Goods</h1>
          <p className="subtitle">Fast intake for single items and spreadsheet batches.</p>
        </div>
        <div className="tenant-badge">
          <PackagePlus size={13} color="var(--primary)" />
          Stock Intake
        </div>
      </div>

      <div className="metrics-grid" style={{ marginTop: 0, marginBottom: '24px' }}>
        <div className="glass-panel" style={{ padding: '18px 20px' }}>
          <div className="metric-value" style={{ fontSize: '28px' }}>{variants.length}</div>
          <div className="metric-label">Catalog Items</div>
        </div>
        <div className="glass-panel" style={{ padding: '18px 20px' }}>
          <div className="metric-value" style={{ fontSize: '28px' }}>{locations.length}</div>
          <div className="metric-label">Locations</div>
        </div>
        <div className="glass-panel" style={{ padding: '18px 20px' }}>
          <div className="metric-value" style={{ fontSize: '28px' }}>{mode === 'sheet' ? importSummary.totalUnits : quantity}</div>
          <div className="metric-label">{mode === 'sheet' ? 'Units in Sheet' : 'Units Ready'}</div>
        </div>
        <div className="glass-panel" style={{ padding: '18px 20px' }}>
          <div className="metric-value" style={{ fontSize: '28px' }}>{mode === 'sheet' ? importSummary.newItems : 0}</div>
          <div className="metric-label">New Items</div>
        </div>
      </div>

      <div className="glass-panel" style={{ display: 'grid', gap: '22px' }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '10px' }}>
          <button
            type="button"
            onClick={() => setMode('quick')}
            style={{
              padding: '10px 14px',
              borderRadius: '10px',
              border: `1px solid ${mode === 'quick' ? 'var(--primary)' : 'var(--panel-border)'}`,
              background: mode === 'quick' ? 'rgba(74,222,128,0.08)' : 'var(--hover-bg)',
              color: mode === 'quick' ? 'var(--primary)' : 'var(--text-muted)',
              cursor: 'pointer',
              fontWeight: 700,
            }}
          >
            Quick Receive
          </button>
          <button
            type="button"
            onClick={() => setMode('sheet')}
            style={{
              padding: '10px 14px',
              borderRadius: '10px',
              border: `1px solid ${mode === 'sheet' ? 'var(--secondary)' : 'var(--panel-border)'}`,
              background: mode === 'sheet' ? 'rgba(96,165,250,0.08)' : 'var(--hover-bg)',
              color: mode === 'sheet' ? 'var(--secondary)' : 'var(--text-muted)',
              cursor: 'pointer',
              fontWeight: 700,
            }}
          >
            Spreadsheet Import
          </button>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '14px' }}>
          <div>
            <label className="subtitle" style={{ display: 'block', marginBottom: '8px', fontSize: '13px', fontWeight: 600 }}>Location</label>
            <select
              value={selectedLocationId}
              onChange={(e) => setSelectedLocationId(e.target.value)}
              style={{ width: '100%', padding: '12px 14px', borderRadius: '10px', border: '1px solid var(--panel-border)', background: 'var(--bg-color)', color: 'var(--text-main)' }}
            >
              {locations.map((loc) => <option key={loc.id} value={loc.id}>{loc.name}</option>)}
            </select>
          </div>

          {quickMode === 'existing' ? (
            <div>
              <label className="subtitle" style={{ display: 'block', marginBottom: '8px', fontSize: '13px', fontWeight: 600 }}>Selected Product</label>
              <div style={{ width: '100%', padding: '12px 14px', borderRadius: '10px', border: '1px solid var(--panel-border)', background: 'var(--hover-bg)', color: 'var(--text-main)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px' }}>
                <span>{selectedVariant ? formatVariantLabel(selectedVariant) : 'Select a product'}</span>
                <span style={{ color: 'var(--text-muted)', fontSize: '13px' }}>{selectedVariant ? `K${Number(selectedVariant.retail_price).toFixed(2)}` : ''}</span>
              </div>
            </div>
          ) : (
            <div>
              <label className="subtitle" style={{ display: 'block', marginBottom: '8px', fontSize: '13px', fontWeight: 600 }}>New Item</label>
              <div style={{ width: '100%', padding: '12px 14px', borderRadius: '10px', border: '1px solid var(--panel-border)', background: 'var(--hover-bg)', color: 'var(--text-muted)' }}>
                Create and receive in one step
              </div>
            </div>
          )}
        </div>

        {mode === 'quick' ? (
          <form onSubmit={handleSubmitQuick} style={{ display: 'grid', gap: '18px' }}>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '10px' }}>
              <button
                type="button"
                onClick={() => setQuickMode('existing')}
                style={{
                  padding: '10px 14px',
                  borderRadius: '10px',
                  border: `1px solid ${quickMode === 'existing' ? 'var(--primary)' : 'var(--panel-border)'}`,
                  background: quickMode === 'existing' ? 'rgba(74,222,128,0.08)' : 'var(--hover-bg)',
                  color: quickMode === 'existing' ? 'var(--primary)' : 'var(--text-muted)',
                  cursor: 'pointer',
                  fontWeight: 700,
                }}
              >
                Existing Stock
              </button>
              <button
                type="button"
                onClick={() => setQuickMode('new')}
                style={{
                  padding: '10px 14px',
                  borderRadius: '10px',
                  border: `1px solid ${quickMode === 'new' ? 'var(--secondary)' : 'var(--panel-border)'}`,
                  background: quickMode === 'new' ? 'rgba(96,165,250,0.08)' : 'var(--hover-bg)',
                  color: quickMode === 'new' ? 'var(--secondary)' : 'var(--text-muted)',
                  cursor: 'pointer',
                  fontWeight: 700,
                }}
              >
                New Stock
              </button>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '14px' }}>
              {quickMode === 'existing' ? (
                <div style={{ gridColumn: '1 / -1', display: 'grid', gap: '12px' }}>
                  <div>
                    <label className="subtitle" style={{ display: 'block', marginBottom: '8px', fontSize: '13px', fontWeight: 600 }}>Product</label>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '12px 14px', borderRadius: '10px', border: '1px solid var(--panel-border)', background: 'var(--bg-color)' }}>
                      <input
                        value={stockSearch}
                        onChange={(e) => setStockSearch(e.target.value)}
                        placeholder="Search stock by code, color, size, description..."
                        style={{ flex: 1, border: 'none', outline: 'none', background: 'transparent', color: 'var(--text-main)' }}
                      />
                      <span style={{ color: 'var(--text-muted)', fontSize: '12px', whiteSpace: 'nowrap' }}>
                        {groupedVariants.reduce((sum, group) => sum + group.items.length, 0)} shown
                      </span>
                    </div>
                  </div>

                  {selectedVariant && (
                    <div style={{ padding: '14px 16px', borderRadius: '12px', border: '1px solid var(--panel-border)', background: 'var(--hover-bg)', display: 'flex', justifyContent: 'space-between', gap: '16px', alignItems: 'center' }}>
                      <div>
                        <div style={{ fontWeight: 700 }}>{formatVariantLabel(selectedVariant)}</div>
                        <div style={{ color: 'var(--text-muted)', fontSize: '12px', marginTop: '4px' }}>
                          {selectedVariant.barcode_token || 'No code'} · K{Number(selectedVariant.retail_price).toFixed(2)}
                        </div>
                        {selectedVariantAttention.length > 0 && (
                          <div style={{ color: 'var(--warning)', fontSize: '12px', marginTop: '4px' }}>
                            Missing: {selectedVariantAttention.join(', ')}
                          </div>
                        )}
                      </div>
                      <button
                        type="button"
                        onClick={() => openVariantEditor(selectedVariant)}
                        style={{ padding: '10px 14px', borderRadius: '10px', border: '1px solid var(--panel-border)', background: 'transparent', color: 'var(--text-main)', cursor: 'pointer', fontWeight: 700 }}
                      >
                        Edit Item
                      </button>
                    </div>
                  )}

                  <div style={{ maxHeight: '340px', overflowY: 'auto', border: '1px solid var(--panel-border)', borderRadius: '12px', background: 'var(--bg-color)' }}>
                    {groupedVariants.length === 0 ? (
                      <div style={{ padding: '18px', color: 'var(--text-muted)', fontSize: '13px' }}>No stock matches your search.</div>
                    ) : groupedVariants.map((group) => (
                      <div key={group.familyLabel} style={{ borderBottom: '1px solid var(--panel-border)' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', gap: '12px', padding: '12px 14px', background: 'var(--hover-bg)' }}>
                          <div>
                            <div style={{ fontWeight: 700 }}>{group.familyLabel}</div>
                            <div style={{ color: 'var(--text-muted)', fontSize: '12px' }}>{group.items.length} item{group.items.length === 1 ? '' : 's'}</div>
                          </div>
                          {group.attentionCount > 0 && (
                            <span style={{ padding: '6px 10px', borderRadius: '999px', background: 'rgba(245, 158, 11, 0.12)', color: 'var(--warning)', fontSize: '12px', fontWeight: 700 }}>
                              {group.attentionCount} need review
                            </span>
                          )}
                        </div>
                        <div style={{ display: 'grid' }}>
                          {group.items.map((variant) => {
                            const missing = parseMissingFields(variant.missing_fields);
                            const needsReview = (variant.detail_status || 'complete') !== 'complete' || missing.length > 0;
                            const isActive = variant.id === selectedVariantId;
                            return (
                              <div
                                key={variant.id}
                                style={{
                                  display: 'flex',
                                  justifyContent: 'space-between',
                                  alignItems: 'stretch',
                                  gap: '12px',
                                  padding: '12px 14px',
                                  borderTop: '1px solid var(--panel-border)',
                                  background: isActive ? 'rgba(74,222,128,0.08)' : 'transparent',
                                  color: 'var(--text-main)',
                                  textAlign: 'left',
                                }}
                              >
                                <button
                                  type="button"
                                  onClick={() => setSelectedVariantId(variant.id)}
                                  style={{
                                    flex: 1,
                                    border: 'none',
                                    background: 'transparent',
                                    color: 'inherit',
                                    textAlign: 'left',
                                    padding: 0,
                                    cursor: 'pointer',
                                  }}
                                >
                                  <div style={{ fontWeight: 700 }}>{formatVariantLabel(variant)}</div>
                                  <div style={{ color: 'var(--text-muted)', fontSize: '12px', marginTop: '4px' }}>
                                    {variant.barcode_token || 'No code'} · K{Number(variant.retail_price).toFixed(2)}
                                  </div>
                                  {missing.length > 0 && (
                                    <div style={{ color: 'var(--warning)', fontSize: '12px', marginTop: '4px' }}>
                                      Missing: {missing.join(', ')}
                                    </div>
                                  )}
                                </button>
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', alignItems: 'flex-end', minWidth: '92px' }}>
                                  {needsReview && (
                                    <span style={{ padding: '6px 10px', borderRadius: '999px', background: 'rgba(245, 158, 11, 0.12)', color: 'var(--warning)', fontSize: '12px', fontWeight: 700 }}>
                                      Needs review
                                    </span>
                                  )}
                                  <button
                                    type="button"
                                    onClick={() => openVariantEditor(variant)}
                                    style={{ padding: '6px 10px', borderRadius: '999px', border: '1px solid var(--panel-border)', background: 'var(--bg-color)', color: 'var(--text-muted)', cursor: 'pointer', fontSize: '12px', fontWeight: 700 }}
                                  >
                                    Edit
                                  </button>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                <>
                  <div>
                    <label className="subtitle" style={{ display: 'block', marginBottom: '8px', fontSize: '13px', fontWeight: 600 }}>Product Name</label>
                    <input
                      value={newStock.name}
                      onChange={(e) => setNewStock((v) => ({ ...v, name: e.target.value }))}
                      placeholder="e.g. Classic Polo Shirt"
                      style={{ width: '100%', padding: '12px 14px', borderRadius: '10px', border: '1px solid var(--panel-border)', background: 'var(--bg-color)', color: 'var(--text-main)' }}
                    />
                  </div>
                  <div>
                    <label className="subtitle" style={{ display: 'block', marginBottom: '8px', fontSize: '13px', fontWeight: 600 }}>Category</label>
                    <input
                      value={newStock.category}
                      onChange={(e) => setNewStock((v) => ({ ...v, category: e.target.value }))}
                      placeholder="Optional"
                      style={{ width: '100%', padding: '12px 14px', borderRadius: '10px', border: '1px solid var(--panel-border)', background: 'var(--bg-color)', color: 'var(--text-main)' }}
                    />
                  </div>
                  <div>
                    <label className="subtitle" style={{ display: 'block', marginBottom: '8px', fontSize: '13px', fontWeight: 600 }}>Subtype</label>
                    <input
                      value={newStock.subtype}
                      onChange={(e) => setNewStock((v) => ({ ...v, subtype: e.target.value }))}
                      placeholder="Optional"
                      style={{ width: '100%', padding: '12px 14px', borderRadius: '10px', border: '1px solid var(--panel-border)', background: 'var(--bg-color)', color: 'var(--text-main)' }}
                    />
                  </div>
                  <div>
                    <label className="subtitle" style={{ display: 'block', marginBottom: '8px', fontSize: '13px', fontWeight: 600 }}>Color</label>
                    <input
                      value={newStock.color}
                      onChange={(e) => setNewStock((v) => ({ ...v, color: e.target.value }))}
                      placeholder="Optional"
                      style={{ width: '100%', padding: '12px 14px', borderRadius: '10px', border: '1px solid var(--panel-border)', background: 'var(--bg-color)', color: 'var(--text-main)' }}
                    />
                  </div>
                  <div>
                    <label className="subtitle" style={{ display: 'block', marginBottom: '8px', fontSize: '13px', fontWeight: 600 }}>Size</label>
                    <input
                      value={newStock.size}
                      onChange={(e) => setNewStock((v) => ({ ...v, size: e.target.value }))}
                      placeholder="Optional"
                      style={{ width: '100%', padding: '12px 14px', borderRadius: '10px', border: '1px solid var(--panel-border)', background: 'var(--bg-color)', color: 'var(--text-main)' }}
                    />
                  </div>
                  <div>
                    <label className="subtitle" style={{ display: 'block', marginBottom: '8px', fontSize: '13px', fontWeight: 600 }}>Retail Price</label>
                    <input
                      type="number"
                      min={0}
                      step="0.01"
                      value={newStock.retail_price}
                      onChange={(e) => setNewStock((v) => ({ ...v, retail_price: e.target.value }))}
                      placeholder="0.00"
                      style={{ width: '100%', padding: '12px 14px', borderRadius: '10px', border: '1px solid var(--panel-border)', background: 'var(--bg-color)', color: 'var(--text-main)' }}
                    />
                  </div>
                </>
              )}

              <div>
                <label className="subtitle" style={{ display: 'block', marginBottom: '8px', fontSize: '13px', fontWeight: 600 }}>Quantity</label>
                <input
                  type="number"
                  min={1}
                  value={quantity}
                  onChange={(e) => setQuantity(Math.max(1, Number(e.target.value) || 1))}
                  style={{ width: '100%', padding: '12px 14px', borderRadius: '10px', border: '1px solid var(--panel-border)', background: 'var(--bg-color)', color: 'var(--text-main)' }}
                />
              </div>
            </div>

            {error && (
              <div style={{ padding: '12px 14px', borderRadius: '10px', border: '1px solid rgba(239,68,68,0.25)', background: 'rgba(239,68,68,0.08)', color: 'var(--danger)', fontSize: '14px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                <XCircle size={16} />{error}
              </div>
            )}
            {success && (
              <div style={{ padding: '12px 14px', borderRadius: '10px', border: '1px solid rgba(74,222,128,0.25)', background: 'rgba(74,222,128,0.08)', color: 'var(--primary)', fontSize: '14px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                <CheckCircle2 size={16} />{success}
              </div>
            )}

            <button
              type="submit"
              disabled={submitting}
              style={{ width: 'fit-content', padding: '13px 18px', borderRadius: '10px', border: 'none', background: 'var(--primary)', color: '#0f1115', cursor: 'pointer', fontWeight: 800, display: 'inline-flex', alignItems: 'center', gap: '8px' }}
            >
              {submitting ? <Loader2 size={15} className="spin" /> : <PackagePlus size={15} />}
              Receive Stock
            </button>
          </form>
        ) : (
          <div style={{ display: 'grid', gap: '18px' }}>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '10px', alignItems: 'center' }}>
              <input
                ref={fileInputRef}
                type="file"
                accept=".xlsx,.xls,.csv"
                onChange={handleFileChange}
                style={{ display: 'none' }}
              />
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                style={{ display: 'inline-flex', alignItems: 'center', gap: '8px', padding: '10px 14px', borderRadius: '10px', border: 'none', background: 'var(--primary)', color: '#0f1115', cursor: 'pointer', fontWeight: 800 }}
              >
                <Upload size={15} />
                Upload Sheet
              </button>
              <button
                type="button"
                onClick={downloadTemplate}
                style={{ display: 'inline-flex', alignItems: 'center', gap: '8px', padding: '10px 14px', borderRadius: '10px', border: '1px solid var(--panel-border)', background: 'var(--hover-bg)', color: 'var(--text-main)', cursor: 'pointer', fontWeight: 700 }}
              >
                <Download size={15} />
                Template
              </button>
              {sheetName && (
                <div style={{ display: 'inline-flex', alignItems: 'center', gap: '8px', padding: '10px 14px', borderRadius: '10px', border: '1px solid var(--panel-border)', background: 'var(--hover-bg)', color: 'var(--text-main)', fontSize: '13px' }}>
                  <FileSpreadsheet size={15} />
                  {sheetName}
                </div>
              )}
              {sheetRows.length > 0 && (
                <button
                  type="button"
                  onClick={clearSheet}
                  style={{ padding: '10px 14px', borderRadius: '10px', border: '1px solid var(--panel-border)', background: 'transparent', color: 'var(--text-muted)', cursor: 'pointer', fontWeight: 700 }}
                >
                  Clear
                </button>
              )}
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '12px' }}>
              {(Object.keys(FIELD_LABELS) as CanonicalField[]).map((field) => (
                <div key={field}>
                  <label className="subtitle" style={{ display: 'block', marginBottom: '8px', fontSize: '13px', fontWeight: 600 }}>
                    <PencilLine size={13} style={{ display: 'inline-block', marginRight: '6px' }} />
                    {FIELD_LABELS[field]}
                  </label>
                  <select
                    value={columnMap[field] || ''}
                    onChange={(e) => updateColumnMap(field, e.target.value)}
                    style={{ width: '100%', padding: '12px 14px', borderRadius: '10px', border: '1px solid var(--panel-border)', background: 'var(--bg-color)', color: 'var(--text-main)' }}
                  >
                    {fieldOptions.map((option) => (
                      <option key={`${field}:${option.key || 'none'}`} value={option.key}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </div>
              ))}
            </div>

            {parsingSheet && (
              <div style={{ padding: '12px 14px', borderRadius: '10px', border: '1px solid var(--panel-border)', background: 'var(--hover-bg)', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: '8px' }}>
                <Loader2 className="spin" size={16} /> Reading sheet...
              </div>
            )}

            {sheetError && (
              <div style={{ padding: '12px 14px', borderRadius: '10px', border: '1px solid rgba(239,68,68,0.25)', background: 'rgba(239,68,68,0.08)', color: 'var(--danger)', fontSize: '14px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                <XCircle size={16} />{sheetError}
              </div>
            )}

              {sheetRows.length > 0 && (
                <div style={{ display: 'grid', gap: '14px' }}>
                <div className="metrics-grid" style={{ marginTop: 0 }}>
                  <div className="glass-panel" style={{ padding: '18px 20px' }}>
                    <div className="metric-value" style={{ fontSize: '28px' }}>{importSummary.readyRows}</div>
                    <div className="metric-label">Ready Rows</div>
                  </div>
                  <div className="glass-panel" style={{ padding: '18px 20px' }}>
                    <div className="metric-value" style={{ fontSize: '28px', color: 'var(--warning)' }}>{importSummary.invalidRows}</div>
                    <div className="metric-label">Needs Review</div>
                  </div>
                  <div className="glass-panel" style={{ padding: '18px 20px' }}>
                    <div className="metric-value" style={{ fontSize: '28px' }}>{importSummary.totalUnits}</div>
                    <div className="metric-label">Total Units</div>
                  </div>
                  <div className="glass-panel" style={{ padding: '18px 20px' }}>
                    <div className="metric-value" style={{ fontSize: '28px' }}>{importSummary.newItems}</div>
                    <div className="metric-label">New Catalog Items</div>
                  </div>
                </div>

                <div style={{ display: 'grid', gap: '14px' }}>
                  {Object.entries(groupedRows).map(([familyLabel, rows]) => (
                    <div key={familyLabel} style={{ border: '1px solid var(--panel-border)', borderRadius: '14px', overflow: 'hidden' }}>
                      <div style={{ padding: '14px 16px', background: 'var(--hover-bg)', display: 'flex', justifyContent: 'space-between', gap: '12px', alignItems: 'center' }}>
                        <div>
                          <div style={{ fontWeight: 700, color: 'var(--text-main)' }}>{familyLabel}</div>
                          <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>{rows.length} row{rows.length !== 1 ? 's' : ''}</div>
                        </div>
                        <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>Profile: {profileName || 'Auto-detected'}</div>
                      </div>
                      <div style={{ overflowX: 'auto' }}>
                        <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: '1020px', background: 'var(--bg-color)' }}>
                          <thead>
                            <tr style={{ textAlign: 'left', color: 'var(--text-muted)', fontSize: '12px', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                              <th style={{ padding: '14px 16px' }}>Row</th>
                              <th style={{ padding: '14px 16px' }}>Product</th>
                              <th style={{ padding: '14px 16px' }}>Category</th>
                              <th style={{ padding: '14px 16px' }}>Color</th>
                              <th style={{ padding: '14px 16px' }}>Size</th>
                              <th style={{ padding: '14px 16px' }}>Code</th>
                              <th style={{ padding: '14px 16px' }}>Price</th>
                              <th style={{ padding: '14px 16px' }}>Qty</th>
                              <th style={{ padding: '14px 16px' }}>Status</th>
                            </tr>
                          </thead>
                          <tbody>
                            {rows.map((row) => (
                              <tr key={`${familyLabel}-${row.rowNumber}`} style={{ borderTop: '1px solid var(--panel-border)' }}>
                                <td style={{ padding: '14px 16px', color: 'var(--text-muted)' }}>{row.rowNumber}</td>
                                <td style={{ padding: '14px 16px' }}>{row.productName || row.familyLabel}</td>
                                <td style={{ padding: '14px 16px', color: 'var(--text-muted)' }}>{[row.category, row.subtype].filter(Boolean).join(' / ') || '—'}</td>
                                <td style={{ padding: '14px 16px', color: 'var(--text-muted)' }}>{row.color || '—'}</td>
                                <td style={{ padding: '14px 16px', color: 'var(--text-muted)' }}>{row.size || '—'}</td>
                                <td style={{ padding: '14px 16px', color: 'var(--text-muted)' }}>{row.code || '—'}</td>
                                <td style={{ padding: '14px 16px', color: 'var(--text-muted)' }}>
                                  {row.retailPrice !== null
                                    ? row.retailPrice
                                    : row.costPrice !== null
                                      ? row.costPrice
                                      : '—'}
                                </td>
                                <td style={{ padding: '14px 16px', fontWeight: 700 }}>{row.quantity}</td>
                                <td style={{ padding: '14px 16px' }}>
                                  <span style={{
                                    display: 'inline-flex',
                                    alignItems: 'center',
                                    gap: '6px',
                                    padding: '6px 10px',
                                    borderRadius: '999px',
                                    fontSize: '12px',
                                    fontWeight: 700,
                                    background: row.status === 'ready'
                                      ? 'rgba(74,222,128,0.12)'
                                      : row.status === 'warning'
                                        ? 'rgba(245,158,11,0.14)'
                                        : 'rgba(239,68,68,0.12)',
                                    color: row.status === 'ready'
                                      ? 'var(--primary)'
                                      : row.status === 'warning'
                                        ? 'var(--warning)'
                                        : 'var(--danger)',
                                  }}>
                                    {row.status === 'ready' ? 'Ready' : row.status === 'warning' ? 'Needs Review' : 'Invalid'}
                                  </span>
                                  {row.matchedVariant && (
                                    <div style={{ color: 'var(--text-muted)', fontSize: '12px', marginTop: '6px' }}>
                                      Matched: {formatVariantLabel(row.matchedVariant)}
                                    </div>
                                  )}
                                  {row.message && (
                                    <div style={{ color: 'var(--text-muted)', fontSize: '12px', marginTop: '4px' }}>{row.message}</div>
                                  )}
                                  {row.missingFields.length > 0 && (
                                    <div style={{ color: 'var(--warning)', fontSize: '12px', marginTop: '4px' }}>
                                      Missing fields: {row.missingFields.join(', ')}
                                    </div>
                                  )}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  ))}
                </div>

                {error && (
                  <div style={{ padding: '12px 14px', borderRadius: '10px', border: '1px solid rgba(239,68,68,0.25)', background: 'rgba(239,68,68,0.08)', color: 'var(--danger)', fontSize: '14px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <XCircle size={16} />{error}
                  </div>
                )}
                {success && (
                  <div style={{ padding: '12px 14px', borderRadius: '10px', border: '1px solid rgba(74,222,128,0.25)', background: 'rgba(74,222,128,0.08)', color: 'var(--primary)', fontSize: '14px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <CheckCircle2 size={16} />{success}
                  </div>
                )}

                <button
                  type="button"
                  onClick={submitSheet}
                  disabled={submitting || sheetRows.some((row) => row.status === 'invalid')}
                  style={{ width: 'fit-content', padding: '13px 18px', borderRadius: '10px', border: 'none', background: 'var(--secondary)', color: '#0f1115', cursor: submitting || sheetRows.some((row) => row.status === 'invalid') ? 'not-allowed' : 'pointer', fontWeight: 800, display: 'inline-flex', alignItems: 'center', gap: '8px', opacity: submitting || sheetRows.some((row) => row.status === 'invalid') ? 0.65 : 1 }}
                >
                  {submitting ? <Loader2 size={15} className="spin" /> : <PackagePlus size={15} />}
                  Receive Sheet
                </button>
              </div>
            )}
          </div>
                )}

        {editingVariant && (
          <div
            style={{
              position: 'fixed',
              inset: 0,
              background: 'rgba(2, 6, 23, 0.72)',
              display: 'grid',
              placeItems: 'center',
              padding: '20px',
              zIndex: 60,
            }}
            onClick={() => !savingVariant && setEditingVariant(null)}
          >
            <div
              style={{
                width: 'min(820px, 100%)',
                maxHeight: '90vh',
                overflowY: 'auto',
                background: 'var(--bg-color)',
                border: '1px solid var(--panel-border)',
                borderRadius: '18px',
                boxShadow: '0 24px 80px rgba(0,0,0,0.35)',
                padding: '20px',
              }}
              onClick={(e) => e.stopPropagation()}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: '16px', alignItems: 'flex-start', marginBottom: '18px' }}>
                <div>
                  <h2 style={{ margin: 0 }}>Edit Stock Item</h2>
                  <p className="subtitle" style={{ marginTop: '6px' }}>
                    Fix missing details once and the catalog, search, inventory, and POS views will all pick it up.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => !savingVariant && setEditingVariant(null)}
                  style={{ border: '1px solid var(--panel-border)', background: 'transparent', color: 'var(--text-muted)', borderRadius: '10px', padding: '8px 12px', cursor: 'pointer', fontWeight: 700 }}
                >
                  Close
                </button>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '14px' }}>
                <div>
                  <label className="subtitle" style={{ display: 'block', marginBottom: '8px', fontSize: '13px', fontWeight: 600 }}>Product Name</label>
                  <input
                    value={editDraft.name}
                    onChange={(e) => setEditDraft((v) => ({ ...v, name: e.target.value }))}
                    style={{ width: '100%', padding: '12px 14px', borderRadius: '10px', border: '1px solid var(--panel-border)', background: 'var(--hover-bg)', color: 'var(--text-main)' }}
                  />
                </div>
                <div>
                  <label className="subtitle" style={{ display: 'block', marginBottom: '8px', fontSize: '13px', fontWeight: 600 }}>Category</label>
                  <input
                    value={editDraft.category}
                    onChange={(e) => setEditDraft((v) => ({ ...v, category: e.target.value }))}
                    style={{ width: '100%', padding: '12px 14px', borderRadius: '10px', border: '1px solid var(--panel-border)', background: 'var(--hover-bg)', color: 'var(--text-main)' }}
                  />
                </div>
                <div>
                  <label className="subtitle" style={{ display: 'block', marginBottom: '8px', fontSize: '13px', fontWeight: 600 }}>Subtype</label>
                  <input
                    value={editDraft.subtype}
                    onChange={(e) => setEditDraft((v) => ({ ...v, subtype: e.target.value }))}
                    style={{ width: '100%', padding: '12px 14px', borderRadius: '10px', border: '1px solid var(--panel-border)', background: 'var(--hover-bg)', color: 'var(--text-main)' }}
                  />
                </div>
                <div>
                  <label className="subtitle" style={{ display: 'block', marginBottom: '8px', fontSize: '13px', fontWeight: 600 }}>Color</label>
                  <input
                    value={editDraft.color}
                    onChange={(e) => setEditDraft((v) => ({ ...v, color: e.target.value }))}
                    style={{ width: '100%', padding: '12px 14px', borderRadius: '10px', border: '1px solid var(--panel-border)', background: 'var(--hover-bg)', color: 'var(--text-main)' }}
                  />
                </div>
                <div>
                  <label className="subtitle" style={{ display: 'block', marginBottom: '8px', fontSize: '13px', fontWeight: 600 }}>Size</label>
                  <input
                    value={editDraft.size}
                    onChange={(e) => setEditDraft((v) => ({ ...v, size: e.target.value }))}
                    style={{ width: '100%', padding: '12px 14px', borderRadius: '10px', border: '1px solid var(--panel-border)', background: 'var(--hover-bg)', color: 'var(--text-main)' }}
                  />
                </div>
                <div>
                  <label className="subtitle" style={{ display: 'block', marginBottom: '8px', fontSize: '13px', fontWeight: 600 }}>Code / Barcode</label>
                  <input
                    value={editDraft.barcode_token}
                    onChange={(e) => setEditDraft((v) => ({ ...v, barcode_token: e.target.value }))}
                    style={{ width: '100%', padding: '12px 14px', borderRadius: '10px', border: '1px solid var(--panel-border)', background: 'var(--hover-bg)', color: 'var(--text-main)' }}
                  />
                </div>
                <div>
                  <label className="subtitle" style={{ display: 'block', marginBottom: '8px', fontSize: '13px', fontWeight: 600 }}>Retail Price</label>
                  <input
                    type="number"
                    min={0}
                    step="0.01"
                    value={editDraft.retail_price}
                    onChange={(e) => setEditDraft((v) => ({ ...v, retail_price: e.target.value }))}
                    style={{ width: '100%', padding: '12px 14px', borderRadius: '10px', border: '1px solid var(--panel-border)', background: 'var(--hover-bg)', color: 'var(--text-main)' }}
                  />
                </div>
                <div style={{ gridColumn: '1 / -1' }}>
                  <label className="subtitle" style={{ display: 'block', marginBottom: '8px', fontSize: '13px', fontWeight: 600 }}>Description / Notes</label>
                  <textarea
                    value={editDraft.description}
                    onChange={(e) => setEditDraft((v) => ({ ...v, description: e.target.value }))}
                    rows={4}
                    placeholder="Optional notes that should be searchable everywhere"
                    style={{ width: '100%', padding: '12px 14px', borderRadius: '10px', border: '1px solid var(--panel-border)', background: 'var(--hover-bg)', color: 'var(--text-main)', resize: 'vertical' }}
                  />
                </div>
              </div>

              {error && (
                <div style={{ marginTop: '16px', padding: '12px 14px', borderRadius: '10px', border: '1px solid rgba(239,68,68,0.25)', background: 'rgba(239,68,68,0.08)', color: 'var(--danger)', fontSize: '14px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <XCircle size={16} />{error}
                </div>
              )}

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '18px' }}>
                <button
                  type="button"
                  onClick={() => setEditingVariant(null)}
                  disabled={savingVariant}
                  style={{ padding: '11px 16px', borderRadius: '10px', border: '1px solid var(--panel-border)', background: 'transparent', color: 'var(--text-muted)', cursor: savingVariant ? 'not-allowed' : 'pointer', fontWeight: 700 }}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={saveVariantEdit}
                  disabled={savingVariant}
                  style={{ padding: '11px 16px', borderRadius: '10px', border: 'none', background: 'var(--primary)', color: '#0f1115', cursor: savingVariant ? 'not-allowed' : 'pointer', fontWeight: 800, display: 'inline-flex', alignItems: 'center', gap: '8px' }}
                >
                  {savingVariant ? <Loader2 size={15} className="spin" /> : <CheckCircle2 size={15} />}
                  Save Changes
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
