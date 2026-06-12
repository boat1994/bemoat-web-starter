import { getPayload } from 'payload'

import { pickRichTextPlain, pickText } from '@/lib/payloadText'
import type { CustomOrderPage } from '@/payload-types'
import config from '@/payload.config'

export const dynamic = 'force-dynamic'

type CustomOrderStep = NonNullable<CustomOrderPage['steps']>[number]

const defaultSteps = [
  {
    title: 'คุยโจทย์และงบประมาณ',
    engTitle: 'Brief and budget',
    note: 'Start with goals, constraints, timeline, and target budget.',
  },
  {
    title: 'จัดขอบเขตงาน',
    engTitle: 'Scope planning',
    note: 'Shape the request into a reusable CMS-managed workflow.',
  },
  {
    title: 'ออกแบบและผลิต',
    engTitle: 'Design and production',
    note: 'Use this page as a repeatable custom order flow.',
  },
]

export default async function CustomOrderPage() {
  const payload = await getPayload({ config: await config })
  const page = await payload.findGlobal({ slug: 'custom-order-page', depth: 1 })
  const steps: Array<CustomOrderStep | (typeof defaultSteps)[number]> =
    Array.isArray(page.steps) && page.steps.length > 0 ? page.steps : defaultSteps

  return (
    <main>
      <section className="section">
        <p className="eyebrow">{pickText(page.hero?.badge, 'Custom Request')}</p>
        <h1>{pickRichTextPlain(page.hero?.title, 'How to custom order')}</h1>
        <p className="lead">
          {pickRichTextPlain(
            page.hero?.description,
            'A reusable CMS page for project-specific request workflows.',
          )}
        </p>
      </section>

      <section className="grid">
        {steps.map((step, index: number) => (
          <article className="card" key={'id' in step ? step.id || index : index}>
            <p className="tag">Step {index + 1}</p>
            <h3>{pickText(step.title, 'Process step')}</h3>
            <p>{pickText(step.engTitle, '')}</p>
            <p>{pickRichTextPlain('description' in step ? step.description : undefined, pickText(step.note, ''))}</p>
          </article>
        ))}
      </section>
    </main>
  )
}
