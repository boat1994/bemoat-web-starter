import { getPayload } from 'payload'

import { pickRichTextPlain, pickText } from '@/lib/payloadText'
import config from '@/payload.config'

export const dynamic = 'force-dynamic'

type AnyDoc = Record<string, any>

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
  const page = (await payload.findGlobal({ slug: 'custom-order-page' as any, depth: 1 })) as AnyDoc
  const steps = Array.isArray(page.steps) && page.steps.length > 0 ? page.steps : defaultSteps

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
        {steps.map((step: AnyDoc, index: number) => (
          <article className="card" key={step.id || index}>
            <p className="tag">Step {index + 1}</p>
            <h3>{pickText(step.title, 'Process step')}</h3>
            <p>{pickText(step.engTitle, '')}</p>
            <p>{pickRichTextPlain(step.description, pickText(step.note, ''))}</p>
          </article>
        ))}
      </section>
    </main>
  )
}
