-- MarginOS production schema (PostgreSQL)
-- UUID support
create extension if not exists pgcrypto;

create table organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  currency text not null default 'SAR',
  locale text not null default 'en',
  created_at timestamptz not null default now()
);

create table users (
  id uuid primary key default gen_random_uuid(),
  email citext not null unique,
  name text,
  created_at timestamptz not null default now()
);

create table memberships (
  organization_id uuid not null references organizations(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,
  role text not null check (role in ('owner','admin','manager','member','viewer')),
  created_at timestamptz not null default now(),
  primary key (organization_id,user_id)
);

create table clients (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  name text not null,
  contact_name text,
  contact_email text,
  contact_phone text,
  created_at timestamptz not null default now()
);
create index clients_org_idx on clients(organization_id);

create table projects (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  client_id uuid not null references clients(id) on delete restrict,
  name text not null,
  commercial_model text not null default 'fixed' check (commercial_model in ('fixed','retainer','hourly','hybrid')),
  contract_value numeric(14,2),
  hourly_rate numeric(14,2),
  internal_hourly_cost numeric(14,2),
  delivery_date date,
  status text not null default 'active' check (status in ('draft','active','complete','archived')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index projects_org_idx on projects(organization_id);

create table scope_baselines (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  version integer not null,
  title text not null,
  body text not null,
  exclusions text,
  revision_rounds integer,
  frozen_at timestamptz,
  frozen_by uuid references users(id),
  created_at timestamptz not null default now(),
  unique(project_id,version)
);

create table inbound_requests (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  project_id uuid not null references projects(id) on delete cascade,
  source text not null check (source in ('manual','email','whatsapp','slack','meeting','call','api')),
  external_message_id text,
  sender_name text,
  sender_address text,
  raw_text text not null,
  received_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);
create index inbound_requests_project_idx on inbound_requests(project_id,received_at desc);

create table scope_assessments (
  id uuid primary key default gen_random_uuid(),
  inbound_request_id uuid not null references inbound_requests(id) on delete cascade,
  baseline_id uuid references scope_baselines(id) on delete set null,
  verdict text not null check (verdict in ('in_scope','ambiguous','out_of_scope')),
  confidence numeric(5,2),
  rationale text,
  extracted_work jsonb not null default '[]'::jsonb,
  suggested_hours numeric(10,2),
  suggested_price numeric(14,2),
  suggested_days integer,
  risk_score integer check (risk_score between 0 and 100),
  model_name text,
  model_version text,
  created_at timestamptz not null default now()
);

create table change_requests (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  project_id uuid not null references projects(id) on delete cascade,
  inbound_request_id uuid references inbound_requests(id) on delete set null,
  assessment_id uuid references scope_assessments(id) on delete set null,
  title text not null,
  scope_text text not null,
  hours numeric(10,2) not null default 0,
  price numeric(14,2) not null default 0,
  delivery_shift_days integer not null default 0,
  status text not null default 'draft' check (status in ('draft','sent','viewed','approved','rejected','expired','cancelled')),
  created_by uuid references users(id),
  created_at timestamptz not null default now(),
  sent_at timestamptz,
  decided_at timestamptz
);
create index change_requests_org_idx on change_requests(organization_id,status,created_at desc);

create table approval_links (
  id uuid primary key default gen_random_uuid(),
  change_request_id uuid not null references change_requests(id) on delete cascade,
  token_hash text not null unique,
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  revoked_at timestamptz
);

create table approval_decisions (
  id uuid primary key default gen_random_uuid(),
  change_request_id uuid not null references change_requests(id) on delete cascade,
  decision text not null check (decision in ('approved','rejected','question')),
  client_name text,
  client_email text,
  comment text,
  ip_hash text,
  user_agent text,
  decided_at timestamptz not null default now()
);

create table payments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  change_request_id uuid references change_requests(id) on delete set null,
  provider text not null,
  provider_payment_id text not null,
  amount numeric(14,2) not null,
  currency text not null,
  status text not null check (status in ('created','authorized','paid','failed','refunded','voided')),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(provider,provider_payment_id)
);

create table audit_events (
  id bigserial primary key,
  organization_id uuid not null references organizations(id) on delete cascade,
  actor_user_id uuid references users(id) on delete set null,
  entity_type text not null,
  entity_id uuid,
  event_type text not null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index audit_events_entity_idx on audit_events(organization_id,entity_type,entity_id,created_at desc);

create table subscriptions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null unique references organizations(id) on delete cascade,
  provider text not null,
  provider_customer_id text,
  provider_subscription_id text,
  plan_code text not null,
  status text not null check (status in ('trialing','active','past_due','paused','cancelled')),
  renews_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
