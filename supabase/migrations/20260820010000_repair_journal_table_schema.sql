-- Repairs projects where the journal tables existed before the canonical
-- Explore migration was run. All changes are additive and existing rows are
-- backfilled before required constraints are applied.

create table if not exists public.places (
  id text primary key,
  provider text not null,
  provider_place_id text not null,
  data jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.places add column if not exists provider text;
alter table public.places add column if not exists provider_place_id text;
alter table public.places add column if not exists data jsonb;
alter table public.places add column if not exists created_at timestamptz;
alter table public.places add column if not exists updated_at timestamptz;

-- App-generated IDs include provider/category prefixes, so all entity keys are text.
-- Drop legacy foreign keys temporarily so UUID-backed projects can be converted.
do $$
declare
  constraint_record record;
begin
  for constraint_record in
    select conrelid::regclass as table_name, conname
    from pg_constraint
    where contype = 'f' and confrelid = 'public.places'::regclass
  loop
    execute format(
      'alter table %s drop constraint %I',
      constraint_record.table_name,
      constraint_record.conname
    );
  end loop;
end $$;

alter table public.places alter column id type text using id::text;

update public.places
set provider = case
      when coalesce(nullif(provider, ''), data ->> 'provider') in ('amap', 'google')
        then coalesce(nullif(provider, ''), data ->> 'provider')
      else 'amap'
    end,
    provider_place_id = coalesce(
      nullif(provider_place_id, ''),
      nullif(data ->> 'providerPlaceId', ''),
      id::text
    ),
    created_at = coalesce(created_at, now()),
    updated_at = coalesce(updated_at, created_at, now());

update public.places as place
set data = jsonb_strip_nulls(
  coalesce(place.data, '{}'::jsonb)
  || jsonb_build_object(
    'id', place.id::text,
    'provider', place.provider,
    'providerPlaceId', place.provider_place_id,
    'name', coalesce(place.data ->> 'name', to_jsonb(place) ->> 'name', place.id::text),
    'nameLocal', coalesce(place.data ->> 'nameLocal', to_jsonb(place) ->> 'name_local'),
    'aliases', coalesce(place.data -> 'aliases', '[]'::jsonb),
    'category', case
      when place.data ->> 'category' in ('restaurant', 'coffee', 'landmark', 'museum', 'park')
        then place.data ->> 'category'
      else 'landmark'
    end,
    'categoryLabel', coalesce(place.data ->> 'categoryLabel', to_jsonb(place) ->> 'category_label', 'Place'),
    'providerCategories', coalesce(place.data -> 'providerCategories', '[]'::jsonb),
    'providerTags', coalesce(place.data -> 'providerTags', '[]'::jsonb),
    'address', coalesce(place.data ->> 'address', to_jsonb(place) ->> 'address', ''),
    'city', coalesce(place.data ->> 'city', to_jsonb(place) ->> 'city', ''),
    'countryCode', coalesce(place.data ->> 'countryCode', to_jsonb(place) ->> 'country_code', ''),
    'coordinates', coalesce(place.data -> 'coordinates', jsonb_build_object('lat', 0, 'lng', 0)),
    'providerRating', coalesce(place.data -> 'providerRating', to_jsonb(place) -> 'provider_rating'),
    'providerReviewCount', coalesce(place.data -> 'providerReviewCount', to_jsonb(place) -> 'provider_review_count'),
    'providerPriceLevel', coalesce(place.data -> 'providerPriceLevel', to_jsonb(place) -> 'provider_price_level'),
    'hours', coalesce(place.data ->> 'hours', to_jsonb(place) ->> 'hours'),
    'phone', coalesce(place.data ->> 'phone', to_jsonb(place) ->> 'phone')
  )
);

alter table public.places alter column provider set not null;
alter table public.places alter column provider_place_id set not null;
alter table public.places alter column data set not null;
alter table public.places alter column created_at set default now();
alter table public.places alter column created_at set not null;
alter table public.places alter column updated_at set default now();
alter table public.places alter column updated_at set not null;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.places'::regclass
      and conname = 'places_provider_check'
  ) then
    alter table public.places
      add constraint places_provider_check check (provider in ('amap', 'google'));
  end if;
end $$;

create table if not exists public.categories (
  id text primary key,
  name text not null,
  color text not null,
  icon text,
  created_at timestamptz not null
);

alter table public.categories add column if not exists name text;
alter table public.categories add column if not exists color text;
alter table public.categories add column if not exists icon text;
alter table public.categories add column if not exists created_at timestamptz;
alter table public.categories alter column id type text using id::text;
update public.categories
set name = coalesce(nullif(name, ''), id::text),
    color = coalesce(nullif(color, ''), '#81d8d0'),
    created_at = coalesce(created_at, now());
alter table public.categories alter column name set not null;
alter table public.categories alter column color set not null;
alter table public.categories alter column created_at set not null;

create table if not exists public.people (
  id text primary key,
  name text not null,
  created_at timestamptz not null
);

alter table public.people add column if not exists name text;
alter table public.people add column if not exists created_at timestamptz;
alter table public.people alter column id type text using id::text;
update public.people
set name = coalesce(nullif(name, ''), id::text),
    created_at = coalesce(created_at, now());
alter table public.people alter column name set not null;
alter table public.people alter column created_at set not null;

create table if not exists public.journal_entries (
  id text primary key,
  place_id text not null references public.places(id) on delete cascade,
  visited_at timestamptz not null,
  rating numeric(2,1),
  notes text,
  category_ids text[] not null default '{}',
  person_ids text[] not null default '{}',
  created_at timestamptz not null,
  updated_at timestamptz not null
);

alter table public.journal_entries add column if not exists place_id text;
alter table public.journal_entries add column if not exists visited_at timestamptz;
alter table public.journal_entries add column if not exists rating numeric(2,1);
alter table public.journal_entries add column if not exists notes text;
alter table public.journal_entries add column if not exists category_ids text[];
alter table public.journal_entries add column if not exists person_ids text[];
alter table public.journal_entries add column if not exists created_at timestamptz;
alter table public.journal_entries add column if not exists updated_at timestamptz;
alter table public.journal_entries alter column id type text using id::text;
alter table public.journal_entries alter column place_id type text using place_id::text;

update public.journal_entries
set place_id = coalesce(nullif(place_id, ''), 'legacy-place:' || id::text),
    visited_at = coalesce(visited_at, created_at, now()),
    category_ids = coalesce(category_ids, '{}'::text[]),
    person_ids = coalesce(person_ids, '{}'::text[]),
    created_at = coalesce(created_at, visited_at, now()),
    updated_at = coalesce(updated_at, created_at, visited_at, now());

-- Keep legacy entries rather than deleting them if their place row is absent.
insert into public.places (id, provider, provider_place_id, data, created_at, updated_at)
select distinct
  entry.place_id,
  'amap',
  entry.place_id,
  jsonb_build_object(
    'id', entry.place_id,
    'provider', 'amap',
    'providerPlaceId', entry.place_id,
    'name', 'Imported place',
    'aliases', '[]'::jsonb,
    'category', 'landmark',
    'categoryLabel', 'Place',
    'providerCategories', '[]'::jsonb,
    'providerTags', '[]'::jsonb,
    'address', '',
    'city', '',
    'countryCode', '',
    'coordinates', jsonb_build_object('lat', 0, 'lng', 0)
  ),
  entry.created_at,
  entry.updated_at
from public.journal_entries entry
left join public.places place on place.id::text = entry.place_id
where place.id is null
on conflict (id) do nothing;

alter table public.journal_entries alter column place_id set not null;
alter table public.journal_entries alter column visited_at set not null;
alter table public.journal_entries alter column category_ids set default '{}';
alter table public.journal_entries alter column category_ids set not null;
alter table public.journal_entries alter column person_ids set default '{}';
alter table public.journal_entries alter column person_ids set not null;
alter table public.journal_entries alter column created_at set not null;
alter table public.journal_entries alter column updated_at set not null;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.journal_entries'::regclass
      and contype = 'f'
      and confrelid = 'public.places'::regclass
  ) then
    alter table public.journal_entries
      add constraint journal_entries_place_id_fkey
      foreign key (place_id) references public.places(id) on delete cascade;
  end if;
end $$;

create index if not exists journal_entries_place_id_idx on public.journal_entries(place_id);
create index if not exists journal_entries_visited_at_idx on public.journal_entries(visited_at desc);

-- Refresh PostgREST's schema cache after the columns are added.
notify pgrst, 'reload schema';
