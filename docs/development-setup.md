# Development Setup Guide

This guide walks through setting up a complete local development environment for Retail OS.

## Prerequisites

### Required Software

- **Node.js**: v18.0.0 or higher
- **PostgreSQL**: v15.0 or higher
- **Redis**: v7.0 or higher (for job queues)
- **Flutter**: v3.10.0 or higher
- **Git**: v2.30.0 or higher

### Platform-Specific Requirements

#### Windows
- Windows 10/11
- Visual Studio 2022 Build Tools (for Flutter desktop)
- PostgreSQL Windows installer

#### macOS
- macOS 12 (Monterey) or higher
- Xcode Command Line Tools
- Homebrew (recommended)

#### Linux
- Ubuntu 20.04+ or equivalent
- Build essentials: `build-essential`, `libpq-dev`

## Environment Setup

### 1. Clone Repository

```bash
git clone https://github.com/your-org/retail-os.git
cd retail-os
```

### 2. Install Dependencies

#### Install Node.js (via nvm - recommended)

```bash
# Install nvm
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.0/install.sh | bash

# Install Node.js
nvm install 18
nvm use 18
```

#### Install PostgreSQL

**macOS (Homebrew)**:
```bash
brew install postgresql@15
brew services start postgresql@15
```

**Ubuntu/Debian**:
```bash
sudo apt update
sudo apt install postgresql-15 postgresql-contrib
sudo systemctl start postgresql
```

**Windows**:
Download from [postgresql.org](https://www.postgresql.org/download/windows/)

#### Install Redis

**macOS**:
```bash
brew install redis
brew services start redis
```

**Ubuntu/Debian**:
```bash
sudo apt install redis-server
sudo systemctl start redis
```

**Windows**:
Use [Memurai](https://www.memurai.com/) or WSL2

#### Install Flutter

Follow official guide: [flutter.dev/docs/get-started/install](https://docs.flutter.dev/get-started/install)

```bash
# Verify installation
flutter doctor
```

## Backend Setup (MedusaJS)

### 1. Navigate to Backend Directory

```bash
cd backend
```

### 2. Install Dependencies

```bash
npm install
```

### 3. Configure Environment Variables

```bash
cp .env.example .env
```

Edit `.env`:

```bash
# Database
DATABASE_URL=postgresql://postgres:password@localhost:5432/retail_os_dev
DATABASE_LOGGING=true

# Redis
REDIS_URL=redis://localhost:6379

# JWT Secret (generate with: openssl rand -base64 32)
JWT_SECRET=your-secret-key-here

# Admin CORS (for dashboard development)
ADMIN_CORS=http://localhost:3000,http://localhost:3001

# ZRA Sandbox Credentials
ZRA_GATEWAY_URL=https://sandbox.zra.org.zm/api/v1
ZRA_CLIENT_ID=your-sandbox-client-id
ZRA_CLIENT_SECRET=your-sandbox-client-secret

# MTN MoMo Sandbox
MTN_MOMO_COLLECTION_USER_ID=your-user-id
MTN_MOMO_API_KEY=your-api-key
MTN_MOMO_ENVIRONMENT=sandbox

# Airtel Money Sandbox
AIRTEL_MONEY_CLIENT_ID=your-client-id
AIRTEL_MONEY_CLIENT_SECRET=your-client-secret
AIRTEL_MONEY_ENVIRONMENT=sandbox

# Server
PORT=9000
```

### 4. Setup Database

```bash
# Create database
createdb retail_os_dev

# Run migrations
npm run migrate

# Seed development data (optional)
npm run seed
```

### 5. Start Development Server

```bash
npm run dev
```

Backend should be running at `http://localhost:9000`

### 6. Verify Backend Health

```bash
curl http://localhost:9000/health
# Expected: {"status":"ok"}
```

## POS Application Setup (Flutter)

### 1. Navigate to POS Directory

```bash
cd pos-app
```

### 2. Install Flutter Dependencies

```bash
flutter pub get
```

### 3. Configure Local API Endpoint

Edit `lib/core/config/api_config.dart`:

```dart
class ApiConfig {
  static const String baseUrl = 'http://localhost:9000';
  static const bool enableLogging = true;
  static const Duration timeout = Duration(seconds: 30);
}
```

### 4. Setup Local Database

The app will create SQLite database on first run at:
- **Windows**: `%APPDATA%\retail_os\pos.db`
- **macOS**: `~/Library/Application Support/retail_os/pos.db`
- **Linux**: `~/.local/share/retail_os/pos.db`

### 5. Run on Desktop

```bash
# Windows
flutter run -d windows

# macOS
flutter run -d macos

# Linux
flutter run -d linux
```

### 6. Run on Android Emulator/Device

```bash
# List available devices
flutter devices

# Run on specific device
flutter run -d <device-id>
```

### 7. Development Hot Reload

Press `r` in terminal to hot reload, `R` to hot restart.

## Owner Dashboard Setup (Next.js)

### 1. Navigate to Dashboard Directory

```bash
cd dashboard
```

### 2. Install Dependencies

```bash
npm install
```

### 3. Configure Environment Variables

```bash
cp .env.local.example .env.local
```

Edit `.env.local`:

```bash
# API Configuration
NEXT_PUBLIC_API_URL=http://localhost:9000
NEXT_PUBLIC_API_TIMEOUT=30000

# Authentication
NEXTAUTH_URL=http://localhost:3000
NEXTAUTH_SECRET=your-nextauth-secret-here

# Feature Flags
NEXT_PUBLIC_ENABLE_RFID=true
NEXT_PUBLIC_ENABLE_ZRA=true
```

### 4. Start Development Server

```bash
npm run dev
```

Dashboard should be running at `http://localhost:3000`

## Stocktake App Setup (Mobile Web)

### 1. Navigate to Stocktake Directory

```bash
cd stocktake-app
```

### 2. Install Dependencies

```bash
npm install
```

### 3. Configure Environment

```bash
cp .env.example .env
```

Edit `.env`:

```bash
VITE_API_URL=http://localhost:9000
VITE_ENABLE_CAMERA_SCAN=true
VITE_ENABLE_RFID=true
```

### 4. Start Development Server

```bash
npm run dev
```

App should be running at `http://localhost:5173`

### 5. Test on Mobile Device

Access from mobile device on same network:
```
http://<your-local-ip>:5173
```

Example: `http://192.168.1.100:5173`

## Development Workflow

### Creating a Development Tenant

```bash
# Start backend server
cd backend && npm run dev

# In another terminal, create tenant via API
curl -X POST http://localhost:9000/admin/tenants \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Dev Store",
    "subscriptionTier": "growth",
    "ownerEmail": "admin@devstore.com",
    "ownerName": "Dev Owner",
    "ownerPin": "1234"
  }'

# Response will include tenant ID and JWT token
```

### Creating Test Users

```bash
# Create Store Manager
curl -X POST http://localhost:9000/admin/staff \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <owner-jwt-token>" \
  -d '{
    "name": "Jane Manager",
    "role": "store_manager",
    "locationId": "<location-id>",
    "pin": "2345"
  }'

# Create Cashier
curl -X POST http://localhost:9000/admin/staff \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <owner-jwt-token>" \
  -d '{
    "name": "John Cashier",
    "role": "cashier",
    "locationId": "<location-id>",
    "pin": "3456"
  }'

# Create Stock Clerk
curl -X POST http://localhost:9000/admin/staff \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <owner-jwt-token>" \
  -d '{
    "name": "Sarah Clerk",
    "role": "stock_clerk",
    "locationId": "<location-id>",
    "pin": "4567"
  }'
```

### Adding Test Inventory

```bash
# Create a variant
curl -X POST http://localhost:9000/admin/variants \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <manager-jwt-token>" \
  -d '{
    "name": "Cotton T-Shirt",
    "category": "Tops",
    "color": "Blue",
    "size": "L",
    "costPrice": 25.00,
    "retailPrice": 50.00,
    "reorderThreshold": 10
  }'

# Ingest stock (generates serials)
curl -X POST http://localhost:9000/admin/stock/ingest \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <manager-jwt-token>" \
  -d '{
    "variantId": "<variant-id>",
    "locationId": "<location-id>",
    "quantity": 20
  }'

# Response includes generated serials for printing labels
```

## Testing Hardware Integration

### Mock Label Printer (Development)

```bash
# Backend includes mock printer for development
# Printer commands logged to console instead of hardware

# Enable mock printer in backend .env
ENABLE_MOCK_PRINTER=true
```

### Test Barcode Scanner Input

Use any USB HID scanner - it emulates keyboard input.

Or manually test with keyboard:
1. Open POS app
2. Navigate to checkout screen
3. Type serial number and press Enter

### Mock Mobile Money Webhooks

```bash
# Simulate MTN MoMo webhook
curl -X POST http://localhost:9000/store/payment/webhook/momo \
  -H "Content-Type: application/json" \
  -d '{
    "externalId": "<transaction-id>",
    "status": "SUCCESSFUL",
    "amount": "50.00",
    "currency": "ZMW"
  }'
```

## Database Management

### View Database Contents

```bash
# Connect to PostgreSQL
psql retail_os_dev

# Useful queries
\dt                           # List tables
SELECT * FROM tenants;        # View tenants
SELECT * FROM garments LIMIT 10; # View garments
SELECT * FROM audit_trail ORDER BY created_at DESC LIMIT 20;

# Exit
\q
```

### Reset Database

```bash
cd backend

# Drop and recreate
dropdb retail_os_dev
createdb retail_os_dev

# Re-run migrations and seed
npm run migrate
npm run seed
```

### View POS Local Database (SQLite)

```bash
# Install sqlite3 CLI
# macOS: brew install sqlite3
# Ubuntu: sudo apt install sqlite3

# Open POS database
sqlite3 ~/.local/share/retail_os/pos.db

# View tables
.tables

# View sync queue
SELECT * FROM sync_queue WHERE synced_at IS NULL;

# Exit
.quit
```

## Debugging

### Backend Debugging (VS Code)

Create `.vscode/launch.json` in backend directory:

```json
{
  "version": "0.2.0",
  "configurations": [
    {
      "type": "node",
      "request": "launch",
      "name": "Debug Backend",
      "runtimeExecutable": "npm",
      "runtimeArgs": ["run", "dev"],
      "port": 9229,
      "skipFiles": ["<node_internals>/**"]
    }
  ]
}
```

### Flutter Debugging (VS Code)

Create `.vscode/launch.json` in pos-app directory:

```json
{
  "version": "0.2.0",
  "configurations": [
    {
      "name": "POS App (Debug)",
      "request": "launch",
      "type": "dart",
      "program": "lib/main.dart",
      "args": ["--debug"]
    }
  ]
}
```

### Next.js Debugging (VS Code)

Next.js debug server runs automatically with `npm run dev` on port 9229.

### View Logs

**Backend**:
```bash
cd backend
tail -f logs/app.log
```

**POS App** (Flutter):
```bash
flutter logs
```

**Dashboard** (Next.js):
Console output visible in terminal running `npm run dev`

## Common Issues

### PostgreSQL Connection Error

**Issue**: `ECONNREFUSED` when starting backend

**Solution**:
```bash
# Check if PostgreSQL is running
pg_isready

# Start PostgreSQL
# macOS: brew services start postgresql@15
# Linux: sudo systemctl start postgresql
```

### Flutter Desktop Not Available

**Issue**: `No devices available`

**Solution**:
```bash
# Enable desktop support
flutter config --enable-windows-desktop  # Windows
flutter config --enable-macos-desktop    # macOS
flutter config --enable-linux-desktop    # Linux

# Verify
flutter devices
```

### Port Already in Use

**Issue**: `EADDRINUSE: port 9000 already in use`

**Solution**:
```bash
# Find process using port
# macOS/Linux:
lsof -ti:9000 | xargs kill -9

# Windows:
netstat -ano | findstr :9000
taskkill /PID <PID> /F
```

### Redis Not Running

**Issue**: `Error: Redis connection refused`

**Solution**:
```bash
# Check Redis status
redis-cli ping  # Should return "PONG"

# Start Redis
# macOS: brew services start redis
# Linux: sudo systemctl start redis
```

## Next Steps

- [Run Tests](testing.md#running-tests)
- [Review API Documentation](api-reference.md)
- [Understand Architecture](architecture.md)
- [Deploy to Staging](deployment.md#staging-deployment)

## Getting Help

- **Documentation**: `/docs` directory
- **API Reference**: `http://localhost:9000/docs` (when backend running)
- **Issue Tracker**: GitHub Issues
- **Team Chat**: Slack #retail-os-dev
