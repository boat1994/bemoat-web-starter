import Link from 'next/link'
import { getPayload } from 'payload'

import { pickText } from '@/lib/payloadText'
import type { Post, Project } from '@/payload-types'
import config from '@/payload.config'

export const dynamic = 'force-dynamic'

export default async function HomePage() {
  const payload = await getPayload({ config: await config })

  const [projects, posts] = await Promise.all([
    payload.find({
      collection: 'projects',
      depth: 1,
      limit: 6,
      sort: '-updatedAt',
      where: {
        isFeaturedOnHome: {
          equals: true,
        },
      },
    }),
    payload.find({
      collection: 'posts',
      depth: 1,
      limit: 3,
      sort: '-publishedAt',
    }),
  ])

  return (
    <main>
      <section className="hero">
        <p className="eyebrow">Payload Cloudflare boilerplate</p>
        <h1>Project CMS, portfolio, blog, and custom request starter.</h1>
        <p className="lead">
          This starter keeps the reusable CMS and frontend structure ready for new Bemoat projects.
        </p>
        <div className="actions">
          <Link className="button primary" href="/admin">
            Open admin
          </Link>
          <Link className="button" href="/projects">
            View projects
          </Link>
        </div>
      </section>

      <section className="section">
        <div className="sectionHeader">
          <p className="eyebrow">Showcase</p>
          <h2>Featured projects</h2>
        </div>
        <div className="grid">
          {projects.docs.map((project: Project) => (
            <Link className="card" href={`/projects/${project.slug}`} key={project.id}>
              <p className="tag">{project.projectType || 'project'}</p>
              <h3>{pickText(project.title, 'Untitled project')}</h3>
              <p>{pickText(project.description, 'Add a short project description in Payload.')}</p>
            </Link>
          ))}
          {projects.docs.length === 0 ? <p className="muted">No featured projects yet.</p> : null}
        </div>
      </section>

      <section className="section split">
        <div>
          <p className="eyebrow">Content engine</p>
          <h2>Blog module</h2>
          <p className="muted">Draft, publish, and connect posts to reusable project records.</p>
        </div>
        <div className="stack">
          {posts.docs.map((post: Post) => (
            <Link className="rowCard" href={`/blog/${post.slug}`} key={post.id}>
              <span>{pickText(post.title, 'Untitled post')}</span>
              <small>{pickText(post.excerpt, 'No excerpt yet')}</small>
            </Link>
          ))}
          <Link className="button" href="/blog">
            View blog
          </Link>
        </div>
      </section>
    </main>
  )
}
