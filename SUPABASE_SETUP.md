# Supabase + Vercel Setup (Free)

## 1) Create Supabase project
- Go to https://supabase.com and create a new project.
- Copy:
  - Project URL
  - Anon public key

## 2) Create table
Run this SQL in Supabase SQL Editor:

```sql
create table if not exists public.quiz_banks (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  quiz_json jsonb not null,
  created_at timestamptz not null default now()
);
```

## 3) Allow client access (MVP)
For quick testing, add open policies (replace later with auth-based rules):

```sql
alter table public.quiz_banks enable row level security;

create policy "read quiz banks"
on public.quiz_banks
for select
using (true);

create policy "insert quiz banks"
on public.quiz_banks
for insert
with check (true);

create policy "delete quiz banks"
on public.quiz_banks
for delete
using (true);
```

## 4) Add env vars
Create `.env` in project root based on `.env.example`:

```env
VITE_SUPABASE_URL=https://your-project-ref.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key
```

## 5) Run locally
```bash
npm run dev
```

If env vars are missing or Supabase is unavailable, app falls back to local browser storage.

## 6) Deploy for free on Vercel
- Push code to GitHub.
- Import repo in Vercel.
- Add the same two env vars in Vercel project settings.
- Deploy.

Your quiz add/delete/import will persist via Supabase.
