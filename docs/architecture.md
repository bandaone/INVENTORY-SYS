# Architecture Guide

## Overview

Retail OS is built on an offline-first, multi-tenant architecture designed to operate reliably in environments with intermittent internet connectivity. This document describes the system's architectural patterns, component interactions, and design decisions.

## Architectural Principles

### 1. Offline-First Design

Every component prioritizes local operation:
- **POS Application**: Uses local SQLite database as source of truth
- **Stocktake App**: Caches data in IndexedDB, queues actions offline
- **Sync Engine**: Bidirectional replication with sequence-based ordering

```
Local SQLite → Sync Queue → Cloud PostgreSQL
     ↓              ↓              ↓
  Immediate     Ordered      Eventually
  Operation     Replay       Consistent
```

### 2. Multi-Tenant Isolation

Data separation enforced at multiple layers:

**Database Layer** (PostgreSQL Row-Level Security):
```sql
-- Every table includes tenant_id
ALTER TABLE garments ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON garments
  USING (tenant_id = current_setting('app.current_tenant')::UUID);
```

**Application Layer**:
```typescript
// Tenant context from JWT token
middleware.use((req, res, next) => {
  const tenantId = req.user.tenantId;
  req.db.setTenantContext(tenantId);
  next();
});
```

**API Layer**: Every request authenticated and scoped to tenant

### 3. Audit Trail Integrity

All state changes are logged immutably:
- Append-only `stock_movements` and `audit_trail` tables
- No DELETE or UPDATE operations on historical records
- Sequence numbers preserve ordering across distributed devices

### 4. Sequence-Based Conflict Resolution

Sync order determined by monotonic sequence numbers, not timestamps:

```typescript
// Device assigns sequence number on write
const entry = {
  sequenceNumber: getNextSequence(),  // Local counter
  action: 'SALE',
  garmentSerial: 'ABC123',
  timestamp: Date.now(),              // For display only
  deviceId: 'POS-001'
};
```

Conflicts resolved by sequence number precedence:
- Sale before Stocktake → Sale wins
- Transfer vs Sale → Manual review required

## System Architecture

### High-Level Diagram

```
┌─────────────────────────────────────────────────────────────┐
│                     Cloud Infrastructure                      │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────┐  │
│  │  MedusaJS    │  │  PostgreSQL  │  │  Owner Dashboard │  │
│  │   Backend    │◄─┤     RDS      │  │   (Next.js/S3)   │  │
│  │  (EC2/ALB)   │  │  Multi-Tenant│  │                  │  │
│  └──────┬───────┘  └──────────────┘  └──────────────────┘  │
│         │                                                     │
│         ├──────────► ZRA Gateway (Smart Invoice)            │
│         ├──────────► MTN MoMo API                            │
│         └──────────► Airtel Money API                        │
└─────────────────────────────────────────────────────────────┘
           ▲                    ▲
           │ Sync Queue         │ Real-time API
           │                    │
    ┌──────┴────────┐    ┌─────┴──────────┐
    │  POS App      │    │  Stocktake App │
    │  (Flutter)    │    │  (Mobile Web)  │
    │               │    │                │
    │ ┌───────────┐ │    │ ┌────────────┐│
    │ │  SQLite   │ │    │ │ IndexedDB  ││
    │ │  Database │ │    │ └────────────┘│
    │ └───────────┘ │    └────────────────┘
    │       │       │
    │   ┌───┴────┐  │
    │   │ Label  │  │
    │   │Printer │  │
    │   └────────┘  │
    └───────────────┘
   Store Location A
```

### Component Interactions

#### POS Checkout Flow

```
1. Cashier scans QR code
   ↓
2. POS queries local SQLite (< 300ms)
   ↓
3. Garment added to cart
   ↓
4. Cashier initiates payment
   ↓
5. [Cash] → Open drawer, print receipt
   [Mobile Money] → USSD push via backend → Await webhook
   ↓
6. Transaction written to SQLite with sequence number
   ↓
7. Garment status → "Sold"
   ↓
8. Sync queue entry created (async)
   ↓
9. When online: Sync engine replays to cloud PostgreSQL
```

#### Stock Ingestion Flow

```
1. Store Manager enters variant + quantities
   ↓
2. System generates unique serials (UUID-based)
   ↓
3. Serials saved to SQLite with status "In Stock"
   ↓
4. Stock movement logged (type: "Ingestion")
   ↓
5. ESC/POS print commands sent to label printer
   ↓
6. Labels printed with QR codes
   ↓
7. Sync queue entry created
   ↓
8. When online: Serials replicated to cloud
```

#### Stocktake Flow

```
1. Stock Clerk starts session (location + area)
   ↓
2. Scans garments (camera QR or RFID wand)
   ↓
3. Each scan checked against local cache/API
   ↓
4. Results categorized:
   - Matched (green): Expected and found
   - Missing (red): Expected but not scanned
   - Unexpected (amber): Scanned but wrong location/not found
   ↓
5. Clerk commits stocktake
   ↓
6. Missing items → status "Missing", shrinkage recorded
   ↓
7. Stock movements logged
   ↓
8. Sync queue entry created
```

## Data Flow Patterns

### Sync Engine Architecture

The sync engine provides bidirectional replication with conflict detection:

```typescript
// Device → Cloud (Upstream Sync)
class UpstreamSync {
  async processQueue(deviceId: string, tenantId: string) {
    const entries = await getLocalSyncQueue(deviceId);
    
    for (const entry of entries.sortBy('sequenceNumber')) {
      const conflicts = await this.detectConflicts(entry);
      
      if (conflicts.length === 0) {
        await this.applyToCloud(entry);
        await this.markSynced(entry.sequenceNumber);
      } else {
        await this.flagForManualReview(entry, conflicts);
      }
    }
  }
  
  async detectConflicts(entry: SyncEntry): Promise<Conflict[]> {
    // Check if garment affected by multiple actions
    const cloudState = await this.getCloudState(entry.garmentSerial);
    const otherActions = await this.getPendingActions(entry.garmentSerial);
    
    // Example: Sale + Stocktake on same serial
    if (entry.action === 'STOCKTAKE_MISSING' && 
        otherActions.some(a => a.action === 'SALE')) {
      return [{
        type: 'SALE_BEFORE_STOCKTAKE',
        resolution: 'PREFER_SALE'
      }];
    }
    
    // Example: Transfer + Sale from different locations
    if (entry.action === 'SALE' && 
        otherActions.some(a => a.action === 'TRANSFER')) {
      return [{
        type: 'TRANSFER_SALE_CONFLICT',
        resolution: 'MANUAL_REVIEW'
      }];
    }
    
    return [];
  }
}

// Cloud → Device (Downstream Sync)
class DownstreamSync {
  async pullChanges(deviceId: string, lastSyncSeq: number) {
    const changes = await this.getCloudChanges(lastSyncSeq);
    
    // Filter by tenant and location context
    const filtered = changes.filter(c => 
      c.tenantId === device.tenantId &&
      (c.locationId === device.locationId || c.isGlobal)
    );
    
    return {
      entries: filtered,
      nextSequence: this.getCloudSequence()
    };
  }
}
```

### Conflict Resolution Rules

| Conflict Type | Resolution Strategy | Rationale |
|--------------|---------------------|-----------|
| Sale vs Stocktake (same serial) | Prefer Sale | Transaction is authoritative |
| Transfer vs Sale (simultaneous) | Manual review | Requires investigation |
| Multiple stocktakes (overlapping) | Last committed wins | Timestamp-based tie-breaker |
| Sale of already-sold item | Reject, alert | Data integrity violation |

## Database Schema Design

### Core Entity Relationships

```
Tenant 1──────────┐
  ↓              │
  ├──> Location  │
  ├──> Staff     │  All entities
  ├──> Variant   │  include tenant_id
  └──> Garment   │  for RLS
       ↓         │
       Transaction
       ↓         │
       StockMovement
                 │
                 └──> Audit Trail (immutable)
```

### Key Indexes

```sql
-- Fast serial lookup (POS critical path)
CREATE INDEX idx_garments_serial ON garments(serial) 
  INCLUDE (variant_id, status, retail_price, location_id);

-- Sync queue ordering
CREATE INDEX idx_sync_queue_seq ON sync_queue(device_id, sequence_number)
  WHERE synced_at IS NULL;

-- Audit trail queries
CREATE INDEX idx_audit_trail_tenant_time ON audit_trail(tenant_id, created_at DESC);

-- Stocktake session lookups
CREATE INDEX idx_stocktake_sessions ON stocktake_sessions(location_id, status, created_at);
```

### Multi-Tenant RLS Implementation

Every table includes tenant_id and RLS policy:

```sql
-- Template for all tables
CREATE TABLE example_table (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  -- ... other columns ...
  CONSTRAINT fk_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
);

ALTER TABLE example_table ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON example_table
  USING (tenant_id = current_setting('app.current_tenant')::UUID);

-- Set tenant context at connection start
SET app.current_tenant = '<tenant-uuid>';
```

## Integration Patterns

### ZRA Smart Invoice Integration

```typescript
class ZraInvoiceService {
  async generateInvoice(transaction: Transaction): Promise<ZraInvoice> {
    const certificate = await this.getCertificate(transaction.tenantId);
    
    const invoiceData = {
      tpin: certificate.tpin,
      receiptNumber: transaction.receiptNumber,
      items: transaction.items.map(item => ({
        description: item.variantName,
        quantity: 1,
        unitPrice: item.retailPrice,
        taxAmount: item.retailPrice * 0.16  // 16% VAT
      })),
      totalAmount: transaction.total,
      issueDate: transaction.createdAt
    };
    
    // Sign offline using local certificate
    const signature = await this.signInvoice(invoiceData, certificate.privateKey);
    
    return {
      ...invoiceData,
      signature,
      qrCode: this.generateQrCode(signature)
    };
  }
  
  async submitToGateway(invoice: ZraInvoice): Promise<void> {
    // Submit when online
    try {
      await this.zraClient.post('/api/v1/invoices', invoice);
    } catch (error) {
      // Queue for retry
      await this.queueForRetry(invoice);
    }
  }
}
```

### Mobile Money Payment Flow

```typescript
interface PaymentAdapter {
  initiatePayment(amount: number, phoneNumber: string): Promise<string>; // transactionId
  checkStatus(transactionId: string): Promise<PaymentStatus>;
  handleWebhook(payload: unknown, signature: string): Promise<PaymentResult>;
}

class MtnMomoAdapter implements PaymentAdapter {
  async initiatePayment(amount: number, phoneNumber: string): Promise<string> {
    const response = await this.momoClient.post('/collection/v1_0/requesttopay', {
      amount: amount.toString(),
      currency: 'ZMW',
      externalId: uuidv4(),
      payer: { partyIdType: 'MSISDN', partyId: phoneNumber },
      payerMessage: 'Retail OS Purchase',
      payeeNote: 'Payment for order'
    }, {
      headers: {
        'Authorization': `Bearer ${await this.getAccessToken()}`,
        'X-Target-Environment': 'production',
        'X-Reference-Id': uuidv4()
      }
    });
    
    return response.headers['x-reference-id'];
  }
  
  async handleWebhook(payload: any, signature: string): Promise<PaymentResult> {
    // Validate signature
    const isValid = await this.validateSignature(payload, signature);
    if (!isValid) throw new Error('Invalid webhook signature');
    
    return {
      success: payload.status === 'SUCCESSFUL',
      transactionId: payload.externalId,
      amount: parseFloat(payload.amount),
      message: payload.reason || 'Payment completed'
    };
  }
}
```

## Security Architecture

### Authentication & Authorization

```typescript
// JWT token structure
interface JwtPayload {
  userId: string;
  tenantId: string;
  role: 'owner' | 'store_manager' | 'cashier' | 'stock_clerk';
  locationId?: string;  // Null for owners
  deviceId?: string;    // For POS/Stocktake devices
}

// Role-based middleware
function requireRole(...allowedRoles: string[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!allowedRoles.includes(req.user.role)) {
      return res.status(403).json({ error: 'Insufficient permissions' });
    }
    next();
  };
}

// Example route protection
router.post('/admin/staff', 
  authenticate, 
  requireRole('owner'),
  createStaffHandler
);
```

### PIN Authentication (POS/Stocktake)

```dart
// Flutter POS
class PinAuthService {
  Future<Staff?> authenticate(String pin) async {
    final pinHash = hashPin(pin);
    final staff = await db.staff
      .where('pin_hash = ? AND is_active = 1')
      .get(pinHash);
      
    if (staff == null) {
      await incrementFailedAttempts();
      return null;
    }
    
    if (staff.failedLoginAttempts >= 3 && 
        staff.lockoutUntil.isAfter(DateTime.now())) {
      throw PinLockoutException(staff.lockoutUntil);
    }
    
    await resetFailedAttempts(staff.id);
    return staff;
  }
}
```

### Data Encryption

- **In Transit**: TLS 1.3 for all API communication
- **At Rest**: 
  - PostgreSQL RDS encryption enabled
  - SQLite databases encrypted using SQLCipher
  - ZRA certificates stored in device keychain/keystore

## Performance Optimization

### Database Indexes (POS Critical Path)

```sql
-- Serial lookup must be < 300ms
EXPLAIN ANALYZE
SELECT g.serial, g.status, g.retail_price, v.name, v.color, v.size
FROM garments g
JOIN variants v ON g.variant_id = v.id
WHERE g.serial = 'ABC123';

-- Result: Index Scan on idx_garments_serial (cost=0.42..8.44 rows=1)
--         Execution time: 0.152 ms ✓
```

### Sync Queue Batching

```typescript
// Process sync queue in batches
const BATCH_SIZE = 100;

async function syncUpstream(deviceId: string) {
  while (true) {
    const batch = await getSyncQueue(deviceId, BATCH_SIZE);
    if (batch.length === 0) break;
    
    // Process batch in parallel where safe
    const results = await Promise.allSettled(
      batch.map(entry => processEntry(entry))
    );
    
    // Mark successful entries
    const successful = results
      .filter(r => r.status === 'fulfilled')
      .map((r, i) => batch[i].sequenceNumber);
    await markSynced(successful);
  }
}
```

### Dashboard Query Optimization

```typescript
// Materialized view for dashboard metrics
CREATE MATERIALIZED VIEW dashboard_metrics AS
SELECT 
  tenant_id,
  location_id,
  DATE(created_at) as date,
  SUM(total) as daily_revenue,
  COUNT(*) as transaction_count,
  SUM(CASE WHEN payment_method = 'CASH' THEN total ELSE 0 END) as cash_revenue
FROM transactions
GROUP BY tenant_id, location_id, DATE(created_at);

-- Refresh hourly via cron job
REFRESH MATERIALIZED VIEW CONCURRENTLY dashboard_metrics;
```

## Scalability Considerations

### Horizontal Scaling

- **Backend API**: Stateless Node.js processes behind ALB
- **Database**: PostgreSQL read replicas for reports
- **Job Queue**: Redis cluster for Bull queues

### Vertical Limits

- **Single Tenant**: Up to 20 locations, 100 devices
- **Single Location**: Up to 50,000 active garments
- **Sync Queue**: Up to 10,000 pending actions per device

### Performance Targets

| Operation | Target | Measurement |
|-----------|--------|-------------|
| Serial lookup (POS) | < 300ms | 99th percentile |
| Transaction save (POS) | < 500ms | 99th percentile |
| Dashboard load | < 3s | Median |
| Sync batch (1000 items) | < 60s | 95th percentile |
| Stocktake scan response | < 500ms | 99th percentile |

## Deployment Architecture

See [Deployment Guide](deployment.md) for detailed infrastructure setup.

```
┌─────────────────────────────────────────────────────────┐
│                    AWS Production                       │
│                                                         │
│  ┌──────────────┐         ┌──────────────┐           │
│  │ Route 53     │────────►│ CloudFront   │           │
│  │ DNS          │         │ + S3 (Static)│           │
│  └──────────────┘         └──────────────┘           │
│                                  │                     │
│                    ┌─────────────┴──────────────┐    │
│                    │                             │    │
│              ┌─────▼─────┐             ┌────────▼─┐  │
│              │    ALB    │             │ Next.js  │  │
│              │           │             │Dashboard │  │
│              └─────┬─────┘             └──────────┘  │
│                    │                                  │
│        ┌───────────┴──────────┐                      │
│        │                      │                      │
│   ┌────▼─────┐         ┌─────▼────┐                │
│   │ EC2 ASG  │         │ EC2 ASG  │                │
│   │MedusaJS 1│         │MedusaJS 2│                │
│   └────┬─────┘         └─────┬────┘                │
│        │                     │                      │
│        └──────────┬──────────┘                      │
│                   │                                  │
│         ┌─────────▼──────────┐                      │
│         │  PostgreSQL RDS    │                      │
│         │  Multi-AZ          │                      │
│         └────────────────────┘                      │
│                                                      │
└──────────────────────────────────────────────────────┘
```

## Monitoring & Observability

### Key Metrics

```typescript
// CloudWatch metrics
metrics.record('sync.queue.depth', queueDepth, { deviceId });
metrics.record('pos.scan.latency', scanTime, { locationId });
metrics.record('transaction.completed', 1, { paymentMethod });
metrics.record('stocktake.item.scanned', 1, { category: 'matched' });
```

### Logging Strategy

- **Application Logs**: Structured JSON to CloudWatch Logs
- **Audit Trail**: Database table (immutable)
- **Error Tracking**: Sentry or CloudWatch Insights
- **Sync Events**: Dedicated log group for troubleshooting

## Further Reading

- [API Reference](api-reference.md)
- [Database Schema](database-schema.md)
- [Deployment Guide](deployment.md)
- [Testing Strategy](testing.md)
