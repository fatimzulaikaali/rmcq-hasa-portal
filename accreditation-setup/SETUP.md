# Accreditation module — Google Drive setup

You do these steps once, signed in as the **Gmail account** you use to collect evidence.
When done, the portal can create/reuse folders in that account's Drive.

## 1. Create the root folder

1. In that Gmail account's Google Drive, create a folder, e.g. **`MSQH Accreditation Evidence`**.
2. Open the folder. Look at the browser URL — it ends in `/folders/XXXXXXXX`.
3. Copy that `XXXXXXXX` part. This is your **root folder ID**.

## 2. Deploy the script

1. Go to **script.google.com** (same Gmail account) → **New project**.
2. Delete the default code, paste in everything from **`apps-script-Code.gs`**.
3. Change the line `const SECRET = 'REPLACE_WITH_A_LONG_RANDOM_STRING';`
   to a long random string of your choosing (e.g. 30+ random characters). Keep it private.
4. Click **Deploy → New deployment**.
   - Type: **Web app**
   - Execute as: **Me**
   - Who has access: **Anyone with the link**
   - **Deploy**
5. It will ask to authorise. You'll see an "unverified app" warning — that's normal because
   it's your own private script. Click **Advanced → Go to (project) → Allow**.
6. Copy the **Web app URL** it gives you (ends in `/exec`).

## 3. Test it (optional)

You can confirm it's alive by sending a `ping`. If you'd rather skip this, go to step 4.

## 4. Give the portal three values

Paste these into the portal's environment variables (Vercel → Project → Settings → Environment
Variables), or send them to me to add:

| Variable | Value |
|---|---|
| `ACC_DRIVE_WEBAPP_URL` | the Web app URL from step 2.6 |
| `ACC_DRIVE_SECRET` | the SECRET you set in step 2.3 |
| `ACC_DRIVE_ROOT_FOLDER_ID` | the root folder ID from step 1.3 |

## Notes

- The script only ever touches the root folder you created. It **never deletes** anything.
- It is **idempotent**: adding 2027 next year adds one `2027` subfolder to the existing
  evidence folder — it never creates a duplicate `24.1.1.1 (1)`.
- The SECRET is what stops anyone else from calling your web app, so keep it private.
- Everything runs as your Gmail account, using its own Drive storage.
