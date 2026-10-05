'use client';
import {ErrorView} from '@/components/ErrorView';

export default function GlobalError({error, reset}: {error: Error & {digest?: string}; reset: () => void}) {
  return (
    <html lang="pt-BR">
      <body>
        <ErrorView error={error} reset={reset} />
      </body>
    </html>
  );
}
