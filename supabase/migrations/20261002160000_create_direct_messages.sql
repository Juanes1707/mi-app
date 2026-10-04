begin;

create table public.direct_conversations (
  id uuid primary key default gen_random_uuid(),
  participant_low_id uuid not null references public.profiles (id) on delete cascade,
  participant_high_id uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  last_message_at timestamptz,
  constraint direct_conversations_distinct_participants_check
    check (participant_low_id <> participant_high_id),
  constraint direct_conversations_canonical_pair_check
    check (participant_low_id < participant_high_id),
  constraint direct_conversations_participant_pair_key
    unique (participant_low_id, participant_high_id)
);

create index direct_conversations_low_inbox_idx
  on public.direct_conversations (participant_low_id, last_message_at desc, id desc)
  where last_message_at is not null;

create index direct_conversations_high_inbox_idx
  on public.direct_conversations (participant_high_id, last_message_at desc, id desc)
  where last_message_at is not null;

create table public.direct_messages (
  id uuid primary key,
  conversation_id uuid not null references public.direct_conversations (id) on delete cascade,
  sender_id uuid not null references public.profiles (id) on delete cascade,
  body text not null,
  created_at timestamptz not null default now(),
  delivered_at timestamptz,
  read_at timestamptz,
  constraint direct_messages_body_not_blank_check check (btrim(body) <> ''),
  constraint direct_messages_body_length_check check (char_length(body) <= 2000),
  constraint direct_messages_read_receipt_check check (
    read_at is null or (delivered_at is not null and read_at >= delivered_at)
  )
);

create index direct_messages_history_idx
  on public.direct_messages (conversation_id, created_at desc, id desc);

create index direct_messages_unread_idx
  on public.direct_messages (conversation_id, sender_id)
  where read_at is null;

alter table public.direct_conversations enable row level security;
alter table public.direct_messages enable row level security;

revoke all privileges on table public.direct_conversations from public, anon, authenticated;
revoke all privileges on table public.direct_messages from public, anon, authenticated;

grant select, insert, update, delete on table public.direct_conversations to service_role;
grant select, insert, update, delete on table public.direct_messages to service_role;

create function public.get_or_create_direct_conversation(
  p_actor_id uuid,
  p_recipient_id uuid
)
returns table (
  status text,
  conversation_id uuid,
  participant_low_id uuid,
  participant_high_id uuid,
  created_at timestamptz
)
language plpgsql
volatile
security invoker
set search_path = ''
as $$
declare
  v_low_id uuid;
  v_high_id uuid;
begin
  if p_actor_id is null or p_recipient_id is null or p_actor_id = p_recipient_id then
    return query select 'invalid_request'::text, null::uuid, null::uuid, null::uuid, null::timestamptz;
    return;
  end if;

  if not exists (select 1 from public.profiles where id = p_actor_id) then
    return query select 'profile_not_ready'::text, null::uuid, null::uuid, null::uuid, null::timestamptz;
    return;
  end if;

  if not exists (select 1 from public.profiles where id = p_recipient_id) then
    return query select 'recipient_not_found'::text, null::uuid, null::uuid, null::uuid, null::timestamptz;
    return;
  end if;

  if p_actor_id < p_recipient_id then
    v_low_id := p_actor_id;
    v_high_id := p_recipient_id;
  else
    v_low_id := p_recipient_id;
    v_high_id := p_actor_id;
  end if;

  return query
    insert into public.direct_conversations as inserted (participant_low_id, participant_high_id)
    values (v_low_id, v_high_id)
    on conflict on constraint direct_conversations_participant_pair_key
    do update set participant_low_id = excluded.participant_low_id
    returning 'ok'::text, inserted.id, inserted.participant_low_id,
      inserted.participant_high_id, inserted.created_at;
end;
$$;

create function public.send_direct_message(
  p_actor_id uuid,
  p_conversation_id uuid,
  p_message_id uuid,
  p_body text
)
returns table (
  status text,
  message_id uuid,
  conversation_id uuid,
  sender_id uuid,
  body text,
  created_at timestamptz,
  delivered_at timestamptz,
  read_at timestamptz
)
language plpgsql
volatile
security invoker
set search_path = ''
as $$
declare
  v_message public.direct_messages%rowtype;
begin
  if p_actor_id is null or p_conversation_id is null or p_message_id is null or
     p_body is null or btrim(p_body) = '' or char_length(p_body) > 2000 then
    return query select 'invalid_request'::text, null::uuid, null::uuid, null::uuid,
      null::text, null::timestamptz, null::timestamptz, null::timestamptz;
    return;
  end if;

  if not exists (select 1 from public.profiles where id = p_actor_id) then
    return query select 'profile_not_ready'::text, null::uuid, null::uuid, null::uuid,
      null::text, null::timestamptz, null::timestamptz, null::timestamptz;
    return;
  end if;

  perform 1
  from public.direct_conversations
  where id = p_conversation_id
    and p_actor_id in (participant_low_id, participant_high_id)
  for key share;

  if not found then
    return query select 'conversation_not_found'::text, null::uuid, null::uuid, null::uuid,
      null::text, null::timestamptz, null::timestamptz, null::timestamptz;
    return;
  end if;

  insert into public.direct_messages (id, conversation_id, sender_id, body)
  values (p_message_id, p_conversation_id, p_actor_id, p_body)
  on conflict (id) do nothing
  returning * into v_message;

  if found then
    update public.direct_conversations
    set last_message_at = greatest(coalesce(last_message_at, v_message.created_at), v_message.created_at)
    where id = p_conversation_id;

    return query select 'created'::text, v_message.id, v_message.conversation_id,
      v_message.sender_id, v_message.body, v_message.created_at,
      v_message.delivered_at, v_message.read_at;
    return;
  end if;

  select * into v_message from public.direct_messages where id = p_message_id;

  if found and v_message.conversation_id = p_conversation_id and
     v_message.sender_id = p_actor_id and v_message.body = p_body then
    return query select 'already_created'::text, v_message.id, v_message.conversation_id,
      v_message.sender_id, v_message.body, v_message.created_at,
      v_message.delivered_at, v_message.read_at;
    return;
  end if;

  return query select 'message_id_conflict'::text, null::uuid, null::uuid, null::uuid,
    null::text, null::timestamptz, null::timestamptz, null::timestamptz;
end;
$$;

create function public.list_direct_messages(
  p_actor_id uuid,
  p_conversation_id uuid,
  p_limit integer,
  p_before_created_at timestamptz,
  p_before_message_id uuid
)
returns table (
  status text,
  message_id uuid,
  conversation_id uuid,
  sender_id uuid,
  body text,
  created_at timestamptz,
  delivered_at timestamptz,
  read_at timestamptz
)
language plpgsql
stable
security invoker
set search_path = ''
as $$
begin
  if p_actor_id is null or p_conversation_id is null or p_limit is null or
     p_limit < 1 or p_limit > 51 or
     ((p_before_created_at is null) <> (p_before_message_id is null)) then
    return query select 'invalid_request'::text, null::uuid, null::uuid, null::uuid,
      null::text, null::timestamptz, null::timestamptz, null::timestamptz;
    return;
  end if;

  if not exists (select 1 from public.profiles where id = p_actor_id) then
    return query select 'profile_not_ready'::text, null::uuid, null::uuid, null::uuid,
      null::text, null::timestamptz, null::timestamptz, null::timestamptz;
    return;
  end if;

  if not exists (
    select 1 from public.direct_conversations
    where id = p_conversation_id
      and p_actor_id in (participant_low_id, participant_high_id)
  ) then
    return query select 'conversation_not_found'::text, null::uuid, null::uuid, null::uuid,
      null::text, null::timestamptz, null::timestamptz, null::timestamptz;
    return;
  end if;

  if not exists (
    select 1 from public.direct_messages as message
    where message.conversation_id = p_conversation_id
      and (
        p_before_created_at is null or message.created_at < p_before_created_at or
        (message.created_at = p_before_created_at and message.id < p_before_message_id)
      )
  ) then
    return query select 'ok'::text, null::uuid, null::uuid, null::uuid,
      null::text, null::timestamptz, null::timestamptz, null::timestamptz;
    return;
  end if;

  return query
    select 'ok'::text, message.id, message.conversation_id, message.sender_id,
      message.body, message.created_at, message.delivered_at, message.read_at
    from public.direct_messages as message
    where message.conversation_id = p_conversation_id
      and (
        p_before_created_at is null or message.created_at < p_before_created_at or
        (message.created_at = p_before_created_at and message.id < p_before_message_id)
      )
    order by message.created_at desc, message.id desc
    limit p_limit;
end;
$$;

create function public.list_direct_conversations(
  p_actor_id uuid,
  p_limit integer,
  p_before_last_message_at timestamptz,
  p_before_conversation_id uuid
)
returns table (
  status text,
  conversation_id uuid,
  peer_id uuid,
  peer_username text,
  peer_display_name text,
  last_message_id uuid,
  last_message_sender_id uuid,
  last_message_body text,
  last_message_created_at timestamptz,
  last_message_delivered_at timestamptz,
  last_message_read_at timestamptz,
  unread_count integer
)
language plpgsql
stable
security invoker
set search_path = ''
as $$
begin
  if p_actor_id is null or p_limit is null or p_limit < 1 or p_limit > 51 or
     ((p_before_last_message_at is null) <> (p_before_conversation_id is null)) then
    return query select 'invalid_request'::text, null::uuid, null::uuid, null::text,
      null::text, null::uuid, null::uuid, null::text, null::timestamptz,
      null::timestamptz, null::timestamptz, null::integer;
    return;
  end if;

  if not exists (select 1 from public.profiles where id = p_actor_id) then
    return query select 'profile_not_ready'::text, null::uuid, null::uuid, null::text,
      null::text, null::uuid, null::uuid, null::text, null::timestamptz,
      null::timestamptz, null::timestamptz, null::integer;
    return;
  end if;

  if not exists (
    select 1 from public.direct_conversations as conversation
    where p_actor_id in (conversation.participant_low_id, conversation.participant_high_id)
      and conversation.last_message_at is not null
      and (
        p_before_last_message_at is null or conversation.last_message_at < p_before_last_message_at or
        (conversation.last_message_at = p_before_last_message_at and conversation.id < p_before_conversation_id)
      )
  ) then
    return query select 'ok'::text, null::uuid, null::uuid, null::text,
      null::text, null::uuid, null::uuid, null::text, null::timestamptz,
      null::timestamptz, null::timestamptz, null::integer;
    return;
  end if;

  return query
    select
      'ok'::text,
      conversation.id,
      peer.id,
      peer.username,
      peer.display_name,
      latest.id,
      latest.sender_id,
      latest.body,
      latest.created_at,
      latest.delivered_at,
      latest.read_at,
      (
        select count(*)::integer
        from public.direct_messages as unread
        where unread.conversation_id = conversation.id
          and unread.sender_id <> p_actor_id
          and unread.read_at is null
      )
    from public.direct_conversations as conversation
    join public.profiles as peer
      on peer.id = case
        when conversation.participant_low_id = p_actor_id then conversation.participant_high_id
        else conversation.participant_low_id
      end
    join lateral (
      select message.id, message.sender_id, message.body, message.created_at,
        message.delivered_at, message.read_at
      from public.direct_messages as message
      where message.conversation_id = conversation.id
      order by message.created_at desc, message.id desc
      limit 1
    ) as latest on true
    where p_actor_id in (conversation.participant_low_id, conversation.participant_high_id)
      and conversation.last_message_at is not null
      and (
        p_before_last_message_at is null or conversation.last_message_at < p_before_last_message_at or
        (conversation.last_message_at = p_before_last_message_at and conversation.id < p_before_conversation_id)
      )
    order by conversation.last_message_at desc, conversation.id desc
    limit p_limit;
end;
$$;

revoke execute on function public.get_or_create_direct_conversation(uuid, uuid)
  from public, anon, authenticated;
revoke execute on function public.send_direct_message(uuid, uuid, uuid, text)
  from public, anon, authenticated;
revoke execute on function public.list_direct_messages(uuid, uuid, integer, timestamptz, uuid)
  from public, anon, authenticated;
revoke execute on function public.list_direct_conversations(uuid, integer, timestamptz, uuid)
  from public, anon, authenticated;

grant execute on function public.get_or_create_direct_conversation(uuid, uuid) to service_role;
grant execute on function public.send_direct_message(uuid, uuid, uuid, text) to service_role;
grant execute on function public.list_direct_messages(uuid, uuid, integer, timestamptz, uuid) to service_role;
grant execute on function public.list_direct_conversations(uuid, integer, timestamptz, uuid) to service_role;

commit;
