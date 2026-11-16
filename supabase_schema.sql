-- ==========================================================================
-- 일상계산소 — Supabase 스키마 (로그인 · 내 기록 저장)
-- --------------------------------------------------------------------------
-- 지금 사이트는 로그인 없이 브라우저 안에서만 계산하고, 최근 기록은
-- localStorage(daily-tool:history:v1)에만 남깁니다. 이 파일은 로그인과
-- 클라우드 저장을 켤 때 Supabase SQL Editor 에 그대로 붙여 실행하는 스키마입니다.
--
-- 순서
--   1) Supabase 프로젝트 생성 → Authentication > Providers 에서 Email 켜기
--   2) 아래 SQL 전체를 SQL Editor 에 붙여 실행
--   3) Project Settings > API 의 Project URL 과 anon(public) key 를
--      app.js 의 SUPABASE_CONFIG = { url: '...', anonKey: '...' } 에 넣기
--      (비어 있는 동안에는 라이브러리도 불러오지 않고 로그인 화면도 열리지 않습니다)
--   4) 개인정보처리방침 7항(로그인·클라우드 저장)을 실제 동작에 맞게 갱신
--
-- 보안 원칙
--   · 모든 사용자 테이블은 RLS(row level security)를 켜고 auth.uid() = user_id 만 허용합니다.
--   · service_role 키는 절대 브라우저에 넣지 않습니다(anon key 만 사용).
--   · 뉴스레터는 비로그인 신청도 받되, 동의(consent = true)한 행만 넣을 수 있습니다.
-- ==========================================================================

create extension if not exists pgcrypto;

-- --------------------------------------------------------------------------
-- 1. profiles — 사용자 한 명당 한 행. 사주 기본값(생일·시진)을 기억합니다.
-- --------------------------------------------------------------------------
create table if not exists public.profiles (
  user_id      uuid primary key references auth.users (id) on delete cascade,
  display_name text check (display_name is null or length(display_name) <= 40),
  calendar     text not null default 'solar' check (calendar in ('solar', 'lunar')),
  birth_date   date,
  birth_hour   smallint check (birth_hour is null or birth_hour between 0 and 11),
  gender       text check (gender is null or gender in ('m', 'f')),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

comment on column public.profiles.birth_hour is '시진 index: 0 자시(23~01) … 11 해시(21~23). 모르면 null';

alter table public.profiles enable row level security;

drop policy if exists profiles_select_own on public.profiles;
create policy profiles_select_own on public.profiles
  for select using (auth.uid() = user_id);

drop policy if exists profiles_insert_own on public.profiles;
create policy profiles_insert_own on public.profiles
  for insert with check (auth.uid() = user_id);

drop policy if exists profiles_update_own on public.profiles;
create policy profiles_update_own on public.profiles
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists profiles_delete_own on public.profiles;
create policy profiles_delete_own on public.profiles
  for delete using (auth.uid() = user_id);

-- --------------------------------------------------------------------------
-- 2. saved_calculations — 계산·사주 결과 요약. 한 행이 기록 한 칸입니다.
--    앱에서는 결과 요약(summary)만 보냅니다. 입력 원문은 보내지 않습니다.
-- --------------------------------------------------------------------------
create table if not exists public.saved_calculations (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users (id) on delete cascade,
  tool       text not null check (tool in ('salary', 'severance', 'weekly', 'loan', 'percent', 'fortune', 'saju', 'quiz')),
  summary    text not null check (length(summary) between 1 and 500),
  payload    jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists saved_calculations_user_created_idx
  on public.saved_calculations (user_id, created_at desc);

alter table public.saved_calculations enable row level security;

drop policy if exists saved_calculations_select_own on public.saved_calculations;
create policy saved_calculations_select_own on public.saved_calculations
  for select using (auth.uid() = user_id);

drop policy if exists saved_calculations_insert_own on public.saved_calculations;
create policy saved_calculations_insert_own on public.saved_calculations
  for insert with check (auth.uid() = user_id);

drop policy if exists saved_calculations_update_own on public.saved_calculations;
create policy saved_calculations_update_own on public.saved_calculations
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists saved_calculations_delete_own on public.saved_calculations;
create policy saved_calculations_delete_own on public.saved_calculations
  for delete using (auth.uid() = user_id);

-- --------------------------------------------------------------------------
-- 3. newsletter_subscribers — 옵트인 구독. 동의한 경우에만 저장합니다.
-- --------------------------------------------------------------------------
create table if not exists public.newsletter_subscribers (
  id              uuid primary key default gen_random_uuid(),
  email           text not null check (position('@' in email) > 1 and length(email) <= 254),
  user_id         uuid references auth.users (id) on delete set null,
  consent         boolean not null default false,
  consent_text    text,
  source          text,
  created_at      timestamptz not null default now(),
  unsubscribed_at timestamptz
);

create unique index if not exists newsletter_subscribers_email_key
  on public.newsletter_subscribers (lower(email));

alter table public.newsletter_subscribers enable row level security;

-- 동의(consent = true)한 신청만 저장할 수 있습니다. 로그인했다면 내 user_id 로만.
drop policy if exists newsletter_insert_consented on public.newsletter_subscribers;
create policy newsletter_insert_consented on public.newsletter_subscribers
  for insert to anon, authenticated
  with check (consent = true and (user_id is null or auth.uid() = user_id));

drop policy if exists newsletter_select_own on public.newsletter_subscribers;
create policy newsletter_select_own on public.newsletter_subscribers
  for select using (auth.uid() = user_id);

drop policy if exists newsletter_update_own on public.newsletter_subscribers;
create policy newsletter_update_own on public.newsletter_subscribers
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists newsletter_delete_own on public.newsletter_subscribers;
create policy newsletter_delete_own on public.newsletter_subscribers
  for delete using (auth.uid() = user_id);

-- --------------------------------------------------------------------------
-- 4. 가입하면 profiles 행을 자동으로 만든다 (auth.users 트리거)
-- --------------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (user_id) values (new.id)
  on conflict (user_id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- --------------------------------------------------------------------------
-- 5. updated_at 자동 갱신
-- --------------------------------------------------------------------------
create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists profiles_touch_updated_at on public.profiles;
create trigger profiles_touch_updated_at
  before update on public.profiles
  for each row execute function public.touch_updated_at();

-- --------------------------------------------------------------------------
-- 6. 확인용 쿼리 (실행 후 눈으로 확인)
-- --------------------------------------------------------------------------
-- select tablename, rowsecurity from pg_tables
--   where schemaname = 'public'
--     and tablename in ('profiles', 'saved_calculations', 'newsletter_subscribers');
-- select tablename, policyname, cmd, qual from pg_policies
--   where schemaname = 'public' order by tablename, policyname;
