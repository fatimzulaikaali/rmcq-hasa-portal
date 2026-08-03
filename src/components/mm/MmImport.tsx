'use client'

import { useMemo, useState } from 'react'
import * as XLSX from 'xlsx'
import type { SupabaseClient } from '@supabase/supabase-js'
import { nextCaseNo, normFacility, MM_FACILITIES, type MmDepartment, type MmFacility } from '@/lib/mm/types'

/* Import a monthly mortality list from Excel into de-identified M&M cases.
 *
 * PRIVACY: the importer only ever maps the de-identified columns below. Patient
 * name and NRIC are NEVER mapped to a stored field and never leave the browser —
 * they are dropped at the point of import (the brief's import rule). Detected
 * identifier columns are shown so the user can see they are being discarded. */

type Row = Record<string, unknown>

const FIELDS: { key: string; label: string; kw: string[] }[] = [
  { key: 'case_no', label: 'Case ID (e.g. MM/2026/0001)', kw: ['case id', 'case no', 'caseno', 'case number', 'id kes', 'mm/'] },
  { key: 'facility', label: 'Facility (optional column)', kw: ['facility', 'fasiliti', 'hospital', 'pusat', 'ppuitm', 'hasa'] },
  { key: 'department', label: 'Department', kw: ['depart', 'jabatan', 'dept', 'unit', 'ward dept', 'discipline'] },
  { key: 'race', label: 'Race', kw: ['race', 'bangsa', 'kaum', 'ethnic', 'etnik'] },
  { key: 'admission_ward', label: 'Admission ward', kw: ['admission ward', 'wad masuk', 'adm ward', 'ward masuk'] },
  { key: 'ward', label: 'Ward / location at death', kw: ['ward at death', 'death ward', 'wad kematian', 'ward', 'wad', 'location', 'lokasi', 'bed'] },
  { key: 'age', label: 'Age', kw: ['age', 'umur'] },
  { key: 'sex', label: 'Sex', kw: ['sex', 'gender', 'jantina'] },
  { key: 'admission_date', label: 'Admission date', kw: ['admiss', 'masuk', 'doa', 'adm date'] },
  { key: 'death_datetime', label: 'Death date/time', kw: ['death', 'demise', 'mati', 'meninggal', 'dod', 'expired', 'tarikh kematian'] },
  { key: 'time_of_death', label: 'Time of death', kw: ['time of death', 'masa kematian', 'time death', 'death time', 'waktu kematian', 'tod'] },
  { key: 'diagnosis', label: 'Diagnosis', kw: ['diagnos', 'diagnosa'] },
  { key: 'cause_icd', label: 'Cause of death (ICD)', kw: ['cause', 'icd', 'punca'] },
]
/* Columns dropped at import — patient identifiers are NEVER stored. The portal is
 * fully de-identified: the Case ID (MM/2026/NNNN) is the only key. Keep the MRN ↔
 * Case ID mapping in your own offline master sheet. */
const IDENTIFIER_KW = ['name', 'nama', 'nric', 'kad pengenalan', 'no kp', 'passport', 'patient name', 'mrn', 'rekod perubatan', 'medical record']

function norm(s: string) { return s.toLowerCase().replace(/[^a-z0-9]/g, '') }

function toDateStr(v: unknown): string | null {
  if (v == null || v === '') return null
  if (v instanceof Date && !isNaN(v.getTime())) return v.toISOString().slice(0, 10)
  const d = new Date(String(v))
  return isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10)
}
function toDateTimeStr(v: unknown): string | null {
  if (v == null || v === '') return null
  if (v instanceof Date && !isNaN(v.getTime())) return v.toISOString()
  const d = new Date(String(v))
  return isNaN(d.getTime()) ? null : d.toISOString()
}
function toSex(v: unknown): string | null {
  const s = String(v ?? '').trim().toLowerCase()
  if (!s) return null
  if (['m', 'male', 'l', 'lelaki'].includes(s)) return 'M'
  if (['f', 'female', 'p', 'perempuan', 'w', 'wanita'].includes(s)) return 'F'
  return null
}

export function MmImport({
  supabase, departments, existingCaseNos, onDone, onCancel,
}: {
  supabase: SupabaseClient
  departments: MmDepartment[]
  existingCaseNos: string[]
  onDone: (n: number) => void
  onCancel: () => void
}) {
  const [step, setStep] = useState<'pick' | 'map'>('pick')
  const [headers, setHeaders] = useState<string[]>([])
  const [rows, setRows] = useState<Row[]>([])
  const [map, setMap] = useState<Record<string, string>>({})
  const [reportType, setReportType] = useState<'Mortality' | 'Morbidity'>('Mortality')
  const [facility, setFacility] = useState<MmFacility>('HASA')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [summary, setSummary] = useState('')

  const identifierCols = useMemo(
    () => headers.filter((h) => IDENTIFIER_KW.some((k) => norm(h).includes(norm(k)))),
    [headers])
  // Case IDs already in the portal — used to skip rows on re-upload.
  const existingSet = useMemo(() => new Set(existingCaseNos.map((c) => c.trim())), [existingCaseNos])
  // Count new / skipped across ALL rows (preview only shows the first 60).
  const importCounts = useMemo(() => {
    const seen = new Set<string>(); let nu = 0, sk = 0, du = 0
    for (const r of rows) {
      const raw = map.case_no ? r[map.case_no] : null
      const cn = raw != null && String(raw).trim() !== '' ? String(raw).trim() : ''
      if (!cn) { nu++; continue }
      if (existingSet.has(cn)) { sk++; continue }
      if (seen.has(cn)) { du++; continue }
      seen.add(cn); nu++
    }
    return { nu, sk, du }
  }, [rows, map, existingSet])

  async function onFile(file: File) {
    setErr('')
    try {
      const buf = await file.arrayBuffer()
      const wb = XLSX.read(buf, { type: 'array', cellDates: true })
      const ws = wb.Sheets[wb.SheetNames[0]]
      const data = XLSX.utils.sheet_to_json<Row>(ws, { defval: null, blankrows: false })
      if (!data.length) { setErr('The first sheet has no rows.'); return }
      const hdrs = Object.keys(data[0])
      setHeaders(hdrs); setRows(data)
      // auto-guess mapping — each header maps to at most one field (first FIELDS
      // entry wins), so "Admission ward" isn't also grabbed by "Admission date".
      const guess: Record<string, string> = {}
      const used = new Set<string>()
      for (const f of FIELDS) {
        const hit = hdrs.find((h) => !used.has(h) && f.kw.some((k) => norm(h).includes(norm(k))))
        if (hit) { guess[f.key] = hit; used.add(hit) }
      }
      setMap(guess); setStep('map')
    } catch (e) { setErr(e instanceof Error ? e.message : 'Could not read the file.') }
  }

  // build a normalized dept-name → code lookup for matching Excel dept text
  const deptLookup = useMemo(() => {
    const m: Record<string, string> = {}
    for (const d of departments) m[norm(d.name)] = d.code
    return m
  }, [departments])
  function matchDept(text: unknown): string | null {
    const n = norm(String(text ?? ''))
    if (!n) return null
    if (deptLookup[n]) return deptLookup[n]
    for (const d of departments) { const dn = norm(d.name); if (dn.includes(n) || n.includes(dn)) return d.code }
    return null
  }

  const preview = useMemo(() => rows.slice(0, 60).map((r) => {
    const g = (k: string) => (map[k] ? r[map[k]] : null)
    const deptText = g('department')
    const wardText = String(g('ward') ?? '')
    return {
      case_no: g('case_no') != null && g('case_no') !== '' ? String(g('case_no')).trim() : null,
      facility: map.facility ? normFacility(g('facility'), facility) : facility,
      dept_code: matchDept(deptText),
      deptText: String(deptText ?? ''),
      ward: wardText || null,
      admission_ward: g('admission_ward') != null && g('admission_ward') !== '' ? String(g('admission_ward')) : null,
      race: g('race') != null && g('race') !== '' ? String(g('race')) : null,
      time_of_death: g('time_of_death') != null && g('time_of_death') !== '' ? String(g('time_of_death')) : null,
      age: g('age') != null && g('age') !== '' ? Number(g('age')) : null,
      sex: toSex(g('sex')),
      admission_date: toDateStr(g('admission_date')),
      death_datetime: toDateTimeStr(g('death_datetime')),
      diagnosis: g('diagnosis') != null ? String(g('diagnosis')) : null,
      cause_icd: g('cause_icd') != null ? String(g('cause_icd')) : null,
      is_bid: /bid|brought.?in.?dead|police|polis|forensic/i.test(wardText),
      existing: (() => { const cn = g('case_no'); return cn != null && cn !== '' ? existingSet.has(String(cn).trim()) : false })(),
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [rows, map, departments, existingSet])

  const unmatchedDepts = useMemo(() => {
    const set = new Set<string>()
    for (const p of preview) if (!p.dept_code && p.deptText) set.add(p.deptText)
    return Array.from(set)
  }, [preview])

  async function doImport() {
    setBusy(true); setErr('')
    try {
      const used = [...existingCaseNos]              // reserve auto-numbers against these
      const seenInFile = new Set<string>()           // catch duplicate Case IDs within the file too
      let skipped = 0                                 // already in portal
      let dupInFile = 0                               // repeated Case ID inside this upload

      const toInsert: Record<string, unknown>[] = []
      for (const r of rows) {
        const g = (k: string) => (map[k] ? r[map[k]] : null)
        const wardText = String(g('ward') ?? '')
        const adm = toDateStr(g('admission_date')); const death = toDateTimeStr(g('death_datetime'))
        let los: number | null = null
        if (adm && death) { const dd = Math.round((new Date(death).getTime() - new Date(adm).getTime()) / 86400000); if (dd >= 0) los = dd }

        // Case ID drives de-duplication. Use the sheet's ID when present; otherwise
        // auto-assign the next MM/<year>/NNNN. Skip anything already in the portal.
        const rawId = g('case_no')
        let case_no = rawId != null && String(rawId).trim() !== '' ? String(rawId).trim() : ''
        if (case_no) {
          if (existingSet.has(case_no)) { skipped++; continue }   // already uploaded before
          if (seenInFile.has(case_no)) { dupInFile++; continue }  // repeated in this same file
          seenInFile.add(case_no)
        } else {
          case_no = nextCaseNo(used)                               // no ID given → generate one
          used.push(case_no)
        }

        toInsert.push({
          case_no,
          report_type: reportType,
          facility: map.facility ? normFacility(g('facility'), facility) : facility,
          dept_code: matchDept(g('department')),
          ward: wardText || null,
          admission_ward: g('admission_ward') != null && g('admission_ward') !== '' ? String(g('admission_ward')) : null,
          race: g('race') != null && g('race') !== '' ? String(g('race')) : null,
          time_of_death: g('time_of_death') != null && g('time_of_death') !== '' ? String(g('time_of_death')) : null,
          age: g('age') != null && g('age') !== '' ? Number(g('age')) : null,
          sex: toSex(g('sex')),
          admission_date: adm,
          death_datetime: death,
          los_days: los,
          diagnosis: g('diagnosis') != null ? String(g('diagnosis')) : null,
          cause_icd: g('cause_icd') != null ? String(g('cause_icd')) : null,
          is_bid: /bid|brought.?in.?dead|police|polis|forensic/i.test(wardText),
          status: 'Untriaged',
          report_date: new Date().toISOString().slice(0, 10),
        })
      }

      if (toInsert.length > 0) {
        const { error } = await supabase.from('mm_cases').insert(toInsert)
        if (error) { setErr(error.message); setBusy(false); return }
      }
      const bits = [`${toInsert.length} new case${toInsert.length === 1 ? '' : 's'} added`]
      if (skipped > 0) bits.push(`${skipped} already in portal — skipped`)
      if (dupInFile > 0) bits.push(`${dupInFile} duplicate Case ID${dupInFile === 1 ? '' : 's'} in file — skipped`)
      setSummary(bits.join(' · '))
      onDone(toInsert.length)
    } catch (e) { setErr(e instanceof Error ? e.message : 'Import failed'); setBusy(false) }
  }

  return (
    <div className="mm-form">
      {err && <div className="mm-err">{err}</div>}
      {summary && <div className="note" style={{ marginTop: 0, marginBottom: 12, borderColor: '#86EFAC', background: '#F0FDF4' }}>✓ {summary}</div>}

      <div className="note" style={{ marginTop: 0, marginBottom: 16 }}>
        <b>Privacy:</b> patient <b>name</b>, <b>NRIC</b> and <b>MRN</b> are never stored — they are dropped here in
        your browser and never sent to the portal. The <b>Case ID</b> (e.g. MM/2026/0001) is the only identifier
        kept, and it is also how re-uploads recognise cases already in the portal. Keep your Case ID ↔ MRN mapping
        in your own offline sheet.
      </div>

      {step === 'pick' && (
        <>
          <div className="mm-sec">Facility &amp; type</div>
          <div className="mm-grid">
            <div className="mm-field"><label>Facility (whole file)</label>
              <select value={facility} onChange={(e) => setFacility(e.target.value as MmFacility)}>{MM_FACILITIES.map((f) => <option key={f.code} value={f.code}>{f.label}</option>)}</select></div>
            <div className="mm-field"><label>Import as</label>
              <select value={reportType} onChange={(e) => setReportType(e.target.value as 'Mortality' | 'Morbidity')}><option>Mortality</option><option>Morbidity</option></select></div>
          </div>
          <p className="vd-sub" style={{ marginTop: 10 }}>If a single file contains both facilities, you can map a Facility column on the next screen and each row is set from it.</p>

          <div className="mm-sec">Upload monthly mortality list</div>
          <p className="vd-sub">Choose the Excel file (.xlsx / .xls). The first sheet is read; the top row must be column headers.</p>
          <input type="file" accept=".xlsx,.xls,.csv" onChange={(e) => { const f = e.target.files?.[0]; if (f) void onFile(f) }} />
          <div className="mm-formnav"><button type="button" className="mm-btn" onClick={onCancel}>Cancel</button></div>
        </>
      )}

      {step === 'map' && (
        <>
          <div className="mm-sec">Map columns · {rows.length} row{rows.length === 1 ? '' : 's'} found</div>
          <div className="mm-grid">
            <div className="mm-field"><label>Facility (whole file)</label>
              <select value={facility} onChange={(e) => setFacility(e.target.value as MmFacility)}>{MM_FACILITIES.map((f) => <option key={f.code} value={f.code}>{f.label}</option>)}</select></div>
            <div className="mm-field"><label>Import as</label>
              <select value={reportType} onChange={(e) => setReportType(e.target.value as 'Mortality' | 'Morbidity')}><option>Mortality</option><option>Morbidity</option></select></div>
            {FIELDS.map((f) => (
              <div className="mm-field" key={f.key}><label>{f.label}</label>
                <select value={map[f.key] ?? ''} onChange={(e) => setMap({ ...map, [f.key]: e.target.value })}>
                  <option value="">— not in file —</option>
                  {headers.map((h) => <option key={h} value={h}>{h}</option>)}
                </select>
              </div>
            ))}
          </div>

          {identifierCols.length > 0 && (
            <div className="note" style={{ marginTop: 14, borderColor: '#FBBF24', background: '#FFFBEB' }}>
              <b>Dropped (identifiers, not imported):</b> {identifierCols.join(', ')}
            </div>
          )}
          {unmatchedDepts.length > 0 && (
            <div className="note" style={{ marginTop: 10 }}>
              <b>{unmatchedDepts.length} department name(s) didn&apos;t match</b> the portal list and will import with no
              department (you can set it per case later): {unmatchedDepts.slice(0, 8).join(', ')}{unmatchedDepts.length > 8 ? '…' : ''}
            </div>
          )}

          <div className="mm-sec">Preview (first {Math.min(preview.length, 60)})</div>
          <div className="note" style={{ marginBottom: 10 }}>Whole file imports as <b>{facility}</b>. If the file contains both facilities, map a <b>Facility</b> column above and each row is set from it.</div>
          <div className="vd-scroll"><table className="vd-table">
            <thead><tr><th>Case ID</th><th>Status</th><th>Facility</th><th>Dept</th><th>Race</th><th>Adm ward</th><th>Ward @ death</th><th>Age/Sex</th><th>Admission</th><th>Death</th><th>ToD</th><th>Diagnosis</th><th>BID</th></tr></thead>
            <tbody>{preview.slice(0, 12).map((p, i) => (
              <tr key={i}>
                <td>{p.case_no ?? <span className="badge b-warn">auto</span>}</td>
                <td>{p.case_no ? (p.existing ? <span className="badge b-neut">already in portal</span> : <span className="badge b-info">new</span>) : <span className="badge b-warn">auto-number</span>}</td>
                <td><span className={`badge ${p.facility === 'PPUiTM' ? 'b-blue' : 'b-info'}`}>{p.facility}</span></td>
                <td>{p.dept_code ? departments.find((d) => d.code === p.dept_code)?.name : <span className="badge b-warn">unmatched</span>}</td>
                <td>{p.race ?? '—'}</td><td>{p.admission_ward ?? '—'}</td><td>{p.ward ?? '—'}</td>
                <td>{p.age ?? '?'} / {p.sex ?? '?'}</td>
                <td>{p.admission_date ?? '—'}</td><td>{p.death_datetime?.slice(0, 10) ?? '—'}</td>
                <td>{p.time_of_death ?? '—'}</td>
                <td>{p.diagnosis ?? '—'}</td><td>{p.is_bid ? <span className="badge b-neut">BID</span> : ''}</td>
              </tr>
            ))}</tbody>
          </table></div>

          <div className="mm-formnav">
            <button type="button" className="mm-btn" onClick={() => setStep('pick')}>Back</button>
            <button type="button" className="mm-btn primary" disabled={busy || importCounts.nu === 0} onClick={doImport}>
              {busy ? 'Importing…' : `Import ${importCounts.nu} new case${importCounts.nu === 1 ? '' : 's'}${importCounts.sk > 0 ? ` (${importCounts.sk} skipped)` : ''}`}
            </button>
          </div>
        </>
      )}
    </div>
  )
}
