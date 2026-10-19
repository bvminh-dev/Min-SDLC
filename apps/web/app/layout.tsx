import Link from 'next/link';
import type { ReactNode } from 'react';
import { AccountMenu, SessionExpiredDialog } from '../components/AccountMenu';
import { AuthProvider } from '../lib/auth';
import { HeaderLinks } from '../components/HeaderLinks';
import { PageMark } from '../components/PageMark';
import './globals.css';
import './icons.css';
import './ds.css';
import './styles/shell.css';
import './styles/auth.css';
import './styles/catalog.css';
import './styles/cart.css';
import './styles/orders.css';
import './styles/payship.css';
import './styles/invpromo.css';
import './styles/reviewdash.css';
import './styles/home.css';
import './styles/sales.css';

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
          <PageMark />
          {children}
          <SessionExpiredDialog />
        </AuthProvider>
      </body>
    </html>
  );
}
