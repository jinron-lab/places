-- Stage 2: public-safe profiles and explicit friendship relationships.
-- No policy in this migration grants access to journals, places, categories,
-- or people. Auth email addresses remain confined to auth.users.

create table if not exists public.profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  username text not null,
  display_name text not null,
  searchable boolean not null default true,
  profile_completed boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint profiles_username_format_check check (
    username = lower(username)
    and username ~ '^[a-z0-9][a-z0-9_]{2,49}$'
  ),
  constraint profiles_display_name_length_check check (
    char_length(btrim(display_name)) between 1 and 80
  )
);

create unique index if not exists profiles_username_lower_key
  on public.profiles(lower(username));

create table if not exists public.friend_requests (
  id uuid primary key default gen_random_uuid(),
  requester_id uuid not null references public.profiles(user_id) on delete cascade,
  recipient_id uuid not null references public.profiles(user_id) on delete cascade,
  status text not null default 'pending',
  created_at timestamptz not null default now(),
  responded_at timestamptz,
  constraint friend_requests_not_self_check check (requester_id <> recipient_id),
  constraint friend_requests_status_check check (
    status in ('pending', 'accepted', 'declined', 'cancelled')
  ),
  constraint friend_requests_response_time_check check (
    (status = 'pending' and responded_at is null)
    or (status <> 'pending' and responded_at is not null)
  )
);

-- Only one pending request may exist between a pair, in either direction.
create unique index if not exists friend_requests_one_pending_pair_key
  on public.friend_requests(
    least(requester_id, recipient_id),
    greatest(requester_id, recipient_id)
  )
  where status = 'pending';

create index if not exists friend_requests_requester_idx
  on public.friend_requests(requester_id, created_at desc);
create index if not exists friend_requests_recipient_idx
  on public.friend_requests(recipient_id, created_at desc);

create table if not exists public.friendships (
  user_id_low uuid not null references public.profiles(user_id) on delete cascade,
  user_id_high uuid not null references public.profiles(user_id) on delete cascade,
  created_from_request_id uuid references public.friend_requests(id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (user_id_low, user_id_high),
  constraint friendships_canonical_order_check check (user_id_low < user_id_high)
);

create unique index if not exists friendships_created_from_request_key
  on public.friendships(created_from_request_id)
  where created_from_request_id is not null;
create index if not exists friendships_user_id_high_idx
  on public.friendships(user_id_high);

-- New accounts always receive a non-identifying fallback profile. The full
-- UUID makes the fallback unique without deriving or exposing the email.
create or replace function public.create_explore_profile_for_auth_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  fallback_username text := 'explorer_' || replace(new.id::text, '-', '');
  fallback_display_name text;
begin
  fallback_display_name := left(coalesce(
    nullif(btrim(new.raw_user_meta_data ->> 'display_name'), ''),
    nullif(btrim(new.raw_user_meta_data ->> 'name'), ''),
    'Explorer'
  ), 80);

  insert into public.profiles (
    user_id,
    username,
    display_name,
    searchable,
    profile_completed
  ) values (
    new.id,
    fallback_username,
    fallback_display_name,
    true,
    false
  )
  on conflict (user_id) do nothing;

  return new;
end;
$$;

drop trigger if exists create_explore_profile_on_signup on auth.users;
create trigger create_explore_profile_on_signup
after insert on auth.users
for each row execute function public.create_explore_profile_for_auth_user();

-- Preserve all existing Auth users by adding fallback profiles in place.
insert into public.profiles (
  user_id,
  username,
  display_name,
  searchable,
  profile_completed,
  created_at,
  updated_at
)
select
  auth_user.id,
  'explorer_' || replace(auth_user.id::text, '-', ''),
  left(coalesce(
    nullif(btrim(auth_user.raw_user_meta_data ->> 'display_name'), ''),
    nullif(btrim(auth_user.raw_user_meta_data ->> 'name'), ''),
    'Explorer'
  ), 80),
  true,
  false,
  coalesce(auth_user.created_at, now()),
  now()
from auth.users as auth_user
on conflict (user_id) do nothing;

create or replace function public.touch_explore_profile_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists touch_explore_profile_updated_at on public.profiles;
create trigger touch_explore_profile_updated_at
before update on public.profiles
for each row execute function public.touch_explore_profile_updated_at();

alter table public.profiles enable row level security;
alter table public.friend_requests enable row level security;
alter table public.friendships enable row level security;

revoke all on public.profiles, public.friend_requests, public.friendships from anon;
revoke all on public.profiles, public.friend_requests, public.friendships from authenticated;

grant select on public.profiles to authenticated;
grant update (username, display_name, searchable, profile_completed)
  on public.profiles to authenticated;
grant select on public.friend_requests, public.friendships to authenticated;

drop policy if exists "users read relevant profiles" on public.profiles;
drop policy if exists "users update own profile" on public.profiles;
drop policy if exists "users read own friend requests" on public.friend_requests;
drop policy if exists "users read own friendships" on public.friendships;

-- Search discovery goes through search_explore_users rather than unrestricted
-- profile-table enumeration. Existing friends remain directly readable if
-- either person later disables discovery.
create policy "users read relevant profiles"
on public.profiles
for select
to authenticated
using (
  user_id = (select auth.uid())
  or exists (
    select 1
    from public.friendships as friendship
    where (friendship.user_id_low = (select auth.uid()) and friendship.user_id_high = profiles.user_id)
       or (friendship.user_id_high = (select auth.uid()) and friendship.user_id_low = profiles.user_id)
  )
);

create policy "users update own profile"
on public.profiles
for update
to authenticated
using (user_id = (select auth.uid()))
with check (user_id = (select auth.uid()));

create policy "users read own friend requests"
on public.friend_requests
for select
to authenticated
using (
  requester_id = (select auth.uid())
  or recipient_id = (select auth.uid())
);

create policy "users read own friendships"
on public.friendships
for select
to authenticated
using (
  user_id_low = (select auth.uid())
  or user_id_high = (select auth.uid())
);

-- Search returns only public profile fields and never reads or returns email.
create or replace function public.search_explore_users(
  p_query text,
  p_limit integer default 20
)
returns table (
  user_id uuid,
  username text,
  display_name text
)
language plpgsql
security definer
set search_path = ''
stable
as $$
declare
  search_term text := lower(btrim(coalesce(p_query, '')));
  result_limit integer := least(greatest(coalesce(p_limit, 20), 1), 20);
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;

  if char_length(search_term) < 2 then
    return;
  end if;

  return query
  select profile.user_id, profile.username, profile.display_name
  from public.profiles as profile
  where profile.searchable
    and profile.user_id <> auth.uid()
    and position(search_term in lower(profile.username)) > 0
  order by
    (lower(profile.username) = search_term) desc,
    (lower(profile.username) like search_term || '%') desc,
    profile.username
  limit result_limit;
end;
$$;

create or replace function public.send_friend_request(p_recipient_id uuid)
returns public.friend_requests
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id uuid := auth.uid();
  created_request public.friend_requests;
begin
  if caller_id is null then
    raise exception 'Authentication required';
  end if;
  if p_recipient_id is null or p_recipient_id = caller_id then
    raise exception 'Invalid friend request recipient';
  end if;
  if not exists (
    select 1 from public.profiles
    where user_id = p_recipient_id and searchable
  ) then
    raise exception 'Explore user not found';
  end if;
  if exists (
    select 1 from public.friendships
    where user_id_low = least(caller_id, p_recipient_id)
      and user_id_high = greatest(caller_id, p_recipient_id)
  ) then
    raise exception 'Users are already friends';
  end if;

  insert into public.friend_requests (requester_id, recipient_id)
  values (caller_id, p_recipient_id)
  returning * into created_request;

  return created_request;
exception
  when unique_violation then
    raise exception 'A pending friend request already exists';
end;
$$;

create or replace function public.accept_friend_request(p_request_id uuid)
returns public.friendships
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id uuid := auth.uid();
  pending_request public.friend_requests;
  accepted_friendship public.friendships;
begin
  if caller_id is null then
    raise exception 'Authentication required';
  end if;

  select request.* into pending_request
  from public.friend_requests as request
  where request.id = p_request_id
    and request.recipient_id = caller_id
    and request.status = 'pending'
  for update;

  if pending_request.id is null then
    raise exception 'Pending friend request not found';
  end if;

  update public.friend_requests
  set status = 'accepted', responded_at = now()
  where id = pending_request.id;

  insert into public.friendships (
    user_id_low,
    user_id_high,
    created_from_request_id
  ) values (
    least(pending_request.requester_id, pending_request.recipient_id),
    greatest(pending_request.requester_id, pending_request.recipient_id),
    pending_request.id
  )
  on conflict (user_id_low, user_id_high) do update
    set created_from_request_id = coalesce(
      public.friendships.created_from_request_id,
      excluded.created_from_request_id
    )
  returning * into accepted_friendship;

  return accepted_friendship;
end;
$$;

create or replace function public.decline_friend_request(p_request_id uuid)
returns public.friend_requests
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id uuid := auth.uid();
  declined_request public.friend_requests;
begin
  if caller_id is null then
    raise exception 'Authentication required';
  end if;

  update public.friend_requests
  set status = 'declined', responded_at = now()
  where id = p_request_id
    and recipient_id = caller_id
    and status = 'pending'
  returning * into declined_request;

  if declined_request.id is null then
    raise exception 'Pending friend request not found';
  end if;
  return declined_request;
end;
$$;

create or replace function public.cancel_friend_request(p_request_id uuid)
returns public.friend_requests
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id uuid := auth.uid();
  cancelled_request public.friend_requests;
begin
  if caller_id is null then
    raise exception 'Authentication required';
  end if;

  update public.friend_requests
  set status = 'cancelled', responded_at = now()
  where id = p_request_id
    and requester_id = caller_id
    and status = 'pending'
  returning * into cancelled_request;

  if cancelled_request.id is null then
    raise exception 'Pending friend request not found';
  end if;
  return cancelled_request;
end;
$$;

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
  if caller_id is null then
    raise exception 'Authentication required';
  end if;
  if p_friend_user_id is null or p_friend_user_id = caller_id then
    raise exception 'Invalid friend';
  end if;

  delete from public.friendships
  where user_id_low = least(caller_id, p_friend_user_id)
    and user_id_high = greatest(caller_id, p_friend_user_id);
  get diagnostics removed_count = row_count;

  return removed_count = 1;
end;
$$;

revoke all on function public.search_explore_users(text, integer) from public;
revoke all on function public.send_friend_request(uuid) from public;
revoke all on function public.accept_friend_request(uuid) from public;
revoke all on function public.decline_friend_request(uuid) from public;
revoke all on function public.cancel_friend_request(uuid) from public;
revoke all on function public.unfriend_explore_user(uuid) from public;
revoke all on function public.create_explore_profile_for_auth_user() from public;
revoke all on function public.touch_explore_profile_updated_at() from public;

grant execute on function public.search_explore_users(text, integer) to authenticated;
grant execute on function public.send_friend_request(uuid) to authenticated;
grant execute on function public.accept_friend_request(uuid) to authenticated;
grant execute on function public.decline_friend_request(uuid) to authenticated;
grant execute on function public.cancel_friend_request(uuid) to authenticated;
grant execute on function public.unfriend_explore_user(uuid) to authenticated;

comment on table public.profiles is
  'Public-safe Explore identity. Email addresses remain private in auth.users.';
comment on table public.friend_requests is
  'Explicit directional friend requests visible only to their requester and recipient.';
comment on table public.friendships is
  'Canonical accepted Explore friendships. Grants no journal or place access.';

notify pgrst, 'reload schema';
