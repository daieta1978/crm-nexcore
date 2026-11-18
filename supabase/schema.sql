-- =====================================================================
-- CRM Nexcore - Esquema de base de datos para Supabase
-- Pegar todo este archivo en Supabase > SQL Editor > New query > Run
-- Cada usuario ve y edita SOLO sus propios datos.
-- Los usuarios con rol 'admin' ven y editan los datos de todos.
-- =====================================================================

-- ---------- Perfiles (rol por usuario) ----------
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  full_name text,
  role text not null default 'user' check (role in ('user','admin')),
  created_at timestamptz not null default now()
);

-- Crea el perfil automáticamente cuando alguien se registra
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, email, full_name)
  values (new.id, new.email, coalesce(new.raw_user_meta_data->>'full_name', ''))
  on conflict (id) do nothing;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ¿El usuario actual es admin?
create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role = 'admin');
$$;

-- ---------- Tablas del CRM ----------
create table if not exists public.companies (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name text not null,
  industry text,
  website text,
  phone text,
  notes text,
  created_at timestamptz not null default now()
);

create table if not exists public.contacts (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  first_name text not null,
  last_name text,
  email text,
  phone text,
  position text,
  company_id uuid references public.companies(id) on delete set null,
  notes text,
  created_at timestamptz not null default now()
);

create table if not exists public.deals (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  title text not null,
  value numeric(14,2) default 0,
  stage text not null default 'nuevo'
    check (stage in ('nuevo','contactado','propuesta','negociacion','ganado','perdido')),
  contact_id uuid references public.contacts(id) on delete set null,
  company_id uuid references public.companies(id) on delete set null,
  close_date date,
  notes text,
  created_at timestamptz not null default now()
);

create table if not exists public.activities (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  type text not null default 'tarea' check (type in ('llamada','reunion','email','tarea','nota')),
  subject text not null,
  due_date date,
  done boolean not null default false,
  contact_id uuid references public.contacts(id) on delete set null,
  deal_id uuid references public.deals(id) on delete set null,
  notes text,
  created_at timestamptz not null default now()
);

-- ---------- Seguridad por usuario (Row Level Security) ----------
alter table public.profiles   enable row level security;
alter table public.companies  enable row level security;
alter table public.contacts   enable row level security;
alter table public.deals      enable row level security;
alter table public.activities enable row level security;

drop policy if exists "perfil propio o admin" on public.profiles;
create policy "perfil propio o admin" on public.profiles
  for select using (id = auth.uid() or public.is_admin());

drop policy if exists "admin edita perfiles" on public.profiles;
create policy "admin edita perfiles" on public.profiles
  for update using (public.is_admin());

do $$
declare t text;
begin
  foreach t in array array['companies','contacts','deals','activities'] loop
    execute format('drop policy if exists "leer propios" on public.%I', t);
    execute format('drop policy if exists "crear propios" on public.%I', t);
    execute format('drop policy if exists "editar propios" on public.%I', t);
    execute format('drop policy if exists "borrar propios" on public.%I', t);

    execute format('create policy "leer propios" on public.%I for select using (owner_id = auth.uid() or public.is_admin())', t);
    execute format('create policy "crear propios" on public.%I for insert with check (owner_id = auth.uid())', t);
    execute format('create policy "editar propios" on public.%I for update using (owner_id = auth.uid() or public.is_admin()) with check (owner_id = auth.uid() or public.is_admin())', t);
    execute format('create policy "borrar propios" on public.%I for delete using (owner_id = auth.uid() or public.is_admin())', t);
  end loop;
end $$;

-- ---------- Para hacer admin a un usuario (opcional) ----------
-- update public.profiles set role = 'admin' where email = 'tu-correo@ejemplo.com';

-- ---------- Permisos para usuarios logueados ----------
-- (por si el proyecto no tiene "Grant API access automatically"; las reglas RLS siguen aplicando)
grant usage on schema public to authenticated;
grant select, insert, update, delete on public.companies, public.contacts, public.deals, public.activities to authenticated;
grant select, update on public.profiles to authenticated;
grant execute on function public.is_admin() to authenticated;

-- =====================================================================
-- Campos de oportunidades (igual que la planilla de Nexcore)
-- =====================================================================
-- ---------- Campos nuevos en negocios ----------
alter table public.deals add column if not exists ref_number integer;
alter table public.deals add column if not exists brand text;
alter table public.deals add column if not exists product text;
alter table public.deals add column if not exists partner text;
alter table public.deals add column if not exists last_interaction date;
alter table public.deals add column if not exists quarter text;
alter table public.deals add column if not exists responsible text;
alter table public.deals add column if not exists folder_url text;
alter table public.deals add column if not exists source text;
alter table public.deals alter column value drop default;

-- ---------- Etapas iguales al Excel ----------
alter table public.deals drop constraint if exists deals_stage_check;
update public.deals set stage = 'prospecto' where stage = 'nuevo';
update public.deals set stage = 'propuesta' where stage not in ('prospecto','contactado','propuesta','negociacion','ganado','perdido','pausa');
alter table public.deals alter column stage set default 'prospecto';
alter table public.deals add constraint deals_stage_check
  check (stage in ('prospecto','contactado','propuesta','negociacion','ganado','perdido','pausa'));

alter table public.companies add column if not exists source text;
alter table public.contacts  add column if not exists source text;

