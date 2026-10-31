# Google Sheets background sync

Every entry you add, edit or delete in the app is copied to a Google Sheet within a few seconds. Nothing on your phone is involved: Supabase sends each change to a small Google Apps Script that writes the sheet. It keeps working when you save offline, because the change syncs once the phone reconnects.

```
App ──saves──▶ Supabase `entries` ──trigger (pg_net)──▶ Apps Script web app ──▶ Google Sheet
```

The sheet has three tabs, rebuilt on every change:
- **Jobs:** one row per entry. Includes a live **Days left** column (red when overdue, amber in the last 7 days).
- **Payments:** every advance and payment.
- **FY Summary:** received, invoiced, GST, TDS, vendor costs and margin per financial year.

A hidden `_data` tab holds the raw records.

> The sheet is a **mirror**. Changes typed into Jobs, Payments or FY Summary are overwritten on the next sync. For your own notes or formulas, add separate tabs; those are never touched.

## Setup (about 10 minutes)

### 1. Create the sheet and paste the script
1. Go to <https://sheets.new> and name the sheet, e.g. **Invoice Tracker**.
2. **Extensions → Apps Script**. Delete what's there and paste the whole of [`google-sheets/Code.gs`](../google-sheets/Code.gs). Save (💾).

### 2. Set a secret
1. In Apps Script: **⚙️ Project Settings → Script properties → Add script property**.
2. Property `SECRET`. For the value, use a long random string (e.g. 40 random letters/digits). Save.

### 3. Deploy as a web app
1. **Deploy → New deployment →** ⚙️ next to "Select type" **→ Web app**.
2. **Execute as:** Me. **Who has access:** Anyone.
3. **Deploy**, then **Authorize access** and allow it. Google shows an "unverified app" warning because it's your own script: **Advanced → Go to … (unsafe)**.
4. Copy the **Web app URL** (ends in `/exec`).

"Anyone" only means the URL can be called. Every request without your secret is rejected, and the script can only touch this one sheet.

### 4. Connect Supabase
1. Supabase → **SQL Editor → New query**, paste [`supabase/google-sheets-sync.sql`](../supabase/google-sheets-sync.sql), and **Run**.
2. In a new query, run this with **your** URL and secret:
   ```sql
   insert into private.sheets_config (id, url, secret)
   values (1, 'https://script.google.com/macros/s/XXXXXXXX/exec', 'your-long-random-secret')
   on conflict (id) do update set url = excluded.url, secret = excluded.secret, enabled = true;
   ```
3. Copy everything already in the app into the sheet:
   ```sql
   select private.sheets_resync();
   ```
   The sheet fills in within a few seconds.

### 5. Add the link in the app
Copy the Google Sheet's URL from your browser. In the app, go to **⚙️ Settings → Data → Google Sheet link**, paste it, and save. A **Google Sheet** button appears on the Done tab.

## Day to day
- **Check deliveries:** `select status_code, created, error_msg from net._http_response order by created desc limit 10;` A status of 302 or 200 means delivered. Apps Script always answers with a redirect.
- **Rebuild everything:** `select private.sheets_resync();`
- **Pause:** `update private.sheets_config set enabled = false;` (set `true` to resume, then resync).
- **Changed the script?** In Apps Script choose **Deploy → Manage deployments → ✏️ → Version: New version → Deploy**. The URL stays the same.
- **Excel file:** in Google Sheets, **File → Download → Microsoft Excel (.xlsx)**. Or use the **Excel** button on the Done tab.
