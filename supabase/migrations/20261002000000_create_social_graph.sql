begin;

create table public.follows (
  follower_id uuid not null references public.profiles (id) on delete cascade,
  followed_id uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  constraint follows_pkey primary key (follower_id, followed_id),
  constraint follows_no_self_follow_check check (follower_id <> followed_id)
);

create index follows_followed_id_created_at_idx
  on public.follows (followed_id, created_at desc);

create table public.follow_requests (
  id uuid primary key default gen_random_uuid(),
  requester_id uuid not null references public.profiles (id) on delete cascade,
  target_id uuid not null references public.profiles (id) on delete cascade,
  status text not null default 'pending',
  created_at timestamptz not null default now(),
  responded_at timestamptz,
  constraint follow_requests_no_self_request_check check (requester_id <> target_id),
  constraint follow_requests_status_check check (
    status in ('pending', 'accepted', 'rejected')
  ),
  constraint follow_requests_status_responded_at_check check (
    (status = 'pending' and responded_at is null)
    or (
      status in ('accepted', 'rejected')
      and responded_at is not null
    )
  )
);

-- Resolved requests remain as history while each pair has at most one pending request.
create unique index follow_requests_pending_pair_unique_idx
  on public.follow_requests (requester_id, target_id)
  where status = 'pending';

create index follow_requests_target_pending_created_at_idx
  on public.follow_requests (target_id, created_at desc)
  where status = 'pending';

create index follow_requests_requester_created_at_idx
  on public.follow_requests (requester_id, created_at desc);

alter table public.follows enable row level security;
alter table public.follow_requests enable row level security;

revoke all privileges on table public.follows from public, anon, authenticated;
revoke all privileges on table public.follow_requests from public, anon, authenticated;

grant select, insert, update, delete
  on table public.follows
  to service_role;

grant select, insert, update, delete
  on table public.follow_requests
  to service_role;

commit;
