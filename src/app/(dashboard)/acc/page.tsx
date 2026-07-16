'use client'

export const dynamic = 'force-dynamic'

import { useEffect, useMemo, useState, useCallback, useRef } from 'react'
import type { ChangeEvent } from 'react'
import { PortalNav } from '@/components/PortalNav'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { getModuleAccess } from '@/lib/risk/auth'
import type {
  AccService, AccTopic, AccSubStandard, AccCriterion, AccEvidenceItem, AccFolder, AccDriveFile, AccEvidenceLink,
} from '@/lib/acc/types'
import {
  fillService, evidenceKey, drivePreviewUrl, defaultYears,
} from '@/lib/acc/helpers'

type Filter = 'all' | 'core' | 'new'

/* Compare dotted criterion codes numerically (e.g. "24.2.1.1" < "24.2.2.1"),
 * so the list reads in natural order regardless of stored sort_order. */
function compareCode(a: string, b: string) {
  const pa = a.split('.').map((n) => parseInt(n, 10) || 0)
  const pb = b.split('.').map((n) => parseInt(n, 10) || 0)
  const len = Math.max(pa.length, pb.length)
  for (let i = 0; i < len; i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0)
    if (d !== 0) return d
  }
  return 0
}

export default function AccreditationPage() {
  const router = useRouter()
  const supabase = useMemo(() => createClient(), [])

  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [sidebarOpen, setSidebarOpen] = useState(false)

  async function signOut() {
    await supabase.auth.signOut()
    router.replace('/login')
  }

  const [service, setService] = useState<AccService | null>(null)
  const [topics, setTopics] = useState<AccTopic[]>([])
  const [subs, setSubs] = useState<AccSubStandard[]>([])
  const [criteria, setCriteria] = useState<AccCriterion[]>([])
  const [evidence, setEvidence] = useState<AccEvidenceItem[]>([])
  const [folders, setFolders] = useState<AccFolder[]>([])
  const [links, setLinks] = useState<AccEvidenceLink[]>([])

  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState<Filter>('all')

  const loadFolders = useCallback(async () => {
    const { data } = await supabase.from('acc_folders').select('*')
    setFolders((data ?? []) as AccFolder[])
  }, [supabase])

  const loadLinks = useCallback(async () => {
    const { data } = await supabase.from('acc_evidence_links').select('*').order('created_at')
    setLinks((data ?? []) as AccEvidenceLink[])
  }, [supabase])

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const access = await getModuleAccess(supabase)
        if (!access.allModules) { router.replace('/risk'); return }

        const [svc, tp, sb, cr, ev, fl, lk] = await Promise.all([
          supabase.from('acc_services').select('*').limit(1).maybeSingle(),
          supabase.from('acc_topics').select('*').order('sort_order'),
          supabase.from('acc_sub_standards').select('*').order('sort_order'),
          supabase.from('acc_criteria').select('*').order('sort_order'),
          supabase.from('acc_evidence_items').select('*').order('item_number'),
          supabase.from('acc_folders').select('*'),
          supabase.from('acc_evidence_links').select('*').order('created_at'),
        ])
        if (cancelled) return
        setService((svc.data ?? null) as AccService | null)
        setTopics((tp.data ?? []) as AccTopic[])
        setSubs((sb.data ?? []) as AccSubStandard[])
        setCriteria((cr.data ?? []) as AccCriterion[])
        setEvidence((ev.data ?? []) as AccEvidenceItem[])
        setFolders((fl.data ?? []) as AccFolder[])
        setLinks((lk.data ?? []) as AccEvidenceLink[])
        // Default selection is set from the grouped (display-ordered) list below,
        // so the page always opens on the first criterion shown (24.1.1.1).
      } catch (e) {
        if (!cancelled) setLoadError(e instanceof Error ? e.message : 'Failed to load accreditation data')
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [supabase, router])

  // --- derived lookups ---
  const subById = useMemo(() => new Map(subs.map((s) => [s.id, s])), [subs])
  const topicById = useMemo(() => new Map(topics.map((t) => [t.id, t])), [topics])
  const evByCriterion = useMemo(() => {
    const m = new Map<string, AccEvidenceItem[]>()
    for (const e of evidence) {
      if (!m.has(e.criterion_id)) m.set(e.criterion_id, [])
      m.get(e.criterion_id)!.push(e)
    }
    return m
  }, [evidence])

  // evidence item id -> synced year folders + parent folder
  const foldersByItem = useMemo(() => {
    const m = new Map<string, AccFolder[]>()
    for (const f of folders) {
      if (!m.has(f.evidence_item_id)) m.set(f.evidence_item_id, [])
      m.get(f.evidence_item_id)!.push(f)
    }
    return m
  }, [folders])

  // evidence item id -> reference links
  const linksByItem = useMemo(() => {
    const m = new Map<string, AccEvidenceLink[]>()
    for (const l of links) {
      if (!m.has(l.evidence_item_id)) m.set(l.evidence_item_id, [])
      m.get(l.evidence_item_id)!.push(l)
    }
    return m
  }, [links])

  // Which criteria have at least one synced folder (progress)
  const syncedCriteria = useMemo(() => {
    const evToCrit = new Map(evidence.map((e) => [e.id, e.criterion_id]))
    const set = new Set<string>()
    for (const f of folders) {
      const c = evToCrit.get(f.evidence_item_id)
      if (c) set.add(c)
    }
    return set
  }, [folders, evidence])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return criteria.filter((c) => {
      if (filter === 'core' && !c.is_core) return false
      if (filter === 'new' && !c.is_new) return false
      if (!q) return true
      return c.code.toLowerCase().includes(q) || c.statement.toLowerCase().includes(q)
    })
  }, [criteria, search, filter])

  // group filtered criteria by topic for the sidebar
  const grouped = useMemo(() => {
    const byTopic = new Map<string, AccCriterion[]>()
    for (const c of filtered) {
      if (!byTopic.has(c.topic_id)) byTopic.set(c.topic_id, [])
      byTopic.get(c.topic_id)!.push(c)
    }
    return topics
      .map((t) => ({
        topic: t,
        items: (byTopic.get(t.id) ?? []).slice().sort((x, y) => compareCode(x.code, y.code)),
      }))
      .filter((g) => g.items.length > 0)
  }, [filtered, topics])

  // Open on the first criterion in display order once data has loaded.
  useEffect(() => {
    if (selectedId == null && grouped.length > 0) {
      setSelectedId(grouped[0].items[0]?.id ?? null)
    }
  }, [grouped, selectedId])

  const selected = useMemo(
    () => criteria.find((c) => c.id === selectedId) ?? null,
    [criteria, selectedId],
  )

  if (loading) {
    return (
      <div className="shell">
        <AccSidebar />
        <div className="main">
          <header className="topbar">
            <div>
              <div className="tb-title">Accreditation — MSQH Standard 24</div>
              <div className="tb-meta">Hospital Al-Sultan Abdullah UiTM</div>
            </div>
          </header>
          <div className="loader"><div className="loader-inner"><div className="spin" /><div>Loading standard…</div></div></div>
        </div>
      </div>
    )
  }

  const total = criteria.length
  const done = syncedCriteria.size
  const pct = total ? Math.round((done / total) * 100) : 0

  return (
    <div className={`shell ${sidebarOpen ? 'sidebar-open' : ''}`}>
      <AccSidebar onClose={() => setSidebarOpen(false)} />

      <div className="main">
        <header className="topbar">
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <button
              type="button"
              className="hamburger"
              aria-label="Toggle navigation"
              onClick={() => setSidebarOpen((v) => !v)}
            >☰</button>
            <div>
              <div className="tb-title">Accreditation — MSQH Standard 24</div>
              <div className="tb-meta">
                {service ? service.name : 'Standards for General Application'}
              </div>
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <div className="rec-badge">
              {done} / {total} criteria started · {pct}%
            </div>
            <button type="button" className="signout-btn" onClick={signOut}>Sign out</button>
          </div>
        </header>

        {loadError && (
          <div className="m-4 rounded-md border border-[var(--red)] bg-[var(--red-lt)] px-4 py-3 text-sm text-[var(--red)]">
            {loadError}
          </div>
        )}

        <div className="flex min-h-0 flex-1">
        {/* Criteria browser */}
        <div className="w-[340px] shrink-0 overflow-y-auto border-r border-[var(--border)] bg-[var(--surface)]">
          <div className="sticky top-0 z-10 space-y-2 border-b border-[var(--border)] bg-[var(--surface)] p-3">
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search criteria or text…"
              className="w-full rounded-md border border-[var(--border)] bg-[var(--bg)] px-3 py-2 text-xs outline-none focus:border-[var(--blue)]"
            />
            <div className="flex gap-1">
              {(['all', 'core', 'new'] as Filter[]).map((f) => (
                <button
                  key={f}
                  onClick={() => setFilter(f)}
                  className={`rounded-md px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide transition-colors ${
                    filter === f
                      ? 'bg-[var(--blue)] text-white'
                      : 'bg-[var(--bg)] text-[var(--muted)] hover:text-[var(--text)]'
                  }`}
                >
                  {f}
                </button>
              ))}
            </div>
          </div>

          {grouped.map((g) => (
            <div key={g.topic.id} className="py-1">
              <div className="px-3 py-1.5 text-[10px] font-bold uppercase tracking-widest text-[var(--muted)]">
                {g.topic.code} · {g.topic.title}
              </div>
              {g.items.map((c) => {
                const active = c.id === selectedId
                const started = syncedCriteria.has(c.id)
                return (
                  <button
                    key={c.id}
                    onClick={() => setSelectedId(c.id)}
                    className={`flex w-full items-center gap-2 px-3 py-2 text-left text-xs transition-colors ${
                      active ? 'bg-[var(--blue-lt)] text-[var(--blue)]' : 'hover:bg-[var(--bg)]'
                    }`}
                  >
                    <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${started ? 'bg-[var(--green)]' : 'bg-[var(--border)]'}`} />
                    <span className="font-mono font-semibold">{c.code}</span>
                    {c.is_core && <Badge tone="red">CORE</Badge>}
                    {c.is_new && <Badge tone="teal">NEW</Badge>}
                  </button>
                )
              })}
            </div>
          ))}
        </div>

        {/* Detail */}
        <div className="min-w-0 flex-1 overflow-y-auto p-5">
          {selected ? (
            <CriterionDetail
              criterion={selected}
              sub={selected.sub_standard_id ? subById.get(selected.sub_standard_id) ?? null : null}
              topic={topicById.get(selected.topic_id) ?? null}
              service={service}
              evidenceItems={evByCriterion.get(selected.id) ?? []}
              foldersByItem={foldersByItem}
              linksByItem={linksByItem}
              onSynced={loadFolders}
              onLinksChanged={loadLinks}
            />
          ) : (
            <div className="text-sm text-[var(--muted)]">Select a criterion.</div>
          )}
        </div>
        </div>
      </div>
    </div>
  )
}

/* Dark sidebar shared with the rest of the portal (IR / KPI / Safety Culture /
 * Risk). Accreditation is a hospital-wide (global-role) module, so the Portal
 * links here always show the full set with Accreditation marked active. */
function AccSidebar({ onClose }: { onClose?: () => void }) {
  return (
    <>
      <div className="scrim" onClick={onClose} />
      <aside className="sidebar">
        <PortalNav active="acc" />
      </aside>
    </>
  )
}

function Badge({ tone, children }: { tone: 'red' | 'teal' | 'blue' | 'gray'; children: React.ReactNode }) {
  const map: Record<string, string> = {
    red: 'bg-[var(--red-lt)] text-[var(--red)]',
    teal: 'bg-[var(--teal-lt)] text-[var(--teal)]',
    blue: 'bg-[var(--blue-lt)] text-[var(--blue)]',
    gray: 'bg-[var(--bg)] text-[var(--muted)]',
  }
  return (
    <span className={`rounded px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide ${map[tone]}`}>
      {children}
    </span>
  )
}

/* ---------------- Criterion detail ---------------- */

function CriterionDetail({
  criterion, sub, topic, service, evidenceItems, foldersByItem, linksByItem, onSynced, onLinksChanged,
}: {
  criterion: AccCriterion
  sub: AccSubStandard | null
  topic: AccTopic | null
  service: AccService | null
  evidenceItems: AccEvidenceItem[]
  foldersByItem: Map<string, AccFolder[]>
  linksByItem: Map<string, AccEvidenceLink[]>
  onSynced: () => Promise<void>
  onLinksChanged: () => Promise<void>
}) {
  const [syncing, setSyncing] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  // years the user wants to add, per evidence item
  const [addYears, setAddYears] = useState<Record<string, Set<number>>>({})
  const [viewer, setViewer] = useState<{ evidenceItemId: string; key: string } | null>(null)

  // reset transient state when criterion changes
  useEffect(() => { setAddYears({}); setMsg(null); setViewer(null) }, [criterion.id])

  const statement = fillService(criterion.statement, service?.service_name)

  const toggleAddYear = (evId: string, year: number) => {
    setAddYears((prev) => {
      const next = { ...prev }
      const s = new Set(next[evId] ?? [])
      if (s.has(year)) s.delete(year)
      else s.add(year)
      next[evId] = s
      return next
    })
  }

  const sync = async () => {
    setSyncing(true); setMsg(null)
    try {
      const items = evidenceItems.map((e) => ({
        evidenceItemId: e.id,
        years: Array.from(addYears[e.id] ?? []),
      }))
      const res = await fetch('/api/acc/sync-folders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items }),
      })
      const data = await res.json()
      if (!data.ok) {
        setMsg(data.message || `Sync failed (${data.error ?? 'unknown'})`)
      } else {
        setMsg('Folders created / updated in Drive.')
        setAddYears({})
        await onSynced()
      }
    } catch (e) {
      setMsg(e instanceof Error ? e.message : 'Sync failed')
    } finally {
      setSyncing(false)
    }
  }

  const [extraYears, setExtraYears] = useState<number[]>([])
  const yearChoices = useMemo(() => {
    const base = [...defaultYears(), new Date().getFullYear() + 1]
    return Array.from(new Set([...base, ...extraYears])).sort((a, b) => a - b)
  }, [extraYears])
  const addNextYear = () => {
    setExtraYears((prev) => {
      const max = Math.max(...yearChoices, ...prev)
      return [...prev, max + 1]
    })
  }

  return (
    <div>
      <div className="mb-1 text-[11px] font-semibold uppercase tracking-widest text-[var(--muted)]">
        {topic ? `${topic.code} · ${topic.title}` : ''}
      </div>
      <div className="mb-3 flex items-center gap-2">
        <span className="font-mono text-lg font-bold text-[var(--text)]">{criterion.code}</span>
        {criterion.is_core && <Badge tone="red">CORE</Badge>}
        {criterion.is_new && <Badge tone="teal">NEW</Badge>}
        {criterion.has_service_variable && <Badge tone="blue">SERVICE-SPECIFIC</Badge>}
      </div>

      {sub?.statement && (
        <div className="mb-3 rounded-md border-l-2 border-[var(--border)] bg-[var(--bg)] px-3 py-2 text-xs italic text-[var(--muted)]">
          <span className="font-mono not-italic">{sub.code}</span> — {sub.statement}
        </div>
      )}

      <div className="panel">
        <div className="pt">Criterion (verbatim)</div>
        <p className="mt-1 whitespace-pre-line text-[13px] leading-relaxed text-[var(--text)]">{statement}</p>
        {criterion.has_service_variable && service?.service_name && (
          <div className="mt-2 text-[11px] text-[var(--muted)]">
            Service name inserted: <span className="font-semibold text-[var(--text)]">{service.service_name}</span>
          </div>
        )}
      </div>

      <div className="mb-2 mt-4 flex items-center justify-between">
        <div className="pt">Evidence of compliance ({evidenceItems.length})</div>
        <div className="flex items-center gap-2">
          <button
            onClick={addNextYear}
            className="rounded-md border border-dashed border-[var(--border)] px-2.5 py-1.5 text-xs font-semibold text-[var(--muted)] hover:text-[var(--text)]"
            title="Offer another year to create"
          >
            ＋ Add year
          </button>
          <button
            onClick={sync}
            disabled={syncing}
            className="rounded-md bg-[var(--blue)] px-3 py-1.5 text-xs font-semibold text-white hover:opacity-90 disabled:opacity-50"
          >
            {syncing ? 'Syncing…' : 'Create / update Drive folders'}
          </button>
        </div>
      </div>
      {msg && <div className="mb-2 text-xs text-[var(--muted)]">{msg}</div>}

      <div className="space-y-3">
        {evidenceItems.map((e) => {
          const key = evidenceKey(criterion.code, e.item_number)
          const itemFolders = foldersByItem.get(e.id) ?? []
          const parent = itemFolders.find((f) => f.folder_type === 'evidence')
          const yearFolders = itemFolders
            .filter((f) => f.folder_type === 'year' && f.year != null)
            .sort((a, b) => (a.year ?? 0) - (b.year ?? 0))
          const existingYears = new Set(yearFolders.map((f) => f.year as number))
          const toAdd = addYears[e.id] ?? new Set<number>()

          return (
            <div key={e.id} className="dc-card">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="font-mono text-xs font-bold text-[var(--blue)]">{key}</div>
                  <p className="mt-1 text-[13px] leading-relaxed text-[var(--text)]">{e.text}</p>
                </div>
                {parent && (
                  <button
                    onClick={() => setViewer({ evidenceItemId: e.id, key })}
                    className="shrink-0 rounded-md border border-[var(--border)] px-2.5 py-1 text-[11px] font-semibold text-[var(--blue)] hover:bg-[var(--blue-lt)]"
                  >
                    View evidence
                  </button>
                )}
              </div>

              {/* year chips */}
              <div className="mt-2 flex flex-wrap items-center gap-1.5">
                {yearFolders.map((f) => (
                  <a
                    key={f.id}
                    href={f.drive_url ?? '#'}
                    target="_blank"
                    rel="noreferrer"
                    className="rounded-full bg-[var(--green-lt)] px-2.5 py-0.5 text-[11px] font-semibold text-[var(--green)]"
                    title="Open folder in Drive"
                  >
                    {f.year} ✓
                  </a>
                ))}
                {yearChoices
                  .filter((y) => !existingYears.has(y))
                  .map((y) => (
                    <button
                      key={y}
                      onClick={() => toggleAddYear(e.id, y)}
                      className={`rounded-full px-2.5 py-0.5 text-[11px] font-semibold transition-colors ${
                        toAdd.has(y)
                          ? 'bg-[var(--blue)] text-white'
                          : 'border border-dashed border-[var(--border)] text-[var(--muted)] hover:text-[var(--text)]'
                      }`}
                    >
                      + {y}
                    </button>
                  ))}
                {!parent && toAdd.size === 0 && (
                  <span className="text-[11px] text-[var(--muted)]">
                    Folder not created yet — pick years, or just sync to create “{key}”.
                  </span>
                )}
              </div>

              <EvidenceLinks
                evidenceItemId={e.id}
                links={linksByItem.get(e.id) ?? []}
                onChanged={onLinksChanged}
              />
            </div>
          )
        })}
      </div>

      {viewer && (
        <EvidenceViewer
          evidenceKey={viewer.key}
          yearFolders={(foldersByItem.get(viewer.evidenceItemId) ?? [])
            .filter((f) => f.folder_type === 'year' && f.year != null)
            .sort((a, b) => (a.year ?? 0) - (b.year ?? 0))}
          parentFolder={(foldersByItem.get(viewer.evidenceItemId) ?? []).find((f) => f.folder_type === 'evidence') ?? null}
          onClose={() => setViewer(null)}
        />
      )}
    </div>
  )
}

/* ---------------- Reference links for an evidence item ---------------- */

/* Points to the *source* of the evidence — e.g. the department's full
 * minutes-of-meeting folder — when only the latest few files are uploaded
 * into the evidence folder. Stored in acc_evidence_links (portal only). */
function EvidenceLinks({
  evidenceItemId, links, onChanged,
}: {
  evidenceItemId: string
  links: AccEvidenceLink[]
  onChanged: () => Promise<void>
}) {
  const supabase = useMemo(() => createClient(), [])
  const [adding, setAdding] = useState(false)
  const [label, setLabel] = useState('')
  const [url, setUrl] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const reset = () => { setAdding(false); setLabel(''); setUrl(''); setErr(null) }

  const save = async () => {
    const l = label.trim()
    const u = url.trim()
    if (!l) { setErr('Give the link a name.'); return }
    if (!/^https?:\/\//i.test(u)) { setErr('Enter a full URL starting with http:// or https://'); return }
    setBusy(true); setErr(null)
    try {
      const { error } = await supabase.from('acc_evidence_links')
        .insert({ evidence_item_id: evidenceItemId, label: l, url: u })
      if (error) { setErr(error.message); return }
      reset()
      await onChanged()
    } finally {
      setBusy(false)
    }
  }

  const remove = async (id: string) => {
    setBusy(true)
    try {
      await supabase.from('acc_evidence_links').delete().eq('id', id)
      await onChanged()
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="mt-2 border-t border-[var(--border)] pt-2">
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="text-[10px] font-bold uppercase tracking-wide text-[var(--muted)]">🔗 Source links</span>
        {links.length === 0 && !adding && (
          <span className="text-[11px] text-[var(--muted)]">none yet</span>
        )}
        {links.map((l) => (
          <span
            key={l.id}
            className="inline-flex items-center gap-1 rounded-full bg-[var(--blue-lt)] px-2.5 py-0.5 text-[11px] font-semibold text-[var(--blue)]"
          >
            <a href={l.url} target="_blank" rel="noreferrer" title={l.url} className="hover:underline">
              {l.label} ↗
            </a>
            <button
              onClick={() => remove(l.id)}
              disabled={busy}
              className="text-[var(--blue)] opacity-60 hover:opacity-100 disabled:opacity-30"
              title="Remove link"
            >
              ✕
            </button>
          </span>
        ))}
        {!adding && (
          <button
            onClick={() => setAdding(true)}
            className="rounded-full border border-dashed border-[var(--border)] px-2.5 py-0.5 text-[11px] font-semibold text-[var(--muted)] hover:text-[var(--text)]"
          >
            + Add link
          </button>
        )}
      </div>

      {adding && (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <input
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="Name (e.g. Full minutes — ORL dept folder)"
            className="min-w-[220px] flex-1 rounded-md border border-[var(--border)] bg-[var(--bg)] px-2.5 py-1.5 text-xs outline-none focus:border-[var(--blue)]"
          />
          <input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://drive.google.com/…"
            className="min-w-[220px] flex-1 rounded-md border border-[var(--border)] bg-[var(--bg)] px-2.5 py-1.5 text-xs outline-none focus:border-[var(--blue)]"
          />
          <button
            onClick={save}
            disabled={busy}
            className="rounded-md bg-[var(--blue)] px-3 py-1.5 text-xs font-semibold text-white hover:opacity-90 disabled:opacity-50"
          >
            {busy ? 'Saving…' : 'Save'}
          </button>
          <button
            onClick={reset}
            disabled={busy}
            className="rounded-md px-2.5 py-1.5 text-xs font-semibold text-[var(--muted)] hover:text-[var(--text)]"
          >
            Cancel
          </button>
        </div>
      )}
      {err && <div className="mt-1 text-[11px] text-[var(--red)]">{err}</div>}
    </div>
  )
}

/* ---------------- In-portal evidence viewer ---------------- */

function EvidenceViewer({
  evidenceKey, yearFolders, parentFolder, onClose,
}: {
  evidenceKey: string
  yearFolders: AccFolder[]
  parentFolder: AccFolder | null
  onClose: () => void
}) {
  const firstFolder = yearFolders[0] ?? parentFolder
  const [activeFolderId, setActiveFolderId] = useState<string | null>(firstFolder?.drive_folder_id ?? null)
  const [files, setFiles] = useState<AccDriveFile[] | null>(null)
  const [filesError, setFilesError] = useState<string | null>(null)
  const [previewId, setPreviewId] = useState<string | null>(null)
  const [loadingFiles, setLoadingFiles] = useState(false)

  const loadFiles = useCallback(async (folderId: string) => {
    setLoadingFiles(true); setFiles(null); setFilesError(null); setPreviewId(null)
    try {
      const res = await fetch('/api/acc/list-files', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ folderId }),
      })
      const data = await res.json()
      if (!data.ok) { setFilesError(data.message || 'Could not list files.'); return }
      const fs = (data.files ?? []) as AccDriveFile[]
      setFiles(fs)
      if (fs.length > 0) setPreviewId(fs[0].id)
    } catch (e) {
      setFilesError(e instanceof Error ? e.message : 'Could not list files.')
    } finally {
      setLoadingFiles(false)
    }
  }, [])

  useEffect(() => {
    if (activeFolderId) void loadFiles(activeFolderId)
  }, [activeFolderId, loadFiles])

  const activeFolder =
    yearFolders.find((f) => f.drive_folder_id === activeFolderId) ??
    (parentFolder?.drive_folder_id === activeFolderId ? parentFolder : null)

  const fileInputRef = useRef<HTMLInputElement>(null)
  const [uploading, setUploading] = useState(false)
  const [uploadMsg, setUploadMsg] = useState<string | null>(null)

  const onPickFile = async (ev: ChangeEvent<HTMLInputElement>) => {
    const file = ev.target.files?.[0]
    ev.target.value = '' // allow re-picking the same file
    if (!file || !activeFolderId) return
    setUploading(true); setUploadMsg(null)
    try {
      const fd = new FormData()
      fd.append('folderId', activeFolderId)
      fd.append('file', file)
      const res = await fetch('/api/acc/upload', { method: 'POST', body: fd })
      const data = await res.json()
      if (!data.ok) { setUploadMsg(data.message || 'Upload failed.'); return }
      await loadFiles(activeFolderId)
      setUploadMsg(`Uploaded “${file.name}” ✓`)
    } catch (e) {
      setUploadMsg(e instanceof Error ? e.message : 'Upload failed.')
    } finally {
      setUploading(false)
    }
  }

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div
        className="flex h-[88vh] w-[92vw] max-w-6xl flex-col overflow-hidden rounded-lg bg-[var(--surface)] shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-[var(--border)] px-4 py-3">
          <div className="font-mono text-sm font-bold text-[var(--text)]">{evidenceKey} — evidence</div>
          <button onClick={onClose} className="rounded-md px-2 py-1 text-sm text-[var(--muted)] hover:bg-[var(--bg)]">✕</button>
        </div>

        <div className="flex items-center gap-1.5 border-b border-[var(--border)] px-4 py-2">
          {yearFolders.length === 0 && <span className="text-xs text-[var(--muted)]">No year folders yet.</span>}
          {yearFolders.map((f) => (
            <button
              key={f.id}
              onClick={() => setActiveFolderId(f.drive_folder_id)}
              className={`rounded-md px-3 py-1 text-xs font-semibold transition-colors ${
                activeFolderId === f.drive_folder_id
                  ? 'bg-[var(--blue)] text-white'
                  : 'bg-[var(--bg)] text-[var(--muted)] hover:text-[var(--text)]'
              }`}
            >
              {f.year}
            </button>
          ))}

          <div className="ml-auto flex items-center gap-2">
            {uploadMsg && <span className="text-[11px] text-[var(--muted)]">{uploadMsg}</span>}
            {activeFolder?.drive_url && (
              <a
                href={activeFolder.drive_url}
                target="_blank"
                rel="noopener noreferrer"
                className="rounded-md px-2.5 py-1 text-xs text-[var(--muted)] hover:text-[var(--text)]"
              >
                Open in Drive ↗
              </a>
            )}
            <input
              ref={fileInputRef}
              type="file"
              className="hidden"
              onChange={onPickFile}
            />
            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={!activeFolderId || uploading}
              className="rounded-md bg-[var(--blue)] px-3 py-1 text-xs font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-50"
            >
              {uploading ? 'Uploading…' : '⬆ Upload file'}
            </button>
          </div>
        </div>

        <div className="border-b border-[var(--border)] bg-[var(--bg)] px-4 py-1.5 text-[11px] text-[var(--muted)]">
          Each file must be smaller than 4&nbsp;MB. For larger files, click “Open in Drive ↗” and upload them directly into the Google&nbsp;Drive folder.
        </div>

        <div className="flex min-h-0 flex-1">
          {/* file list */}
          <div className="w-56 shrink-0 overflow-y-auto border-r border-[var(--border)] bg-[var(--bg)]">
            {loadingFiles && <div className="p-3 text-xs text-[var(--muted)]">Loading files…</div>}
            {filesError && <div className="p-3 text-xs text-[var(--red)]">{filesError}</div>}
            {files && files.length === 0 && <div className="p-3 text-xs text-[var(--muted)]">This folder is empty.</div>}
            {files?.map((f) => (
              <button
                key={f.id}
                onClick={() => setPreviewId(f.id)}
                className={`block w-full truncate px-3 py-2 text-left text-xs transition-colors ${
                  previewId === f.id ? 'bg-[var(--blue-lt)] text-[var(--blue)]' : 'hover:bg-[var(--surface)]'
                }`}
                title={f.name}
              >
                {f.name}
              </button>
            ))}
          </div>
          {/* preview */}
          <div className="min-w-0 flex-1 bg-[var(--bg)]">
            {previewId ? (
              <iframe
                key={previewId}
                src={drivePreviewUrl(previewId)}
                className="h-full w-full"
                allow="autoplay"
                title="Evidence preview"
              />
            ) : (
              <div className="flex h-full items-center justify-center text-sm text-[var(--muted)]">
                Select a file to preview it here.
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
