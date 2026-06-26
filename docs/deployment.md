# Deployment Guide

Complete deployment documentation for Retail OS production and staging environments.

## Overview

Retail OS uses a multi-tier AWS architecture optimized for offline-first operation:

- **Backend API**: MedusaJS on EC2 Auto Scaling Groups behind ALB
- **Database**: PostgreSQL RDS Multi-AZ with automated backups
- **Dashboard**: Next.js static export on S3 + CloudFront
- **Queue**: ElastiCache Redis for Bull job queues
- **Storage**: S3 for reports, exports, and static assets

## Prerequisites

- AWS account with appropriate IAM permissions
- AWS CLI configured locally
- Terraform v1.5+ installed
- Node.js v18+ for build processes
- Flutter SDK for POS application builds

## Infrastructure Setup

### 1. Clone Infrastructure Repository

```bash
cd infrastructure/terraform
```

### 2. Configure Terraform Variables

Create `terraform.tfvars`:

```hcl
# General
environment = "production"
aws_region  = "us-east-1"
project_name = "retail-os"

# Networking
vpc_cidr = "10.0.0.0/16"
availability_zones = ["us-east-1a", "us-east-1b", "us-east-1c"]

# Compute
backend_instance_type = "t3.medium"
backend_min_capacity  = 2
backend_max_capacity  = 10

# Database
db_instance_class = "db.t3.medium"
db_allocated_storage = 100
db_multi_az = true
db_backup_retention_days = 30

# Redis
redis_node_type = "cache.t3.micro"
redis_num_cache_nodes = 2

# Domain
domain_name = "retailos.com"
api_subdomain = "api"
dashboard_subdomain = "dashboard"

# SSL Certificate ARN (from ACM)
acm_certificate_arn = "arn:aws:acm:us-east-1:123456789012:certificate/..."

# Tags
tags = {
  Project     = "Retail OS"
  Environment = "Production"
  ManagedBy   = "Terraform"
}
```

### 3. Initialize Terraform

```bash
terraform init
```

### 4. Plan Infrastructure

```bash
terraform plan -out=tfplan
```

Review the plan carefully before applying.

### 5. Apply Infrastructure

```bash
terraform apply tfplan
```

This creates:
- VPC with public/private subnets across 3 AZs
- RDS PostgreSQL Multi-AZ instance
- ElastiCache Redis cluster
- EC2 Auto Scaling Group with Launch Template
- Application Load Balancer with target groups
- S3 buckets for dashboard and assets
- CloudFront distribution
- Route 53 DNS records
- Security groups and IAM roles

### 6. Note Output Values

```bash
terraform output
```

Save these for application configuration:
- `alb_dns_name`
- `rds_endpoint`
- `redis_endpoint`
- `dashboard_cloudfront_url`
- `s3_bucket_name`

## Backend Deployment

### Option 1: Automated Deployment (CI/CD)

Create GitHub Actions workflow (`.github/workflows/deploy-backend.yml`):

```yaml
name: Deploy Backend

on:
  push:
    branches: [main]
    paths:
      - 'backend/**'

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      
      - name: Setup Node.js
        uses: actions/setup-node@v3
        with:
          node-version: '18'
      
      - name: Install dependencies
        working-directory: backend
        run: npm ci
      
      - name: Run tests
        working-directory: backend
        run: npm test
      
      - name: Build application
        working-directory: backend
        run: npm run build
      
      - name: Deploy to EC2
        env:
          AWS_ACCESS_KEY_ID: ${{ secrets.AWS_ACCESS_KEY_ID }}
          AWS_SECRET_ACCESS_KEY: ${{ secrets.AWS_SECRET_ACCESS_KEY }}
        run: |
          # Create deployment package
          cd backend
          zip -r deploy.zip dist/ node_modules/ package.json package-lock.json
          
          # Upload to S3
          aws s3 cp deploy.zip s3://retail-os-deploys/backend-${{ github.sha }}.zip
          
          # Trigger CodeDeploy
          aws deploy create-deployment \
            --application-name retail-os-backend \
            --deployment-group-name production \
            --s3-location bucket=retail-os-deploys,key=backend-${{ github.sha }}.zip,bundleType=zip
```

### Option 2: Manual Deployment

#### Build Backend

```bash
cd backend
npm ci
npm run build
```

#### Create Deployment Package

```bash
tar -czf backend-deploy.tar.gz \
  dist/ \
  node_modules/ \
  package.json \
  package-lock.json \
  ecosystem.config.js
```

#### Upload to EC2

```bash
# Get EC2 instance IPs from Auto Scaling Group
aws autoscaling describe-auto-scaling-groups \
  --auto-scaling-group-names retail-os-backend-asg \
  --query 'AutoScalingGroups[0].Instances[*].InstanceId' \
  --output text

# SSH to each instance
ssh -i ~/.ssh/retail-os-prod.pem ec2-user@<instance-ip>

# On EC2 instance
cd /opt/retail-os
sudo tar -xzf /tmp/backend-deploy.tar.gz
sudo systemctl restart retail-os-backend
```

#### Verify Deployment

```bash
curl https://api.retailos.com/health
# Expected: {"status":"ok","version":"1.0.0"}
```

### Database Migrations

```bash
# Connect to RDS from bastion host or EC2 instance
psql -h <rds-endpoint> -U retail_os -d retail_os_prod

# Run migrations
cd backend
npm run migrate:production
```

### Environment Variables (EC2)

Store in `/opt/retail-os/.env`:

```bash
NODE_ENV=production
PORT=9000

# Database
DATABASE_URL=postgresql://retail_os:<password>@<rds-endpoint>:5432/retail_os_prod
DATABASE_POOL_SIZE=20
DATABASE_LOGGING=false

# Redis
REDIS_URL=redis://<redis-endpoint>:6379

# JWT
JWT_SECRET=<generated-secret>
JWT_EXPIRATION=24h

# CORS
ADMIN_CORS=https://dashboard.retailos.com

# ZRA Production
ZRA_GATEWAY_URL=https://api.zra.org.zm/api/v1
ZRA_CLIENT_ID=<production-client-id>
ZRA_CLIENT_SECRET=<production-client-secret>

# MTN MoMo Production
MTN_MOMO_COLLECTION_USER_ID=<production-user-id>
MTN_MOMO_API_KEY=<production-api-key>
MTN_MOMO_ENVIRONMENT=production
MTN_MOMO_CALLBACK_URL=https://api.retailos.com/store/payment/webhook/momo

# Airtel Money Production
AIRTEL_MONEY_CLIENT_ID=<production-client-id>
AIRTEL_MONEY_CLIENT_SECRET=<production-client-secret>
AIRTEL_MONEY_ENVIRONMENT=production
AIRTEL_MONEY_CALLBACK_URL=https://api.retailos.com/store/payment/webhook/airtel

# AWS
AWS_REGION=us-east-1
AWS_S3_BUCKET=retail-os-production-assets

# Monitoring
SENTRY_DSN=<sentry-dsn>
ENABLE_METRICS=true
```

### PM2 Process Manager

Create `ecosystem.config.js`:

```javascript
module.exports = {
  apps: [{
    name: 'retail-os-backend',
    script: './dist/main.js',
    instances: 'max',
    exec_mode: 'cluster',
    env: {
      NODE_ENV: 'production'
    },
    error_file: '/var/log/retail-os/error.log',
    out_file: '/var/log/retail-os/out.log',
    log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
    merge_logs: true,
    autorestart: true,
    max_memory_restart: '1G',
    min_uptime: '10s',
    max_restarts: 10
  }]
};
```

Start with PM2:

```bash
pm2 start ecosystem.config.js
pm2 save
pm2 startup
```

## Dashboard Deployment

### Build Dashboard

```bash
cd dashboard
npm ci

# Set production API URL
export NEXT_PUBLIC_API_URL=https://api.retailos.com

# Build static export
npm run build
```

### Deploy to S3

```bash
# Sync build output to S3
aws s3 sync out/ s3://retail-os-dashboard-prod/ \
  --delete \
  --cache-control "public, max-age=31536000, immutable" \
  --exclude "*.html" \
  --exclude "service-worker.js"

# HTML files with shorter cache
aws s3 sync out/ s3://retail-os-dashboard-prod/ \
  --exclude "*" \
  --include "*.html" \
  --include "service-worker.js" \
  --cache-control "public, max-age=0, must-revalidate"
```

### Invalidate CloudFront Cache

```bash
aws cloudfront create-invalidation \
  --distribution-id <cloudfront-id> \
  --paths "/*"
```

### Verify Dashboard

```bash
curl https://dashboard.retailos.com
# Should return HTML content
```

## POS Application Distribution

### Windows Build

```bash
cd pos-app
flutter build windows --release

# Create installer with Inno Setup
iscc installer/windows/setup.iss
```

Distribute via:
- Direct download from dashboard
- Windows Store submission
- Internal distribution server

### macOS Build

```bash
flutter build macos --release

# Create DMG
hdiutil create -volname "Retail OS POS" \
  -srcfolder build/macos/Build/Products/Release/RetailOS.app \
  -ov -format UDZO \
  RetailOS-1.0.0.dmg
```

### Android Build

```bash
flutter build apk --release

# Or build App Bundle for Play Store
flutter build appbundle --release
```

### Code Signing

**Windows**: Use SignTool with code signing certificate
**macOS**: Use Apple Developer certificate
**Android**: Use keystore file

```bash
# Android example
jarsigner -verbose -sigalg SHA256withRSA -digestalg SHA-256 \
  -keystore release-key.keystore \
  app-release-unsigned.apk release-key
```

## Stocktake App Deployment

Build and deploy to S3:

```bash
cd stocktake-app
npm ci
npm run build

# Deploy to S3
aws s3 sync dist/ s3://retail-os-stocktake-prod/ --delete

# Invalidate CloudFront
aws cloudfront create-invalidation \
  --distribution-id <cloudfront-id> \
  --paths "/*"
```

Access at: `https://stocktake.retailos.com`

## Database Management

### Backup Strategy

**Automated Backups**: RDS automated backups (30-day retention)
**Manual Snapshots**: Created before major updates

```bash
# Create manual snapshot
aws rds create-db-snapshot \
  --db-instance-identifier retail-os-prod \
  --db-snapshot-identifier retail-os-manual-$(date +%Y%m%d)
```

### Restore from Backup

```bash
# Restore from snapshot to new instance
aws rds restore-db-instance-from-db-snapshot \
  --db-instance-identifier retail-os-restored \
  --db-snapshot-identifier retail-os-manual-20260617

# Update backend to point to restored instance
# Update DNS or ALB target after verification
```

### Database Maintenance

```bash
# Connect to database
psql -h <rds-endpoint> -U retail_os -d retail_os_prod

# Vacuum and analyze
VACUUM ANALYZE;

# Check table sizes
SELECT 
  schemaname,
  tablename,
  pg_size_pretty(pg_total_relation_size(schemaname||'.'||tablename)) AS size
FROM pg_tables
WHERE schemaname NOT IN ('pg_catalog', 'information_schema')
ORDER BY pg_total_relation_size(schemaname||'.'||tablename) DESC;

# Check index usage
SELECT 
  schemaname,
  tablename,
  indexname,
  idx_scan,
  idx_tup_read,
  idx_tup_fetch
FROM pg_stat_user_indexes
ORDER BY idx_scan ASC;
```

## Monitoring and Logging

### CloudWatch Alarms

Create alarms for:
- Backend API error rate > 5%
- Database CPU > 80%
- Database connections > 80% of max
- ALB 5xx errors
- Auto Scaling Group unhealthy instances

```bash
# Example: Create error rate alarm
aws cloudwatch put-metric-alarm \
  --alarm-name retail-os-high-error-rate \
  --alarm-description "Alert when error rate exceeds 5%" \
  --metric-name 5XXError \
  --namespace AWS/ApplicationELB \
  --statistic Sum \
  --period 300 \
  --threshold 50 \
  --comparison-operator GreaterThanThreshold \
  --evaluation-periods 2 \
  --alarm-actions <sns-topic-arn>
```

### Application Monitoring (Sentry)

Configure in backend:

```typescript
import * as Sentry from '@sentry/node';

Sentry.init({
  dsn: process.env.SENTRY_DSN,
  environment: process.env.NODE_ENV,
  tracesSampleRate: 0.1,
});
```

### Log Aggregation

Backend logs sent to CloudWatch Logs:
- Log Group: `/aws/retail-os/backend`
- Retention: 30 days

Query logs:

```bash
aws logs filter-log-events \
  --log-group-name /aws/retail-os/backend \
  --filter-pattern "ERROR" \
  --start-time 1718618400000
```

## SSL/TLS Configuration

### Certificate Management (ACM)

```bash
# Request certificate for domain and subdomains
aws acm request-certificate \
  --domain-name retailos.com \
  --subject-alternative-names "*.retailos.com" \
  --validation-method DNS

# Add DNS validation records in Route 53
# Certificate auto-renews when using DNS validation
```

### HTTPS Enforcement

ALB listener rules redirect HTTP to HTTPS:

```hcl
resource "aws_lb_listener" "http" {
  load_balancer_arn = aws_lb.main.arn
  port              = 80
  protocol          = "HTTP"

  default_action {
    type = "redirect"
    redirect {
      port        = "443"
      protocol    = "HTTPS"
      status_code = "HTTP_301"
    }
  }
}
```

## Security Best Practices

### Network Security

- **RDS**: Private subnets, security group allows only ALB/EC2
- **Redis**: Private subnets, security group allows only EC2
- **EC2**: Private subnets, no direct internet access
- **Bastion Host**: For maintenance access only

### IAM Roles

Principle of least privilege:

```hcl
# EC2 instance role
resource "aws_iam_role" "backend_instance" {
  name = "retail-os-backend-instance"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Action = "sts:AssumeRole"
      Effect = "Allow"
      Principal = {
        Service = "ec2.amazonaws.com"
      }
    }]
  })
}

# S3 access for reports
resource "aws_iam_role_policy" "s3_access" {
  name = "s3-access"
  role = aws_iam_role.backend_instance.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect = "Allow"
      Action = [
        "s3:GetObject",
        "s3:PutObject",
        "s3:DeleteObject"
      ]
      Resource = "arn:aws:s3:::retail-os-production-assets/*"
    }]
  })
}
```

### Secrets Management

Use AWS Secrets Manager:

```bash
# Store database password
aws secretsmanager create-secret \
  --name retail-os/prod/db-password \
  --secret-string "secure-password-here"

# Store API keys
aws secretsmanager create-secret \
  --name retail-os/prod/zra-credentials \
  --secret-string '{"clientId":"xxx","clientSecret":"yyy"}'
```

Retrieve in application:

```typescript
import { SecretsManager } from '@aws-sdk/client-secrets-manager';

const client = new SecretsManager({ region: 'us-east-1' });

async function getSecret(secretName: string) {
  const response = await client.getSecretValue({ SecretId: secretName });
  return JSON.parse(response.SecretString);
}
```

## Scaling Configuration

### Auto Scaling Policies

```hcl
resource "aws_autoscaling_policy" "scale_up" {
  name                   = "scale-up"
  scaling_adjustment     = 2
  adjustment_type        = "ChangeInCapacity"
  cooldown              = 300
  autoscaling_group_name = aws_autoscaling_group.backend.name
}

resource "aws_autoscaling_policy" "scale_down" {
  name                   = "scale-down"
  scaling_adjustment     = -1
  adjustment_type        = "ChangeInCapacity"
  cooldown              = 300
  autoscaling_group_name = aws_autoscaling_group.backend.name
}

resource "aws_cloudwatch_metric_alarm" "cpu_high" {
  alarm_name          = "cpu-utilization-high"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 2
  metric_name        = "CPUUtilization"
  namespace          = "AWS/EC2"
  period             = 120
  statistic          = "Average"
  threshold          = 70
  alarm_actions      = [aws_autoscaling_policy.scale_up.arn]
}
```

### Database Scaling

**Vertical Scaling**: Modify instance class during maintenance window
**Read Replicas**: Add for read-heavy workloads

```bash
# Create read replica
aws rds create-db-instance-read-replica \
  --db-instance-identifier retail-os-prod-replica-1 \
  --source-db-instance-identifier retail-os-prod \
  --db-instance-class db.t3.medium
```

## Disaster Recovery

### RTO and RPO Targets

- **RTO** (Recovery Time Objective): 4 hours
- **RPO** (Recovery Point Objective): 15 minutes

### Backup Strategy

1. **Automated RDS snapshots**: Daily, 30-day retention
2. **Manual snapshots**: Before major changes
3. **Point-in-time recovery**: Enabled on RDS (5-minute granularity)

### Recovery Procedures

**Scenario: Database Corruption**

```bash
# 1. Identify last known good timestamp
# 2. Restore to point in time
aws rds restore-db-instance-to-point-in-time \
  --source-db-instance-identifier retail-os-prod \
  --target-db-instance-identifier retail-os-restored \
  --restore-time 2026-06-17T10:00:00Z

# 3. Update backend configuration
# 4. Verify data integrity
# 5. Switch traffic to restored instance
```

**Scenario: Region Outage**

- Cross-region RDS snapshot copies (daily)
- CloudFormation stack in secondary region (standby)
- Route 53 failover routing policy

## Performance Optimization

### Database Query Optimization

```sql
-- Add indexes for common queries
CREATE INDEX CONCURRENTLY idx_garments_status_location 
  ON garments(status, location_id) 
  INCLUDE (serial, variant_id, retail_price);

-- Partition large tables
CREATE TABLE audit_trail (
  id UUID PRIMARY KEY,
  created_at TIMESTAMP NOT NULL,
  -- other columns
) PARTITION BY RANGE (created_at);

CREATE TABLE audit_trail_2026_06 
  PARTITION OF audit_trail 
  FOR VALUES FROM ('2026-06-01') TO ('2026-07-01');
```

### CDN Caching

CloudFront cache behaviors:
- Static assets: 1 year cache
- HTML files: No cache (always revalidate)
- API responses: No cache

### Redis Caching

```typescript
// Cache frequently accessed data
const cacheKey = `variant:${variantId}`;
let variant = await redis.get(cacheKey);

if (!variant) {
  variant = await db.variants.findOne({ id: variantId });
  await redis.setex(cacheKey, 3600, JSON.stringify(variant));
}
```

## Rollback Procedures

### Backend Rollback

```bash
# Deploy previous version
aws deploy create-deployment \
  --application-name retail-os-backend \
  --deployment-group-name production \
  --s3-location bucket=retail-os-deploys,key=backend-<previous-sha>.zip,bundleType=zip
```

### Database Migration Rollback

```bash
cd backend
npm run migrate:rollback -- --steps=1
```

### Dashboard Rollback

```bash
# Restore previous S3 version
aws s3 sync s3://retail-os-dashboard-prod/ s3://retail-os-dashboard-rollback/ --delete
aws s3 sync s3://retail-os-dashboard-backup-<timestamp>/ s3://retail-os-dashboard-prod/ --delete
aws cloudfront create-invalidation --distribution-id <id> --paths "/*"
```

## Cost Optimization

### Reserved Instances

Consider 1-year reservations for:
- RDS database (30-40% savings)
- ElastiCache Redis (30-40% savings)
- Stable EC2 baseline capacity

### S3 Lifecycle Policies

```hcl
resource "aws_s3_bucket_lifecycle_configuration" "assets" {
  bucket = aws_s3_bucket.assets.id

  rule {
    id     = "archive-old-reports"
    status = "Enabled"

    transition {
      days          = 90
      storage_class = "GLACIER"
    }

    expiration {
      days = 365
    }
  }
}
```

### RDS Cost Controls

- Stop development databases outside business hours
- Use Aurora Serverless for staging (auto-pause)
- Delete old snapshots (retention > 30 days)

## Maintenance Windows

Schedule weekly maintenance:
- **Day**: Sunday
- **Time**: 02:00 - 04:00 UTC
- **Duration**: 2 hours

Activities:
- Database vacuuming
- Security patching
- Log rotation
- Performance tuning

## Support and Escalation

### On-Call Rotation

- **Primary**: On-call engineer
- **Secondary**: Team lead
- **Escalation**: CTO

### Incident Response

1. **Alert received** → Acknowledge in PagerDuty
2. **Assess severity** → P0 (critical) to P3 (low)
3. **Communicate** → Status page update
4. **Investigate** → Check logs, metrics, recent changes
5. **Mitigate** → Rollback, scale up, failover
6. **Resolve** → Verify fix, close incident
7. **Post-mortem** → Document root cause and prevention

## Further Reading

- [Architecture Guide](architecture.md)
- [Monitoring Runbook](monitoring-runbook.md)
- [Incident Response Playbook](incident-response.md)
