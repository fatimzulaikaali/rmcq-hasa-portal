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
  { key: 'facility', label: 'Facility (optional column)', kw: ['facility', 'fasiliti', 'hospital', 'pusat', 'ppuitm', 'hasa'] },
  { key: 'department', label: 'Department', kw: ['depart', 'jabatan', 'dept', 'unit', 'ward dept', 'discipline'] },
  { key: 'ward', label: 'Ward / location', kw: ['ward', 'wad', 'location', 'lokasi', 'bed'] },
  { key: 'age', label: 'Age', kw: ['age', 'umur'] },
  { key: 'sex', label: 'Sex', kw: ['sex', 'gender', 'jantina'] },
  { key: 'admission_date', label: 'Admission date', kw: ['admiss', 'masuk', 'doa', 'adm date'] },
  { key: 'death_datetime', label: 'Death date/time', kw: ['death', 'demise', 'mati', 'meninggal', 'dod', 'expired', 'tarikh kematian'] },
  { key: 'diagnosis', label: 'Diagnosis', kw: ['diagnos', 'diagnosa'] },
  { key: 'cause_icd', label: 'Cause of death (ICD)', kw: ['cause', 'icd', 'punca'] },
]
const IDENTIFIER_KW = ['name', 'nama', 'nric', 'ic', 'kad pengenalan', 'mrn', 'rn no', 'passport', 'pesakit', 'patient name']

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

  const identifierCols = useMemo(
    () => headers.filter((h) => IDENTIFIER_KW.some((k) => norm(h).includes(norm(k)))),
    [headers])

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
      // auto-guess mapping
      const guess: Record<string, string> = {}
      for (const f of FIELDS) {
        const hit = hdrs.find((h) => f.kw.some((k) => norm(h).includes(norm(k))))
        if (hit) guess[f.key] = hit
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
      facility: map.facility ? normFacility(g('facility'), facility) : facility,
      dept_code: matchDept(deptText),
      deptText: String(deptText ?? ''),
      ward: wardText || null,
      age: g('age') != null && g('age') !== '' ? Number(g('age')) : null,
      sex: toSex(g('sex')),
      admission_date: toDateStr(g('admission_date')),
      death_datetime: toDateTimeStr(g('death_datetime')),
      diagnosis: g('diagnosis') != null ? String(g('diagnosis')) : null,
      cause_icd: g('cause_icd') != null ? String(g('cause_icd')) : null,
      is_bid: /bid|brought.?in.?dead|police|polis|forensic/i.test(wardText),
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [rows, map, departments])

  const unmatchedDepts = useMemo(() => {
    const set = new Set<string>()
    for (const p of preview) if (!p.dept_code && p.deptText) set.add(p.deptText)
    return Array.from(set)
  }, [preview])

  async function doImport() {
    setBusy(true); setErr('')
    try {
      const all = rows.map((r) => {
        const g = (k: string) => (map[k] ? r[map[k]] : null)
        const wardText = String(g('ward') ?? '')
        const adm = toDateStr(g('admission_date')); const death = toDateTimeStr(g('death_datetime'))
        let los: number | null = null
        if (adm && death) { const dd = Math.round((new Date(death).getTime() - new Date(adm).getTime()) / 86400000); if (dd >= 0) los = dd }
        return {
          report_type: reportType,
          facility: map.facility ? normFacility(g('facility'), facility) : facility,
          dept_code: matchDept(g('department')),
          ward: wardText || null,
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
        }
      })
      // assign sequential case numbers (never derived from any identifier)
      const used = [...existingCaseNos]
      const withNo = all.map((row) => { const case_no = nextCaseNo(used); used.push(case_no); return { ...row, case_no } })
      const { error } = await supabase.from('mm_cases').insert(withNo)
      if (error) { setErr(error.message); setBusy(false); return }
      onDone(withNo.length)
    } catch (e) { setErr(e instanceof Error ? e.message : 'Import failed'); setBusy(false) }
  }

  return (
    <div className="mm-form">
      {err && <div className="mm-err">{err}</div>}

      <div className="note" style={{ marginTop: 0, marginBottom: 16 }}>
        <b>Privacy:</b> only de-identified columns are imported. Patient <b>name</b> and <b>NRIC</b> are never
        mapped or stored — they are dropped here in your browser and never sent to the portal. Each case is
        given a new case number; that number is the only bridge back to your secured list.
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
            <thead><tr><th>Facility</th><th>Dept</th><th>Ward</th><th>Age/Sex</th><th>Admission</th><th>Death</th><th>Diagnosis</th><th>BID</th></tr></thead>
            <tbody>{preview.slice(0, 12).map((p, i) => (
              <tr key={i}>
                <td><span className={`badge ${p.facility === 'PPUiTM' ? 'b-blue' : 'b-info'}`}>{p.facility}</span></td>
                <td>{p.dept_code ? departments.find((d) => d.code === p.dept_code)?.name : <span className="badge b-warn">unmatched</span>}</td>
                <td>{p.ward ?? '—'}</td><td>{p.age ?? '?'} / {p.sex ?? '?'}</td>
                <td>{p.admission_date ?? '—'}</td><td>{p.death_datetime?.slice(0, 10) ?? '—'}</td>
                <td>{p.diagnosis ?? '—'}</td><td>{p.is_bid ? <span className="badge b-neut">BID</span> : ''}</td>
              </tr>
            ))}</tbody>
          </table></div>

          <div className="mm-formnav">
            <button type="button" className="mm-btn" onClick={() => setStep('pick')}>Back</button>
            <button type="button" className="mm-btn primary" disabled={busy} onClick={doImport}>
              {busy ? 'Importing…' : `Import ${rows.length} case${rows.length === 1 ? '' : 's'}`}
            </button>
          </div>
        </>
      )}
    </div>
  )
}
