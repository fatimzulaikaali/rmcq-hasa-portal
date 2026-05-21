'use client'

export const dynamic = 'force-dynamic'

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { RiskRole, RiskDept, RiskUser } from '@/lib/risk/types'
import { RISK_ROLE_LABEL } from '@/lib/risk/scoring'
import { resolveCurrentRiskUser } from '@/lib/risk/auth'
import { resolveActiveRole } from '@/lib/risk/activeRole'
import { RiskAccountChip } from '@/components/RiskAccountChip'
import { RiskSidebar } from '@/components/RiskSidebar'

interface UserRow {
  user: RiskUser
  roles: { id: number; role: RiskRole; dept_code: string | null; is_active: boolean }[]
}

interface AddUserForm {
  name: string
  email: string
  role: RiskRole | ''
  dept_code: string  // 'all' = hospital-wide, else dept code
}

const EMPTY_ADD: AddUserForm = { name: '', email: '', role: '', dept_code: 'all' }

export default function RiskUsersPage() {
  const router = useRouter()
  const supabase = useMemo(() => createClient(), [])

  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [accessDenied, setAccessDenied] = useState(false)

  const [rows, setRows]   = useState<UserRow[]>([])
  const [depts, setDepts] = useState<RiskDept[]>([])
  const [currentUserId, setCurrentUserId] = useState<number | null>(null)

  const [add, setAdd] = useState<AddUserForm>(EMPTY_ADD)
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)

  // Inline edit state — only one row at a time
  const [editingId, setEditingId] = useState<number | null>(null)
  const [editName,  setEditName]  = useState('')
  const [editEmail, setEditEmail] = useState('')
  const [savingEdit, setSavingEdit] = useState(false)

  // Inline "add role" state — only one row at a time
  const [addRoleUserId, setAddRoleUserId] = useState<number | null>(null)
  const [newRole, setNewRole] = useState<RiskRole | ''>('')
  const [newRoleDept, setNewRoleDept] = useState('all')
  const [savingRole, setSavingRole] = useState(false)

  useEffect(() => { void load() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  async function load() {
    setLoading(true); setLoadError(null); setAccessDenied(false)
    try {
      const res = await resolveCurrentRiskUser(supabase)
      if (!res.ok) {
        if (res.reason === 'not_logged_in') { router.push('/login'); return }
        throw new Error(res.message)
      }
      // User management is an ADMIN-only screen, gated on the ACTIVE role.
      // (Switching to a non-admin role hides it, per active-role-controls-all.)
      const active = resolveActiveRole(res.user.roles)
      if (!active || active.role !== 'ADMIN') { setAccessDenied(true); return }
      setCurrentUserId(res.user.riskUserId)

      const [{ data: usersData, error: uErr }, { data: rolesData, error: rErr }, { data: deptsData, error: dErr }] = await Promise.all([
        supabase.from('risk_users').select('*').order('id'),
        supabase.from('risk_user_roles').select('id,user_id,role,dept_code,is_active').eq('is_active', true),
        supabase.from('pscs_departments')
          .select('code,risk_code,name_en,name_ms,kind,parent_code,sort_order')
          .not('risk_code', 'is', null)
          .eq('kind', 'department')
          .order('sort_order'),
      ])
      if (uErr) throw new Error(`Users: ${uErr.code ?? ''} ${uErr.message}`)
      if (rErr) throw new Error(`Roles: ${rErr.code ?? ''} ${rErr.message}`)
      if (dErr) throw new Error(`Departments: ${dErr.code ?? ''} ${dErr.message}`)

      const rolesByUser = new Map<number, UserRow['roles']>()
      for (const r of (rolesData ?? [])) {
        const arr = rolesByUser.get(r.user_id) ?? []
        arr.push({ id: r.id, role: r.role as RiskRole, dept_code: r.dept_code, is_active: r.is_active })
        rolesByUser.set(r.user_id, arr)
      }
      setRows(((usersData ?? []) as RiskUser[]).map((u) => ({
        user: u, roles: rolesByUser.get(u.id) ?? [],
      })))
      setDepts((deptsData ?? []) as RiskDept[])
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }

  async function signOut() {
    await supabase.auth.signOut()
    router.push('/login')
  }

  async function handleAddUser() {
    if (!add.name.trim() || !add.email.trim() || !add.role) {
      setSubmitError('Name, email, and an initial role are required.'); return
    }
    setSubmitting(true); setSubmitError(null)
    try {
      // 1) INSERT or UPDATE risk_users by email
      const { data: existing } = await supabase.from('risk_users')
        .select('id').eq('email', add.email.trim().toLowerCase()).maybeSingle()
      let userId: number
      if (existing) {
        userId = existing.id
        await supabase.from('risk_users')
          .update({ name: add.name.trim(), is_active: true })
          .eq('id', userId)
      } else {
        const { data: ins, error: insErr } = await supabase.from('risk_users')
          .insert({ name: add.name.trim(), email: add.email.trim().toLowerCase(), is_active: true })
          .select('id').single()
        if (insErr) throw new Error(`Insert user: ${insErr.code ?? ''} ${insErr.message}`)
        userId = ins.id as number
      }

      // 2) INSERT role
      await assignRole(userId, add.role, add.dept_code)

      setAdd(EMPTY_ADD)
      await load()
    } catch (e) {
      setSubmitError(e instanceof Error ? e.message : String(e))
    } finally {
      setSubmitting(false)
    }
  }

  /* Assign a role to a user. Handles the UNIQUE(user_id, dept_code, role)
   * conflict by re-activating a previously-removed role instead of erroring. */
  async function assignRole(userId: number, role: RiskRole, deptScope: string) {
    const dept_code = deptScope === 'all' ? null : deptScope
    const { error: roleErr } = await supabase.from('risk_user_roles').insert({
      user_id: userId, dept_code, role,
      assigned_by: currentUserId, is_active: true,
    })
    if (roleErr) {
      if (roleErr.code === '23505') {
        // Role row already exists (possibly inactive) — re-activate it.
        // Postgres NULL needs .is(); a real dept code needs .eq().
        let q = supabase.from('risk_user_roles')
          .update({ is_active: true })
          .eq('user_id', userId)
          .eq('role', role)
        q = dept_code === null ? q.is('dept_code', null) : q.eq('dept_code', dept_code)
        await q
      } else {
        throw new Error(`Insert role: ${roleErr.code ?? ''} ${roleErr.message}`)
      }
    }
  }

  function startAddRole(userId: number) {
    setAddRoleUserId(userId)
    setNewRole('')
    setNewRoleDept('all')
  }
  function cancelAddRole() {
    setAddRoleUserId(null); setNewRole(''); setNewRoleDept('all')
  }
  async function saveAddRole(userId: number) {
    if (!newRole) { alert('Pick a role to add.'); return }
    setSavingRole(true)
    try {
      await assignRole(userId, newRole, newRoleDept)
      cancelAddRole()
      await load()
    } catch (e) {
      alert(e instanceof Error ? e.message : String(e))
    } finally {
      setSavingRole(false)
    }
  }

  async function toggleActive(user: RiskUser) {
    if (user.id === currentUserId) {
      alert('You can\'t deactivate your own account from this page.'); return
    }
    const goalActive = !user.is_active
    const verb = goalActive ? 'reactivate' : 'deactivate'
    if (!window.confirm(`Are you sure you want to ${verb} ${user.name}?`)) return
    const { error } = await supabase.from('risk_users')
      .update({ is_active: goalActive }).eq('id', user.id)
    if (error) { alert(`Update failed: ${error.code} ${error.message}`); return }
    await load()
  }

  function startEdit(u: RiskUser) {
    setEditingId(u.id)
    setEditName(u.name)
    setEditEmail(u.email)
  }
  function cancelEdit() {
    setEditingId(null); setEditName(''); setEditEmail('')
  }
  async function saveEdit() {
    if (!editingId) return
    const name = editName.trim()
    const email = editEmail.trim().toLowerCase()
    if (!name || !email) { alert('Name and email are both required.'); return }
    setSavingEdit(true)
    try {
      const { error } = await supabase.from('risk_users')
        .update({ name, email }).eq('id', editingId)
      if (error) {
        // Email UNIQUE collision is the likely failure mode
        if (error.code === '23505') {
          alert(`Email "${email}" is already used by another user.`)
        } else {
          alert(`Update failed: ${error.code} ${error.message}`)
        }
        return
      }
      cancelEdit()
      await load()
    } finally {
      setSavingEdit(false)
    }
  }

  async function deactivateRole(roleId: number) {
    if (!window.confirm('Remove this role assignment? (The role row stays in the audit trail but is marked inactive.)')) return
    const { error } = await supabase.from('risk_user_roles')
      .update({ is_active: false }).eq('id', roleId)
    if (error) { alert(`Update failed: ${error.code} ${error.message}`); return }
    await load()
  }

  function deptLabel(code: string | null): string {
    if (code === null) return 'Hospital-wide'
    return depts.find((d) => d.code === code)?.name_en ?? code
  }

  return (
    <div className={`shell ${sidebarOpen ? 'sidebar-open' : ''}`}>
      <RiskSidebar onClose={() => setSidebarOpen(false)} active="risk" />

      <div className="main">
        <header className="topbar">
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <button type="button" className="hamburger" onClick={() => setSidebarOpen((v) => !v)}>☰</button>
            <div>
              <div className="tb-title">Risk Module Users</div>
              <div className="tb-meta">{accessDenied ? 'Access denied' : `${rows.length} user${rows.length === 1 ? '' : 's'} registered`}</div>
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <RiskAccountChip />
            <Link href="/risk" className="signout-btn">← Back to register</Link>
            <button type="button" className="signout-btn" onClick={signOut}>Sign out</button>
          </div>
        </header>

        <main className="tab-pane risk-skin">
          {loadError && (
            <div className="ac red"><div className="ai">⚠️</div>
              <div><div className="at">Load error</div><div className="as">{loadError}</div></div>
            </div>
          )}
          {loading && !loadError && !accessDenied && (
            <div className="ac blue"><div className="ai">⏳</div><div><div className="at">Loading…</div></div></div>
          )}
          {accessDenied && (
            <div className="panel" style={{ textAlign: 'center', padding: 32 }}>
              <div style={{ fontSize: 32, marginBottom: 8 }}>🔒</div>
              <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 4 }}>Admin access required</div>
              <div style={{ fontSize: 12, color: 'var(--muted)' }}>
                Only ADMIN, RC, or DIRECTOR roles can manage Risk module users.
              </div>
              <div style={{ marginTop: 14 }}>
                <Link href="/risk" className="signout-btn"
                  style={{ background: 'var(--blue)', color: '#fff', borderColor: 'var(--blue)' }}>← Back to register</Link>
              </div>
            </div>
          )}

          {!loading && !loadError && !accessDenied && (
            <>
              {/* Add user form */}
              <div className="panel">
                <div className="pf"><div>
                  <div className="pt">+ Add User</div>
                  <div className="psub">
                    Enter the staff member&apos;s name + email + initial role. They&apos;ll log in via the existing /login page (Supabase Auth);
                    their risk_users record auto-links to their auth account by email on first visit.
                  </div>
                </div></div>
                <div className="risk-form-grid">
                  <div className="risk-field">
                    <label>Full name<span style={{ color: 'var(--red)' }}> *</span></label>
                    <input type="text" value={add.name} placeholder="e.g. Dr. Aminah Binti Ahmad"
                      onChange={(e) => setAdd({ ...add, name: e.target.value })} />
                  </div>
                  <div className="risk-field">
                    <label>Email<span style={{ color: 'var(--red)' }}> *</span></label>
                    <input type="email" value={add.email} placeholder="aminah@hasa.uitm.edu.my"
                      onChange={(e) => setAdd({ ...add, email: e.target.value })} />
                  </div>
                  <div className="risk-field">
                    <label>Initial role<span style={{ color: 'var(--red)' }}> *</span></label>
                    <select value={add.role} onChange={(e) => setAdd({ ...add, role: e.target.value as RiskRole })}>
                      <option value="">— pick a role —</option>
                      {(Object.keys(RISK_ROLE_LABEL) as RiskRole[]).map((r) => (
                        <option key={r} value={r}>{r} — {RISK_ROLE_LABEL[r]}</option>
                      ))}
                    </select>
                  </div>
                  <div className="risk-field">
                    <label>Department scope</label>
                    <select value={add.dept_code} onChange={(e) => setAdd({ ...add, dept_code: e.target.value })}>
                      <option value="all">Hospital-wide (no dept restriction)</option>
                      {depts.map((d) => (
                        <option key={d.code} value={d.code}>{d.name_en}</option>
                      ))}
                    </select>
                  </div>
                </div>
                {submitError && (
                  <div className="ac red" style={{ marginTop: 10 }}>
                    <div className="ai">⚠️</div><div><div className="at">Save error</div><div className="as">{submitError}</div></div>
                  </div>
                )}
                <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 12 }}>
                  <button type="button" className="signout-btn"
                    style={{ background: submitting ? '#9CA3AF' : 'var(--blue)', color: '#fff', borderColor: submitting ? '#9CA3AF' : 'var(--blue)' }}
                    disabled={submitting} onClick={handleAddUser}>
                    {submitting ? 'Saving…' : '+ Add User'}
                  </button>
                </div>
              </div>

              {/* Users + roles table */}
              <div className="panel">
                <div className="pf"><div>
                  <div className="pt">All Risk Module Users</div>
                  <div className="psub">{rows.length} user{rows.length === 1 ? '' : 's'} · click a role pill to remove it, or &quot;+ role&quot; to add another</div>
                </div></div>
                <div style={{ overflowX: 'auto' }}>
                  <table className="risk-table">
                    <thead>
                      <tr>
                        <th>Name</th>
                        <th>Email</th>
                        <th>Roles &amp; Dept Scope</th>
                        <th style={{ textAlign: 'right' }}>Last login</th>
                        <th style={{ textAlign: 'center' }}>Status</th>
                        <th style={{ textAlign: 'right' }}>Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map(({ user, roles }) => {
                        const editing = editingId === user.id
                        return (
                          <tr key={user.id}>
                            <td style={{ fontWeight: 600 }}>
                              {editing ? (
                                <input
                                  type="text" value={editName}
                                  onChange={(e) => setEditName(e.target.value)}
                                  style={{ width: '100%', padding: '4px 6px', fontSize: 12, border: '1px solid var(--blue)', borderRadius: 4 }} />
                              ) : user.name}
                            </td>
                            <td style={{ fontSize: 11, color: 'var(--muted)' }}>
                              {editing ? (
                                <input
                                  type="email" value={editEmail}
                                  onChange={(e) => setEditEmail(e.target.value)}
                                  style={{ width: '100%', padding: '4px 6px', fontSize: 11, border: '1px solid var(--blue)', borderRadius: 4 }} />
                              ) : user.email}
                            </td>
                            <td>
                              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, alignItems: 'center' }}>
                                {roles.length === 0 && (
                                  <span style={{ color: 'var(--muted)', fontStyle: 'italic', fontSize: 11 }}>no roles</span>
                                )}
                                {roles.map((r) => (
                                  <button key={r.id} type="button" className="role-pill"
                                    onClick={() => deactivateRole(r.id)}
                                    title="Click to remove this role assignment">
                                    <b>{r.role}</b> · {deptLabel(r.dept_code)} ×
                                  </button>
                                ))}
                                {addRoleUserId !== user.id && (
                                  <button type="button" className="role-pill role-pill-add"
                                    onClick={() => startAddRole(user.id)}
                                    title="Add another role to this user">
                                    + role
                                  </button>
                                )}
                              </div>
                              {addRoleUserId === user.id && (
                                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center', marginTop: 8 }}>
                                  <select value={newRole}
                                    onChange={(e) => setNewRole(e.target.value as RiskRole)}
                                    style={{ fontSize: 11, padding: '4px 6px', border: '1px solid var(--blue)', borderRadius: 4 }}>
                                    <option value="">— role —</option>
                                    {(Object.keys(RISK_ROLE_LABEL) as RiskRole[]).map((r) => (
                                      <option key={r} value={r}>{r} — {RISK_ROLE_LABEL[r]}</option>
                                    ))}
                                  </select>
                                  <select value={newRoleDept}
                                    onChange={(e) => setNewRoleDept(e.target.value)}
                                    style={{ fontSize: 11, padding: '4px 6px', border: '1px solid var(--blue)', borderRadius: 4 }}>
                                    <option value="all">Hospital-wide</option>
                                    {depts.map((d) => (
                                      <option key={d.code} value={d.code}>{d.name_en}</option>
                                    ))}
                                  </select>
                                  <button type="button" className="signout-btn"
                                    style={{ fontSize: 11, padding: '4px 10px', background: 'var(--blue)', color: '#fff', borderColor: 'var(--blue)' }}
                                    disabled={savingRole}
                                    onClick={() => saveAddRole(user.id)}>
                                    {savingRole ? 'Adding…' : 'Add'}
                                  </button>
                                  <button type="button" className="signout-btn"
                                    style={{ fontSize: 11, padding: '4px 10px' }}
                                    disabled={savingRole}
                                    onClick={cancelAddRole}>
                                    Cancel
                                  </button>
                                </div>
                              )}
                            </td>
                            <td style={{ textAlign: 'right', fontSize: 11, color: 'var(--muted)' }}>
                              {user.last_login ? user.last_login.slice(0, 10) : '—'}
                            </td>
                            <td style={{ textAlign: 'center' }}>
                              <span style={{
                                display: 'inline-block', padding: '2px 8px', borderRadius: 4,
                                fontSize: 10, fontWeight: 700,
                                color: user.is_active ? '#166534' : '#991B1B',
                                background: user.is_active ? '#DCFCE7' : '#FEE2E2',
                              }}>{user.is_active ? 'ACTIVE' : 'INACTIVE'}</span>
                            </td>
                            <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                              {editing ? (
                                <>
                                  <button type="button" className="signout-btn"
                                    style={{ fontSize: 11, padding: '4px 10px', background: 'var(--blue)', color: '#fff', borderColor: 'var(--blue)' }}
                                    disabled={savingEdit}
                                    onClick={saveEdit}>
                                    {savingEdit ? 'Saving…' : 'Save'}
                                  </button>{' '}
                                  <button type="button" className="signout-btn"
                                    style={{ fontSize: 11, padding: '4px 10px' }}
                                    disabled={savingEdit}
                                    onClick={cancelEdit}>
                                    Cancel
                                  </button>
                                </>
                              ) : (
                                <>
                                  <button type="button" className="signout-btn"
                                    style={{ fontSize: 11, padding: '4px 10px' }}
                                    onClick={() => startEdit(user)}>
                                    Edit
                                  </button>{' '}
                                  <button type="button" className="signout-btn"
                                    style={{ fontSize: 11, padding: '4px 10px' }}
                                    onClick={() => toggleActive(user)}>
                                    {user.is_active ? 'Deactivate' : 'Reactivate'}
                                  </button>
                                </>
                              )}
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              </div>

              <div style={{ marginTop: 8, fontSize: 10, color: 'var(--muted)' }}>
                Phase 3.6 — user management. New users must also have a Supabase Auth account (created via the existing /login signup or by an Anthropic admin) for their email match to take effect.
              </div>
            </>
          )}
        </main>
      </div>
    </div>
  )
}
