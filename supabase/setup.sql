-- =====================================================================
--  TG Notes — full database setup (a single file)
--
--  How to use:
--    1. Open your project on supabase.com
--    2. On the left open "SQL Editor" -> "New query"
--    3. Paste this WHOLE file and press "Run"
--
--  Safe to run again — nothing breaks (everything uses IF NOT EXISTS).
-- =====================================================================

create extension if not exists vector;

-- ------------------------------ Tables -------------------------------

create table if not exists users (
  id uuid primary key default gen_random_uuid(),
  telegram_id bigint unique not null,
  name text not null default '',
  avatar text default '',
  auth_user_id uuid unique,
  auth_secret text,
  tag_colors jsonb not null default '{}'::jsonb,
  created_at timestamptz default now()
);

-- For existing databases: store per-user tag colours.
alter table users add column if not exists tag_colors jsonb not null default '{}'::jsonb;

create table if not exists notes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  text text not null default '',
  created_at timestamptz default now(),
  extracted_date timestamptz,
  ai_summary text,
  ai_topics text[] default '{}',
  ai_keywords text[] default '{}',
  embedding vector(1536),
  telegram_message_id bigint,
  analyzed boolean default false,
  reminded boolean default false,
  deleted_at timestamptz,
  -- Telegram attachment (photo/video/voice/audio/document)
  media_url text,
  media_type text,
  -- auto-translation of foreign-language posts (text = English translation, original_text = source)
  original_text text,
  source_lang text,
  -- public share link (null = private; set to a random uuid by /api/notes/[id]/share)
  share_token text unique,
  -- sticky-wall layout (null until a note is placed/styled on the wall)
  pos_x integer,
  pos_y integer,
  width integer,
  height integer,
  color text,
  font text,
  -- pinned to the top of the list view (Google Keep style)
  pinned boolean not null default false,
  -- manual order of pinned notes (drag to reorder in the list)
  list_order integer,
  -- free position of a pinned note in the list's pinned area
  list_x integer,
  list_y integer
);

-- For existing databases: add the attachment + sticky-wall + trash columns if missing.
alter table notes add column if not exists deleted_at timestamptz;
alter table notes add column if not exists media_url text;
alter table notes add column if not exists media_type text;
alter table notes add column if not exists original_text text;
alter table notes add column if not exists source_lang text;
alter table notes add column if not exists share_token text unique;
alter table notes add column if not exists pos_x integer;
alter table notes add column if not exists pos_y integer;
alter table notes add column if not exists width integer;
alter table notes add column if not exists height integer;
alter table notes add column if not exists color text;
alter table notes add column if not exists font text;
alter table notes add column if not exists pinned boolean not null default false;
alter table notes add column if not exists list_order integer;
alter table notes add column if not exists list_x integer;
alter table notes add column if not exists list_y integer;

-- Public storage bucket for Telegram attachments (the bot uploads via the
-- service role; public = true lets the site load images by URL).
insert into storage.buckets (id, name, public)
values ('media', 'media', true)
on conflict (id) do update set public = true;

-- NOTE: topic_groups are keyed by the auth user id (auth.uid()), which is what
-- the web client has on hand — NOT the profile id like notes/bookmarks. So the
-- foreign key points at auth.users(id), otherwise inserts fail for users the bot
-- created first (whose profile id differs from their auth id).
create table if not exists topic_groups (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null default '',
  description text default '',
  created_at timestamptz default now()
);

create table if not exists topic_group_notes (
  topic_group_id uuid not null references topic_groups(id) on delete cascade,
  note_id uuid not null references notes(id) on delete cascade,
  primary key (topic_group_id, note_id)
);

create table if not exists telegram_auth_codes (
  id uuid primary key default gen_random_uuid(),
  code text unique not null,
  telegram_id bigint,
  first_name text default '',
  last_name text default '',
  username text default '',
  photo_url text default '',
  used boolean default false,
  created_at timestamptz default now(),
  expires_at timestamptz default (now() + interval '5 minutes')
);
-- telegram_id must never be null: a null id makes the login email collapse to a
-- single shared telegram_null@tgnotes.app account. Clear any stray null rows
-- (short-lived login codes) before enforcing it on existing databases.
delete from telegram_auth_codes where telegram_id is null;
alter table telegram_auth_codes alter column telegram_id set not null;

create table if not exists app_settings (
  id uuid primary key default gen_random_uuid(),
  bot_token text default '',
  bot_username text default '',
  webhook_url text default '',
  webhook_secret text default '',
  updated_at timestamptz default now()
);

-- Bot conversation state (e.g. batching the "Saving..." status message).
create table if not exists bot_state (
  telegram_id bigint primary key,
  action text not null default '',
  note_id uuid,
  message_id bigint,
  updated_at timestamptz default now()
);

create table if not exists bookmarks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  title text not null,
  url text not null,
  description text default '',
  source text default 'web',
  telegram_message_id bigint,
  tags text[] default '{}',
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- ------------------------------ Indexes ------------------------------

create index if not exists idx_notes_user_id on notes(user_id);
create index if not exists idx_users_telegram_id on users(telegram_id);
create index if not exists idx_users_auth_user_id on users(auth_user_id);
create index if not exists idx_topic_groups_user_id on topic_groups(user_id);
create index if not exists idx_auth_codes_code on telegram_auth_codes(code);
create index if not exists idx_bookmarks_user_id on bookmarks(user_id);
create index if not exists idx_bookmarks_created_at on bookmarks(created_at desc);
create index if not exists idx_bookmarks_tags on bookmarks using gin(tags);

-- ------------------------------- RLS ---------------------------------
-- Enable row-level security. The server (service_role key) bypasses it,
-- regular users only see their own data.

alter table users               enable row level security;
alter table notes               enable row level security;
alter table topic_groups        enable row level security;
alter table topic_group_notes   enable row level security;
alter table telegram_auth_codes enable row level security;
alter table app_settings        enable row level security;
alter table bookmarks           enable row level security;
alter table bot_state           enable row level security;

-- users: a profile is visible to its owner by id OR by auth_user_id
--        (the bot creates the profile with one id, signing in on the website links an auth_user_id).
drop policy if exists "Users can view own profile" on users;
create policy "Users can view own profile" on users for select to authenticated
  using (id = auth.uid() or auth_user_id = auth.uid());

drop policy if exists "Users can insert own profile" on users;
create policy "Users can insert own profile" on users for insert to authenticated
  with check (id = auth.uid() or auth_user_id = auth.uid());

drop policy if exists "Users can update own profile" on users;
create policy "Users can update own profile" on users for update to authenticated
  using (id = auth.uid() or auth_user_id = auth.uid())
  with check (id = auth.uid() or auth_user_id = auth.uid());

-- notes: the owner is resolved via notes.user_id -> users.id -> auth_user_id
drop policy if exists "Users can view own notes" on notes;
create policy "Users can view own notes" on notes for select to authenticated
  using (exists (select 1 from users where users.id = notes.user_id and users.auth_user_id = auth.uid()));

drop policy if exists "Users can insert own notes" on notes;
create policy "Users can insert own notes" on notes for insert to authenticated
  with check (exists (select 1 from users where users.id = user_id and users.auth_user_id = auth.uid()));

drop policy if exists "Users can update own notes" on notes;
create policy "Users can update own notes" on notes for update to authenticated
  using (exists (select 1 from users where users.id = notes.user_id and users.auth_user_id = auth.uid()))
  with check (exists (select 1 from users where users.id = user_id and users.auth_user_id = auth.uid()));

drop policy if exists "Users can delete own notes" on notes;
create policy "Users can delete own notes" on notes for delete to authenticated
  using (exists (select 1 from users where users.id = notes.user_id and users.auth_user_id = auth.uid()));

-- topic_groups: created from the website, user_id = auth.uid()
drop policy if exists "Users can view own topic groups" on topic_groups;
create policy "Users can view own topic groups" on topic_groups for select to authenticated
  using (user_id = auth.uid());

drop policy if exists "Users can create own topic groups" on topic_groups;
create policy "Users can create own topic groups" on topic_groups for insert to authenticated
  with check (user_id = auth.uid());

drop policy if exists "Users can update own topic groups" on topic_groups;
create policy "Users can update own topic groups" on topic_groups for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists "Users can delete own topic groups" on topic_groups;
create policy "Users can delete own topic groups" on topic_groups for delete to authenticated
  using (user_id = auth.uid());

-- topic_group_notes: access via owning the group
drop policy if exists "Users can view own topic group notes" on topic_group_notes;
create policy "Users can view own topic group notes" on topic_group_notes for select to authenticated
  using (exists (select 1 from topic_groups where topic_groups.id = topic_group_notes.topic_group_id and topic_groups.user_id = auth.uid()));

drop policy if exists "Users can create own topic group notes" on topic_group_notes;
create policy "Users can create own topic group notes" on topic_group_notes for insert to authenticated
  with check (
    exists (select 1 from topic_groups where topic_groups.id = topic_group_notes.topic_group_id and topic_groups.user_id = auth.uid())
    -- also require the note itself be owned by the caller, so a user can't attach
    -- someone else's note_id to their own group (integrity gap).
    and exists (select 1 from notes n join users u on u.id = n.user_id where n.id = topic_group_notes.note_id and u.auth_user_id = auth.uid())
  );

drop policy if exists "Users can delete own topic group notes" on topic_group_notes;
create policy "Users can delete own topic group notes" on topic_group_notes for delete to authenticated
  using (exists (select 1 from topic_groups where topic_groups.id = topic_group_notes.topic_group_id and topic_groups.user_id = auth.uid()));

-- bookmarks: same rule as notes
drop policy if exists "Users can view own bookmarks" on bookmarks;
create policy "Users can view own bookmarks" on bookmarks for select to authenticated
  using (exists (select 1 from users where users.id = bookmarks.user_id and users.auth_user_id = auth.uid()));

drop policy if exists "Users can insert own bookmarks" on bookmarks;
create policy "Users can insert own bookmarks" on bookmarks for insert to authenticated
  with check (exists (select 1 from users where users.id = user_id and users.auth_user_id = auth.uid()));

drop policy if exists "Users can update own bookmarks" on bookmarks;
create policy "Users can update own bookmarks" on bookmarks for update to authenticated
  using (exists (select 1 from users where users.id = bookmarks.user_id and users.auth_user_id = auth.uid()))
  with check (exists (select 1 from users where users.id = user_id and users.auth_user_id = auth.uid()));

drop policy if exists "Users can delete own bookmarks" on bookmarks;
create policy "Users can delete own bookmarks" on bookmarks for delete to authenticated
  using (exists (select 1 from users where users.id = bookmarks.user_id and users.auth_user_id = auth.uid()));

-- telegram_auth_codes: NO public read policy — only the server reads codes
-- (service role bypasses RLS). Letting anyone read active codes would leak
-- sign-in codes and Telegram IDs.
drop policy if exists "Anyone can read by code" on telegram_auth_codes;

-- app_settings: NO client read policy! It holds bot_token and
-- webhook_secret — the public key must NOT read them. The bot name for the
-- sign-in screen is served by the server (service role) via GET /api/bot/register.
drop policy if exists "Anyone can read app_settings" on app_settings;
drop policy if exists "Authenticated users can read app_settings" on app_settings;
drop policy if exists "Anon can read app_settings" on app_settings;

-- The account password (users.auth_secret) must never be readable from the browser — server only.
revoke select (auth_secret) on users from anon, authenticated;

-- Create the single settings row if it doesn't exist yet
insert into app_settings (bot_token, bot_username, webhook_url)
select '', '', ''
where not exists (select 1 from app_settings);

-- note_links: arrow links between notes on the wall. Owner — via users.id.
create table if not exists note_links (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  from_note uuid not null references notes(id) on delete cascade,
  to_note uuid not null references notes(id) on delete cascade,
  curved boolean not null default false,
  created_at timestamptz default now()
);
alter table note_links add column if not exists curved boolean not null default false;
create index if not exists idx_note_links_user_id on note_links(user_id);
-- One link per unordered pair of notes per user.
create unique index if not exists idx_note_links_unique_pair
  on note_links (user_id, least(from_note, to_note), greatest(from_note, to_note));
alter table note_links enable row level security;

drop policy if exists "Users can view own note links" on note_links;
create policy "Users can view own note links" on note_links for select to authenticated
  using (exists (select 1 from users where users.id = note_links.user_id and users.auth_user_id = auth.uid()));

drop policy if exists "Users can insert own note links" on note_links;
create policy "Users can insert own note links" on note_links for insert to authenticated
  with check (exists (select 1 from users where users.id = note_links.user_id and users.auth_user_id = auth.uid()));

drop policy if exists "Users can update own note links" on note_links;
create policy "Users can update own note links" on note_links for update to authenticated
  using (exists (select 1 from users where users.id = note_links.user_id and users.auth_user_id = auth.uid()))
  with check (exists (select 1 from users where users.id = note_links.user_id and users.auth_user_id = auth.uid()));

drop policy if exists "Users can delete own note links" on note_links;
create policy "Users can delete own note links" on note_links for delete to authenticated
  using (exists (select 1 from users where users.id = note_links.user_id and users.auth_user_id = auth.uid()));
