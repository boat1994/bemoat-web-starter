import type { CollectionConfig } from 'payload'

const createSlug = (value: unknown) => {
  const source = typeof value === 'string' ? value : ''
  return source
    .toLowerCase()
    .trim()
    .replace(/\s+/g, '-')
    .replace(/[^\w-]+/g, '')
}

export const Projects: CollectionConfig = {
  slug: 'projects',
  admin: {
    useAsTitle: 'title',
    defaultColumns: ['title', 'projectType', 'category', 'updatedAt'],
    preview: (doc) => {
      const serverURL = process.env.NEXT_PUBLIC_SERVER_URL || 'http://localhost:3000'
      return `${serverURL}/projects/${doc.slug}`
    },
  },
  access: {
    read: () => true,
  },
  fields: [
    {
      name: 'viewProject',
      type: 'ui',
      admin: {
        position: 'sidebar',
        components: {
          Field: '/components/ViewProjectButton#ViewProjectButton',
        },
      },
    },
    {
      name: 'projectType',
      type: 'select',
      label: { en: 'Project Type', th: 'ประเภทโปรเจกต์' },
      defaultValue: 'website',
      options: [
        { label: 'Website', value: 'website' },
        { label: 'Application', value: 'application' },
        { label: 'E-commerce', value: 'ecommerce' },
        { label: 'Marketing Site', value: 'marketing-site' },
        { label: 'Operations Tool', value: 'operations-tool' },
        { label: 'Other', value: 'other' },
      ],
      admin: {
        position: 'sidebar',
      },
      required: true,
    },
    {
      name: 'isFeaturedOnHome',
      type: 'checkbox',
      label: { en: 'Featured on Homepage', th: 'แสดงบนหน้าแรก' },
      defaultValue: false,
      admin: {
        position: 'sidebar',
      },
    },
    {
      type: 'tabs',
      tabs: [
        {
          label: { en: 'General Details', th: 'ข้อมูลทั่วไป' },
          fields: [
            {
              name: 'title',
              type: 'text',
              required: true,
              localized: true,
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
                  ({ data }) => {
                    if (data?.title && !data.slug) return createSlug(data.title)
                    return data?.slug
                  },
                ],
              },
            },
            {
              name: 'description',
              type: 'textarea',
              localized: true,
            },
            {
              type: 'row',
              fields: [
                {
                  name: 'category',
                  type: 'relationship',
                  relationTo: 'categories',
                  required: true,
                },
                {
                  name: 'tags',
                  type: 'relationship',
                  relationTo: 'tags',
                  hasMany: true,
                },
              ],
            },
            {
              name: 'coverImage',
              type: 'upload',
              relationTo: 'media',
            },
            {
              name: 'images',
              type: 'upload',
              relationTo: 'media',
              hasMany: true,
            },
          ],
        },
        {
          label: { en: 'Project Details', th: 'รายละเอียดโปรเจกต์' },
          fields: [
            {
              name: 'summary',
              type: 'textarea',
              label: { en: 'Short Summary', th: 'สรุปสั้น' },
              localized: true,
            },
            {
              type: 'row',
              fields: [
                {
                  name: 'status',
                  type: 'select',
                  label: { en: 'Status', th: 'สถานะ' },
                  options: [
                    { label: 'Concept', value: 'concept' },
                    { label: 'In Progress', value: 'in-progress' },
                    { label: 'Launched', value: 'launched' },
                    { label: 'Archived', value: 'archived' },
                  ],
                },
                {
                  name: 'launchDate',
                  type: 'date',
                  label: { en: 'Launch Date', th: 'วันที่เปิดตัว' },
                },
              ],
            },
            {
              name: 'link',
              type: 'text',
              label: { en: 'Project Link', th: 'ลิงก์โปรเจกต์' },
              admin: {
                placeholder: 'https://example.com',
              },
            },
            {
              name: 'technologies',
              type: 'array',
              label: { en: 'Technologies', th: 'เทคโนโลยี' },
              fields: [
                {
                  name: 'name',
                  type: 'text',
                  label: { en: 'Name', th: 'ชื่อ' },
                  required: true,
                },
              ],
            },
            {
              name: 'highlights',
              type: 'array',
              label: { en: 'Highlights', th: 'จุดเด่น' },
              fields: [
                {
                  name: 'label',
                  type: 'text',
                  label: { en: 'Label', th: 'หัวข้อ' },
                  required: true,
                },
                {
                  name: 'description',
                  type: 'textarea',
                  label: { en: 'Description', th: 'รายละเอียด' },
                  localized: true,
                },
              ],
            },
          ],
        },
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
  ],
  timestamps: true,
}
