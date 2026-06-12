/* /api/risk/parse-upload — extract a list of risks from an uploaded paper
 * register (scanned PDF or Excel). Sends the file to Anthropic's Messages API
 * with a structured-extraction prompt; returns a JSON array of risk drafts the
 * page can render as an editable review table.
 *
 * Required env: ANTHROPIC_API_KEY (server-side; never expose to the browser).
 *
 * Why this lives server-side: keeps the API key off the client, and lets us
 * send the raw PDF bytes as base64 in a single hop. Excel files are parsed
 * with SheetJS server-side (already a dep) into a markdown table before being
 * sent as text. */

import { NextRequest, NextResponse } from 'next/server'
import * as XLSX from 'xlsx'

export const runtime = 'nodejs'
// Allow up to 60s for larger PDFs to be OCR'd by the model.
export const maxDuration = 60

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages'
const MODEL = 'claude-sonnet-4-6'

const SYSTEM_PROMPT = `You extract risks from a Malaysian hospital risk register
(Borang Risiko / Risk Management Form). The user will supply either a PDF
(which may be a scanned form) or a markdown table from an Excel spreadsheet.
Read every distinct risk and return them as a JSON object — and nothing else.

Use this exact shape:

{
  "risks": [
    {
      "description": "the risk description, as one paragraph",
      "cause": "what could trigger it (may be empty string)",
      "impact": "the consequence if it occurs (may be empty string)",
      "category": "OPS | KEW | REP | PER | STR | PRJ",
      "scope": "INSTITUSI | UNIT",
      "existing_controls": "controls already in place (may be empty)",
      "additional_controls": "controls proposed (may be empty)",
      "action_owner_dept_names": ["department names mentioned"],
      "implementation_period": "deadline or 'Ongoing' etc. (may be empty)",
      "likelihood": null,
      "impact_manusia": null,
      "impact_reputasi": null,
      "impact_kewangan": null,
      "impact_operasi": null,
      "impact_objektif": null,
      "_source_note": "optional short note if this row was hard to parse"
    }
  ],
  "general_notes": "any cross-cutting observation about the document quality"
}

Category codes:
- OPS = Operational (process, system, day-to-day operations)
- KEW = Kewangan (financial / budget)
- REP = Reputational (PR, public trust, communication)
- PER = Personnel (staffing, HR, occupational safety)
- STR = Strategic (long-term direction, planning)
- PRJ = Project (initiative-specific risks)

Scope:
- INSTITUSI = hospital-wide
- UNIT = department or unit-only

Scoring is a 1–5 scale across likelihood and five impact dimensions
(manusia / reputasi / kewangan / operasi / objektif). If a score is missing,
unreadable, or you are not confident, return null for that field — do not
guess. The RC will fill it in by hand on review.

Return ONLY the JSON object. No prose, no markdown fences, no apology lines.`

interface RiskDraft {
  description: string
  cause: string
  impact: string
  category: string
  scope: string
  existing_controls: string
  additional_controls: string
  action_owner_dept_names: string[]
  implementation_period: string
  likelihood: number | null
  impact_manusia: number | null
  impact_reputasi: number | null
  impact_kewangan: number | null
  impact_operasi: number | null
  impact_objektif: number | null
  _source_note?: string
}

export async function POST(req: NextRequest) {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) {
    return NextResponse.json(
      { error: 'Server is missing ANTHROPIC_API_KEY env var. Add the key in your deploy environment and redeploy.' },
      { status: 500 },
    )
  }

  let formData: FormData
  try {
    formData = await req.formData()
  } catch {
    return NextResponse.json({ error: 'Could not read upload.' }, { status: 400 })
  }

  const file = formData.get('file') as File | null
  if (!file) return NextResponse.json({ error: 'No file uploaded.' }, { status: 400 })

  const name = (file.name ?? '').toLowerCase()
  const isPdf = name.endsWith('.pdf') || file.type === 'application/pdf'
  const isXlsx = name.endsWith('.xlsx') || name.endsWith('.xls')

  if (!isPdf && !isXlsx) {
    return NextResponse.json(
      { error: 'Only PDF and Excel (.xlsx) files are supported right now.' },
      { status: 400 },
    )
  }

  const buf = Buffer.from(await file.arrayBuffer())

  // Build the user content block — either a PDF document attachment or an
  // Excel-derived markdown table.
  type ContentBlock =
    | { type: 'text'; text: string }
    | { type: 'document'; source: { type: 'base64'; media_type: string; data: string } }
  let userContent: ContentBlock[]
  if (isPdf) {
    userContent = [
      {
        type: 'document',
        source: { type: 'base64', media_type: 'application/pdf', data: buf.toString('base64') },
      },
      {
        type: 'text',
        text: 'Extract every risk listed in this register and return the JSON described.',
      },
    ]
  } else {
    let md: string
    try {
      const wb = XLSX.read(buf, { type: 'buffer' })
      md = workbookToMarkdown(wb)
    } catch (e) {
      return NextResponse.json(
        { error: `Could not parse Excel file: ${e instanceof Error ? e.message : String(e)}` },
        { status: 400 },
      )
    }
    if (!md.trim()) {
      return NextResponse.json({ error: 'Excel file appears to be empty.' }, { status: 400 })
    }
    userContent = [
      {
        type: 'text',
        text:
          'Below is a Malaysian hospital risk register extracted from an Excel ' +
          'spreadsheet as a markdown table. Extract every risk listed in it and ' +
          'return the JSON described.\n\n' + md,
      },
    ]
  }

  let aResp: Response
  try {
    aResp = await fetch(ANTHROPIC_URL, {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 8192,
        system: SYSTEM_PROMPT,
        messages: [{ role: 'user', content: userContent }],
      }),
    })
  } catch (e) {
    return NextResponse.json(
      { error: `Could not reach Anthropic API: ${e instanceof Error ? e.message : String(e)}` },
      { status: 502 },
    )
  }

  if (!aResp.ok) {
    const errText = await aResp.text().catch(() => '')
    return NextResponse.json(
      { error: `Anthropic API error (HTTP ${aResp.status})`, detail: errText.slice(0, 500) },
      { status: 502 },
    )
  }

  let aJson: { content?: { type: string; text?: string }[]; usage?: unknown } = {}
  try {
    aJson = await aResp.json()
  } catch {
    return NextResponse.json({ error: 'Anthropic API returned non-JSON.' }, { status: 502 })
  }

  const textBlock = (aJson.content ?? []).find((b) => b.type === 'text')
  const raw = textBlock?.text ?? ''
  if (!raw.trim()) {
    return NextResponse.json({ error: 'Parser returned an empty response.' }, { status: 502 })
  }

  // Extract the JSON object — be tolerant of leading prose / markdown fences.
  const m = raw.match(/\{[\s\S]*\}/)
  if (!m) {
    return NextResponse.json(
      { error: 'Parser response did not contain JSON.', raw: raw.slice(0, 1000) },
      { status: 502 },
    )
  }

  let parsed: { risks?: RiskDraft[]; general_notes?: string }
  try {
    parsed = JSON.parse(m[0])
  } catch {
    return NextResponse.json(
      { error: 'Parser JSON was malformed.', raw: raw.slice(0, 1000) },
      { status: 502 },
    )
  }

  const risks = Array.isArray(parsed.risks) ? parsed.risks : []
  return NextResponse.json({
    risks,
    general_notes: parsed.general_notes ?? '',
    model: MODEL,
    usage: aJson.usage ?? null,
  })
}

/* Convert every sheet in the workbook into a chained markdown table so the
 * model gets headers + rows in a recognizable structure. */
function workbookToMarkdown(wb: XLSX.WorkBook): string {
  const out: string[] = []
  for (const sheetName of wb.SheetNames) {
    const sheet = wb.Sheets[sheetName]
    if (!sheet) continue
    const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: '' })
    if (!rows.length) continue
    out.push(`## Sheet: ${sheetName}`)
    out.push('')
    for (const r of rows) {
      const cells = (r as unknown[]).map((c) => String(c ?? '').replace(/\|/g, '\\|').replace(/\r?\n/g, ' '))
      out.push('| ' + cells.join(' | ') + ' |')
    }
    out.push('')
  }
  return out.join('\n')
}
