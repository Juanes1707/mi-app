begin;

create function public.search_profiles(
  p_actor_id uuid,
  p_query text,
  p_limit integer
)
returns table (
  profile_id uuid,
  username text,
  display_name text,
  is_private boolean
)
language sql
stable
security invoker
set search_path = ''
as $$
  with search_input as (
    select
      lower(btrim(p_query)) as normalized_query,
      least(greatest(coalesce(p_limit, 20), 1), 20) as result_limit
  )
  select
    profile.id as profile_id,
    profile.username,
    profile.display_name,
    profile.is_private
  from public.profiles as profile
  cross join search_input
  where profile.id <> p_actor_id
    and search_input.normalized_query <> ''
    and (
      strpos(lower(profile.username), search_input.normalized_query) > 0
      or strpos(lower(profile.display_name), search_input.normalized_query) > 0
    )
  order by
    case
      when lower(profile.username) = search_input.normalized_query then 1
      when strpos(lower(profile.username), search_input.normalized_query) = 1 then 2
      when strpos(lower(profile.display_name), search_input.normalized_query) = 1 then 3
      else 4
    end,
    lower(profile.username) asc nulls last,
    lower(profile.display_name) asc nulls last,
    profile.id asc
  limit (select result_limit from search_input);
$$;

revoke execute
  on function public.search_profiles(uuid, text, integer)
  from public, anon, authenticated;

grant execute
  on function public.search_profiles(uuid, text, integer)
  to service_role;

commit;
