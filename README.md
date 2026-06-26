# Retail OS

A physical retail operating system for clothing stores, ensuring every garment has an exact digital record with immediate inventory event tracking.

## Overview

Retail OS is an offline-first, multi-tenant SaaS platform designed for retail clothing stores operating in environments with unreliable connectivity. The system tracks every garment from stock ingestion through its complete lifecycle—sale, transfer, or loss.

### Key Features

- **Offline-First Architecture**: Full POS, stock ingestion, and inventory operations without internet
- **Unique Serial Tracking**: Every garment receives a unique serial number and QR-coded label
- **Multi-Tenant SaaS**: Complete data isolation with subscription-based feature tiers
- **ZRA Smart Invoice Compliance**: Tax-compliant receipts with offline cryptographic signing
- **Mobile Money Integration**: MTN MoMo and Airtel Money payment support
- **Real-Time Dashboard**: Live metrics, reports, and audit trail across all locations
- **Role-Based Access**: Owner, Store Manager, Cashier, and Stock Clerk roles

### System Components

- **POS Application** (Flutter): Desktop/tablet point-of-sale with offline SQLite
- **Stocktake App** (Mobile Web): Browser-based inventory counting with QR/RFID scanning
- **Owner Dashboard** (Next.js): Web portal for reporting, analytics, and configuration
- **Backend API** (MedusaJS): Multi-tenant backend with PostgreSQL and sync engine
- **Hardware Integration**: Thermal label printers, barcode scanners, RFID wands

### Deployment Scale

- Single stall to 20-location chains
- Supports unreliable connectivity environments
- Zambia Revenue Authority (ZRA) tax compliance

## Documentation

- [Architecture Guide](docs/architecture.md)
- [Development Setup](docs/development-setup.md)
- [Deployment Guide](docs/deployment.md)
- [API Reference](docs/api-reference.md)
- [User Guides](docs/user-guides/README.md)
- [Testing Strategy](docs/testing.md)

## Quick Start

See [Development Setup](docs/development-setup.md) for detailed instructions.

```bash
# Clone the repository
git clone https://github.com/your-org/retail-os.git
cd retail-os

# Backend setup
cd backend
npm install
cp .env.example .env
# Configure database and API keys in .env
npm run dev

# POS application setup
cd ../pos-app
flutter pub get
flutter run -d windows  # or macos/android

# Owner dashboard setup
cd ../dashboard
npm install
cp .env.local.example .env.local
# Configure API endpoint in .env.local
npm run dev
```

## Technology Stack

### Frontend
- **POS**: Flutter 3.x, Drift (SQLite), Riverpod
- **Dashboard**: Next.js 14, Refine, Material-UI, React Query
- **Stocktake**: Vanilla JS/Svelte, html5-qrcode, IndexedDB

### Backend
- **Framework**: MedusaJS 2.x (Node.js 18+)
- **Database**: PostgreSQL 15+ with Row-Level Security
- **Queue**: Bull (Redis)
- **Deployment**: AWS (EC2, RDS, S3, CloudFront)

### Integrations
- **Tax Compliance**: ZRA VSDC API
- **Payments**: MTN MoMo, Airtel Money
- **Hardware**: ESC/POS printers, HID scanners, Bluetooth RFID

## Architecture Principles

1. **Offline-First**: All core operations work without internet
2. **Multi-Tenant Isolation**: Database-level separation with PostgreSQL RLS
3. **Audit Trail Integrity**: Immutable append-only logging
4. **Sequence-Based Sync**: Deterministic conflict resolution
5. **Role-Based Access**: Minimal privilege enforcement

## Repository Structure

```
retail-os/
├── backend/              # MedusaJS backend API
│   ├── src/
│   │   ├── services/     # Sync engine, ZRA, payments
│   │   ├── api/          # Custom API routes
│   │   ├── models/       # Database entities
│   │   └── subscribers/  # Event handlers
│   └── migrations/       # Database migrations
├── pos-app/              # Flutter POS application
│   ├── lib/
│   │   ├── features/     # Feature modules
│   │   ├── data/         # Database and sync
│   │   ├── domain/       # Business logic
│   │   └── hardware/     # Printer/scanner services
│   └── test/
├── stocktake-app/        # Mobile web stocktake
│   ├── src/
│   │   ├── components/
│   │   ├── services/
│   │   └── utils/
│   └── public/
├── dashboard/            # Next.js owner dashboard
│   ├── app/              # Next.js app router
│   ├── components/
│   ├── lib/              # API client, utils
│   └── public/
├── docs/                 # Documentation
│   ├── architecture.md
│   ├── api-reference.md
│   ├── deployment.md
│   └── user-guides/
└── infrastructure/       # IaC and deployment scripts
    ├── terraform/
    └── docker/
```

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for development workflow and coding standards.

## License

Proprietary - All Rights Reserved

Copyright (c) 2026 Retail OS
