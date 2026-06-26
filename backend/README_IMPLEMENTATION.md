# Backend Implementation Guide

## MedusaJS v2 Custom Modules

This backend is built on MedusaJS v2 with custom modules extending the core functionality. **Do not modify core Medusa modules or files in node_modules.**

## Architecture Overview

### Core Medusa Modules (Official)
- `@medusajs/product` - Product catalog management
- `@medusajs/inventory` - Multi-location inventory
- `@medusajs/order` - Order management
- `@medusajs/auth` - Authentication
- `@medusajs/stock-location` - Location management

### Custom Modules (src/modules/)

#### 1. Serial Tracking Module (`serial-tracking/`)
Adds unique serial number tracking for individual garments.

**Models:**
- `serial_item` - Individual serial-tracked items
- `stock_movement` - Immutable movement log

**Service Methods:**
- `generateSerialsForBatch()` - Generate unique serials
- `getBySerial()` - Lookup by serial number
- `updateStatus()` - Change status and log movement
- `getStockLevelsByLocation()` - Aggregate stock levels
- `calculateShrinkage()` - Calculate loss value

#### 2. Sync Engine Module (`sync-engine/`)
Handles offline device synchronization with conflict resolution.

**Models:**
- `sync_conflict` - Detected conflicts requiring resolution

**Service Methods:**
- `processSyncBatch()` - Process batch of sync entries
- `detectConflict()` - Check for conflicts
- `resolveConflict()` - Manual resolution
- `getPendingConflicts()` - Query unresolved conflicts

**API Routes:**
- `POST /sync/push` - Upload sync batch from device
- `GET /sync/conflicts` - Get pending conflicts

**Conflict Rules:**
1. SALE beats STOCKTAKE_ADJUSTMENT → auto-resolve
2. TRANSFER vs SALE → manual review required

#### 3. Payment Providers

**MTN MoMo Provider (`payment-mtn-momo/`)**
Implements `AbstractPaymentProvider` interface:
- `initiatePayment()` - Send USSD push
- `authorizePayment()` - Check status
- `getPaymentStatus()` - Poll status
- `getWebhookActionAndData()` - Handle callbacks

**Airtel Money Provider (`payment-airtel-money/`)**
Same interface as MTN MoMo for consistency.

**Webhook Routes:**
- `POST /webhooks/mtn` - MTN MoMo callbacks
- `POST /webhooks/airtel` - Airtel Money callbacks

#### 4. ZRA Invoice Module (`zra-invoice/`)
Generates tax-compliant invoices with offline signing.

**Event Subscribers:**
- `order.placed` → Generate and sign invoice

**Service Methods:**
- `onOrderPlaced()` - Event handler
- `generateInvoice()` - Create signed invoice
- `transmitInvoice()` - Send to ZRA gateway
- `queueInvoiceTransmission()` - Queue for async transmission

**Signing Process:**
1. Retrieve tenant ZRA certificate (encrypted)
2. Generate SHA-256 hash of invoice data
3. Sign with RSA private key
4. Store base64 signature
5. Queue for transmission

#### 5. Stocktake Module (`stocktake/`)
Inventory counting with real-time categorization.

**Models:**
- `stocktake_session` - Counting session
- `stocktake_item` - Individual scanned item

**Service Methods:**
- `startSession()` - Begin stocktake
- `scanBatch()` - Process scanned serials (supports RFID bulk)
- `commitSession()` - Finalize and update statuses
- `cancelSession()` - Abort session

**API Routes:**
- `POST /stocktake/start` - Start session
- `POST /stocktake/scan` - Scan batch (max 1000 for RFID)
- `POST /stocktake/commit` - Commit session
- `GET /stocktake/:id` - Get session details

**Categorization:**
- **MATCHED**: Expected and found
- **MISSING**: Expected but not scanned
- **UNEXPECTED**: Scanned but wrong location/not found

#### 6. Audit Trail Module (`audit-trail/`)
Immutable event log for compliance.

**Model:**
- `audit_event` - Immutable event record

**PostgreSQL Policy:**
```sql
-- Only INSERT and SELECT allowed - no UPDATE/DELETE
CREATE POLICY audit_append_only ON audit_event
  FOR ALL
  TO PUBLIC
  USING (true)
  WITH CHECK (false);

CREATE POLICY audit_select ON audit_event
  FOR SELECT
  TO PUBLIC
  USING (tenant_id = current_setting('app.current_tenant')::UUID);

CREATE POLICY audit_insert ON audit_event
  FOR INSERT
  TO PUBLIC
  WITH CHECK (tenant_id = current_setting('app.current_tenant')::UUID);
```

**Event Subscriptions:**
- `order.*` events
- `inventory.*` events
- `serial_tracking.*` events
- `stocktake.*` events
- `sync.*` events
- `transfer.*` events

**API Routes:**
- `GET /audit-trail` - Query with filters

## Multi-Tenant Row-Level Security

### Middleware Setup
`src/middlewares/tenant-context.ts` sets tenant context before each request:

```typescript
// Extract tenant_id from JWT
const tenantId = req.auth_context?.tenant_id

// Set PostgreSQL session variable
await manager.query('SET LOCAL app.current_tenant = $1', [tenantId])
```

### Database Policies
Every table has RLS enabled:

```sql
ALTER TABLE serial_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON serial_items
  USING (tenant_id = current_setting('app.current_tenant')::UUID);
```

This ensures queries automatically filter by tenant without application-level checks.

## Event-Driven Architecture

Custom modules subscribe to Medusa events:

```typescript
// Example: Order placed subscriber
export default async function orderPlacedHandler({ event, container }) {
  const serialTrackingService = container.resolve("serial-tracking")
  const auditTrailService = container.resolve("audit-trail")
  const zraInvoiceService = container.resolve("zra-invoice")

  // Update serial statuses
  // Log to audit trail
  // Generate ZRA invoice
}

export const config = {
  event: "order.placed"
}
```

## Installation

```bash
# Install dependencies
npm install

# Setup environment
cp .env.example .env
# Edit .env with your credentials

# Run migrations
npm run db:migrate

# Start development server
npm run dev
```

## Database Migrations

MedusaJS handles migrations automatically for custom modules.

To create a new migration:
```bash
npm run db:create -- --name add_custom_field
```

## Testing

```bash
# Unit tests
npm test

# Integration tests
npm run test:integration

# Watch mode
npm run test:watch
```

## API Documentation

All custom routes follow REST conventions:
- `POST /sync/push` - Sync from devices
- `GET /sync/conflicts` - Query conflicts
- `POST /stocktake/start` - Start stocktake
- `POST /stocktake/scan` - Scan items
- `POST /stocktake/commit` - Commit stocktake
- `GET /audit-trail` - Query audit events
- `POST /webhooks/mtn` - MTN MoMo webhooks
- `POST /webhooks/airtel` - Airtel Money webhooks

## Key Principles

1. **Never modify core Medusa modules** - extend via custom modules
2. **Subscribe to events** - don't modify existing code
3. **Use Medusa's data layer** - leverages built-in features
4. **RLS for multi-tenancy** - enforced at database level
5. **Immutable audit trail** - PostgreSQL policies prevent modification
6. **Conflict resolution** - sequence-based, not timestamp-based
7. **Offline-first sync** - queue-based with retry logic

## Further Reading

- [MedusaJS v2 Documentation](https://docs.medusajs.com/v2)
- [Custom Modules Guide](https://docs.medusajs.com/advanced-development/modules)
- [Payment Providers](https://docs.medusajs.com/advanced-development/payment)
- [Event System](https://docs.medusajs.com/advanced-development/events)
