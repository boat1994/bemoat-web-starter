export type ServiceLane = {
  id: string
  priority: 'primary' | 'secondary' | 'later'
  name: string
  summary: string
  deliverables: string[]
  inquiryQuestion?: string
}

export const services: ServiceLane[] = [
  {
    id: 'cms-backed-website',
    priority: 'primary',
    name: 'CMS-backed business website',
    summary:
      'A clear public website with a CMS your team can update as products, services, inquiries, and business information change.',
    deliverables: [
      'Website structure for agreed pages and content types',
      'CMS setup for information that changes regularly',
      'Editor workflow for core business content',
      'Frontend implementation for the agreed scope',
      'Launch and handoff notes for day-to-day updates',
    ],
    inquiryQuestion: 'Do you need a CMS-backed website your team can update as the business changes?',
  },
  {
    id: 'workflow-tools',
    priority: 'secondary',
    name: 'Lightweight workflow tools',
    summary:
      'When content, leads, follow-up, or operations get messy across spreadsheets and chat, we can scope one clear workflow slice after a diagnostic.',
    deliverables: [
      'Diagnostic to find the messiest operational slice',
      'Focused tool or CMS extension for one agreed workflow',
      'Handoff for how the team uses it day to day',
    ],
  },
  {
    id: 'prototype-rescue',
    priority: 'later',
    name: 'Prototype rescue / product direction',
    summary:
      'For teams with an unfinished prototype, fragile MVP, or unclear product scope — a quieter lane after the CMS foundation is in place.',
    deliverables: [
      'Scope review and direction recommendations',
      'Practical next-build plan aligned to business constraints',
    ],
  },
]

export const primaryService = services.find((service) => service.priority === 'primary')!
export const growthPathServices = services.filter((service) => service.priority !== 'primary')
