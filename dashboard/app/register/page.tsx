import RegistrationFlow from '@/components/onboarding/RegistrationFlow'
import { getPublicRegistrationPlans, REGISTRATION_TRIAL_DAYS } from '@/lib/registration'

export const dynamic = 'force-dynamic'

export const metadata = {
  title: 'Create your workspace | Retail OS',
  description: 'Create a secure Retail OS workspace for your stores and team.',
}

export default async function PublicRegistration() {
  const plans = await getPublicRegistrationPlans().catch((error) => {
    console.error('[Registration plans]', error)
    return []
  })

  return <RegistrationFlow plans={plans} trialDays={REGISTRATION_TRIAL_DAYS} />
}
