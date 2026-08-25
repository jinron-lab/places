-- Stage 1: make provider POIs global while keeping every journal entry owned.
-- The migration is data-preserving: duplicate POIs are repointed to one
-- canonical row before any duplicate place row is removed.

-- The existing composite FK prevents an entry from referencing a canonical
-- place row previously associated with another user. Remove it before dedupe.
alter table public.journal_entries
  drop constraint if exists journal_entries_user_place_fkey;

-- Prefer the provider-derived app ID when it exists. Otherwise retain the
-- earliest existing row so legacy IDs and their provider metadata stay valid.
create temporary table explore_place_deduplication on commit drop as
with ranked_places as (
  select
    place.id as duplicate_id,
    first_value(place.id) over (
      partition by place.provider, place.provider_place_id
      order by
        (place.id = place.provider || ':' || place.provider_place_id) desc,
        place.created_at asc,
        place.id asc
    ) as canonical_id
  from public.places as place
)
select duplicate_id, canonical_id
from ranked_places
where duplicate_id <> canonical_id;

update public.journal_entries as entry
set place_id = deduplication.canonical_id
from explore_place_deduplication as deduplication
where entry.place_id = deduplication.duplicate_id;

delete from public.places as place
using explore_place_deduplication as deduplication
where place.id = deduplication.duplicate_id;

create unique index if not exists places_provider_provider_place_id_key
  on public.places(provider, provider_place_id);

-- Keep the first-account legacy claim behavior for private journal entities,
-- but global places no longer participate in ownership detection or claiming.
create or replace function public.claim_legacy_explore_journal()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.journal_entries where user_id is not null
    union all select 1 from public.categories where user_id is not null
    union all select 1 from public.people where user_id is not null
  ) then
    update public.categories set user_id = new.id where user_id is null;
    update public.people set user_id = new.id where user_id is null;
    update public.journal_entries set user_id = new.id where user_id is null;
  end if;
  return new;
end;
$$;

drop policy if exists "users manage own places" on public.places;
drop policy if exists "single-user journal access" on public.places;
drop policy if exists "authenticated users read global places" on public.places;
drop index if exists public.places_user_id_id_key;
drop index if exists public.places_user_id_idx;
alter table public.places drop constraint if exists places_user_id_fkey;
alter table public.places drop column if exists user_id;

alter table public.journal_entries
  drop constraint if exists journal_entries_place_id_fkey;
alter table public.journal_entries
  drop constraint if exists journal_entries_place_id_fkey1;
alter table public.journal_entries
  add constraint journal_entries_place_id_fkey
  foreign key (place_id) references public.places(id) on delete restrict;

revoke all on public.places from anon;
revoke insert, update, delete on public.places from authenticated;
grant select on public.places to authenticated;
alter table public.places enable row level security;

create policy "authenticated users read global places"
on public.places
for select
to authenticated
using (true);

-- Inserts one provider POI exactly once and returns the already-existing row
-- on later or concurrent calls. It intentionally never updates global data
-- supplied by a different client.
create or replace function public.ensure_place(
  p_id text,
  p_provider text,
  p_provider_place_id text,
  p_data jsonb
)
returns public.places
language plpgsql
security definer
set search_path = ''
as $$
declare
  ensured_place public.places;
begin
  if p_provider is null or p_provider not in ('amap', 'google') then
    raise exception 'Unsupported place provider';
  end if;

  if nullif(btrim(p_id), '') is null
    or nullif(btrim(p_provider_place_id), '') is null
    or p_id <> p_provider || ':' || p_provider_place_id then
    raise exception 'Invalid canonical place identity';
  end if;

  if jsonb_typeof(p_data) is distinct from 'object'
    or p_data ->> 'id' is distinct from p_id
    or p_data ->> 'provider' is distinct from p_provider
    or p_data ->> 'providerPlaceId' is distinct from p_provider_place_id
    or nullif(btrim(p_data ->> 'name'), '') is null
    or jsonb_typeof(p_data -> 'coordinates') is distinct from 'object'
    or jsonb_typeof(p_data -> 'coordinates' -> 'lat') is distinct from 'number'
    or jsonb_typeof(p_data -> 'coordinates' -> 'lng') is distinct from 'number' then
    raise exception 'Invalid provider place data';
  end if;

  insert into public.places (id, provider, provider_place_id, data)
  values (p_id, p_provider, p_provider_place_id, p_data)
  on conflict (provider, provider_place_id) do nothing;

  select place.* into ensured_place
  from public.places as place
  where place.provider = p_provider
    and place.provider_place_id = p_provider_place_id;

  if ensured_place.id is null then
    raise exception 'Unable to ensure place';
  end if;

  return ensured_place;
end;
$$;

revoke all on function public.ensure_place(text, text, text, jsonb) from public;
revoke all on function public.ensure_place(text, text, text, jsonb) from anon;
grant execute on function public.ensure_place(text, text, text, jsonb) to authenticated;

comment on table public.places is
  'Global provider POI catalog. Contains no Explore user ownership, visits, notes, ratings, or sharing relationships.';
comment on function public.ensure_place(text, text, text, jsonb) is
  'Validates and inserts a canonical provider POI, or returns the existing global row without overwriting it.';

notify pgrst, 'reload schema';
