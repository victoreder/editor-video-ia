import type {Metadata} from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Editor de Vídeo IA',
  description: 'Editor de vídeos curtos com IA: legendas animadas, zoom, B-roll, motion graphics e sound design automáticos.',
};

export default function RootLayout({children}: {children: React.ReactNode}) {
  return (
    <html lang="pt-BR">
      <body className="min-h-screen antialiased">{children}</body>
    </html>
  );
}
