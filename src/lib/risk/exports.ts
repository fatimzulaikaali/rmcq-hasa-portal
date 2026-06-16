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

/* Open a popup that renders the given HTML and fires window.print() on load.
 * extraCss is appended AFTER the base CSS so callers can override @page or
 * any other rule (later-defined wins under the cascade). */
function openPrintWindow(title: string, body: string, opts?: { landscape?: boolean; extraCss?: string }): void {
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
  const finalCss = css + (opts?.extraCss ? '\n' + opts.extraCss : '')
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>${htmlEsc(title)}</title><style>${finalCss}</style></head><body>${body}<script>window.onload=()=>setTimeout(()=>window.print(),60);<\/script></body></html>`
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
  const decidedCount = data.agenda.filter((a) => a.outcome).length

  /* Stats for the executive summary page. */
  const outcomeCounts: Record<string, number> = {
    ENDORSE_ACTIVE: 0, ESCALATE_ROC: 0, SEND_BACK_DEPT: 0, RECOMMEND_CLOSE: 0, UNDECIDED: 0,
  }
  const levelCounts: Record<string, number> = { EKSTREM: 0, TINGGI: 0, SEDERHANA: 0, RENDAH: 0 }
  const escalatedList: { id: string; description: string; deptLabel: string }[] = []
  let totalActions = 0
  const themesUsed = new Set<number>()

  for (const item of data.agenda) {
    const key = (item.outcome ?? 'UNDECIDED') as keyof typeof outcomeCounts
    outcomeCounts[key] = (outcomeCounts[key] ?? 0) + 1
    const risk = data.risksById.get(item.risk_id)
    const latest = data.latestByRisk.get(item.risk_id)
    if (latest) levelCounts[latest.risk_level] = (levelCounts[latest.risk_level] ?? 0) + 1
    if (item.outcome === 'ESCALATE_ROC' && risk) {
      escalatedList.push({ id: risk.risk_id, description: risk.description, deptLabel: deptName(risk.dept_code) })
    }
    totalActions += data.actions.filter((a) => a.risk_id === item.risk_id && a.agenda_id === item.id).length
    for (const tid of (data.themeTagsByRisk.get(item.risk_id) ?? [])) themesUsed.add(tid)
  }
  const totalAgenda = data.agenda.length
  const maxOutcome = Math.max(1, ...Object.values(outcomeCounts))
  const maxLevel = Math.max(1, ...Object.values(levelCounts))

  const outcomeBar = (key: string, label: string, color: string) => `
    <div class="bar-row">
      <div class="bar-row-label">${htmlEsc(label)}</div>
      <div class="bar-row-track"><div class="bar-row-fill" style="width:${((outcomeCounts[key] ?? 0) / maxOutcome) * 100}%;background:${color}"></div></div>
      <div class="bar-row-count">${outcomeCounts[key] ?? 0}</div>
    </div>`
  const levelBar = (key: string, color: string, bg: string) => `
    <div class="bar-row">
      <div class="bar-row-label"><span class="badge" style="color:${color};background:${bg}">${htmlEsc(RISK_LEVEL_LABEL[key as keyof typeof RISK_LEVEL_LABEL] ?? key)}</span></div>
      <div class="bar-row-track"><div class="bar-row-fill" style="width:${((levelCounts[key] ?? 0) / maxLevel) * 100}%;background:${color}"></div></div>
      <div class="bar-row-count">${levelCounts[key] ?? 0}</div>
    </div>`

  /* COVER PAGE */
  const coverHtml = `
    <section class="cover">
      <div class="cover-eyebrow">Hospital Al-Sultan Abdullah UiTM &middot; Risk Management, Compliance &amp; Quality</div>
      <div class="cover-title">MINUTES OF MEETING</div>
      <div class="cover-divider"></div>
      <div class="cover-subtitle">${htmlEsc(MEETING_TYPE_LABEL[data.meeting.meeting_type])}</div>
      <div class="cover-bil">${htmlEsc(data.meeting.title)}</div>
      <div class="cover-meta">
        <div class="cover-meta-row"><span class="cover-meta-label">Committee</span><span>${htmlEsc(MEETING_TYPE_LABEL[data.meeting.meeting_type])}</span></div>
        <div class="cover-meta-row"><span class="cover-meta-label">Date</span><span>${htmlEsc(data.meeting.meeting_date)}</span></div>
        <div class="cover-meta-row"><span class="cover-meta-label">Venue</span><span>${htmlEsc(data.meeting.location ?? '—')}</span></div>
        <div class="cover-meta-row"><span class="cover-meta-label">Chair</span><span>${htmlEsc(data.chairName ?? '—')}</span></div>
        <div class="cover-meta-row"><span class="cover-meta-label">Recorded by</span><span>Risk Coordinator (RMCQ)</span></div>
        <div class="cover-meta-row"><span class="cover-meta-label">Status</span><span>${htmlEsc(MEETING_STATUS_LABEL[data.meeting.status])}</span></div>
        <div class="cover-meta-row"><span class="cover-meta-label">Agenda items</span><span>${totalAgenda} (${decidedCount} decided)</span></div>
      </div>
      <div class="cover-foot">
        Generated ${htmlEsc(fmtMytTimestamp())} MYT &middot; Confidential
      </div>
    </section>`

  /* EXECUTIVE SUMMARY PAGE */
  const summaryHtml = `
    <section class="summary">
      <h2>Executive summary</h2>
      <div class="summary-tiles">
        <div class="summary-tile"><div class="v">${totalAgenda}</div><div class="l">Total agenda</div></div>
        <div class="summary-tile"><div class="v">${decidedCount}</div><div class="l">Decided</div></div>
        <div class="summary-tile"><div class="v">${escalatedList.length}</div><div class="l">Escalated to ROC</div></div>
        <div class="summary-tile"><div class="v">${totalActions}</div><div class="l">Action items issued</div></div>
      </div>
      <div class="stat-cols">
        <div class="stat-col">
          <h3>By committee outcome</h3>
          ${outcomeBar('ENDORSE_ACTIVE', 'Endorse → Active', '#16A34A')}
          ${outcomeBar('ESCALATE_ROC', 'Escalate → ROC', '#7C3AED')}
          ${outcomeBar('SEND_BACK_DEPT', 'Send back to dept', '#F97316')}
          ${outcomeBar('RECOMMEND_CLOSE', 'Recommend closure', '#6B7280')}
          ${outcomeCounts.UNDECIDED ? outcomeBar('UNDECIDED', 'Not yet decided', '#94A3B8') : ''}
        </div>
        <div class="stat-col">
          <h3>By risk level</h3>
          ${levelBar('EKSTREM', '#991B1B', '#FEE2E2')}
          ${levelBar('TINGGI', '#9A3412', '#FED7AA')}
          ${levelBar('SEDERHANA', '#92400E', '#FEF3C7')}
          ${levelBar('RENDAH', '#166534', '#DCFCE7')}
        </div>
      </div>
      ${escalatedList.length > 0 ? `
        <div class="escalated-panel">
          <div class="escalated-panel-h">Escalated to ROC for further discussion (${escalatedList.length})</div>
          <ul>
            ${escalatedList.map((r) => `<li><b>${htmlEsc(r.id)}</b> — ${htmlEsc(r.description.length > 100 ? r.description.slice(0, 100) + '…' : r.description)} <span class="small">· ${htmlEsc(r.deptLabel)}</span></li>`).join('')}
          </ul>
        </div>
      ` : ''}
      ${themesUsed.size > 0 ? `
        <div class="themes-panel">
          <div class="themes-panel-h">Cross-cutting themes (${themesUsed.size})</div>
          <div>${Array.from(themesUsed).map((id) => `<span class="theme-chip">${htmlEsc(themeName(id))}</span>`).join('')}</div>
        </div>
      ` : ''}
      ${data.rocSummary && data.rocSummary.linkedRtc.length > 0 ? `
        <div class="rtc-rollup">
          <div class="rtc-rollup-h">RTC sittings reviewed by this ROC</div>
          <ul>
            ${data.rocSummary.linkedRtc.map((m) => `<li>${htmlEsc(m.title)} &middot; ${htmlEsc(m.meeting_date)}</li>`).join('')}
          </ul>
        </div>
      ` : ''}
    </section>`

  /* AGENDA BLOCKS — one section per department, new page per department. */
  const agendaHtml = groups.map((g, gi) => `
    <section class="dept-section" style="${gi === 0 ? '' : 'page-break-before:always'}">
      <div class="dept-band">
        <div class="dept-band-name">${htmlEsc(g.deptLabel)}</div>
        <div class="dept-band-count">${g.items.length} risk${g.items.length === 1 ? '' : 's'}</div>
      </div>
      ${g.items.map(({ item, risk }) => {
        const latest = data.latestByRisk.get(risk.id)
        const itemActions = data.actions.filter((a) => a.risk_id === risk.id && a.agenda_id === item.id)
        const themes = (data.themeTagsByRisk.get(risk.id) ?? []).map(themeName)
        return `
          <article class="risk-card">
            <header class="risk-card-h">
              <span class="risk-card-id">${htmlEsc(risk.risk_id)}</span>
              <span class="risk-card-title">${htmlEsc(risk.description)}</span>
            </header>
            <div class="risk-card-meta">
              <span><b>${htmlEsc(risk.category)}</b> — ${htmlEsc(RISK_CATEGORY_LABEL[risk.category] ?? '')}</span>
              ${latest ? `<span>Level: <span class="badge lvl-${latest.risk_level}">${htmlEsc(RISK_LEVEL_LABEL[latest.risk_level as keyof typeof RISK_LEVEL_LABEL])}</span></span><span>Score: <b>${(Math.round(latest.risk_score * 10) / 10).toFixed(1)}</b></span><span>Cycle: <b>${latest.cycle_number}</b></span>` : ''}
              ${item.pre_meeting_scoring ? `<span class="pre-meeting">(Pre-meeting: <span class="badge lvl-${item.pre_meeting_scoring.risk_level}">${htmlEsc(RISK_LEVEL_LABEL[item.pre_meeting_scoring.risk_level as keyof typeof RISK_LEVEL_LABEL])}</span> ${(Math.round(item.pre_meeting_scoring.risk_score * 10) / 10).toFixed(1)})</span>` : ''}
              ${themes.length > 0 ? `<span>Themes: ${themes.map(htmlEsc).join(', ')}</span>` : ''}
            </div>

            ${item.outcome ? `
              <div class="outcome-block">
                <div class="block-label">Outcome</div>
                <div class="block-value">
                  <span class="badge oc-${item.outcome}">${htmlEsc(COMMITTEE_OUTCOME_LABEL[item.outcome as CommitteeOutcome])}</span>
                  <span class="small">recorded on ${htmlEsc(item.decided_at?.slice(0, 10) ?? '')}${item.decided_by ? ` by ${htmlEsc(userName(item.decided_by))}` : ''}</span>
                </div>
              </div>
            ` : `
              <div class="outcome-block outcome-pending">
                <div class="block-label">Outcome</div>
                <div class="block-value"><em>Not yet decided</em></div>
              </div>
            `}

            ${item.discussion_notes ? `
              <div class="text-block discussion">
                <div class="block-label">Discussion</div>
                <div class="block-value">${htmlEsc(item.discussion_notes)}</div>
              </div>
            ` : ''}

            ${item.decision_text ? `
              <div class="text-block decision">
                <div class="block-label">Decision</div>
                <div class="block-value">${htmlEsc(item.decision_text)}</div>
              </div>
            ` : ''}

            ${itemActions.length > 0 ? `
              <div class="actions-block">
                <div class="block-label">Action items (${itemActions.length})</div>
                <ul class="actions-list">
                  ${itemActions.map((a) => `
                    <li>
                      <span class="badge at-${a.action_type}">${htmlEsc(ACTION_TYPE_LABEL[a.action_type])}</span>
                      ${htmlEsc(a.description)}
                      <span class="small">— to ${htmlEsc((a.assigned_depts ?? []).map(deptName).join(', ') || '—')}</span>
                    </li>
                  `).join('')}
                </ul>
              </div>
            ` : ''}
          </article>`
      }).join('')}
    </section>`).join('')

  /* SIGNATURE / ENDORSEMENT PAGE */
  const signatureHtml = `
    <section class="signature-page">
      <h2>Endorsement</h2>
      <p class="endorse-intro">
        These minutes accurately record the proceedings of the meeting noted above. They take effect upon signature by the Chair.
      </p>
      <div class="sig-boxes">
        <div class="sig-box">
          <div class="sig-box-label">Chair</div>
          <div class="sig-box-row"><span class="sig-box-row-label">Name</span><span>${htmlEsc(data.chairName ?? '')}</span></div>
          <div class="sig-box-row"><span class="sig-box-row-label">Signature</span></div>
          <div class="sig-line"></div>
          <div class="sig-box-row"><span class="sig-box-row-label">Date</span></div>
          <div class="sig-line"></div>
        </div>
        <div class="sig-box">
          <div class="sig-box-label">Recorded by</div>
          <div class="sig-box-row"><span class="sig-box-row-label">Name</span><span>Risk Coordinator (RMCQ)</span></div>
          <div class="sig-box-row"><span class="sig-box-row-label">Signature</span></div>
          <div class="sig-line"></div>
          <div class="sig-box-row"><span class="sig-box-row-label">Date</span></div>
          <div class="sig-line"></div>
        </div>
      </div>
      <div class="circulation">
        <b>Circulation:</b> ${htmlEsc(MEETING_TYPE_LABEL[data.meeting.meeting_type])} members &middot; Department Heads (relevant) &middot; RMCQ Archive
      </div>
      ${data.meeting.minutes ? `
        <div class="additional-minutes">
          <h3>Additional minutes / notes</h3>
          <div class="pre-wrap">${htmlEsc(data.meeting.minutes)}</div>
        </div>
      ` : ''}
    </section>`

  const body = coverHtml + summaryHtml + agendaHtml + signatureHtml

  /* Minutes-specific CSS — overrides the base. Includes @page rules so the
   * browser's bottom-center renders our "Page X of Y" + footer (the OS print
   * dialog still shows its own header/footer unless the user unticks
   * "Headers and footers" — but this provides a fallback when they do). */
  const extraCss = `
    @page { size: A4 portrait; margin: 18mm 16mm 18mm 16mm; }
    @page { @bottom-center { content: "Page " counter(page) " of " counter(pages) " · ${htmlEsc(MEETING_TYPE_LABEL[data.meeting.meeting_type])} ${htmlEsc(data.meeting.title)} · RMCQ"; font-size: 8.5pt; color: #6B7280; } }
    @page :first { @bottom-center { content: ""; } }

    body { font-family: 'Segoe UI', Roboto, system-ui, sans-serif; color: #0F172A; font-size: 10.5px; line-height: 1.55; margin: 0; }
    h1, h2, h3 { color: #0F172A; }
    h2 { font-size: 15px; font-weight: 700; margin: 0 0 5mm; padding-bottom: 2mm; border-bottom: 2px solid #1D4ED8; }
    h3 { font-size: 11.5px; font-weight: 700; margin: 0 0 2mm; }

    /* -------- Cover -------- */
    .cover { text-align: center; padding-top: 60mm; page-break-after: always; position: relative; min-height: 250mm; }
    .cover-eyebrow { font-size: 9.5px; letter-spacing: .14em; color: #1D4ED8; font-weight: 700; margin-bottom: 18mm; text-transform: uppercase; }
    .cover-title { font-size: 34px; font-weight: 800; letter-spacing: .04em; color: #0F172A; margin: 0; }
    .cover-divider { width: 70mm; height: 3px; background: #1D4ED8; margin: 6mm auto 14mm; }
    .cover-subtitle { font-size: 17px; color: #475569; font-weight: 500; margin-bottom: 3mm; }
    .cover-bil { font-size: 22px; color: #1D4ED8; font-weight: 700; margin-bottom: 18mm; }
    .cover-meta { display: inline-block; text-align: left; font-size: 12px; line-height: 1.9; }
    .cover-meta-row { display: flex; gap: 8mm; }
    .cover-meta-label { display: inline-block; min-width: 30mm; color: #6B7280; font-weight: 600; }
    .cover-foot { position: absolute; bottom: 0; left: 0; right: 0; font-size: 9px; color: #94A3B8; padding: 8mm 0; }

    /* -------- Executive summary -------- */
    .summary { page-break-after: always; }
    .summary-tiles { display: flex; gap: 4mm; margin-bottom: 8mm; }
    .summary-tile { flex: 1; border: 1px solid #E5E7EB; border-radius: 6px; padding: 4mm 3mm; text-align: center; background: #F8FAFC; }
    .summary-tile .v { font-size: 22px; font-weight: 800; color: #1D4ED8; }
    .summary-tile .l { font-size: 9px; color: #6B7280; text-transform: uppercase; letter-spacing: .04em; margin-top: 1.5mm; }
    .stat-cols { display: flex; gap: 6mm; margin-bottom: 6mm; }
    .stat-col { flex: 1; }
    .bar-row { display: flex; align-items: center; gap: 3mm; margin: 1.5mm 0; font-size: 10px; }
    .bar-row-label { min-width: 38mm; color: #1F2937; }
    .bar-row-track { flex: 1; height: 8px; background: #E5E7EB; border-radius: 4px; overflow: hidden; }
    .bar-row-fill { height: 100%; background: #1D4ED8; }
    .bar-row-count { min-width: 10mm; text-align: right; font-weight: 700; font-size: 10px; }
    .escalated-panel { margin: 6mm 0; padding: 4mm 5mm; background: #FEF3C7; border-left: 4px solid #F59E0B; border-radius: 4px; }
    .escalated-panel-h { font-weight: 700; color: #92400E; margin-bottom: 2mm; font-size: 11px; }
    .escalated-panel ul { margin: 0; padding-left: 5mm; }
    .escalated-panel li { font-size: 10px; margin: 1mm 0; }
    .themes-panel { margin: 4mm 0; padding: 4mm 5mm; background: #F0FDF4; border-left: 4px solid #16A34A; border-radius: 4px; }
    .themes-panel-h { font-weight: 700; color: #166534; margin-bottom: 2mm; font-size: 11px; }
    .theme-chip { display: inline-block; padding: 1mm 3mm; background: #fff; border: 1px solid #16A34A; color: #166534; border-radius: 999px; font-size: 9.5px; margin: 0.5mm 1mm 0.5mm 0; }
    .rtc-rollup { margin: 4mm 0; padding: 4mm 5mm; background: #EEF2FF; border-left: 4px solid #4F46E5; border-radius: 4px; }
    .rtc-rollup-h { font-weight: 700; color: #312E81; margin-bottom: 2mm; font-size: 11px; }
    .rtc-rollup ul { margin: 0; padding-left: 5mm; font-size: 10px; }

    /* -------- Department section -------- */
    .dept-band { background: linear-gradient(90deg, #1D4ED8, #4F46E5); color: #fff; padding: 4mm 5mm; border-radius: 6px; margin: 4mm 0 5mm; display: flex; justify-content: space-between; align-items: center; }
    .dept-band-name { font-size: 13px; font-weight: 700; }
    .dept-band-count { font-size: 11px; opacity: 0.85; }

    /* -------- Risk card -------- */
    .risk-card { page-break-inside: avoid; margin: 0 0 5mm; padding: 4mm 5mm; border: 1px solid #E5E7EB; border-radius: 6px; border-left: 4px solid #1D4ED8; background: #fff; }
    .risk-card-h { display: flex; align-items: baseline; gap: 3mm; margin-bottom: 2mm; }
    .risk-card-id { font-family: ui-monospace, Menlo, Consolas, monospace; font-weight: 700; font-size: 11px; background: #EEF2FF; color: #1E40AF; padding: 1mm 3mm; border-radius: 3px; }
    .risk-card-title { font-weight: 600; font-size: 11.5px; color: #0F172A; }
    .risk-card-meta { font-size: 10px; color: #475569; display: flex; flex-wrap: wrap; gap: 4mm; margin-bottom: 2mm; }
    .risk-card-meta .pre-meeting { color: #6B7280; font-style: italic; }

    .outcome-block { margin-top: 2.5mm; background: #F0FDF4; border-left: 3px solid #16A34A; padding: 2.5mm 3.5mm; border-radius: 3px; }
    .outcome-block.outcome-pending { background: #FEF3C7; border-left-color: #F59E0B; }
    .block-label { font-size: 8.5px; font-weight: 700; color: #166534; text-transform: uppercase; letter-spacing: .05em; margin-bottom: 1mm; }
    .outcome-block.outcome-pending .block-label { color: #92400E; }
    .block-value { font-size: 10.5px; color: #0F172A; }

    .text-block { margin-top: 2.5mm; padding: 2.5mm 3.5mm 2.5mm 4mm; border-left: 3px solid #CBD5E1; border-radius: 0 3px 3px 0; background: #F8FAFC; }
    .text-block.discussion .block-label { color: #475569; }
    .text-block.decision { border-left-color: #1D4ED8; background: #EEF2FF; }
    .text-block.decision .block-label { color: #1E3A8A; }
    .text-block .block-value { white-space: pre-wrap; }

    .actions-block { margin-top: 2.5mm; background: #FFF7ED; border-left: 3px solid #F97316; padding: 2.5mm 3.5mm; border-radius: 3px; }
    .actions-block .block-label { color: #9A3412; }
    .actions-list { margin: 1mm 0 0; padding-left: 5mm; }
    .actions-list li { margin: 1mm 0; font-size: 10px; }

    /* -------- Signature -------- */
    .signature-page { page-break-before: always; }
    .endorse-intro { font-size: 10.5px; color: #475569; margin-bottom: 8mm; }
    .sig-boxes { display: flex; gap: 8mm; margin-bottom: 10mm; }
    .sig-box { flex: 1; border: 1.5px solid #94A3B8; border-radius: 6px; padding: 4mm 5mm 6mm; }
    .sig-box-label { font-size: 9px; font-weight: 700; color: #1D4ED8; text-transform: uppercase; letter-spacing: .05em; margin-bottom: 4mm; padding-bottom: 2mm; border-bottom: 1px solid #E5E7EB; }
    .sig-box-row { font-size: 10px; margin: 3.5mm 0 1mm; display: flex; gap: 3mm; }
    .sig-box-row-label { color: #6B7280; font-weight: 600; min-width: 20mm; }
    .sig-line { border-bottom: 1px solid #94A3B8; height: 7mm; }
    .circulation { padding: 3mm 4mm; background: #F1F5F9; border-radius: 4px; font-size: 10px; color: #475569; }
    .additional-minutes { margin-top: 10mm; }
    .additional-minutes h3 { font-size: 12px; margin-bottom: 3mm; color: #1D4ED8; }
    .pre-wrap { white-space: pre-wrap; font-size: 10px; color: #1F2937; }

    .small { font-size: 9px; color: #6B7280; }
    .badge { display: inline-block; padding: 1px 6px; border-radius: 3px; font-weight: 700; font-size: 9px; }
  `

  openPrintWindow(`${data.meeting.meeting_type} ${data.meeting.title}`, body, { landscape: false, extraCss })
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
