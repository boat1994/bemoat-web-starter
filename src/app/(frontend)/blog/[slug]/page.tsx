import Link from 'next/link'
import { notFound } from 'next/navigation'
import { getPayload } from 'payload'

import { pickText } from '@/lib/payloadText'
import type { Post } from '@/payload-types'
import config from '@/payload.config'

export const dynamic = 'force-dynamic'

type PostContentBlock = NonNullable<Post['content']>[number]

export default async function BlogDetailPage(props: { params: Promise<{ slug: string }> }) {
  const { slug } = await props.params
  const payload = await getPayload({ config: await config })
  const result = await payload.find({
    collection: 'posts',
    depth: 2,
    limit: 1,
    where: {
      slug: {
        equals: slug,
      },
    },
  })

  const post = result.docs[0]
  if (!post) notFound()

  return (
    <main>
      <Link className="button" href="/blog">
        Back to blog
      </Link>
      <section className="section">
        <p className="eyebrow">Blog</p>
        <h1>{pickText(post.title, 'Untitled post')}</h1>
        <p className="lead">{pickText(post.excerpt, 'Add an excerpt in Payload.')}</p>
      </section>
      <section className="stack">
        {(post.content || []).map((block: PostContentBlock, index: number) => {
          if (block.blockType === 'textSection') {
            return (
              <article className="rowCard" key={block.id || index}>
                <h2>{pickText(block.heading, 'Text section')}</h2>
                <p>{pickText(block.body, '')}</p>
              </article>
            )
          }

          if (block.blockType === 'quoteBlock') {
            return (
              <article className="rowCard" key={block.id || index}>
                <h2>{pickText(block.quote, '')}</h2>
                <p>{pickText(block.attribution, '')}</p>
              </article>
            )
          }

          if (block.blockType === 'calloutBlock') {
            return (
              <article className="rowCard" key={block.id || index}>
                <p className="tag">{block.type || 'tip'}</p>
                <h2>{pickText(block.title, 'Callout')}</h2>
                <p>{pickText(block.body, '')}</p>
              </article>
            )
          }

          return null
        })}
      </section>
    </main>
  )
}
