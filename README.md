# Editor de Vídeo com IA

Editor de vídeos curtos (Reels/TikTok/Shorts) com IA: legendas animadas, zoom dinâmico, B-roll, motion graphics e sound design automáticos — com preview ao vivo no navegador e uma timeline estilo CapCut para ajustar tudo.

- **[PLANO.md](PLANO.md)**: plano completo (arquitetura, funcionalidades, roadmap).
- **`codigo-base/`**: código de referência dos projetos open source (MIT), separado por funcionalidade. Licenças em `codigo-base/LICENCAS/`.

## Como rodar

```bash
npm install
pip install -r worker/requirements.txt   # rastreamento de rosto (OpenCV); opcional
cp .env.example .env.local               # coloque as chaves que tiver
npm run dev                              # http://localhost:3000
```

Precisa de `ffmpeg` no PATH. Sem nenhuma chave, o app funciona em **modo limitado**:

- as **regras** fazem o papel da IA diretora;
- o **alinhamento do roteiro** substitui a transcrição (cole o texto falado ao criar o projeto).

Com `ANTHROPIC_API_KEY` + `ELEVENLABS_API_KEY` (ou `GROQ_API_KEY`) + `PIXABAY_API_KEY` (grátis, chave na hora em pixabay.com/api/docs) ou `PEXELS_API_KEY`, o fluxo fica completo.

| Comando | O que faz |
|---|---|
| `npm test` | testes das partes puras (timeline, cortes, legendas, safezone, SFX, QA, editor) |
| `npm run typecheck` | TypeScript |
| `npm run e2e -- video.mp4 --render` | pipeline inteiro sem servidor (processa e renderiza) |
| `npm run e2e:extras -- <projeto> [reel.mp4]` | Post pack, capa, Shorts e estilo de referência num projeto processado |
| `npm run worker:daemon` | worker em fila para a VPS (`RUNNER=queue`, `WORKER_CONCURRENCY`) |
| `npm run mcp` | servidor MCP: edite os vídeos conversando no Claude Code/Desktop |
| `npm run studio` | Remotion Studio com a composição |
| `npm run sfx:fetch` | troca os efeitos sintetizados por gravações reais do Mixkit (roda sozinho na Sandbox/Docker) |
| `npm run sfx:generate` / `npm run music:generate` | regenera sons e trilhas sintetizados |
| `scripts/make-test-video.sh foto.png out.mp4` | vídeo de teste (foto com rosto + "fala" sintética) |

**Acesso:** localmente (`npm run dev`) o sistema fica aberto. Em produção, exige a senha de `APP_PASSWORD` (sessão de 30 dias, cookie assinado), e a API aceita também `Authorization: Bearer <APP_API_TOKEN>`.

## Como funciona

```
navegador ── upload direto ──► Storage (local | Vercel Blob | S3/MinIO)
   │  editor: timeline + @remotion/player (preview grátis e instantâneo)
   └─ API (Next.js) ──► DB (JSON local | Supabase) ──► Runner (local | Vercel Sandbox)
                                                         │
          worker/cli.ts: proxy → transcrição → correção → rosto → takes/cortes →
          legendas → IA diretora (zoom, B-roll, gráficos, transições) → SFX → EditPlan
                                                         │
          render: Remotion → MP4 H.264 12 Mbps → loudnorm −14 LUFS → .srt + thumbnail
```

Tudo que a IA decide e tudo que você ajusta fica em **um único JSON, o `EditPlan`** (`src/lib/plan/schema.ts`). Os tempos são ancorados na fonte (`sourceId` + segundos do arquivo original). Por isso cortar, reordenar ou acelerar um clipe faz legendas, B-roll, gráficos e zooms acompanharem.

### Onde está cada módulo

| Módulo | Arquivos |
|---|---|
| 01 Transcrição | `src/lib/adapters/transcriber` (Scribe, whisper-1, Groq, alinhador de roteiro), correção em `modules/captions.ts` + IA |
| 02 Cortes e takes | `src/lib/modules/cuts.ts` (pausas, "éé", takes repetidos, nunca no meio da palavra) + IA em `pipeline/plan-builder.ts` |
| 03 Legendas | `modules/captions.ts`, `modules/safezone.ts`, `remotion/captions/Captions.tsx` (5 presets) |
| 04 Câmera | `lib/plan/camera.ts` (nível por corte, snap/push/shake centrados no rosto) |
| 05 Rosto | `worker/face_track.py` (YuNet/OpenCV), `lib/media/face.ts`, reframe barato em `lib/plan/frame.ts` |
| 06 B-roll | `modules/broll-assets.ts` (biblioteca própria → Pixabay e/ou Pexels com 3 buscas por cena, e a IA escolhe pela miniatura → imagem por IA; sem nada que combine, a cena sai), `remotion/broll/Broll.tsx` |
| 07 Motion graphics | `remotion/overlays/` — palavra-chave gigante (estilo TikTok, a cada 3–5 s), número, lista, chips, título, citação, emoji, riscado, comparação, passos, barras, nome/cargo, terminal, confete, meme/sticker e texto atrás da pessoa |
| 08 Som | `modules/sfx.ts`, `scripts/generate-sfx.ts`, música com ducking em `remotion/components/Extras.tsx`, trilha por IA em `adapters/musicgen` |
| 09 Cor e fundo | `media/grade.ts` (o rosto primeiro, nunca escurece), recorte da pessoa em `worker/matte.py` (MediaPipe) |
| 10 Estilos | `src/lib/styles` (4 prontos + próprios em "Meu estilo", `/styles`) |
| 11 Copiar estilo de referência | `modules/reference.ts` + `pipeline/reference.ts` (medições de ritmo/cor + IA com visão) |
| 13 Shorts, capa, post | `modules/shorts.ts`, `modules/thumbnail.ts` + `remotion/Cover.tsx`, `modules/postpack.ts`, jobs em `pipeline/extras.ts` |
| 12 Editor web | `src/editor` (timeline, inspector, atalhos, desfazer/refazer, autosave), `src/components` |
| 14 Render e QA | `pipeline/render.ts` (9:16, 1:1, 16:9, versão limpa), QA do plano em `modules/qa.ts` e do MP4 em `media/ffmpeg.ts` (loudness, tela preta, imagem congelada), FCPXML em `modules/fcpxml.ts` |
| Edição por chat | `modules/chat-edit.ts` (IA → operações do editor), aba "Chat IA" e `mcp/server.ts` |
| IA diretora | `src/lib/adapters/director` (Claude, OpenAI e regras; structured outputs) com prompts em PT-BR |

### Atalhos do editor

`Espaço` tocar/pausar · `←/→` 1 frame (`Shift` = 10) · `S` dividir o clipe na agulha · `Delete` apagar · `⌘Z` / `⌘⇧Z` desfazer/refazer · `Esc` limpar a seleção.

## Deploy

**Vercel (fase 1):** o `vercel.json` publica um único serviço (`app`, Next.js). O processamento pesado roda numa Vercel Sandbox, criada pelo app, com o mesmo commit do deploy. No projeto da Vercel:
1. Crie um **Blob store** (gera `BLOB_READ_WRITE_TOKEN`; o app passa a usar o Blob sozinho).
2. Ainda em **Storage**, crie um banco **Postgres (Neon)** e conecte ao projeto. A `DATABASE_URL` é criada sozinha e as tabelas são criadas no primeiro acesso, sem SQL à mão. (O Supabase continua funcionando como alternativa: `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` e as migrations em `supabase/migrations`.)
3. Defina **`APP_PASSWORD`** (a senha de acesso). Sem ela, o sistema publicado fica bloqueado para todo mundo; com ela, só entra quem souber a senha, e a API inteira exige login (ninguém usa as suas chaves de IA). Opcional: `APP_API_TOKEN`, para o servidor MCP acessar a API.
4. Coloque as chaves de IA que tiver (`ANTHROPIC_API_KEY`, `ELEVENLABS_API_KEY`, `PIXABAY_API_KEY`…).

Na Vercel, `RUNNER` já vira `vercel-sandbox` e o repositório é detectado pelas variáveis de sistema. Com o repositório privado, defina `GIT_TOKEN`.

Para não depender das cotas da Vercel Sandbox (plano Hobby), rode o processamento no seu servidor: veja [docs/worker-vps.md](docs/worker-vps.md) (`RUNNER=queue` + `docker-compose.worker.yml`). Para limpar snapshots antigas da Sandbox, abra logado `/api/sandbox/cleanup`.

**VPS (fase 3):** `docker compose up -d` sobe o app, o worker em fila e o MinIO (`docker compose up -d --scale worker=2` para mais renders em paralelo). A troca é só nas variáveis de ambiente. Rode também `supabase/migrations/0002_phase3.sql` se usar o Supabase.

## Status

- **Fase 1 (MVP):** completa — upload, transcrição, cortes e takes, legendas com safezone, zoom no rosto, B-roll, motion graphics, transições, SFX, trilha com ducking, 4 estilos, editor com timeline, modo Comparar, QA e exportação.
- **Fase 2 (qualidade):** completa — biblioteca completa de motion graphics, imagens por IA, trilha gerada por IA (ElevenLabs; sem chave, sintetizada, agora também "cinematográfica"), cor medida com o rosto primeiro, **copiar o estilo de um reel de referência** e "Meu estilo", reenquadramento 16:9 → 9:16 "como um cinegrafista", QA automático do MP4 renderizado e exportação multi-formato.
- **Fase 3 (VPS e extras):** completa — fila com worker separado (Docker + MinIO), **recorte da pessoa e texto atrás dela**, vídeo longo → Shorts (cada Short vira um projeto já editado), capa com título, legenda do post e hashtags por plataforma, memes/stickers da sua biblioteca, vídeo de B-roll por IA (Replicate, opcional), **edição por chat** (aba no editor e servidor MCP) e exportação FCPXML para DaVinci/Premiere/Final Cut, mais a versão "limpa".
- **Não testado com serviços reais** (faltavam chaves neste ambiente): Claude, OpenAI, ElevenLabs (Scribe e Music), Groq, Pexels, Replicate, Vercel Blob/Sandbox e Supabase. Sem chave, tudo cai no caminho por regras/sintetizado, e esse caminho foi testado de ponta a ponta.

Os repositórios originais completos ficam em `referencias/` (não versionado). Os sons e as trilhas são sintetizados pelo próprio app, e as fontes (Montserrat, Inter e Anton) são OFL. O Remotion é gratuito para pessoas físicas e empresas de até 3 pessoas.
