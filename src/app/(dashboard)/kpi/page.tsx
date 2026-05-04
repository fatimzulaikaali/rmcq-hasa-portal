'use client'

import { AppShell, Topbar } from '@/components/AppShell'

export default function KpiPage() {
  return (
    <AppShell>
      <Topbar title="KPI Monitor" meta="Performance Indicator tracking" />
      <main className="flex-1 p-6">
        <div className="rounded-lg border border-[var(--border)] bg-white p-6 text-sm text-[var(--muted)]">
          KPI Monitor — coming soon
        </div>
      </main>
    </AppShell>
  )
}
