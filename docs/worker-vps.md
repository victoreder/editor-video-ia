# Processar os vídeos no seu servidor (sem a Vercel Sandbox)

Por padrão, cada vídeo é processado numa Vercel Sandbox (uma máquina temporária da
Vercel). No plano Hobby ela tem cotas mensais (CPU, snapshots). Com um servidor seu
(o mesmo do MinIO serve), o processamento roda lá, sem cota e mais rápido (não precisa
instalar tudo a cada vídeo).

## Como funciona

- **Site**: continua na Vercel. Com `RUNNER=queue`, ele só coloca o job na fila (no banco).
- **Worker**: roda no seu servidor, pega os jobs da fila, processa e salva o resultado no
  mesmo banco e no MinIO. O site mostra o progresso normalmente.

## Passo a passo

1. **No servidor** (precisa de Docker e ~4 GB de RAM livres):
   ```bash
   git clone https://github.com/victoreder/editor-video-ia.git
   cd editor-video-ia
   cp .env.worker.example .env.worker
   nano .env.worker   # cole os mesmos valores das variáveis da Vercel
   docker compose -f docker-compose.worker.yml up -d --build
   docker compose -f docker-compose.worker.yml logs -f   # deve aparecer "aguardando jobs…"
   ```
2. **Na Vercel** (Settings → Environment Variables): crie `RUNNER` = `queue` e faça Redeploy.
3. Suba um vídeo. Nos logs do worker aparece `▶ process job_…`.

## Atualizar o worker (depois de cada merge)

```bash
cd editor-video-ia && git pull && docker compose -f docker-compose.worker.yml up -d --build
```

## Voltar para a Vercel Sandbox

Apague a variável `RUNNER` na Vercel (ou ponha `vercel-sandbox`) e faça Redeploy.
