# Plan: live Excel backend

**Goal:** every entry you add or change in the app shows up in an Excel workbook within seconds, without you exporting anything, and you can open that workbook any time from your phone or laptop.

## What exists today

- **Supabase is the source of truth.** Every entry is one row in `public.entries` (full record in a `data` JSON column).
- **Download Excel** (Done tab, and Settings → Data) builds an `.xlsx` on the phone with three sheets:
  - **Jobs:** one row per entry, 30 columns.
  - **Payments:** one row per payment.
  - **FY Summary.**

  This is a manual snapshot, not live.
- The column layout in `js/excel.js` (`jobRows`, `paymentRows`, `summaryRows`) is what the live sheet will use too, so the live workbook and the download match exactly.

## Recommended design: Supabase → Edge Function → Excel on OneDrive

```
Phone app ──saves──▶ Supabase `entries` table
                            │  Database Webhook (insert / update / delete)
                            ▼
                  Edge Function `excel-sync`
                            │  Microsoft Graph Excel API
                            ▼
          OneDrive: "Invoice Tracker.xlsx"  (tables: Jobs, Payments, Summary)
                            ▲
         Nightly full rebuild (pg_cron) as a safety net
```

Why this shape:
- **The app doesn't change.** Syncing happens server-side, so it works even when you save while offline: the row syncs when the phone reconnects, and Excel follows.
- **One source of truth.** Excel is a mirror. Edits made directly in Excel are *not* pulled back into the app, and the nightly rebuild overwrites them. Add your own notes in a separate sheet.
- **Excel tables keyed by the entry `ID`.** Updates replace the right row instead of appending duplicates.

### Steps

| # | Step | Who | Time |
|---|---|---|---|
| 1 | Create `Invoice Tracker.xlsx` in OneDrive with three Excel tables (`Jobs`, `Payments`, `Summary`) whose headers match the app's export. Easiest way: tap **Download Excel**, upload it, then convert each sheet to a table. | You | 10 min |
| 2 | Register an app in Microsoft Entra (portal.azure.com → App registrations) with delegated permissions `Files.ReadWrite` + `offline_access`, and a redirect URL to a one-time sign-in page. | You, guided | 15 min |
| 3 | Sign in once through that page to get a refresh token. Store it plus the client ID/secret and the workbook path as **Supabase Edge Function secrets** (never in the app or GitHub). | You + me | 10 min |
| 4 | Write the `excel-sync` Edge Function. It receives the webhook payload, builds the row with the same `calc.js` maths, then finds the row by `ID` and **updates** it, **adds** it, or **deletes** it. It replaces that entry's rows in `Payments` and recomputes `Summary`. | Me | 2–3 h |
| 5 | Add a **Database Webhook** in Supabase (Database → Webhooks) on `entries` for insert/update/delete → the function URL, with a shared secret header. | Me / you | 5 min |
| 6 | Add a nightly **pg_cron** job that calls the function in "full rebuild" mode. It rewrites all three tables from Supabase, which repairs anything a failed call missed. | Me | 30 min |
| 7 | Add a `sync_log` table and show "Excel synced 2 min ago" (or the last error) in Settings. | Me | 1 h |
| 8 | Test: add, edit, record payment, delete, and save offline then reconnect. Check each one lands in Excel. | Both | 30 min |

### Things to know
- **Account:** the Graph Excel API is fully supported on **Microsoft 365 (OneDrive for Business / SharePoint)**. Support on a personal OneDrive account is more limited, so we'd confirm it works with a test call in step 3 before building the rest.
- **Cost:** Supabase Edge Functions and webhooks fit in the free tier at this volume (a few hundred calls a month). Graph is free.
- **Security:** Microsoft credentials live only in Supabase secrets. The webhook is protected by a shared secret. The anon key in the app gains no new access.
- **Edits in Excel are overwritten.** The sheet is a read-only mirror by design (see above).

## Alternatives

| Option | How it works | Good | Not so good |
|---|---|---|---|
| **B. Google Sheets mirror** | Same webhook → a Google Apps Script web app that upserts rows by ID | No Azure setup, about 1–2 h total, very reliable, opens on any phone | It's Google Sheets (you can still *File → Download → .xlsx* any time) |
| **C. Excel pulls on demand (Power Query)** | An Edge Function returns all rows as a table behind a secret link; in desktop Excel, *Data → From Web*, then **Refresh** | About 1 h, no Microsoft app registration, always complete | Desktop Excel only (not the phone app); you press Refresh instead of it being live |
| **D. Manual export** (done) | **Download Excel** button | Works now, offline too | A snapshot, not live |

## Recommendation

- **If you have Microsoft 365 and want to open it in the Excel phone app:** go with **A**.
- **If you mainly check on a laptop:** **C** is the fastest path to "always up to date".
- **If the file format doesn't matter:** **B** is the simplest live mirror.

### What I need from you to start
1. Do you have **Microsoft 365** (work or business account), or a personal Microsoft / Outlook account?
2. Where will you open the sheet most: the **Excel phone app** or **Excel on a laptop**?
