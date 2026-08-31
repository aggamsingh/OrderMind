-- OrderMind schema — authoritative version of 02_ARCHITECTURE.md §3
-- Apply via Supabase SQL editor, or `supabase db push`.

create extension if not exists "pgcrypto";

create table if not exists catalog (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text not null default '',
  price_paise integer not null check (price_paise >= 0),
  category text not null,
  pairs_well_with uuid references catalog(id),
  is_available boolean not null default true
);

create table if not exists sessions (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  cart jsonb not null default '[]'::jsonb,
  messages jsonb not null default '[]'::jsonb,
  status text not null default 'browsing'
    check (status in ('browsing', 'awaiting_confirmation', 'confirmed', 'paid', 'failed')),
  confirmed_at timestamptz,
  confirmed_total_paise integer
);

create table if not exists orders (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references sessions(id),
  razorpay_order_id text,
  razorpay_payment_link_id text,
  total_paise integer not null check (total_paise >= 0),
  status text not null default 'created'
    check (status in ('created', 'payment_pending', 'paid', 'failed', 'retried', 'retry_failed')),
  retry_count integer not null default 0 check (retry_count >= 0 and retry_count <= 1),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists audit_log (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references sessions(id),
  order_id uuid references orders(id),
  actor text not null check (actor in ('customer', 'agent', 'orchestrator', 'razorpay_webhook')),
  action text not null,
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

-- Row Level Security: this app only ever talks to Supabase via the
-- service_role key, server-side, from the orchestrator (lib/supabase.ts) —
-- see CLAUDE.md §1, "the orchestrator is the only path to the database."
-- service_role bypasses RLS entirely regardless of policies, so enabling RLS
-- here with NO policies for anon/authenticated means those roles get zero
-- access, closing off direct REST API access via the public anon key while
-- changing nothing about how the app itself works.
alter table catalog enable row level security;
alter table sessions enable row level security;
alter table orders enable row level security;
alter table audit_log enable row level security;

create index if not exists idx_audit_log_session on audit_log(session_id);
create index if not exists idx_audit_log_created_at on audit_log(created_at);
create index if not exists idx_orders_session on orders(session_id);

-- Seed catalog: ~15 café items for Chai Point Express.
-- Inserted in two passes so pairs_well_with can reference ids created in pass 1.

-- Descriptions deliberately include natural, sensory words a real customer
-- might type ("warm", "sweet", "light", "savory", "cool", "filling") — a
-- keyword search only works if the words customers actually use appear in
-- the data. Learned this the hard way: "I want something warm and not too
-- sweet" returned zero matches against purely factual descriptions, which
-- pressured the model into hallucinating an item. See BUILD_LOG.md.
insert into catalog (name, description, price_paise, category, is_available) values
  ('Masala Chai', 'Classic spiced milk tea — warm, comforting, and mildly sweet', 4000, 'beverage', true),
  ('Ginger Chai', 'Chai with a strong ginger kick — warm and invigorating, not too sweet', 4000, 'beverage', true),
  ('Cardamom Chai', 'Chai brewed with whole cardamom — warm, aromatic, and lightly sweet', 4500, 'beverage', true),
  ('Filter Coffee', 'South Indian style filter coffee — warm, rich, and strong', 5000, 'beverage', true),
  ('Cold Coffee', 'Iced blended coffee — cool, creamy, and sweet', 8000, 'beverage', true),
  ('Lemon Iced Tea', 'Chilled black tea with lemon — cool, light, and refreshing', 6000, 'beverage', true),
  ('Cardamom Cookie', 'Buttery cookie with cardamom — a light, not-too-sweet snack', 3000, 'snack', true),
  ('Khari Biscuit', 'Flaky salted puff pastry biscuit — light and savory', 2500, 'snack', true),
  ('Vada Pav', 'Spiced potato fritter in a bun — warm, filling, and savory', 5000, 'snack', true),
  ('Samosa', 'Fried pastry with spiced potato filling — warm, crispy, and savory', 3500, 'snack', true),
  ('Bun Maska', 'Soft bun with butter — warm and mildly sweet', 4000, 'snack', true),
  ('Masala Sandwich', 'Grilled sandwich with spiced vegetables — warm and filling', 7000, 'snack', true),
  ('Gulab Jamun (2 pc)', 'Warm milk-solid dumplings in sugar syrup — rich and very sweet', 6000, 'dessert', true),
  ('Chocolate Brownie', 'Dense fudgy brownie — rich and sweet', 7000, 'dessert', true),
  ('Rasgulla (2 pc)', 'Soft spongy cheese balls in syrup — light and sweet', 5500, 'dessert', true)
on conflict do nothing;

-- Pass 2: wire up pairs_well_with (chai/coffee -> a snack or dessert that suits it)
update catalog set pairs_well_with = (select id from catalog where name = 'Cardamom Cookie')
  where name = 'Masala Chai';
update catalog set pairs_well_with = (select id from catalog where name = 'Khari Biscuit')
  where name = 'Ginger Chai';
update catalog set pairs_well_with = (select id from catalog where name = 'Gulab Jamun (2 pc)')
  where name = 'Cardamom Chai';
update catalog set pairs_well_with = (select id from catalog where name = 'Bun Maska')
  where name = 'Filter Coffee';
update catalog set pairs_well_with = (select id from catalog where name = 'Chocolate Brownie')
  where name = 'Cold Coffee';
update catalog set pairs_well_with = (select id from catalog where name = 'Masala Sandwich')
  where name = 'Lemon Iced Tea';
