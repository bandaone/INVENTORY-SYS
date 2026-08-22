'use client'

import {
  ArrowRight, BadgeCheck, Banknote, Boxes, Building2, Check, CheckCircle2,
  CircleAlert, Info, Loader2, LockKeyhole, ShieldCheck, Store, Users,
} from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useEffect, useMemo, useRef, useState } from 'react'
import styles from '@/components/onboarding/onboarding.module.css'

type OnboardingData = {
  session: Record<string, unknown> | null
  tenant: { name?: string; status?: string } | null
  subscription: {
    name: string
    price_zmw: number
    currency: string
    max_locations: number
    max_users: number
    active_locations: number
    active_users: number
  } | null
  settings: Record<string, unknown> | null
  location: { id?: string; name?: string; address?: string } | null
  staff: Array<Record<string, unknown>>
  counts: { products: number; stock: number }
}

const steps = [
  { key: 'business', title: 'Business', desc: 'Receipt and contact identity', icon: Building2, field: 'business_profile_completed' },
  { key: 'location', title: 'Store', desc: 'Confirm the first location', icon: Store, field: 'location_created' },
  { key: 'team', title: 'Team', desc: 'Add store-level access', icon: Users, field: 'staff_created' },
  { key: 'catalog', title: 'Catalog', desc: 'Prepare the first product', icon: Boxes, field: 'products_loaded' },
  { key: 'payments', title: 'Payments', desc: 'Optional merchant wallets', icon: Banknote, field: 'hardware_paired' },
  { key: 'tax', title: 'ZRA', desc: 'Optional tax connection', icon: ShieldCheck, field: 'first_stock_received' },
  { key: 'launch', title: 'Launch', desc: 'Review and enter dashboard', icon: BadgeCheck, field: 'go_live_approved' },
] as const

type StepKey = (typeof steps)[number]['key']

export default function SetupWizard() {
  const router = useRouter()
  const [data, setData] = useState<OnboardingData | null>(null)
  const [active, setActive] = useState<StepKey>('business')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const headingRef = useRef<HTMLHeadingElement>(null)

  const [business, setBusiness] = useState({ business_name: '', owner_email: '', owner_phone: '', receipt_footer: '' })
  const [location, setLocation] = useState({ name: 'Main Store', address: '' })
  const [team, setTeam] = useState({ name: '', email: '', role: 'cashier', pin: '' })
  const [catalog, setCatalog] = useState({ product_name: '', category: 'Clothing', color: '', size: '', retail_price: '' })
  const [payments, setPayments] = useState({ mtn_momo_enabled: false, mtn_momo_number: '', airtel_enabled: false, airtel_number: '' })
  const [tax, setTax] = useState({ zra_enabled: false, zra_tpin: '' })

  const applyData = (next: OnboardingData, hydrateForms: boolean) => {
    setData(next)
    if (!hydrateForms) return
    setBusiness({
      business_name: String(next.settings?.business_name || next.tenant?.name || ''),
      owner_email: String(next.settings?.owner_email || ''),
      owner_phone: String(next.settings?.owner_phone || ''),
      receipt_footer: String(next.settings?.receipt_footer || 'Thank you for shopping with us!'),
    })
    setLocation({ name: next.location?.name || 'Main Store', address: next.location?.address || '' })
    setPayments({
      mtn_momo_enabled: Boolean(next.settings?.mtn_momo_enabled),
      mtn_momo_number: String(next.settings?.mtn_momo_number || ''),
      airtel_enabled: Boolean(next.settings?.airtel_enabled),
      airtel_number: String(next.settings?.airtel_number || ''),
    })
    setTax({ zra_enabled: Boolean(next.settings?.zra_enabled), zra_tpin: String(next.settings?.zra_tpin || '') })
    const current = steps.find((step) => !next.session?.[step.field])?.key || 'launch'
    setActive(current)
  }

  const fetchOnboarding = async (hydrateForms = false) => {
    const response = await fetch('/api/onboarding', { cache: 'no-store' })
    const next = await response.json().catch(() => ({}))
    if (!response.ok) throw new Error(next.error || 'Failed to load onboarding')
    applyData(next as OnboardingData, hydrateForms)
  }

  useEffect(() => {
    let activeRequest = true
    void (async () => {
      try {
        const response = await fetch('/api/onboarding', { cache: 'no-store' })
        const next = await response.json().catch(() => ({}))
        if (!response.ok) throw new Error(next.error || 'Failed to load onboarding')
        if (activeRequest) applyData(next as OnboardingData, true)
      } catch (requestError) {
        if (activeRequest) setError(requestError instanceof Error ? requestError.message : 'Unable to load onboarding.')
      } finally {
        if (activeRequest) setLoading(false)
      }
    })()
    return () => { activeRequest = false }
  }, [])

  useEffect(() => { headingRef.current?.focus() }, [active])

  const completedCount = useMemo(() => {
    if (!data?.session) return 0
    return steps.filter((step) => Boolean(data.session?.[step.field])).length
  }, [data])

  const progress = Math.round((completedCount / steps.length) * 100)
  const activeIndex = Math.max(0, steps.findIndex((step) => step.key === active))
  const activeStep = steps[activeIndex] || steps[0]
  const ActiveIcon = activeStep.icon
  const atUserCapacity = Boolean(data?.subscription && data.subscription.active_users >= data.subscription.max_users)

  const save = async (step: StepKey, payload: Record<string, unknown>) => {
    setSaving(true)
    setError('')
    setMessage('')
    try {
      const response = await fetch('/api/onboarding', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ step, payload }),
      })
      const result = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(result.error || 'Could not save this step')
      await fetchOnboarding(false)
      const nextStep = steps[Math.min(activeIndex + 1, steps.length - 1)]
      setActive(nextStep.key)
      setMessage('Saved. Your workspace is up to date.')
      window.setTimeout(() => setMessage(''), 3000)
      return true
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Unable to save this step.')
      return false
    } finally {
      setSaving(false)
    }
  }

  const finish = async () => {
    if (await save('launch', {})) router.replace('/')
  }

  if (loading) {
    return <div className={`${styles.page} ${styles.loading}`}><Loader2 size={28} className={styles.spinner} /><span>Preparing your workspace…</span></div>
  }

  return (
    <main className={`${styles.page} ${styles.setupLayout}`}>
      <aside className={`${styles.rail} ${styles.setupRail}`} aria-label="Setup progress">
        <div>
          <p className={styles.railEyebrow}>Retail OS setup</p>
          <h1 className={styles.railTitle}>{data?.tenant?.name || 'Your workspace'}</h1>
          <p className={styles.railCopy}>Complete the operating details that matter now. Optional connections can be revisited later.</p>
        </div>
        <div className={styles.progressTrack} aria-label={`${progress}% setup complete`}>
          <div className={styles.progressValue} style={{ width: `${progress}%` }} />
        </div>
        <nav className={styles.stepList} style={{ marginTop: 22 }} aria-label="Workspace setup steps">
          {steps.map((step, index) => {
            const Icon = step.icon
            const isActive = active === step.key
            const isDone = Boolean(data?.session?.[step.field])
            return (
              <button key={step.key} type="button" className={`${styles.stepButton} ${isActive ? styles.stepButtonActive : ''} ${isDone ? styles.stepButtonDone : ''}`} onClick={() => setActive(step.key)} aria-current={isActive ? 'step' : undefined}>
                <span className={styles.stepNumber}>{isDone && !isActive ? <Check size={16} /> : <Icon size={16} />}</span>
                <span><span className={styles.stepTitle}>{index + 1}. {step.title}</span><span className={styles.stepHint}>{step.desc}</span></span>
              </button>
            )
          })}
        </nav>
        <div className={styles.railCard}>
          <div className={styles.railCardTitle}><LockKeyhole size={16} /> Tenant boundary active</div>
          <p>New stores and users remain scoped to this workspace and are checked against the {data?.subscription?.name || 'selected'} plan.</p>
        </div>
      </aside>

      <section className={styles.setupContent}>
        <div className={styles.setupTopline}>
          <div>
            <p className={styles.eyebrow}>Guided operating setup</p>
            <h2 className={styles.heading} style={{ fontSize: 34 }}>Finish the essentials</h2>
          </div>
          <div className={styles.setupPlan} aria-label="Subscription capacity">
            <span className={styles.statusPill}>{data?.subscription?.name || 'Plan'} · {data?.tenant?.status || 'TRIAL'}</span>
            <span className={styles.statusPill}>{data?.subscription?.active_locations || 0}/{data?.subscription?.max_locations || 0} stores</span>
            <span className={styles.statusPill}>{data?.subscription?.active_users || 0}/{data?.subscription?.max_users || 0} users</span>
          </div>
        </div>

        <section className={`${styles.panel} ${styles.setupPanel}`}>
          <header className={styles.panelHeader}>
            <span className={styles.panelIcon}><ActiveIcon size={20} /></span>
            <div><h2 ref={headingRef} tabIndex={-1}>{activeStep.title}</h2><p>{activeStep.desc}</p></div>
          </header>

          {error && <div className={styles.alert} role="alert"><CircleAlert size={18} /><span>{error}</span></div>}
          {message && <div className={`${styles.alert} ${styles.successAlert}`} role="status"><CheckCircle2 size={18} /><span>{message}</span></div>}

          <div key={active} className={styles.stepCanvas}>
            {active === 'business' && (
              <div className={styles.fields}>
                <div className={styles.fieldGrid}>
                  <InputField id="setup-business" label="Business name" value={business.business_name} onChange={(value) => setBusiness({ ...business, business_name: value })} placeholder="Mwape General Trading" />
                  <InputField id="setup-email" label="Business contact email" type="email" value={business.owner_email} onChange={(value) => setBusiness({ ...business, owner_email: value })} placeholder="accounts@yourstore.co.zm" />
                </div>
                <InputField id="setup-phone" label="Business phone" type="tel" value={business.owner_phone} onChange={(value) => setBusiness({ ...business, owner_phone: value })} placeholder="0977 123 456" />
                <InputField id="setup-footer" label="Receipt footer" value={business.receipt_footer} onChange={(value) => setBusiness({ ...business, receipt_footer: value })} placeholder="Thank you for shopping with us!" />
                <StepAction saving={saving} onClick={() => void save('business', business)} />
              </div>
            )}

            {active === 'location' && (
              <div className={styles.fields}>
                <div className={styles.infoStrip}><Info size={17} /><span>This is the first store boundary. Additional branches can be added after launch, up to the plan limit shown above.</span></div>
                <InputField id="setup-location" label="Store name" value={location.name} onChange={(value) => setLocation({ ...location, name: value })} placeholder="Main Store — Manda Hill" />
                <InputField id="setup-address" label="Physical address" value={location.address} onChange={(value) => setLocation({ ...location, address: value })} placeholder="Shop 12, Manda Hill Mall, Lusaka" />
                <StepAction saving={saving} onClick={() => void save('location', location)} />
              </div>
            )}

            {active === 'team' && (
              <div className={styles.fields}>
                <div className={styles.infoStrip}><Store size={17} /><span>New access will belong to <strong>{data?.location?.name || 'your first store'}</strong>. The owner already uses one of {data?.subscription?.max_users || 0} plan seats.</span></div>
                {atUserCapacity && <div className={styles.alert} role="alert"><CircleAlert size={18} /><span>This plan has reached its active-user limit. Upgrade or deactivate a user before adding another.</span></div>}
                <div className={styles.fieldGrid}>
                  <InputField id="team-name" label="Team member name" value={team.name} onChange={(value) => setTeam({ ...team, name: value })} placeholder="Bwalya Mutale" />
                  <InputField id="team-email" label="Unique login email" type="email" value={team.email} onChange={(value) => setTeam({ ...team, email: value })} placeholder="bwalya@yourstore.co.zm" />
                  <SelectField id="team-role" label="Store role" value={team.role} onChange={(value) => setTeam({ ...team, role: value })} options={[['cashier', 'Cashier'], ['stock_clerk', 'Stock clerk'], ['store_manager', 'Store manager']]} />
                  <InputField id="team-pin" label="4-digit login PIN" type="password" inputMode="numeric" maxLength={4} value={team.pin} onChange={(value) => setTeam({ ...team, pin: value.replace(/\D/g, '').slice(0, 4) })} placeholder="••••" />
                </div>
                <StepAction saving={saving} disabled={atUserCapacity && Boolean(team.name)} label={team.name ? 'Create store user' : 'Continue without adding'} onClick={() => void save('team', team)} meta={`${data?.subscription?.active_users || data?.staff?.length || 0} active users`} />
              </div>
            )}

            {active === 'catalog' && (
              <div className={styles.fields}>
                <div className={styles.infoStrip}><Info size={17} /><span>Add one product to preview the inventory workflow, or continue and use the Excel import after launch.</span></div>
                <div className={styles.fieldGrid}>
                  <InputField id="product-name" label="Product name" value={catalog.product_name} onChange={(value) => setCatalog({ ...catalog, product_name: value })} placeholder="Chitenge Fabric — 6 Yards" />
                  <InputField id="product-category" label="Category" value={catalog.category} onChange={(value) => setCatalog({ ...catalog, category: value })} placeholder="Fabrics" />
                  <InputField id="product-color" label="Color" optional value={catalog.color} onChange={(value) => setCatalog({ ...catalog, color: value })} placeholder="Green & Gold" />
                  <InputField id="product-size" label="Size" optional value={catalog.size} onChange={(value) => setCatalog({ ...catalog, size: value })} placeholder="6 yds" />
                </div>
                <InputField id="product-price" label="Retail price (ZMW)" type="number" value={catalog.retail_price} onChange={(value) => setCatalog({ ...catalog, retail_price: value })} placeholder="250" />
                <StepAction saving={saving} label={catalog.product_name ? 'Save first product' : 'Continue to payments'} onClick={() => void save('catalog', catalog)} meta={`${data?.counts.products || 0} products loaded`} />
              </div>
            )}

            {active === 'payments' && (
              <div className={styles.fields}>
                <ProviderToggle title="MTN Mobile Money" description="Merchant wallet or till used at checkout" logo="M" color="#e6a800" checked={payments.mtn_momo_enabled} value={payments.mtn_momo_number} onCheck={(checked) => setPayments({ ...payments, mtn_momo_enabled: checked })} onValue={(value) => setPayments({ ...payments, mtn_momo_number: value })} />
                <ProviderToggle title="Airtel Money" description="Airtel merchant wallet used at checkout" logo="A" color="#d83131" checked={payments.airtel_enabled} value={payments.airtel_number} onCheck={(checked) => setPayments({ ...payments, airtel_enabled: checked })} onValue={(value) => setPayments({ ...payments, airtel_number: value })} />
                <StepAction saving={saving} onClick={() => void save('payments', payments)} />
              </div>
            )}

            {active === 'tax' && (
              <div className={styles.fields}>
                <div className={styles.infoStrip}><ShieldCheck size={17} /><span>Connect ZRA only when your company TPIN is ready. Skipping this step does not falsely mark the integration as enabled.</span></div>
                <label className={styles.providerCard}>
                  <span className={styles.providerHead}>
                    <span><span className={styles.providerTitle}>Enable ZRA Smart Invoice</span><span className={styles.providerDescription}>Prepare automated tax document synchronization</span></span>
                    <input className={styles.checkbox} type="checkbox" checked={tax.zra_enabled} onChange={(event) => setTax({ ...tax, zra_enabled: event.target.checked })} />
                  </span>
                </label>
                {tax.zra_enabled && <InputField id="zra-tpin" label="10-digit company TPIN" inputMode="numeric" maxLength={10} value={tax.zra_tpin} onChange={(value) => setTax({ ...tax, zra_tpin: value.replace(/\D/g, '').slice(0, 10) })} placeholder="1001234567" />}
                <StepAction saving={saving} onClick={() => void save('tax', tax)} />
              </div>
            )}

            {active === 'launch' && (
              <div>
                <div className={styles.completionIcon}><BadgeCheck size={29} /></div>
                <h2 style={{ marginTop: 20, fontSize: 28 }}>Your operating workspace is ready</h2>
                <p className={styles.description}>Review the readiness signals below. Optional items remain available from settings after launch.</p>
                <div className={styles.launchGrid}>
                  <LaunchItem label="Business profile" done={Boolean(data?.session?.business_profile_completed)} />
                  <LaunchItem label="First store" done={Boolean(data?.session?.location_created)} />
                  <LaunchItem label="Owner and team access" done={Boolean(data?.session?.staff_created)} />
                  <LaunchItem label="Product catalog" done={Boolean(data?.session?.products_loaded)} />
                  <LaunchItem label="Payment wallets" done={Boolean(data?.session?.hardware_paired)} />
                  <LaunchItem label="ZRA review" done={Boolean(data?.session?.first_stock_received)} />
                </div>
                <button className={`${styles.buttonPrimary} ${styles.buttonWide}`} type="button" onClick={() => void finish()} disabled={saving}>
                  {saving ? <Loader2 className={styles.spinner} size={17} /> : <ArrowRight size={17} />}
                  {saving ? 'Finalizing workspace…' : 'Enter owner dashboard'}
                </button>
              </div>
            )}
          </div>
        </section>
      </section>
    </main>
  )
}

type InputFieldProps = {
  id: string
  label: string
  value: string
  onChange: (value: string) => void
  placeholder?: string
  type?: string
  inputMode?: React.HTMLAttributes<HTMLInputElement>['inputMode']
  maxLength?: number
  optional?: boolean
}

function InputField({ id, label, value, onChange, placeholder, type = 'text', inputMode, maxLength, optional }: InputFieldProps) {
  return <div className={styles.field}><label className={styles.label} htmlFor={id}>{label}{optional && <span className={styles.optional}>Optional</span>}</label><input className={styles.input} id={id} type={type} value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} inputMode={inputMode} maxLength={maxLength} /></div>
}

function SelectField({ id, label, value, onChange, options }: { id: string; label: string; value: string; onChange: (value: string) => void; options: Array<[string, string]> }) {
  return <div className={styles.field}><label className={styles.label} htmlFor={id}>{label}</label><select className={styles.select} id={id} value={value} onChange={(event) => onChange(event.target.value)}>{options.map(([optionValue, optionLabel]) => <option key={optionValue} value={optionValue}>{optionLabel}</option>)}</select></div>
}

function StepAction({ saving, onClick, label = 'Save and continue', meta, disabled = false }: { saving: boolean; onClick: () => void; label?: string; meta?: string; disabled?: boolean }) {
  return <div className={styles.actions}>{meta ? <span className={styles.help}>{meta}</span> : <span />}<button className={styles.buttonPrimary} type="button" onClick={onClick} disabled={saving || disabled}>{saving ? <Loader2 className={styles.spinner} size={17} /> : <ArrowRight size={17} />}{saving ? 'Saving…' : label}</button></div>
}

function ProviderToggle({ title, description, logo, color, checked, value, onCheck, onValue }: { title: string; description: string; logo: string; color: string; checked: boolean; value: string; onCheck: (checked: boolean) => void; onValue: (value: string) => void }) {
  return (
    <div className={`${styles.providerCard} ${checked ? styles.providerCardActive : ''}`}>
      <label className={styles.providerHead}>
        <span className={styles.providerIdentity}><span className={styles.providerLogo} style={{ background: color }}>{logo}</span><span><span className={styles.providerTitle}>{title}</span><span className={styles.providerDescription}>{description}</span></span></span>
        <input className={styles.checkbox} type="checkbox" checked={checked} onChange={(event) => onCheck(event.target.checked)} />
      </label>
      {checked && <div className={styles.providerField}><InputField id={`${logo}-merchant-number`} label="Merchant wallet or till number" value={value} onChange={onValue} placeholder="Enter business number" /></div>}
    </div>
  )
}

function LaunchItem({ label, done }: { label: string; done: boolean }) {
  return <div className={`${styles.launchItem} ${done ? styles.launchItemDone : ''}`}>{done ? <CheckCircle2 size={17} /> : <span aria-hidden="true">○</span>}<span>{label}</span></div>
}
