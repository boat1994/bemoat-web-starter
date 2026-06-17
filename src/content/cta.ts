/** Temporary v1 CTA targets — no contact route exists yet; mailto until inquiry flow ships. */
const INQUIRY_EMAIL = 'hello@bemoat.com'

export const homepageCtas = {
  diagnostic: {
    label: 'Tell me what changes most often in your business.',
    href: `mailto:${INQUIRY_EMAIL}?subject=${encodeURIComponent('Diagnostic inquiry — what changes most often')}`,
  },
  cmsWebsite: {
    label: 'I need a CMS-backed website my team can update.',
    href: `mailto:${INQUIRY_EMAIL}?subject=${encodeURIComponent('CMS-backed website inquiry')}`,
  },
} as const
