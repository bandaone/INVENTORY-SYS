# API Reference

Complete REST API documentation for Retail OS backend.

## Base URL

- **Development**: `http://localhost:9000`
- **Staging**: `https://api-staging.retailos.com`
- **Production**: `https://api.retailos.com`

## Authentication

All API requests except public endpoints require JWT authentication.

### Headers

```http
Authorization: Bearer <jwt-token>
Content-Type: application/json
```

### Authentication Flow

```http
POST /auth/login
Content-Type: application/json

{
  "email": "user@example.com",
  "password": "password123"
}

# Response
{
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "user": {
    "id": "uuid",
    "email": "user@example.com",
    "role": "owner",
    "tenantId": "uuid"
  }
}
```

### PIN Authentication (POS/Stocktake)

```http
POST /auth/pin
Content-Type: application/json

{
  "pin": "1234",
  "deviceId": "POS-001"
}

# Response
{
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "staff": {
    "id": "uuid",
    "name": "John Cashier",
    "role": "cashier",
    "locationId": "uuid"
  }
}
```

---

## Admin Endpoints

Admin endpoints require Owner or Store Manager role unless otherwise specified.

### Tenants

#### Create Tenant

```http
POST /admin/tenants
Content-Type: application/json

{
  "name": "Fashion Boutique",
  "subscriptionTier": "growth",
  "ownerEmail": "owner@boutique.com",
  "ownerName": "Jane Owner",
  "ownerPin": "1234"
}

# Response (201 Created)
{
  "tenant": {
    "id": "uuid",
    "name": "Fashion Boutique",
    "subscriptionTier": "growth",
    "activeLocationsCount": 0,
    "activeDevicesCount": 0,
    "createdAt": "2026-06-17T10:00:00Z"
  },
  "owner": {
    "id": "uuid",
    "email": "owner@boutique.com",
    "name": "Jane Owner",
    "role": "owner"
  },
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
}
```

#### Get Tenant

```http
GET /admin/tenants/:id
Authorization: Bearer <token>

# Response (200 OK)
{
  "id": "uuid",
  "name": "Fashion Boutique",
  "subscriptionTier": "growth",
  "activeLocationsCount": 2,
  "activeDevicesCount": 5,
  "features": {
    "maxLocations": 3,
    "zraEnabled": true,
    "rfidEnabled": false,
    "transfersEnabled": true
  },
  "createdAt": "2026-06-17T10:00:00Z",
  "updatedAt": "2026-06-17T10:00:00Z"
}
```

### Locations

#### Create Location

```http
POST /admin/locations
Authorization: Bearer <token>
Content-Type: application/json

{
  "name": "Lusaka Main Branch",
  "address": "Cairo Road, Lusaka, Zambia"
}

# Response (201 Created)
{
  "id": "uuid",
  "tenantId": "uuid",
  "name": "Lusaka Main Branch",
  "address": "Cairo Road, Lusaka, Zambia",
  "isActive": true,
  "createdAt": "2026-06-17T10:00:00Z"
}
```

#### List Locations

```http
GET /admin/locations
Authorization: Bearer <token>

# Response (200 OK)
{
  "locations": [
    {
      "id": "uuid",
      "name": "Lusaka Main Branch",
      "address": "Cairo Road, Lusaka, Zambia",
      "isActive": true,
      "stockCount": 1250,
      "deviceCount": 3
    }
  ]
}
```

### Staff Management

#### Create Staff

```http
POST /admin/staff
Authorization: Bearer <token>
Content-Type: application/json

{
  "name": "John Cashier",
  "role": "cashier",
  "locationId": "uuid",
  "pin": "2345"
}

# Response (201 Created)
{
  "id": "uuid",
  "tenantId": "uuid",
  "name": "John Cashier",
  "role": "cashier",
  "locationId": "uuid",
  "isActive": true,
  "createdAt": "2026-06-17T10:00:00Z"
}
```

#### List Staff

```http
GET /admin/staff?locationId=<uuid>&role=cashier
Authorization: Bearer <token>

# Response (200 OK)
{
  "staff": [
    {
      "id": "uuid",
      "name": "John Cashier",
      "role": "cashier",
      "locationId": "uuid",
      "locationName": "Lusaka Main Branch",
      "isActive": true,
      "createdAt": "2026-06-17T10:00:00Z"
    }
  ]
}
```

#### Deactivate Staff

```http
DELETE /admin/staff/:id
Authorization: Bearer <token>

# Response (200 OK)
{
  "message": "Staff member deactivated successfully"
}
```

### Variants

#### Create Variant

```http
POST /admin/variants
Authorization: Bearer <token>
Content-Type: application/json

{
  "name": "Cotton T-Shirt",
  "category": "Tops",
  "color": "Blue",
  "size": "L",
  "costPrice": 25.00,
  "retailPrice": 50.00,
  "reorderThreshold": 10
}

# Response (201 Created)
{
  "id": "uuid",
  "tenantId": "uuid",
  "name": "Cotton T-Shirt",
  "category": "Tops",
  "color": "Blue",
  "size": "L",
  "costPrice": 25.00,
  "retailPrice": 50.00,
  "reorderThreshold": 10,
  "currentStock": 0,
  "createdAt": "2026-06-17T10:00:00Z"
}
```

#### List Variants

```http
GET /admin/variants?category=Tops&search=shirt
Authorization: Bearer <token>

# Response (200 OK)
{
  "variants": [
    {
      "id": "uuid",
      "name": "Cotton T-Shirt",
      "category": "Tops",
      "color": "Blue",
      "size": "L",
      "retailPrice": 50.00,
      "currentStock": 45,
      "reorderThreshold": 10
    }
  ],
  "pagination": {
    "page": 1,
    "pageSize": 20,
    "total": 1
  }
}
```

### Stock Ingestion

#### Ingest Stock

```http
POST /admin/stock/ingest
Authorization: Bearer <token>
Content-Type: application/json

{
  "variantId": "uuid",
  "locationId": "uuid",
  "quantity": 20,
  "costPrice": 25.00,
  "retailPrice": 50.00
}

# Response (201 Created)
{
  "stockMovementId": "uuid",
  "serials": [
    {
      "serial": "RTL-2026-ABC123",
      "variantId": "uuid",
      "locationId": "uuid",
      "status": "in_stock",
      "retailPrice": 50.00,
      "qrCodeData": "RTL-2026-ABC123"
    }
    // ... 19 more serials
  ],
  "printJobs": [
    {
      "jobId": "uuid",
      "serialCount": 20,
      "status": "queued"
    }
  ]
}
```

#### Bulk Ingest (Matrix Grid)

```http
POST /admin/stock/ingest-bulk
Authorization: Bearer <token>
Content-Type: application/json

{
  "variantBase": {
    "name": "Cotton T-Shirt",
    "category": "Tops",
    "costPrice": 25.00,
    "retailPrice": 50.00
  },
  "locationId": "uuid",
  "grid": [
    { "color": "Blue", "size": "S", "quantity": 10 },
    { "color": "Blue", "size": "M", "quantity": 15 },
    { "color": "Blue", "size": "L", "quantity": 20 },
    { "color": "Red", "size": "M", "quantity": 12 }
  ]
}

# Response (201 Created)
{
  "totalSerials": 57,
  "variantsCreated": 4,
  "serials": [ /* all generated serials */ ],
  "printJobs": [ /* print job references */ ]
}
```

### Stock Transfers

#### Create Transfer

```http
POST /admin/stock/transfer
Authorization: Bearer <token>
Content-Type: application/json

{
  "sourceLocationId": "uuid",
  "destinationLocationId": "uuid",
  "serials": ["RTL-2026-ABC123", "RTL-2026-ABC124"]
}

# Response (201 Created)
{
  "transferId": "uuid",
  "sourceLocationId": "uuid",
  "destinationLocationId": "uuid",
  "serialsCount": 2,
  "initiatedBy": "uuid",
  "status": "completed",
  "createdAt": "2026-06-17T10:00:00Z"
}
```

### Stocktake

#### Start Stocktake

```http
POST /admin/stocktake/start
Authorization: Bearer <token>
Content-Type: application/json

{
  "locationId": "uuid",
  "area": "Main Floor"
}

# Response (201 Created)
{
  "sessionId": "uuid",
  "locationId": "uuid",
  "area": "Main Floor",
  "clerkId": "uuid",
  "status": "active",
  "expectedCount": 1250,
  "scannedCount": 0,
  "createdAt": "2026-06-17T10:00:00Z"
}
```

#### Scan Items

```http
POST /admin/stocktake/scan
Authorization: Bearer <token>
Content-Type: application/json

{
  "sessionId": "uuid",
  "serials": ["RTL-2026-ABC123", "RTL-2026-ABC124"],
  "timestamp": 1718618400000
}

# Response (200 OK)
{
  "scannedCount": 2,
  "results": [
    {
      "serial": "RTL-2026-ABC123",
      "category": "matched",
      "variantName": "Cotton T-Shirt - Blue - L"
    },
    {
      "serial": "RTL-2026-ABC124",
      "category": "unexpected",
      "reason": "Different location"
    }
  ]
}
```

#### Commit Stocktake

```http
POST /admin/stocktake/commit
Authorization: Bearer <token>
Content-Type: application/json

{
  "sessionId": "uuid"
}

# Response (200 OK)
{
  "sessionId": "uuid",
  "summary": {
    "matched": 1200,
    "missing": 50,
    "unexpected": 5,
    "shrinkageValue": 2500.00
  },
  "stockMovements": [
    {
      "serial": "RTL-2026-XYZ999",
      "oldStatus": "in_stock",
      "newStatus": "missing",
      "type": "stocktake"
    }
    // ... more movements
  ]
}
```

### Sync Engine

#### Upload Sync Batch

```http
POST /admin/sync/batch
Authorization: Bearer <token>
Content-Type: application/json

{
  "deviceId": "POS-001",
  "entries": [
    {
      "sequenceNumber": 1,
      "action": "SALE",
      "garmentSerial": "RTL-2026-ABC123",
      "transactionId": "local-tx-001",
      "timestamp": 1718618400000,
      "payload": {
        "total": 50.00,
        "paymentMethod": "CASH",
        "cashierId": "uuid"
      }
    }
  ]
}

# Response (200 OK)
{
  "processed": 1,
  "conflicts": [],
  "errors": []
}
```

#### Get Sync Conflicts

```http
GET /admin/sync/conflicts?deviceId=POS-001
Authorization: Bearer <token>

# Response (200 OK)
{
  "conflicts": [
    {
      "id": "uuid",
      "type": "TRANSFER_SALE_CONFLICT",
      "garmentSerial": "RTL-2026-ABC123",
      "entries": [
        {
          "sequenceNumber": 15,
          "action": "TRANSFER",
          "deviceId": "POS-001"
        },
        {
          "sequenceNumber": 42,
          "action": "SALE",
          "deviceId": "POS-002"
        }
      ],
      "status": "pending",
      "createdAt": "2026-06-17T10:00:00Z"
    }
  ]
}
```

#### Resolve Conflict

```http
POST /admin/sync/resolve/:conflictId
Authorization: Bearer <token>
Content-Type: application/json

{
  "resolution": "PREFER_SALE",
  "notes": "Customer already received item"
}

# Response (200 OK)
{
  "conflictId": "uuid",
  "resolution": "PREFER_SALE",
  "appliedEntry": {
    "sequenceNumber": 42,
    "action": "SALE"
  },
  "rejectedEntry": {
    "sequenceNumber": 15,
    "action": "TRANSFER"
  }
}
```

---

## Store Endpoints

Store endpoints used by POS and Stocktake apps.

### Transactions

#### Create Transaction

```http
POST /store/transactions
Authorization: Bearer <token>
Content-Type: application/json

{
  "locationId": "uuid",
  "cashierId": "uuid",
  "items": [
    {
      "garmentSerial": "RTL-2026-ABC123",
      "variantId": "uuid",
      "retailPrice": 50.00
    },
    {
      "description": "Manual Item - Belt",
      "price": 15.00
    }
  ],
  "paymentMethod": "CASH",
  "cashTendered": 100.00,
  "sequenceNumber": 1
}

# Response (201 Created)
{
  "transactionId": "uuid",
  "receiptNumber": "RCT-20260617-001",
  "total": 65.00,
  "change": 35.00,
  "zraInvoiceCode": "ZRA-2026-XYZ789",
  "printData": {
    "receiptLines": [ /* ESC/POS commands */ ],
    "qrCode": "base64-encoded-qr"
  }
}
```

#### Get Transaction

```http
GET /store/transactions/:id
Authorization: Bearer <token>

# Response (200 OK)
{
  "id": "uuid",
  "receiptNumber": "RCT-20260617-001",
  "locationId": "uuid",
  "cashierId": "uuid",
  "cashierName": "John Cashier",
  "items": [
    {
      "garmentSerial": "RTL-2026-ABC123",
      "variantName": "Cotton T-Shirt - Blue - L",
      "retailPrice": 50.00
    }
  ],
  "subtotal": 65.00,
  "tax": 10.40,
  "total": 75.40,
  "paymentMethod": "CASH",
  "zraInvoiceCode": "ZRA-2026-XYZ789",
  "createdAt": "2026-06-17T10:00:00Z"
}
```

### Mobile Money Payments

#### Initiate Mobile Money Payment

```http
POST /store/payment/mobile/:provider
Authorization: Bearer <token>
Content-Type: application/json
# provider: 'momo' | 'airtel'

{
  "amount": 50.00,
  "phoneNumber": "+260977123456",
  "transactionId": "local-tx-001"
}

# Response (200 OK)
{
  "paymentRequestId": "uuid",
  "provider": "momo",
  "status": "pending",
  "message": "USSD push sent to customer"
}
```

#### Check Payment Status

```http
GET /store/payment/status/:paymentRequestId
Authorization: Bearer <token>

# Response (200 OK)
{
  "paymentRequestId": "uuid",
  "status": "successful",
  "amount": 50.00,
  "transactionId": "external-tx-123",
  "completedAt": "2026-06-17T10:01:30Z"
}
```

#### Mobile Money Webhook (Internal)

```http
POST /store/payment/webhook/:provider
Content-Type: application/json
X-Signature: <provider-signature>

# MTN MoMo webhook payload
{
  "externalId": "uuid",
  "status": "SUCCESSFUL",
  "amount": "50.00",
  "currency": "ZMW",
  "financialTransactionId": "123456789"
}

# Response (200 OK)
{
  "status": "processed"
}
```

### Catalog

#### Get Variants (Local Sync)

```http
GET /store/catalog/variants?locationId=<uuid>&lastSync=<timestamp>
Authorization: Bearer <token>

# Response (200 OK)
{
  "variants": [
    {
      "id": "uuid",
      "name": "Cotton T-Shirt",
      "color": "Blue",
      "size": "L",
      "retailPrice": 50.00,
      "updatedAt": "2026-06-17T10:00:00Z"
    }
  ],
  "nextSyncToken": 1718618500000
}
```

#### Lookup Serial

```http
GET /store/catalog/serial/:serial
Authorization: Bearer <token>

# Response (200 OK)
{
  "serial": "RTL-2026-ABC123",
  "variantId": "uuid",
  "variantName": "Cotton T-Shirt - Blue - L",
  "retailPrice": 50.00,
  "status": "in_stock",
  "locationId": "uuid",
  "locationName": "Lusaka Main Branch"
}

# Response (404 Not Found)
{
  "error": "Serial not found",
  "serial": "RTL-2026-XYZ999"
}

# Response (400 Bad Request - already sold)
{
  "error": "Garment already sold",
  "serial": "RTL-2026-ABC123",
  "status": "sold",
  "soldAt": "2026-06-16T14:30:00Z"
}
```

---

## Dashboard Endpoints

Endpoints for Owner Dashboard reporting and analytics.

### Dashboard Metrics

#### Get Dashboard Overview

```http
GET /dashboard/overview?locationId=<uuid>
Authorization: Bearer <token>

# Response (200 OK)
{
  "todayRevenue": 12500.00,
  "activeStockValue": 250000.00,
  "itemsSoldToday": 250,
  "shrinkageThisMonth": 3500.00,
  "reorderAlerts": 5,
  "lowStockVariants": [
    {
      "variantId": "uuid",
      "name": "Cotton T-Shirt - Blue - S",
      "currentStock": 8,
      "reorderThreshold": 10
    }
  ]
}
```

#### Get Hourly Sales

```http
GET /dashboard/sales/hourly?date=2026-06-17&locationId=<uuid>
Authorization: Bearer <token>

# Response (200 OK)
{
  "date": "2026-06-17",
  "hourly": [
    { "hour": 9, "revenue": 450.00, "transactionCount": 9 },
    { "hour": 10, "revenue": 1200.00, "transactionCount": 24 },
    { "hour": 11, "revenue": 890.00, "transactionCount": 18 }
  ]
}
```

#### Get Recent Transactions

```http
GET /dashboard/transactions/recent?limit=20&locationId=<uuid>
Authorization: Bearer <token>

# Response (200 OK)
{
  "transactions": [
    {
      "id": "uuid",
      "receiptNumber": "RCT-20260617-042",
      "total": 150.00,
      "paymentMethod": "MOBILE_MONEY",
      "cashierName": "John Cashier",
      "locationName": "Lusaka Main Branch",
      "createdAt": "2026-06-17T11:45:00Z"
    }
  ]
}
```

### Inventory Matrix

```http
GET /dashboard/inventory/matrix?variantIds=<uuid,uuid>
Authorization: Bearer <token>

# Response (200 OK)
{
  "variants": [
    {
      "variantId": "uuid",
      "name": "Cotton T-Shirt - Blue - L",
      "locations": [
        {
          "locationId": "uuid",
          "locationName": "Lusaka Main Branch",
          "quantity": 45,
          "reorderThreshold": 10,
          "alert": "ok"
        },
        {
          "locationId": "uuid2",
          "locationName": "Ndola Branch",
          "quantity": 8,
          "reorderThreshold": 10,
          "alert": "warning"
        }
      ]
    }
  ]
}
```

### Reports

#### Generate Report

```http
POST /dashboard/reports/:reportType
Authorization: Bearer <token>
Content-Type: application/json
# reportType: 'best_sellers' | 'slowest_moving' | 'staff_performance' | 'stock_ageing' | 'profit_margin'

{
  "locationId": "uuid",
  "startDate": "2026-06-01",
  "endDate": "2026-06-17",
  "format": "json"
}

# Response (200 OK) - Best Sellers example
{
  "reportType": "best_sellers",
  "period": {
    "start": "2026-06-01",
    "end": "2026-06-17"
  },
  "data": [
    {
      "rank": 1,
      "variantName": "Cotton T-Shirt - Blue - L",
      "quantitySold": 145,
      "revenue": 7250.00,
      "percentOfTotal": 12.5
    }
  ]
}
```

#### Export Report

```http
GET /dashboard/reports/:reportId/export?format=csv
Authorization: Bearer <token>

# Response (200 OK)
Content-Type: text/csv
Content-Disposition: attachment; filename="best_sellers_20260617.csv"

Rank,Variant,Quantity Sold,Revenue,Percent of Total
1,"Cotton T-Shirt - Blue - L",145,7250.00,12.5%
...
```

### Audit Trail

```http
GET /dashboard/audit-trail?page=1&pageSize=50&action=SALE&staffId=<uuid>
Authorization: Bearer <token>

# Response (200 OK)
{
  "entries": [
    {
      "id": "uuid",
      "action": "SALE",
      "garmentSerial": "RTL-2026-ABC123",
      "actorId": "uuid",
      "actorName": "John Cashier",
      "deviceId": "POS-001",
      "locationName": "Lusaka Main Branch",
      "details": {
        "transactionId": "uuid",
        "amount": 50.00
      },
      "createdAt": "2026-06-17T11:45:00Z"
    }
  ],
  "pagination": {
    "page": 1,
    "pageSize": 50,
    "total": 1250
  }
}
```

---

## Error Responses

All error responses follow consistent format:

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Invalid request data",
    "details": [
      {
        "field": "pin",
        "message": "PIN must be exactly 4 digits"
      }
    ]
  }
}
```

### Common Error Codes

| HTTP Status | Error Code | Description |
|-------------|-----------|-------------|
| 400 | `VALIDATION_ERROR` | Invalid request data |
| 401 | `UNAUTHORIZED` | Missing or invalid authentication |
| 403 | `FORBIDDEN` | Insufficient permissions |
| 404 | `NOT_FOUND` | Resource not found |
| 409 | `CONFLICT` | Resource conflict (e.g., duplicate serial) |
| 422 | `BUSINESS_LOGIC_ERROR` | Operation violates business rules |
| 429 | `RATE_LIMIT_EXCEEDED` | Too many requests |
| 500 | `INTERNAL_SERVER_ERROR` | Unexpected server error |
| 503 | `SERVICE_UNAVAILABLE` | Temporary service disruption |

---

## Rate Limiting

- **General Endpoints**: 100 requests/minute per IP
- **Sync Endpoints**: 20 requests/minute per device
- **Webhook Endpoints**: 50 requests/minute per provider

Rate limit headers included in responses:

```http
X-RateLimit-Limit: 100
X-RateLimit-Remaining: 95
X-RateLimit-Reset: 1718618460
```

---

## Pagination

List endpoints support pagination:

```http
GET /admin/variants?page=2&pageSize=50
```

Response includes pagination metadata:

```json
{
  "data": [ /* results */ ],
  "pagination": {
    "page": 2,
    "pageSize": 50,
    "total": 250,
    "totalPages": 5
  }
}
```

---

## Webhooks

### Registering Webhooks

```http
POST /admin/webhooks
Authorization: Bearer <token>
Content-Type: application/json

{
  "url": "https://your-server.com/webhook",
  "events": ["transaction.completed", "stocktake.committed"],
  "secret": "your-webhook-secret"
}
```

### Webhook Payload Example

```json
{
  "event": "transaction.completed",
  "timestamp": 1718618400000,
  "data": {
    "transactionId": "uuid",
    "receiptNumber": "RCT-20260617-042",
    "total": 150.00,
    "locationId": "uuid"
  }
}
```

Verify signature using HMAC-SHA256:
```
X-Webhook-Signature: sha256=<hmac>
```

---

## Further Documentation

- [Architecture Guide](architecture.md)
- [Development Setup](development-setup.md)
- [Testing Guide](testing.md)
