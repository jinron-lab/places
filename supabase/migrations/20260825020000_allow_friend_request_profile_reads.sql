-- Let each side of a friend request render the other user's public-safe
-- profile fields. This grants no access to auth email, journals, or places.

drop policy if exists "users read relevant profiles" on public.profiles;

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
  or exists (
    select 1
    from public.friend_requests as request
    where (request.requester_id = (select auth.uid()) and request.recipient_id = profiles.user_id)
       or (request.recipient_id = (select auth.uid()) and request.requester_id = profiles.user_id)
  )
);

comment on policy "users read relevant profiles" on public.profiles is
  'Profiles are readable only by their owner, accepted friends, and the two users involved in a friend request.';

notify pgrst, 'reload schema';
