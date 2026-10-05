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

Com `ANTHROPIC_API_KEY` + `ELEVENLABS_API_KEY` (ou `GROQ_API_KEY`) + `PEXELS_API_KEY`, o fluxo fica completo.

| Comando | O que faz |
|---|---|
| `npm test` | testes das partes puras (timeline, cortes, legendas, safezone, SFX, QA, editor) |
| `npm run typecheck` | TypeScript |
| `npm run e2e -- video.mp4 --render` | pipeline inteiro sem servidor (processa e renderiza) |
| `npm run studio` | Remotion Studio com a composição |
| `npm run sfx:generate` / `npm run music:generate` | regenera sons e trilhas sintetizados |
| `scripts/make-test-video.sh foto.png out.mp4` | vídeo de teste (foto com rosto + "fala" sintética) |

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
| 06 B-roll | `modules/broll-assets.ts` (biblioteca própria → Pexels → IA), `remotion/broll/Broll.tsx` (card, split, tela cheia, pip) |
| 07 Motion graphics | `remotion/overlays/Overlays.tsx` (número, lista, chips, título, citação, emoji, riscado) |
| 08 Som | `modules/sfx.ts`, `scripts/generate-sfx.ts`, música com ducking em `remotion/components/Extras.tsx` |
| 10 Estilos | `src/lib/styles` (Dynamic, Clean premium, Pop, Minimal) |
| 12 Editor web | `src/editor` (timeline, inspector, atalhos, desfazer/refazer, autosave), `src/components` |
| 14 Render e QA | `pipeline/render.ts` (9:16, 1:1, 16:9), `modules/qa.ts` |
| IA diretora | `src/lib/adapters/director` (Claude, OpenAI e regras; structured outputs) com prompts em PT-BR |

### Atalhos do editor

`Espaço` tocar/pausar · `←/→` 1 frame (`Shift` = 10) · `S` dividir o clipe na agulha · `Delete` apagar · `⌘Z` / `⌘⇧Z` desfazer/refazer · `Esc` limpar a seleção.

## Deploy

**Vercel (fase 1):** `STORAGE=vercel-blob`, `DB=supabase` (rode `supabase/migrations/0001_init.sql`) e `RUNNER=vercel-sandbox`, com `GIT_REPO_URL` apontando para este repositório. O worker roda dentro da Sandbox, com o mesmo código. Para o render via `@remotion/vercel`, use `RENDERER=vercel` e `npm run remotion:bundle` no build.

**VPS (fase 3):** `docker compose up -d` sobe o app, o worker e o MinIO. A troca é só nas variáveis de ambiente.

## Status

- **Fase 1 (MVP):** completa. Upload, transcrição (API ou roteiro), correção por glossário, cortes e takes, legendas animadas com safezone, zoom centrado no rosto, B-roll (biblioteca própria + Pexels + emoji), 7 motion graphics, transições, SFX sintetizados, trilha com ducking, 4 estilos, editor com timeline, modo Comparar (Claude × OpenAI), QA e exportação MP4/SRT/thumbnail.
- **Já adiantado da fase 2:** exportação 1:1 e 16:9, reframe 16:9 → 9:16 pelo rosto, look de cor por estilo, imagens por IA para B-roll (`BROLL_AI=1`) e biblioteca de assets (`/api/library`).
- **Próximos passos:** copiar o estilo de um reel de referência (módulo 11), grade de cor focado no rosto em ffmpeg, música gerada por IA, vídeo longo → Shorts e thumbnails (módulo 13), texto atrás da pessoa (matting), edição por chat (MCP) e exportação FCPXML.

Os repositórios originais completos ficam em `referencias/` (não versionado). Os sons e as trilhas são sintetizados pelo próprio app, e as fontes (Montserrat, Inter e Anton) são OFL. O Remotion é gratuito para pessoas físicas e empresas de até 3 pessoas.
