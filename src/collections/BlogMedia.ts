import type { CollectionConfig } from 'payload'

export const BlogMedia: CollectionConfig = {
  slug: 'blog-media',
  access: {
    read: () => true,
  },
  fields: [
    {
      name: 'alt',
      type: 'text',
      required: false,
      localized: true,
    },
  ],
  upload: {
    crop: false,
    focalPoint: false,
  },
}
