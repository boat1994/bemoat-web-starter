export type ProofItem = {
  id: string
  label: string
  title: string
  description: string
  href?: string
}

export const proofItems: ProofItem[] = [
  {
    id: 'morerolls',
    label: 'Live CMS-backed website proof',
    title: 'Morerolls',
    description:
      'A live CMS-backed business website — proof of the website and editor workflow, not workflow automation or business outcome claims.',
    href: 'https://morerolls.com',
  },
]
