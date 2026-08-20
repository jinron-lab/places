-- Move Explore from open anon access to authenticated, per-user ownership.
-- Add the columns without foreign keys first. A previous partial migration may
-- have left invalid UUID values that must be repaired before FK validation.
alter table public.places add column if not exists user_id uuid;
alter table public.journal_entries add column if not exists user_id uuid;
alter table public.categories add column if not exists user_id uuid;
alter table public.people add column if not exists user_id uuid;

-- Never preserve or propagate an owner that is not a real Supabase Auth user.
-- Invalid legacy ownership becomes unclaimed and is left for the signup flow.
update public.places as record
set user_id = null
where record.user_id is not null
  and not exists (select 1 from auth.users where id = record.user_id);

update public.journal_entries as record
set user_id = null
where record.user_id is not null
  and not exists (select 1 from auth.users where id = record.user_id);

update public.categories as record
set user_id = null
where record.user_id is not null
  and not exists (select 1 from auth.users where id = record.user_id);

update public.people as record
set user_id = null
where record.user_id is not null
  and not exists (select 1 from auth.users where id = record.user_id);

alter table public.places alter column user_id set default auth.uid();
alter table public.journal_entries alter column user_id set default auth.uid();
alter table public.categories alter column user_id set default auth.uid();
alter table public.people alter column user_id set default auth.uid();

-- There are no Auth users in the single-user version. Preserve any existing
-- unowned cloud journal by assigning it to the first account that signs up.
create or replace function public.claim_legacy_explore_journal()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.places where user_id is not null
    union all select 1 from public.journal_entries where user_id is not null
    union all select 1 from public.categories where user_id is not null
    union all select 1 from public.people where user_id is not null
  ) then
    update public.places set user_id = new.id where user_id is null;
    update public.categories set user_id = new.id where user_id is null;
    update public.people set user_id = new.id where user_id is null;
    update public.journal_entries set user_id = new.id where user_id is null;
  end if;
  return new;
end;
$$;

drop trigger if exists claim_legacy_explore_journal_on_signup on auth.users;
create trigger claim_legacy_explore_journal_on_signup
after insert on auth.users
for each row execute function public.claim_legacy_explore_journal();

create index if not exists places_user_id_idx on public.places(user_id);
create index if not exists journal_entries_user_id_idx on public.journal_entries(user_id);
create index if not exists categories_user_id_idx on public.categories(user_id);
create index if not exists people_user_id_idx on public.people(user_id);

-- Repair ownership before replacing the legacy place_id foreign key. A
-- partially-run migration can leave ownership on only one side of the
-- journal_entries -> places relationship.
do $$
declare
  legacy_owner_id uuid;
begin
  -- The pre-auth app was a single-user journal. Prefer an owner already
  -- attached to that journal; otherwise use the first Auth account.
  select existing_owners.owner_id into legacy_owner_id
  from (
    select place.user_id as owner_id
    from public.places as place
    join auth.users as auth_user on auth_user.id = place.user_id
    union all
    select entry.user_id
    from public.journal_entries as entry
    join auth.users as auth_user on auth_user.id = entry.user_id
    union all
    select category.user_id
    from public.categories as category
    join auth.users as auth_user on auth_user.id = category.user_id
    union all
    select person.user_id
    from public.people as person
    join auth.users as auth_user on auth_user.id = person.user_id
  ) existing_owners
  group by existing_owners.owner_id
  order by count(*) desc, existing_owners.owner_id
  limit 1;

  if legacy_owner_id is null then
    select id into legacy_owner_id
    from auth.users
    order by created_at, id
    limit 1;
  end if;

  -- A previous failed attempt may already have removed the old foreign key.
  -- Recreate a minimal place for any orphaned entry so no memory is lost.
  insert into public.places (
    id, provider, provider_place_id, data, created_at, updated_at, user_id
  )
  select distinct on (entry.place_id)
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
    entry.updated_at,
    coalesce(entry.user_id, legacy_owner_id)
  from public.journal_entries as entry
  left join public.places as place on place.id = entry.place_id
  where place.id is null
  order by entry.place_id, entry.created_at, entry.id
  on conflict (id) do nothing;

  -- When an entry already has an owner and its place does not, the entry is
  -- the ownership evidence for that place. All entries for a legacy place
  -- came from the same single-user journal.
  update public.places as place
  set user_id = ownership.user_id
  from (
    select distinct on (place_id) place_id, user_id
    from public.journal_entries
    where user_id is not null
    order by place_id, created_at, id
  ) as ownership
  where place.id = ownership.place_id
    and place.user_id is null;

  -- A place with an established owner is authoritative for every entry that
  -- references it. This also resolves partially migrated mismatched rows.
  update public.journal_entries as entry
  set user_id = place.user_id
  from public.places as place
  where entry.place_id = place.id
    and place.user_id is not null
    and entry.user_id is distinct from place.user_id;

  -- Claim any remaining standalone legacy records without deleting or
  -- recreating them. If no Auth user exists yet, these remain null and the
  -- signup trigger above will claim them for the first account.
  if legacy_owner_id is not null then
    update public.places set user_id = legacy_owner_id where user_id is null;
    update public.categories set user_id = legacy_owner_id where user_id is null;
    update public.people set user_id = legacy_owner_id where user_id is null;
    update public.journal_entries set user_id = legacy_owner_id where user_id is null;
  end if;

  -- Re-run propagation after the fallback claim so every entry/place pair is
  -- guaranteed to have identical ownership before the composite FK is added.
  update public.journal_entries as entry
  set user_id = place.user_id
  from public.places as place
  where entry.place_id = place.id
    and entry.user_id is distinct from place.user_id;
end $$;

-- Add Auth ownership constraints only after every non-null owner has been
-- verified. Null legacy rows remain valid until the first signup claims them.
do $$ begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.places'::regclass
      and conname = 'places_user_id_fkey'
  ) then
    alter table public.places add constraint places_user_id_fkey
      foreign key (user_id) references auth.users(id) on delete cascade;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.journal_entries'::regclass
      and conname = 'journal_entries_user_id_fkey'
  ) then
    alter table public.journal_entries add constraint journal_entries_user_id_fkey
      foreign key (user_id) references auth.users(id) on delete cascade;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.categories'::regclass
      and conname = 'categories_user_id_fkey'
  ) then
    alter table public.categories add constraint categories_user_id_fkey
      foreign key (user_id) references auth.users(id) on delete cascade;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.people'::regclass
      and conname = 'people_user_id_fkey'
  ) then
    alter table public.people add constraint people_user_id_fkey
      foreign key (user_id) references auth.users(id) on delete cascade;
  end if;
end $$;

-- Ensure an owned entry can only reference a place belonging to the same user.
create unique index if not exists places_user_id_id_key on public.places(user_id, id);
alter table public.journal_entries drop constraint if exists journal_entries_place_id_fkey;
alter table public.journal_entries drop constraint if exists journal_entries_place_id_fkey1;
do $$ begin
  if not exists (select 1 from pg_constraint where conrelid = 'public.journal_entries'::regclass and conname = 'journal_entries_user_place_fkey') then
    alter table public.journal_entries add constraint journal_entries_user_place_fkey foreign key (user_id, place_id) references public.places(user_id, id) on delete cascade;
  end if;
end $$;

revoke all on public.places, public.journal_entries, public.categories, public.people from anon;
grant select, insert, update, delete on public.places, public.journal_entries, public.categories, public.people to authenticated;

drop policy if exists "single-user journal access" on public.places;
drop policy if exists "single-user journal access" on public.journal_entries;
drop policy if exists "single-user journal access" on public.categories;
drop policy if exists "single-user journal access" on public.people;
drop policy if exists "users manage own places" on public.places;
drop policy if exists "users manage own entries" on public.journal_entries;
drop policy if exists "users manage own categories" on public.categories;
drop policy if exists "users manage own people" on public.people;

create policy "users manage own places" on public.places for all to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "users manage own entries" on public.journal_entries for all to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "users manage own categories" on public.categories for all to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "users manage own people" on public.people for all to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

comment on table public.places is 'Authenticated Explore place data, isolated by user_id and RLS.';
notify pgrst, 'reload schema';
