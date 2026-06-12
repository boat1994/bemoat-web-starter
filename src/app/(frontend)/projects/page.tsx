import Link from 'next/link'
import { getPayload } from 'payload'

import { pickText } from '@/lib/payloadText'
import config from '@/payload.config'

export const dynamic = 'force-dynamic'

type AnyDoc = Record<string, any>

export default async function ProjectsPage() {
  const payload = await getPayload({ config: await config })
  const projects = await payload.find({
    collection: 'projects' as any,
    depth: 1,
    limit: 24,
    sort: '-updatedAt',
  })

  return (
    <main>
      <section className="section">
        <p className="eyebrow">Projects</p>
        <h1>Project showcase</h1>
        <p className="lead">Reusable project listing from the starter CMS structure.</p>
      </section>

      <section className="grid">
        {projects.docs.map((project: AnyDoc) => (
          <Link className="card" href={`/projects/${project.slug}`} key={project.id}>
            <p className="tag">{project.projectType || 'project'}</p>
            <h3>{pickText(project.title, 'Untitled project')}</h3>
            <p>{pickText(project.description, 'Add a description in Payload.')}</p>
          </Link>
        ))}
      </section>
    </main>
  )
}
