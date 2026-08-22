'use client'

import type { PublicSubscriptionPlan } from '@/lib/registration'
import {
  ArrowLeft, ArrowRight, Building2, Check, CircleAlert, Loader2,
  LockKeyhole, MapPin, ShieldCheck, Store, Users,
} from 'lucide-react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useEffect, useMemo, useRef, useState } from 'react'
import styles from './onboarding.module.css'

type RegistrationFlowProps = {
  plans: PublicSubscriptionPlan[]
  trialDays: number
}

type RegistrationForm = {
  businessName: string
  ownerName: string
  locationName: string
  address: string
  phone: string
  email: string
  tier: string
  pin: string
  confirmPin: string
}

type FieldName = keyof RegistrationForm
type FieldErrors = Partial<Record<FieldName, string>>

const flowSteps = [
  { title: 'Business', hint: 'Workspace identity' },
  { title: 'First store', hint: 'Operating location' },
  { title: 'Plan', hint: 'Capacity and tools' },
  { title: 'Owner access', hint: 'Secure and review' },
]

const initialForm: RegistrationForm = {
  businessName: '', ownerName: '', locationName: 'Main Store', address: '',
  phone: '', email: '', tier: '', pin: '', confirmPin: '',
}

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

function formatPrice(value: number) {
  return new Intl.NumberFormat('en-ZM', {
    style: 'currency', currency: 'ZMW', maximumFractionDigits: 0,
  }).format(value)
}

function createRequestId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`
}

export default function RegistrationFlow({ plans, trialDays }: RegistrationFlowProps) {
  const router = useRouter()
  const [step, setStep] = useState(0)
  const [form, setForm] = useState<RegistrationForm>(() => ({
    ...initialForm,
    tier: plans[0]?.code || '',
  }))
  const [errors, setErrors] = useState<FieldErrors>({})
  const [requestError, setRequestError] = useState('')
  const [loading, setLoading] = useState(false)
  const [complete, setComplete] = useState(false)
  const requestId = useRef(createRequestId())
  const headingRef = useRef<HTMLHeadingElement>(null)

  const selectedPlan = useMemo(
    () => plans.find((plan) => plan.code === form.tier) || plans[0] || null,
    [form.tier, plans],
  )

  useEffect(() => {
    if (!form.tier && plans[0]) setForm((current) => ({ ...current, tier: plans[0].code }))
  }, [form.tier, plans])

  useEffect(() => { headingRef.current?.focus() }, [step])

  useEffect(() => {
    if (!complete) return
    const redirect = window.setTimeout(() => router.replace('/setup'), 1200)
    return () => window.clearTimeout(redirect)
  }, [complete, router])

  const update = (field: FieldName, value: string) => {
    setForm((current) => ({ ...current, [field]: value }))
    setErrors((current) => ({ ...current, [field]: undefined }))
    setRequestError('')
  }

  const validateStep = (index: number) => {
    const next: FieldErrors = {}
    if (index === 0) {
      if (form.businessName.trim().length < 2) next.businessName = 'Enter your registered or trading name.'
      if (form.businessName.trim().length > 160) next.businessName = 'Business name must be 160 characters or fewer.'
      if (form.ownerName.trim().length < 2) next.ownerName = 'Enter the account owner’s full name.'
      if (form.ownerName.trim().length > 120) next.ownerName = 'Owner name must be 120 characters or fewer.'
    }
    if (index === 1) {
      if (form.locationName.trim().length < 2) next.locationName = 'Give the first store a clear name.'
      if (form.locationName.trim().length > 120) next.locationName = 'Store name must be 120 characters or fewer.'
      if (form.address.trim().length < 5) next.address = 'Enter the store’s physical address.'
      if (form.address.trim().length > 300) next.address = 'Address must be 300 characters or fewer.'
      const phoneDigits = form.phone.replace(/\D/g, '')
      if (phoneDigits.length < 9 || phoneDigits.length > 15) next.phone = 'Enter a valid business phone number.'
    }
    if (index === 2 && !plans.some((plan) => plan.code === form.tier)) {
      next.tier = 'Choose an available subscription plan.'
    }
    if (index === 3) {
      const email = form.email.trim().toLocaleLowerCase()
      if (!emailPattern.test(email) || email.length > 254) next.email = 'Enter a valid owner email address.'
      if (!/^\d{4}$/.test(form.pin)) next.pin = 'Create a 4-digit security PIN.'
      if (form.confirmPin !== form.pin) next.confirmPin = 'The PINs do not match.'
    }
    setErrors(next)
    return Object.keys(next).length === 0
  }

  const advance = () => {
    if (validateStep(step)) setStep((current) => Math.min(flowSteps.length - 1, current + 1))
  }

  const submit = async () => {
    if (!validateStep(3) || !selectedPlan) return
    setLoading(true)
    setRequestError('')
    try {
      const response = await fetch('/api/register/tenant', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          request_id: requestId.current,
          business_name: form.businessName.trim(),
          owner_name: form.ownerName.trim(),
          location_name: form.locationName.trim(),
          address: form.address.trim(),
          phone: form.phone.trim(),
          email: form.email.trim().toLocaleLowerCase(),
          tier: selectedPlan.code,
          pin: form.pin,
          confirm_pin: form.confirmPin,
        }),
      })
      const result = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(result.error || 'We could not create your workspace. Please try again.')
      setComplete(true)
    } catch (error) {
      setRequestError(error instanceof Error ? error.message : 'We could not create your workspace. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  const onSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (step < flowSteps.length - 1) advance()
    else void submit()
  }

  const descriptions = [
    'Start with the identity that will appear across reports, receipts, and the owner dashboard.',
    'Every workspace begins with one store. Branches added later stay inside this tenant and plan.',
    'Choose the operating capacity you need. Limits are enforced consistently for stores and active users.',
    'Create the owner login, verify the workspace boundary, and start the trial.',
  ]

  if (complete) {
    return (
      <main className={styles.page}>
        <header className={styles.topbar}><Brand /></header>
        <div className={styles.workspace}>
          <div className={styles.workspaceInner}>
            <section className={`${styles.panel} ${styles.completion}`} aria-live="polite">
              <div className={styles.completionIcon}><Check size={30} /></div>
              <h2>Workspace created securely</h2>
              <p>{form.businessName} now has an isolated tenant, its first store, and an owner account on the {selectedPlan?.name} plan.</p>
              <div className={styles.completionSteps}>
                <span className={styles.completionStep}>Tenant isolated</span>
                <span className={styles.completionStep}>Store assigned</span>
                <span className={styles.completionStep}>Owner authenticated</span>
              </div>
              <p className={styles.help}>Opening guided setup…</p>
            </section>
          </div>
        </div>
      </main>
    )
  }

  return (
    <main className={styles.page}>
      <header className={styles.topbar}>
        <Brand />
        <div className={styles.topbarMeta}>
          <span>Already operating with Retail OS?</span>
          <Link className={styles.topbarLink} href="/login">Sign in</Link>
        </div>
      </header>

      <div className={styles.layout}>
        <aside className={styles.rail} aria-label="Registration progress">
          <div>
            <p className={styles.railEyebrow}>Workspace launch</p>
            <h2 className={styles.railTitle}>A clean operating boundary for every business.</h2>
            <p className={styles.railCopy}>Your stores, people, records, and subscription capacity are provisioned together.</p>
          </div>
          <nav className={styles.stepList} aria-label="Registration steps">
            {flowSteps.map((item, index) => {
              const isActive = index === step
              const isDone = index < step
              return (
                <button
                  key={item.title}
                  type="button"
                  className={`${styles.stepButton} ${isActive ? styles.stepButtonActive : ''} ${isDone ? styles.stepButtonDone : ''}`}
                  onClick={() => isDone && setStep(index)}
                  disabled={!isDone && !isActive}
                  aria-current={isActive ? 'step' : undefined}
                >
                  <span className={styles.stepNumber}>{isDone ? <Check size={16} /> : index + 1}</span>
                  <span><span className={styles.stepTitle}>{item.title}</span><span className={styles.stepHint}>{item.hint}</span></span>
                </button>
              )
            })}
          </nav>
          <div className={styles.railCard}>
            <div className={styles.railCardTitle}><ShieldCheck size={16} /> Provisioned as one unit</div>
            <p>If setup fails, incomplete tenant data is rolled back instead of leaving mixed records behind.</p>
          </div>
        </aside>

        <section className={styles.workspace}>
          <div className={styles.workspaceInner}>
            <div className={styles.mobileProgress} aria-hidden="true">
              <div className={styles.progressTrack}>
                <div className={styles.progressValue} style={{ width: `${((step + 1) / flowSteps.length) * 100}%` }} />
              </div>
            </div>
            <header className={styles.sectionHeader}>
              <p className={styles.eyebrow}>Step {step + 1} of {flowSteps.length}</p>
              <h1 ref={headingRef} tabIndex={-1} className={styles.heading}>{flowSteps[step].title}</h1>
              <p className={styles.description}>{descriptions[step]}</p>
            </header>

            <div className={styles.contentGrid}>
              <form className={styles.panel} onSubmit={onSubmit} noValidate>
                {requestError && <div className={styles.alert} role="alert"><CircleAlert size={18} /><span>{requestError}</span></div>}
                <div key={step} className={styles.stepCanvas}>
                  {step === 0 && (
                    <div className={styles.fields}>
                      <Field id="business_name" label="Business or trading name" value={form.businessName} onChange={(value) => update('businessName', value)} placeholder="Mwape General Trading" autoComplete="organization" error={errors.businessName} autoFocus />
                      <Field id="owner_name" label="Account owner" value={form.ownerName} onChange={(value) => update('ownerName', value)} placeholder="Mwila Chanda" autoComplete="name" error={errors.ownerName} help="This person receives owner-level access to the workspace." />
                    </div>
                  )}

                  {step === 1 && (
                    <div className={styles.fields}>
                      <div className={styles.fieldGrid}>
                        <Field id="location_name" label="Store name" value={form.locationName} onChange={(value) => update('locationName', value)} placeholder="Main Store" error={errors.locationName} autoFocus />
                        <Field id="phone" label="Business phone" type="tel" value={form.phone} onChange={(value) => update('phone', value)} placeholder="0977 123 456" autoComplete="tel" error={errors.phone} />
                      </div>
                      <Field id="address" label="Physical address" value={form.address} onChange={(value) => update('address', value)} placeholder="Plot 42, Cairo Road, Lusaka" autoComplete="street-address" error={errors.address} help="Used to identify this store on reports, receipts, and staff assignments." />
                    </div>
                  )}

                  {step === 2 && (
                    <fieldset className={styles.planList}>
                      <legend className={styles.label}>Subscription plan</legend>
                      {plans.length === 0 ? (
                        <div className={styles.alert} role="alert"><CircleAlert size={18} /><span>Plans are temporarily unavailable. Refresh the page before continuing.</span></div>
                      ) : plans.map((plan, index) => {
                        const selected = plan.code === form.tier
                        return (
                          <label key={plan.code} className={`${styles.planCard} ${selected ? styles.planCardSelected : ''}`}>
                            <input className={styles.planRadio} type="radio" name="tier" value={plan.code} checked={selected} onChange={() => update('tier', plan.code)} />
                            <span>
                              <span className={styles.planNameRow}>
                                <span className={styles.planName}>{plan.name}</span>
                                {index === 1 && <span className={styles.recommended}>Most popular</span>}
                              </span>
                              <span className={styles.planDescription}>{plan.description}</span>
                              <span className={styles.planCapacity}>
                                <span><Store size={14} /> {plan.maxLocations} {plan.maxLocations === 1 ? 'store' : 'stores'}</span>
                                <span><Users size={14} /> {plan.maxUsers} active users</span>
                              </span>
                            </span>
                            <span className={styles.planPrice}>
                              <span className={styles.planAmount}>{formatPrice(plan.priceZmw)}</span>
                              <span className={styles.planPeriod}>every {plan.billingIntervalDays} days after trial</span>
                            </span>
                          </label>
                        )
                      })}
                      {errors.tier && <p className={styles.fieldError}>{errors.tier}</p>}
                    </fieldset>
                  )}

                  {step === 3 && (
                    <div className={styles.fields}>
                      <div className={styles.reviewList} aria-label="Workspace review">
                        <ReviewItem label="Tenant" value={form.businessName} />
                        <ReviewItem label="First store" value={form.locationName} />
                        <ReviewItem label="Plan" value={selectedPlan?.name || 'Not selected'} />
                        <ReviewItem label="Trial" value={`${trialDays} days · no card now`} />
                      </div>
                      <Field id="email" label="Owner email" type="email" value={form.email} onChange={(value) => update('email', value)} placeholder="mwila@mwapetrading.co.zm" autoComplete="email" error={errors.email} help="This becomes the unique login identity for the owner." autoFocus />
                      <div className={styles.fieldGrid}>
                        <Field id="pin" label="4-digit security PIN" type="password" value={form.pin} onChange={(value) => update('pin', value.replace(/\D/g, '').slice(0, 4))} placeholder="••••" autoComplete="new-password" inputMode="numeric" maxLength={4} error={errors.pin} />
                        <Field id="confirm_pin" label="Confirm PIN" type="password" value={form.confirmPin} onChange={(value) => update('confirmPin', value.replace(/\D/g, '').slice(0, 4))} placeholder="••••" autoComplete="new-password" inputMode="numeric" maxLength={4} error={errors.confirmPin} />
                      </div>
                      <div className={styles.secureNote}><LockKeyhole size={18} /><span>Your PIN is transformed into separate cryptographic credentials and is never stored in plain text.</span></div>
                    </div>
                  )}
                </div>

                <div className={styles.actions}>
                  {step > 0 ? (
                    <button className={styles.buttonSecondary} type="button" onClick={() => { setRequestError(''); setStep((current) => Math.max(0, current - 1)) }} disabled={loading}><ArrowLeft size={17} /> Back</button>
                  ) : <span />}
                  <button className={styles.buttonPrimary} type="submit" disabled={loading || (step === 2 && plans.length === 0)}>
                    {loading ? <Loader2 className={styles.spinner} size={17} /> : null}
                    {loading ? 'Provisioning workspace…' : step === flowSteps.length - 1 ? `Start ${trialDays}-day trial` : 'Continue'}
                    {!loading && step < flowSteps.length - 1 ? <ArrowRight size={17} /> : null}
                  </button>
                </div>
              </form>
              <WorkspaceSummary form={form} selectedPlan={selectedPlan} />
            </div>
          </div>
        </section>
      </div>
    </main>
  )
}

function Brand() {
  return <Link className={styles.brand} href="/login" aria-label="Retail OS home"><span className={styles.brandMark}><Store size={18} /></span><span className={styles.brandName}>Retail OS</span></Link>
}

function WorkspaceSummary({ form, selectedPlan }: { form: RegistrationForm; selectedPlan: PublicSubscriptionPlan | null }) {
  const values = [
    { label: 'Workspace', value: form.businessName || 'Your business', icon: Building2 },
    { label: 'First store', value: form.locationName || 'Main Store', icon: MapPin },
    { label: 'Owner', value: form.ownerName || 'Account owner', icon: Users },
    { label: 'Capacity', value: selectedPlan ? `${selectedPlan.maxLocations} ${selectedPlan.maxLocations === 1 ? 'store' : 'stores'} · ${selectedPlan.maxUsers} users` : 'Choose a plan', icon: Store },
  ]
  return (
    <aside className={styles.summaryPanel} aria-label="Workspace outline">
      <p className={styles.summaryLabel}>Workspace outline</p>
      {values.map(({ label, value, icon: Icon }) => (
        <div className={styles.summaryRow} key={label}>
          <span className={styles.summaryIcon}><Icon size={15} /></span>
          <span><span className={styles.summaryKey}>{label}</span><span className={styles.summaryValue}>{value}</span></span>
        </div>
      ))}
      <div className={styles.summaryNotice}>Store and user limits are checked by the database for every addition, including simultaneous requests.</div>
    </aside>
  )
}

function ReviewItem({ label, value }: { label: string; value: string }) {
  return <div className={styles.reviewItem}><span className={styles.reviewKey}>{label}</span><span className={styles.reviewValue}>{value}</span></div>
}

type FieldProps = {
  id: string
  label: string
  value: string
  onChange: (value: string) => void
  error?: string
  help?: string
  placeholder?: string
  type?: string
  autoComplete?: string
  inputMode?: React.HTMLAttributes<HTMLInputElement>['inputMode']
  maxLength?: number
  autoFocus?: boolean
}

function Field({ id, label, value, onChange, error, help, placeholder, type = 'text', autoComplete, inputMode, maxLength, autoFocus }: FieldProps) {
  const describedBy = error ? `${id}-error` : help ? `${id}-help` : undefined
  return (
    <div className={styles.field}>
      <label className={styles.label} htmlFor={id}>{label}</label>
      <input className={`${styles.input} ${error ? styles.inputError : ''}`} id={id} name={id} type={type} value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} autoComplete={autoComplete} inputMode={inputMode} maxLength={maxLength} autoFocus={autoFocus} aria-invalid={Boolean(error)} aria-describedby={describedBy} />
      {error ? <p id={`${id}-error`} className={styles.fieldError}>{error}</p> : null}
      {!error && help ? <p id={`${id}-help`} className={styles.help}>{help}</p> : null}
    </div>
  )
}
