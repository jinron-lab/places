create table if not exists public.places (
  id text primary key,
  provider text not null check (provider in ('amap', 'google')),
  provider_place_id text not null,
  data jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.categories (
  id text primary key,
  name text not null,
  color text not null,
  icon text,
  created_at timestamptz not null
);

create table if not exists public.people (
  id text primary key,
  name text not null,
  created_at timestamptz not null
);

create table if not exists public.journal_entries (
  id text primary key,
  place_id text not null references public.places(id) on delete cascade,
  visited_at timestamptz not null,
  rating numeric(2,1) check (rating is null or (rating between 0.5 and 5 and rating * 2 = trunc(rating * 2))),
  notes text,
  category_ids text[] not null default '{}',
  person_ids text[] not null default '{}',
  created_at timestamptz not null,
  updated_at timestamptz not null
);

create index if not exists journal_entries_place_id_idx on public.journal_entries(place_id);
create index if not exists journal_entries_visited_at_idx on public.journal_entries(visited_at desc);

alter table public.places enable row level security;
alter table public.journal_entries enable row level security;
alter table public.categories enable row level security;
alter table public.people enable row level security;

grant select, insert, update, delete on public.places to anon;
grant select, insert, update, delete on public.journal_entries to anon;
grant select, insert, update, delete on public.categories to anon;
grant select, insert, update, delete on public.people to anon;

drop policy if exists "single-user journal access" on public.places;
create policy "single-user journal access" on public.places for all to anon using (true) with check (true);
drop policy if exists "single-user journal access" on public.journal_entries;
create policy "single-user journal access" on public.journal_entries for all to anon using (true) with check (true);
drop policy if exists "single-user journal access" on public.categories;
create policy "single-user journal access" on public.categories for all to anon using (true) with check (true);
drop policy if exists "single-user journal access" on public.people;
create policy "single-user journal access" on public.people for all to anon using (true) with check (true);

comment on table public.places is 'Single-user Explore app data. Add authenticated ownership policies before supporting multiple users.';
