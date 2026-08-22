# Broker CRM

A real estate lead pipeline built to feel like a habit, not a chore. Today's follow-ups show up
as a checklist with a progress ring, every lead is forced to have a next action and a follow-up
date, and daily/site-visit reports build themselves from what you log.

This guide takes you from zero to a live app on your phone's home screen. No coding experience
needed beyond copy-paste — just follow the steps in order.

---

## What you're building

- **Frontend**: React app, hosted free on **GitHub Pages**
- **Backend**: **Supabase** (free tier) — database, login, and security rules
- **Result**: A URL like `https://yourusername.github.io/true-homes-crm/` that you add to your
  phone's home screen and it behaves like a real app (full screen, no browser bar, works offline
  once loaded).

---

## Fix Pack 1 — run this if you already set up Supabase before

If you created your Supabase project before this update, run one more script to catch up your
database — your data is untouched, this only fixes policies and adds a few columns.

1. Supabase → **SQL Editor** → **New query**.
2. Copy everything from `supabase/fix_pack_1.sql` in this project, paste it in, click **Run**.
3. Refresh your app.

This fixes:
- The `infinite recursion detected in policy for relation "profiles"` error (and the blank name
  on login, which was the same root cause).
- Adds `profession`, `sqft`, `katha` columns and drops the old `property_type` column.

If you're setting this up fresh, `schema.sql` already has all of this — just run that one file
and skip `fix_pack_1.sql`.

---

## Part 1 — Create your Supabase project (5 minutes)

1. Go to [supabase.com](https://supabase.com) and sign up (free — GitHub login is fastest).
2. Click **New Project**.
   - Name: `true-homes-crm` (anything you like)
   - Database password: generate one and **save it somewhere** — you likely won't need it again,
     but keep it safe.
   - Region: pick the one closest to India (e.g. Singapore).
3. Wait ~2 minutes while Supabase sets up your project.

### Load the database structure

4. In the left sidebar, click **SQL Editor**.
5. Click **New query**.
6. Open the file `supabase/schema.sql` from this project, copy **everything** in it, and paste it
   into the SQL editor.
7. Click **Run** (bottom right). You should see "Success. No rows returned."

This created three tables — `profiles`, `leads`, `activities` — and locked them down so agents
can only see their own leads (admins see everyone's).

### Turn off email confirmation (so new agents can log in immediately)

8. Left sidebar → **Authentication** → **Providers** → click **Email**.
9. Turn **off** "Confirm email". Save.
   - (You can turn this back on later if you want extra security — it just means new agents
     have to click a link in their inbox before their first login.)

### Get your API keys

10. Left sidebar → **Project Settings** (gear icon) → **API**.
11. Copy two values, you'll need them twice (once for local testing, once for GitHub):
    - **Project URL** (looks like `https://xxxxx.supabase.co`)
    - **anon public** key (a long string)

Keep this tab open — you'll come back for these.

---

## Part 2 — Put the code on GitHub

1. Go to [github.com](https://github.com) and create a **new repository** called `true-homes-crm`.
   - Keep it **Public** (GitHub Pages free hosting requires this, unless you're on a paid plan).
   - Don't initialize with a README (you already have one).
2. On your computer, open a terminal in this project folder and run:

```bash
git init
git add .
git commit -m "Initial commit"
git branch -M main
git remote add origin https://github.com/YOUR-USERNAME/true-homes-crm.git
git push -u origin main
```

Replace `YOUR-USERNAME` with your actual GitHub username.

### Add your Supabase keys as GitHub Secrets (so the live site can connect)

3. On GitHub, open your `true-homes-crm` repo → **Settings** → **Secrets and variables** → **Actions**.
4. Click **New repository secret** and add:
   - Name: `VITE_SUPABASE_URL` → Value: (the Project URL you copied)
   - Click **New repository secret** again:
   - Name: `VITE_SUPABASE_ANON_KEY` → Value: (the anon public key you copied)

### Turn on GitHub Pages

5. Repo → **Settings** → **Pages**.
6. Under "Build and deployment" → Source, choose **GitHub Actions**.

### Fix the base path (one line, important)

7. Open `vite.config.js` in this project and confirm this line matches your repo name exactly:

```js
base: '/true-homes-crm/',
```

If you named your GitHub repo something other than `true-homes-crm`, change this line to
`/your-repo-name/` (and also update `start_url` and `scope` a few lines below it to match).
Commit and push the change if you edit it.

8. Push your code again if you changed anything:

```bash
git add .
git commit -m "Set base path"
git push
```

9. Go to the **Actions** tab in your GitHub repo — you'll see a workflow running. Wait for the
   green checkmark (~1-2 minutes).
10. Go back to **Settings → Pages** — your live URL will be shown at the top, something like:

```
https://yourusername.github.io/true-homes-crm/
```

That's your live app. Every time you `git push` to `main`, it rebuilds and redeploys automatically.

---

## Part 3 — Create your account and make yourself admin

1. Open your live URL, tap **New agent? Create an account**, sign up with your email.
2. You're in! You'll land on **Today's Work** — empty for now.
3. To make yourself an **admin** (so you can eventually see every agent's leads, not just your
   own — useful once you add teammates):
   - Go back to Supabase → **Table Editor** → `profiles` table.
   - Find your row, click into the `role` cell, change `agent` to `admin`, hit enter.
4. Add a few leads (or use **Bulk Upload** from the Leads tab) and try the whole flow: log a call,
   set a follow-up, watch it show up on Today's Work tomorrow.

---

## Part 4 — Add it to your phone's home screen (feels like a real app)

**iPhone (Safari):**
Open the live URL in Safari → tap the Share icon → **Add to Home Screen** → Add.

**Android (Chrome):**
Open the live URL in Chrome → tap the three-dot menu → **Add to Home screen** (or Chrome may
prompt you automatically) → Add.

**Desktop (Windows/Mac, Chrome or Edge):**
Open the live URL → click the install icon in the address bar (or menu → **Install Broker CRM**) →
this creates a desktop shortcut that opens in its own window, no browser bar.

---

## Adding your team

Each agent just signs up for their own account from the login screen — no invite system needed.
By default every new signup is an `agent`, meaning they only see leads assigned to them. Promote
anyone to `admin` the same way you did for yourself in Part 3 (Supabase Table Editor → `profiles`
→ change `role`).

Assigning a lead to a specific agent (instead of yourself) currently requires updating the
`assigned_to` column directly in Supabase Table Editor — pick that agent's `id` from the `profiles`
table and paste it into the lead's `assigned_to` field. If your team grows past a couple of people,
the next thing worth adding is an in-app "assign to" dropdown for admins — happy to build that
when you're ready.

---

## Local development (optional, if you want to test changes before pushing)

```bash
npm install
cp .env.example .env
# paste your Supabase URL and anon key into .env
npm run dev
```

Opens at `http://localhost:5173`.

---

## How the "no skipped follow-ups" rule works

Every time you log a call, the app requires a **next action** and a **follow-up date** — unless
you're marking the lead **Won** or **Lost** (those are end states, nothing to follow up on). This
is enforced in the app, not just a guideline, so leads can't silently go cold.

## How Today's Work decides what to show

Any lead whose `next_followup_date` is today or earlier (and isn't Won/Lost) shows up on Today's
Work, oldest first. Logging a call clears it from the list and adds to your ring. Clear the list
for the day and, if you did the same yesterday, your streak grows.

## How reports are calculated

- **Daily Report** reads every call you logged on the selected date: total calls, answered
  (Interested + Not Interested — i.e. the phone was actually picked up), and how many leads moved
  into each pipeline stage that day.
- **SV Report** counts a site visit as "scheduled" on the date you set as its follow-up date when
  you moved a lead to **SV Scheduled**, and as "done" on the date you logged **SV Done** — giving
  you a real week/month calendar of what's planned vs. what actually happened.

---

## Automatic Facebook lead import (optional)

If Facebook leads land in a Google Sheet, `google-apps-script/import-leads.gs` will pull every new
row into the CRM automatically — no manual copy-paste, no duplicates, and leads get split evenly
across your agents.

**What it does:** checks the sheet every 5 minutes → skips rows already imported → skips any phone
number already in the CRM → picks the next agent in rotation (round-robin, always reading current
agents from `profiles`, so adding/removing an agent just changes the rotation automatically) →
inserts the lead with `status = new`, no call logged yet, follow-up date = today (so it shows up on
that agent's Today's Work right away) → marks the sheet row `Imported`. The assigned agent sees it
appear live, without refreshing, because the app listens for it over Supabase Realtime.

**One-time setup:**

1. Supabase → **SQL Editor** → run `supabase/import_pack.sql` (adds a phone-dedup column, the
   round-robin state table, and turns on Realtime for `leads` — doesn't touch anything existing).
2. Open your Google Sheet → **Extensions → Apps Script** → paste in the contents of
   `google-apps-script/import-leads.gs`.
3. In the Apps Script editor: **Project Settings (gear icon) → Script Properties**, add:
   - `SUPABASE_URL` — your project URL (Project Settings → API)
   - `SUPABASE_SERVICE_ROLE_KEY` — the **service_role** key (same page). This key bypasses all
     security rules by design so the script can write leads — keep it only in Script Properties,
     never in the sheet itself or in the app's code.
4. Check the column names in the script's `COLUMN_ALIASES` match your sheet's headers (Name and
   Phone are required; Notes and Source are optional).
5. Run the `importNewLeads` function once manually from the Apps Script editor (▶ button) to test —
   check the Execution log for a summary, and check your CRM for the new lead.
6. Run `setupTrigger` once — this is what makes it run automatically every 5 minutes from then on.
   All free — no paid services involved.

If a row is invalid (missing name/phone) or something fails, the script logs it in the sheet's
"Imported" column instead of stopping the whole batch, so one bad row never blocks the rest.

---

## Lead Pool — one shared inbox before leads reach an agent

Every new lead (Facebook, CSV import, or your existing manual sheet) now lands **unassigned** in a
new **Lead Pool** screen (Leads tab → inbox icon, admins only) instead of landing straight in
someone's list. From there you select leads and either:

- **Assign Selected → pick an agent** — a specific person gets exactly those leads, or
- **Round Robin** — splits the selection evenly across every agent whose **Receiving Leads** is ON
  (Settings → Team, admin only) — turn an agent off there to skip them temporarily without deleting
  them.

Nothing is assigned automatically anymore — not even Facebook leads. This is a deliberate change
from the first import setup: it gives you one deliberate step (a few taps) instead of hoping the
auto-assignment picked the right person.

**Importing your manual Google Sheet:** use the existing **Leads → upload icon** page — it now has a
choice of *"Myself"* or *"Leave unassigned (Lead Pool)"*, plus a **Preview** step showing exactly
what will be imported and what's being skipped as a duplicate, before anything is written.

**Setup (only if you haven't already run `import_pack.sql` from the first import feature):**

1. Supabase → SQL Editor → run `supabase/import_pack.sql` first (if not done already), then run
   `supabase/lead_pool_pack.sql`.
2. Replace `google-apps-script/import-leads.gs` in your Apps Script project with the new version —
   it now leaves every Facebook lead unassigned in the Lead Pool instead of round-robining it itself.
3. That's it — no new Script Properties needed, same `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY`.

---

## Home dashboard — Apple Fitness–style Site Visit tracker

The Home screen (the "Today" tab you land on) now opens with a monthly Site Visit progress ring, a
"Today's Site Visits" breakdown, and a few key metrics — before your existing follow-up list, which
is still there exactly as before, just now below this new section.

**Nothing new to maintain:** a completed Site Visit is still just a lead whose pipeline stage is
**SV Done** — same as before, set from the same Log Call sheet, no new button anywhere. The ring
counts each lead once, and if a lead's stage is ever changed back off SV Done, it drops back out of
the count automatically.

**The monthly target** (default 12) is admin-editable in **Settings → Monthly Site Visit target** —
change the number, hit Save, and every agent's ring reflects it immediately.

**Setup:**

1. Supabase → SQL Editor → run `supabase/sv_target_pack.sql` (adds one small settings table for the
   target — nothing about leads or activities changes).
2. Upload the changed files as usual and redeploy.

---

## New Leads vs Follow-ups

The Home screen now has two tabs: **Follow-ups** (leads you've already spoken to, due today or
overdue) and **New Leads** (leads that haven't been called even once). A lead only moves into
Follow-ups once you log its first call — creating or importing a lead no longer auto-schedules it
for "today"; it just waits in New Leads until you get to it. This also means you can spend a day
only clearing Follow-ups, or only working through New Leads, without them being mixed together.

No SQL to run for this — it only changes when a follow-up date gets set (now: after the first call,
not at creation), not the database structure.

---

## Icons & navigation feel

Icons across the whole app now come from one consistent set (Phosphor Icons, filled style) instead
of the old thin hand-drawn ones — same places, same meanings, just a bolder, more modern look. Only
`components/Icons.jsx` changed for this; nothing else needed to know about it.

Also fixed: opening a lead from a list, editing/logging a call, and going back no longer dumps you
back at the top with your search/filters/tab reset. Your scroll position, search text, active
filters, and which tab you were on (Leads, Lead Pool, Pipeline, Today's Work, Reports) are now
remembered for the rest of your session — going back feels like you never left.

No SQL, no Apps Script changes for this update — purely frontend.

---

## Admin Command Center

The admin account is now a pure oversight/management role — Settings has three new links (admin only):

- **Team Performance** — every agent, side by side: open leads, never-called leads, pending
  follow-ups (overdue called out), hot leads, SV Scheduled/Done this month, and Won. Sort by any
  column, tap an agent to jump straight to their filtered lead list.
- **Activity Log** — a running feed of every call any agent logs (outcome, notes, next action) and
  every lead transfer, filterable by agent. This is how you spot a wrongly-logged call or a mistaken
  status change — the notes are right there.
- **Automatic Round Robin** (toggle) — when off (default), new leads land in the Lead Pool for you
  to assign by hand, same as before. Turn it on and every new lead (Facebook import, or a CSV import
  left unassigned) is handed to the next agent in rotation the instant it's created — no Lead Pool
  step at all, even for single one-off leads. It only ever picks agents with "Receiving Leads" on,
  and always remembers who got the last one so the rotation stays fair.

**Transferring a lead:** open any lead → admin sees an "Assigned to" card near the top with a
**Transfer** button → pick the new agent. It's logged in Activity Log automatically.

**Setup:** Supabase → SQL Editor → run `supabase/admin_command_center_pack.sql`. No other setup.

---

## Peer-to-peer lead transfer, pull-to-refresh, and a clearer Team Performance

**Agents can now transfer their own leads to each other** — open any lead you're assigned →
**Transfer** → pick a teammate. Not admin-only anymore; every agent can hand off their own leads
directly. Admins can still see the full transfer history in Activity Log.

**Pull down to refresh** — on any list page (Today, Leads, Pipeline, Lead Pool, Reports, Team
Performance, Activity Log, a lead's own page), pull down from the very top and let go to refetch
that page's data, same as any native app.

**Team Performance is clearer now** — "New leads pending" (never called) and "Follow-ups pending"
(overdue called out separately) are two distinct numbers, not blended together. Below that, a full
call-outcome breakdown (IN/NI/CB/NP/NR/OFF) per agent, then SV Scheduled/Done and Won. Also fixed a
bug where some numbers rendered invisible (white-on-white) on this page specifically.

**Setup:** Supabase → SQL Editor → run `supabase/peer_transfer_pack.sql`. Then upload the changed
files and redeploy as usual.

---

## Project structure

```
src/
  components/   Reusable UI (cards, sheets, nav, icons)
  lib/           Supabase client, constants, helpers, auth context
  pages/         One file per screen
supabase/
  schema.sql          Run this once in Supabase SQL Editor
  import_pack.sql     Optional — enables automatic Facebook-sheet lead import
  lead_pool_pack.sql  Optional — Lead Pool, agent Receiving Leads toggle
  lead_purpose_pack.sql  Optional — adds lead purpose field
  sv_target_pack.sql  Optional — configurable monthly Site Visit target
google-apps-script/
  import-leads.gs   Optional — paste into Apps Script for automatic import
.github/workflows/deploy.yml   Auto-builds and deploys on every push
```
