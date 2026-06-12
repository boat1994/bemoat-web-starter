import type { CollectionConfig } from 'payload'

import { GEMSTONE_CONSTANTS } from '../constants/gemstones'

const gemstoneOptions = [
  { label: 'Diamond (CVD/Lab-Grown)', value: 'cvd-diamond' },
  { label: 'Diamond (Natural)', value: 'natural-diamond' },
  { label: 'Sapphire', value: 'sapphire' },
  { label: 'Ruby', value: 'ruby' },
  { label: 'Emerald', value: 'emerald' },
  { label: 'Aquamarine', value: 'aquamarine' },
  { label: 'Morganite', value: 'morganite' },
  { label: 'Amethyst', value: 'amethyst' },
  { label: 'Topaz', value: 'topaz' },
  { label: 'Garnet', value: 'garnet' },
  { label: 'Opal', value: 'opal' },
  { label: 'Pearl', value: 'pearl' },
  { label: 'Moissanite', value: 'moissanite' },
  { label: 'Spinel', value: 'spinel' },
  { label: 'Tourmaline', value: 'tourmaline' },
  { label: 'Zircon', value: 'zircon' },
  { label: 'Peridot', value: 'peridot' },
  { label: 'Jade', value: 'jade' },
  { label: 'Tsavorite', value: 'tsavorite' },
  { label: 'Tanzanite', value: 'tanzanite' },
]

const shapeOptions = [
  { label: 'Round', value: 'round' },
  { label: 'Oval', value: 'oval' },
  { label: 'Marquise', value: 'marquise' },
  { label: 'Pear', value: 'pear' },
  { label: 'Princess', value: 'princess' },
  { label: 'Emerald Cut', value: 'emerald-shape' },
  { label: 'Asscher', value: 'asscher' },
  { label: 'Cushion', value: 'cushion' },
  { label: 'Radiant', value: 'radiant' },
  { label: 'Heart', value: 'heart' },
  { label: 'Baguette', value: 'baguette' },
  { label: 'Triangle / Trillion', value: 'trillion' },
  { label: 'Cabochon', value: 'cabochon' },
]

const createSlug = (value: unknown) => {
  const source = typeof value === 'string' ? value : ''
  return source
    .toLowerCase()
    .trim()
    .replace(/\s+/g, '-')
    .replace(/[^\w-]+/g, '')
}

const fourCsGroupFields: CollectionConfig['fields'] = [
  {
    type: 'row',
    fields: [
      {
        name: 'colorDiamond',
        type: 'select',
        label: { en: 'Color Grade', th: 'เกรดสีเพชร (น้ำ)' },
        options: GEMSTONE_CONSTANTS.COLOR.DIAMOND.GRADES.map((grade) => ({ label: grade, value: grade })),
        admin: {
          condition: (_, siblingData) =>
            siblingData.gemstone === 'cvd-diamond' || siblingData.gemstone === 'natural-diamond',
        },
      },
      {
        name: 'clarityDiamond',
        type: 'select',
        label: { en: 'Clarity (Diamond)', th: 'ความสะอาด (Clarity)' },
        options: GEMSTONE_CONSTANTS.CLARITY.DIAMOND.map((clarity) => ({
          label: clarity,
          value: clarity,
        })),
        admin: {
          condition: (_, siblingData) =>
            siblingData.gemstone === 'cvd-diamond' || siblingData.gemstone === 'natural-diamond',
        },
      },
      {
        name: 'cutGrading',
        type: 'select',
        label: { en: 'Cut Grading', th: 'เกรดการเจียระไน (Cut)' },
        options: GEMSTONE_CONSTANTS.CUT.GRADING.map((cut) => ({ label: cut, value: cut })),
      },
    ],
  },
  {
    type: 'row',
    fields: [
      {
        name: 'colorColoredStoneHue',
        type: 'select',
        label: { en: 'Color Hue', th: 'เฉดสีพลอย' },
        options: GEMSTONE_CONSTANTS.COLOR.COLORED_STONE.HUES.map((hue) => ({
          label: hue,
          value: hue,
        })),
        admin: {
          condition: (_, siblingData) =>
            Boolean(siblingData.gemstone) &&
            siblingData.gemstone !== 'cvd-diamond' &&
            siblingData.gemstone !== 'natural-diamond',
        },
      },
      {
        name: 'colorColoredStoneTone',
        type: 'select',
        label: { en: 'Color Tone', th: 'ความสว่าง/มืด (Tone)' },
        options: GEMSTONE_CONSTANTS.COLOR.COLORED_STONE.TONE.map((tone) => ({
          label: tone,
          value: tone,
        })),
        admin: {
          condition: (_, siblingData) =>
            Boolean(siblingData.gemstone) &&
            siblingData.gemstone !== 'cvd-diamond' &&
            siblingData.gemstone !== 'natural-diamond',
        },
      },
      {
        name: 'colorColoredStoneSaturation',
        type: 'select',
        label: { en: 'Color Saturation', th: 'ความสดของสี (Saturation)' },
        options: GEMSTONE_CONSTANTS.COLOR.COLORED_STONE.SATURATION.map((saturation) => ({
          label: saturation,
          value: saturation,
        })),
        admin: {
          condition: (_, siblingData) =>
            Boolean(siblingData.gemstone) &&
            siblingData.gemstone !== 'cvd-diamond' &&
            siblingData.gemstone !== 'natural-diamond',
        },
      },
    ],
  },
  {
    type: 'row',
    fields: [
      {
        name: 'clarityColoredStone',
        type: 'select',
        label: { en: 'Clarity (Colored)', th: 'ความสะอาด (Clarity)' },
        options: [
          { label: GEMSTONE_CONSTANTS.CLARITY.COLORED_STONE.TYPE_1, value: 'type_1' },
          { label: GEMSTONE_CONSTANTS.CLARITY.COLORED_STONE.TYPE_2, value: 'type_2' },
          { label: GEMSTONE_CONSTANTS.CLARITY.COLORED_STONE.TYPE_3, value: 'type_3' },
        ],
        admin: {
          condition: (_, siblingData) =>
            Boolean(siblingData.gemstone) &&
            siblingData.gemstone !== 'cvd-diamond' &&
            siblingData.gemstone !== 'natural-diamond',
        },
      },
      {
        name: 'origin',
        type: 'select',
        label: { en: 'Origin', th: 'แหล่งกำเนิด (Origin)' },
        options: GEMSTONE_CONSTANTS.ORIGIN.SOURCES.map((source) => ({ label: source, value: source })),
        admin: {
          condition: (_, siblingData) =>
            Boolean(siblingData.gemstone) &&
            siblingData.gemstone !== 'cvd-diamond' &&
            siblingData.gemstone !== 'natural-diamond',
        },
      },
    ],
  },
]

export const Projects: CollectionConfig = {
  slug: 'projects',
  admin: {
    useAsTitle: 'title',
    defaultColumns: ['title', 'jewelryType', 'category', 'updatedAt'],
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
      name: 'jewelryType',
      type: 'select',
      label: { en: 'Jewelry Type', th: 'ประเภทเครื่องประดับ' },
      defaultValue: 'ring-center',
      options: [
        { label: 'Ring (with Center Stone)', value: 'ring-center' },
        { label: 'Band / Ring (No Center)', value: 'ring-band' },
        { label: 'Necklace / Pendant', value: 'necklace' },
        { label: 'Bracelet / Bangle', value: 'bracelet' },
        { label: 'Earrings', value: 'earrings' },
      ],
      admin: {
        position: 'sidebar',
      },
      required: true,
    },
    {
      name: 'jewelrySex',
      type: 'select',
      label: { en: 'Gender', th: 'เพศ' },
      defaultValue: 'unisex',
      options: [
        { label: 'Male', value: 'male' },
        { label: 'Female', value: 'female' },
        { label: 'Unisex', value: 'unisex' },
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
                  name: 'totalCaratWeight',
                  type: 'text',
                  label: { en: 'Total Carat Weight (tcw)', th: 'น้ำหนักกะรัตรวมสุทธิ (tcw)' },
                },
                {
                  name: 'material',
                  type: 'select',
                  label: { en: 'Material', th: 'วัสดุตัวเรือน' },
                  options: [
                    { label: '18K White Gold', value: '18k-white-gold' },
                    { label: '18K Yellow Gold', value: '18k-yellow-gold' },
                    { label: '18K Rose Gold', value: '18k-rose-gold' },
                    { label: '14K White Gold', value: '14k-white-gold' },
                    { label: '14K Yellow Gold', value: '14k-yellow-gold' },
                    { label: '14K Rose Gold', value: '14k-rose-gold' },
                    { label: '9K White Gold', value: '9k-white-gold' },
                    { label: '9K Yellow Gold', value: '9k-yellow-gold' },
                    { label: '9K Rose Gold', value: '9k-rose-gold' },
                    { label: 'Platinum', value: 'platinum' },
                    { label: 'Silver', value: 'silver' },
                  ],
                },
              ],
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
          label: { en: 'Stone Details', th: 'รายละเอียดเพชรและอัญมณี' },
          fields: [
            {
              name: 'centerStone',
              type: 'group',
              label: { en: 'Center Stone', th: 'เม็ดกลาง' },
              fields: [
                {
                  name: 'gemstone',
                  type: 'select',
                  label: { en: 'Gemstone', th: 'ชนิดอัญมณี' },
                  options: gemstoneOptions,
                },
                {
                  name: 'shape',
                  type: 'select',
                  label: { en: 'Shape', th: 'รูปทรง' },
                  options: shapeOptions,
                },
                {
                  name: 'carat',
                  type: 'number',
                  label: { en: 'Carat', th: 'น้ำหนักกะรัต' },
                },
                ...fourCsGroupFields,
              ],
            },
            {
              name: 'sideStones',
              type: 'array',
              label: { en: 'Side Stones', th: 'เม็ดข้าง' },
              fields: [
                {
                  name: 'gemstone',
                  type: 'select',
                  options: gemstoneOptions,
                },
                {
                  name: 'shape',
                  type: 'select',
                  options: shapeOptions,
                },
                {
                  name: 'quantity',
                  type: 'number',
                  min: 1,
                },
                {
                  name: 'totalCarat',
                  type: 'number',
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
