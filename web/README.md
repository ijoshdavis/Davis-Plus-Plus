# Kinstore web

Next.js (App Router) front end - M6's "plain table view plus a person detail
page. No tree diagram." per `../docs/build-plan.md`.

Client-side only: pages use `@supabase/supabase-js` with the anon key
directly (no separate API server) - matches the pattern already working in
the org's other Vercel/Supabase apps, see `../docs/decisions.md`. RLS is what
actually protects data, not key secrecy, so nothing granted to `anon` means
nothing loads without a real logged-in session.

## Local development

```sh
cp .env.local.example .env.local   # fill in NEXT_PUBLIC_SUPABASE_URL / _ANON_KEY
npm install
npm run dev
```

You'll need a real Supabase user with an `app_user_role` row (`owner`,
`family`, or `viewer`) to see anything past `/login`.
