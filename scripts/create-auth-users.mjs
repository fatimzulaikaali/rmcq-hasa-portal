/**
 * One-off: create Supabase Auth login accounts for everyone already provisioned
 * in the risk_users table, with a temporary password each. No email/SMTP needed.
 *
 * It is SAFE to re-run: people who already have an Auth account are skipped.
 *
 * Run from the repo root:
 *   SUPABASE_URL="https://YOURPROJECT.supabase.co" \
 *   SUPABASE_SERVICE_ROLE_KEY="eyJ...the service_role secret..." \
 *   node scripts/create-auth-users.mjs
 *
 *   - SUPABASE_URL: same value as NEXT_PUBLIC_SUPABASE_URL (in .env.local)
 *   - SUPABASE_SERVICE_ROLE_KEY: Supabase dashboard → Project Settings → API →
 *     "service_role" secret. KEEP IT SECRET — do not commit or share it.
 *
 * Optional: SHARED_PASSWORD="ChangeMe-2026" to give everyone the SAME temp
 * password instead of a unique random one (easier to announce, less secure).
 *
 * Output: writes risk-user-logins.csv (email, name, password, status) in the
 * folder you run it from. Hand each person their row; they sign in with email +
 * password on the /login page. Delete the CSV once distributed.
 */
import { createClient } from '@supabase/supabase-js'
import { writeFileSync } from 'node:fs'
import { randomBytes } from 'node:crypto'

const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL
const key = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!url || !key) {
  console.error('Missing env. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.')
  process.exit(1)
}

const sharedPassword = process.env.SHARED_PASSWORD || null
const supabase = createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } })

// Readable random password (no ambiguous chars like 0/O/1/l/I), plus a digit+symbol.
function genPassword() {
  const set = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789'
  const buf = randomBytes(16)
  let p = ''
  for (let i = 0; i < 9; i++) p += set[buf[i] % set.length]
  return `${p}#${(buf[9] % 9) + 1}` // ends with #<1-9>
}

const { data: users, error } = await supabase
  .from('risk_users')
  .select('id,name,email,is_active')
  .eq('is_active', true)
  .order('id')

if (error) {
  console.error('Could not read risk_users:', error.message)
  process.exit(1)
}

const rows = [['email', 'name', 'password', 'status']]
let created = 0, skipped = 0, failed = 0

for (const u of users) {
  const email = (u.email || '').trim().toLowerCase()
  if (!email) continue
  const password = sharedPassword || genPassword()

  const { error: e } = await supabase.auth.admin.createUser({
    email,
    password,
    email_confirm: true,                 // mark confirmed — no confirmation email needed
    user_metadata: { name: u.name },
  })

  if (e) {
    const msg = (e.message || '').toLowerCase()
    if (e.status === 422 || msg.includes('already') || msg.includes('registered')) {
      rows.push([email, u.name, '', 'already exists — skipped'])
      skipped++
    } else {
      rows.push([email, u.name, '', `ERROR: ${e.message}`])
      failed++
      console.error(`✗ ${email}: ${e.message}`)
    }
    continue
  }

  rows.push([email, u.name, password, 'created'])
  created++
  console.log(`✓ ${email}`)
}

const csv = rows
  .map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(','))
  .join('\n')
writeFileSync('risk-user-logins.csv', csv)

console.log(`\nDone — created=${created}, skipped=${skipped}, failed=${failed}.`)
console.log('Wrote risk-user-logins.csv (email, name, password, status). Distribute, then delete it.')
