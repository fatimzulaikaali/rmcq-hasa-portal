'use client'

export const dynamic = 'force-dynamic'

import { useEffect, useMemo, useState } from 'react'
import { useRouter, useParams } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { getModuleAccess } from '@/lib/risk/auth'
import { RiskAccountChip } from '@/components/RiskAccountChip'
import { RiskSidebar } from '@/components/RiskSidebar'
import type {
  RiskMeeting, RiskMeetingAgenda, RiskActionItem, Risk, RiskReview, RiskUser,
  CommitteeOutcome, MeetingStatus, ActionType, CrossCuttingTheme, RiskLevel,
} from '@/lib/risk/types'
import {
  computeRiskScore, outcomeToStatus, allowedOutcomes,
  COMMITTEE_OUTCOME_LABEL, MEETING_TYPE_LABEL, MEETING_STATUS_LABEL,
  ACTION_TYPE_LABEL, ACTION_STATUS_LABEL,
  RISK_LEVEL_COLOR, RISK_LEVEL_BG, RISK_LEVEL_LABEL, RISK_STATUS_LABEL, RISK_STATUS_BADGE,
  RISK_CATEGORY_LABEL, RISK_SCOPE_LABEL,
} from '@/lib/risk/scoring'

interface AgendaEntry {
  item: RiskMeetingAgenda
  risk: Risk
  latest: RiskReview | null
  deptLabel: string
}

const MEETING_STATUSES: MeetingStatus[] = ['PLANNED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED']

export default function RiskMeetingDetailPage() {
  const router = useRouter()
  const params = useParams<{ id: string }>()
  const supabase = useMemo(() => createClient(), [])
  const meetingId = useMemo(() => parseInt(params.id, 10), [params.id])

  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [accessDenied, setAccessDenied] = useState(false)
  const [notFound, setNotFound] = useState(false)

  const [meeting, setMeeting] = useState<RiskMeeting | null>(null)
  const [agenda, setAgenda] = useState<RiskMeetingAgenda[]>([])
  const [risksById, setRisksById] = useState<Map<number, Risk>>(new Map())
  const [latestReviewByRisk, setLatestReviewByRisk] = useState<Map<number, RiskReview>>(new Map())
  const [available, setAvailable] = useState<Risk[]>([])
  const [actions, setActions] = useState<RiskActionItem[]>([])
  const [users, setUsers] = useState<RiskUser[]>([])
  const [deptNames, setDeptNames] = useState<Map<string, string>>(new Map())
  const [allDepts, setAllDepts] = useState<{ code: string; name_en: string }[]>([])
  const [isRC, setIsRC] = useState(false)
  const [currentUserId, setCurrentUserId] = useState<number | null>(null)

  // Cross-cutting themes (RTC tagging + ROC summary)
  const [themes, setThemes] = useState<CrossCuttingTheme[]>([])
  const [tagsByRisk, setTagsByRisk] = useState<Map<number, number[]>>(new Map())

  // ROC ↔ RTC linkage + rolled-up RTC data (only loaded for ROC meetings)
  const [linkedRtc, setLinkedRtc] = useState<RiskMeeting[]>([])
  const [availableRtc, setAvailableRtc] = useState<RiskMeeting[]>([])
  const [rtcAgenda, setRtcAgenda] = useState<RiskMeetingAgenda[]>([])
  const [rtcRiskById, setRtcRiskById] = useState<Map<number, Risk>>(new Map())
  const [pickRtcId, setPickRtcId] = useState<string>('')

  const [busy, setBusy] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)

  // Add-to-agenda picker
  const [pickRiskId, setPickRiskId] = useState<string>('')
  // Minutes editing
  const [minutesText, setMinutesText] = useState('')
  // Presentation mode — index into the department-ordered agenda, or null
  const [presentIndex, setPresentIndex] = useState<number | null>(null)
  // ROC presentation deck open?
  const [rocPresentOpen, setRocPresentOpen] = useState(false)

  useEffect(() => { void load() }, [meetingId]) // eslint-disable-line react-hooks/exhaustive-deps

  const tabledStatus = (mt: RiskMeeting['meeting_type']) => (mt === 'RTC' ? 'TABLED_RTC' : 'TABLED_ROC')

  // `silent` reloads skip the loading spinner so the agenda cards stay mounted —
  // otherwise flipping `loading` true unmounts them and wipes any half-typed
  // decision notes / action text the RC hasn't saved yet.
  async function load(opts?: { silent?: boolean }) {
    if (!Number.isFinite(meetingId)) { setNotFound(true); setLoading(false); return }
    if (!opts?.silent) setLoading(true)
    setLoadError(null); setAccessDenied(false); setNotFound(false)
    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) { router.push('/login'); return }

      const access = await getModuleAccess(supabase)
      if (!access.allModules) { setAccessDenied(true); return }
      setIsRC(access.activeRole?.role === 'RC')
      setCurrentUserId(access.riskUser?.riskUserId ?? null)

      const { data: mData, error: mErr } = await supabase
        .from('risk_meetings').select('*').eq('id', meetingId).maybeSingle()
      if (mErr) throw new Error(`Meeting: ${mErr.code ?? ''} ${mErr.message}`)
      if (!mData) { setNotFound(true); return }
      const m = mData as RiskMeeting
      setMeeting(m)
      setMinutesText(m.minutes ?? '')

      const [
        { data: agendaData, error: agErr },
        { data: actionsData, error: acErr },
        { data: usersData, error: uErr },
      ] = await Promise.all([
        supabase.from('risk_meeting_agenda').select('*').eq('meeting_id', meetingId).order('seq'),
        supabase.from('risk_action_items').select('*').eq('meeting_id', meetingId).order('id'),
        supabase.from('risk_users').select('id,auth_user_id,name,email,is_active,created_at,last_login'),
      ])
      if (agErr) throw new Error(`Agenda: ${agErr.code ?? ''} ${agErr.message}`)
      if (acErr) throw new Error(`Actions: ${acErr.code ?? ''} ${acErr.message}`)
      if (uErr)  throw new Error(`Users: ${uErr.code ?? ''} ${uErr.message}`)

      const ag = (agendaData ?? []) as RiskMeetingAgenda[]
      setAgenda(ag)
      setActions((actionsData ?? []) as RiskActionItem[])
      setUsers((usersData ?? []) as RiskUser[])

      // Candidate risks for the agenda: freshly-tabled for this committee PLUS
      // any active issue (ACTIVE / MONITORING) — those can be brought back for
      // discussion at a later RTC/ROC sitting. Exclude ones already on the agenda.
      const agendaRiskIds = ag.map((a) => a.risk_id)
      const tStatus = tabledStatus(m.meeting_type)
      const candidateStatuses = [tStatus, 'ACTIVE', 'MONITORING']
      const [{ data: agendaRisks, error: arErr }, { data: tabledRisks, error: trErr }] = await Promise.all([
        agendaRiskIds.length
          ? supabase.from('risks').select('*').in('id', agendaRiskIds)
          : Promise.resolve({ data: [], error: null } as { data: Risk[]; error: null }),
        supabase.from('risks').select('*').in('status', candidateStatuses),
      ])
      if (arErr) throw new Error(`Agenda risks: ${arErr.code ?? ''} ${arErr.message}`)
      if (trErr) throw new Error(`Candidate risks: ${trErr.code ?? ''} ${trErr.message}`)

      const rMap = new Map<number, Risk>()
      for (const r of (agendaRisks ?? []) as Risk[]) rMap.set(r.id, r)
      setRisksById(rMap)
      const onAgenda = new Set(agendaRiskIds)
      setAvailable(((tabledRisks ?? []) as Risk[]).filter((r) => !onAgenda.has(r.id)))

      // Cross-cutting themes (RTC tagging + ROC summary grouping)
      const { data: themesData } = await supabase
        .from('cross_cutting_themes').select('*').eq('is_active', true).order('id')
      setThemes((themesData ?? []) as CrossCuttingTheme[])

      // For an ROC meeting: linked RTC sittings + their rolled-up agenda/risks.
      const rtcRiskList: Risk[] = []
      if (m.meeting_type === 'ROC') {
        const { data: linksData } = await supabase
          .from('risk_roc_rtc_links').select('rtc_meeting_id').eq('roc_meeting_id', m.id)
        const linkedIds = ((linksData ?? []) as { rtc_meeting_id: number }[]).map((l) => l.rtc_meeting_id)

        const { data: allRtcData } = await supabase
          .from('risk_meetings').select('*').eq('meeting_type', 'RTC').order('meeting_date', { ascending: false })
        const allRtc = (allRtcData ?? []) as RiskMeeting[]
        setLinkedRtc(allRtc.filter((mm) => linkedIds.includes(mm.id)))
        setAvailableRtc(allRtc.filter((mm) => !linkedIds.includes(mm.id)))

        let rtcAgItems: RiskMeetingAgenda[] = []
        if (linkedIds.length) {
          const { data: rtcAgData } = await supabase
            .from('risk_meeting_agenda').select('*').in('meeting_id', linkedIds).order('seq')
          rtcAgItems = (rtcAgData ?? []) as RiskMeetingAgenda[]
        }
        setRtcAgenda(rtcAgItems)

        const rtcRiskIds = Array.from(new Set(rtcAgItems.map((a) => a.risk_id)))
        if (rtcRiskIds.length) {
          const { data: rtcRisks } = await supabase.from('risks').select('*').in('id', rtcRiskIds)
          const rr = new Map<number, Risk>()
          for (const r of (rtcRisks ?? []) as Risk[]) { rr.set(r.id, r); rtcRiskList.push(r) }
          setRtcRiskById(rr)
        } else {
          setRtcRiskById(new Map())
        }
      }

      // Latest review per risk — for re-score prefill + the ROC level/cycle breakdowns.
      // Covers agenda + tabled + the RTC-rollup risks.
      const reviewRiskIds = Array.from(new Set([
        ...agendaRiskIds,
        ...((tabledRisks ?? []) as Risk[]).map((r) => r.id),
        ...rtcRiskList.map((r) => r.id),
      ]))
      if (reviewRiskIds.length) {
        const { data: reviews } = await supabase.from('risk_reviews')
          .select('*').in('risk_id', reviewRiskIds).order('cycle_number', { ascending: false })
        const lr = new Map<number, RiskReview>()
        for (const rv of (reviews ?? []) as RiskReview[]) if (!lr.has(rv.risk_id)) lr.set(rv.risk_id, rv)
        setLatestReviewByRisk(lr)
      } else {
        setLatestReviewByRisk(new Map())
      }

      // Theme tags — for current agenda risks + any ROC-summary RTC risks
      const tagRiskIds = Array.from(new Set([...agendaRiskIds, ...rtcRiskList.map((r) => r.id)]))
      if (tagRiskIds.length) {
        const { data: tags } = await supabase
          .from('risk_theme_tags').select('risk_id, theme_id').in('risk_id', tagRiskIds)
        const tm = new Map<number, number[]>()
        for (const t of (tags ?? []) as { risk_id: number; theme_id: number }[]) {
          const arr = tm.get(t.risk_id) ?? []; arr.push(t.theme_id); tm.set(t.risk_id, arr)
        }
        setTagsByRisk(tm)
      } else {
        setTagsByRisk(new Map())
      }

      // Dept names for every risk involved (agenda + tabled + RTC rollup)
      const deptCodes = Array.from(new Set([
        ...Array.from(rMap.values()).map((r) => r.dept_code),
        ...((tabledRisks ?? []) as Risk[]).map((r) => r.dept_code),
        ...rtcRiskList.map((r) => r.dept_code),
      ]))
      if (deptCodes.length) {
        const { data: depts } = await supabase.from('pscs_departments').select('code,name_en').in('code', deptCodes)
        const dm = new Map<string, string>()
        for (const d of (depts ?? []) as { code: string; name_en: string }[]) dm.set(d.code, d.name_en)
        setDeptNames(dm)
      }

      // Full department list — for assigning action items to one or more depts.
      const { data: deptsAll } = await supabase.from('pscs_departments')
        .select('code,name_en').eq('kind', 'department').not('risk_code', 'is', null).order('name_en')
      setAllDepts((deptsAll ?? []) as { code: string; name_en: string }[])
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }

  async function signOut() { await supabase.auth.signOut(); router.push('/login') }

  function nameOf(uid: number | null | undefined): string {
    if (!uid) return '—'
    return users.find((u) => u.id === uid)?.name ?? `user #${uid}`
  }
  function deptLabel(code: string): string { return deptNames.get(code) ?? code }

  async function setMeetingStatus(status: MeetingStatus) {
    if (!meeting) return
    setBusy(true); setActionError(null)
    try {
      const { error } = await supabase.from('risk_meetings')
        .update({ status, updated_at: new Date().toISOString() }).eq('id', meeting.id)
      if (error) throw new Error(`${error.code ?? ''} ${error.message}`)
      await load({ silent: true })
    } catch (e) { setActionError(e instanceof Error ? e.message : String(e)) }
    finally { setBusy(false) }
  }

  async function saveMinutes() {
    if (!meeting) return
    setBusy(true); setActionError(null)
    try {
      const { error } = await supabase.from('risk_meetings')
        .update({ minutes: minutesText.trim() || null, updated_at: new Date().toISOString() }).eq('id', meeting.id)
      if (error) throw new Error(`${error.code ?? ''} ${error.message}`)
      await load({ silent: true })
    } catch (e) { setActionError(e instanceof Error ? e.message : String(e)) }
    finally { setBusy(false) }
  }

  async function addToAgenda() {
    if (!meeting || !pickRiskId) return
    setBusy(true); setActionError(null)
    try {
      const { error } = await supabase.from('risk_meeting_agenda').insert({
        meeting_id: meeting.id,
        risk_id: parseInt(pickRiskId, 10),
        seq: agenda.length + 1,
      })
      if (error) throw new Error(`Add to agenda: ${error.code ?? ''} ${error.message}`)
      setPickRiskId('')
      await load({ silent: true })
    } catch (e) { setActionError(e instanceof Error ? e.message : String(e)) }
    finally { setBusy(false) }
  }

  async function addAllTabled() {
    if (!meeting) return
    // Only the freshly-tabled risks for THIS committee — active issues stay
    // opt-in (added individually), so "add all" doesn't sweep in the whole register.
    const tStatus = tabledStatus(meeting.meeting_type)
    const tabledForThis = available.filter((r) => r.status === tStatus)
    if (tabledForThis.length === 0) return
    setBusy(true); setActionError(null)
    try {
      const ordered = [...tabledForThis].sort((a, b) =>
        (deptNames.get(a.dept_code) ?? a.dept_code).localeCompare(deptNames.get(b.dept_code) ?? b.dept_code) ||
        a.risk_id.localeCompare(b.risk_id))
      const rows = ordered.map((r, i) => ({
        meeting_id: meeting.id, risk_id: r.id, seq: agenda.length + 1 + i,
      }))
      const { error } = await supabase.from('risk_meeting_agenda').insert(rows)
      if (error) throw new Error(`Add all: ${error.code ?? ''} ${error.message}`)
      await load({ silent: true })
    } catch (e) { setActionError(e instanceof Error ? e.message : String(e)) }
    finally { setBusy(false) }
  }

  async function removeAgendaItem(item: RiskMeetingAgenda) {
    if (item.outcome) { alert('This item already has a recorded decision and cannot be removed.'); return }
    if (!window.confirm('Remove this risk from the agenda?')) return
    setBusy(true); setActionError(null)
    try {
      const { error } = await supabase.from('risk_meeting_agenda').delete().eq('id', item.id)
      if (error) throw new Error(`${error.code ?? ''} ${error.message}`)
      await load({ silent: true })
    } catch (e) { setActionError(e instanceof Error ? e.message : String(e)) }
    finally { setBusy(false) }
  }

  /* Record a committee decision on one agenda item — the heart of the flow. */
  async function recordDecision(
    item: RiskMeetingAgenda,
    risk: Risk,
    opts: { outcome: CommitteeOutcome; notes: string; rescore: ScoreInputs | null },
  ) {
    if (!meeting || !currentUserId) return
    setBusy(true); setActionError(null)
    try {
      let reviewId: number | null = item.review_id
      // 1) Optional re-score → new review cycle
      if (opts.rescore) {
        const computed = computeRiskScore(opts.rescore.likelihood, [
          opts.rescore.impact_manusia, opts.rescore.impact_reputasi, opts.rescore.impact_kewangan,
          opts.rescore.impact_operasi, opts.rescore.impact_objektif])
        const latest = latestReviewByRisk.get(risk.id)
        const nextCycle = (latest?.cycle_number ?? 0) + 1
        const { data: rv, error: rvErr } = await supabase.from('risk_reviews').insert({
          risk_id: risk.id,
          cycle_number: nextCycle,
          reviewed_by: currentUserId,
          review_date: new Date().toISOString().slice(0, 10),
          likelihood: opts.rescore.likelihood,
          impact_manusia: opts.rescore.impact_manusia,
          impact_reputasi: opts.rescore.impact_reputasi,
          impact_kewangan: opts.rescore.impact_kewangan,
          impact_operasi: opts.rescore.impact_operasi,
          impact_objektif: opts.rescore.impact_objektif,
          avg_impact: computed.avgImpact,
          risk_score: computed.riskScore,
          risk_level: computed.riskLevel,
        }).select('id').single()
        if (rvErr) throw new Error(`Re-score: ${rvErr.code ?? ''} ${rvErr.message}`)
        reviewId = rv.id as number
      }

      // 2) Update the agenda item with the decision
      const { error: agErr } = await supabase.from('risk_meeting_agenda').update({
        outcome: opts.outcome,
        discussion_notes: opts.notes.trim() || null,
        review_id: reviewId,
        decided_by: currentUserId,
        decided_at: new Date().toISOString(),
      }).eq('id', item.id)
      if (agErr) throw new Error(`Decision: ${agErr.code ?? ''} ${agErr.message}`)

      // 3) Move the risk to its next status
      const newStatus = outcomeToStatus(opts.outcome)
      const riskPatch: Partial<Risk> = { status: newStatus }
      if (opts.outcome === 'SEND_BACK_DEPT') {
        const note = opts.notes.trim() || `Sent back by ${meeting.meeting_type} for rework`
        riskPatch.rejection_reason = note.slice(0, 50)
        riskPatch.rejection_comment = note
        riskPatch.rejected_by = currentUserId
        riskPatch.rejected_at = new Date().toISOString()
      }
      const { error: rErr } = await supabase.from('risks').update(riskPatch).eq('id', risk.id)
      if (rErr) throw new Error(`Risk status: ${rErr.code ?? ''} ${rErr.message}`)

      // 4) Audit log on the risk
      await supabase.from('risk_audit_logs').insert({
        risk_id: risk.id,
        entity_type: 'risk',
        entity_id: risk.id,
        action_type: `${meeting.meeting_type}_${opts.outcome}`,
        performed_by: currentUserId,
        user_role: 'RC',
        old_value: { status: risk.status },
        new_value: { status: newStatus, ...(reviewId !== item.review_id ? { rescored: true } : {}) },
        comment: `${MEETING_TYPE_LABEL[meeting.meeting_type]} — ${COMMITTEE_OUTCOME_LABEL[opts.outcome]}${opts.notes.trim() ? `: ${opts.notes.trim()}` : ''}`,
      })

      await load({ silent: true })
    } catch (e) { setActionError(e instanceof Error ? e.message : String(e)) }
    finally { setBusy(false) }
  }

  /* Add an action item tied to a specific risk on the agenda (so it routes to
   * that risk's department), with a named assignee. */
  async function addActionItem(
    agendaId: number, riskId: number,
    a: { action_type: ActionType; description: string; assigned_depts: string[]; due_date: string | null },
  ) {
    if (!meeting || !a.description.trim() || a.assigned_depts.length === 0) return
    setBusy(true); setActionError(null)
    try {
      const { data: ins, error } = await supabase.from('risk_action_items').insert({
        meeting_id: meeting.id,
        agenda_id: agendaId,
        risk_id: riskId,
        action_type: a.action_type,
        description: a.description.trim(),
        assigned_depts: a.assigned_depts,
        due_date: a.due_date || null,
        status: 'PENDING',
        created_by: currentUserId,
      }).select('id').single()
      if (error) throw new Error(`Action item: ${error.code ?? ''} ${error.message}`)

      // Record the directive in the risk's audit trail.
      const deptLabel = a.assigned_depts.map((c) => allDepts.find((d) => d.code === c)?.name_en ?? c).join(', ')
      await supabase.from('risk_audit_logs').insert({
        risk_id: riskId, entity_type: 'action_item', entity_id: ins?.id ?? null,
        action_type: `ACTION_ASSIGNED_${a.action_type}`,
        performed_by: currentUserId, user_role: 'RC',
        comment: `${ACTION_TYPE_LABEL[a.action_type]} → ${deptLabel}: ${a.description.trim()}`,
      })
      await load({ silent: true })
    } catch (e) { setActionError(e instanceof Error ? e.message : String(e)) }
    finally { setBusy(false) }
  }

  /* Tag / untag a risk with a cross-cutting theme (RC, during the RTC). */
  async function toggleTheme(riskId: number, themeId: number) {
    if (!currentUserId) return
    const current = tagsByRisk.get(riskId) ?? []
    const tagged = current.includes(themeId)
    setBusy(true); setActionError(null)
    try {
      if (tagged) {
        const { error } = await supabase.from('risk_theme_tags')
          .delete().eq('risk_id', riskId).eq('theme_id', themeId)
        if (error) throw new Error(`Untag: ${error.code ?? ''} ${error.message}`)
      } else {
        const { error } = await supabase.from('risk_theme_tags')
          .insert({ risk_id: riskId, theme_id: themeId, tagged_by: currentUserId })
        if (error && error.code !== '23505') throw new Error(`Tag: ${error.code ?? ''} ${error.message}`)
      }
      await load({ silent: true })
    } catch (e) { setActionError(e instanceof Error ? e.message : String(e)) }
    finally { setBusy(false) }
  }

  /* Link / unlink an RTC sitting to this ROC meeting. */
  async function linkRtc() {
    if (!meeting || !pickRtcId) return
    setBusy(true); setActionError(null)
    try {
      const { error } = await supabase.from('risk_roc_rtc_links').insert({
        roc_meeting_id: meeting.id, rtc_meeting_id: parseInt(pickRtcId, 10), created_by: currentUserId,
      })
      if (error && error.code !== '23505') throw new Error(`Link RTC: ${error.code ?? ''} ${error.message}`)
      setPickRtcId('')
      await load({ silent: true })
    } catch (e) { setActionError(e instanceof Error ? e.message : String(e)) }
    finally { setBusy(false) }
  }
  async function unlinkRtc(rtcMeetingId: number) {
    if (!meeting) return
    setBusy(true); setActionError(null)
    try {
      const { error } = await supabase.from('risk_roc_rtc_links')
        .delete().eq('roc_meeting_id', meeting.id).eq('rtc_meeting_id', rtcMeetingId)
      if (error) throw new Error(`Unlink: ${error.code ?? ''} ${error.message}`)
      await load({ silent: true })
    } catch (e) { setActionError(e instanceof Error ? e.message : String(e)) }
    finally { setBusy(false) }
  }

  /* Set / clear who chaired this meeting (RC). Not auto-filled on create. */
  async function setChair(uid: number | null) {
    if (!meeting) return
    setBusy(true); setActionError(null)
    try {
      const { error } = await supabase.from('risk_meetings')
        .update({ chaired_by: uid, updated_at: new Date().toISOString() }).eq('id', meeting.id)
      if (error) throw new Error(`Set chair: ${error.code ?? ''} ${error.message}`)
      await load({ silent: true })
    } catch (e) { setActionError(e instanceof Error ? e.message : String(e)) }
    finally { setBusy(false) }
  }

  /* Delete a meeting (e.g. one created by mistake). Removes its agenda,
   * decisions and action items; does NOT revert risk statuses already changed
   * by past decisions. */
  async function deleteMeeting() {
    if (!meeting) return
    if (!window.confirm(
      `Delete this ${meeting.meeting_type} meeting "${meeting.title}"?\n\n` +
      'This removes its agenda, recorded decisions and action items. ' +
      'Any risk statuses already changed by past decisions will NOT be reverted. ' +
      'This cannot be undone.'
    )) return
    setBusy(true); setActionError(null)
    try {
      await supabase.from('risk_action_items').delete().eq('meeting_id', meeting.id)
      await supabase.from('risk_meeting_agenda').delete().eq('meeting_id', meeting.id)
      await supabase.from('risk_roc_rtc_links').delete().eq('roc_meeting_id', meeting.id)
      await supabase.from('risk_roc_rtc_links').delete().eq('rtc_meeting_id', meeting.id)
      const { error } = await supabase.from('risk_meetings').delete().eq('id', meeting.id)
      if (error) throw new Error(`Delete meeting: ${error.code ?? ''} ${error.message}`)
      router.push('/risk/meetings')
    } catch (e) { setActionError(e instanceof Error ? e.message : String(e)); setBusy(false) }
  }

  /* Create a brand-new cross-cutting theme on the fly and tag this risk with it
   * (RC, during the RTC). The theme joins the shared master list for reuse. */
  async function addCustomTheme(riskId: number, name: string) {
    if (!currentUserId || !name.trim()) return
    setBusy(true); setActionError(null)
    try {
      const { data: created, error } = await supabase.from('cross_cutting_themes')
        .insert({ name: name.trim(), is_active: true }).select('id').single()
      if (error) throw new Error(`New theme: ${error.code ?? ''} ${error.message}`)
      const { error: tagErr } = await supabase.from('risk_theme_tags')
        .insert({ risk_id: riskId, theme_id: created.id as number, tagged_by: currentUserId })
      if (tagErr && tagErr.code !== '23505') throw new Error(`Tag: ${tagErr.code ?? ''} ${tagErr.message}`)
      await load({ silent: true })
    } catch (e) { setActionError(e instanceof Error ? e.message : String(e)) }
    finally { setBusy(false) }
  }

  /* Edit the discussion notes after a decision has been recorded (RC). */
  async function editDiscussionNotes(item: RiskMeetingAgenda, text: string) {
    if (!meeting) return
    setBusy(true); setActionError(null)
    try {
      const { error } = await supabase.from('risk_meeting_agenda')
        .update({ discussion_notes: text.trim() || null }).eq('id', item.id)
      if (error) throw new Error(`Edit notes: ${error.code ?? ''} ${error.message}`)
      if (currentUserId && item.risk_id) {
        await supabase.from('risk_audit_logs').insert({
          risk_id: item.risk_id, entity_type: 'risk', entity_id: item.risk_id,
          action_type: `${meeting.meeting_type}_NOTE_EDIT`,
          performed_by: currentUserId, user_role: 'RC',
          comment: `Discussion notes updated: ${text.trim() || '(cleared)'}`,
        })
      }
      await load({ silent: true })
    } catch (e) { setActionError(e instanceof Error ? e.message : String(e)) }
    finally { setBusy(false) }
  }

  // Agenda grouped by department (sorted), and the same items flattened in that
  // order — the flat list drives the full-screen presentation stepper.
  const groups = useMemo(() => {
    const byDept = new Map<string, { deptCode: string; deptLabel: string; items: AgendaEntry[] }>()
    for (const item of agenda) {
      const risk = risksById.get(item.risk_id)
      if (!risk) continue
      const label = deptNames.get(risk.dept_code) ?? risk.dept_code
      if (!byDept.has(risk.dept_code)) byDept.set(risk.dept_code, { deptCode: risk.dept_code, deptLabel: label, items: [] })
      byDept.get(risk.dept_code)!.items.push({ item, risk, latest: latestReviewByRisk.get(item.risk_id) ?? null, deptLabel: label })
    }
    return Array.from(byDept.values())
      .map((g) => ({ ...g, items: g.items.sort((a, b) => a.risk.risk_id.localeCompare(b.risk.risk_id)) }))
      .sort((a, b) => a.deptLabel.localeCompare(b.deptLabel))
  }, [agenda, risksById, latestReviewByRisk, deptNames])

  const orderedFlat = useMemo(() => groups.flatMap((g) => g.items), [groups])
  const decidedCount = agenda.filter((a) => a.outcome).length

  // ROC rollup of the linked RTC sittings. Aggregates over the DISTINCT risks
  // presented at the linked RTC(s): totals by department, risk level, current
  // review cycle, how many escalated to ROC, plus cross-cutting issues by theme.
  const rocSummary = useMemo(() => {
    if (!meeting || meeting.meeting_type !== 'ROC') return null
    const risks = Array.from(rtcRiskById.values())
    const total = risks.length

    // outcome counts + escalated list (kept for the on-page working view)
    const counts: Partial<Record<CommitteeOutcome | 'UNDECIDED', number>> = {}
    const escalated: { item: RiskMeetingAgenda; risk: Risk }[] = []
    for (const a of rtcAgenda) {
      const key = (a.outcome ?? 'UNDECIDED') as CommitteeOutcome | 'UNDECIDED'
      counts[key] = (counts[key] ?? 0) + 1
      if (a.outcome === 'ESCALATE_ROC') {
        const r = rtcRiskById.get(a.risk_id)
        if (r) escalated.push({ item: a, risk: r })
      }
    }
    const escalatedCount = escalated.length

    // by department
    const deptMap = new Map<string, number>()
    for (const r of risks) deptMap.set(r.dept_code, (deptMap.get(r.dept_code) ?? 0) + 1)
    const byDept = Array.from(deptMap.entries())
      .map(([code, n]) => ({ code, n }))
      .sort((a, b) => b.n - a.n || a.code.localeCompare(b.code))

    // by risk level + by current review cycle (from each risk's latest review)
    const levelMap: Record<RiskLevel, number> = { EKSTREM: 0, TINGGI: 0, SEDERHANA: 0, RENDAH: 0 }
    const cycleMap = new Map<number, number>()
    let unscored = 0
    for (const r of risks) {
      const lr = latestReviewByRisk.get(r.id)
      if (lr) {
        levelMap[lr.risk_level]++
        cycleMap.set(lr.cycle_number, (cycleMap.get(lr.cycle_number) ?? 0) + 1)
      } else unscored++
    }
    const byCycle = Array.from(cycleMap.entries())
      .map(([cycle, n]) => ({ cycle, n })).sort((a, b) => a.cycle - b.cycle)

    // cross-cutting by theme
    const rtcRiskIds = Array.from(rtcRiskById.keys())
    const byTheme = themes.map((t) => ({
      theme: t,
      risks: rtcRiskIds
        .filter((rid) => (tagsByRisk.get(rid) ?? []).includes(t.id))
        .map((rid) => rtcRiskById.get(rid))
        .filter((r): r is Risk => !!r),
    })).filter((g) => g.risks.length > 0)

    return { total, counts, escalated, escalatedCount, byDept, levelMap, byCycle, unscored, byTheme }
  }, [meeting, rtcAgenda, rtcRiskById, themes, tagsByRisk, latestReviewByRisk])

  return (
    <div className={`shell ${sidebarOpen ? 'sidebar-open' : ''}`}>
      {presentIndex !== null && orderedFlat.length > 0 && meeting && (
        <PresentOverlay
          entries={orderedFlat}
          index={Math.min(presentIndex, orderedFlat.length - 1)}
          meetingTitle={`${meeting.meeting_type} · ${meeting.title}`}
          onIndex={setPresentIndex}
          onClose={() => setPresentIndex(null)}
        />
      )}
      {rocPresentOpen && meeting && rocSummary && (
        <RocPresentOverlay
          meetingTitle={`${meeting.meeting_type} · ${meeting.title}`}
          linkedRtc={linkedRtc}
          summary={{
            total: rocSummary.total,
            escalatedCount: rocSummary.escalatedCount,
            byDept: rocSummary.byDept,
            levelMap: rocSummary.levelMap,
            byCycle: rocSummary.byCycle,
            byTheme: rocSummary.byTheme,
          }}
          deptLabel={deptLabel}
          onClose={() => setRocPresentOpen(false)}
        />
      )}
      <RiskSidebar onClose={() => setSidebarOpen(false)} active="committees" />

      <div className="main">
        <header className="topbar">
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <button type="button" className="hamburger" onClick={() => setSidebarOpen((v) => !v)}>☰</button>
            <div>
              <div className="tb-title">{meeting ? `${meeting.meeting_type} · ${meeting.title}` : (notFound ? 'Not found' : '…')}</div>
              <div className="tb-meta">{meeting ? `${MEETING_TYPE_LABEL[meeting.meeting_type]} · ${meeting.meeting_date}` : ''}</div>
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <RiskAccountChip />
            <Link href="/risk/meetings" className="signout-btn">← All meetings</Link>
            <button type="button" className="signout-btn" onClick={signOut}>Sign out</button>
          </div>
        </header>

        <main className="tab-pane risk-skin">
          {loadError && (
            <div className="ac red"><div className="ai">⚠️</div>
              <div><div className="at">Load error</div><div className="as">{loadError}</div></div></div>
          )}
          {actionError && (
            <div className="ac red"><div className="ai">⚠️</div>
              <div><div className="at">Action error</div><div className="as">{actionError}</div></div></div>
          )}
          {loading && !loadError && (
            <div className="ac blue"><div className="ai">⏳</div><div><div className="at">Loading…</div></div></div>
          )}
          {accessDenied && (
            <div className="panel" style={{ textAlign: 'center', padding: 32 }}>
              <div style={{ fontSize: 32, marginBottom: 8 }}>🔒</div>
              <div style={{ fontSize: 16, fontWeight: 700 }}>Committee area is hospital-wide</div>
              <div style={{ marginTop: 14 }}>
                <Link href="/risk" className="signout-btn"
                  style={{ background: 'var(--blue)', color: '#fff', borderColor: 'var(--blue)' }}>← Back to register</Link>
              </div>
            </div>
          )}
          {notFound && !loading && (
            <div className="panel" style={{ textAlign: 'center', padding: 32 }}>
              <div style={{ fontSize: 32, marginBottom: 8 }}>🔍</div>
              <div style={{ fontSize: 16, fontWeight: 700 }}>Meeting not found</div>
              <div style={{ marginTop: 14 }}>
                <Link href="/risk/meetings" className="signout-btn"
                  style={{ background: 'var(--blue)', color: '#fff', borderColor: 'var(--blue)' }}>← All meetings</Link>
              </div>
            </div>
          )}

          {!loading && !loadError && !accessDenied && !notFound && meeting && (
            <>
              {/* Meeting header */}
              <div className="panel">
                <div className="pf"><div>
                  <div className="pt">{meeting.title}</div>
                  <div className="psub">
                    {MEETING_TYPE_LABEL[meeting.meeting_type]} · {meeting.meeting_date}
                    {meeting.location ? ` · ${meeting.location}` : ''}
                    {meeting.chaired_by ? ` · chaired by ${nameOf(meeting.chaired_by)}` : ''}
                  </div>
                </div></div>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                  <span style={{ fontSize: 12, color: 'var(--muted)' }}>Status:</span>
                  {MEETING_STATUSES.map((s) => (
                    <button key={s} type="button" className="signout-btn"
                      disabled={!isRC || busy || meeting.status === s}
                      onClick={() => setMeetingStatus(s)}
                      style={{
                        fontSize: 11, padding: '4px 10px',
                        background: meeting.status === s ? 'var(--blue)' : '#fff',
                        color: meeting.status === s ? '#fff' : 'var(--text)',
                        borderColor: meeting.status === s ? 'var(--blue)' : 'var(--border)',
                        cursor: (!isRC || meeting.status === s) ? 'default' : 'pointer',
                        opacity: (!isRC && meeting.status !== s) ? 0.6 : 1,
                      }}>
                      {MEETING_STATUS_LABEL[s]}
                    </button>
                  ))}
                </div>
                {isRC && (
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginTop: 10 }}>
                    <span style={{ fontSize: 12, color: 'var(--muted)' }}>Chair:</span>
                    <select value={meeting.chaired_by ?? ''} disabled={busy}
                      onChange={(e) => setChair(e.target.value ? parseInt(e.target.value, 10) : null)}
                      style={{ fontSize: 12, padding: '4px 8px', border: '1px solid var(--border)', borderRadius: 6 }}>
                      <option value="">— not set —</option>
                      {users.filter((u) => u.is_active).map((u) => (
                        <option key={u.id} value={u.id}>{u.name}</option>
                      ))}
                    </select>
                    <div style={{ flex: 1 }} />
                    <button type="button" className="signout-btn"
                      style={{ fontSize: 11, padding: '4px 10px', color: 'var(--red)', borderColor: 'var(--red)' }}
                      disabled={busy} onClick={deleteMeeting}>🗑 Delete meeting</button>
                  </div>
                )}
              </div>

              {/* ROC: RTC roll-up + cross-cutting summary */}
              {meeting.meeting_type === 'ROC' && rocSummary && (
                <>
                  <div className="panel">
                    <div className="pf" style={{ alignItems: 'flex-start' }}>
                      <div>
                        <div className="pt">RTC Summary</div>
                        <div className="psub">Roll-up of the RTC sitting(s) this ROC reviews — agenda item 1</div>
                      </div>
                      {linkedRtc.length > 0 && (
                        <button type="button" className="signout-btn"
                          style={{ fontSize: 12, padding: '6px 14px', background: 'var(--blue)', color: '#fff', borderColor: 'var(--blue)' }}
                          onClick={() => setRocPresentOpen(true)}>
                          ▶ Present to ROC
                        </button>
                      )}
                    </div>

                    <div style={{ marginBottom: 14 }}>
                      <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 6 }}>Reviewing these RTC meetings:</div>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
                        {linkedRtc.length === 0 && (
                          <span style={{ fontSize: 12, color: 'var(--muted)', fontStyle: 'italic' }}>None linked yet.</span>
                        )}
                        {linkedRtc.map((rt) => (
                          <span key={rt.id} className="theme-pill active" style={{ gap: 6 }}>
                            <Link href={`/risk/meetings/${rt.id}`} style={{ color: '#fff' }}>{rt.title} · {rt.meeting_date}</Link>
                            {isRC && <span onClick={() => unlinkRtc(rt.id)} style={{ cursor: 'pointer', fontWeight: 700 }}>  ×</span>}
                          </span>
                        ))}
                        {isRC && (
                          <>
                            <select value={pickRtcId} onChange={(e) => setPickRtcId(e.target.value)}
                              style={{ fontSize: 12, padding: '6px 8px', border: '1px solid var(--border)', borderRadius: 6 }}>
                              <option value="">{availableRtc.length ? '— link an RTC meeting —' : 'No other RTC meetings'}</option>
                              {availableRtc.map((rt) => <option key={rt.id} value={rt.id}>{rt.title} · {rt.meeting_date}</option>)}
                            </select>
                            <button type="button" className="signout-btn"
                              style={{ fontSize: 12, padding: '6px 12px', background: pickRtcId ? 'var(--blue)' : '#9CA3AF', color: '#fff', borderColor: pickRtcId ? 'var(--blue)' : '#9CA3AF' }}
                              disabled={!pickRtcId || busy} onClick={linkRtc}>+ Link</button>
                          </>
                        )}
                      </div>
                    </div>

                    {linkedRtc.length > 0 && (
                      <>
                        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 14 }}>
                          <CountPill label="Total presented" n={rocSummary.total} strong />
                          {(['ENDORSE_ACTIVE', 'ESCALATE_ROC', 'SEND_BACK_DEPT', 'RECOMMEND_CLOSE'] as CommitteeOutcome[]).map((o) => (
                            <CountPill key={o} label={COMMITTEE_OUTCOME_LABEL[o]} n={rocSummary.counts[o] ?? 0} />
                          ))}
                          {rocSummary.counts.UNDECIDED ? <CountPill label="Not yet decided" n={rocSummary.counts.UNDECIDED} /> : null}
                        </div>

                        <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 6 }}>
                          Escalated to ROC ({rocSummary.escalated.length}) — for discussion
                        </div>
                        {rocSummary.escalated.length === 0 ? (
                          <div style={{ fontSize: 12, color: 'var(--muted)', fontStyle: 'italic' }}>
                            Nothing was escalated to ROC from the linked RTC sitting(s).
                          </div>
                        ) : (
                          <div style={{ overflowX: 'auto' }}>
                            <table className="risk-table">
                              <thead><tr><th>Risk</th><th>Department</th><th style={{ textAlign: 'center' }}>Level</th><th>RTC discussion notes</th></tr></thead>
                              <tbody>
                                {rocSummary.escalated.map(({ item, risk }) => {
                                  const lr = latestReviewByRisk.get(risk.id)
                                  return (
                                    <tr key={item.id}>
                                      <td><Link href={`/risk/${risk.id}`} style={{ fontFamily: 'monospace', fontWeight: 700, color: 'var(--blue)' }}>{risk.risk_id}</Link></td>
                                      <td>{deptLabel(risk.dept_code)}</td>
                                      <td style={{ textAlign: 'center' }}>
                                        {lr ? (
                                          <span style={{ display: 'inline-block', padding: '2px 8px', borderRadius: 4, fontSize: 10, fontWeight: 700, color: RISK_LEVEL_COLOR[lr.risk_level], background: RISK_LEVEL_BG[lr.risk_level] }}>
                                            {RISK_LEVEL_LABEL[lr.risk_level]} · {(Math.round(lr.risk_score * 10) / 10).toFixed(1)}
                                          </span>
                                        ) : '—'}
                                      </td>
                                      <td style={{ fontSize: 12 }}>{item.discussion_notes || '—'}</td>
                                    </tr>
                                  )
                                })}
                              </tbody>
                            </table>
                          </div>
                        )}
                      </>
                    )}
                  </div>

                  <div className="panel">
                    <div className="pf"><div>
                      <div className="pt">Cross-cutting Issues (Isu Melintang)</div>
                      <div className="psub">Themes spanning multiple risks presented at the RTC — to inform the ROC</div>
                    </div></div>
                    {rocSummary.byTheme.length === 0 ? (
                      <div style={{ fontSize: 12, color: 'var(--muted)', fontStyle: 'italic' }}>
                        No cross-cutting themes tagged on the linked RTC risks yet. Tag risks by theme on the RTC meeting&apos;s agenda.
                      </div>
                    ) : (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                        {rocSummary.byTheme.map(({ theme, risks }) => (
                          <div key={theme.id} style={{ border: '1px solid var(--border)', borderRadius: 8, padding: '10px 12px' }}>
                            <div style={{ fontWeight: 700, fontSize: 13 }}>
                              {theme.name} <span style={{ color: 'var(--muted)', fontWeight: 400 }}>· {risks.length} risk{risks.length === 1 ? '' : 's'}</span>
                            </div>
                            {theme.description && <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>{theme.description}</div>}
                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
                              {risks.map((r) => (
                                <Link key={r.id} href={`/risk/${r.id}`} className="theme-pill">{r.risk_id} · {deptLabel(r.dept_code)}</Link>
                              ))}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </>
              )}

              {/* Agenda */}
              <div className="panel">
                <div className="pf" style={{ alignItems: 'flex-start' }}>
                  <div>
                    <div className="pt">Agenda — risks for discussion</div>
                    <div className="psub">
                      {agenda.length} item{agenda.length === 1 ? '' : 's'} across {groups.length} department{groups.length === 1 ? '' : 's'} · {decidedCount} decided
                    </div>
                  </div>
                  {agenda.length > 0 && (
                    <button type="button" className="signout-btn"
                      style={{ fontSize: 12, padding: '6px 14px', background: 'var(--blue)', color: '#fff', borderColor: 'var(--blue)' }}
                      onClick={() => setPresentIndex(0)}>
                      ▶ Present
                    </button>
                  )}
                </div>

                {isRC && (() => {
                  const tStatus = tabledStatus(meeting.meeting_type)
                  const tabledForThis = available.filter((r) => r.status === tStatus)
                  return (
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 14, flexWrap: 'wrap' }}>
                    <select value={pickRiskId} onChange={(e) => setPickRiskId(e.target.value)}
                      style={{ fontSize: 12, padding: '6px 8px', border: '1px solid var(--border)', borderRadius: 6, minWidth: 300 }}>
                      <option value="">
                        {available.length ? '— add a risk to the agenda —' : 'No risks available to add'}
                      </option>
                      {available.map((r) => (
                        <option key={r.id} value={r.id}>
                          {r.risk_id} · {deptLabel(r.dept_code)} · {RISK_STATUS_LABEL[r.status]}
                        </option>
                      ))}
                    </select>
                    <button type="button" className="signout-btn"
                      style={{ fontSize: 12, padding: '6px 12px', background: pickRiskId ? 'var(--blue)' : '#9CA3AF', color: '#fff', borderColor: pickRiskId ? 'var(--blue)' : '#9CA3AF' }}
                      disabled={!pickRiskId || busy} onClick={addToAgenda}>
                      + Add
                    </button>
                    {tabledForThis.length > 0 && (
                      <button type="button" className="signout-btn"
                        style={{ fontSize: 12, padding: '6px 12px' }}
                        disabled={busy} onClick={addAllTabled}>
                        + Add all newly tabled ({tabledForThis.length})
                      </button>
                    )}
                  </div>
                  )
                })()}

                {agenda.length === 0 ? (
                  <div style={{ fontSize: 13, color: 'var(--muted)', fontStyle: 'italic' }}>No risks on the agenda yet.</div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                    {groups.map((g) => (
                      <div key={g.deptCode}>
                        <div className="agenda-dept-head">
                          <span>{g.deptLabel}</span>
                          <span className="agenda-dept-count">{g.items.length} risk{g.items.length === 1 ? '' : 's'}</span>
                        </div>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                          {g.items.map(({ item, risk, latest }) => (
                            <AgendaItemCard
                              key={item.id}
                              item={item}
                              risk={risk}
                              latest={latest}
                              deptLabel={g.deptLabel}
                              meetingType={meeting.meeting_type}
                              isRC={isRC}
                              busy={busy}
                              decidedByName={nameOf(item.decided_by)}
                              themes={themes}
                              taggedThemeIds={tagsByRisk.get(risk.id) ?? []}
                              onToggleTheme={(themeId) => toggleTheme(risk.id, themeId)}
                              onAddCustomTheme={(name) => addCustomTheme(risk.id, name)}
                              onEditNotes={(text) => editDiscussionNotes(item, text)}
                              actionItems={actions.filter((a) => a.risk_id === risk.id)}
                              allDepts={allDepts}
                              deptNameOf={(c) => deptNames.get(c) ?? allDepts.find((d) => d.code === c)?.name_en ?? c}
                              onAddAction={(payload) => addActionItem(item.id, risk.id, payload)}
                              onDecide={(opts) => recordDecision(item, risk, opts)}
                              onRemove={() => removeAgendaItem(item)}
                            />
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Minutes */}
              <div className="panel">
                <div className="pf"><div><div className="pt">Minutes</div></div></div>
                {isRC ? (
                  <>
                    <textarea rows={5} value={minutesText} onChange={(e) => setMinutesText(e.target.value)}
                      placeholder="Meeting minutes / summary…"
                      style={{ width: '100%', padding: 8, border: '1px solid var(--border)', borderRadius: 6, fontFamily: 'inherit', fontSize: 13 }} />
                    <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 8 }}>
                      <button type="button" className="signout-btn"
                        style={{ background: 'var(--blue)', color: '#fff', borderColor: 'var(--blue)', fontSize: 12 }}
                        disabled={busy} onClick={saveMinutes}>Save minutes</button>
                    </div>
                  </>
                ) : (
                  <div style={{ fontSize: 13, whiteSpace: 'pre-wrap' }}>
                    {meeting.minutes || <em style={{ color: 'var(--muted)' }}>No minutes recorded.</em>}
                  </div>
                )}
              </div>
            </>
          )}
        </main>
      </div>
    </div>
  )
}

/* ---------- Presentation overlay ---------- */

function PresentOverlay({ entries, index, meetingTitle, onIndex, onClose }: {
  entries: AgendaEntry[]
  index: number
  meetingTitle: string
  onIndex: (i: number) => void
  onClose: () => void
}) {
  const n = entries.length
  const entry = entries[index]

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
      else if (e.key === 'ArrowRight' || e.key === ' ') onIndex(Math.min(index + 1, n - 1))
      else if (e.key === 'ArrowLeft') onIndex(Math.max(index - 1, 0))
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [index, n, onIndex, onClose])

  if (!entry) return null
  const { risk, latest } = entry
  const outcome = entry.item.outcome

  return (
    <div className="present-overlay">
      <div className="present-bar">
        <div className="present-bar-title">{meetingTitle}</div>
        <div className="present-bar-progress">Risk {index + 1} of {n}</div>
        <button type="button" className="present-close" onClick={onClose}>✕ Exit</button>
      </div>

      <div className="present-stage">
        <RiskSlideContent risk={risk} latest={latest} deptLabel={entry.deptLabel} outcome={outcome} />
      </div>

      <div className="present-foot">
        <button type="button" className="present-nav" disabled={index === 0} onClick={() => onIndex(index - 1)}>◀ Previous</button>
        <div className="present-dots">
          {entries.map((e, i) => (
            <span key={e.item.id}
              className={`present-dot ${i === index ? 'on' : ''} ${e.item.outcome ? 'done' : ''}`}
              onClick={() => onIndex(i)} />
          ))}
        </div>
        <button type="button" className="present-nav" disabled={index === n - 1} onClick={() => onIndex(index + 1)}>Next ▶</button>
      </div>
    </div>
  )
}

/* One risk rendered as a full-screen presentation slide (shared by the RTC
 * agenda stepper and the ROC deck). */
function RiskSlideContent({ risk, latest, deptLabel, outcome }: {
  risk: Risk
  latest: RiskReview | null
  deptLabel: string
  outcome?: CommitteeOutcome | null
}) {
  return (
    <div className="present-slide">
      <div className="present-dept">{deptLabel}</div>
      <div className="present-riskid">{risk.risk_id}</div>
      <div className="present-meta">
        <span><b>{risk.category}</b> — {RISK_CATEGORY_LABEL[risk.category]}</span>
        <span>{RISK_SCOPE_LABEL[risk.scope]}</span>
        <span className="present-status" style={{ color: RISK_STATUS_BADGE[risk.status].fg, background: RISK_STATUS_BADGE[risk.status].bg }}>
          {RISK_STATUS_LABEL[risk.status]}
        </span>
        {outcome && <span className="present-status" style={{ color: '#166534', background: '#DCFCE7' }}>
          Decision: {COMMITTEE_OUTCOME_LABEL[outcome]}
        </span>}
      </div>

      <div className="present-grid">
        <div className="present-col">
          <PresentBlock label="Risk description">{risk.description}</PresentBlock>
          <PresentBlock label="Cause">{risk.cause_description}</PresentBlock>
          <PresentBlock label="Impact">{risk.impact_description}</PresentBlock>
        </div>
        <div className="present-col">
          <PresentBlock label="Existing controls">{risk.existing_controls || '—'}</PresentBlock>
          <PresentBlock label="Additional controls proposed">{risk.additional_controls || '—'}</PresentBlock>
          <PresentBlock label="Action owner / period">
            {(risk.action_owner || '—')}{risk.implementation_period ? ` · ${risk.implementation_period}` : ''}
          </PresentBlock>

          {latest ? (
            <div className="present-score">
              <div className="present-score-cells">
                <Cell k="L" v={latest.likelihood} />
                <Cell k="Man" v={latest.impact_manusia} />
                <Cell k="Rep" v={latest.impact_reputasi} />
                <Cell k="Kew" v={latest.impact_kewangan} />
                <Cell k="Ops" v={latest.impact_operasi} />
                <Cell k="Obj" v={latest.impact_objektif} />
              </div>
              <div className="present-score-final"
                style={{ color: RISK_LEVEL_COLOR[latest.risk_level], background: RISK_LEVEL_BG[latest.risk_level] }}>
                {RISK_LEVEL_LABEL[latest.risk_level]} · {(Math.round(latest.risk_score * 10) / 10).toFixed(1)}
              </div>
            </div>
          ) : <PresentBlock label="Scoring">Not yet scored</PresentBlock>}
        </div>
      </div>
    </div>
  )
}

/* Full-screen ROC presentation deck — high-level summary of the risks
 * presented at the linked RTC sitting(s). One slide per breakdown; the
 * individual escalated-risk details are presented separately, not here. */
interface RocSummaryData {
  total: number
  escalatedCount: number
  byDept: { code: string; n: number }[]
  levelMap: Record<RiskLevel, number>
  byCycle: { cycle: number; n: number }[]
  byTheme: { theme: CrossCuttingTheme; risks: Risk[] }[]
}

function RocPresentOverlay({
  meetingTitle, linkedRtc, summary, deptLabel, onClose,
}: {
  meetingTitle: string
  linkedRtc: RiskMeeting[]
  summary: RocSummaryData
  deptLabel: (code: string) => string
  onClose: () => void
}) {
  const { total, escalatedCount, byDept, levelMap, byCycle, byTheme } = summary
  const levelOrder: RiskLevel[] = ['EKSTREM', 'TINGGI', 'SEDERHANA', 'RENDAH']
  const maxDept = Math.max(1, ...byDept.map((d) => d.n))

  const slides: ('overview' | 'dept' | 'level' | 'cycle' | 'crosscut')[] =
    ['overview', 'dept', 'level', 'cycle', 'crosscut']
  const n = slides.length
  const [index, setIndex] = useState(0)
  const i = Math.min(index, n - 1)
  const slide = slides[i]

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
      else if (e.key === 'ArrowRight' || e.key === ' ') setIndex((x) => Math.min(x + 1, n - 1))
      else if (e.key === 'ArrowLeft') setIndex((x) => Math.max(x - 1, 0))
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [n, onClose])

  const titleFor: Record<typeof slides[number], string> = {
    overview: 'Overview', dept: 'By Department', level: 'By Risk Level',
    cycle: 'By Review Cycle', crosscut: 'Cross-cutting Issues',
  }

  return (
    <div className="present-overlay">
      <div className="present-bar">
        <div className="present-bar-title">{meetingTitle} — RTC Summary</div>
        <div className="present-bar-progress">{titleFor[slide]} · {i + 1} of {n}</div>
        <button type="button" className="present-close" onClick={onClose}>✕ Exit</button>
      </div>

      <div className="present-stage">
        {slide === 'overview' && (
          <div className="present-slide">
            <div className="present-dept">RTC Summary</div>
            <div className="present-riskid" style={{ fontFamily: 'inherit', fontSize: 30 }}>Risks presented at the RTC</div>
            <div className="present-meta">
              {linkedRtc.map((rt) => <span key={rt.id}><b>{rt.title}</b> · {rt.meeting_date}</span>)}
            </div>
            <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginTop: 24 }}>
              <RocStat label="Total risks registered" n={total} accent />
              <RocStat label="Issues to discuss in ROC" n={escalatedCount} />
              <RocStat label="Departments involved" n={byDept.length} />
              <RocStat label="Cross-cutting themes" n={byTheme.length} />
            </div>
          </div>
        )}

        {slide === 'dept' && (
          <div className="present-slide">
            <div className="present-dept">By Department</div>
            <div className="present-riskid" style={{ fontFamily: 'inherit', fontSize: 30 }}>Risks per department</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 16 }}>
              {byDept.length === 0 && <div style={{ color: '#93A4C0' }}>No risks.</div>}
              {byDept.map((d) => (
                <div key={d.code} style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <div style={{ width: 280, fontSize: 16, color: '#F1F5F9', textAlign: 'right', flexShrink: 0 }}>{deptLabel(d.code)}</div>
                  <div style={{ flex: 1, background: '#16213C', borderRadius: 6, overflow: 'hidden', height: 26 }}>
                    <div style={{ width: `${(d.n / maxDept) * 100}%`, height: '100%', background: '#3B82F6', minWidth: 2 }} />
                  </div>
                  <div style={{ width: 36, fontSize: 18, fontWeight: 800, color: '#fff' }}>{d.n}</div>
                </div>
              ))}
            </div>
          </div>
        )}

        {slide === 'level' && (
          <div className="present-slide">
            <div className="present-dept">By Risk Level</div>
            <div className="present-riskid" style={{ fontFamily: 'inherit', fontSize: 30 }}>Risks by severity</div>
            <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginTop: 24 }}>
              {levelOrder.map((lv) => (
                <div key={lv} style={{ borderRadius: 12, padding: '18px 26px', minWidth: 150, background: RISK_LEVEL_BG[lv], border: `2px solid ${RISK_LEVEL_COLOR[lv]}` }}>
                  <div style={{ fontSize: 44, fontWeight: 800, color: RISK_LEVEL_COLOR[lv] }}>{levelMap[lv]}</div>
                  <div style={{ fontSize: 15, fontWeight: 700, color: RISK_LEVEL_COLOR[lv] }}>{RISK_LEVEL_LABEL[lv]}</div>
                </div>
              ))}
            </div>
          </div>
        )}

        {slide === 'cycle' && (
          <div className="present-slide">
            <div className="present-dept">By Review Cycle</div>
            <div className="present-riskid" style={{ fontFamily: 'inherit', fontSize: 30 }}>How many new vs. re-reviewed</div>
            <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginTop: 24 }}>
              {byCycle.length === 0 && <div style={{ color: '#93A4C0' }}>No scored risks yet.</div>}
              {byCycle.map(({ cycle, n: cn }) => (
                <RocStat key={cycle} label={cycle === 1 ? '1st cycle (new)' : `${cycle}${cycle === 2 ? 'nd' : cycle === 3 ? 'rd' : 'th'} cycle`} n={cn} accent={cycle === 1} />
              ))}
            </div>
          </div>
        )}

        {slide === 'crosscut' && (
          <div className="present-slide">
            <div className="present-dept">Cross-cutting Issues · Isu Melintang</div>
            <div className="present-riskid" style={{ fontFamily: 'inherit', fontSize: 30 }}>By theme</div>
            {byTheme.length === 0 ? (
              <div style={{ color: '#93A4C0', marginTop: 12 }}>No cross-cutting themes tagged.</div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 14, marginTop: 12 }}>
                {byTheme.map(({ theme, risks }) => (
                  <div key={theme.id}>
                    <div style={{ fontSize: 19, fontWeight: 700, color: '#fff' }}>
                      {theme.name} <span style={{ color: '#7DD3FC' }}>· {risks.length}</span>
                    </div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 6 }}>
                      {risks.map((r) => (
                        <span key={r.id} style={{ fontSize: 14, color: '#E5E7EB', background: '#16213C', borderRadius: 6, padding: '4px 10px' }}>
                          <span style={{ fontFamily: 'monospace', fontWeight: 700, color: '#7DD3FC' }}>{r.risk_id}</span>
                          <span style={{ color: '#93A4C0' }}> · {deptLabel(r.dept_code)}</span>
                        </span>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      <div className="present-foot">
        <button type="button" className="present-nav" disabled={i === 0} onClick={() => setIndex(i - 1)}>◀ Previous</button>
        <div className="present-dots">
          {slides.map((s, idx) => (
            <span key={s} className={`present-dot ${idx === i ? 'on' : ''}`} onClick={() => setIndex(idx)} />
          ))}
        </div>
        <button type="button" className="present-nav" disabled={i === n - 1} onClick={() => setIndex(i + 1)}>Next ▶</button>
      </div>
    </div>
  )
}

function RocStat({ label, n, accent }: { label: string; n: number; accent?: boolean }) {
  return (
    <div style={{
      background: accent ? '#1D4ED8' : '#16213C', borderRadius: 12, padding: '16px 22px', minWidth: 150,
    }}>
      <div style={{ fontSize: 40, fontWeight: 800, color: '#fff' }}>{n}</div>
      <div style={{ fontSize: 13, color: accent ? '#DBEAFE' : '#8DA2C0' }}>{label}</div>
    </div>
  )
}

function PresentBlock({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="present-block">
      <div className="present-block-label">{label}</div>
      <div className="present-block-value">{children}</div>
    </div>
  )
}

function Cell({ k, v }: { k: string; v: number }) {
  return (
    <div className="present-cell">
      <div className="present-cell-k">{k}</div>
      <div className="present-cell-v">{v}</div>
    </div>
  )
}

function CountPill({ label, n, strong }: { label: string; n: number; strong?: boolean }) {
  return (
    <div style={{
      border: '1px solid var(--border)', borderRadius: 8, padding: '6px 12px',
      background: strong ? '#EEF2FF' : '#fff', minWidth: 80,
    }}>
      <div style={{ fontSize: 18, fontWeight: 800, color: strong ? '#3730A3' : 'var(--text)' }}>{n}</div>
      <div style={{ fontSize: 10, color: 'var(--muted)' }}>{label}</div>
    </div>
  )
}

/* ---------- Agenda item card ---------- */

interface ScoreInputs {
  likelihood: number
  impact_manusia: number
  impact_reputasi: number
  impact_kewangan: number
  impact_operasi: number
  impact_objektif: number
}

function AgendaItemCard({
  item, risk, latest, deptLabel, meetingType, isRC, busy, decidedByName,
  themes, taggedThemeIds, onToggleTheme, onAddCustomTheme, onEditNotes,
  actionItems, allDepts, deptNameOf, onAddAction, onDecide, onRemove,
}: {
  item: RiskMeetingAgenda
  risk: Risk
  latest: RiskReview | null
  deptLabel: string
  meetingType: RiskMeeting['meeting_type']
  isRC: boolean
  busy: boolean
  decidedByName: string
  themes: CrossCuttingTheme[]
  taggedThemeIds: number[]
  onToggleTheme: (themeId: number) => void
  onAddCustomTheme: (name: string) => void
  onEditNotes: (text: string) => void
  actionItems: RiskActionItem[]
  allDepts: { code: string; name_en: string }[]
  deptNameOf: (code: string) => string
  onAddAction: (a: { action_type: ActionType; description: string; assigned_depts: string[]; due_date: string | null }) => void
  onDecide: (opts: { outcome: CommitteeOutcome; notes: string; rescore: ScoreInputs | null }) => void
  onRemove: () => void
}) {
  const [themesOpen, setThemesOpen] = useState(false)
  const [newTheme, setNewTheme] = useState('')
  const [editingNotes, setEditingNotes] = useState(false)
  const [notesEdit, setNotesEdit] = useState(item.discussion_notes ?? '')
  const [outcome, setOutcome] = useState<CommitteeOutcome | ''>('')
  const [notes, setNotes] = useState('')
  const [rescoreOpen, setRescoreOpen] = useState(false)
  const [scores, setScores] = useState<ScoreInputs>({
    likelihood: latest?.likelihood ?? 0,
    impact_manusia: latest?.impact_manusia ?? 0,
    impact_reputasi: latest?.impact_reputasi ?? 0,
    impact_kewangan: latest?.impact_kewangan ?? 0,
    impact_operasi: latest?.impact_operasi ?? 0,
    impact_objektif: latest?.impact_objektif ?? 0,
  })

  const decided = !!item.outcome
  const opts = allowedOutcomes(meetingType)

  const scoreComplete = scores.likelihood > 0 && scores.impact_manusia > 0 && scores.impact_reputasi > 0 &&
    scores.impact_kewangan > 0 && scores.impact_operasi > 0 && scores.impact_objektif > 0
  const computed = (rescoreOpen && scoreComplete)
    ? computeRiskScore(scores.likelihood, [scores.impact_manusia, scores.impact_reputasi, scores.impact_kewangan, scores.impact_operasi, scores.impact_objektif])
    : null

  const canSave = !!outcome && !busy && (!rescoreOpen || scoreComplete)

  return (
    <div className="panel" style={{ margin: 0, border: '1px solid var(--border)', boxShadow: 'none' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap' }}>
        <div style={{ minWidth: 0 }}>
          <Link href={`/risk/${risk.id}`} style={{ fontFamily: 'monospace', fontWeight: 700, color: 'var(--blue)' }}>
            {risk.risk_id}
          </Link>
          <span style={{ color: 'var(--muted)', fontSize: 12 }}> · {deptLabel}</span>
          <div style={{ fontSize: 13, marginTop: 4 }}>{risk.description}</div>
        </div>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexShrink: 0 }}>
          {latest && (
            <span style={{
              display: 'inline-block', padding: '3px 9px', borderRadius: 4, fontSize: 11, fontWeight: 700,
              color: RISK_LEVEL_COLOR[latest.risk_level], background: RISK_LEVEL_BG[latest.risk_level],
            }}>{RISK_LEVEL_LABEL[latest.risk_level]} · {(Math.round(latest.risk_score * 10) / 10).toFixed(1)}</span>
          )}
          <span style={{
            display: 'inline-block', padding: '3px 9px', borderRadius: 4, fontSize: 11, fontWeight: 700,
            color: RISK_STATUS_BADGE[risk.status].fg, background: RISK_STATUS_BADGE[risk.status].bg,
          }}>{RISK_STATUS_LABEL[risk.status]}</span>
        </div>
      </div>

      {/* Cross-cutting themes — RC tags these during the RTC; ROC sees the summary */}
      {(taggedThemeIds.length > 0 || (isRC && meetingType === 'RTC')) && (
        <div style={{ marginTop: 8, display: 'flex', flexWrap: 'wrap', gap: 5, alignItems: 'center' }}>
          {taggedThemeIds.length > 0 && <span style={{ fontSize: 11, color: 'var(--muted)' }}>Cross-cutting:</span>}
          {taggedThemeIds.map((tid) => {
            const t = themes.find((x) => x.id === tid)
            return <span key={tid} className="theme-pill active">{t?.name ?? `#${tid}`}</span>
          })}
          {isRC && meetingType === 'RTC' && (
            <div style={{ position: 'relative' }}>
              <button type="button" className="role-pill role-pill-add" onClick={() => setThemesOpen((v) => !v)}>
                {taggedThemeIds.length ? 'edit themes' : '+ cross-cutting theme'}
              </button>
              {themesOpen && (
                <div className="theme-menu">
                  {themes.map((t) => {
                    const on = taggedThemeIds.includes(t.id)
                    return (
                      <button key={t.id} type="button" className={`theme-menu-item ${on ? 'on' : ''}`}
                        disabled={busy} onClick={() => onToggleTheme(t.id)}>
                        <span className="theme-menu-check">{on ? '✓' : ''}</span>{t.name}
                      </button>
                    )
                  })}
                  <div style={{ borderTop: '1px solid var(--border)', marginTop: 4, paddingTop: 6, display: 'flex', gap: 6 }}>
                    <input type="text" value={newTheme} onChange={(e) => setNewTheme(e.target.value)}
                      placeholder="New theme…" disabled={busy}
                      onKeyDown={(e) => { if (e.key === 'Enter' && newTheme.trim()) { onAddCustomTheme(newTheme.trim()); setNewTheme('') } }}
                      style={{ flex: 1, fontSize: 12, padding: '4px 6px', border: '1px solid var(--border)', borderRadius: 6 }} />
                    <button type="button" className="signout-btn" style={{ fontSize: 11, padding: '4px 8px' }}
                      disabled={busy || !newTheme.trim()}
                      onClick={() => { onAddCustomTheme(newTheme.trim()); setNewTheme('') }}>Add</button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {decided ? (
        <div style={{ marginTop: 10 }}>
          <div className="ac" style={{ background: '#F0FDF4', border: '1px solid #BBF7D0' }}>
            <div className="ai">✓</div>
            <div>
              <div className="at">Decision: {COMMITTEE_OUTCOME_LABEL[item.outcome as CommitteeOutcome]}</div>
              <div className="as">
                Recorded by {decidedByName}{item.decided_at ? ` on ${item.decided_at.slice(0, 10)}` : ''}
                {item.review_id ? ' · re-scored' : ''}
                {item.discussion_notes ? ` — ${item.discussion_notes}` : ''}
              </div>
            </div>
          </div>
          {isRC && (editingNotes ? (
            <div style={{ marginTop: 8 }}>
              <textarea rows={2} value={notesEdit} onChange={(e) => setNotesEdit(e.target.value)}
                placeholder="Discussion notes…"
                style={{ width: '100%', padding: 8, border: '1px solid var(--border)', borderRadius: 6, fontFamily: 'inherit', fontSize: 12 }} />
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 6, marginTop: 6 }}>
                <button type="button" className="signout-btn" style={{ fontSize: 11, padding: '4px 10px' }}
                  onClick={() => { setNotesEdit(item.discussion_notes ?? ''); setEditingNotes(false) }}>Cancel</button>
                <button type="button" className="signout-btn"
                  style={{ fontSize: 11, padding: '4px 12px', background: 'var(--blue)', color: '#fff', borderColor: 'var(--blue)' }}
                  disabled={busy} onClick={() => { onEditNotes(notesEdit); setEditingNotes(false) }}>Save notes</button>
              </div>
            </div>
          ) : (
            <div style={{ marginTop: 6 }}>
              <button type="button" className="signout-btn" style={{ fontSize: 11, padding: '4px 10px' }}
                onClick={() => { setNotesEdit(item.discussion_notes ?? ''); setEditingNotes(true) }}>✎ Edit discussion notes</button>
            </div>
          ))}
        </div>
      ) : !isRC ? (
        <div style={{ marginTop: 10, fontSize: 12, color: 'var(--muted)', fontStyle: 'italic' }}>
          Awaiting the committee&apos;s decision (recorded by the RC).
        </div>
      ) : (
        <div style={{ marginTop: 12, borderTop: '1px dashed var(--border)', paddingTop: 12 }}>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            <select value={outcome} onChange={(e) => setOutcome(e.target.value as CommitteeOutcome)}
              style={{ fontSize: 12, padding: '6px 8px', border: '1px solid var(--border)', borderRadius: 6 }}>
              <option value="">— decision —</option>
              {opts.map((o) => <option key={o} value={o}>{COMMITTEE_OUTCOME_LABEL[o]}</option>)}
            </select>
            <button type="button" className="signout-btn" style={{ fontSize: 11, padding: '6px 10px' }}
              onClick={() => setRescoreOpen((v) => !v)}>
              {rescoreOpen ? 'Cancel re-score' : '✎ Re-score'}
            </button>
            {outcome && (
              <span style={{ fontSize: 11, color: 'var(--muted)' }}>
                → moves risk to <b>{RISK_STATUS_LABEL[outcomeToStatus(outcome)]}</b>
              </span>
            )}
          </div>

          {rescoreOpen && (
            <div style={{ marginTop: 10 }}>
              <div className="risk-form-grid">
                <ScorePicker label="Likelihood" value={scores.likelihood} onChange={(v) => setScores({ ...scores, likelihood: v })} />
                <ScorePicker label="Manusia" value={scores.impact_manusia} onChange={(v) => setScores({ ...scores, impact_manusia: v })} />
                <ScorePicker label="Reputasi" value={scores.impact_reputasi} onChange={(v) => setScores({ ...scores, impact_reputasi: v })} />
                <ScorePicker label="Kewangan" value={scores.impact_kewangan} onChange={(v) => setScores({ ...scores, impact_kewangan: v })} />
                <ScorePicker label="Operasi" value={scores.impact_operasi} onChange={(v) => setScores({ ...scores, impact_operasi: v })} />
                <ScorePicker label="Objektif" value={scores.impact_objektif} onChange={(v) => setScores({ ...scores, impact_objektif: v })} />
              </div>
              {computed && (
                <div style={{ fontSize: 12, marginTop: 6 }}>
                  New score: <b>{(Math.round(computed.riskScore * 10) / 10).toFixed(1)}</b> ·{' '}
                  <span style={{ color: RISK_LEVEL_COLOR[computed.riskLevel], fontWeight: 700 }}>{RISK_LEVEL_LABEL[computed.riskLevel]}</span>
                </div>
              )}
            </div>
          )}

          <textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)}
            placeholder="Discussion notes (shown to the department if sent back)…"
            style={{ width: '100%', marginTop: 10, padding: 8, border: '1px solid var(--border)', borderRadius: 6, fontFamily: 'inherit', fontSize: 12 }} />

          <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 8 }}>
            <button type="button" className="role-pill" onClick={onRemove} disabled={busy}>Remove from agenda</button>
            <button type="button" className="signout-btn"
              style={{ fontSize: 12, padding: '6px 14px', background: canSave ? 'var(--blue)' : '#9CA3AF', color: '#fff', borderColor: canSave ? 'var(--blue)' : '#9CA3AF', cursor: canSave ? 'pointer' : 'not-allowed' }}
              disabled={!canSave}
              onClick={() => onDecide({ outcome: outcome as CommitteeOutcome, notes, rescore: rescoreOpen ? scores : null })}>
              Record decision
            </button>
          </div>
        </div>
      )}

      {/* Action items for THIS risk — directives go to the risk's department */}
      {(actionItems.length > 0 || isRC) && (
        <div style={{ marginTop: 12, borderTop: '1px solid var(--border)', paddingTop: 10 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '.04em', marginBottom: 6 }}>
            Action items{actionItems.length > 0 ? ` (${actionItems.length})` : ''}
          </div>
          {actionItems.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 5, marginBottom: isRC ? 10 : 0 }}>
              {actionItems.map((a) => (
                <div key={a.id} style={{ fontSize: 12, display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                  <span style={{ fontWeight: 600 }}>{ACTION_TYPE_LABEL[a.action_type]}:</span>
                  <span>{a.description}</span>
                  <span style={{ color: 'var(--muted)' }}>→ {(a.assigned_depts ?? []).map(deptNameOf).join(', ') || '—'}{a.due_date ? ` · due ${a.due_date}` : ''}</span>
                  <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--muted)' }}>[{ACTION_STATUS_LABEL[a.status]}]</span>
                </div>
              ))}
            </div>
          )}
          {isRC && <AddActionForm depts={allDepts} busy={busy} onAdd={onAddAction} />}
        </div>
      )}
    </div>
  )
}

function ScorePicker({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }) {
  return (
    <div className="risk-field">
      <label style={{ fontSize: 11 }}>{label}</label>
      <div className="score-pills">
        {[1, 2, 3, 4, 5].map((n) => (
          <button key={n} type="button" className={`score-pill ${value === n ? 'active' : ''}`} onClick={() => onChange(n)}>{n}</button>
        ))}
      </div>
    </div>
  )
}

/* ---------- Add action item form ---------- */

function AddActionForm({ depts, busy, onAdd }: {
  depts: { code: string; name_en: string }[]
  busy: boolean
  onAdd: (a: { action_type: ActionType; description: string; assigned_depts: string[]; due_date: string | null }) => void
}) {
  const [type, setType] = useState<ActionType>('DIRECTIVE')
  const [desc, setDesc] = useState('')
  const [assigned, setAssigned] = useState<string[]>([])
  const [due, setDue] = useState('')

  const ready = desc.trim() && assigned.length > 0
  const addDept = (code: string) => { if (code && !assigned.includes(code)) setAssigned([...assigned, code]) }
  const removeDept = (code: string) => setAssigned(assigned.filter((c) => c !== code))
  const nameOfDept = (c: string) => depts.find((d) => d.code === c)?.name_en ?? c

  const submit = () => {
    if (!ready) return
    onAdd({ action_type: type, description: desc, assigned_depts: assigned, due_date: due || null })
    setDesc(''); setAssigned([]); setDue(''); setType('DIRECTIVE')
  }

  return (
    <div style={{ borderTop: '1px dashed var(--border)', paddingTop: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ fontSize: 12, fontWeight: 600 }}>+ Add action item</div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <select value={type} onChange={(e) => setType(e.target.value as ActionType)}
          style={{ fontSize: 12, padding: '6px 8px', border: '1px solid var(--border)', borderRadius: 6 }}>
          <option value="DIRECTIVE">{ACTION_TYPE_LABEL.DIRECTIVE}</option>
          <option value="CLARIFICATION">{ACTION_TYPE_LABEL.CLARIFICATION}</option>
        </select>
        <select value="" onChange={(e) => { addDept(e.target.value); e.currentTarget.selectedIndex = 0 }}
          style={{ fontSize: 12, padding: '6px 8px', border: '1px solid var(--border)', borderRadius: 6, minWidth: 200 }}>
          <option value="">+ assign to department…</option>
          {depts.filter((d) => !assigned.includes(d.code)).map((d) => <option key={d.code} value={d.code}>{d.name_en}</option>)}
        </select>
        <input type="date" value={due} onChange={(e) => setDue(e.target.value)}
          style={{ fontSize: 12, padding: '6px 8px', border: '1px solid var(--border)', borderRadius: 6 }} />
      </div>
      {assigned.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
          {assigned.map((c) => (
            <button key={c} type="button" className="theme-pill active" onClick={() => removeDept(c)}
              title="Click to remove">{nameOfDept(c)} ×</button>
          ))}
        </div>
      )}
      <textarea rows={2} value={desc} onChange={(e) => setDesc(e.target.value)} placeholder="What needs to be done…"
        style={{ width: '100%', padding: 8, border: '1px solid var(--border)', borderRadius: 6, fontFamily: 'inherit', fontSize: 12 }} />
      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
        <button type="button" className="signout-btn"
          style={{ fontSize: 12, padding: '6px 14px', background: ready ? 'var(--blue)' : '#9CA3AF', color: '#fff', borderColor: ready ? 'var(--blue)' : '#9CA3AF' }}
          disabled={!ready || busy} onClick={submit}>Add action</button>
      </div>
    </div>
  )
}
