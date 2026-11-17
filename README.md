# Fitness Tracker

React + Vite → Supabase (auth, Postgres, Storage, Edge Function) → GitHub Pages.

- **Workouts**: push / pull / legs, exercise catalog, weight × reps × sets, PR + last-session hints
- **Calories**: daily target, macros + fiber/sugar/sodium, deficit/surplus vs maintenance, photo → estimate via Claude
- **Progress**: weigh-ins with chart, private progress photos

## Setup

1. Create a Supabase project. Put the URL + publishable key in `.env` (see `.env.example`).
2. Run `supabase/schema.sql` in the SQL Editor (tables, RLS, private `progress-photos` bucket).
3. **Food photo estimates** need the Edge Function, since the Anthropic key must never be in the browser:
   ```bash
   supabase login
   supabase link --project-ref <project-ref>
   supabase secrets set ANTHROPIC_API_KEY=sk-ant-...
   supabase functions deploy estimate-food
   ```
4. `npm install && npm run dev`

## Deploy

```bash
gh repo create fitness_tracker --public --source . --push
gh variable set -f .env
gh api -X POST repos/<owner>/fitness_tracker/pages -f build_type=workflow
```

Then in Supabase → Authentication → URL Configuration set Site URL to
`https://<owner>.github.io/fitness_tracker/` and add that `/**` plus `http://localhost:5173/**` to Redirect URLs.
