import React from 'react'
import './styles.css'

export const metadata = {
  description: 'Payload and Cloudflare boilerplate for project portfolios, blogs, and custom request websites.',
  title: 'Bemoat Web Starter',
}

export default async function RootLayout(props: { children: React.ReactNode }) {
  const { children } = props

  return (
    <html lang="th">
      <body>{children}</body>
    </html>
  )
}
