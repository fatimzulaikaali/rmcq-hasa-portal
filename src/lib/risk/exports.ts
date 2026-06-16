/* Risk module — downloadable exports (Excel + PDF).
 *
 * Excel uses SheetJS (already a dep). PDF uses the same window.print() pattern
 * the PSCS module uses: build an HTML string with @media print CSS, open it in
 * a new window, the popup auto-fires window.print() on load and the user picks
 * "Save as PDF" from the system dialog. No new runtime deps.
 *
 * Three exports are wired here:
 *   - Risk Register      (xlsx + pdf)  — used by /risk
 *   - Meeting Minutes    (pdf + xlsx)  — used by /risk/meetings/[id]
 *   - Action Items list  (xlsx + pdf)  — used by /risk/actions
 *
 * Every export captures the active filter and a MYT timestamp in the header so
 * the recipient of a printout can tell what they're looking at without having
 * to ask. */
import * as XLSX from 'xlsx'
import type {
  Risk, RiskListRow, RiskDept, RiskMeeting, RiskMeetingAgenda, RiskActionItem,
  CommitteeOutcome, CrossCuttingTheme,
} from './types'
import {
  RISK_CATEGORY_LABEL, RISK_LEVEL_LABEL, RISK_SCOPE_LABEL, RISK_STATUS_LABEL,
  COMMITTEE_OUTCOME_LABEL, MEETING_TYPE_LABEL, MEETING_STATUS_LABEL,
  ACTION_TYPE_LABEL, ACTION_STATUS_LABEL,
} from './scoring'

const TZ = 'Asia/Kuala_Lumpur'

/* ---------------- shared helpers ---------------- */

function fmtMytTimestamp(): string {
  return new Intl.DateTimeFormat('en-CA', {
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false, timeZone: TZ,
  }).format(new Date()).replace(',', '')
}

function fmtMytDate(): string {
  return new Intl.DateTimeFormat('en-CA', {
    year: 'numeric', month: '2-digit', day: '2-digit', timeZone: TZ,
  }).format(new Date())
}

/* Convert an arbitrary string to something safe for use in a filename. */
function slug(s: string): string {
  return (s || '')
    .replace(/[^a-zA-Z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'export'
}

function htmlEsc(s: string | number | null | undefined): string {
  if (s === null || s === undefined) return ''
  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;')
}

/* Open a popup that renders the given HTML and fires window.print() on load. */
function openPrintWindow(title: string, body: string, opts?: { landscape?: boolean }): void {
  const w = window.open('', '_blank')
  if (!w) {
    alert('Please allow pop-ups for this site to download the PDF.')
    return
  }
  const orientation = opts?.landscape ? 'landscape' : 'portrait'
  const css = `
    @page { size: A4 ${orientation}; margin: 12mm; }
    @media print { .no-print { display: none !important; } }
    * { box-sizing: border-box; }
    body { font-family: 'Segoe UI', Roboto, system-ui, sans-serif; color: #111827; font-size: 10px; margin: 0; }
    h1 { font-size: 18px; margin: 0 0 4px 0; color: #0F172A; }
    h2 { font-size: 13px; margin: 18px 0 6px 0; color: #1D4ED8; }
    h3 { font-size: 11px; margin: 14px 0 4px 0; color: #0F172A; }
    .meta { font-size: 9px; color: #6B7280; margin-bottom: 12px; }
    .meta b { color: #0F172A; font-weight: 600; }
    .meta-line { margin: 1px 0; }
    table { width: 100%; border-collapse: collapse; margin-top: 4px; }
    th, td { border-bottom: 1px solid #E5E7EB; padding: 5px 7px; text-align: left; vertical-align: top; font-size: 9.5px; }
    th { background: #F8FAFC; color: #475569; font-weight: 700; font-size: 8.5px; text-transform: uppercase; letter-spacing: .04em; }
    td.num { text-align: right; font-variant-numeric: tabular-nums; }
    td.center { text-align: center; }
    .mono { font-family: ui-monospace, Menlo, Consolas, monospace; font-weight: 700; }
    .badge { display: inline-block; padding: 1.5px 7px; border-radius: 3px; font-weight: 700; font-size: 8.5px; }
    .lvl-EKSTREM { background: #FEE2E2; color: #991B1B; }
    .lvl-TINGGI { background: #FED7AA; color: #9A3412; }
    .lvl-SEDERHANA { background: #FEF3C7; color: #92400E; }
    .lvl-RENDAH { background: #DCFCE7; color: #166534; }
    .st { background: #E2E8F0; color: #1E293B; }
    .st-ACTIVE { background: #DBEAFE; color: #1E40AF; }
    .st-PENDING_HOD, .st-PENDING_RC, .st-PENDING_CLOSURE, .st-TABLED_RTC, .st-TABLED_ROC { background: #FEF3C7; color: #854D0E; }
    .st-CLOSED { background: #DCFCE7; color: #166534; }
    .st-OUT_OF_SCOPE, .st-REJECTED, .st-RETURNED { background: #FEE2E2; color: #991B1B; }
    .st-DRAFT { background: #E5E7EB; color: #1F2937; }
    .st-MONITORING { background: #CFFAFE; color: #155E75; }
    .at-DIRECTIVE { background: #FEE2E2; color: #991B1B; }
    .at-CLARIFICATION { background: #DBEAFE; color: #1E40AF; }
    .as-PENDING { background: #FEF3C7; color: #854D0E; }
    .as-RESPONDED { background: #DBEAFE; color: #1E40AF; }
    .as-ACCEPTED { background: #DCFCE7; color: #166534; }
    .as-OVERDUE { background: #FEE2E2; color: #991B1B; }
    .as-ESCALATED { background: #EDE9FE; color: #5B21B6; }
    .oc-ENDORSE_ACTIVE { background: #DCFCE7; color: #166534; }
    .oc-ESCALATE_ROC { background: #EDE9FE; color: #5B21B6; }
    .oc-SEND_BACK_DEPT, .oc-SEND_BACK_RTC { background: #FED7AA; color: #9A3412; }
    .oc-RECOMMEND_CLOSE { background: #E5E7EB; color: #1F2937; }
    .group-head { background: #EEF2FF; color: #312E81; font-weight: 700; padding: 6px 8px; margin-top: 14px; border-radius: 4px; font-size: 10px; }
    .card { border: 1px solid #E5E7EB; border-radius: 6px; padding: 8px 10px; margin: 6px 0; page-break-inside: avoid; }
    .card-h { font-size: 11px; font-weight: 700; color: #0F172A; }
    .card-sub { font-size: 9px; color: #6B7280; margin-top: 2px; }
    .card-body { font-size: 10px; color: #1F2937; margin-top: 4px; }
    .card-resp { background: #F8FAFC; border: 1px dashed #94A3B8; border-radius: 4px; padding: 5px 7px; margin-top: 5px; font-size: 9.5px; }
    .pre-wrap { white-space: pre-wrap; }
    .small { font-size: 9px; color: #475569; }
    .end-note { text-align: center; margin-top: 18px; color: #94A3B8; font-size: 9px; }
    .sig { margin-top: 28px; display: flex; gap: 60px; }
    .sig div { flex: 1; border-top: 1px solid #94A3B8; padding-top: 4px; font-size: 9px; color: #475569; }
    .agenda-item { page-break-inside: avoid; margin: 8px 0; }
    .agenda-item .ai-h { font-size: 11px; font-weight: 700; color: #0F172A; }
    .agenda-item .ai-meta { font-size: 9px; color: #6B7280; margin: 1px 0 4px; }
    .agenda-item .ai-row { display: flex; gap: 14px; font-size: 9.5px; margin: 1px 0; }
    .agenda-item .ai-label { color: #6B7280; min-width: 90px; }
    .summary-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; margin: 8px 0; }
    .summary-tile { border: 1px solid #E5E7EB; border-radius: 6px; padding: 8px 10px; }
    .summary-tile .v { font-size: 18px; font-weight: 800; color: #1D4ED8; }
    .summary-tile .l { font-size: 9px; color: #6B7280; text-transform: uppercase; letter-spacing: .04em; }
  `
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>${htmlEsc(title)}</title><style>${css}</style></head><body>${body}<script>window.onload=()=>setTimeout(()=>window.print(),60);<\/script></body></html>`
  w.document.open(); w.document.write(html); w.document.close()
}

/* ---------------- dept name resolver ---------------- */

function deptResolver(depts: { code: string; name_en: string }[]) {
  const map = new Map<string, string>()
  for (const d of depts) map.set(d.code, d.name_en)
  return (code: string | null | undefined) => (code ? map.get(code) ?? code : '')
}

function actionOwnerLabel(r: Risk, deptName: (c: string) => string): string {
  if (r.action_owner_depts && r.action_owner_depts.length) {
    return r.action_owner_depts.map(deptName).join(', ')
  }
  return r.action_owner ?? ''
}

/* ---------------- 1) Risk Register export ---------------- */

export interface RegisterFilterContext {
  view: 'attention' | 'active' | 'archive'
  status: string
  level: string
  category: string
  deptCode: string
}

function describeRegisterFilter(f: RegisterFilterContext, deptName: (c: string) => string): string[] {
  const lines: string[] = []
  lines.push(`Tab: ${f.view === 'attention' ? 'Needs attention' : f.view === 'archive' ? 'Archive' : 'Active Register'}`)
  if (f.status !== 'all') lines.push(`Status: ${RISK_STATUS_LABEL[f.status as keyof typeof RISK_STATUS_LABEL] ?? f.status}`)
  if (f.level !== 'all') lines.push(`Level: ${RISK_LEVEL_LABEL[f.level as keyof typeof RISK_LEVEL_LABEL] ?? f.level}`)
  if (f.category !== 'all') lines.push(`Category: ${f.category}`)
  if (f.deptCode !== 'all') lines.push(`Department: ${deptName(f.deptCode)}`)
  return lines
}

export function exportRegisterXlsx(
  rows: RiskListRow[],
  filter: RegisterFilterContext,
  depts: RiskDept[],
): void {
  const deptName = deptResolver(depts)
  const filterLines = describeRegisterFilter(filter, deptName)

  const HEAD_ROWS = [
    ['Risk Register Export'],
    [`Generated: ${fmtMytTimestamp()} MYT`],
    ['Hospital Al-Sultan Abdullah UiTM · RMCQ'],
    [`Risks exported: ${rows.length}`],
    [`Filter — ${filterLines.join(' · ')}`],
    [],
  ]

  const COLUMNS = [
    'Risk ID', 'Department', 'Category', 'Category meaning', 'Scope',
    'Status', 'Risk Level', 'Risk Score', 'Avg Impact',
    'L', 'Manusia', 'Reputasi', 'Kewangan', 'Operasi', 'Objektif',
    'Latest cycle', 'Latest review date',
    'Description', 'Cause', 'Impact',
    'Existing controls', 'Additional controls',
    'Action owner', 'Implementation period', 'Notes',
    'Date opened', 'Date closed',
  ]

  const dataRows = rows.map(({ risk, dept, latest }) => [
    risk.risk_id,
    dept?.name_en ?? risk.dept_code,
    risk.category,
    RISK_CATEGORY_LABEL[risk.category] ?? '',
    RISK_SCOPE_LABEL[risk.scope] ?? '',
    RISK_STATUS_LABEL[risk.status] ?? risk.status,
    latest ? RISK_LEVEL_LABEL[latest.risk_level] : '',
    latest ? Math.round(latest.risk_score * 10) / 10 : '',
    latest ? Math.round(latest.avg_impact * 10) / 10 : '',
    latest?.likelihood ?? '',
    latest?.impact_manusia ?? '',
    latest?.impact_reputasi ?? '',
    latest?.impact_kewangan ?? '',
    latest?.impact_operasi ?? '',
    latest?.impact_objektif ?? '',
    latest?.cycle_number ?? '',
    latest?.review_date ?? '',
    risk.description,
    risk.cause_description,
    risk.impact_description,
    risk.existing_controls ?? '',
    risk.additional_controls ?? '',
    actionOwnerLabel(risk, deptName),
    risk.implementation_period ?? '',
    risk.notes ?? '',
    risk.date_opened?.slice(0, 10) ?? '',
    risk.date_closed?.slice(0, 10) ?? '',
  ])

  const ws = XLSX.utils.aoa_to_sheet([...HEAD_ROWS, COLUMNS, ...dataRows])
  // Column widths — narrower numeric, wider text
  const widths = [16, 28, 8, 28, 14, 22, 14, 10, 10, 6, 9, 9, 9, 9, 9, 8, 14, 50, 50, 50, 40, 40, 28, 22, 50, 12, 12]
  ws['!cols'] = widths.map((w) => ({ wch: w }))

  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'Risk Register')
  XLSX.writeFile(wb, `risk-register_${fmtMytDate()}.xlsx`)
}

export function exportRegisterPdf(
  rows: RiskListRow[],
  filter: RegisterFilterContext,
  depts: RiskDept[],
): void {
  const deptName = deptResolver(depts)
  const filterLines = describeRegisterFilter(filter, deptName)
  const title = `Risk Register · ${fmtMytDate()}`

  const tbody = rows.map(({ risk, dept, latest }) => `
    <tr>
      <td class="mono">${htmlEsc(risk.risk_id)}</td>
      <td>${htmlEsc(dept?.name_en ?? risk.dept_code)}</td>
      <td><b>${htmlEsc(risk.category)}</b></td>
      <td>${htmlEsc(risk.description)}</td>
      <td class="center">${latest ? `<span class="badge lvl-${latest.risk_level}">${htmlEsc(RISK_LEVEL_LABEL[latest.risk_level])}</span>` : '—'}</td>
      <td class="num">${latest ? (Math.round(latest.risk_score * 10) / 10).toFixed(1) : '—'}</td>
      <td class="center">${latest?.cycle_number ?? '—'}</td>
      <td class="center"><span class="badge st st-${htmlEsc(risk.status)}">${htmlEsc(RISK_STATUS_LABEL[risk.status] ?? risk.status)}</span></td>
      <td>${htmlEsc(actionOwnerLabel(risk, deptName))}</td>
      <td>${htmlEsc(risk.date_opened?.slice(0, 10) ?? '')}</td>
    </tr>
  `).join('')

  const body = `
    <h1>Risk Register</h1>
    <div class="meta">
      <div class="meta-line"><b>Generated:</b> ${htmlEsc(fmtMytTimestamp())} MYT</div>
      <div class="meta-line"><b>Hospital:</b> Hospital Al-Sultan Abdullah UiTM &middot; RMCQ</div>
      <div class="meta-line"><b>Filter:</b> ${filterLines.map(htmlEsc).join(' &middot; ')}</div>
      <div class="meta-line"><b>Risks shown:</b> ${rows.length}</div>
    </div>
    ${rows.length === 0 ? '<p class="small">No risks match the current filter.</p>' : `
    <table>
      <thead>
        <tr>
          <th>Risk ID</th><th>Department</th><th>Cat.</th><th>Description</th>
          <th style="text-align:center">Level</th><th style="text-align:right">Score</th>
          <th style="text-align:center">Cycle</th><th style="text-align:center">Status</th>
          <th>Action owner</th><th>Opened</th>
        </tr>
      </thead>
      <tbody>${tbody}</tbody>
    </table>`}
    <div class="end-note">— end of register —</div>
  `
  openPrintWindow(title, body, { landscape: true })
}

/* ---------------- 2) Meeting minutes export ---------------- */

export interface MeetingExportData {
  meeting: RiskMeeting
  agenda: RiskMeetingAgenda[]
  risksById: Map<number, Risk>
  latestByRisk: Map<number, { risk_level: string; risk_score: number; cycle_number: number }>
  actions: RiskActionItem[]            // action items issued AT this meeting
  depts: { code: string; name_en: string }[]
  users: { id: number; name: string }[]
  chairName: string | null
  themes: CrossCuttingTheme[]          // available themes (for label lookup)
  themeTagsByRisk: Map<number, number[]>  // risk_id → theme_ids
  rocSummary?: {
    total: number
    escalatedCount: number
    byDept: { code: string; n: number }[]
    levelMap: Record<string, number>
    byCycle: { cycle: number; n: number }[]
    byTheme: { theme: CrossCuttingTheme; risks: Risk[] }[]
    linkedRtc: RiskMeeting[]
  }
}

function groupAgendaByDept(
  data: MeetingExportData,
): { deptLabel: string; deptCode: string; items: { item: RiskMeetingAgenda; risk: Risk }[] }[] {
  const deptName = deptResolver(data.depts)
  const byDept = new Map<string, { deptCode: string; deptLabel: string; items: { item: RiskMeetingAgenda; risk: Risk }[] }>()
  for (const item of data.agenda) {
    const risk = data.risksById.get(item.risk_id)
    if (!risk) continue
    const label = deptName(risk.dept_code)
    if (!byDept.has(risk.dept_code)) byDept.set(risk.dept_code, { deptCode: risk.dept_code, deptLabel: label, items: [] })
    byDept.get(risk.dept_code)!.items.push({ item, risk })
  }
  return Array.from(byDept.values())
    .map((g) => ({ ...g, items: g.items.sort((a, b) => a.risk.risk_id.localeCompare(b.risk.risk_id)) }))
    .sort((a, b) => a.deptLabel.localeCompare(b.deptLabel))
}

export function exportMeetingMinutesPdf(data: MeetingExportData): void {
  const deptName = deptResolver(data.depts)
  const userName = (uid: number | null | undefined) =>
    uid ? (data.users.find((u) => u.id === uid)?.name ?? `user #${uid}`) : ''
  const themeName = (id: number) => data.themes.find((t) => t.id === id)?.name ?? `#${id}`
  const groups = groupAgendaByDept(data)
  const decided = data.agenda.filter((a) => a.outcome).length

  const summaryBlock = data.rocSummary && data.rocSummary.linkedRtc.length > 0 ? `
    <h2>RTC Summary</h2>
    <div class="small">Roll-up of the linked RTC sitting${data.rocSummary.linkedRtc.length === 1 ? '' : 's'}: ${
      data.rocSummary.linkedRtc.map((m) => `${htmlEsc(m.title)} (${htmlEsc(m.meeting_date)})`).join(', ')
    }</div>
    <div class="summary-grid">
      <div class="summary-tile"><div class="v">${data.rocSummary.total}</div><div class="l">Total presented</div></div>
      <div class="summary-tile"><div class="v">${data.rocSummary.escalatedCount}</div><div class="l">Escalated to ROC</div></div>
      <div class="summary-tile"><div class="v">${data.rocSummary.byDept.length}</div><div class="l">Departments</div></div>
      <div class="summary-tile"><div class="v">${data.rocSummary.byTheme.length}</div><div class="l">Cross-cutting themes</div></div>
    </div>
    ${data.rocSummary.byTheme.length > 0 ? `
      <h3>Cross-cutting themes</h3>
      <table>
        <thead><tr><th>Theme</th><th>Risks</th></tr></thead>
        <tbody>${data.rocSummary.byTheme.map((g) => `
          <tr><td><b>${htmlEsc(g.theme.name)}</b></td>
              <td>${g.risks.map((r) => `<span class="mono">${htmlEsc(r.risk_id)}</span> · ${htmlEsc(deptName(r.dept_code))}`).join('<br/>')}</td></tr>
        `).join('')}</tbody>
      </table>
    ` : ''}
  ` : ''

  const agendaBlocks = groups.map((g) => `
    <div class="group-head">${htmlEsc(g.deptLabel)} <span style="color:#6B7280;font-weight:400">· ${g.items.length} risk${g.items.length === 1 ? '' : 's'}</span></div>
    ${g.items.map(({ item, risk }) => {
      const latest = data.latestByRisk.get(risk.id)
      const itemActions = data.actions.filter((a) => a.risk_id === risk.id)
      const themes = (data.themeTagsByRisk.get(risk.id) ?? []).map(themeName)
      return `
        <div class="agenda-item">
          <div class="ai-h"><span class="mono">${htmlEsc(risk.risk_id)}</span> · ${htmlEsc(risk.description)}</div>
          <div class="ai-meta">
            ${htmlEsc(risk.category)} — ${htmlEsc(RISK_CATEGORY_LABEL[risk.category] ?? '')}
            ${latest ? ` · Level <span class="badge lvl-${latest.risk_level}">${htmlEsc(RISK_LEVEL_LABEL[latest.risk_level as keyof typeof RISK_LEVEL_LABEL])}</span> · Score ${(Math.round(latest.risk_score * 10) / 10).toFixed(1)} · Cycle ${latest.cycle_number}` : ''}
            ${item.pre_meeting_scoring ? ` · <span style="color:#6B7280">Pre-meeting:</span> <span class="badge lvl-${item.pre_meeting_scoring.risk_level}">${htmlEsc(RISK_LEVEL_LABEL[item.pre_meeting_scoring.risk_level as keyof typeof RISK_LEVEL_LABEL])}</span> ${(Math.round(item.pre_meeting_scoring.risk_score * 10) / 10).toFixed(1)}` : ''}
            ${themes.length > 0 ? ` · Themes: ${themes.map(htmlEsc).join(', ')}` : ''}
          </div>
          <div class="ai-row"><span class="ai-label">Decision</span>
            <span>${item.outcome
              ? `<span class="badge oc-${item.outcome}">${htmlEsc(COMMITTEE_OUTCOME_LABEL[item.outcome as CommitteeOutcome])}</span>${item.decided_at ? ` <span class="small">recorded on ${htmlEsc(item.decided_at.slice(0, 10))}${item.decided_by ? ` by ${htmlEsc(userName(item.decided_by))}` : ''}</span>` : ''}`
              : '<em>not yet decided</em>'}</span>
          </div>
          ${item.discussion_notes ? `<div class="ai-row"><span class="ai-label">Discussion</span><span>${htmlEsc(item.discussion_notes)}</span></div>` : ''}
          ${item.decision_text ? `<div class="ai-row"><span class="ai-label">Decision</span><span>${htmlEsc(item.decision_text)}</span></div>` : ''}
          ${itemActions.length > 0 ? `
            <div class="ai-row"><span class="ai-label">Action items</span><span>
              <ul style="margin:2px 0 0 14px;padding:0">
              ${itemActions.map((a) => `
                <li style="margin:2px 0">
                  <span class="badge at-${a.action_type}">${htmlEsc(ACTION_TYPE_LABEL[a.action_type])}</span>
                  ${htmlEsc(a.description)}
                  <span class="small"> — to ${htmlEsc((a.assigned_depts ?? []).map(deptName).join(', ') || '—')}</span>
                </li>
              `).join('')}
              </ul>
            </span></div>
          ` : ''}
        </div>
      `
    }).join('')}
  `).join('')

  const body = `
    <h1>${htmlEsc(data.meeting.meeting_type)} Meeting Minutes</h1>
    <div class="meta">
      <div class="meta-line"><b>${htmlEsc(data.meeting.title)}</b></div>
      <div class="meta-line"><b>Committee:</b> ${htmlEsc(MEETING_TYPE_LABEL[data.meeting.meeting_type])}</div>
      <div class="meta-line"><b>Date:</b> ${htmlEsc(data.meeting.meeting_date)}${data.meeting.location ? ` · <b>Location:</b> ${htmlEsc(data.meeting.location)}` : ''}</div>
      ${data.chairName ? `<div class="meta-line"><b>Chair:</b> ${htmlEsc(data.chairName)}</div>` : ''}
      <div class="meta-line"><b>Status:</b> ${htmlEsc(MEETING_STATUS_LABEL[data.meeting.status])}</div>
      <div class="meta-line"><b>Agenda items:</b> ${data.agenda.length} (${decided} decided)</div>
      <div class="meta-line"><b>Generated:</b> ${htmlEsc(fmtMytTimestamp())} MYT</div>
    </div>
    ${summaryBlock}
    <h2>Agenda &amp; decisions</h2>
    ${groups.length === 0 ? '<p class="small">No risks on the agenda.</p>' : agendaBlocks}
    ${data.meeting.minutes ? `
      <h2>Minutes</h2>
      <div class="pre-wrap small" style="font-size:10px;color:#1F2937">${htmlEsc(data.meeting.minutes)}</div>
    ` : ''}
    <div class="sig">
      <div>Chair: ${htmlEsc(data.chairName ?? '________________')}</div>
      <div>Recorded by: Risk Coordinator (RMCQ)</div>
    </div>
    <div class="end-note">— end of minutes —</div>
  `
  openPrintWindow(`${data.meeting.meeting_type} ${data.meeting.title}`, body, { landscape: false })
}

export function exportMeetingMinutesXlsx(data: MeetingExportData): void {
  const deptName = deptResolver(data.depts)
  const userName = (uid: number | null | undefined) =>
    uid ? (data.users.find((u) => u.id === uid)?.name ?? `user #${uid}`) : ''

  // Sheet 1: Agenda
  const agendaHead = [
    [`${data.meeting.meeting_type} · ${data.meeting.title}`],
    [`Date: ${data.meeting.meeting_date}${data.meeting.location ? ` · Location: ${data.meeting.location}` : ''}`],
    [`Chair: ${data.chairName ?? '—'}`],
    [`Generated: ${fmtMytTimestamp()} MYT`],
    [],
  ]
  const agendaCols = [
    'Risk ID', 'Department', 'Category', 'Description', 'Cycle',
    'Pre-meeting score', 'Pre-meeting level',
    'After-meeting score', 'After-meeting level',
    'Outcome', 'Discussion', 'Decision text', 'Decided by', 'Decided on',
  ]
  const agendaRows = data.agenda.map((item) => {
    const risk = data.risksById.get(item.risk_id)
    const latest = data.latestByRisk.get(item.risk_id)
    const pre = item.pre_meeting_scoring
    return [
      risk?.risk_id ?? '—',
      risk ? deptName(risk.dept_code) : '—',
      risk?.category ?? '',
      risk?.description ?? '',
      latest?.cycle_number ?? '',
      pre ? Math.round(pre.risk_score * 10) / 10 : '',
      pre ? RISK_LEVEL_LABEL[pre.risk_level] : '',
      latest ? Math.round(latest.risk_score * 10) / 10 : '',
      latest ? RISK_LEVEL_LABEL[latest.risk_level as keyof typeof RISK_LEVEL_LABEL] : '',
      item.outcome ? COMMITTEE_OUTCOME_LABEL[item.outcome as CommitteeOutcome] : '',
      item.discussion_notes ?? '',
      item.decision_text ?? '',
      userName(item.decided_by),
      item.decided_at?.slice(0, 10) ?? '',
    ]
  })
  const wsAgenda = XLSX.utils.aoa_to_sheet([...agendaHead, agendaCols, ...agendaRows])
  wsAgenda['!cols'] = [16, 26, 10, 50, 8, 14, 14, 14, 14, 22, 50, 50, 22, 12].map((w) => ({ wch: w }))

  // Sheet 2: Action items issued at this meeting
  const actionHead = [
    [`Action items issued at ${data.meeting.meeting_type} · ${data.meeting.title}`],
    [`Generated: ${fmtMytTimestamp()} MYT`],
    [],
  ]
  const actionCols = [
    'Risk ID', 'Action type', 'Description', 'Assigned to (dept)',
    'Status', 'Response', 'Date issued',
  ]
  const actionRows = data.actions.map((a) => {
    const risk = data.risksById.get(a.risk_id ?? 0)
    return [
      risk?.risk_id ?? '—',
      ACTION_TYPE_LABEL[a.action_type],
      a.description,
      (a.assigned_depts ?? []).map(deptName).join(', '),
      ACTION_STATUS_LABEL[a.status],
      a.response ?? '',
      a.created_at?.slice(0, 10) ?? '',
    ]
  })
  const wsActions = XLSX.utils.aoa_to_sheet([...actionHead, actionCols, ...actionRows])
  wsActions['!cols'] = [16, 18, 50, 30, 14, 50, 12].map((w) => ({ wch: w }))

  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, wsAgenda, 'Agenda')
  XLSX.utils.book_append_sheet(wb, wsActions, 'Action items')
  XLSX.writeFile(wb, `meeting-${data.meeting.meeting_type}-${slug(data.meeting.title)}_${fmtMytDate()}.xlsx`)
}

/* ---------------- 3) Action items export ---------------- */

export interface ActionItemListItem {
  item: RiskActionItem
  /** Only the fields needed for the export — keeps the call site flexible. */
  risk: Pick<Risk, 'risk_id' | 'description' | 'dept_code'> | null
}
export interface ActionExportFilter {
  view: 'open' | 'responded' | 'closed' | 'all'
  deptScope: string | null  // null = unscoped, string = single dept code
}

function describeActionFilter(f: ActionExportFilter, deptName: (c: string) => string): string[] {
  const lines: string[] = []
  lines.push(`Tab: ${f.view === 'all' ? 'All' : f.view.charAt(0).toUpperCase() + f.view.slice(1)}`)
  if (f.deptScope) lines.push(`Scoped to: ${deptName(f.deptScope)}`)
  return lines
}

export function exportActionItemsXlsx(
  rows: ActionItemListItem[],
  filter: ActionExportFilter,
  depts: { code: string; name_en: string }[],
): void {
  const deptName = deptResolver(depts)
  const filterLines = describeActionFilter(filter, deptName)

  const HEAD = [
    ['Action Items Export'],
    [`Generated: ${fmtMytTimestamp()} MYT`],
    [`Filter — ${filterLines.join(' · ')}`],
    [`Items exported: ${rows.length}`],
    [],
  ]
  const COLS = [
    'Action type', 'Description', 'Risk ID', 'Risk description', 'Risk dept',
    'Assigned to (dept)', 'Status', 'Response', 'Date issued', 'Date responded',
  ]
  const data = rows.map(({ item, risk }) => [
    ACTION_TYPE_LABEL[item.action_type],
    item.description,
    risk?.risk_id ?? '—',
    risk?.description ?? '',
    risk ? deptName(risk.dept_code) : '',
    (item.assigned_depts ?? []).map(deptName).join(', '),
    ACTION_STATUS_LABEL[item.status],
    item.response ?? '',
    item.created_at?.slice(0, 10) ?? '',
    item.updated_at?.slice(0, 10) ?? '',
  ])
  const ws = XLSX.utils.aoa_to_sheet([...HEAD, COLS, ...data])
  ws['!cols'] = [16, 50, 16, 50, 26, 30, 14, 50, 12, 14].map((w) => ({ wch: w }))

  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'Action Items')
  XLSX.writeFile(wb, `action-items_${fmtMytDate()}.xlsx`)
}

export function exportActionItemsPdf(
  rows: ActionItemListItem[],
  filter: ActionExportFilter,
  depts: { code: string; name_en: string }[],
): void {
  const deptName = deptResolver(depts)
  const filterLines = describeActionFilter(filter, deptName)

  // Group by status for the PDF
  const groups = new Map<string, ActionItemListItem[]>()
  for (const r of rows) {
    const k = r.item.status
    if (!groups.has(k)) groups.set(k, [])
    groups.get(k)!.push(r)
  }
  const order = ['PENDING', 'OVERDUE', 'RESPONDED', 'ACCEPTED', 'ESCALATED']

  const blocks = order.filter((k) => groups.has(k)).map((k) => {
    const items = groups.get(k)!
    return `
      <h2>${htmlEsc(ACTION_STATUS_LABEL[k as keyof typeof ACTION_STATUS_LABEL] ?? k)} <span class="small">· ${items.length}</span></h2>
      ${items.map(({ item, risk }) => `
        <div class="card">
          <div class="card-h">
            <span class="badge at-${item.action_type}">${htmlEsc(ACTION_TYPE_LABEL[item.action_type])}</span>
            <span class="mono">${htmlEsc(risk?.risk_id ?? '—')}</span>
            ${risk ? ` · ${htmlEsc(deptName(risk.dept_code))}` : ''}
          </div>
          <div class="card-sub">
            Assigned to: ${htmlEsc((item.assigned_depts ?? []).map(deptName).join(', ') || '—')}
            ${item.created_at ? ` · Issued ${htmlEsc(item.created_at.slice(0, 10))}` : ''}
          </div>
          <div class="card-body">${htmlEsc(item.description)}</div>
          ${item.response ? `<div class="card-resp"><b>Department response:</b> ${htmlEsc(item.response)}</div>` : ''}
        </div>
      `).join('')}
    `
  }).join('')

  const body = `
    <h1>Action Items</h1>
    <div class="meta">
      <div class="meta-line"><b>Generated:</b> ${htmlEsc(fmtMytTimestamp())} MYT</div>
      <div class="meta-line"><b>Filter:</b> ${filterLines.map(htmlEsc).join(' &middot; ')}</div>
      <div class="meta-line"><b>Items shown:</b> ${rows.length}</div>
    </div>
    ${rows.length === 0 ? '<p class="small">No action items match the current filter.</p>' : blocks}
    <div class="end-note">— end of list —</div>
  `
  openPrintWindow(`Action Items · ${fmtMytDate()}`, body, { landscape: false })
}
