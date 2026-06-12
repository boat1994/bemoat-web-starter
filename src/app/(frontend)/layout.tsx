import React from 'react'
import './styles.css'

export const metadata = {
  description: 'Payload and Cloudflare boilerplate for jewelry, portfolio, blog, and custom order websites.',
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
