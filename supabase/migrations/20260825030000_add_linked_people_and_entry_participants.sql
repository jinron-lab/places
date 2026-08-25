-- Stage 3: normalized person tags and explicit shared-entry participants.
-- Existing entries receive only their owner participant. Linking a Person does
-- not retroactively share any historical entry.

alter table public.people add column if not exists linked_user_id uuid;
alter table public.people add column if not exists linked_at timestamptz;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.people'::regclass
      and conname = 'people_linked_user_id_fkey'
  ) then
    alter table public.people
      add constraint people_linked_user_id_fkey
      foreign key (linked_user_id) references public.profiles(user_id) on delete set null;
  end if;
end;
$$;

create unique index if not exists people_owner_linked_user_key
  on public.people(user_id, linked_user_id)
  where linked_user_id is not null;

update public.people set linked_at = null where linked_user_id is null;
update public.people set linked_at = coalesce(linked_at, now()) where linked_user_id is not null;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.people'::regclass
      and conname = 'people_link_timestamp_check'
  ) then
    alter table public.people add constraint people_link_timestamp_check check (
      (linked_user_id is null and linked_at is null)
      or (linked_user_id is not null and linked_at is not null)
    );
  end if;
end;
$$;

create table if not exists public.journal_entry_people (
  entry_id text not null references public.journal_entries(id) on delete cascade,
  person_id text not null references public.people(id) on delete cascade,
  primary key (entry_id, person_id)
);

create index if not exists journal_entry_people_person_id_idx
  on public.journal_entry_people(person_id, entry_id);

create table if not exists public.journal_entry_participants (
  entry_id text not null references public.journal_entries(id) on delete cascade,
  user_id uuid not null references public.profiles(user_id) on delete cascade,
  role text not null,
  added_via_person_id text references public.people(id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (entry_id, user_id),
  constraint journal_entry_participants_role_check
    check (role in ('owner', 'participant'))
);

create index if not exists journal_entry_participants_user_id_idx
  on public.journal_entry_participants(user_id, entry_id);

-- Normalize only valid same-owner legacy tags. Invalid IDs remain untouched in
-- person_ids for recovery rather than causing data loss.
insert into public.journal_entry_people (entry_id, person_id)
select entry.id, person.id
from public.journal_entries as entry
cross join lateral unnest(entry.person_ids) as tagged(person_id)
join public.people as person
  on person.id = tagged.person_id
 and person.user_id = entry.user_id
on conflict (entry_id, person_id) do nothing;

-- Existing data remains private: no historical friend participant is inferred.
insert into public.journal_entry_participants (entry_id, user_id, role)
select entry.id, entry.user_id, 'owner'
from public.journal_entries as entry
where entry.user_id is not null
on conflict (entry_id, user_id) do update
set role = 'owner', added_via_person_id = null;

create or replace function public.validate_explore_person_link()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.linked_user_id is null then
    new.linked_at = null;
    return new;
  end if;

  if new.user_id is null or new.linked_user_id = new.user_id then
    raise exception 'A Person can only link to another Explore user';
  end if;

  if not exists (
    select 1 from public.friendships
    where user_id_low = least(new.user_id, new.linked_user_id)
      and user_id_high = greatest(new.user_id, new.linked_user_id)
  ) then
    raise exception 'A Person can only link to an accepted friend';
  end if;

  if tg_op = 'INSERT' or new.linked_user_id is distinct from old.linked_user_id then
    new.linked_at = now();
  else
    new.linked_at = old.linked_at;
  end if;
  return new;
end;
$$;

drop trigger if exists validate_explore_person_link on public.people;
create trigger validate_explore_person_link
before insert or update of linked_user_id, linked_at on public.people
for each row execute function public.validate_explore_person_link();

create or replace function public.save_journal_entry_people(
  p_entry_id text,
  p_person_ids text[] default '{}'
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id uuid := auth.uid();
  selected_person_ids text[] := coalesce(p_person_ids, '{}'::text[]);
begin
  if caller_id is null then raise exception 'Authentication required'; end if;

  perform 1 from public.journal_entries
  where id = p_entry_id and user_id = caller_id
  for update;
  if not found then raise exception 'Owned journal entry not found'; end if;

  insert into public.journal_entry_participants (entry_id, user_id, role)
  values (p_entry_id, caller_id, 'owner')
  on conflict (entry_id, user_id) do update
  set role = 'owner', added_via_person_id = null;

  if exists (
    select 1 from unnest(selected_person_ids) as selected(person_id)
    left join public.people as person
      on person.id = selected.person_id and person.user_id = caller_id
    where person.id is null
  ) then
    raise exception 'A selected Person is not owned by the entry owner';
  end if;

  delete from public.journal_entry_people
  where entry_id = p_entry_id
    and person_id <> all(selected_person_ids);

  insert into public.journal_entry_people (entry_id, person_id)
  select p_entry_id, selected.person_id
  from (select distinct unnest(selected_person_ids) as person_id) as selected
  on conflict (entry_id, person_id) do nothing;

  -- Owner saves are authoritative for tag-derived participants. The owner row
  -- is never touched, and a participant who left is only re-added by a later
  -- explicit owner save while the linked Person remains tagged.
  delete from public.journal_entry_participants
  where entry_id = p_entry_id and role = 'participant';

  insert into public.journal_entry_participants (
    entry_id, user_id, role, added_via_person_id
  )
  select distinct on (person.linked_user_id)
    p_entry_id, person.linked_user_id, 'participant', person.id
  from public.people as person
  join public.friendships as friendship
    on friendship.user_id_low = least(caller_id, person.linked_user_id)
   and friendship.user_id_high = greatest(caller_id, person.linked_user_id)
  where person.user_id = caller_id
    and person.id = any(selected_person_ids)
    and person.linked_user_id is not null
  order by person.linked_user_id, person.id
  on conflict (entry_id, user_id) do update
  set role = 'participant', added_via_person_id = excluded.added_via_person_id;

  update public.journal_entries
  set person_ids = selected_person_ids,
      updated_at = now()
  where id = p_entry_id and user_id = caller_id;
end;
$$;

create or replace function public.leave_shared_entry(p_entry_id text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  removed_count integer;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  delete from public.journal_entry_participants
  where entry_id = p_entry_id
    and user_id = auth.uid()
    and role = 'participant';
  get diagnostics removed_count = row_count;
  return removed_count = 1;
end;
$$;

-- Unfriending removes active Person links but keeps People, normalized tags,
-- and historical participant rows intact.
create or replace function public.unfriend_explore_user(p_friend_user_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id uuid := auth.uid();
  removed_count integer;
begin
  if caller_id is null then raise exception 'Authentication required'; end if;
  if p_friend_user_id is null or p_friend_user_id = caller_id then raise exception 'Invalid friend'; end if;

  update public.people
  set linked_user_id = null, linked_at = null
  where (user_id = caller_id and linked_user_id = p_friend_user_id)
     or (user_id = p_friend_user_id and linked_user_id = caller_id);

  delete from public.friendships
  where user_id_low = least(caller_id, p_friend_user_id)
    and user_id_high = greatest(caller_id, p_friend_user_id);
  get diagnostics removed_count = row_count;
  return removed_count = 1;
end;
$$;

alter table public.journal_entry_people enable row level security;
alter table public.journal_entry_participants enable row level security;

-- RLS predicates use small SECURITY DEFINER helpers to avoid recursive policy
-- expansion between entries and participants. They return booleans only.
create or replace function public.is_explore_entry_viewer(p_entry_id text)
returns boolean language sql security definer stable set search_path = ''
as $$
  select exists (
    select 1 from public.journal_entries as entry
    where entry.id = p_entry_id and entry.user_id = auth.uid()
  ) or exists (
    select 1 from public.journal_entry_participants as participant
    where participant.entry_id = p_entry_id and participant.user_id = auth.uid()
  );
$$;

create or replace function public.owns_explore_entry(p_entry_id text)
returns boolean language sql security definer stable set search_path = ''
as $$
  select exists (
    select 1 from public.journal_entries as entry
    where entry.id = p_entry_id and entry.user_id = auth.uid()
  );
$$;

create or replace function public.shares_explore_entry_with_owner(p_owner_id uuid)
returns boolean language sql security definer stable set search_path = ''
as $$
  select exists (
    select 1
    from public.journal_entry_participants as participant
    join public.journal_entries as entry on entry.id = participant.entry_id
    where participant.user_id = auth.uid() and entry.user_id = p_owner_id
  );
$$;

revoke all on public.journal_entry_people, public.journal_entry_participants from anon, authenticated;
grant select on public.journal_entry_people, public.journal_entry_participants to authenticated;

drop policy if exists "entry viewers read normalized people" on public.journal_entry_people;
drop policy if exists "users read relevant entry participants" on public.journal_entry_participants;

drop policy if exists "users manage own entries" on public.journal_entries;
drop policy if exists "owners and participants read entries" on public.journal_entries;
drop policy if exists "owners insert entries" on public.journal_entries;
drop policy if exists "owners update entries" on public.journal_entries;
drop policy if exists "owners delete entries" on public.journal_entries;

create policy "owners and participants read entries" on public.journal_entries
for select to authenticated using (public.is_explore_entry_viewer(id));
create policy "owners insert entries" on public.journal_entries
for insert to authenticated with check (user_id = (select auth.uid()));
create policy "owners update entries" on public.journal_entries
for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "owners delete entries" on public.journal_entries
for delete to authenticated using (user_id = (select auth.uid()));

create policy "entry viewers read normalized people" on public.journal_entry_people
for select to authenticated using (public.is_explore_entry_viewer(entry_id));

create policy "users read relevant entry participants" on public.journal_entry_participants
for select to authenticated using (
  user_id = (select auth.uid())
  or public.owns_explore_entry(entry_id)
);

drop policy if exists "participants read tagged people" on public.people;
create policy "participants read tagged people" on public.people
for select to authenticated using (
  exists (
    select 1 from public.journal_entry_people as tag
    join public.journal_entries as entry on entry.id = tag.entry_id
    where tag.person_id = people.id
  )
);

drop policy if exists "participants read shared categories" on public.categories;
create policy "participants read shared categories" on public.categories
for select to authenticated using (
  exists (
    select 1 from public.journal_entries as entry
    where categories.id = any(entry.category_ids)
  )
);

drop policy if exists "users read relevant profiles" on public.profiles;
create policy "users read relevant profiles" on public.profiles
for select to authenticated using (
  user_id = (select auth.uid())
  or exists (
    select 1 from public.friendships as friendship
    where (friendship.user_id_low = (select auth.uid()) and friendship.user_id_high = profiles.user_id)
       or (friendship.user_id_high = (select auth.uid()) and friendship.user_id_low = profiles.user_id)
  )
  or exists (
    select 1 from public.friend_requests as request
    where (request.requester_id = (select auth.uid()) and request.recipient_id = profiles.user_id)
       or (request.recipient_id = (select auth.uid()) and request.requester_id = profiles.user_id)
  )
  or public.shares_explore_entry_with_owner(profiles.user_id)
);

revoke all on function public.save_journal_entry_people(text, text[]) from public, anon;
revoke all on function public.leave_shared_entry(text) from public, anon;
revoke all on function public.validate_explore_person_link() from public, anon;
revoke all on function public.is_explore_entry_viewer(text) from public, anon;
revoke all on function public.owns_explore_entry(text) from public, anon;
revoke all on function public.shares_explore_entry_with_owner(uuid) from public, anon;
grant execute on function public.save_journal_entry_people(text, text[]) to authenticated;
grant execute on function public.leave_shared_entry(text) to authenticated;
grant execute on function public.is_explore_entry_viewer(text) to authenticated;
grant execute on function public.owns_explore_entry(text) to authenticated;
grant execute on function public.shares_explore_entry_with_owner(uuid) to authenticated;

comment on table public.journal_entry_people is 'Normalized Person tags for journal entries.';
comment on table public.journal_entry_participants is 'Explicit entry visibility; owner remains the only editor and deleter.';
notify pgrst, 'reload schema';
