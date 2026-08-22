'use client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ScanLine, Package, ShoppingCart, Trash2, CheckCircle2, LogOut, Plus, Minus, Clock, Sun, Moon, ReceiptText, Wifi, WifiOff, RefreshCw, AlertTriangle, Search, LockKeyhole, X, Banknote, Smartphone, Keyboard, Loader2, ChevronRight } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useTheme } from '@/components/ThemeProvider';
import ReceiptPrint, { ReceiptData } from '@/components/ReceiptPrint';
import {
  getCatalogSnapshot,
  getPosDeviceId,
  getSettingsSnapshot,
  listQueuedSales,
  offlineReceiptNumber,
  PosPaymentMethod,
  PosSaleRequest,
  QueuedPosSale,
  removeQueuedSale,
  saveCatalogSnapshot,
  saveQueuedSale,
  saveSettingsSnapshot,
} from '@/lib/pos-offline';
import { clearPosTerminalSession, getPosTerminalToken, POS_TERMINAL_HEADER } from '@/lib/pos-constants';
import styles from './pos.module.css';

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
  search_blob?: string | null;
  identifiers?: string[];
  exact_match?: boolean;
}
interface CartItem { id: string; variant_id: string; name: string; size: string | null; color: string | null; price: number; quantity: number; discount_percent: number; max_quantity: number; }
interface Session {
  staffName: string;
  staffRole: string;
  tenantName: string;
  locationName: string;
  tenantId: string;
  staffId: string;
  shiftId: string;
}
interface LocationOption { id: string; name: string; }
interface PosConfig {
  taxRatePercent: number;
  receiptFooter: string;
  receiptLogoDataUrl: string | null;
  businessName: string;
  businessPhone: string;
  zraTpin: string;
  zraEnabled: boolean;
}
type SaleAttempt =
  | { kind: 'success'; data: any }
  | { kind: 'retry'; message: string }
  | { kind: 'locked'; message: string }
  | { kind: 'rejected'; message: string; status: number }
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

const CATALOG_PAGE_SIZE = 36;
const OFFLINE_SNAPSHOT_PAGE_SIZE = 500;

function cachedCatalogMatches(catalog: Variant[], query: string, category: string) {
  const normalized = query.trim().toLocaleLowerCase();
  return catalog
    .filter((item) => {
      if (category && item.category !== category) return false;
      if (!normalized) return true;
      return [
        item.name,
        item.category,
        item.subtype,
        item.color,
        item.size,
        item.barcode,
        item.barcode_token,
        item.search_text,
        item.search_blob,
        ...(item.identifiers || []),
      ].filter(Boolean).join(' ').toLocaleLowerCase().includes(normalized);
    })
    .map((item) => ({
      ...item,
      exact_match: Boolean(normalized && [
        item.barcode,
        item.barcode_token,
        ...(item.identifiers || []),
      ].some((value) => value?.toLocaleLowerCase() === normalized)),
    }))
    .slice(0, CATALOG_PAGE_SIZE);
}

function getCookie(name: string) {
  if (typeof document === 'undefined') return '';
  const m = document.cookie.match(new RegExp('(^| )' + name + '=([^;]+)'));
  return m ? decodeURIComponent(m[2]) : '';
}

function posFetch(input: RequestInfo | URL, init: RequestInit = {}) {
  const token = typeof window === 'undefined' ? '' : getPosTerminalToken();
  const headers = new Headers(init.headers);
  if (token) headers.set(POS_TERMINAL_HEADER, token);
  return fetch(input, { ...init, headers });
}

export default function POSPage() {
  const router = useRouter();
  const { theme, toggleTheme } = useTheme();

  // Defer cookie reads to client — fixes hydration mismatch
  const [session, setSession] = useState<Session>({
    staffName: '', staffRole: '', tenantName: '', locationName: '',
    tenantId: '', staffId: '', shiftId: '',
  });
  const [mounted, setMounted] = useState(false);

  const [catalog, setCatalog] = useState<Variant[]>([]);
  const [catalogSource, setCatalogSource] = useState<'live' | 'cached'>('live');
  const [catalogLoading, setCatalogLoading] = useState(true);
  const [catalogLoadingMore, setCatalogLoadingMore] = useState(false);
  const [catalogError, setCatalogError] = useState('');
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [categories, setCategories] = useState<string[]>([]);
  const [offlineCatalogCount, setOfflineCatalogCount] = useState(0);
  const [offlineCatalogSyncing, setOfflineCatalogSyncing] = useState(false);
  const [activeCategory, setActiveCategory] = useState('');
  const [cart, setCart] = useState<CartItem[]>([]);
  const [processing, setProcessing] = useState(false);
  const [online, setOnline] = useState(true);
  const [queuedSales, setQueuedSales] = useState<QueuedPosSale[]>([]);
  const [syncing, setSyncing] = useState(false);
  const [saleNotice, setSaleNotice] = useState('');
  const [posConfig, setPosConfig] = useState<PosConfig | null>(null);
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
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const scanRef = useRef<HTMLInputElement>(null);
  const syncRunningRef = useRef(false);
  const catalogRequestRef = useRef(0);
  const catalogScopeKey = session.tenantId && selectedLocationId
    ? `${session.tenantId}:${selectedLocationId}`
    : '';
  const saleScopeKey = session.tenantId && session.staffId && session.shiftId && selectedLocationId
    ? `${session.tenantId}:${session.staffId}:${session.shiftId}:${selectedLocationId}`
    : '';
  const activeLocationName = locations.find((location) => location.id === selectedLocationId)?.name
    || session.locationName;
  const handlePrintComplete = useCallback(() => setReceipt(null), []);

  useEffect(() => {
    // Read cookies only on client
    setSession({
      staffName:    getCookie('staff_name'),
      staffRole:    getCookie('staff_role'),
      tenantName:   getCookie('tenant_name'),
      locationName: getCookie('location_name'),
      tenantId: '',
      staffId: '',
      shiftId: '',
    });
    setMounted(true);
    setOnline(navigator.onLine);

    if (!getPosTerminalToken()) {
      router.replace('/login?next=/pos&reason=till_locked');
      return;
    }

    posFetch('/api/auth/session?context=pos', { cache: 'no-store' })
      .then((response) => {
        if (!response.ok) throw new Error('Session expired');
        return response.json();
      })
      .then((data) => {
        setSession((current) => ({
          ...current,
          staffRole: data.role || current.staffRole,
          tenantId: data.tenantId || '',
          staffId: data.staffId || '',
          shiftId: data.shiftId || '',
        }));
        setSelectedLocationId(data.locationId || '');
      })
      .catch(() => {
        clearPosTerminalSession();
        router.replace('/login?next=/pos&reason=till_locked');
      });

    if (scanRef.current) scanRef.current.focus();

    const start = Date.now();
    const markOnline = () => setOnline(true);
    const markOffline = () => setOnline(false);
    window.addEventListener('online', markOnline);
    window.addEventListener('offline', markOffline);
    const t = setInterval(() => {
      const e = Math.floor((Date.now() - start) / 1000);
      setShiftTime(
        `${String(Math.floor(e / 3600)).padStart(2, '0')}:${String(Math.floor((e % 3600) / 60)).padStart(2, '0')}:${String(e % 60).padStart(2, '0')}`
      );
    }, 1000);
    return () => {
      clearInterval(t);
      window.removeEventListener('online', markOnline);
      window.removeEventListener('offline', markOffline);
    };
  }, [router]);

  useEffect(() => {
    // Only fetch the full location list for roles that need the dropdown (owner, manager)
    // Cashiers are always locked to their assigned location_id from the login cookie
    if (session.staffRole === 'cashier') return;
    fetch('/api/locations')
      .then((r) => r.json())
      .then((data) => {
        const nextLocations = Array.isArray(data) ? data : [];
        setLocations(nextLocations);
        setSelectedLocationId((current) => current || nextLocations[0]?.id || '');
      })
      .catch((err) => console.error(err));
  }, [session.staffRole]);

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedSearch(searchTerm.trim()), 250);
    return () => clearTimeout(timer);
  }, [searchTerm]);

  const refreshCatalog = useCallback(async (options: {
    append?: boolean;
    cursor?: string | null;
    query?: string;
  } = {}) => {
    if (!catalogScopeKey || !selectedLocationId) return [] as Variant[];
    const append = Boolean(options.append);
    const query = options.query ?? debouncedSearch;
    const requestId = ++catalogRequestRef.current;
    const cached = await getCatalogSnapshot<Variant>(catalogScopeKey).catch(() => null);
    const cachedMatches = cachedCatalogMatches(cached?.catalog || [], query, activeCategory);
    if (cached?.catalog.length) {
      setOfflineCatalogCount(cached.catalog.length);
      setCategories((current) => current.length ? current : Array.from(new Set(
        cached.catalog.map((item) => item.category).filter((value): value is string => Boolean(value)),
      )).sort());
    }
    if (!append && cachedMatches.length) {
      setCatalog(cachedMatches);
      setCatalogSource('cached');
    }

    if (append) setCatalogLoadingMore(true);
    else setCatalogLoading(true);
    setCatalogError('');
    if (!navigator.onLine) {
      setCatalog(cachedMatches);
      setCatalogSource('cached');
      setNextCursor(null);
      setHasMore(false);
      setCatalogLoading(false);
      setCatalogLoadingMore(false);
      setCatalogError(cachedMatches.length
        ? 'Offline mode: results are coming from this till\'s local catalog.'
        : 'This product is not in the local catalog yet. Reconnect this till to refresh it.');
      setOnline(false);
      return cachedMatches;
    }
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 8000);
    try {
      const params = new URLSearchParams({
        location_id: selectedLocationId,
        limit: String(CATALOG_PAGE_SIZE),
        include_facets: append ? '0' : '1',
      });
      if (query) params.set('q', query);
      if (activeCategory) params.set('category', activeCategory);
      if (options.cursor) params.set('cursor', options.cursor);
      const response = await posFetch(`/api/pos/catalog?${params.toString()}`, {
        cache: 'no-store',
        signal: controller.signal,
      });
      const data = await response.json().catch(() => ({}));
      if (response.status === 401) {
        clearPosTerminalSession();
        router.replace('/login?next=/pos&reason=till_locked');
        throw new Error(data.error || 'Till session expired');
      }
      if (!response.ok) throw new Error(data.error || `Catalog request failed (${response.status})`);
      if (!Array.isArray(data.items)) throw new Error('Catalog response is invalid');
      if (requestId !== catalogRequestRef.current) return [] as Variant[];

      const items = data.items as Variant[];
      setCatalog((current) => {
        if (!append) return items;
        const merged = new Map(current.map((item) => [item.id, item]));
        items.forEach((item) => merged.set(item.id, item));
        return Array.from(merged.values());
      });
      setNextCursor(data.nextCursor || null);
      setHasMore(Boolean(data.hasMore));
      if (Array.isArray(data.categories) && data.categories.length) setCategories(data.categories);
      setCatalogSource('live');
      setOnline(true);
      if (!append && !query && !activeCategory) {
        const merged = new Map((cached?.catalog || []).map((item) => [item.id, item]));
        items.forEach((item) => {
          const previous = merged.get(item.id);
          merged.set(item.id, {
            ...previous,
            ...item,
            identifiers: previous?.identifiers,
            search_blob: previous?.search_blob,
          });
        });
        const mergedCatalog = Array.from(merged.values());
        await saveCatalogSnapshot(catalogScopeKey, mergedCatalog);
        setOfflineCatalogCount(mergedCatalog.length);
      }
      return items;
    } catch (error: any) {
      if (requestId !== catalogRequestRef.current) return [] as Variant[];
      const message = error?.name === 'AbortError'
        ? 'Catalog search timed out. Cached items remain available.'
        : error?.message || 'Catalog is unavailable.';
      setCatalog(cachedMatches);
      if (cached?.catalog.length) setCatalogSource('cached');
      setCatalogError(message);
      setOnline(false);
      return cachedMatches;
    } finally {
      clearTimeout(timeout);
      if (requestId === catalogRequestRef.current) {
        setCatalogLoading(false);
        setCatalogLoadingMore(false);
      }
    }
  }, [activeCategory, catalogScopeKey, debouncedSearch, router, selectedLocationId]);

  useEffect(() => {
    void refreshCatalog();
  }, [refreshCatalog]);

  useEffect(() => {
    if (!online || !catalogScopeKey || !selectedLocationId) return;
    let cancelled = false;
    let activeController: AbortController | null = null;

    void (async () => {
      setOfflineCatalogSyncing(true);
      try {
        const snapshot = new Map<string, Variant>();
        const usedCursors = new Set<string>();
        let cursor = '';
        let complete = false;

        for (let page = 0; page < 200 && !cancelled; page += 1) {
          activeController = new AbortController();
          const timeout = window.setTimeout(() => activeController?.abort(), 15000);
          try {
            const params = new URLSearchParams({
              location_id: selectedLocationId,
              limit: String(OFFLINE_SNAPSHOT_PAGE_SIZE),
              include_facets: '0',
              snapshot: '1',
            });
            if (cursor) params.set('cursor', cursor);
            const response = await posFetch(`/api/pos/catalog?${params.toString()}`, {
              cache: 'no-store',
              signal: activeController.signal,
            });
            const data = await response.json().catch(() => ({}));
            if (response.status === 401) {
              clearPosTerminalSession();
              router.replace('/login?next=/pos&reason=till_locked');
              return;
            }
            if (!response.ok || !Array.isArray(data.items)) {
              throw new Error(data.error || `Offline catalog sync failed (${response.status})`);
            }
            for (const item of data.items as Variant[]) snapshot.set(item.id, item);
            if (!data.hasMore) {
              complete = true;
              break;
            }
            const next = typeof data.nextCursor === 'string' ? data.nextCursor : '';
            if (!next || usedCursors.has(next)) throw new Error('Offline catalog cursor did not advance.');
            usedCursors.add(next);
            cursor = next;
          } finally {
            clearTimeout(timeout);
          }
        }

        if (!complete && !cancelled) throw new Error('Offline catalog is too large to snapshot safely.');
        if (!cancelled) {
          const completeCatalog = Array.from(snapshot.values());
          await saveCatalogSnapshot(catalogScopeKey, completeCatalog);
          setOfflineCatalogCount(completeCatalog.length);
          setCategories(Array.from(new Set(
            completeCatalog.map((item) => item.category).filter((value): value is string => Boolean(value)),
          )).sort());
        }
      } catch (error: any) {
        if (!cancelled && error?.name !== 'AbortError') console.error('[POS offline catalog]', error);
      } finally {
        if (!cancelled) setOfflineCatalogSyncing(false);
      }
    })();

    return () => {
      cancelled = true;
      activeController?.abort();
    };
  }, [catalogScopeKey, online, router, selectedLocationId]);

  useEffect(() => {
    if (!session.tenantId) return;
    const settingsScopeKey = session.tenantId;
    let cancelled = false;

    void (async () => {
      const cached = await getSettingsSnapshot<PosConfig>(settingsScopeKey).catch(() => null);
      if (!cancelled && cached?.settings) {
        setPosConfig(cached.settings);
        setReceiptFooter(cached.settings.receiptFooter);
      }
      try {
        const response = await posFetch('/api/pos/config', { cache: 'no-store' });
        if (!response.ok) throw new Error(`POS configuration failed (${response.status})`);
        const settings = await response.json() as PosConfig;
        if (!cancelled) {
          setPosConfig(settings);
          setReceiptFooter(settings.receiptFooter);
        }
        await saveSettingsSnapshot(settingsScopeKey, settings);
      } catch (error) {
        if (!cached?.settings) console.error('[POS config]', error);
      }
    })();

    return () => { cancelled = true; };
  }, [session.tenantId]);

  useEffect(() => {
    if (!saleScopeKey) return;
    void listQueuedSales(saleScopeKey)
      .then(setQueuedSales)
      .catch((error) => console.error('[POS outbox]', error));
  }, [saleScopeKey]);

  const reservedByVariant = useMemo(() => {
    const reserved = new Map<string, number>();
    for (const sale of queuedSales) {
      for (const item of sale.payload.cart) {
        reserved.set(item.variant_id, (reserved.get(item.variant_id) || 0) + item.quantity);
      }
    }
    return reserved;
  }, [queuedSales]);

  const visibleCatalog = useMemo(() => catalog.map((variant) => ({
    ...variant,
    available_count: Math.max(0, Number(variant.available_count || 0) - (reservedByVariant.get(variant.id) || 0)),
  })), [catalog, reservedByVariant]);

  const addToCart = (v: Variant) => {
    const variantId = v.id || v.variant_id;
    if (!variantId) {
      alert('This product is missing its catalog identity. Please refresh the POS catalog.');
      return;
    }
    const available = Math.max(0, Number(v.available_count || 0));
    if (available < 1) {
      alert('No locally available stock remains for this product. Sync pending sales or refresh the catalog.');
      return;
    }
    setCart(prev => {
      const ex = prev.find(i => i.variant_id === variantId);
      if (ex) {
        if (ex.quantity >= available) return prev;
        return prev.map(i => i.variant_id === variantId ? { ...i, quantity: i.quantity + 1 } : i);
      }
      return [...prev, {
        id: crypto.randomUUID(),
        variant_id: variantId,
        name: v.name,
        size: v.size || null,
        color: v.color || null,
        price: Number(v.retail_price),
        quantity: 1,
        discount_percent: Number(v.discount_percent || 0),
        max_quantity: available,
      }];
    });
  };

  const submitProductLookup = async () => {
    const lookup = searchTerm.trim();
    if (!lookup) return;
    const items = await refreshCatalog({ query: lookup });
    const exact = items.find((item) => item.exact_match);
    if (exact) {
      addToCart({
        ...exact,
        available_count: Math.max(0, Number(exact.available_count || 0) - (reservedByVariant.get(exact.id) || 0)),
      });
      setSearchTerm('');
      setDebouncedSearch('');
    }
  };

  useEffect(() => {
    const handleKeyboard = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const typing = target?.tagName === 'INPUT' || target?.tagName === 'TEXTAREA' || target?.tagName === 'SELECT';
      if (event.key === '/' && !typing) {
        event.preventDefault();
        scanRef.current?.focus();
      }
      if (event.key === 'Escape' && document.activeElement === scanRef.current) {
        setSearchTerm('');
        scanRef.current?.blur();
      }
    };
    window.addEventListener('keydown', handleKeyboard);
    return () => window.removeEventListener('keydown', handleKeyboard);
  }, []);

  const adjustQty = (id: string, d: number) =>
    setCart(prev => prev.map(i => i.id === id
      ? { ...i, quantity: Math.max(1, Math.min(i.max_quantity, i.quantity + d)) }
      : i));

  const removeItem = (id: string) => setCart(prev => prev.filter(i => i.id !== id));

  const lineTotal = (item: CartItem) => item.price * (1 - (item.discount_percent || 0) / 100) * item.quantity;
  const discountTotal = cart.reduce((sum, item) => sum + item.price * (item.discount_percent || 0) / 100 * item.quantity, 0);
  const total = cart.reduce((s, i) => s + lineTotal(i), 0);

  const attemptSale = useCallback(async (payload: PosSaleRequest): Promise<SaleAttempt> => {
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 10000);
    try {
      const response = await posFetch('/api/pos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
      const data = await response.json().catch(() => ({}));
      if (response.ok && data.success) {
        setOnline(true);
        return { kind: 'success', data };
      }
      const message = data.error || `Checkout failed (${response.status})`;
      if (response.status === 401) {
        clearPosTerminalSession();
        router.replace('/login?next=/pos&reason=till_locked');
        return { kind: 'locked', message };
      }
      if (response.status >= 500 || response.status === 408 || response.status === 429) {
        return { kind: 'retry', message };
      }
      return { kind: 'rejected', message, status: response.status };
    } catch (error: any) {
      setOnline(false);
      return {
        kind: 'retry',
        message: error?.name === 'AbortError'
          ? 'The server did not respond within 10 seconds.'
          : 'The network connection was interrupted.',
      };
    } finally {
      clearTimeout(timeout);
    }
  }, [router]);

  const applyConfirmedStock = useCallback((saleCart: PosSaleRequest['cart']) => {
    const sold = new Map<string, number>();
    for (const item of saleCart) sold.set(item.variant_id, (sold.get(item.variant_id) || 0) + item.quantity);
    setCatalog((current) => current.map((variant) => ({
      ...variant,
      available_count: Math.max(0, Number(variant.available_count || 0) - (sold.get(variant.id) || 0)),
    })));
  }, []);

  const syncQueuedSales = useCallback(async (retryConflicts = false) => {
    if (!saleScopeKey || syncRunningRef.current || !navigator.onLine) return;
    syncRunningRef.current = true;
    setSyncing(true);
    let syncedCount = 0;
    try {
      const pending = (await listQueuedSales(saleScopeKey))
        .filter((sale) => retryConflicts || sale.status !== 'conflict');
      for (const sale of pending) {
        const syncingSale: QueuedPosSale = {
          ...sale,
          status: 'syncing',
          attempts: sale.attempts + 1,
          updatedAt: new Date().toISOString(),
        };
        await saveQueuedSale(syncingSale);
        setQueuedSales((current) => current.map((item) => (
          item.idempotencyKey === sale.idempotencyKey ? syncingSale : item
        )));

        const result = await attemptSale(sale.payload);
        if (result.kind === 'success') {
          await removeQueuedSale(sale.idempotencyKey);
          setQueuedSales((current) => current.filter((item) => item.idempotencyKey !== sale.idempotencyKey));
          applyConfirmedStock(sale.payload.cart);
          syncedCount += 1;
          continue;
        }

        const failedSale: QueuedPosSale = {
          ...syncingSale,
          status: result.kind === 'rejected' ? 'conflict' : 'pending',
          lastError: result.message,
          updatedAt: new Date().toISOString(),
        };
        await saveQueuedSale(failedSale);
        setQueuedSales((current) => current.map((item) => (
          item.idempotencyKey === sale.idempotencyKey ? failedSale : item
        )));
        if (result.kind === 'retry' || result.kind === 'locked') break;
      }

      if (syncedCount > 0) {
        setSaleNotice(`${syncedCount} offline sale${syncedCount === 1 ? '' : 's'} synced and stock reconciled.`);
        await refreshCatalog();
      }
    } catch (error) {
      console.error('[POS sync]', error);
    } finally {
      syncRunningRef.current = false;
      setSyncing(false);
    }
  }, [applyConfirmedStock, attemptSale, refreshCatalog, saleScopeKey]);

  useEffect(() => {
    if (!online || !saleScopeKey) return;
    void syncQueuedSales();
    const timer = window.setInterval(() => void syncQueuedSales(), 30000);
    return () => clearInterval(timer);
  }, [online, saleScopeKey, syncQueuedSales]);

  const createReceipt = (
    saleCart: PosSaleRequest['cart'],
    method: PosPaymentMethod,
    data: any,
    syncPending: boolean,
  ): ReceiptData => {
    const computedTotal = saleCart.reduce((sum, item) => (
      sum + item.price * (1 - item.discount_percent / 100) * item.quantity
    ), 0);
    const percent = Number(data.taxRatePercent ?? posConfig?.taxRatePercent ?? 16);
    const computedTax = percent > 0 ? computedTotal - computedTotal / (1 + percent / 100) : 0;
    const receiptTotal = Number(data.total ?? computedTotal);
    const tendered = method === 'CASH' && amountTenderedStr ? Number(amountTenderedStr) : receiptTotal;

    return {
      number: data.receipt,
      total: receiptTotal,
      subtotal: Number(data.subtotal ?? computedTotal - computedTax),
      tax: Number(data.tax ?? computedTax),
      taxRatePercent: percent,
      discountTotal: Number(data.discountTotal ?? saleCart.reduce((sum, item) => (
        sum + item.price * item.discount_percent / 100 * item.quantity
      ), 0)),
      businessName: data.businessName || posConfig?.businessName || session.tenantName || 'RETAIL STORE',
      businessPhone: data.businessPhone || posConfig?.businessPhone || '',
      receiptLogoDataUrl: data.receiptLogoDataUrl ?? posConfig?.receiptLogoDataUrl ?? null,
      zraTpin: data.zraTpin || posConfig?.zraTpin || '',
      zraEnabled: Boolean(data.zraEnabled ?? posConfig?.zraEnabled),
      zraRcptNo: data.zraRcptNo || '',
      zraIntrlData: data.zraIntrlData || '',
      zraMrcNo: data.zraMrcNo || '',
      zraQueued: Boolean(data.zraQueued || syncPending),
      syncPending,
      items: saleCart.map((item) => ({
        name: item.name,
        size: item.size,
        color: item.color,
        price: item.price * (1 - item.discount_percent / 100),
        quantity: item.quantity,
        discountPercent: item.discount_percent,
        discountAmount: item.price * item.discount_percent / 100,
        lineTotal: item.price * (1 - item.discount_percent / 100) * item.quantity,
      })),
      payment_method: method,
      cashierName: session.staffName,
      locationName: activeLocationName,
      amountTendered: tendered,
      change: Math.max(0, tendered - receiptTotal),
    };
  };

  const checkout = async (method: PosPaymentMethod) => {
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
    if (!saleScopeKey) {
      alert('Your verified shift is still loading. Wait a moment and try again.');
      return;
    }
    if (!online && !posConfig) {
      alert('Offline receipt settings are not cached on this device yet. Reconnect once before taking offline sales.');
      return;
    }

    setProcessing(true);
    setSaleNotice('');
    const now = new Date().toISOString();
    const idempotencyKey = crypto.randomUUID();
    const saleCart = cart.map((item) => ({
      variant_id: item.variant_id,
      name: item.name,
      size: item.size,
      color: item.color,
      price: item.price,
      quantity: item.quantity,
      discount_percent: item.discount_percent,
    }));
    const payload: PosSaleRequest = {
      idempotency_key: idempotencyKey,
      client_created_at: now,
      device_id: getPosDeviceId(),
      cart: saleCart,
      method,
      location_id: selectedLocationId,
      ...(customerEmail.trim() ? { customer_email: customerEmail.trim() } : {}),
    };
    const queued: QueuedPosSale = {
      idempotencyKey,
      scopeKey: saleScopeKey,
      catalogScopeKey,
      createdAt: now,
      updatedAt: now,
      attempts: 0,
      status: 'pending',
      lastError: null,
      payload,
    };

    try {
      await saveQueuedSale(queued);
      setQueuedSales((current) => [...current, queued]);
    } catch (error) {
      console.error('[POS checkout outbox]', error);
      alert('This sale could not be saved safely on the device. No stock was changed; please try again.');
      setProcessing(false);
      return;
    }

    const result = online ? await attemptSale(payload) : {
      kind: 'retry' as const,
      message: 'Device is offline.',
    };

    try {
      if (result.kind === 'success') {
        let outboxRemoved = false;
        try {
          await removeQueuedSale(idempotencyKey);
          outboxRemoved = true;
        } catch (error) {
          console.error('[POS outbox cleanup]', error);
        }
        if (outboxRemoved) {
          setQueuedSales((current) => current.filter((sale) => sale.idempotencyKey !== idempotencyKey));
          applyConfirmedStock(saleCart);
        }
        setReceiptFooter(result.data.receiptFooter || posConfig?.receiptFooter || 'Thank you for your business!');
        setReceipt(createReceipt(saleCart, method, result.data, false));
        setSaleNotice(outboxRemoved
          ? (result.data.replayed ? 'Sale confirmed safely after a network retry.' : 'Sale completed and stock updated.')
          : 'Sale completed. Local cleanup will retry automatically; stock will not be charged twice.');
        setCart([]);
        setAmountTenderedStr('');
        setCustomerEmail('');
        if (outboxRemoved) void refreshCatalog();
      } else if (result.kind === 'retry') {
        const pendingSale = { ...queued, lastError: result.message, updatedAt: new Date().toISOString() };
        await saveQueuedSale(pendingSale).catch((error) => console.error('[POS outbox status]', error));
        setQueuedSales((current) => current.map((sale) => (
          sale.idempotencyKey === idempotencyKey ? pendingSale : sale
        )));
        setReceiptFooter(posConfig?.receiptFooter || 'Thank you for your business!');
        setReceipt(createReceipt(saleCart, method, {
          receipt: offlineReceiptNumber(idempotencyKey),
        }, true));
        setSaleNotice('Sale accepted offline. Stock is reserved on this device and will sync automatically.');
        setCart([]);
        setAmountTenderedStr('');
        setCustomerEmail('');
      } else if (result.kind === 'locked') {
        try {
          await removeQueuedSale(idempotencyKey);
          setQueuedSales((current) => current.filter((sale) => sale.idempotencyKey !== idempotencyKey));
          setSaleNotice('The till session expired before this sale was accepted. Sign in again; the cart has been preserved.');
        } catch (error) {
          console.error('[POS locked cleanup]', error);
          setCart([]);
          setSaleNotice('The till locked with the sale still stored in the outbox. Sign in to let it reconcile before re-entering items.');
        }
      } else {
        const rejectedSale: QueuedPosSale = {
          ...queued,
          status: 'conflict',
          lastError: result.message,
          updatedAt: new Date().toISOString(),
        };
        await saveQueuedSale(rejectedSale).catch((error) => console.error('[POS rejected outbox]', error));
        setQueuedSales((current) => current.map((sale) => (
          sale.idempotencyKey === idempotencyKey ? rejectedSale : sale
        )));
        try {
          await removeQueuedSale(idempotencyKey);
          setQueuedSales((current) => current.filter((sale) => sale.idempotencyKey !== idempotencyKey));
        } catch (error) {
          console.error('[POS rejected cleanup]', error);
        }
        alert(result.message);
      }
    } catch (error) {
      console.error('[POS checkout completion]', error);
      setSaleNotice('The sale remains safely stored on this device and will retry automatically.');
    } finally {
      setProcessing(false);
    }
  };

  const lookupReturn = async () => {
    const receipt = returnReceiptNo.trim();
    if (!receipt) return;
    setReturnLookupLoading(true);
    setReturnLookup(null);
    setSelectedReturnItems({});
    try {
      const res = await posFetch(`/api/pos/returns?receipt=${encodeURIComponent(receipt)}`);
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
      const res = await posFetch('/api/pos/returns', {
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
    if (queuedSales.length > 0) {
      if (navigator.onLine) await syncQueuedSales(true);
      const remaining = saleScopeKey ? await listQueuedSales(saleScopeKey).catch(() => queuedSales) : queuedSales;
      if (remaining.length > 0) {
        alert(`This shift has ${remaining.length} unsynced sale${remaining.length === 1 ? '' : 's'}. Reconnect and sync them before ending the shift so stock and cash totals stay accurate.`);
        return;
      }
    }
    if (!confirm('End your shift and log out?')) return;
    try {
      const response = await fetch('/api/auth/logout', { method: 'POST' });
      if (!response.ok) throw new Error('Logout failed');
      clearPosTerminalSession();
      router.push('/login');
    } catch {
      alert('The shift could not be closed. Check the connection and try again.');
    }
  };

  const lockTill = async () => {
    clearPosTerminalSession();
    setSaleNotice('Till locked. Pending offline sales remain safely stored on this device.');
    try {
      await fetch('/api/auth/lock', { method: 'POST' });
    } finally {
      router.replace('/login?next=/pos&reason=till_locked');
    }
  };
  const tenderedNum = Number(amountTenderedStr) || 0;
  const currentChange = tenderedNum >= total ? tenderedNum - total : 0;

  if (!mounted) return null;

  return (
    <div className={styles.posShell} style={{ fontFamily: 'Outfit, sans-serif', color: 'var(--text-main)' }}>
      {receipt && (
        <ReceiptPrint 
          storeName={session.tenantName || 'STORE'} 
          footerMessage={receiptFooter} 
          receipt={receipt} 
          onPrintComplete={handlePrintComplete}
        />
      )}

      {/* ── LEFT: Catalog ── */}
      <div className={styles.catalogPane} style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>

        {/* Header */}
        <div className={styles.topbar} style={{ display: 'flex', justifyContent: 'space-between' }}>
          <div className={styles.brandBlock}>
            <div className={styles.brandMark}><ScanLine size={18} /></div>
            <div>
              <div className={styles.terminalTitle}>Retail OS Terminal</div>
              <div className={styles.terminalMeta}>
                {session.tenantName}{session.locationName ? ` · ${session.locationName}` : ''}
              </div>
            </div>
          </div>

          <div className={styles.topActions}>
            <button
              className={styles.secondaryButton}
              onClick={() => void syncQueuedSales(true)}
              disabled={syncing || queuedSales.length === 0 || !online}
              title={queuedSales.length ? 'Sync offline sales now' : 'All sales are synced'}
              style={{
                display: 'flex', alignItems: 'center', gap: '7px', padding: '8px 11px', borderRadius: '8px',
                border: `1px solid ${queuedSales.some((sale) => sale.status === 'conflict') ? 'var(--danger)' : 'var(--panel-border)'}`,
                background: queuedSales.length ? 'rgba(245,158,11,0.12)' : 'var(--hover-bg)',
                color: queuedSales.some((sale) => sale.status === 'conflict') ? 'var(--danger)' : 'var(--text-muted)',
                cursor: queuedSales.length && online ? 'pointer' : 'default', fontSize: '12px', fontWeight: 700,
              }}
            >
              {syncing ? <RefreshCw size={14} className="spin" /> : queuedSales.some((sale) => sale.status === 'conflict') ? <AlertTriangle size={14} /> : <RefreshCw size={14} />}
              {queuedSales.length ? `${queuedSales.length} pending` : 'Synced'}
            </button>
            <div className={`${styles.statusPill} ${online ? styles.online : styles.offline}`}>
              {online ? <Wifi size={14} /> : <WifiOff size={14} />}
              {online ? 'Online' : 'Offline'}
            </div>
            {/* Location: badge for cashiers, dropdown for managers/owners */}
            {session.staffRole === 'cashier' ? (
              <div className={styles.locationControl} style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <Package size={14} color="var(--primary)" />
                {session.locationName || 'Assigned Store'}
              </div>
            ) : (
              <select
                className={styles.locationControl}
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
            )}

            {/* Theme toggle */}
            <button className={styles.iconButton} onClick={toggleTheme} title="Toggle theme"
              style={{ background: 'var(--hover-bg)', border: '1px solid var(--panel-border)', color: 'var(--text-muted)', borderRadius: '8px', padding: '8px', cursor: 'pointer', display: 'flex' }}>
              {theme === 'dark' ? <Sun size={15} /> : <Moon size={15} />}
            </button>

            <div className={styles.cashierIdentity}>
              <div className={styles.cashierName}>{session.staffName}</div>
              <div className={styles.shiftClock}>
                <Clock size={11} /> {shiftTime}
              </div>
            </div>
            <button className={styles.secondaryButton} onClick={lockTill} title="Lock this shared till without closing the shift">
              <LockKeyhole size={14} /> Lock
            </button>
            <button className={styles.dangerButton} onClick={endShift}
              style={{ background: 'var(--hover-bg)', border: '1px solid var(--panel-border)', color: 'var(--danger)', borderRadius: '8px', padding: '8px 12px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '6px', fontSize: '13px', fontWeight: 500 }}>
              <LogOut size={14} /> End Shift
            </button>
          </div>
        </div>

        <div className={styles.catalogScroll}>

        {saleNotice && (
          <div className={styles.notice} style={{
            display: 'flex', alignItems: 'center', gap: '8px', padding: '10px 12px', marginBottom: '14px',
            borderRadius: '9px', border: '1px solid var(--panel-border)', background: 'var(--panel-bg)',
            color: 'var(--text-main)', fontSize: '13px',
          }}>
            {queuedSales.length ? <Clock size={15} color="var(--warning)" /> : <CheckCircle2 size={15} color="var(--primary)" />}
            <span style={{ flex: 1 }}>{saleNotice}</span>
            <button onClick={() => setSaleNotice('')} style={{ border: 'none', background: 'none', color: 'var(--text-muted)', cursor: 'pointer' }}>×</button>
          </div>
        )}
        {queuedSales.some((sale) => sale.status === 'conflict') && (
          <div className={styles.conflict} style={{
            display: 'flex', alignItems: 'flex-start', gap: '8px', padding: '10px 12px', marginBottom: '14px',
            borderRadius: '9px', border: '1px solid var(--danger)', background: 'rgba(248,113,113,0.08)',
            color: 'var(--danger)', fontSize: '12px',
          }}>
            <AlertTriangle size={16} style={{ flexShrink: 0 }} />
            <div>
              <strong>Offline sale needs manager review.</strong>{' '}
              {queuedSales.find((sale) => sale.status === 'conflict')?.lastError || 'The server could not reconcile its stock.'}
              {' '}Do not end this shift until it is resolved.
            </div>
          </div>
        )}

        <div className={styles.commandBar}>
          <Search size={19} color="var(--primary)" />
          <input
            ref={scanRef}
            className={styles.commandInput}
            type="text"
            placeholder="Scan barcode or search products, colours and sizes"
            aria-label="Scan barcode or search products"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') void submitProductLookup();
            }}
            style={{ flex: 1, background: 'none', border: 'none', color: 'var(--text-main)', fontSize: '14px', outline: 'none', fontFamily: 'Outfit' }}
          />
          {catalogLoading && <Loader2 size={16} className="spin" color="var(--text-muted)" />}
          {searchTerm && (
            <button className={styles.clearSearch} onClick={() => setSearchTerm('')} aria-label="Clear product search">
              <X size={16} />
            </button>
          )}
          <span className={styles.keyHint}><Keyboard size={13} /> / to search · Enter to add scan</span>
        </div>

        <div className={styles.categoryStrip} aria-label="Product categories">
          <button
            className={`${styles.categoryChip} ${activeCategory === '' ? styles.categoryActive : ''}`}
            onClick={() => setActiveCategory('')}
          >
            All products
          </button>
          {categories.map((category) => (
            <button
              key={category}
              className={`${styles.categoryChip} ${activeCategory === category ? styles.categoryActive : ''}`}
              onClick={() => setActiveCategory(category)}
            >
              {category}
            </button>
          ))}
        </div>

        <div className={styles.resultHeader}>
          <div className={styles.resultTitle}>
            {debouncedSearch ? 'Search results' : activeCategory || 'Available products'}
          </div>
          <div className={styles.resultMeta}>
            Showing {visibleCatalog.length}{hasMore ? '+' : ''} · {catalogSource === 'cached' ? 'offline cache' : 'live stock'}
            {offlineCatalogSyncing
              ? ' · refreshing offline catalog'
              : offlineCatalogCount > 0
                ? ` · ${offlineCatalogCount.toLocaleString()} cached on this till`
                : ''}
          </div>
        </div>

        <div className={styles.productGrid}>
          {visibleCatalog.map(v => (
          <button className={styles.productCard} key={v.id} onClick={() => addToCart(v)} disabled={Number(v.available_count || 0) < 1}
              aria-label={`Add ${v.name}${v.size ? `, size ${v.size}` : ''}${v.color ? `, ${v.color}` : ''} to sale`}
              style={{ background: 'var(--panel-bg)', border: '1px solid var(--panel-border)', borderRadius: '12px', padding: '14px 12px', cursor: Number(v.available_count || 0) > 0 ? 'pointer' : 'not-allowed', opacity: Number(v.available_count || 0) > 0 ? 1 : 0.55, textAlign: 'left', transition: 'border-color 0.15s, transform 0.1s', fontFamily: 'Outfit', display: 'flex', flexDirection: 'column', gap: 0 }}
          >
              <div className={styles.productIcon} style={{ background: 'rgba(74,222,128,0.12)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <Package size={17} color="var(--primary)" />
              </div>
              <div className={styles.productName} style={{ fontWeight: 600, marginBottom: '3px', color: 'var(--text-main)' }}>{v.name}</div>
              <div className={styles.productCategory}>{[v.category, v.subtype].filter(Boolean).join(' · ') || 'General'}</div>

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

              <div className={styles.productFooter}>
                <div style={{ fontWeight: 700, color: 'var(--primary)', fontSize: '15px' }}>K{Number(v.retail_price).toFixed(2)}</div>
                {typeof v.available_count === 'number' && (
                  <div className={`${styles.stockCount} ${v.available_count < 3 ? styles.lowStock : ''}`}>
                    {v.available_count} in stock
                  </div>
                )}
              </div>
            </button>
          ))}
          {!catalogLoading && visibleCatalog.length === 0 && (
            <div className={styles.catalogState}>
              <Package size={32} style={{ marginBottom: '12px', opacity: 0.4 }} />
              <div style={{ fontWeight: 600 }}>{searchTerm ? 'No matching products' : 'No products in stock'}</div>
              <div style={{ fontSize: '13px', marginTop: '4px' }}>{catalogError || (searchTerm ? 'Try a product name, barcode, colour or size.' : 'Receive stock before starting a sale.')}</div>
            </div>
          )}
        </div>
        {hasMore && (
          <div className={styles.loadMore}>
            <button
              className={styles.loadMoreButton}
              onClick={() => void refreshCatalog({ append: true, cursor: nextCursor })}
              disabled={catalogLoadingMore}
            >
              {catalogLoadingMore ? <Loader2 size={15} className="spin" /> : <ChevronRight size={15} />}
              {catalogLoadingMore ? 'Loading products…' : 'Load next 36 products'}
            </button>
          </div>
        )}
        </div>
      </div>

      {/* ── RIGHT: Cart ── */}
      <div className={styles.cartPane} style={{ display: 'flex', flexDirection: 'column' }}>
        <div className={styles.cartHeader} style={{ borderBottom: '1px solid var(--panel-border)', display: 'flex', alignItems: 'center', gap: '10px' }}>
          <ShoppingCart size={20} color="var(--primary)" />
          <span className={styles.cartTitle} style={{ fontWeight: 700 }}>Current Sale</span>
          {cart.length > 0 && (
            <span style={{ marginLeft: 'auto', background: 'var(--primary)', color: '#0f1115', borderRadius: '12px', padding: '2px 10px', fontSize: '12px', fontWeight: 700 }}>
              {cart.length}
            </span>
          )}
        </div>

        <div className={styles.cartBody} style={{ flex: 1, overflowY: 'auto' }}>
          {cart.length === 0 ? (
            <div className={styles.cartEmpty} style={{ textAlign: 'center', color: 'var(--text-muted)' }}>
              <ShoppingCart size={40} style={{ opacity: 0.2, marginBottom: '12px' }} />
              <div>Cart is empty</div>
              <div style={{ fontSize: '13px', marginTop: '4px' }}>Tap a product to add it</div>
            </div>
          ) : cart.map(item => (
            <div className={styles.cartItem} key={item.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--panel-border)' }}>
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
                </div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginLeft: '12px' }}>
                <span style={{ fontWeight: 700, fontSize: '15px' }}>K{lineTotal(item).toFixed(2)}</span>
                <button onClick={() => removeItem(item.id)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--danger)', padding: '4px' }}><Trash2 size={15} /></button>
              </div>
            </div>
          ))}
        </div>

        <div className={styles.cartFooter} style={{ borderTop: '1px solid var(--panel-border)' }}>
          {receipt && (
            <div style={{ background: 'rgba(74,222,128,0.12)', border: '1px solid var(--primary)', borderRadius: '10px', padding: '12px', marginBottom: '14px', display: 'flex', gap: '8px', alignItems: 'flex-start' }}>
              <CheckCircle2 size={18} color="var(--primary)" style={{ flexShrink: 0, marginTop: '1px' }} />
              <div>
                <div style={{ fontWeight: 700, color: 'var(--primary)', fontSize: '14px' }}>Sale Complete!</div>
                <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginTop: '2px' }}>{receipt.number} · K{Number(receipt.total).toFixed(2)}</div>
              </div>
            </div>
          )}

          <div className={styles.totalRow} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: '16px', fontWeight: 500, color: 'var(--text-muted)' }}>Total</span>
            <span className={styles.totalAmount} style={{ fontWeight: 800 }}>K{total.toFixed(2)}</span>
          </div>
          {discountTotal > 0 && (
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '14px', alignItems: 'center' }}>
              <span style={{ fontSize: '14px', fontWeight: 500, color: 'var(--text-muted)' }}>Discounts</span>
              <span style={{ fontSize: '16px', fontWeight: 700, color: 'var(--primary)' }}>-K{discountTotal.toFixed(2)}</span>
            </div>
          )}

          <div className={styles.fieldGrid}>
          <div className={styles.compactField}>
            <label style={{ display: 'block', fontSize: '12px', color: 'var(--text-muted)', marginBottom: '4px' }}>Amount Tendered (Cash)</label>
            <input 
              type="number" 
              value={amountTenderedStr} 
              onChange={e => setAmountTenderedStr(e.target.value)}
              placeholder="Enter amount given..." 
              style={{ width: '100%', padding: '10px', borderRadius: '8px', border: '1px solid var(--panel-border)', background: 'var(--bg-color)', color: 'var(--text-main)', fontSize: '16px', fontFamily: 'Outfit' }} 
            />
          </div>

          <div className={styles.compactField}>
            <label style={{ display: 'block', fontSize: '12px', color: 'var(--text-muted)', marginBottom: '4px' }}>Email Receipt (Optional)</label>
            <input 
              type="email" 
              value={customerEmail} 
              onChange={e => setCustomerEmail(e.target.value)}
              placeholder="customer@email.com" 
              style={{ width: '100%', padding: '10px', borderRadius: '8px', border: '1px solid var(--panel-border)', background: 'var(--bg-color)', color: 'var(--text-main)', fontSize: '14px', fontFamily: 'Outfit' }} 
            />
          </div>
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

          <div className={styles.paymentGrid}>
          <button className={`${styles.paymentButton} ${styles.cashButton}`} onClick={() => checkout('CASH')} disabled={processing || !cart.length || (!!amountTenderedStr && tenderedNum < total)}
            style={{ width: '100%', padding: '14px', marginBottom: '10px', background: cart.length && !processing ? 'var(--primary)' : 'var(--hover-bg)', color: cart.length && !processing ? '#0f1115' : 'var(--text-muted)', border: 'none', borderRadius: '10px', fontWeight: 700, fontSize: '15px', cursor: cart.length ? 'pointer' : 'not-allowed', fontFamily: 'Outfit', transition: 'all 0.15s', letterSpacing: '0.05em' }}>
            <Banknote size={17} /> {processing ? 'Processing…' : 'Cash'}
          </button>
          <button className={`${styles.paymentButton} ${styles.momoButton}`} onClick={() => checkout('MOBILE_MONEY')} disabled={processing || !cart.length}
            style={{ width: '100%', padding: '14px', background: cart.length && !processing ? 'rgba(96,165,250,0.15)' : 'var(--hover-bg)', color: cart.length && !processing ? 'var(--secondary)' : 'var(--text-muted)', border: cart.length ? '1px solid var(--secondary)' : '1px solid var(--panel-border)', borderRadius: '10px', fontWeight: 700, fontSize: '15px', cursor: cart.length ? 'pointer' : 'not-allowed', fontFamily: 'Outfit', transition: 'all 0.15s', letterSpacing: '0.05em' }}>
            <Smartphone size={17} /> {processing ? 'Processing…' : 'Mobile money'}
          </button>
          </div>

          <details className={styles.returnsPanel}>
            <summary>
              <ReceiptText size={16} color="var(--secondary)" /> Process a return <ChevronRight size={14} style={{ marginLeft: 'auto' }} />
            </summary>
            <div className={styles.returnsContent}>
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
          </details>
        </div>
      </div>
    </div>
  );
}
