# Supabase Auth setup

Retail OS uses Supabase Auth for cookie-backed sessions while keeping its existing
email + 4-digit PIN workflow. The PIN is never sent to Supabase. Server routes
derive a high-entropy password with an HMAC pepper, and the browser receives only
the normal Supabase access/refresh-token cookies.

## Project configuration

1. Create or select a Supabase project.
2. In **Authentication > Providers**, leave Email enabled. Account provisioning
   confirms managed Retail OS identities server-side, so no public email-signup
   flow is required.
3. Copy `dashboard/.env.example` to `dashboard/.env.local` and fill in:
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`
   - `SUPABASE_SECRET_KEY` (server only; never use a `NEXT_PUBLIC_` prefix)
   - `SUPABASE_PIN_PEPPER` (at least 32 random bytes; generate with
     `openssl rand -base64 48`)
4. Keep `SUPABASE_PIN_PEPPER` stable. Rotating it requires resetting every
   Supabase Auth password because it changes the PIN-derived credential.

## Database migration

Apply `supabase/migrations/20260806183649_add_supabase_auth_identity.sql` to the
same Postgres database used by `DATABASE_URL` and `APP_DATABASE_URL`.

If the app database is the Supabase project database:

```bash
supabase link --project-ref YOUR_PROJECT_REF
supabase db push
```

If the app database is hosted separately, apply that SQL through the normal
database migration pipeline. `auth_user_id` intentionally has no foreign key in
that topology because `auth.users` lives in the Supabase project.

## Existing users

Existing staff and platform administrators migrate lazily. Their first successful
legacy email/PIN login creates and links a Supabase Auth user. New public owner
registrations and staff created from the Staff page are linked immediately.

Authorization data remains in `staff` and `platform_admins`; it is never read
from user-editable Supabase `user_metadata`. Middleware verifies the Supabase
session, and every protected API re-checks the server-controlled membership,
tenant, role, active status, and store assignment.
