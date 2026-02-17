# White-Label Multi-Tenant Migration Plan

## Overview
Transform the single-tenant KLVL chatbot into a white-label multi-tenant system supporting 25-30 organizations, each with their own Supabase project.

**Architecture**: "One Push" model - single codebase, multiple databases, dynamic tenant detection.

---

## Phase 1: Master Database Setup (Day 1)

### 1.1 Create Admin Supabase Project
- Create new Supabase project: `chatbot-admin` (your master control panel)
- This project stores tenant configurations only
- **Never** stores customer data

### 1.2 Master Database Schema

**Table: `tenants`**
```sql
CREATE TABLE tenants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug TEXT UNIQUE NOT NULL, -- subdomain identifier (e.g., "klvl", "customer-a")
  organization_name TEXT NOT NULL,
  supabase_url TEXT NOT NULL,
  supabase_anon_key TEXT NOT NULL,
  supabase_secret_key TEXT NOT NULL, -- encrypted at rest
  domain TEXT, -- optional: custom domain (e.g., "chat.klvl.fi")
  subdomain TEXT, -- optional: subdomain (e.g., "klvl" for klvl.yourcompany.fi)
  branding JSONB NOT NULL DEFAULT '{}', -- colors, logo, bot name, etc.
  system_prompt_template TEXT, -- org-specific prompt customization
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_tenants_slug ON tenants(slug);
CREATE INDEX idx_tenants_domain ON tenants(domain);
CREATE INDEX idx_tenants_subdomain ON tenants(subdomain);
```

**Table: `tenant_migrations`** (track migration status per tenant)
```sql
CREATE TABLE tenant_migrations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
  migration_name TEXT NOT NULL,
  applied_at TIMESTAMPTZ DEFAULT NOW(),
  status TEXT NOT NULL, -- 'success', 'failed', 'pending'
  error_message TEXT,
  UNIQUE(tenant_id, migration_name)
);
```

### 1.3 Initial Data Migration
- Export KLVL's current Supabase project URL and keys
- Insert into `tenants` table with slug `"klvl"`
- Set branding JSON with KLVL colors, bot name, etc.

---

## Phase 2: Dynamic Client Factory (Day 2)

### 2.1 Create Tenant Client Factory

**File: `src/lib/tenant-client.ts`**
- Implements caching (Redis or in-memory with TTL)
- Fetches tenant config from master DB
- Creates Supabase client dynamically
- Handles errors gracefully (tenant not found, inactive, etc.)

### 2.2 Organization Detection Middleware

**File: `src/middleware.ts`** (Next.js middleware)
- Extracts subdomain/domain from request
- Looks up tenant in cache or master DB
- Attaches tenant context to request headers
- Handles fallback/default tenant

### 2.3 Update API Routes
- Replace `process.env.SUPABASE_URL` with tenant client factory
- All routes use `getTenantClient(request)` instead of static client
- Maintain backward compatibility during migration

---

## Phase 3: Dynamic Branding System (Day 3)

### 3.1 Branding Configuration
- Extract all hardcoded colors, text, logos
- Move to `tenants.branding` JSONB field
- Create TypeScript types for branding config

### 3.2 Frontend Updates
- Replace `bg-klvl-blue` with dynamic CSS variables
- Replace hardcoded text with tenant-specific values
- Create `<TenantProvider>` context for client-side access
- Update Tailwind config to use CSS variables

### 3.3 System Prompt Templates
- Extract KLVL-specific references from system prompt
- Create template system with placeholders
- Store org-specific customizations in `tenants.system_prompt_template`

---

## Phase 4: Migration Infrastructure (Day 4-5)

### 4.1 GitHub Actions Workflow

**File: `.github/workflows/migrate-tenants.yml`**
- Triggers on push to `supabase/migrations/`
- Reads list of all active tenants from master DB
- Loops through each tenant Supabase project
- Runs `supabase db push` or applies SQL migrations
- Logs results to `tenant_migrations` table
- Sends notifications on failure

### 4.2 Migration Runner Script

**File: `scripts/migrate-all-tenants.ts`**
- Node.js script for manual migration runs
- Connects to master DB
- Fetches all active tenant configs
- Applies migrations sequentially or in parallel (with rate limiting)
- Handles errors per tenant (one failure doesn't stop others)
- Reports summary at end

### 4.3 Migration Safety
- Always test migrations on staging tenant first
- Use transactions where possible
- Implement rollback scripts
- Version control all migrations

---

## Phase 5: Ingestion Script Updates (Day 6)

### 5.1 Tenant-Aware Ingestion
- Update `ingest-pdfs.ts` and `ingest-web.ts`
- Accept `--tenant-slug` parameter
- Use tenant client factory instead of static client
- Store ingested data in correct tenant database

### 5.2 Batch Ingestion Tool
- Create script to ingest same content to multiple tenants
- Useful for onboarding new customers with template content

---

## Phase 6: Testing & Validation (Day 7-8)

### 6.1 Test Tenant Setup
- Create test Supabase project
- Add test tenant to master DB
- Verify all functionality works with test tenant

### 6.2 Migration Testing
- Test migration workflow on test tenant
- Verify GitHub Actions workflow
- Test rollback procedures

### 6.3 Multi-Tenant Testing
- Test multiple tenants simultaneously
- Verify no data leakage between tenants
- Test organization detection (subdomain routing)

---

## Phase 7: Deployment (Day 9-10)

### 7.1 Vercel Configuration
- Update environment variables (only master DB credentials)
- Configure wildcard domain (`*.yourcompany.fi`)
- Set up domain routing if using custom domains

### 7.2 Production Migration
- Migrate KLVL tenant to new system
- Verify KLVL continues working
- Monitor for errors

### 7.3 Documentation
- Document tenant onboarding process
- Create admin panel (optional, Phase 2)
- Write migration runbook

---

## File-by-File Migration Checklist

### Files to Create (New)
- [ ] `src/lib/tenant-client.ts` - Dynamic Supabase client factory
- [ ] `src/lib/admin-db.ts` - Master database connection
- [ ] `src/middleware.ts` - Organization detection
- [ ] `src/types/tenant.ts` - TypeScript types for tenant config
- [ ] `src/components/TenantProvider.tsx` - React context for branding
- [ ] `.github/workflows/migrate-tenants.yml` - CI/CD for migrations
- [ ] `scripts/migrate-all-tenants.ts` - Migration runner
- [ ] `supabase/migrations/001_create_tenants_table.sql` - Master DB schema
- [ ] `scripts/create-tenant.ts` - Utility to add new tenants

### Files to Modify (Refactor)
- [ ] `src/app/api/chat/route.ts` - Use tenant client factory
- [ ] `src/app/page.tsx` - Use dynamic branding
- [ ] `src/lib/supabase.ts` - Deprecate, use tenant-client instead
- [ ] `tailwind.config.ts` - Use CSS variables for colors
- [ ] `src/app/globals.css` - Dynamic CSS variables
- [ ] `tietolahteet/scripts/ingest-pdfs.ts` - Add tenant parameter
- [ ] `tietolahteet/scripts/ingest-web.ts` - Add tenant parameter

### Files to Keep As-Is (95% reusable)
- [ ] `src/lib/mistral.ts` - Fully reusable
- [ ] `package.json` - Fully reusable
- [ ] `tsconfig.json` - Fully reusable
- [ ] `next.config.ts` - Fully reusable
- [ ] Core RAG logic in `route.ts` - Reusable (just swap client)

---

## Environment Variables

### Master Application (Vercel)
```env
# Master Database (Admin)
ADMIN_SUPABASE_URL=https://admin-project.supabase.co
ADMIN_SUPABASE_SECRET_KEY=eyJhbGc...

# Mistral (shared across all tenants)
MISTRAL_API_KEY=your-key

# Optional: Redis for caching (recommended for production)
REDIS_URL=redis://...
```

### Per-Tenant (stored in master DB, not env vars)
- `supabase_url` - Each tenant's Supabase project URL
- `supabase_anon_key` - Each tenant's anon key
- `supabase_secret_key` - Each tenant's service role key (encrypted)

---

## Security Considerations

1. **Key Encryption**: Store `supabase_secret_key` encrypted in master DB
2. **RLS**: Master DB should have RLS enabled (admin-only access)
3. **Rate Limiting**: Implement per-tenant rate limiting
4. **Audit Logging**: Log all tenant access for security
5. **Key Rotation**: Plan for rotating tenant keys without downtime

---

## Rollback Plan

If migration fails:
1. Revert code to previous version (Git)
2. Vercel auto-deploys previous version
3. All tenants continue using old system
4. Fix issues and retry migration

---

## Success Metrics

- [ ] All 30 tenants can be deployed with single code push
- [ ] Database migrations run automatically via GitHub Actions
- [ ] Zero data leakage between tenants
- [ ] <100ms overhead for tenant detection + client creation
- [ ] Admin can add new tenant in <5 minutes

---

## Estimated Timeline

- **Phase 1-2**: 2 days (Master DB + Client Factory)
- **Phase 3**: 1 day (Branding)
- **Phase 4**: 2 days (Migration Infrastructure)
- **Phase 5**: 1 day (Ingestion Updates)
- **Phase 6**: 2 days (Testing)
- **Phase 7**: 2 days (Deployment)

**Total: 10 days** (with buffer for unexpected issues)

---

## Next Steps

1. Create master Supabase project
2. Implement tenant client factory
3. Test with KLVL tenant first
4. Build migration infrastructure
5. Onboard first new customer
