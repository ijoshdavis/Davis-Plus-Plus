-- LOCAL DEV ONLY. Never run this against Supabase - it already provides a
-- real `auth` schema; this is a minimal stand-in so RLS policies (which
-- call auth.uid()) can be developed and tested against the local Postgres
-- container. Mirrors Supabase's real auth.uid() implementation.

create schema if not exists auth;

create table if not exists auth.users (
    id    uuid primary key default gen_random_uuid(),
    email text
);

create or replace function auth.uid() returns uuid
language sql stable
as $$
    select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;

do $$
begin
    if not exists (select 1 from pg_roles where rolname = 'authenticated') then
        create role authenticated nologin;
    end if;
    if not exists (select 1 from pg_roles where rolname = 'anon') then
        create role anon nologin;
    end if;
end
$$;

grant usage on schema public, auth to authenticated, anon;
