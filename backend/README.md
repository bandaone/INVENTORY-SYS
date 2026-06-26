# Retail OS Backend

MedusaJS-based backend API providing multi-tenant retail operations.

## Overview

The backend provides:
- RESTful API for POS, Dashboard, and Stocktake applications
- Multi-tenant data isolation with PostgreSQL RLS
- Offline-first sync engine with conflict resolution
- ZRA Smart Invoice integration
- MTN MoMo and Airtel Money payment processing
- Background job processing with Bull queues

## Tech Stack

- **Runtime**: Node.js 18+
- **Framework**: MedusaJS 2.x
- **Database**: PostgreSQL 15+ with Row-Level Security
- **Cache/Queue**: Redis 7+
- **ORM**: MedusaJS data layer (Mikro-ORM)

## Project Structure

```
backend/
├── src/
│   ├── api/                    # Custom API routes
│   │   ├── admin/             # Admin endpoints (owner/manager)
│   │   ├── store/             # Store endpoints (POS/stocktake)
│   │   └── webhooks/          # Payment webhooks
│   ├── models/                # Database entities
│   │   ├── tenant.ts
│   │   ├── location.ts
│   │   ├── staff.ts
│   │   ├── variant.ts
│   │   ├── garment.ts
│   │   ├── transaction.ts
│   │   └── stock-movement.ts
│   ├── services/              # Business logic
│   │   ├── sync-engine.service.ts
│   │   ├── zra-invoice.service.ts
│   │   ├── payment-adapters/
│   │   │   ├── mtn-momo.adapter.ts
│   │   │   └── airtel-money.adapter.ts
│   │   ├── stock-ingestion.service.ts
│   │   └── printer.service.ts
│   ├── subscribers/           # Event handlers
│   │   ├── transaction.subscriber.ts
│   │   └── sync.subscriber.ts
│   ├── migrations/            # Database migrations
│   ├── utils/                 # Helper functions
│   └── types/                 # TypeScript types
├── test/
│   ├── integration/
│   └── fixtures/
├── .env.example
├── medusa-config.js
├── package.json
└── tsconfig.json
```

## Quick Start

See [Development Setup](../docs/development-setup.md) for detailed instructions.

```bash
# Install dependencies
npm install

# Configure environment
cp .env.example .env
# Edit .env with your database credentials

# Run migrations
npm run migrate

# Start development server
npm run dev

# Server runs at http://localhost:9000
```

## API Documentation

Complete API documentation available at:
- Development: http://localhost:9000/docs
- Online: [API Reference](../docs/api-reference.md)

## Testing

```bash
# Unit tests
npm test

# Integration tests
npm run test:integration

# E2E tests
npm run test:e2e

# Coverage report
npm run test:coverage

# Watch mode
npm run test:watch
```

## Database

### Migrations

```bash
# Create new migration
npm run migrate:create -- --name add_stock_movements

# Run migrations
npm run migrate

# Rollback last migration
npm run migrate:rollback

# Reset database (CAUTION: deletes all data)
npm run db:reset
```

### Seeding

```bash
# Seed development data
npm run seed

# Seed test data
npm run seed:test
```

## Environment Variables

Required variables (see `.env.example`):

```bash
# Database
DATABASE_URL=postgresql://user:password@localhost:5432/retail_os_dev
DATABASE_LOGGING=true

# Redis
REDIS_URL=redis://localhost:6379

# JWT
JWT_SECRET=your-secret-key
JWT_EXPIRATION=24h

# ZRA Credentials
ZRA_GATEWAY_URL=https://sandbox.zra.org.zm/api/v1
ZRA_CLIENT_ID=your-client-id
ZRA_CLIENT_SECRET=your-client-secret

# Mobile Money
MTN_MOMO_API_KEY=your-api-key
AIRTEL_MONEY_CLIENT_ID=your-client-id
```

## Architecture

### Multi-Tenant Isolation

Every request is scoped to a tenant via JWT token:

```typescript
// Middleware sets tenant context
app.use((req, res, next) => {
  const tenantId = req.user.tenantId;
  req.db.setTenantContext(tenantId);
  next();
});

// Database queries automatically filtered by tenant
const variants = await db.variants.find(); // Only returns current tenant's data
```

### Sync Engine

Processes offline queue from devices:

```typescript
// Device uploads sync batch
POST /admin/sync/batch
{
  deviceId: "POS-001",
  entries: [
    { sequenceNumber: 1, action: "SALE", ... },
    { sequenceNumber: 2, action: "STOCKTAKE", ... }
  ]
}

// Sync engine:
// 1. Orders by sequence number
// 2. Detects conflicts
// 3. Applies or flags for review
```

### Payment Processing

Adapter pattern for payment providers:

```typescript
interface PaymentAdapter {
  initiatePayment(amount: number, phoneNumber: string): Promise<string>;
  handleWebhook(payload: unknown): Promise<PaymentResult>;
}

class MtnMomoAdapter implements PaymentAdapter { /* ... */ }
class AirtelMoneyAdapter implements PaymentAdapter { /* ... */ }
```

## Performance

### Database Indexes

Critical indexes for performance:

```sql
-- Serial lookup (< 300ms target)
CREATE INDEX idx_garments_serial ON garments(serial) 
  INCLUDE (variant_id, status, retail_price);

-- Sync queue processing
CREATE INDEX idx_sync_queue_pending ON sync_queue(device_id, sequence_number)
  WHERE synced_at IS NULL;
```

### Caching Strategy

```typescript
// Cache variant lookups (1 hour TTL)
const variant = await cache.get(`variant:${id}`, async () => {
  return await db.variants.findOne({ id });
}, { ttl: 3600 });
```

## Monitoring

### Health Check

```bash
curl http://localhost:9000/health
# Response: {"status":"ok","version":"1.0.0"}
```

### Metrics

Key metrics exported to CloudWatch:
- `sync.queue.depth` - Pending sync actions per device
- `transaction.completed` - Transactions per minute
- `payment.timeout` - Mobile money timeouts
- `api.latency` - Response time percentiles

## Troubleshooting

### Common Issues

**Port already in use**:
```bash
lsof -ti:9000 | xargs kill -9
```

**Database connection error**:
```bash
# Verify PostgreSQL is running
pg_isready

# Check connection string in .env
```

**Redis connection error**:
```bash
# Verify Redis is running
redis-cli ping  # Should return "PONG"
```

## Deployment

See [Deployment Guide](../docs/deployment.md) for production deployment instructions.

## Contributing

See [CONTRIBUTING.md](../CONTRIBUTING.md) for development guidelines.

## License

Proprietary - All Rights Reserved
