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
  snapshot_pdf_path text,
  snapshot_created_at timestamptz,
  annotations jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);
```

If you already created the table, run this once instead:

```sql
alter table public.saved_websites
  add column if not exists snapshot_html text,
  add column if not exists snapshot_pdf_path text,
  add column if not exists snapshot_created_at timestamptz,
  add column if not exists annotations jsonb not null default '[]'::jsonb;
```

If the app reports that `saved_websites.snapshot_pdf_path` does not exist, run this migration in Supabase SQL Editor and reload the app:

```sql
alter table public.saved_websites
  add column if not exists snapshot_pdf_path text;
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

## 4) Create PDF snapshot storage

Run this SQL in Supabase SQL Editor. It creates a public bucket so the app can show the saved PDF in its viewer.

```sql
insert into storage.buckets (id, name, public)
values ('website-snapshots', 'website-snapshots', true)
on conflict (id) do nothing;

create policy "upload PDF snapshots"
on storage.objects for insert
with check (bucket_id = 'website-snapshots');

create policy "read PDF snapshots"
on storage.objects for select
using (bucket_id = 'website-snapshots');
```

## 5) Create the Read later table

Run this SQL in Supabase SQL Editor. Read later links store only the URL and title; no website snapshot is created.

```sql
create table if not exists public.read_later_items (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  url text not null,
  created_at timestamptz not null default now()
);

alter table public.read_later_items enable row level security;

create policy "read read later items"
on public.read_later_items for select using (true);

create policy "insert read later items"
on public.read_later_items for insert with check (true);

create policy "delete read later items"
on public.read_later_items for delete using (true);
```

## 6) Create the topics table

Run this SQL in Supabase SQL Editor. Topics appear in the article form dropdown and persist across reloads.

```sql
create table if not exists public.website_topics (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  created_at timestamptz not null default now()
);

alter table public.website_topics enable row level security;

create policy "read website topics"
on public.website_topics for select using (true);

create policy "insert website topics"
on public.website_topics for insert with check (true);

create policy "delete website topics"
on public.website_topics for delete using (true);
```

## 7) Add env vars

Create `.env` in project root based on `.env.example`:

```env
VITE_SUPABASE_URL=https://your-project-ref.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key
```

## 8) Deploy the website snapshot function

The function fetches and saves the current website content. For JavaScript-rendered long articles such as Medium, create a Browserless account, copy its API token, and save it as a Supabase function secret:

```bash
npx supabase secrets set BROWSERLESS_TOKEN=your-browserless-token
```

Install the Supabase CLI, log in, link your project, then deploy the function:

```bash
npm install --save-dev supabase
npx supabase login
npx supabase link --project-ref your-project-ref
npx supabase functions deploy capture-website --no-verify-jwt
```

With `BROWSERLESS_TOKEN`, the function renders JavaScript pages and stores the resulting HTML reader snapshot, including long articles. These HTML snapshots support text and underline annotations. Direct PDF links are still saved as PDFs. Without the token, the function uses raw HTML capture, which works for simple pages but cannot reliably preserve dynamic sites. Pages that require sign-in or actively block automation may still be unavailable.

## 9) Run locally

```bash
npm run dev
```

The app requires Supabase. If its environment variables are missing or the database is unavailable, saved websites cannot be loaded or changed.

## 10) Deploy for free on Vercel

- Push code to GitHub.
- Import repo in Vercel.
- Add the same two env vars in Vercel project settings.
- Deploy.

Your saved websites and successfully captured HTML snapshots will persist via Supabase.
