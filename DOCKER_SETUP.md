# Docker Development Environment

Complete Docker setup for Retail OS development and system testing.

## Overview

This Docker setup provides:
- **PostgreSQL 15** - Multi-tenant database with RLS
- **Redis 7** - Cache and job queue
- **MedusaJS Backend** - API server with hot reload
- **Owner Dashboard** - Next.js with hot reload
- **Stocktake App** - Mobile web with hot reload
- **PGAdmin** - Database management UI
- **Redis Commander** - Redis management UI
- **Mailhog** - Email testing

## Quick Start

### 1. Prerequisites

Install Docker Desktop:
- **macOS/Windows**: [Docker Desktop](https://www.docker.com/products/docker-desktop/)
- **Linux**: Docker Engine + Docker Compose

```bash
# Verify installation
docker --version
docker-compose --version
```

### 2. Initial Setup

```bash
# Clone repository
git clone https://github.com/your-org/retail-os.git
cd retail-os

# Build images
make setup

# Start services
make start
```

### 3. Access Services

After running `make start`, services are available at:

| Service | URL | Credentials |
|---------|-----|-------------|
| **Backend API** | http://localhost:9000 | - |
| **Admin UI** | http://localhost:7001 | Create during first run |
| **Owner Dashboard** | http://localhost:3000 | - |
| **Stocktake App** | http://localhost:5173 | - |
| **PGAdmin** | http://localhost:5050 | admin@retailos.local / admin |
| **Redis Commander** | http://localhost:8081 | - |
| **Mailhog** | http://localhost:8025 | - |

### 4. Run Migrations

```bash
# Run database migrations
make migrate

# Seed test data
make seed
```

## Makefile Commands

### Basic Commands

```bash
# Start all services
make start

# Stop all services
make stop

# Restart all services
make restart

# View status
make status

# View logs
make logs

# Follow logs in real-time
make logs-f

# View logs for specific service
make logs SERVICE=backend
make logs-f SERVICE=postgres
```

### Development Commands

```bash
# Open backend shell
make shell

# Connect to PostgreSQL
make psql

# Connect to Redis
make redis-cli

# Run migrations
make migrate

# Seed database
make seed

# Reset database (WARNING: deletes all data)
make reset-db
```

### Testing Commands

```bash
# Run unit tests
make test

# Run integration tests
make test-integration

# Health check
make health
```

### Maintenance Commands

```bash
# Rebuild specific service
make build SERVICE=backend

# Restart specific service
make restart-service SERVICE=dashboard

# Install dependencies
make install

# Create database backup
make backup

# Restore database
make restore FILE=backups/backup_20260617_120000.sql

# Clean up (removes containers, volumes, images)
make clean
```

## Service Details

### Backend (MedusaJS)

**Container**: `retail-os-backend`  
**Port**: 9000 (API), 7001 (Admin UI)  
**Hot Reload**: ✅ Enabled

```bash
# View logs
make logs SERVICE=backend

# Restart
make restart-service SERVICE=backend

# Shell access
make shell
```

**Useful commands inside container:**
```bash
# Run migrations
npm run db:migrate

# Create migration
npm run db:create -- --name add_custom_field

# Seed data
npm run seed

# Run tests
npm test
```

### Dashboard (Next.js)

**Container**: `retail-os-dashboard`  
**Port**: 3000  
**Hot Reload**: ✅ Enabled

```bash
# View logs
make logs SERVICE=dashboard

# Restart
make restart-service SERVICE=dashboard
```

### Stocktake App

**Container**: `retail-os-stocktake`  
**Port**: 5173  
**Hot Reload**: ✅ Enabled

Access from mobile device:
```
http://<your-local-ip>:5173
```

### PostgreSQL

**Container**: `retail-os-postgres`  
**Port**: 5432  
**Database**: retail_os_dev  
**User**: retail_os  
**Password**: retail_os_dev_password

```bash
# Connect via psql
make psql

# View tables
\dt

# View specific table
SELECT * FROM serial_items LIMIT 10;

# Check RLS policies
\d+ serial_items
```

**Database Management UI**: http://localhost:5050 (PGAdmin)

### Redis

**Container**: `retail-os-redis`  
**Port**: 6379

```bash
# Connect via CLI
make redis-cli

# Common commands
PING                    # Test connection
KEYS *                  # List all keys
GET key_name           # Get value
FLUSHALL               # Clear all (use with caution!)
```

**Redis Management UI**: http://localhost:8081 (Redis Commander)

## Development Workflow

### 1. Daily Development

```bash
# Start services
make start

# Check status
make status

# View logs
make logs-f

# Work on code (hot reload enabled)
# Changes to backend/, dashboard/, stocktake-app/ auto-reload

# Run tests
make test

# Stop when done
make stop
```

### 2. Testing API Changes

```bash
# Make changes to backend code

# View backend logs
make logs-f SERVICE=backend

# Test endpoint
curl http://localhost:9000/sync/push -X POST \
  -H "Content-Type: application/json" \
  -d '{"device_id":"TEST","entries":[]}'

# Run integration tests
make test-integration
```

### 3. Database Changes

```bash
# Create migration
docker-compose exec backend npm run db:create -- --name add_new_field

# Edit migration file
# backend/src/migrations/XXXXXX_add_new_field.ts

# Run migration
make migrate

# Verify in psql
make psql
\dt
SELECT * FROM new_table;
```

### 4. Testing Mobile Stocktake

```bash
# Find your local IP
# macOS/Linux: ifconfig | grep "inet "
# Windows: ipconfig

# Access from mobile device
http://192.168.1.100:5173

# View logs
make logs-f SERVICE=stocktake-app
```

## Environment Variables

### Backend Environment

Configured in `docker-compose.yml`:

```yaml
DATABASE_URL: postgresql://retail_os:retail_os_dev_password@postgres:5432/retail_os_dev
REDIS_URL: redis://redis:6379
JWT_SECRET: dev-jwt-secret-change-in-production
COOKIE_SECRET: dev-cookie-secret-change-in-production

# MTN MoMo (Sandbox)
MTN_MOMO_API_KEY: sandbox-key
MTN_MOMO_SUBSCRIPTION_KEY: sandbox-sub-key
MTN_MOMO_ENVIRONMENT: sandbox

# Airtel Money (Sandbox)
AIRTEL_CLIENT_ID: sandbox-client-id
AIRTEL_CLIENT_SECRET: sandbox-secret
AIRTEL_ENVIRONMENT: sandbox

# ZRA (Sandbox)
ZRA_GATEWAY_URL: https://sandbox.zra.org.zm/api/v1
ZRA_TIMEOUT_MS: 30000
```

### Custom Environment Variables

Create `.env` file in project root:

```bash
# .env
MTN_MOMO_API_KEY=your-actual-key
MTN_MOMO_SUBSCRIPTION_KEY=your-subscription-key
AIRTEL_CLIENT_ID=your-client-id
AIRTEL_CLIENT_SECRET=your-client-secret
```

Docker Compose will automatically load these.

## Volumes

### Persistent Data

- `postgres_data` - PostgreSQL database files
- `redis_data` - Redis data
- `pgadmin_data` - PGAdmin configuration
- `backend_uploads` - Backend uploaded files

### Development Volumes

Code is mounted for hot reload:
- `./backend:/app` - Backend source code
- `./dashboard:/app` - Dashboard source code
- `./stocktake-app:/app` - Stocktake app source code

Node modules excluded to prevent conflicts:
- `/app/node_modules`

## Networking

All services on `retail-os-network` bridge network:
- Services can communicate using container names
- Backend connects to `postgres:5432`
- Backend connects to `redis:6379`
- Dashboard connects to `backend:9000`

## Troubleshooting

### Services Won't Start

```bash
# Check status
make status

# View logs
make logs

# Check health
make health

# Restart specific service
make restart-service SERVICE=backend
```

### Port Already in Use

```bash
# Find process using port
lsof -ti:9000 | xargs kill -9  # macOS/Linux
netstat -ano | findstr :9000   # Windows

# Or change port in docker-compose.yml
ports:
  - "9001:9000"  # Map to different host port
```

### Database Connection Issues

```bash
# Check PostgreSQL is running
make logs SERVICE=postgres

# Test connection
make psql

# Restart PostgreSQL
make restart-service SERVICE=postgres

# Reset database
make reset-db
```

### Redis Connection Issues

```bash
# Check Redis is running
make logs SERVICE=redis

# Test connection
make redis-cli
PING  # Should return PONG

# Restart Redis
make restart-service SERVICE=redis
```

### Backend Not Responding

```bash
# Check logs
make logs SERVICE=backend

# Check if migrations ran
make migrate

# Restart backend
make restart-service SERVICE=backend

# Rebuild if needed
make build SERVICE=backend
make restart-service SERVICE=backend
```

### Hot Reload Not Working

```bash
# Restart service
make restart-service SERVICE=backend

# If still not working, rebuild
make build SERVICE=backend
make restart-service SERVICE=backend
```

### Clean Slate

```bash
# Stop and remove everything
make clean

# Rebuild from scratch
make setup
make start
make migrate
make seed
```

## Performance Optimization

### macOS Docker Performance

Add to `docker-compose.yml` for better performance:

```yaml
volumes:
  - ./backend:/app:cached
  - /app/node_modules:delegated
```

### Windows WSL2

Use WSL2 for better performance:
1. Enable WSL2 in Docker Desktop settings
2. Clone repo inside WSL2 filesystem
3. Run Docker commands from WSL2 terminal

## Testing Strategies

### 1. Unit Tests

```bash
# Run in container
make test

# Or run specific tests
docker-compose exec backend npm test -- serial-tracking.spec.ts
```

### 2. Integration Tests

```bash
make test-integration
```

### 3. API Testing

```bash
# Install REST client
# VS Code: REST Client extension
# Or use curl/Postman

# Test sync endpoint
curl http://localhost:9000/sync/push -X POST \
  -H "Content-Type: application/json" \
  -d @test-data/sync-batch.json
```

### 4. End-to-End Testing

```bash
# Start all services
make start

# Run E2E tests (when implemented)
cd e2e-tests
npm run test:e2e
```

## CI/CD Integration

Use same Docker setup in CI/CD:

```yaml
# GitHub Actions example
- name: Start services
  run: docker-compose up -d

- name: Run migrations
  run: docker-compose exec -T backend npm run db:migrate

- name: Run tests
  run: docker-compose exec -T backend npm test

- name: Cleanup
  run: docker-compose down -v
```

## Production Differences

Docker development setup differs from production:
- Development uses `Dockerfile.dev` with hot reload
- Production uses optimized `Dockerfile` with multi-stage builds
- Development uses bind mounts, production uses volumes
- Development exposes all ports, production uses reverse proxy

See [Deployment Guide](docs/deployment.md) for production setup.

## Additional Tools

### Database Management

**PGAdmin** (http://localhost:5050):
1. Login with admin@retailos.local / admin
2. Add Server:
   - Name: Retail OS Dev
   - Host: postgres
   - Port: 5432
   - Database: retail_os_dev
   - Username: retail_os
   - Password: retail_os_dev_password

### Redis Management

**Redis Commander** (http://localhost:8081):
- Auto-connects to Redis
- Browse keys, view values
- Monitor commands

### Email Testing

**Mailhog** (http://localhost:8025):
- Captures all emails sent by backend
- Useful for testing notifications
- No emails actually sent

## Best Practices

1. **Always use Makefile commands** - Consistent across team
2. **Run migrations before testing** - Ensure schema is current
3. **Check logs regularly** - Catch issues early
4. **Backup before reset** - `make backup` before `make reset-db`
5. **Use health check** - `make health` to verify services
6. **Clean up weekly** - `make clean` to remove unused containers

## Getting Help

```bash
# Show all available commands
make help

# View service logs
make logs SERVICE=<service-name>

# Check service status
make status

# Run health check
make health
```

## Further Reading

- [Development Setup](docs/development-setup.md)
- [Backend Documentation](backend/README.md)
- [API Reference](docs/api-reference.md)
- [Testing Strategy](docs/testing.md)
