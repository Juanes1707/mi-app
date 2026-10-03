begin;

create function public.list_feed_posts(
  p_actor_id uuid,
  p_limit integer,
  p_before_created_at timestamptz,
  p_before_post_id uuid
)
returns table (
  post_id uuid,
  author_id uuid,
  author_username text,
  author_display_name text,
  image_path text,
  caption text,
  created_at timestamptz,
  likes_count integer,
  comments_count integer,
  is_liked boolean
)
language sql
stable
security invoker
set search_path = ''
as $$
  with feed_page as (
    select
      post.id as post_id,
      post.author_id,
      author.username as author_username,
      author.display_name as author_display_name,
      post.image_path,
      post.caption,
      post.created_at
    from public.posts as post
    join public.profiles as author
      on author.id = post.author_id
    where p_actor_id is not null
      and (
        post.author_id = p_actor_id
        or not author.is_private
        or exists (
          select 1
          from public.follows as active_follow
          where active_follow.follower_id = p_actor_id
            and active_follow.followed_id = post.author_id
        )
      )
      and (
        (
          p_before_created_at is null
          and p_before_post_id is null
        )
        or (
          p_before_created_at is not null
          and p_before_post_id is not null
          and (
            post.created_at < p_before_created_at
            or (
              post.created_at = p_before_created_at
              and post.id < p_before_post_id
            )
          )
        )
      )
    order by post.created_at desc, post.id desc
    limit least(greatest(coalesce(p_limit, 21), 1), 21)
  )
  select
    feed_post.post_id,
    feed_post.author_id,
    feed_post.author_username,
    feed_post.author_display_name,
    feed_post.image_path,
    feed_post.caption,
    feed_post.created_at,
    (
      select count(*)::integer
      from public.post_likes as post_like
      where post_like.post_id = feed_post.post_id
    ) as likes_count,
    (
      select count(*)::integer
      from public.post_comments as post_comment
      where post_comment.post_id = feed_post.post_id
    ) as comments_count,
    exists (
      select 1
      from public.post_likes as actor_like
      where actor_like.post_id = feed_post.post_id
        and actor_like.user_id = p_actor_id
    ) as is_liked
  from feed_page as feed_post
  order by feed_post.created_at desc, feed_post.post_id desc;
$$;

revoke execute
  on function public.list_feed_posts(uuid, integer, timestamptz, uuid)
  from public, anon, authenticated;

grant execute
  on function public.list_feed_posts(uuid, integer, timestamptz, uuid)
  to service_role;

commit;
