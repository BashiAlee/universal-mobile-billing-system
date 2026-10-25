import { Fragment, useCallback, useState } from 'react'
import { SettingsProvider } from './lib/SettingsProvider'
import { useSettings } from './lib/useSettings'
import { PrintArea, type PrintJob } from './components/Print'
import BillingPage from './pages/Billing'
import ProductsPage from './pages/Products'
import PurchasesPage from './pages/Purchases'
import PartiesPage from './pages/Parties'
import BillsPage from './pages/Bills'
import DashboardPage from './pages/Dashboard'
import DayBookPage from './pages/DayBook'
import LabelDesignerPage from './pages/LabelDesigner'
import { ErrorBoundary } from './components/ErrorBoundary'
import ReportsPage from './pages/Reports'
import SettingsPage from './pages/Settings'

type Tab =
  | 'billing'
  | 'dashboard'
  | 'products'
  | 'labeldesign'
  | 'purchases'
  | 'parties'
  | 'bills'
  | 'daybook'
  | 'reports'
  | 'settings'
const TABS: { id: Tab; label: string }[] = [
  { id: 'billing', label: 'New bill' },
  { id: 'dashboard', label: 'Dashboard' },
  { id: 'products', label: 'Products & stock' },
  { id: 'labeldesign', label: 'Label designer' },
  { id: 'purchases', label: 'Purchases' },
  { id: 'parties', label: 'Parties' },
  { id: 'bills', label: 'Bill history' },
  { id: 'daybook', label: 'Day book' },
  { id: 'reports', label: 'Reports' },
  { id: 'settings', label: 'Settings' }
]

function Shell(): React.JSX.Element {
  const { settings } = useSettings()
  const [tab, setTab] = useState<Tab>('billing')
  const [job, setJob] = useState<PrintJob | null>(null)
  const done = useCallback(() => setJob(null), [])

  if (!settings) return <p style={{ padding: 24 }}>Loading…</p>
  return (
    <Fragment>
      <div className="app no-print">
        <nav className="sidebar" aria-label="Main">
          <div className="brand">
            {settings.logoDataUrl && <img src={settings.logoDataUrl} alt="" />}
            <strong>{settings.shopName}</strong>
          </div>
          {TABS.map((t) => (
            <button
              key={t.id}
              className={tab === t.id ? 'active' : ''}
              onClick={() => setTab(t.id)}
              aria-current={tab === t.id ? 'page' : undefined}
            >
              {t.label}
            </button>
          ))}
        </nav>
        <main>
          <ErrorBoundary key={tab}>
            {tab === 'billing' && <BillingPage onPrint={setJob} />}
            {tab === 'dashboard' && <DashboardPage onGo={setTab} />}
            {tab === 'products' && <ProductsPage onPrint={setJob} />}
            {tab === 'labeldesign' && <LabelDesignerPage onPrint={setJob} />}
            {tab === 'purchases' && <PurchasesPage />}
            {tab === 'parties' && <PartiesPage />}
            {tab === 'bills' && <BillsPage onPrint={setJob} />}
            {tab === 'daybook' && <DayBookPage />}
            {tab === 'reports' && <ReportsPage />}
            {tab === 'settings' && <SettingsPage onPrint={setJob} />}
          </ErrorBoundary>
        </main>
      </div>
      {job && <PrintArea job={job} settings={settings} onDone={done} />}
    </Fragment>
  )
}

export default function App(): React.JSX.Element {
  return (
    <SettingsProvider>
      <Shell />
    </SettingsProvider>
  )
}
