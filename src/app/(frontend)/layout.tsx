import React from 'react'
import './styles.css'

export const metadata = {
  description:
    'CMS-backed business websites for owner-led businesses. Inquiry-based scope for websites your team can update.',
  title: 'bemoat — CMS-backed business websites',
}

export default async function RootLayout(props: { children: React.ReactNode }) {
  const { children } = props

  return (
    <html lang="th">
      <body>{children}</body>
    </html>
  )
}
