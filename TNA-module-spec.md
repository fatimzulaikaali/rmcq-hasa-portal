# Modul TNA & Kompetensi — Spesifikasi (Fasa 1–4)

**Status:** DRAF untuk semakan Dr. Fatim. Belum ada kod. Skema: `sql/tna-01-schema.sql` (DRAF, belum dijalankan).
**Rujukan:** `TNA_RMCQ_2027_Kamus_Kompetensi.xlsx`, Kamus Kompetensi UiTM 2021, prototaip HTML "TNA Kompetensi RMCQ".
**Laluan portal:** `/tna` (modul, log masuk) · `/tna/s/[token]` (link unik staf, tanpa log masuk)

---

## 1. Apa modul ini

Menggantikan workbook TNA Excel dengan modul portal yang:

1. menyimpan **Kamus Kompetensi** (Lapisan A Generik UiTM ikut gred · Lapisan B Kefungsian RMCQ) dan **profil jawatan** (tahap diperlukan ikut jawatan, gred, unit);
2. menghantar **link unik** kepada setiap staf untuk **penilaian kendiri** (pengesahan dengan no. staf);
3. membolehkan **penyelia mengesahkan** tahap dipersetujui (Kamus UiTM 1.6.1);
4. mengira **jurang, keutamaan** dan **pelan latihan** secara automatik, dan **export Excel ikut template pengurusan hospital (8 lajur, padan tepat)**;
5. merekod **latihan hospital** (dapatan insiden / audit) dan **bukti latihan** ke Google Drive (guna semula sambungan Drive modul Akreditasi);
6. berjalan **mengikut kitaran tahunan** — kitaran baharu menyalin kamus, profil dan staf aktif.

## 2. Keputusan yang telah dikunci

| # | Keputusan | Sumber |
|---|---|---|
| D1 | Skala **1–5** (Asas, Kompeten, Cekap, Pakar, Pakar Strategi). Tiada tahap 0. | Fatim, 8 Okt |
| D2 | Pengesahan staf: **link unik + no. staf**. Token disimpan sebagai hash SHA-256; link dikunci 15 minit selepas 5 cubaan gagal. | Fatim, 8 Okt |
| D3 | Penilaian **kendiri → penyelia sahkan**. Jurang dikira daripada tahap dipersetujui sahaja. | Cadangan, diterima |
| D4 | Skop: **RMCQ dahulu**, struktur data generik (`dept_code`) untuk jabatan lain. | Cadangan, diterima |
| D5 | Staf boleh **ditambah, diarkib, dipulihkan**; jawatan kosong kekal sebagai profil. Arkib tidak memadam rekod. | Fatim, 8 Okt |
| D6 | **Setiap latihan boleh disunting** (jabatan & hospital), tambah baharu, arkib. Semua suntingan dilog (siapa, bila, teks lama). | Fatim, 8 Okt |
| D7 | Latihan hospital: penganjur **tidak semestinya RMCQ**; peranan RMCQ = Penganjur / Penyelaras bersama / Pemantau. | Fatim, 8 Okt |
| D8 | Lapisan A guna **Kamus UiTM Bab 3–6 sahaja (staf pentadbiran)**: Nilai, Kepimpinan, Teras Pentadbiran, Generik Pentadbiran. Bab 7–8 (akademik) tidak dimuatkan. | Fatim, 8 Okt |
| D9 | **Kamus boleh ditambah** di portal: kompetensi baharu (mana-mana lapisan / kluster), petunjuk perilaku 1–5, gred yang terpakai, latihan cadangan. Sumber ditanda `Tambahan`; kompetensi lama dinyahaktif, tidak dipadam. | Fatim, 8 Okt |

## 3. Keputusan tambahan (8 Okt) & yang masih terbuka

| # | Soalan | Keputusan |
|---|---|---|
| Q1 | Staf nampak **tahap diperlukan** semasa menilai? | **Ya** — dipaparkan pada setiap kompetensi |
| Q2 | Staf nampak **jurang & pelan latihan (IDP)** selepas disahkan? | **Ya** — tab "Pelan Saya" pada link staf |
| Q3 | Siapa mengesahkan? | **Ketua Jabatan mengesahkan semua staf.** `supervisor_staff_id` = KJ bagi semua assignment |
| Q4 | Cara hantar link | **WhatsApp / emel oleh RMCQ.** Portal sediakan butang *Salin link*, *Salin mesej* (teks siap dengan nama + link + tarikh tutup) dan *Buka WhatsApp* (wa.me dengan mesej terisi). Tiada servis emel automatik |
| Q5 | Kotak "Belum pernah terdedah" | **Tambah.** Muncul di bawah pilihan 1 Asas sahaja. Skala kekal 1–5; jurang dikira sama. Kesan: staf ditanda untuk **latihan pengenalan dahulu**, dan skor jurang kompetensi itu dinaikkan +1 (maks 3) dalam keutamaan jabatan. Lajur `never_exposed` |
| Q6 | Akses modul | **Semua pengguna portal yang log masuk** (model sama seperti VMO). Tiada senarai pentadbir berasingan. Nota: penilaian kompetensi staf boleh dilihat oleh semua pengguna portal |
| Q7 | Penilaian **Ketua Jabatan sendiri** | **Penilaian kendiri KJ terus dikira disahkan** semasa dihantar |

## 4. Model data (ringkasan — lihat `sql/tna-01-schema.sql`)

```
tna_cycles ──< tna_positions ──< tna_position_requirements >── tna_competencies ──< tna_competency_levels
     │              │                                                   │
     │              └──< tna_assignments >── tna_staff                  │
     │                        │                                         │
     │                        ├──< tna_assessment_items (self / agreed) ┘
     │                        └──< tna_training_records ──< tna_evidence (Drive)
     ├──< tna_issues              (Langkah 1–2)
     ├──< tna_priority_inputs     (impak × strategik per kompetensi)
     └──< tna_programmes ──< tna_programme_competencies
                 └──< tna_sessions ──< tna_evidence (senarai kehadiran, slaid, gambar)
tna_units · tna_audit_log · tna_link_attempts
```

| Jadual | Kegunaan | Nota |
|---|---|---|
| `tna_cycles` | TNA 2027, 2028 … | status `draft → open → closed`; link hanya berfungsi bila `open` |
| `tna_competencies` / `_levels` | Kamus A + B, petunjuk perilaku 1–5 | tidak per kitaran; suntingan dilog |
| `tna_units` | 5 unit Carta Fungsi + KJ | |
| `tna_positions` / `_requirements` | Profil jawatan (15 jawatan) & tahap diperlukan | per kitaran; jawatan kosong = tiada assignment aktif |
| `tna_staff` | Rekod induk staf | `status active / archived`, sebab & tarikh arkib |
| `tna_assignments` | Staf × kitaran × jawatan + link | `token_hash`, status `not_started → draft → submitted → validated` |
| `tna_assessment_items` | Nilaian kendiri & dipersetujui | satu baris per kompetensi diperlukan |
| `tna_issues` | Langkah 1–2 | |
| `tna_programmes` | Latihan jabatan & hospital | semua medan boleh disunting; `status active / archived` |
| `tna_sessions`, `tna_training_records`, `tna_evidence` | Kehadiran & bukti | fail ke Drive; status `received → verified / rejected` |
| `tna_audit_log` | Jejak suntingan | trigger pada programmes, requirements, competencies, levels, staff |

**Pandangan (view):** `tna_v_gap` (jurang individu, hanya bila `validated`), `tna_v_competency_priority` (bil. staf berjurang, mata jurang, skor jurang 0–3). Label keutamaan dikira dalam aplikasi dengan peraturan yang sama seperti Excel (Tinggi ≥18 · Sederhana 9–17 · Rendah 1–8).

## 5. Keselamatan (RLS)

- **anon** — tiada akses terus ke mana-mana jadual. Hanya melalui RPC `tna_link_get / tna_link_save / tna_link_submit`, yang mengesahkan **token + no. staf** pada setiap panggilan. Semua RPC pulangkan `{ok, error, message}` — kod ralat sebenar dipaparkan di UI (`STAFF_NO_MISMATCH`, `LINK_LOCKED`, `ALREADY_SUBMITTED`, `INCOMPLETE`).
- **Pengguna portal yang log masuk** — baca/tulis penuh pada jadual `tna_*` (keputusan Q6, sama seperti VMO). Pengesahan dibuat oleh KJ melalui tab Pengesahan.
- Penilaian KJ sendiri disahkan automatik semasa dihantar (Q7).
- **Diuji** pada Postgres 16 tempatan: skema dimuatkan tanpa ralat; aliran RPC diuji (no. staf salah → direkod & ditolak; hantar tidak lengkap → `INCOMPLETE`; kompetensi bukan milik jawatan diabaikan; selepas hantar → `ALREADY_SUBMITTED`; jurang kekal kosong sehingga disahkan). Belum diuji pada projek Supabase sebenar.

## 6. Skrin

### 6.1 Awam — `/tna/s/[token]` (telefon dahulu, BM/EN)
1. **Sahkan** — masukkan no. staf; ralat dengan kod.
2. **Profil** — nama, jawatan, gred, unit, tahap gred Kamus; butang "Laporkan kesilapan".
3. **Penilaian** — ikut kluster (Asas RMCQ, Kefungsian Unit, Merentas, Nilai, Teras, Generik, Kepimpinan); setiap kompetensi: definisi + 5 pilihan dengan petunjuk perilaku; nota bukti (pilihan); simpan draf automatik.
4. **Semak & hantar** — senarai, akuan, hantar → dikunci.
5. **Pelan Saya (IDP)** (Fasa 2) — selepas KJ sahkan: tahap dipersetujui, jurang dan latihan dicadangkan.
6. **Latihan & Bukti** (Fasa 3) — muat naik sijil, rekod latihan hospital / kursus luar.

### 6.2 Portal — `/tna` (tab bar sama gaya IR / KPI / PSCS)

| Tab | Fasa | Pengguna | Isi |
|---|---|---|---|
| Ringkasan | 1 | Admin | Kad status kitaran, peta jurang staf × kompetensi |
| Penilaian | 1 | Admin | Status setiap staf; Salin link · Salin mesej · Buka WhatsApp; jana semula link; mesej peringatan |
| Pengesahan | 1 | Ketua Jabatan | Senarai semua staf; diperlukan / kendiri / dipersetujui / jurang; Sahkan · Buka semula |
| Staf | 1 | Admin | Tambah, arkib (sebab + tarikh), pulihkan, isi jawatan kosong |
| Profil Jawatan | 1 | Admin | Matriks jawatan × kompetensi (tahap diperlukan), boleh sunting |
| Kamus | 1 | Admin | Senarai kompetensi ikut lapisan / kluster; **+ Tambah kompetensi** (kod dicadang automatik, cth. R27); sunting nama, definisi, petunjuk 1–5, gred terpakai, latihan cadangan; nyahaktif. Kompetensi baharu boleh terus ditambah ke profil jawatan |
| Kitaran | 1 | Admin | Cipta (salin daripada tahun lepas), buka, tutup |
| Isu & Keperluan | 2 | Admin | Langkah 1–2 |
| Keutamaan & Pelan Latihan | 2 | Admin | Skor, impak/strategik, program jabatan (Edit / Tambah / Arkib), kalendar |
| Export | 2 | Admin | **Excel ikut template pengurusan** + workbook penuh |
| Latihan Hospital | 3 | Admin | Daftar program (Edit / Tambah / Arkib), sesi, bukti Drive |
| Bukti | 3 | Admin | Sahkan / tolak bukti |
| Keberkesanan | 4 | Admin | Penilaian semula, pautan KPI IR / KPI Monitor, trend tahunan |

## 7. API & Drive

- `POST /api/tna/upload` — seperti `/api/acc/upload` (had 4 MB), tetapi menerima **token + no. staf** (link staf) atau sesi log masuk (admin). Folder Drive: `TNA/<tahun>/Staf/<no staf>/` dan `TNA/<tahun>/Hospital/<id program>/<tarikh sesi>/`. Env baharu: `TNA_DRIVE_ROOT_FOLDER_ID` (Apps Script & secret sama dengan Akreditasi).
- `GET /api/tna/export?cycle=2027` — jana `.xlsx` 8 lajur ikut template pengurusan (Fasa 2).

## 8. Data awal

| Fail | Isi | Status |
|---|---|---|
| `sql/tna-02-seed.sql` | Kitaran 2027 (draft), 6 unit, 45 kompetensi (19 Kamus UiTM pentadbiran + 26 RMCQ), 225 petunjuk perilaku, 15 jawatan + 459 tahap diperlukan, 23 program hospital | DRAF — tiada data peribadi |
| `sql/tna-03-seed-staff.sql` | 11 staf (nama + no. staf) + penempatan; KJ sebagai pengesah semua staf | **Data peribadi — jangan commit** (ditambah ke `.gitignore`) |
| `Semakan_Kamus_UiTM_Pentadbiran.xlsx` | Petunjuk perilaku 19 kompetensi UiTM yang diekstrak daripada PDF (ms. 16–34) untuk disemak | Untuk semakan Dr. |

- Lapisan B tahap 5 (Pakar Strategi) guna teks umum — boleh disunting di tab Kamus.
- **Isu dalam Kamus UiTM sendiri:** definisi *Penggubalan & Penguatkuasaan Dasar* (ms. 23) adalah salinan definisi *Pemikiran Strategik*. Seed mengikut PDF; boleh dibetulkan di tab Kamus.
- Diuji pada Postgres 16 tempatan: skema + kedua-dua seed dimuatkan tanpa ralat; menambah kompetensi baharu (R27) berfungsi dan dilog.

## 9. Fasa

| Fasa | Skop | Siap apabila |
|---|---|---|
| 1 | Skema, seed, link staf (sahkan → nilai → hantar), Pengesahan penyelia, Staf, Profil Jawatan, Kamus, Kitaran, Ringkasan | 1 staf ujian boleh nilai di telefon & penyelia sahkan, data betul dalam DB sebenar |
| 2 | Isu & Keperluan, Keutamaan, Pelan Latihan (sunting), Export template | Export Excel padan tepat dengan template pengurusan |
| 3 | Latihan Hospital, sesi, bukti ke Drive (staf & sesi), tab Latihan & Bukti staf | Sijil dimuat naik dari telefon masuk ke folder Drive yang betul |
| 4 | Keberkesanan, pautan IR / KPI, trend tahun ke tahun | Selepas kitaran pertama ditutup |

Setiap fasa: tunjuk perubahan dahulu → Dr. semak → commit atas arahan Dr.
