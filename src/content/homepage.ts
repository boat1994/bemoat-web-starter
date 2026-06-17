export const homepageHero = {
  eyebrow: 'CMS-backed business websites',
  title: 'CMS-backed business websites for owner-led businesses.',
  lead:
    'Business content changes — products, services, inquiries, and announcements. Your team needs a practical website and CMS they can update without waiting on a developer for every edit.',
} as const

export const problemSymptoms = [
  'Product or service details change, but the website lags behind.',
  'Inquiry or quote-request context is scattered across chat and spreadsheets.',
  'Team members cannot safely update core business content themselves.',
  'Every content change turns into a developer or agency ticket.',
  'The business has outgrown a static site but does not need a platform rebuild.',
] as const

export const processSteps = [
  {
    title: 'Diagnostic',
    description: 'Clarify what business information changes most often and what the team needs to edit.',
  },
  {
    title: 'Scope',
    description: 'Agree the smallest useful CMS-backed website scope and content model.',
  },
  {
    title: 'Build',
    description: 'Implement the website, CMS workflow, and initial content load.',
  },
  {
    title: 'Launch & handoff',
    description: 'Go live with inquiry-based pricing confirmed for the agreed scope, then review the first real editing workflow.',
  },
] as const

export const pricingNote =
  'Pricing is inquiry-based. We confirm scope, timeline, and investment after the diagnostic — no public package table on this first launch page.'
