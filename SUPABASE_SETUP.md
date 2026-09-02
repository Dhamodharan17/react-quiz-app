# Supabase Setup (Free)

## 1) Create Supabase project

- Go to <https://supabase.com> and create a new project.
- Copy:
  - Project URL
  - Anon public key

## 2) Create the saved websites table

Run this SQL in Supabase SQL Editor:

```sql
create table if not exists public.saved_websites (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  url text not null,
  topic text not null default 'General',
  snapshot_html text,
  snapshot_created_at timestamptz,
  annotations jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);
```

If you already created the table, run this once instead:

```sql
alter table public.saved_websites
  add column if not exists snapshot_html text,
  add column if not exists snapshot_created_at timestamptz,
  add column if not exists annotations jsonb not null default '[]'::jsonb;
```

## 3) Allow client access (MVP)

For quick testing, add open policies (replace later with auth-based rules):

```sql
alter table public.saved_websites enable row level security;

create policy "read saved websites"
on public.saved_websites
for select
using (true);

create policy "insert saved websites"
on public.saved_websites
for insert
with check (true);

create policy "delete saved websites"
on public.saved_websites
for delete
using (true);

create policy "update saved websites"
on public.saved_websites
for update
using (true)
with check (true);
```

## 4) Add env vars

Create `.env` in project root based on `.env.example`:

```env
VITE_SUPABASE_URL=https://your-project-ref.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key
```

## 5) Deploy the website snapshot function

The function fetches the current HTML server-side and saves it to the database. Install the Supabase CLI, log in, link your project, then deploy it:

```bash
npm install --save-dev supabase
npx supabase login
npx supabase link --project-ref your-project-ref
npx supabase functions deploy capture-website --no-verify-jwt
```

Some websites prevent automated downloads, require sign-in, or render their content with JavaScript. Those pages can be saved as links but may not produce a complete snapshot.

## 6) Run locally

```bash
npm run dev
```

The app requires Supabase. If its environment variables are missing or the database is unavailable, saved websites cannot be loaded or changed.

## 7) Deploy for free on Vercel

- Push code to GitHub.
- Import repo in Vercel.
- Add the same two env vars in Vercel project settings.
- Deploy.

Your saved websites and successfully captured HTML snapshots will persist via Supabase.
