# Retail OS - Development Makefile

.PHONY: help setup start stop restart logs clean test migrate seed

# Default target
help:
	@echo "Retail OS Development Commands"
	@echo "================================"
	@echo "setup      - Initial setup (build images, create network)"
	@echo "start      - Start all services"
	@echo "stop       - Stop all services"
	@echo "restart    - Restart all services"
	@echo "logs       - View logs (use SERVICE=name for specific service)"
	@echo "logs-f     - Follow logs in real-time"
	@echo "clean      - Remove containers, volumes, and images"
	@echo "migrate    - Run database migrations"
	@echo "seed       - Seed database with test data"
	@echo "test       - Run all tests"
	@echo "shell      - Open shell in backend container"
	@echo "psql       - Connect to PostgreSQL"
	@echo "redis-cli  - Connect to Redis"
	@echo "status     - Show status of all services"

# Initial setup
setup:
	@echo "🚀 Setting up Retail OS development environment..."
	docker-compose build
	@echo "✅ Setup complete!"

# Start services
start:
	@echo "🚀 Starting Retail OS services..."
	docker-compose up -d
	@echo "⏳ Waiting for services to be healthy..."
	@sleep 10
	@echo "✅ Services started!"
	@echo ""
	@echo "📍 Service URLs:"
	@echo "   Backend API:        http://localhost:9000"
	@echo "   Admin Dashboard:    http://localhost:7001"
	@echo "   Owner Dashboard:    http://localhost:3000"
	@echo "   Stocktake App:      http://localhost:5173"
	@echo "   PGAdmin:            http://localhost:5050"
	@echo "   Redis Commander:    http://localhost:8081"
	@echo "   Mailhog:            http://localhost:8025"

# Stop services
stop:
	@echo "🛑 Stopping Retail OS services..."
	docker-compose stop
	@echo "✅ Services stopped!"

# Restart services
restart:
	@echo "🔄 Restarting Retail OS services..."
	docker-compose restart
	@echo "✅ Services restarted!"

# View logs
logs:
	@if [ -z "$(SERVICE)" ]; then \
		docker-compose logs --tail=100; \
	else \
		docker-compose logs --tail=100 $(SERVICE); \
	fi

# Follow logs
logs-f:
	@if [ -z "$(SERVICE)" ]; then \
		docker-compose logs -f; \
	else \
		docker-compose logs -f $(SERVICE); \
	fi

# Clean up everything
clean:
	@echo "🧹 Cleaning up Retail OS environment..."
	@read -p "This will remove all containers, volumes, and images. Continue? [y/N] " confirm; \
	if [ "$$confirm" = "y" ] || [ "$$confirm" = "Y" ]; then \
		docker-compose down -v --rmi local; \
		echo "✅ Cleanup complete!"; \
	else \
		echo "❌ Cleanup cancelled"; \
	fi

# Run database migrations
migrate:
	@echo "🗄️  Running database migrations..."
	docker-compose exec backend npm run db:migrate
	@echo "✅ Migrations complete!"

# Seed database
seed:
	@echo "🌱 Seeding database with test data..."
	docker-compose exec backend npm run seed
	@echo "✅ Seeding complete!"

# Run tests
test:
	@echo "🧪 Running tests..."
	docker-compose exec backend npm test
	@echo "✅ Tests complete!"

# Run integration tests
test-integration:
	@echo "🧪 Running integration tests..."
	docker-compose exec backend npm run test:integration
	@echo "✅ Integration tests complete!"

# Open backend shell
shell:
	@echo "🐚 Opening shell in backend container..."
	docker-compose exec backend sh

# Connect to PostgreSQL
psql:
	@echo "🗄️  Connecting to PostgreSQL..."
	docker-compose exec postgres psql -U retail_os -d retail_os_dev

# Connect to Redis
redis-cli:
	@echo "📦 Connecting to Redis..."
	docker-compose exec redis redis-cli

# Show service status
status:
	@echo "📊 Service Status:"
	@docker-compose ps

# Build specific service
build:
	@if [ -z "$(SERVICE)" ]; then \
		echo "❌ Please specify SERVICE=name"; \
	else \
		echo "🔨 Building $(SERVICE)..."; \
		docker-compose build $(SERVICE); \
		echo "✅ Build complete!"; \
	fi

# Restart specific service
restart-service:
	@if [ -z "$(SERVICE)" ]; then \
		echo "❌ Please specify SERVICE=name"; \
	else \
		echo "🔄 Restarting $(SERVICE)..."; \
		docker-compose restart $(SERVICE); \
		echo "✅ $(SERVICE) restarted!"; \
	fi

# Install dependencies
install:
	@echo "📦 Installing backend dependencies..."
	docker-compose exec backend npm install
	@echo "📦 Installing dashboard dependencies..."
	docker-compose exec dashboard npm install
	@echo "📦 Installing stocktake app dependencies..."
	docker-compose exec stocktake-app npm install
	@echo "✅ Dependencies installed!"

# Create database backup
backup:
	@echo "💾 Creating database backup..."
	@mkdir -p backups
	docker-compose exec -T postgres pg_dump -U retail_os retail_os_dev > backups/backup_$(shell date +%Y%m%d_%H%M%S).sql
	@echo "✅ Backup created in backups/ directory"

# Restore database from backup
restore:
	@if [ -z "$(FILE)" ]; then \
		echo "❌ Please specify FILE=path/to/backup.sql"; \
	else \
		echo "📥 Restoring database from $(FILE)..."; \
		docker-compose exec -T postgres psql -U retail_os -d retail_os_dev < $(FILE); \
		echo "✅ Restore complete!"; \
	fi

# Health check
health:
	@echo "🏥 Health Check:"
	@echo ""
	@echo "Backend:"
	@curl -s http://localhost:9000/health || echo "❌ Backend not responding"
	@echo ""
	@echo "PostgreSQL:"
	@docker-compose exec -T postgres pg_isready -U retail_os || echo "❌ PostgreSQL not ready"
	@echo ""
	@echo "Redis:"
	@docker-compose exec -T redis redis-cli ping || echo "❌ Redis not responding"

# Reset database
reset-db:
	@echo "🔄 Resetting database..."
	@read -p "This will delete all data. Continue? [y/N] " confirm; \
	if [ "$$confirm" = "y" ] || [ "$$confirm" = "Y" ]; then \
		docker-compose exec postgres psql -U retail_os -d postgres -c "DROP DATABASE IF EXISTS retail_os_dev;"; \
		docker-compose exec postgres psql -U retail_os -d postgres -c "CREATE DATABASE retail_os_dev;"; \
		$(MAKE) migrate; \
		echo "✅ Database reset complete!"; \
	else \
		echo "❌ Reset cancelled"; \
	fi
