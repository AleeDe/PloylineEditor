import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Polyline Editor Lab',
  description: 'Interactive PolyLine Editor with 2D/3D vertex editing',
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
