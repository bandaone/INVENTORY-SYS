# Tenant isolation rollout

Migration 008 is a required release prerequisite for the signed-session build.
The application deliberately fails closed when the restricted connection or
the containment migration is missing.

## 1. Preserve evidence

Take a database snapshot before changing data or applying the migration. Keep
audit output in access-controlled storage because it contains staff names and
email addresses.

## 2. Audit the current database

Run as the database owner or another role that can see all tenants:

```bash
make tenant-isolation-audit
```

Review duplicate normalized emails, tenants without exactly one active owner,
cross-tenant relationships, orphan rows, plaintext PIN indicators, unsafe
grants, and missing RLS policies. The audit is read-only and rolls back.

Do not automatically move suspicious rows. Confirm each store's owner and
location assignments with the business before repairing historical data.

## 3. Provision the restricted role

Production must provide a `retail_os_app` login role outside source control. It
must be `NOINHERIT`, `NOSUPERUSER`, `NOCREATEDB`, `NOCREATEROLE`,
`NOREPLICATION`, and `NOBYPASSRLS`; it must own no application table and have no
role memberships. Set `APP_DATABASE_URL` to that identity. Migration 008 checks
these conditions and aborts if they are unsafe.

The Docker initializer creates the equivalent local-development role. It does
not rerun for an existing PostgreSQL volume.

### Supabase production

Run role provisioning and migration SQL from the Supabase Dashboard SQL Editor.
Create the runtime identity before running migration 008 (replace the password
placeholder with a newly generated database password):

```sql
CREATE ROLE retail_os_app
  LOGIN PASSWORD 'REPLACE_WITH_A_NEW_RANDOM_PASSWORD'
  NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
ALTER ROLE retail_os_app SET row_security = on;
REVOKE ALL ON DATABASE postgres FROM retail_os_app;
GRANT CONNECT ON DATABASE postgres TO retail_os_app;
REVOKE CREATE ON SCHEMA public FROM retail_os_app;
```

After migration 008 succeeds, copy Supabase's Transaction pooler connection
string and replace only its username and password with the restricted role. For
the shared pooler the username is `retail_os_app.PROJECT_REF`. Save that complete
connection string as Vercel's sensitive production `APP_DATABASE_URL`; retain
the existing owner connection only as `DATABASE_URL` for trusted control-plane
operations. Migration 008 also removes application-table grants from Supabase's
`anon` and `authenticated` Data API roles.

## 4. Apply containment before deploying the app

```bash
make tenant-isolation-apply
make tenant-isolation-audit
```

The migration does not delete, reassign, or rewrite business rows. It enables
RLS, restricts grants, blocks new cross-tenant foreign-key relationships with
`NOT VALID` constraints, and adds login/session security columns. Existing
violations remain visible for explicit reconciliation.

For a non-Docker deployment, execute the same files with `psql -X -v
ON_ERROR_STOP=1 -f ...` using the owner connection.

## 5. Cut over safely

- Set random `SESSION_SIGNING_KEY` and `CRON_SECRET` values in the deployment.
- Configure a certificate-validating PostgreSQL connection; set
  `DATABASE_CA_CERT` when the provider uses a private CA.
- Deploy the dashboard only after migration 008 succeeds.
- Restart the dashboard and require every user to sign in again.
- Rotate any MTN MoMo credentials that were previously committed or shared.
- Keep the legacy Medusa backend profile disabled until its custom APIs derive
  tenant identity from authenticated membership and stop using the owner role.

After approved repairs, validate each `NOT VALID` constraint individually in a
maintenance window. Large index builds and validation scans should be tested on
a production-size copy first.
