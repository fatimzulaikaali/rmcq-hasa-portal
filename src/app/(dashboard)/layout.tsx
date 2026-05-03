import Link from 'next/link'
import type { ReactNode } from 'react'

export default function DashboardLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen bg-gray-50">
      <aside className="w-64 shrink-0 border-r border-gray-200 bg-white p-6">
        <h2 className="mb-6 text-lg font-semibold text-gray-900">RMCQ HASA</h2>
        <nav className="flex flex-col gap-2">
          <Link
            href="/ir"
            className="rounded-md px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100 hover:text-gray-900"
          >
            IR Dashboard
          </Link>
          <Link
            href="/kpi"
            className="rounded-md px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100 hover:text-gray-900"
          >
            KPI Monitor
          </Link>
        </nav>
      </aside>
      <main className="flex-1 p-8">{children}</main>
    </div>
  )
}
