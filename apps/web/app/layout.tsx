import Link from 'next/link';
import type { ReactNode } from 'react';
import { AccountMenu, SessionExpiredDialog } from '../components/AccountMenu';
import { AuthProvider } from '../lib/auth';
import { HeaderLinks } from '../components/HeaderLinks';
import './globals.css';

export const metadata = { title: 'Ecom' };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="vi">
      <body>
        <AuthProvider>
          <header className="topbar">
            <Link href="/" className="brand">Ecom</Link>
            <nav><HeaderLinks /><AccountMenu /></nav>
          </header>
          {children}
          <SessionExpiredDialog />
        </AuthProvider>
      </body>
    </html>
  );
}
