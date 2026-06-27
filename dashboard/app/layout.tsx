import './globals.css'
import { ThemeProvider } from '@/components/ThemeProvider'

import { PostHogProvider } from '@/providers/PostHogProvider'

export const metadata = {
  title: 'Retail OS | Owner Dashboard',
  description: 'Physical retail operating system dashboard',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body>
        <PostHogProvider>
          <ThemeProvider>
            {children}
          </ThemeProvider>
        </PostHogProvider>
      </body>
    </html>
  )
}
