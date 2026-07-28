import type { ReactNode } from 'react';
import './globals.css';

export const metadata = {
  title: 'Helix gating experiment',
  description: 'Build-time page gating for static-export edge UIs',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
