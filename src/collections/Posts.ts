import type {
  CollectionConfig,
  RelationshipFieldValidation,
  TextareaFieldValidation,
  TextFieldValidation,
  UploadFieldValidation,
} from 'payload'

import type { Post } from '../payload-types'

type PostValidateData = Partial<Pick<Post, '_status'>>

const pickLocalizedText = (value: unknown) => {
  if (typeof value === 'string') return value
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>
    return String(record.th || record.en || Object.values(record)[0] || '')
  }
  return ''
}

const createSlug = (value: unknown) =>
  pickLocalizedText(value)
    .toLowerCase()
    .trim()
    .replace(/\s+/g, '-')
    .replace(/[^\w-]+/g, '')

export const Posts: CollectionConfig = {
  slug: 'posts',
  admin: {
    useAsTitle: 'title',
    defaultColumns: ['title', 'blogCategory', '_status', 'publishedAt'],
    preview: (doc) => {
      const serverURL = process.env.NEXT_PUBLIC_SERVER_URL || 'http://localhost:3000'
      return `${serverURL}/blog/${doc.slug}`
    },
  },
  versions: {
    drafts: {
      autosave: true,
    },
  },
  access: {
    read: ({ req: { user } }) => {
      if (user) return true

      return {
        _status: {
          equals: 'published',
        },
      }
    },
  },
  hooks: {
    beforeChange: [
      ({ data, originalDoc }) => {
        if (data._status === 'published' && (!originalDoc || originalDoc._status !== 'published')) {
          return {
            ...data,
            publishedAt: new Date().toISOString(),
          }
        }

        return data
      },
    ],
  },
  fields: [
    {
      name: 'title',
      type: 'text',
      localized: true,
      validate: ((value: unknown, { data }: { data?: PostValidateData }) => {
        if (data?._status === 'published' && !value) return 'Title is required for publication'
        return true
      }) satisfies TextFieldValidation,
    },
    {
      name: 'slug',
      type: 'text',
      unique: true,
      index: true,
      admin: {
        position: 'sidebar',
      },
      hooks: {
        beforeValidate: [
          async ({ data, operation, req }) => {
            if (operation === 'create' || (data?.title && !data.slug)) {
              const base = createSlug(data?.title)
              let slug = base || `draft-${Date.now().toString(36)}`

              if (req.payload) {
                const { totalDocs } = await req.payload.find({
                  collection: 'posts',
                  where: { slug: { equals: slug } },
                  limit: 1,
                  depth: 0,
                })

                if (totalDocs > 0) slug = `${slug}-${Math.random().toString(36).substring(2, 6)}`
              }

              return slug
            }

            return data?.slug
          },
        ],
      },
    },
    {
      name: 'publishedAt',
      type: 'date',
      admin: {
        position: 'sidebar',
        readOnly: true,
      },
    },
    {
      name: 'blogCategory',
      type: 'relationship',
      relationTo: 'blog-categories',
      admin: {
        position: 'sidebar',
      },
      validate: ((value: unknown, { data }: { data?: PostValidateData }) => {
        if (data?._status === 'published' && !value) return 'Category is required for publication'
        return true
      }) satisfies RelationshipFieldValidation,
    },
    {
      name: 'tags',
      type: 'relationship',
      relationTo: 'tags',
      hasMany: true,
      admin: {
        position: 'sidebar',
      },
    },
    {
      name: 'coverImage',
      type: 'upload',
      relationTo: 'media',
      validate: ((value: unknown, { data }: { data?: PostValidateData }) => {
        if (data?._status === 'published' && !value) return 'Cover image is required for publication'
        return true
      }) satisfies UploadFieldValidation,
    },
    {
      name: 'excerpt',
      type: 'textarea',
      localized: true,
      validate: ((value: unknown, { data }: { data?: PostValidateData }) => {
        if (data?._status === 'published' && !value) return 'Excerpt is required for publication'
        return true
      }) satisfies TextareaFieldValidation,
    },
    {
      name: 'content',
      type: 'blocks',
      localized: true,
      blocks: [
        {
          slug: 'textSection',
          fields: [
            {
              name: 'heading',
              type: 'text',
            },
            {
              name: 'body',
              type: 'textarea',
            },
            {
              name: 'aiGenerate',
              type: 'ui',
              admin: {
                components: {
                  Field: '/components/BlogBlockAiGenerate#BlogBlockAiGenerate',
                },
              },
            },
          ],
        },
        {
          slug: 'imageBlock',
          fields: [
            {
              name: 'image',
              type: 'upload',
              relationTo: 'blog-media',
              required: true,
            },
            {
              name: 'caption',
              type: 'text',
              localized: true,
            },
          ],
        },
        {
          slug: 'quoteBlock',
          fields: [
            {
              name: 'quote',
              type: 'textarea',
              required: true,
              localized: true,
            },
            {
              name: 'attribution',
              type: 'text',
            },
          ],
        },
        {
          slug: 'calloutBlock',
          fields: [
            {
              name: 'type',
              type: 'select',
              options: [
                { label: 'Tip', value: 'tip' },
                { label: 'Fact', value: 'fact' },
                { label: 'Warning', value: 'warning' },
              ],
              defaultValue: 'tip',
            },
            {
              name: 'title',
              type: 'text',
              localized: true,
            },
            {
              name: 'body',
              type: 'textarea',
              required: true,
              localized: true,
            },
          ],
        },
      ],
    },
    {
      name: 'relatedProjects',
      type: 'relationship',
      relationTo: 'projects',
      hasMany: true,
    },
    {
      type: 'tabs',
      tabs: [
        {
          label: 'SEO',
          fields: [
            {
              name: 'seo',
              type: 'group',
              fields: [
                {
                  name: 'title',
                  type: 'text',
                  localized: true,
                },
                {
                  name: 'description',
                  type: 'textarea',
                  localized: true,
                },
                {
                  name: 'keywords',
                  type: 'text',
                  localized: true,
                },
              ],
            },
          ],
        },
      ],
    },
    {
      name: 'aiState',
      type: 'json',
      admin: {
        hidden: true,
      },
    },
    {
      name: 'aiWorkflow',
      type: 'ui',
      admin: {
        components: {
          Field: '/components/BlogAiWorkflow#BlogAiWorkflow',
        },
        position: 'sidebar',
      },
    },
  ],
  timestamps: true,
}
