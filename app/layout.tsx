import type { Metadata } from 'next';
import { Geist, Geist_Mono } from 'next/font/google';
import './globals.css';

const geistSans = Geist({
  variable: '--font-geist-sans',
  subsets: ['latin'],
});

const geistMono = Geist_Mono({
  variable: '--font-geist-mono',
  subsets: ['latin'],
});

export const metadata: Metadata = {
  title: 'Dziennik Robót | Work Log',
  description: 'Głosowy dziennik robót ze zdjęciami i lokalizacją GPS.',
  manifest: '/manifest.webmanifest',
  themeColor: '#1d7a4e',
  icons: {
    icon: '/app-icon.svg',
    apple: '/app-icon.svg',
  },
  appleWebApp: {
    capable: true,
    title: 'Dziennik Robót',
    statusBarStyle: 'default',
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="pl">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        {children}
      </body>
    </html>
  );
}
