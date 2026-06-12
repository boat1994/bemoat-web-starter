import Link from 'next/link'
import { notFound } from 'next/navigation'
import { getPayload } from 'payload'

import { pickText } from '@/lib/payloadText'
import config from '@/payload.config'

export const dynamic = 'force-dynamic'

export default async function ProjectDetailPage(props: { params: Promise<{ slug: string }> }) {
  const { slug } = await props.params
  const payload = await getPayload({ config: await config })
  const result = await payload.find({
    collection: 'projects',
    depth: 2,
    limit: 1,
    where: {
      slug: {
        equals: slug,
      },
    },
  })

  const project = result.docs[0]
  if (!project) notFound()

  return (
    <main>
      <Link className="button" href="/projects">
        Back to projects
      </Link>
      <section className="detail">
        <div>
          <p className="eyebrow">{project.projectType || 'Project'}</p>
          <h1>{pickText(project.title, 'Untitled project')}</h1>
          <p className="lead">
            {pickText(project.summary, pickText(project.description, 'Add a description in Payload.'))}
          </p>
        </div>
        <ul className="metaList">
          <li>
            <span>Status</span>
            <strong>{project.status || '-'}</strong>
          </li>
          <li>
            <span>Launch date</span>
            <strong>{project.launchDate || '-'}</strong>
          </li>
          <li>
            <span>Project link</span>
            <strong>{project.link || '-'}</strong>
          </li>
        </ul>
      </section>
    </main>
  )
}
