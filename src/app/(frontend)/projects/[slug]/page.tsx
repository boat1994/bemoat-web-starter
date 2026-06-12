import Link from 'next/link'
import { notFound } from 'next/navigation'
import { getPayload } from 'payload'

import { pickText } from '@/lib/payloadText'
import config from '@/payload.config'

export const dynamic = 'force-dynamic'

type AnyDoc = Record<string, any>

export default async function ProjectDetailPage(props: { params: Promise<{ slug: string }> }) {
  const { slug } = await props.params
  const payload = await getPayload({ config: await config })
  const result = await payload.find({
    collection: 'projects' as any,
    depth: 2,
    limit: 1,
    where: {
      slug: {
        equals: slug,
      },
    },
  })

  const project = result.docs[0] as AnyDoc | undefined
  if (!project) notFound()

  return (
    <main>
      <Link className="button" href="/projects">
        Back to projects
      </Link>
      <section className="detail">
        <div>
          <p className="eyebrow">{project.jewelryType || 'Project'}</p>
          <h1>{pickText(project.title, 'Untitled project')}</h1>
          <p className="lead">{pickText(project.description, 'Add a description in Payload.')}</p>
        </div>
        <ul className="metaList">
          <li>
            <span>Material</span>
            <strong>{project.material || '-'}</strong>
          </li>
          <li>
            <span>Total carat</span>
            <strong>{project.totalCaratWeight || '-'}</strong>
          </li>
          <li>
            <span>Gender</span>
            <strong>{project.jewelrySex || '-'}</strong>
          </li>
          <li>
            <span>Center stone</span>
            <strong>{project.centerStone?.gemstone || '-'}</strong>
          </li>
        </ul>
      </section>
    </main>
  )
}
