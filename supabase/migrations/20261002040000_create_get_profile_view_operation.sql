begin;

create function public.get_profile_view(
  p_actor_id uuid,
  p_target_id uuid
)
returns table (
  profile_id uuid,
  username text,
  display_name text,
  avatar_url text,
  bio text,
  is_private boolean,
  is_self boolean,
  relationship_status text,
  pending_request_id uuid
)
language sql
stable
security invoker
set search_path = ''
as $$
  select
    target.id as profile_id,
    target.username,
    target.display_name,
    target.avatar_url,
    target.bio,
    target.is_private,
    p_actor_id = p_target_id as is_self,
    case
      when p_actor_id = p_target_id then 'none'::text
      when active_follow.follower_id is not null then 'following'::text
      when pending_request.id is not null then 'request_pending'::text
      else 'none'::text
    end as relationship_status,
    case
      when p_actor_id = p_target_id then null::uuid
      when active_follow.follower_id is not null then null::uuid
      else pending_request.id
    end as pending_request_id
  from public.profiles as target
  left join public.follows as active_follow
    on active_follow.follower_id = p_actor_id
    and active_follow.followed_id = target.id
  left join public.follow_requests as pending_request
    on pending_request.requester_id = p_actor_id
    and pending_request.target_id = target.id
    and pending_request.status = 'pending'
  where target.id = p_target_id;
$$;

revoke execute
  on function public.get_profile_view(uuid, uuid)
  from public, anon, authenticated;

grant execute
  on function public.get_profile_view(uuid, uuid)
  to service_role;

commit;
