# Testing Strategy

Comprehensive testing approach for Retail OS across all components.

## Testing Philosophy

1. **Test offline scenarios first** - Core operations must work without connectivity
2. **Test sync conflicts** - Distributed systems require conflict resolution testing
3. **Test multi-tenancy isolation** - Data leakage is unacceptable
4. **Test hardware integration** - Mock printers, scanners, and RFID readers
5. **Performance thresholds** - Serial lookup < 300ms, transaction save < 500ms

## Testing Pyramid

```
         E2E Tests (5%)
      Integration Tests (25%)
    Unit Tests (70%)
```

## Backend Testing (MedusaJS)

### Unit Tests

Located in `backend/src/**/__tests__/*.spec.ts`

#### Example: Sync Engine Unit Test

```typescript
import { SyncEngineService } from '../services/sync-engine.service';
import { ConflictType } from '../types';

describe('SyncEngineService', () => {
  let service: SyncEngineService;
  let mockDb: jest.Mocked<Database>;

  beforeEach(() => {
    mockDb = createMockDatabase();
    service = new SyncEngineService(mockDb);
  });

  describe('detectConflicts', () => {
    it('should detect sale before stocktake conflict', async () => {
      const entries = [
        { sequenceNumber: 10, action: 'SALE', garmentSerial: 'ABC123' },
        { sequenceNumber: 15, action: 'STOCKTAKE_MISSING', garmentSerial: 'ABC123' }
      ];

      const conflicts = await service.detectConflicts(entries[1]);

      expect(conflicts).toHaveLength(1);
      expect(conflicts[0].type).toBe(ConflictType.SALE_BEFORE_STOCKTAKE);
      expect(conflicts[0].resolution).toBe('PREFER_SALE');
    });

    it('should flag transfer vs sale for manual review', async () => {
      const entries = [
        { sequenceNumber: 20, action: 'TRANSFER', garmentSerial: 'XYZ789', deviceId: 'POS-001' },
        { sequenceNumber: 22, action: 'SALE', garmentSerial: 'XYZ789', deviceId: 'POS-002' }
      ];

      const conflicts = await service.detectConflicts(entries[1]);

      expect(conflicts).toHaveLength(1);
      expect(conflicts[0].type).toBe(ConflictType.TRANSFER_SALE_CONFLICT);
      expect(conflicts[0].resolution).toBe('MANUAL_REVIEW');
    });
  });

  describe('processSyncBatch', () => {
    it('should process entries in sequence order', async () => {
      const entries = [
        { sequenceNumber: 5, action: 'SALE', garmentSerial: 'ABC123' },
        { sequenceNumber: 3, action: 'INGESTION', garmentSerial: 'ABC123' },
        { sequenceNumber: 7, action: 'STOCKTAKE', garmentSerial: 'ABC123' }
      ];

      const result = await service.processSyncBatch('tenant-1', entries);

      // Should process in order: 3, 5, 7
      expect(mockDb.garments.update).toHaveBeenNthCalledWith(1, 
        expect.objectContaining({ sequenceNumber: 3 }));
      expect(mockDb.garments.update).toHaveBeenNthCalledWith(2, 
        expect.objectContaining({ sequenceNumber: 5 }));
    });
  });
});
```

### Integration Tests

Located in `backend/src/**/__tests__/*.integration.ts`

#### Example: Transaction Flow Integration Test

```typescript
import { TestServer } from '../test-utils/test-server';
import { createTestTenant, createTestStaff } from '../test-utils/fixtures';

describe('Transaction Flow (Integration)', () => {
  let server: TestServer;
  let tenant: Tenant;
  let cashier: Staff;
  let token: string;

  beforeAll(async () => {
    server = await TestServer.create();
    tenant = await createTestTenant(server.db);
    cashier = await createTestStaff(server.db, { role: 'cashier', tenantId: tenant.id });
    token = server.generateToken({ userId: cashier.id, tenantId: tenant.id, role: 'cashier' });
  });

  afterAll(async () => {
    await server.close();
  });

  it('should complete cash transaction and update garment status', async () => {
    // 1. Create variant and ingest stock
    const variant = await server.db.variants.create({
      tenantId: tenant.id,
      name: 'Test Shirt',
      retailPrice: 50.00
    });

    const ingestion = await server.request
      .post('/admin/stock/ingest')
      .set('Authorization', `Bearer ${token}`)
      .send({ variantId: variant.id, locationId: cashier.locationId, quantity: 1 })
      .expect(201);

    const serial = ingestion.body.serials[0].serial;

    // 2. Create transaction
    const transaction = await server.request
      .post('/store/transactions')
      .set('Authorization', `Bearer ${token}`)
      .send({
        locationId: cashier.locationId,
        cashierId: cashier.id,
        items: [{ garmentSerial: serial, variantId: variant.id, retailPrice: 50.00 }],
        paymentMethod: 'CASH',
        cashTendered: 100.00
      })
      .expect(201);

    expect(transaction.body.total).toBe(50.00);
    expect(transaction.body.change).toBe(50.00);
    expect(transaction.body.receiptNumber).toMatch(/^RCT-/);

    // 3. Verify garment status updated
    const garment = await server.db.garments.findOne({ serial });
    expect(garment.status).toBe('sold');

    // 4. Verify stock movement logged
    const movements = await server.db.stockMovements.find({ garmentSerial: serial });
    expect(movements).toHaveLength(2); // Ingestion + Sale
    expect(movements[1].type).toBe('SALE');
  });

  it('should reject transaction for already-sold garment', async () => {
    const serial = 'ALREADY-SOLD-123';
    await server.db.garments.create({
      tenantId: tenant.id,
      serial,
      status: 'sold',
      locationId: cashier.locationId
    });

    const response = await server.request
      .post('/store/transactions')
      .set('Authorization', `Bearer ${token}`)
      .send({
        items: [{ garmentSerial: serial, retailPrice: 50.00 }],
        paymentMethod: 'CASH'
      })
      .expect(400);

    expect(response.body.error.code).toBe('GARMENT_ALREADY_SOLD');
  });
});
```

### Multi-Tenancy Tests

```typescript
describe('Multi-Tenant Isolation', () => {
  it('should not allow tenant A to access tenant B data', async () => {
    const tenantA = await createTestTenant(server.db, { name: 'Tenant A' });
    const tenantB = await createTestTenant(server.db, { name: 'Tenant B' });

    const ownerA = await createTestStaff(server.db, { role: 'owner', tenantId: tenantA.id });
    const tokenA = server.generateToken({ userId: ownerA.id, tenantId: tenantA.id });

    // Create variant in tenant B
    const variantB = await server.db.variants.create({
      tenantId: tenantB.id,
      name: 'Tenant B Variant'
    });

    // Attempt to access from tenant A
    const response = await server.request
      .get(`/admin/variants/${variantB.id}`)
      .set('Authorization', `Bearer ${tokenA}`)
      .expect(404);

    expect(response.body.error).toBe('Variant not found');
  });

  it('should enforce RLS at database level', async () => {
    const tenantA = await createTestTenant(server.db);
    const tenantB = await createTestTenant(server.db);

    // Set tenant context to A
    await server.db.raw(`SET app.current_tenant = '${tenantA.id}'`);

    // Query should only return tenant A variants
    const variants = await server.db.variants.find();
    expect(variants.every(v => v.tenantId === tenantA.id)).toBe(true);
  });
});
```

### Running Backend Tests

```bash
cd backend

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

## POS Application Testing (Flutter)

### Widget Tests

Located in `pos-app/test/widgets/**/*_test.dart`

```dart
import 'package:flutter_test/flutter_test.dart';
import 'package:pos_app/features/checkout/widgets/cart_item.dart';

void main() {
  group('CartItem Widget', () {
    testWidgets('displays garment details correctly', (tester) async {
      final garment = Garment(
        serial: 'ABC123',
        variantName: 'Cotton T-Shirt - Blue - L',
        retailPrice: 50.00,
      );

      await tester.pumpWidget(
        MaterialApp(home: CartItem(garment: garment)),
      );

      expect(find.text('Cotton T-Shirt - Blue - L'), findsOneWidget);
      expect(find.text('ABC123'), findsOneWidget);
      expect(find.text('K 50.00'), findsOneWidget);
    });

    testWidgets('calls onRemove when delete button tapped', (tester) async {
      bool removeCalled = false;
      final garment = Garment(serial: 'ABC123', retailPrice: 50.00);

      await tester.pumpWidget(
        MaterialApp(
          home: CartItem(
            garment: garment,
            onRemove: () => removeCalled = true,
          ),
        ),
      );

      await tester.tap(find.byIcon(Icons.delete));
      expect(removeCalled, isTrue);
    });
  });
}
```

### Integration Tests

Located in `pos-app/integration_test/**/*_test.dart`

```dart
import 'package:flutter_test/flutter_test.dart';
import 'package:integration_test/integration_test.dart';
import 'package:pos_app/main.dart' as app;

void main() {
  IntegrationTestWidgetsFlutterBinding.ensureInitialized();

  group('Checkout Flow', () {
    testWidgets('complete cash transaction', (tester) async {
      app.main();
      await tester.pumpAndSettle();

      // 1. Login with PIN
      await tester.enterText(find.byKey(Key('pin-input')), '1234');
      await tester.tap(find.text('Login'));
      await tester.pumpAndSettle();

      // 2. Scan item
      await tester.tap(find.byIcon(Icons.qr_code_scanner));
      await tester.pumpAndSettle();
      // Simulate scan result
      await tester.tap(find.text('Use Test Serial'));
      await tester.pumpAndSettle();

      // 3. Verify item in cart
      expect(find.text('Cotton T-Shirt'), findsOneWidget);
      expect(find.text('K 50.00'), findsOneWidget);

      // 4. Checkout
      await tester.tap(find.text('Checkout'));
      await tester.pumpAndSettle();

      // 5. Select cash payment
      await tester.tap(find.text('Cash'));
      await tester.pumpAndSettle();

      // 6. Enter tendered amount
      await tester.enterText(find.byKey(Key('cash-tendered')), '100');
      await tester.tap(find.text('Complete'));
      await tester.pumpAndSettle();

      // 7. Verify receipt screen
      expect(find.text('Transaction Complete'), findsOneWidget);
      expect(find.textContaining('Change: K 50.00'), findsOneWidget);
    });
  });
}
```

### Mock Services

```dart
class MockScannerService extends Mock implements ScannerService {
  @override
  Stream<String> get scanStream => Stream.value('TEST-SERIAL-123');
}

class MockDatabaseService extends Mock implements DatabaseService {
  @override
  Future<Garment?> getGarmentBySerial(String serial) async {
    if (serial == 'TEST-SERIAL-123') {
      return Garment(
        serial: serial,
        variantName: 'Test Garment',
        retailPrice: 50.00,
        status: 'in_stock',
      );
    }
    return null;
  }
}
```

### Running POS Tests

```bash
cd pos-app

# Unit and widget tests
flutter test

# Integration tests (requires device/emulator)
flutter test integration_test

# Coverage
flutter test --coverage
genhtml coverage/lcov.info -o coverage/html
```

## Dashboard Testing (Next.js)

### Component Tests (Jest + React Testing Library)

Located in `dashboard/__tests__/components/**/*.test.tsx`

```typescript
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DashboardMetrics } from '@/components/DashboardMetrics';
import { mockMetrics } from '@/test-utils/fixtures';

describe('DashboardMetrics', () => {
  it('renders metrics correctly', () => {
    render(<DashboardMetrics metrics={mockMetrics} />);

    expect(screen.getByText("Today's Revenue")).toBeInTheDocument();
    expect(screen.getByText('K 12,500.00')).toBeInTheDocument();
    expect(screen.getByText('Active Stock Value')).toBeInTheDocument();
    expect(screen.getByText('K 250,000.00')).toBeInTheDocument();
  });

  it('highlights low stock alerts', () => {
    const metrics = {
      ...mockMetrics,
      lowStockVariants: [
        { name: 'Test Variant', currentStock: 5, reorderThreshold: 10 }
      ]
    };

    render(<DashboardMetrics metrics={metrics} />);

    const alert = screen.getByText(/5 items below reorder threshold/i);
    expect(alert).toHaveClass('alert-warning');
  });
});
```

### API Route Tests

Located in `dashboard/__tests__/api/**/*.test.ts`

```typescript
import { createMocks } from 'node-mocks-http';
import handler from '@/pages/api/dashboard/overview';

describe('/api/dashboard/overview', () => {
  it('returns dashboard metrics', async () => {
    const { req, res } = createMocks({
      method: 'GET',
      headers: { authorization: 'Bearer valid-token' },
    });

    await handler(req, res);

    expect(res._getStatusCode()).toBe(200);
    const data = JSON.parse(res._getData());
    expect(data).toHaveProperty('todayRevenue');
    expect(data).toHaveProperty('activeStockValue');
  });

  it('requires authentication', async () => {
    const { req, res } = createMocks({ method: 'GET' });

    await handler(req, res);

    expect(res._getStatusCode()).toBe(401);
  });
});
```

### Running Dashboard Tests

```bash
cd dashboard

# Unit and component tests
npm test

# Watch mode
npm run test:watch

# Coverage
npm run test:coverage

# E2E with Playwright
npm run test:e2e
```

## Stocktake App Testing

### Unit Tests (Vitest)

```typescript
import { describe, it, expect, vi } from 'vitest';
import { StocktakeSession } from '@/services/stocktake-session';

describe('StocktakeSession', () => {
  it('categorizes scanned serials correctly', async () => {
    const session = new StocktakeSession('location-1');
    
    // Mock expected items
    session.setExpectedSerials(['ABC123', 'ABC124', 'ABC125']);
    
    // Scan items
    await session.scan('ABC123'); // Matched
    await session.scan('XYZ999'); // Unexpected
    
    const results = session.getResults();
    
    expect(results.matched).toContain('ABC123');
    expect(results.missing).toContain('ABC124');
    expect(results.missing).toContain('ABC125');
    expect(results.unexpected).toContain('XYZ999');
  });
});
```

## E2E Testing (Playwright)

Located in `e2e/**/*.spec.ts`

```typescript
import { test, expect } from '@playwright/test';

test.describe('Complete Transaction Flow', () => {
  test('owner creates variant, manager ingests stock, cashier sells item', async ({ page, context }) => {
    // 1. Owner logs in and creates variant
    await page.goto('https://dashboard.retailos.local');
    await page.fill('input[name=email]', 'owner@test.com');
    await page.fill('input[name=password]', 'password');
    await page.click('button[type=submit]');
    
    await page.click('text=Inventory');
    await page.click('text=New Variant');
    await page.fill('input[name=name]', 'E2E Test Shirt');
    await page.fill('input[name=retailPrice]', '50.00');
    await page.click('button:has-text("Create")');
    
    await expect(page.locator('text=Variant created')).toBeVisible();

    // 2. Manager ingests stock (open new page/context)
    const managerPage = await context.newPage();
    // ... manager flow ...

    // 3. Cashier sells item
    const posPage = await context.newPage();
    await posPage.goto('pos://localhost');
    // ... POS flow ...
  });
});
```

## Performance Testing

### Load Testing (k6)

```javascript
import http from 'k6/http';
import { check, sleep } from 'k6';

export let options = {
  stages: [
    { duration: '2m', target: 100 }, // Ramp up to 100 users
    { duration: '5m', target: 100 }, // Stay at 100 users
    { duration: '2m', target: 0 },   // Ramp down
  ],
  thresholds: {
    http_req_duration: ['p(95)<500'], // 95% of requests under 500ms
  },
};

export default function() {
  const token = 'test-token';
  
  // Serial lookup (critical path)
  let res = http.get(`https://api.retailos.local/store/catalog/serial/ABC123`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  
  check(res, {
    'serial lookup < 300ms': (r) => r.timings.duration < 300,
    'status 200': (r) => r.status === 200,
  });
  
  sleep(1);
}
```

Run with:
```bash
k6 run load-test.js
```

## Offline Testing

### Simulating Network Conditions

```dart
// Flutter: Use conditional mocking
class ApiClient {
  final bool isOfflineMode;
  
  Future<Response> post(String url, Map<String, dynamic> body) async {
    if (isOfflineMode) {
      // Queue for sync instead of sending
      await syncQueue.enqueue(url, body);
      return Response.success();
    }
    return await http.post(url, body: body);
  }
}
```

### Testing Sync Conflict Resolution

```typescript
test('resolves sale before stocktake conflict', async () => {
  // 1. Device A: Sale offline
  await deviceA.createTransaction({ serial: 'ABC123' });
  
  // 2. Device B: Stocktake offline (marks as missing)
  await deviceB.commitStocktake({ missing: ['ABC123'] });
  
  // 3. Both devices come online and sync
  await deviceA.sync();
  await deviceB.sync();
  
  // 4. Verify sale wins
  const garment = await db.garments.findOne({ serial: 'ABC123' });
  expect(garment.status).toBe('sold');
  
  // 5. Verify conflict logged
  const conflicts = await db.syncConflicts.find({ serial: 'ABC123' });
  expect(conflicts).toHaveLength(1);
  expect(conflicts[0].resolution).toBe('PREFER_SALE');
});
```

## Hardware Integration Testing

### Mock Label Printer

```typescript
class MockPrinterService implements PrinterService {
  public printedJobs: PrintJob[] = [];
  
  async printLabel(label: Label): Promise<void> {
    console.log(`[MOCK PRINTER] Printing label for ${label.serial}`);
    this.printedJobs.push({ label, timestamp: Date.now() });
  }
  
  async openCashDrawer(): Promise<void> {
    console.log('[MOCK PRINTER] Opening cash drawer');
  }
}
```

### Mock RFID Scanner

```typescript
class MockRfidScanner implements RfidScanner {
  private serials = ['ABC123', 'ABC124', 'ABC125'];
  
  async startScanning(): Promise<void> {
    // Simulate bulk read after 500ms
    setTimeout(() => {
      this.emit('batch-scanned', this.serials);
    }, 500);
  }
}
```

## Test Data Management

### Fixtures

```typescript
// backend/test/fixtures/index.ts
export function createTestTenant(overrides = {}) {
  return {
    id: uuid(),
    name: 'Test Tenant',
    subscriptionTier: 'growth',
    ...overrides
  };
}

export function createTestGarment(overrides = {}) {
  return {
    serial: `TEST-${Date.now()}`,
    status: 'in_stock',
    retailPrice: 50.00,
    ...overrides
  };
}
```

### Database Seeding

```bash
# Seed test database
cd backend
npm run seed:test

# Reset test database
npm run db:reset:test
```

## CI/CD Testing Pipeline

### GitHub Actions Workflow

```yaml
name: Test Suite

on: [push, pull_request]

jobs:
  backend-tests:
    runs-on: ubuntu-latest
    services:
      postgres:
        image: postgres:15
        env:
          POSTGRES_PASSWORD: postgres
        options: >-
          --health-cmd pg_isready
          --health-interval 10s
          --health-timeout 5s
          --health-retries 5
      redis:
        image: redis:7
        options: >-
          --health-cmd "redis-cli ping"
          --health-interval 10s
          --health-timeout 5s
          --health-retries 5
    
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-node@v3
        with:
          node-version: '18'
      
      - name: Install dependencies
        working-directory: backend
        run: npm ci
      
      - name: Run migrations
        working-directory: backend
        run: npm run migrate:test
        env:
          DATABASE_URL: postgresql://postgres:postgres@localhost:5432/test
      
      - name: Run tests
        working-directory: backend
        run: npm run test:ci
        env:
          DATABASE_URL: postgresql://postgres:postgres@localhost:5432/test
          REDIS_URL: redis://localhost:6379
      
      - name: Upload coverage
        uses: codecov/codecov-action@v3

  pos-tests:
    runs-on: macos-latest # For Flutter desktop testing
    steps:
      - uses: actions/checkout@v3
      - uses: subosito/flutter-action@v2
        with:
          flutter-version: '3.10.0'
      
      - name: Run tests
        working-directory: pos-app
        run: flutter test --coverage
      
      - name: Upload coverage
        uses: codecov/codecov-action@v3

  dashboard-tests:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-node@v3
        with:
          node-version: '18'
      
      - name: Install dependencies
        working-directory: dashboard
        run: npm ci
      
      - name: Run tests
        working-directory: dashboard
        run: npm test -- --coverage
      
      - name: Upload coverage
        uses: codecov/codecov-action@v3

  e2e-tests:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-node@v3
        with:
          node-version: '18'
      
      - name: Install Playwright
        run: npx playwright install --with-deps
      
      - name: Run E2E tests
        run: npm run test:e2e
      
      - uses: actions/upload-artifact@v3
        if: failure()
        with:
          name: playwright-report
          path: playwright-report/
```

## Test Coverage Goals

- **Backend**: 80% line coverage
- **POS App**: 70% line coverage
- **Dashboard**: 75% line coverage
- **Critical paths**: 100% coverage (checkout, sync, stock ingestion)

## Further Reading

- [Architecture Guide](architecture.md)
- [Development Setup](development-setup.md)
- [API Reference](api-reference.md)
