# Invoice Tracker

A phone-first PWA for a freelance / agency video business.
Every job moves through one pipeline:

**Quote → 50% advance → Work in progress → Work done → Invoice (30-day countdown) → Paid**

- **Quotes**: everyone you've quoted. Tap **Advance received** to start the work.
- **Work**: jobs in progress. **Mark work done** pops up **Raise invoice**.
- **Due**: raised invoices with a live day-by-day countdown (green → amber at 7 days → red when overdue), a WhatsApp reminder button and the PDF.
- **Done**: FY summary (received, invoiced, GST collected, TDS deducted, vendor costs, margin), charts (monthly received/invoiced, top & repeat clients, category mix, pipeline, win rate, days to get paid), **Excel** download, vendors still to pay, completed jobs.
- **Header counter**: money received this financial year (Apr–Mar) and pending receivables, with overdue amount.

GST is added on top of the quote, and TDS is calculated on the pre-GST amount and treated as withheld by the client:
`you receive = quote + GST − TDS`. Invoices are generated as PDFs on the phone and shared via the share sheet (WhatsApp, Mail…).
Same-state clients get CGST + SGST, other states get IGST.

No build step: plain HTML/CSS/ES modules, with Preact and jsPDF loaded from jsDelivr and cached offline by the service worker.

---

## Privacy: end-to-end encrypted

Anyone can sign up and use the app, and **nobody else can read their data — including you, the owner of the Supabase project.**

- Each user's jobs and settings are encrypted on their phone (AES-256-GCM) before upload. Supabase only stores ciphertext; the database itself refuses unencrypted rows.
- The encryption key is locked with the user's password (PBKDF2, 600k rounds) and with a **recovery code** shown once at sign-up. Neither ever leaves the device.
- Forgot password → reset email → enter the recovery code. Lost both → the data can't be recovered by anyone; the user can only start over with an empty account.
- Signing out removes the data and key from that device.

What the project owner *can* still see: users' email addresses, how many rows each has, and when they were saved. Not the contents.
Users are trusting the code you deploy — only push changes you've reviewed.

## 1. Set up Supabase (cloud sync + login), about 5 minutes

1. Create a free project at <https://supabase.com> (region: Mumbai).
2. **SQL Editor → New query**, paste everything in [`supabase/schema.sql`](supabase/schema.sql), and click **Run**.
3. **Authentication → Sign In / Providers → Email**: turn **off** “Confirm email” to sign in right away. For a public app, turn it back **on** once custom SMTP is set up (step 8).
4. **Project Settings → API**: copy the **Project URL** and the **anon public** key into [`config.js`](config.js).
5. Open the app, tap **Create your account**, and sign up with your email + a password.
6. To let other people sign up, keep **“Allow new users to sign up”** on. To keep it private to you, turn it off.
7. **Authentication → URL Configuration**: set **Site URL** to your Netlify URL and add it under **Redirect URLs** (password-reset and confirmation links go there).
8. For other users, set up **custom SMTP** (**Authentication → Emails → SMTP Settings**, e.g. Resend or Brevo free tier). Supabase's built-in email only reaches your own team, so strangers wouldn't get reset or confirmation emails.

The anon key is safe to commit: Row Level Security means a login can only ever read or write its own rows, and the rows are encrypted anyway.
(If `config.js` is left empty, the app runs in “this device only” mode with data in the browser.)

## 2. Push to GitHub

```bash
git add -A
git commit -m "Invoice tracker PWA"
git branch -M main
git remote add origin https://github.com/<you>/invoice-tracker.git
git push -u origin main
```

## 3. Deploy on Netlify

**Add new site → Import an existing project → GitHub →** pick the repo.
Leave the build command empty and set the publish directory to `.` (both are already set in `netlify.toml`). Deploy.
Every `git push` redeploys automatically.

## 4. Install on your phone

Open the Netlify URL, then:
- **iPhone (Safari):** Share → **Add to Home Screen**
- **Android (Chrome):** ⋮ → **Install app** (or use the in-app Install button)

## 5. First run

Tap ⚙️ and fill in your business name, address, **state**, GSTIN, PAN and bank / UPI details. These print on every invoice.
Adjust default GST / TDS / advance %, invoice prefix (numbers run `INV/26-27/001` per FY), and your categories with SAC codes.

> SAC defaults: 999612 production/shoot, 999613 editing, 999615 colour, 999616 VFX, 999617 animation/motion. Confirm them with your CA.

## Updating the app

Edit files, then `git push`. The app fetches the latest files whenever it's online. If you change the list of files,
also bump `CACHE` in `sw.js` (e.g. `cit-v2`) so old offline caches are cleared.

## Local preview

```bash
python3 -m http.server 5173
```
Then open <http://localhost:5173>.

## Files

| Path | What it is |
|---|---|
| `index.html`, `manifest.webmanifest`, `sw.js`, `icons/` | PWA shell, install metadata, offline cache |
| `config.js` | Supabase URL + anon key |
| `js/app.js` | All screens, sheets and pipeline actions |
| `js/store.js` | Data layer: memory + localStorage mirror + encrypted Supabase sync with offline queue |
| `js/crypto.js` | End-to-end encryption: keys, recovery code, encrypt/decrypt |
| `js/calc.js` | GST/TDS maths, Indian FY, dates, invoice numbering, amount in words |
| `js/invoice.js` | GST invoice PDF (jsPDF) + share/download |
| `js/excel.js` | Excel (.xlsx) export: Jobs, Payments, FY Summary (SheetJS) |
| `supabase/schema.sql` | Tables, Row Level Security, "must be encrypted" checks |
| `netlify.toml` | Static deploy config + headers |
