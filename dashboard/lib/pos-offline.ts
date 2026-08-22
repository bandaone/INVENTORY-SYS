export type PosPaymentMethod = 'CASH' | 'MOBILE_MONEY'

export interface PosSaleCartItem {
  variant_id: string
  name: string
  size: string | null
  color: string | null
  price: number
  quantity: number
  discount_percent: number
  serial?: string | null
}

export interface PosSaleRequest {
  idempotency_key: string
  client_created_at: string
  device_id: string
  cart: PosSaleCartItem[]
  method: PosPaymentMethod
  location_id: string
  customer_email?: string
}

export type QueuedSaleStatus = 'pending' | 'syncing' | 'conflict'

export interface QueuedPosSale {
  idempotencyKey: string
  scopeKey: string
  catalogScopeKey: string
  createdAt: string
  updatedAt: string
  attempts: number
  status: QueuedSaleStatus
  lastError: string | null
  payload: PosSaleRequest
}

export interface PosCatalogSnapshot<T> {
  scopeKey: string
  savedAt: string
  catalog: T[]
}

export interface PosSettingsSnapshot<T> {
  scopeKey: string
  savedAt: string
  settings: T
}

const DATABASE_NAME = 'retail-os-pos'
const DATABASE_VERSION = 2
const SALES_STORE = 'sales'
const CATALOG_STORE = 'catalog'
const SETTINGS_STORE = 'settings'

function openDatabase(): Promise<IDBDatabase> {
  if (typeof indexedDB === 'undefined') {
    return Promise.reject(new Error('Offline storage is unavailable in this browser.'))
  }

  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION)
    request.onerror = () => reject(request.error || new Error('Unable to open offline storage.'))
    request.onblocked = () => reject(new Error('Close other Retail OS tabs so offline storage can be upgraded.'))
    request.onupgradeneeded = () => {
      const database = request.result
      if (!database.objectStoreNames.contains(SALES_STORE)) {
        const sales = database.createObjectStore(SALES_STORE, { keyPath: 'idempotencyKey' })
        sales.createIndex('scopeKey', 'scopeKey', { unique: false })
      }
      if (!database.objectStoreNames.contains(CATALOG_STORE)) {
        database.createObjectStore(CATALOG_STORE, { keyPath: 'scopeKey' })
      }
      if (!database.objectStoreNames.contains(SETTINGS_STORE)) {
        database.createObjectStore(SETTINGS_STORE, { keyPath: 'scopeKey' })
      }
    }
    request.onsuccess = () => resolve(request.result)
  })
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error || new Error('Offline storage request failed.'))
  })
}

function transactionComplete(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve()
    transaction.onerror = () => reject(transaction.error || new Error('Offline storage transaction failed.'))
    transaction.onabort = () => reject(transaction.error || new Error('Offline storage transaction was cancelled.'))
  })
}

export async function saveQueuedSale(sale: QueuedPosSale) {
  const database = await openDatabase()
  try {
    const transaction = database.transaction(SALES_STORE, 'readwrite')
    const completed = transactionComplete(transaction)
    transaction.objectStore(SALES_STORE).put(sale)
    await completed
  } finally {
    database.close()
  }
}

export async function removeQueuedSale(idempotencyKey: string) {
  const database = await openDatabase()
  try {
    const transaction = database.transaction(SALES_STORE, 'readwrite')
    const completed = transactionComplete(transaction)
    transaction.objectStore(SALES_STORE).delete(idempotencyKey)
    await completed
  } finally {
    database.close()
  }
}

export async function listQueuedSales(scopeKey: string): Promise<QueuedPosSale[]> {
  const database = await openDatabase()
  try {
    const transaction = database.transaction(SALES_STORE, 'readonly')
    const completed = transactionComplete(transaction)
    const index = transaction.objectStore(SALES_STORE).index('scopeKey')
    const result = await requestResult(index.getAll(scopeKey) as IDBRequest<QueuedPosSale[]>)
    await completed
    return result.sort((left, right) => left.createdAt.localeCompare(right.createdAt))
  } finally {
    database.close()
  }
}

export async function saveCatalogSnapshot<T>(scopeKey: string, catalog: T[]) {
  const database = await openDatabase()
  try {
    const transaction = database.transaction(CATALOG_STORE, 'readwrite')
    const completed = transactionComplete(transaction)
    transaction.objectStore(CATALOG_STORE).put({
      scopeKey,
      savedAt: new Date().toISOString(),
      catalog,
    } satisfies PosCatalogSnapshot<T>)
    await completed
  } finally {
    database.close()
  }
}

export async function getCatalogSnapshot<T>(scopeKey: string): Promise<PosCatalogSnapshot<T> | null> {
  const database = await openDatabase()
  try {
    const transaction = database.transaction(CATALOG_STORE, 'readonly')
    const completed = transactionComplete(transaction)
    const result = await requestResult(
      transaction.objectStore(CATALOG_STORE).get(scopeKey) as IDBRequest<PosCatalogSnapshot<T> | undefined>,
    )
    await completed
    return result || null
  } finally {
    database.close()
  }
}

export async function saveSettingsSnapshot<T>(scopeKey: string, settings: T) {
  const database = await openDatabase()
  try {
    const transaction = database.transaction(SETTINGS_STORE, 'readwrite')
    const completed = transactionComplete(transaction)
    transaction.objectStore(SETTINGS_STORE).put({
      scopeKey,
      savedAt: new Date().toISOString(),
      settings,
    } satisfies PosSettingsSnapshot<T>)
    await completed
  } finally {
    database.close()
  }
}

export async function getSettingsSnapshot<T>(scopeKey: string): Promise<PosSettingsSnapshot<T> | null> {
  const database = await openDatabase()
  try {
    const transaction = database.transaction(SETTINGS_STORE, 'readonly')
    const completed = transactionComplete(transaction)
    const result = await requestResult(
      transaction.objectStore(SETTINGS_STORE).get(scopeKey) as IDBRequest<PosSettingsSnapshot<T> | undefined>,
    )
    await completed
    return result || null
  } finally {
    database.close()
  }
}

export function getPosDeviceId() {
  const storageKey = 'retail-os-pos-device-id'
  try {
    const existing = window.localStorage.getItem(storageKey)
    if (existing) return existing
    const created = crypto.randomUUID()
    window.localStorage.setItem(storageKey, created)
    return created
  } catch {
    return crypto.randomUUID()
  }
}

export function offlineReceiptNumber(idempotencyKey: string) {
  return `RCP-${idempotencyKey.replaceAll('-', '').toUpperCase()}`
}
