-- Row-Level Security for the Supabase deployment path (O4).
--
-- The app already scopes every read/write to the logged-in user's id (owner_id) at the app layer.
-- On Supabase, RLS makes that guarantee defence-in-depth — even a leaked service path can't cross
-- tenants. Because every owner-scoped table carries `owner_id`, one policy shape covers them all.
--
-- On Supabase, the local `users` table is replaced by the managed `auth.users`, and `auth.uid()`
-- returns the current user's id — which is exactly our `owner_id`.

-- Enable RLS + an owner-only policy on every table that has an owner_id column.
do $$
declare t text;
begin
  for t in
    select table_name
    from information_schema.columns
    where table_schema = 'public' and column_name = 'owner_id'
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists owner_all on public.%I', t);
    execute format(
      'create policy owner_all on public.%I for all using (owner_id = auth.uid()) with check (owner_id = auth.uid())',
      t
    );
  end loop;
end $$;

-- `profiles` is keyed by the user id itself (id = owner_id = auth.uid()); the loop above already
-- covers it via owner_id, but make the intent explicit if you prefer keying on id:
-- alter table public.profiles enable row level security;
-- drop policy if exists owner_self on public.profiles;
-- create policy owner_self on public.profiles for all using (id = auth.uid()) with check (id = auth.uid());
