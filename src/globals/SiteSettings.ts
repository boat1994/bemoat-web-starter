import type { GlobalConfig } from 'payload'

export const SiteSettings: GlobalConfig = {
  slug: 'site-settings',
  access: {
    read: () => true,
  },
  fields: [
    {
      name: 'mainPage',
      type: 'group',
      label: 'Main Page Settings',
      fields: [
        {
          name: 'heroSection',
          type: 'group',
          label: 'Hero Section',
          fields: [
            {
              name: 'desktopVideo',
              type: 'upload',
              relationTo: 'media',
              label: 'Desktop Video (mp4)',
            },
            {
              name: 'mobileVideo',
              type: 'upload',
              relationTo: 'media',
              label: 'Mobile Video (mp4)',
            },
            {
              name: 'desktopPoster',
              type: 'upload',
              relationTo: 'media',
              label: 'Desktop Poster Image',
            },
            {
              name: 'mobilePoster',
              type: 'upload',
              relationTo: 'media',
              label: 'Mobile Poster Image',
            },
          ],
        },
      ],
    },
    {
      name: 'seo',
      type: 'group',
      label: 'SEO Settings',
      fields: [
        {
          name: 'title',
          type: 'text',
          label: 'Meta Title',
          required: true,
          localized: true,
        },
        {
          name: 'description',
          type: 'textarea',
          label: 'Meta Description',
          required: true,
          localized: true,
        },
        {
          name: 'ogImage',
          type: 'upload',
          relationTo: 'media',
          label: 'OpenGraph Image',
        },
      ],
    },
  ],
}
