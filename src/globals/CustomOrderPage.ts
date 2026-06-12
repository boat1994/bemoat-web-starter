import type { GlobalConfig } from 'payload'

export const CustomOrderPage: GlobalConfig = {
  slug: 'custom-order-page',
  label: 'Custom Order Page',
  access: {
    read: () => true,
  },
  fields: [
    {
      name: 'hero',
      type: 'group',
      label: 'Hero Section',
      fields: [
        {
          name: 'badge',
          type: 'text',
          label: 'Badge Text',
          admin: { description: 'Default: Custom Made Jewelry' },
        },
        {
          name: 'title',
          type: 'richText',
          label: 'Title',
          admin: { description: 'Supports rich text and line breaks.' },
        },
        {
          name: 'description',
          type: 'richText',
          label: 'Description',
        },
        {
          name: 'images',
          type: 'array',
          label: 'Carousel Images',
          fields: [
            {
              name: 'image',
              type: 'upload',
              relationTo: 'media',
              required: true,
            },
          ],
        },
      ],
    },
    {
      name: 'steps',
      type: 'array',
      label: 'Process Steps',
      admin: {
        description: 'Manage the custom order steps here. If left empty, system defaults will be used.',
      },
      fields: [
        {
          name: 'title',
          type: 'text',
          label: 'Title (TH)',
        },
        {
          name: 'engTitle',
          type: 'text',
          label: 'Title (EN/Sub)',
        },
        {
          name: 'image',
          type: 'upload',
          relationTo: 'media',
          label: 'Step Image',
        },
        {
          name: 'description',
          type: 'richText',
          label: 'Description',
        },
        {
          name: 'tag',
          type: 'text',
          label: 'Highlight Tag',
        },
        {
          name: 'note',
          type: 'text',
          label: 'Note text',
        },
      ],
    },
  ],
}
