-- TaskFlow Supabase Schema
-- Run this SQL in your Supabase Dashboard -> SQL Editor to create the tasks table.

create table if not exists public.tasks (
  id uuid primary key default gen_random_uuid(),
  title text not null check (char_length(trim(title)) > 0 and char_length(title) <= 160),
  date date not null default current_date,
  completed boolean not null default false,
  created_at timestamptz not null default now()
);

-- Index for fast reverse-chronological listing
create index if not exists tasks_created_at_idx on public.tasks (created_at desc);

-- Enable Row Level Security (RLS)
alter table public.tasks enable row level security;

-- Policy enabling CRUD operations when using a Supabase publishable/anon key.
-- If you later add Supabase Auth, replace "true" with "auth.uid() = user_id".
drop policy if exists "Allow TaskFlow CRUD operations" on public.tasks;
create policy "Allow TaskFlow CRUD operations"
  on public.tasks
  for all
  using (true)
  with check (true);
