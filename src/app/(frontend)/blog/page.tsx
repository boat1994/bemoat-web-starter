import Link from 'next/link'
import { getPayload } from 'payload'

import { pickText } from '@/lib/payloadText'
import config from '@/payload.config'

export const dynamic = 'force-dynamic'

type AnyDoc = Record<string, any>

export default async function BlogPage() {
  const payload = await getPayload({ config: await config })
  const posts = await payload.find({
    collection: 'posts' as any,
    depth: 1,
    limit: 24,
    sort: '-publishedAt',
  })

  return (
    <main>
      <section className="section">
        <p className="eyebrow">Blog</p>
        <h1>Content engine</h1>
        <p className="lead">Blog structure from Bogus dev branch with blocks, SEO fields, and related projects.</p>
      </section>

      <section className="stack">
        {posts.docs.map((post: AnyDoc) => (
          <Link className="rowCard" href={`/blog/${post.slug}`} key={post.id}>
            <span>{pickText(post.title, 'Untitled post')}</span>
            <small>{pickText(post.excerpt, 'Add an excerpt in Payload.')}</small>
          </Link>
        ))}
      </section>
    </main>
  )
}
