# Changelog

All notable changes to Retail OS will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- Initial project structure and documentation

## [1.0.0] - 2026-06-17

### Added
- **Core Features**
  - Serial-based garment tracking with QR code labels
  - Offline-first POS with local SQLite storage
  - Multi-tenant SaaS architecture with PostgreSQL RLS
  - Sequence-based sync engine with conflict resolution
  - ZRA Smart Invoice compliance with offline signing
  - MTN MoMo and Airtel Money payment integration
  - Real-time owner dashboard with metrics and reports
  - Mobile stocktake app with QR/RFID scanning
  - Role-based access control (Owner, Manager, Cashier, Stock Clerk)
  - Immutable audit trail for all operations

- **POS Application (Flutter)**
  - PIN-based cashier authentication
  - Product catalog with search
  - QR code and barcode scanning
  - Shopping cart with item management
  - Cash and mobile money payments
  - Split payment support
  - Receipt printing via ESC/POS
  - Cash drawer integration
  - Offline operation with automatic sync
  - Shift management with cash reconciliation
  - Stock ingestion with label generation (Manager role)

- **Owner Dashboard (Next.js)**
  - Real-time KPI metrics
  - Hourly sales graphs
  - Transaction feed
  - Multi-location inventory matrix
  - Named reports (Best Sellers, Slowest Moving, Staff Performance, Stock Ageing, Profit Margin)
  - Report export (PDF/CSV)
  - Staff management interface
  - Audit trail viewer
  - System configuration
  - Low stock alerts

- **Stocktake App (Mobile Web)**
  - Camera-based QR scanning
  - Bluetooth RFID wand support
  - Real-time categorization (Matched/Missing/Unexpected)
  - Batch scanning for RFID
  - Session management
  - Conflict notifications

- **Backend (MedusaJS)**
  - RESTful API with JWT authentication
  - Multi-tenant data isolation with RLS
  - Sync engine with conflict detection
  - ZRA invoice generation and submission
  - Mobile money payment orchestration
  - Webhook handling for payment confirmations
  - Background job processing with Bull
  - Database migrations
  - Health check endpoints

### Infrastructure
- AWS deployment architecture
  - EC2 Auto Scaling Groups for backend
  - RDS PostgreSQL Multi-AZ
  - ElastiCache Redis cluster
  - S3 + CloudFront for dashboard
  - Route 53 DNS management
  - Application Load Balancer
- Terraform infrastructure as code
- GitHub Actions CI/CD pipelines
- CloudWatch monitoring and alerting

### Documentation
- Complete architecture guide
- API reference documentation
- Development setup guide
- Deployment guide
- Testing strategy documentation
- User guides for all roles
- Contributing guidelines

### Security
- JWT-based API authentication
- 4-digit PIN authentication for POS/stocktake
- PostgreSQL Row-Level Security
- HTTPS/TLS enforcement
- API rate limiting
- Input validation and sanitization
- Secrets management with AWS Secrets Manager

### Performance
- Serial lookup < 300ms (99th percentile)
- Transaction save < 500ms (99th percentile)
- Dashboard load < 3s (median)
- Sync batch processing < 60s for 1000 items

### Testing
- Unit test suites for all components
- Integration tests for critical flows
- E2E tests with Playwright
- Load testing with k6
- 80%+ test coverage on backend

## [0.1.0] - 2026-05-01

### Added
- Initial project setup
- Database schema design
- Basic POS prototype
- ZRA integration research

---

## Version History

- **1.0.0** - First production release (2026-06-17)
- **0.1.0** - Initial development version (2026-05-01)

## Migration Guides

### Upgrading from 0.x to 1.0

This is the first production release. No migration needed for new installations.

For beta testers upgrading from 0.x:
1. Backup existing database
2. Run migration scripts: `npm run migrate`
3. Update API endpoints in POS/Dashboard configuration
4. Re-sync all devices to ensure data consistency

---

[Unreleased]: https://github.com/your-org/retail-os/compare/v1.0.0...HEAD
[1.0.0]: https://github.com/your-org/retail-os/releases/tag/v1.0.0
[0.1.0]: https://github.com/your-org/retail-os/releases/tag/v0.1.0
