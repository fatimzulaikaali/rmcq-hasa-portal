'use client'

export const dynamic = 'force-dynamic'

import { useEffect, useMemo, useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { AppShell, Topbar } from '@/components/AppShell'
import { getModuleAccess } from '@/lib/risk/auth'
import type {
  AccService, AccTopic, AccSubStandard, AccCriterion, AccEvidenceItem, AccFolder, AccDriveFile,
} from '@/lib/acc/types'
import {
  fillService, evidenceKey, criterionBadges, drivePreviewUrl, defaultYears,
} from '@/lib/acc/helpers'

type Filter = 'all' | 'core' | 'new'

export default function AccreditationPage() {
  const router = useRouter()
  const supabase = useMemo(() => createClient(), [])

  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)

  const [service, setService] = useState<AccService | null>(null)
  const [topics, setTopics] = useState<AccTopic[]>([])
  const [subs, setSubs] = useState<AccSubStandard[]>([])
  const [criteria, setCriteria] = useState<AccCriterion[]>([])
  const [evidence, setEvidence] = useState<AccEvidenceItem[]>([])
  const [folders, setFolders] = useState<AccFolder[]>([])

  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState<Filter>('all')

  const loadFolders = useCallback(async () => {
    const { data } = await supabase.from('acc_folders').select('*')
    setFolders((data ?? []) as AccFolder[])
  }, [supabase])

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const access = await getModuleAccess(supabase)
        if (!access.allModules) { router.replace('/risk'); return }

        const [svc, tp, sb, cr, ev, fl] = await Promise.all([
          supabase.from('acc_services').select('*').limit(1).maybeSingle(),
          supabase.from('acc_topics').select('*').order('sort_order'),
          supabase.from('acc_sub_standards').select('*').order('sort_order'),
          supabase.from('acc_criteria').select('*').order('sort_order'),
          supabase.from('acc_evidence_items').select('*').order('item_number'),
          supabase.from('acc_folders').select('*'),
        ])
        if (cancelled) return
        setService((svc.data ?? null) as AccService | null)
        setTopics((tp.data ?? []) as AccTopic[])
        setSubs((sb.data ?? []) as AccSubStandard[])
        setCriteria((cr.data ?? []) as AccCriterion[])
        setEvidence((ev.data ?? []) as AccEvidenceItem[])
        setFolders((fl.data ?? []) as AccFolder[])
        setSelectedId((cr.data?.[0] as AccCriterion | undefined)?.id ?? null)
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
      .map((t) => ({ topic: t, items: byTopic.get(t.id) ?? [] }))
      .filter((g) => g.items.length > 0)
  }, [filtered, topics])

  const selected = useMemo(
    () => criteria.find((c) => c.id === selectedId) ?? null,
    [criteria, selectedId],
  )

  if (loading) {
    return (
      <AppShell>
        <Topbar title="Accreditation" meta="MSQH 7th Edition — Standard 24" />
        <div className="loader"><div className="loader-inner"><div className="spin" /><div>Loading standard…</div></div></div>
      </AppShell>
    )
  }

  const total = criteria.length
  const done = syncedCriteria.size
  const pct = total ? Math.round((done / total) * 100) : 0

  return (
    <AppShell>
      <Topbar
        title="Accreditation — MSQH Standard 24"
        meta={service ? `${service.name}` : 'Standards for General Application'}
        right={
          <div className="text-xs text-[var(--muted)]">
            <span className="font-semibold text-[var(--text)]">{done}</span> / {total} criteria started · {pct}%
          </div>
        }
      />

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
              onSynced={loadFolders}
            />
          ) : (
            <div className="text-sm text-[var(--muted)]">Select a criterion.</div>
          )}
        </div>
      </div>
    </AppShell>
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
  criterion, sub, topic, service, evidenceItems, foldersByItem, onSynced,
}: {
  criterion: AccCriterion
  sub: AccSubStandard | null
  topic: AccTopic | null
  service: AccService | null
  evidenceItems: AccEvidenceItem[]
  foldersByItem: Map<string, AccFolder[]>
  onSynced: () => Promise<void>
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
      s.has(year) ? s.delete(year) : s.add(year)
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

  const candidateYears = defaultYears()
  const nextYear = new Date().getFullYear() + 1
  const yearChoices = [...candidateYears, nextYear]

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
        <button
          onClick={sync}
          disabled={syncing}
          className="rounded-md bg-[var(--blue)] px-3 py-1.5 text-xs font-semibold text-white hover:opacity-90 disabled:opacity-50"
        >
          {syncing ? 'Syncing…' : 'Create / update Drive folders'}
        </button>
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

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
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
