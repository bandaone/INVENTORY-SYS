export type CanonicalField =
  | 'product_name'
  | 'category'
  | 'subtype'
  | 'description'
  | 'color'
  | 'size'
  | 'code'
  | 'quantity'
  | 'cost_price'
  | 'retail_price';

export type ColumnMap = Partial<Record<CanonicalField, string | null>>;

export interface SourceColumn {
  key: string;
  label: string;
}

export interface ParsedSheetRow {
  rowNumber: number;
  source: Record<string, unknown>;
  productName: string;
  category: string;
  subtype: string;
  description: string;
  color: string;
  size: string;
  code: string;
  quantity: number;
  costPrice: number | null;
  retailPrice: number | null;
  extraFields: Record<string, unknown>;
  missingFields: string[];
  detailStatus: 'complete' | 'needs_review';
  familyKey: string;
  familyLabel: string;
}

const FIELD_SYNONYMS: Record<CanonicalField, string[]> = {
  product_name: ['product_name', 'product', 'item', 'name', 'productname', 'item_name', 'description_name', 'brand', 'brand_name'],
  category: ['category', 'cat', 'group', 'department', 'collection', 'line'],
  subtype: ['subtype', 'sub_type', 'style', 'type', 'variant_type', 'design'],
  description: ['description', 'desc', 'details', 'note', 'notes', 'item_description'],
  color: ['color', 'colour', 'shade', 'tone', 'hue'],
  size: ['size', 'product_size', 'item_size', 'shirt_size', 'shoe_size', 'dimension', 'fit', 'measure', 'measurement'],
  code: ['code', 'sku', 'barcode', 'barcode_code', 'item_code', 'product_code', 'serial', 'serial_number', 'reference', 'ref'],
  quantity: ['quantity', 'qty', 'units', 'unit', 'count', 'pieces', 'pcs'],
  cost_price: ['cost', 'cost_price', 'buy_price', 'wholesale_price', 'landed_cost'],
  retail_price: ['retail_price', 'price', 'selling_price', 'sale_price', 'rrp', 'mrp'],
};

const CATEGORY_KEYWORDS: Array<{ keywords: string[]; category: string; subtype?: string }> = [
  { keywords: ['shirt', 'shirts', 'tee', 'tshirt', 't-shirt', 'top', 'blouse'], category: 'Shirts' },
  { keywords: ['trouser', 'trousers', 'pant', 'pants', 'jean', 'jeans', 'chino'], category: 'Trousers' },
  { keywords: ['suit', 'suits', 'blazer', 'jacket', 'coat', 'waistcoat'], category: 'Suits' },
  { keywords: ['dress', 'dresses', 'gown'], category: 'Dresses' },
  { keywords: ['skirt', 'skirts'], category: 'Skirts' },
  { keywords: ['shoe', 'shoes', 'sneaker', 'sneakers', 'loafer', 'heels'], category: 'Footwear' },
  { keywords: ['short', 'shorts'], category: 'Shorts' },
  { keywords: ['hoodie', 'sweatshirt', 'jumper', 'sweater'], category: 'Sweatwear' },
];

export function normalizeHeader(value: unknown) {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/[\s\-./]+/g, '_')
    .replace(/[^a-z0-9_]/g, '');
}

export function normalizeText(value: unknown) {
  return String(value ?? '')
    .trim()
    .replace(/\s+/g, ' ');
}

export function normalizeSearchText(value: unknown) {
  return normalizeText(value).toLowerCase();
}

export function isMeaningfulValue(value: unknown) {
  return String(value ?? '').trim() !== '';
}

export function getCellValue(row: Record<string, unknown>, keys: Array<string | null | undefined>) {
  for (const key of keys) {
    if (!key) continue;
    const value = row[key];
    if (isMeaningfulValue(value)) return value;
  }
  return '';
}

export function toNumber(value: unknown) {
  const parsed = Number(String(value ?? '').toString().replace(/[, ]+/g, ''));
  return Number.isFinite(parsed) ? parsed : null;
}

export function toQuantity(value: unknown) {
  const parsed = Number(String(value ?? '').toString().replace(/[, ]+/g, ''));
  return Number.isInteger(parsed) ? parsed : NaN;
}

export function inferFieldFromHeader(header: string): CanonicalField | null {
  const normalized = normalizeHeader(header);
  for (const [field, synonyms] of Object.entries(FIELD_SYNONYMS) as Array<[CanonicalField, string[]]>) {
    if (synonyms.some(synonym => normalized === synonym || normalized.includes(synonym))) {
      return field;
    }
  }
  return null;
}

export function buildSourceColumns(headers: string[]): SourceColumn[] {
  return headers.map((header) => ({
    key: normalizeHeader(header) || header,
    label: header,
  }));
}

export function inferColumnMap(headers: string[], rows: Array<Record<string, unknown>>): ColumnMap {
  const normalizedHeaders = headers.map(header => normalizeHeader(header));
  const map: ColumnMap = {};

  for (const field of Object.keys(FIELD_SYNONYMS) as CanonicalField[]) {
    const exactMatch = normalizedHeaders.find((header) => {
      const synonyms = FIELD_SYNONYMS[field];
      return synonyms.includes(header);
    });
    if (exactMatch) {
      map[field] = exactMatch;
      continue;
    }

    const fuzzyMatch = normalizedHeaders.find((header) => {
      const synonyms = FIELD_SYNONYMS[field];
      return synonyms.some((synonym) => header.includes(synonym) || synonym.includes(header));
    });
    if (fuzzyMatch) {
      map[field] = fuzzyMatch;
    }
  }

  const sampleRow = rows[0] || {};
  normalizedHeaders.forEach((header) => {
    const sampleValue = sampleRow[header];
    if (!isMeaningfulValue(sampleValue)) return;
    if (!map.code && /(^|_)(code|sku|barcode|serial)(_|$)/.test(header)) map.code = header;
    if (!map.quantity && /(^|_)(qty|quantity|units|count)(_|$)/.test(header)) map.quantity = header;
    if (!map.size && /(^|_)(size|product_size|item_size|shirt_size|shoe_size)(_|$)/.test(header)) map.size = header;
    if (!map.retail_price && /(^|_)(price|retail|sale)(_|$)/.test(header)) map.retail_price = header;
    if (!map.cost_price && /(^|_)(cost|buy|wholesale)(_|$)/.test(header)) map.cost_price = header;
  });

  return map;
}

export function detectCategory(productName: string, description?: string) {
  const haystack = normalizeSearchText([productName, description].filter(Boolean).join(' '));
  for (const entry of CATEGORY_KEYWORDS) {
    if (entry.keywords.some(keyword => haystack.includes(keyword))) {
      return {
        category: entry.category,
        subtype: entry.subtype || '',
      };
    }
  }
  return {
    category: '',
    subtype: '',
  };
}

export function buildFamilyKey(category: string, subtype: string, productName: string) {
  return [normalizeText(category), normalizeText(subtype), normalizeText(productName)]
    .filter(Boolean)
    .map(part => normalizeSearchText(part))
    .join('::') || 'uncategorized';
}

export function buildFamilyLabel(category: string, subtype: string, productName: string) {
  const parts = [normalizeText(category), normalizeText(subtype), normalizeText(productName)].filter(Boolean);
  return parts.length ? parts.join(' / ') : 'Uncategorized';
}

export function inferSearchTokens(row: ParsedSheetRow) {
  return [
    row.productName,
    row.category,
    row.subtype,
    row.description,
    row.color,
    row.size,
    row.code,
    row.quantity,
    row.costPrice,
    row.retailPrice,
    ...Object.entries(row.extraFields).flatMap(([key, value]) => [key, String(value ?? '')]),
  ]
    .filter(Boolean)
    .map(value => normalizeSearchText(value))
    .join(' ');
}

export function resolveSheetRow(
  rowNumber: number,
  row: Record<string, unknown>,
  columnMap: ColumnMap,
  headers: string[]
): ParsedSheetRow {
  const normalizedRow: Record<string, unknown> = {};
  headers.forEach((header) => {
    normalizedRow[normalizeHeader(header)] = row[normalizeHeader(header)];
  });

  const productName = normalizeText(getCellValue(normalizedRow, [columnMap.product_name, columnMap.description, 'product_name', 'product', 'name', 'item_name']));
  const description = normalizeText(getCellValue(normalizedRow, [columnMap.description, 'description', 'desc', 'details']));
  const categoryHint = normalizeText(getCellValue(normalizedRow, [columnMap.category, 'category', 'cat', 'group']));
  const subtypeHint = normalizeText(getCellValue(normalizedRow, [columnMap.subtype, 'subtype', 'style', 'type']));
  const color = normalizeText(getCellValue(normalizedRow, [columnMap.color, 'color', 'colour', 'shade']));
  const size = normalizeText(getCellValue(normalizedRow, [columnMap.size, 'size', 'product_size', 'item_size', 'shirt_size', 'shoe_size', 'dimension', 'fit', 'measure', 'measurement']));
  const code = normalizeText(getCellValue(normalizedRow, [columnMap.code, 'code', 'sku', 'barcode', 'serial', 'serial_number']));
  const quantityValue = toQuantity(getCellValue(normalizedRow, [columnMap.quantity, 'quantity', 'qty', 'units', 'count']));
  const costPriceValue = toNumber(getCellValue(normalizedRow, [columnMap.cost_price, 'cost_price', 'cost', 'buy_price', 'wholesale_price']));
  const retailPriceValue = toNumber(getCellValue(normalizedRow, [columnMap.retail_price, 'retail_price', 'price', 'sale_price', 'selling_price']));

  const detected = detectCategory(productName || categoryHint || subtypeHint || code, description);
  const category = categoryHint || detected.category;
  const subtype = subtypeHint || detected.subtype;
  const familyKey = buildFamilyKey(category, subtype, productName || code || 'Imported Item');
  const familyLabel = buildFamilyLabel(category, subtype, productName || code || 'Imported Item');

  const extraFields: Record<string, unknown> = {};
  headers.forEach((header) => {
    const key = normalizeHeader(header);
    if (!key) return;
    const canonicalMatch = Object.values(columnMap).some(mapped => mapped && mapped === key);
    if (!canonicalMatch) {
      extraFields[key] = row[key];
    }
  });

  const missingFields = [
    !productName && 'product_name',
    !category && 'category',
    !description && 'description',
    !color && 'color',
    !size && 'size',
    !code && 'code',
    retailPriceValue === null && costPriceValue === null && 'price',
  ].filter(Boolean) as string[];

  return {
    rowNumber,
    source: normalizedRow,
    productName,
    category,
    subtype,
    description,
    color,
    size,
    code,
    quantity: Number.isInteger(quantityValue) && quantityValue > 0 ? quantityValue : 1,
    costPrice: costPriceValue,
    retailPrice: retailPriceValue,
    extraFields,
    missingFields,
    detailStatus: missingFields.length > 0 ? 'needs_review' : 'complete',
    familyKey,
    familyLabel,
  };
}

export function groupRowsByFamily(rows: ParsedSheetRow[]) {
  return rows.reduce<Record<string, ParsedSheetRow[]>>((acc, row) => {
    if (!acc[row.familyLabel]) acc[row.familyLabel] = [];
    acc[row.familyLabel].push(row);
    return acc;
  }, {});
}
