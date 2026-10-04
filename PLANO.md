# Editor de Vídeo com IA — Plano Completo

> Uso próprio. Fase 1 na **Vercel**; depois de validado, migra para uma **VPS dedicada**.
> Data do plano: 04/10/2026.

---

## 0. Onde está cada coisa

```
~/editor-video-ia/
├── PLANO.md                 ← este arquivo
├── referencias/             ← os 7 repositórios clonados inteiros (só leitura)
└── codigo-base/             ← os arquivos que vamos reaproveitar, separados por funcionalidade
    ├── 01-transcricao/  02-corte-takes/  03-legendas/  04-camera-zoom/
    ├── 05-rosto-reframe/  06-broll/  07-motion-graphics/  08-som-musica/
    ├── 09-cor-fundo/  10-estilos/  11-copiar-estilo-referencia/
    ├── 12-editor-web/  13-shorts-viral-thumbnail/  14-render-export-qa/
    └── LICENCAS/            ← todas MIT; manter os avisos de copyright
```

Dentro de cada módulo há uma subpasta por repositório de origem (ex.: `06-broll/marcoantoniovillalva-bot_motion-script/broll-plan.mjs`).

**Repositório descartado:** `opus-pro/ai-producer-plugin`, porque depende do servidor da OpusClip e não roda sozinho.

---

## 1. O que o produto faz (visão do usuário)

1. Você abre o site, sobe o vídeo cru (um ou vários takes) e escolhe um **estilo** (ou envia um reel de referência).
2. Você escolhe a **IA diretora** (Claude ou OpenAI) ou o modo **Comparar**, que roda as duas.
3. O sistema processa: transcreve → escolhe os melhores takes → corta silêncios → legenda → planeja zooms, B-roll, animações e sons.
4. Você vê o resultado **no navegador, na hora** (preview ao vivo, sem renderizar), e ajusta o que quiser numa timeline estilo CapCut.
5. Ao clicar em **Exportar**, recebe o MP4 final em 9:16 (e, se quiser, também 1:1 e 16:9), a legenda `.srt` e a thumbnail.

---

## 2. Decisões de arquitetura

| Decisão | Escolha | Por quê |
|---|---|---|
| Motor de vídeo | **Remotion** (React) | 3 dos repos já usam (autobroll, motion-script, talking-head-reel). O mesmo componente faz o preview no navegador e o render final. Tem render oficial na Vercel (`@remotion/vercel`, versão 4.0.532). |
| HyperFrames (kamgasimo e ghost-editor) | **Não usar como motor** | Aproveitamos as **regras, estilos e esquemas** deles e reescrevemos os componentes em React/Remotion. |
| Front + API | **Next.js (App Router)** na Vercel | Deploy nativo. O editor do autobroll (React + zustand + Tailwind) migra quase direto. |
| Processamento pesado (ffmpeg, rosto, render) | **Vercel Sandbox**, depois **Docker na VPS** | O mesmo código de "worker" roda nos dois lugares. Só troca o *runner*. |
| Arquivos | **Vercel Blob**, depois **MinIO/S3** na VPS | Upload direto do navegador ao Blob, que contorna o limite de 4,5 MB das funções. |
| Banco / jobs | **Supabase** (Postgres) | Você já usa. Guarda projetos, status dos jobs e planos de edição. |
| IA diretora | **Camada de provedores**: Claude **e** OpenAI | Você escolhe por projeto, ou compara as duas (seção 5). |
| Transcrição | **Por API** (seção 4) | Mais rápida que rodar o Whisper local. |

### Regra de ouro: tudo é um "adaptador"
Desde o dia 1 o código tem interfaces trocáveis:
- `Storage` → `VercelBlobStorage` | `S3Storage` (MinIO)
- `Runner` → `VercelSandboxRunner` | `LocalDockerRunner`
- `Transcriber` → `ElevenLabsScribe` | `OpenAIWhisper` | `GroqWhisper`
- `Director` (LLM) → `ClaudeDirector` | `OpenAIDirector`
- `ImageGen` → `OpenAIImages` | `Replicate (Flux)`

A migração para a VPS vira **trocar variáveis de ambiente**, sem reescrever código.

### Diagrama

```
Navegador (Next.js)
 ├─ Upload direto ──────────────► Blob/S3
 ├─ Editor (timeline + @remotion/player = preview grátis e instantâneo)
 └─ API routes ──► Supabase (projeto, jobs, EditPlan)
                    │
                    ▼
              Worker (Sandbox / Docker)
   ffmpeg · Python (MediaPipe) · Node · Remotion renderer
   01 transcrever → 02 cortar → 05 rastrear rosto → 09 cor
   → IA diretora (03, 04, 06, 07, 08) → EditPlan.json
   → [usuário ajusta] → 14 render final → MP4 no Blob/S3
```

---

## 3. O coração: o `EditPlan` (um JSON que descreve a edição inteira)

Tudo que a IA decide e tudo que você ajusta vira **um único arquivo JSON**. O preview e o render leem esse JSON. É a fusão de quatro modelos:
- o `Clip`/`Keyframe` do autobroll (`12-editor-web/.../src/timeline.ts`);
- o `ZoomBeat`/`BrollSegment` do motion-script (`04-camera-zoom/.../talking-head-types.ts` e `06-broll/.../broll-types.ts`);
- os `beats/graphics` do kamgasimo (`04-camera-zoom/.../edit-plan.mjs`);
- o `reel.json` do ghost-editor (`07-motion-graphics/.../reel-json.md`).

```ts
type EditPlan = {
  version: 1;
  format: { width: 1080; height: 1920; fps: 30 };      // + variantes 1:1, 16:9
  style: StyleId;                                       // 'dynamic' | 'clean' | 'pop' | ...
  sources: Source[];                                    // vídeos enviados
  words: Word[];                                        // transcrição: {text,start,end,sourceId}
  clips: Clip[];                                        // takes escolhidos e cortes (in/out por fonte)
  camera: { keyframes: Keyframe[]; beats: ZoomBeat[] }; // snap zoom, slow push, shake
  faceTrack?: FaceTrack;                                // centro do rosto e queixo ao longo do tempo
  captions: { preset: CaptionPreset; chunks: CaptionChunk[] }; // palavras, destaques, emoji, posição
  overlays: Overlay[];                                  // motion graphics: stat, list, cards, quote, chips…
  broll: BrollSegment[];                                // card | split | takeover | pip + asset
  transitions: Transition[];                            // whip, zoom, flash, glitch, blur
  audio: { music?: MusicBed; sfx: SfxCue[]; duckUnderDb: number };
  grade?: { look: 'punchy' | 'clean' | 'film' | 'none'; faceLift: number };
  outro?: EndCard;
  meta: { director: 'claude' | 'openai'; model: string; createdAt: string };
};
```

Todo tempo é guardado **relativo à fonte** (como no autobroll). Assim, se você cortar, reordenar ou acelerar um clipe, as legendas, os B-rolls e as animações acompanham.

---

## 4. Transcrição (por API)

| Provedor | Tempo por palavra | PT-BR | Extra | Uso |
|---|---|---|---|---|
| **ElevenLabs Scribe** | sim | muito bom | detecta risos e aplausos (alimenta o "viral score") | **padrão recomendado** |
| **OpenAI whisper-1** | sim (`timestamp_granularities=word`) | bom | a chave você já terá | alternativa |
| **Groq whisper-large-v3-turbo** | sim | bom | o mais rápido e o mais barato | alternativa |

Depois da transcrição vem a **correção com IA**: um glossário seu (nomes, marcas, termos) faz a IA corrigir erros por similaridade fonética. Essa etapa vem do motion-script (`01-transcricao/.../correct-captions.mjs`) e do `AUTOBROLL_PROMPT`.

> Atenção: os modelos `gpt-4o-transcribe` **não** retornam tempo por palavra, e a legenda karaokê precisa disso. Por isso a opção da OpenAI usa o `whisper-1`.

---

## 5. Qual IA é melhor: Claude ou OpenAI?

**Minha recomendação: ter as duas, com Claude como padrão.**

- **IA diretora (decide zoom, B-roll, animações, palavras-chave, cortes):** **Claude**. Essa tarefa é ler a transcrição inteira e devolver um JSON longo e coerente, seguindo dezenas de regras de "bom gosto". Os próprios repos usam Claude para isso: o motion-script usa Claude Sonnet nos diretores de B-roll e zoom, e kamgasimo, talking-head-reel e ghost-editor são skills do Claude Code.
  - `claude-opus-5-5`: melhor qualidade (US$ 4 / US$ 20 por milhão de tokens).
  - `claude-sonnet-5-5`: metade do preço (US$ 2 / US$ 10), bom para testes e rascunhos.
  - Saída com **structured outputs** (`output_config.format` com JSON Schema): o JSON sempre vem válido.
- **Geração de imagens e ilustrações:** **OpenAI**, porque o Claude não gera imagens. Alternativa: Flux via Replicate, que o motion-script já suporta.
- **Analisar um reel de referência (copiar estilo):** Claude e OpenAI analisam **frames + áudio transcrito**. O ghost-editor usa o Gemini 2.5 Pro porque ele recebe o vídeo inteiro de uma vez. Proposta: começar com frames (1 a cada 0,5 s) + transcrição no Claude, e deixar o Gemini como 3º provedor opcional só para essa função.

### Modo "Comparar"
O seletor no topo do projeto tem as opções `Claude` | `OpenAI` | `Comparar`. No modo Comparar, as duas IAs geram um `EditPlan` cada, e o editor mostra **dois previews lado a lado**. Isso custa só as chamadas de texto (centavos), porque o preview roda no navegador sem renderizar. Você escolhe o melhor e exporta só esse.

**Custo estimado da IA diretora** para um vídeo de 1 minuto (cerca de 5 chamadas: correção, cortes, zoom, B-roll, gráficos): **US$ 0,30–1,00 com Opus** e **US$ 0,15–0,50 com Sonnet**.

---

## 6. As funcionalidades, uma por uma

Legenda das prioridades: **F1** = MVP · **F2** = versão 2 · **F3** = depois.

### 01 — Transcrição · F1
- **O que faz:** gera a transcrição com tempo de cada palavra, cacheada por arquivo (não retranscreve se você reordenar).
- **Pegar de:**
  - `autobroll/lib-transcribe.mjs`: cache por clipe e um processo por lote.
  - `motion-script/transcribe.py`: glossário de domínio.
  - `motion-script/correct-captions.mjs`: correção com IA restrita a palavras foneticamente parecidas, o que evita a IA "inventar".
  - `motion-script/align-script.py`: alinhar a transcrição a um roteiro, se você colar o roteiro.
  - `EverythingAI/ve_transcribe.py`: chamada ao **ElevenLabs Scribe**, base do nosso adaptador.
- **Adaptar:** trocar o WhisperX local pelo adaptador `Transcriber` (API) e o OpenRouter pelo `Director`.

### 02 — Corte inteligente e escolha de takes · F1
- **O que faz:** remove silêncios, "éé", falsos começos e frases repetidas, ficando com **o melhor take de cada frase**.
- **Pegar de:**
  - `talking-head-reel/take-selection.md`: **o método** (numerar as frases, marcar os takes, preferir o take mais fluente e o mais tardio, manter "runs" contínuas, cortar em `a = início − 0,10…0,15 s` e `b = fim + 0,20…0,30 s`). Vira o prompt da IA.
  - `talking-head-reel/cut.py` e `check-cuts.py`: aplicar os cortes e validar o áudio de cada corte.
  - `autobroll/trim-silence.mjs`: autocut por pausas acima de 600 ms, com folgas de respiração (pronto, em JS).
  - `autobroll/arrange-clips.mjs`: ordenar vários arquivos numa narrativa e agrupar regravações.
  - `kamgasimo/plan-cuts.mjs`, `adjust-cuts.mjs`, `acoustics.mjs` e `reference/cutting.md`: cortes no zero-crossing e regras de ritmo.
  - `EverythingAI/ve_cut.py`: níveis de agressividade (gentle, medium, tight).
- **Adaptar:** a IA devolve `clips[]`; o código valida (nunca cortar no meio de uma palavra) e mostra na timeline.

### 03 — Legendas animadas · F1
- **O que faz:** legenda palavra por palavra, 2–4 palavras por bloco, palavra-chave colorida, emoji ocasional, **nunca em cima do rosto** e fora dos botões do Instagram e do TikTok.
- **Pegar de:**
  - `autobroll/captions-multiclip.mjs`: a IA escolhe as palavras de destaque (o prompt "NEVER accent: artigos, preposições…").
  - `autobroll/CaptionTrack.tsx` e `captions.ts`: componente Remotion pronto.
  - `motion-script/ReelCaptions.tsx`: legenda em dois tons ancorada no queixo.
  - `ghost-editor/safezone.mjs`: **o melhor posicionamento**, com as áreas de UI de cada plataforma medidas (Instagram top 220/bottom 420, TikTok 160/480, Shorts 140/380), a regra "abaixo do queixo → acima da cabeça → fundo escuro" e uma histerese que evita a legenda "pular".
  - `kamgasimo/captions.mjs`: a regra "1 destaque por bloco, 1 emoji a cada ~8 blocos" e a exportação `.srt`.
  - `EverythingAI/references/captions.md`: regras de leitura.
- **Presets a criar (F1):** `bold-pop` (maiúsculas, amarelo #FFD400), `karaoke`, `pill` (fundo escuro), `editorial` (minúsculas suaves), `clean`.

### 04 — Câmera: zoom e movimento · F1
- **O que faz:** um enquadramento diferente a cada corte (esconde o jump cut), snap zoom na palavra forte, slow push em trechos longos, shake no impacto.
- **Pegar de:**
  - `motion-script/zoom-plan.mjs`: **o prompt do diretor de zoom** (STATIC / FAST-IN-OUT 1,30–1,48 / SLOW-PUSH 1,18–1,35, um destaque a cada 3–5 beats). Está em italiano; traduzir.
  - `motion-script/talking-head-motion.ts` e `TalkingHeadEdit.tsx`: aplicação no Remotion, centrada no rosto.
  - `autobroll/timeline.ts`: keyframes com smoothstep, editáveis na timeline.
  - `talking-head-reel/reel-kit.tsx`: `Push {at, z, up, until, down}`.
  - `kamgasimo/edit-plan.mjs`: as **regras mecânicas** (novo zoom a cada corte, snap no máximo a cada N s, `maxStatic` de 4 s) mais `dynamic.json` → `camera.levels [1.0, 1.12, 1.2]`.
- **Adaptar:** a parte mecânica é feita por código (regras do kamgasimo) e a parte criativa (onde dar ênfase) pela IA (prompt do motion-script).

### 05 — Rastreamento de rosto e reenquadramento · F1 (rastreamento) / F2 (reframe 16:9 → 9:16)
- **O que faz:** sabe onde estão o rosto, a boca e o queixo a cada instante. Isso alimenta o zoom centrado, a posição da legenda, o "texto atrás da pessoa" e o corte vertical de vídeos horizontais.
- **Pegar de:**
  - `motion-script/face-track.py` e `ghost-editor/face_track.py`: OpenCV/MediaPipe, gerando o JSON `FaceTrack {t,cx,cy,faceW,faceH,chinY}`.
  - `kamgasimo/track.mjs` e `reframe.mjs`: o reframe "como um cinegrafista" (só move a câmera quando a cabeça se desloca mais de 4% da largura, com easing).
  - `openshorts/main.py`: modo TRACK (MediaPipe + YOLOv8) e modo GENERAL (fundo desfocado) para vídeos sem rosto.
  - `talking-head-reel/references/layout.md`: zonas de layout.
- **Alternativa barata (F1):** a visão da IA em 1 frame por clipe (como o autobroll faz) caso o MediaPipe atrase o MVP.

### 06 — B-roll automático · F1 (Pexels + seus arquivos) / F2 (imagens IA) / F3 (vídeos IA)
- **O que faz:** a IA lê a fala e decide **onde, quando e como** inserir uma imagem ou vídeo de apoio.
- **Pegar de:**
  - `motion-script/broll-plan.mjs` e `broll-director/SKILL.md`: **o melhor diretor de B-roll** (12–18 segmentos por vídeo, regras de densidade, variedade e palavra-chave) e 5 templates: `card` (cartão de vidro abaixo da legenda), `split` (janela em cima, você embaixo), `takeover` (tela cheia), `pip` (você em um quadrado pequeno) e `bubbles` (balões de comentário).
  - `motion-script/broll-types.ts`: o esquema `BrollSegment`/`BrollAsset`, usado quase como está.
  - `motion-script/broll-assets.mjs`, `asset-search.mjs` e `asset-download.mjs`: buscam em várias fontes gratuitas (emoji 3D Fluent, logos SVGL, Pexels, Vecteezy, IA via Replicate) **com checagem de transparência e marca d'água**.
  - `motion-script/BrollLayer.tsx` (838 linhas): a renderização de todos os templates, inclusive os mock-ups animados (tasks, chat, phone, compare, orbit, agentconsole).
  - `autobroll/broll-multiclip.mjs`: **prioriza os seus próprios arquivos** antes do Pexels e guarda alternativas para trocar com 1 clique.
  - `autobroll/Broll.tsx`: B-roll ancorado ao clipe.
  - `EverythingAI/ve_broll.py` e `broll-routing.md`: roteamento por tipo de frase.
  - `ghost-editor/broll_gen.py`: geração por IA.
- **Adaptar:** criar uma biblioteca de assets sua (pasta no Blob/S3) que a IA consulta primeiro.

### 07 — Motion graphics (animações que "ilustram a fala") · F1 (5 componentes) / F2 (biblioteca completa)
- **O que faz:** quando você diz um número, uma lista, uma comparação ou uma citação, aparece uma animação sincronizada **na palavra exata**.
- **Pegar de:**
  - `kamgasimo/components/` e `graphics.md`: **o catálogo mais completo** e as regras de layout (full, overlay, split, pip, cutaway). Componentes: `cards`, `title`, `list`, `stat`, `icon`, `compare`, `steps`, `quote`, `chart`, `ui`, `lowerthird`, `sticker` e `confetti`. São HTML/GSAP, então **reescrevemos em React** mantendo os mesmos props.
  - `motion-script/motion-components/`: **já em Remotion**, prontos para usar. São 20 cenas: `StatScene`, `ListScene`, `ComparisonScene`, `ChatScene`, `CodeScene`, `FlowScene`, `TitleScene`, `HighlightScene`, `Emoji3D`, `LottieScene`, `ScreenshotScene`, `LogoIntroScene`, `OutroScene`, `GlassCard`…
  - `talking-head-reel/overlays.tsx` e `reel-overlays.tsx`: **também em Remotion**, entre eles `StampList`, `QuoteCard`, `StrikeBig` (texto riscado: "NÃO é X"), `HeroChips`, `BigEmoji`, `BigLogo`, `Meme` e `EndCard`.
  - `ghost-editor/reel-json.md`: a tabela "**use quando a pessoa disser…**" (número → `big`, lista de nomes → `chips`, mito → `strike`, sentimento → `emoji`, punchline → `meme`). Essa tabela vira o prompt da IA.
  - `ghost-editor/meme_find.py` e `meme_add.py`: a biblioteca de memes (F3).
- **F1:** `stat`, `list`, `title/big`, `quote`, `emoji/sticker`. **F2:** os demais.

### 08 — Som: efeitos e música · F1 (SFX) / F2 (música com ducking)
- **O que faz:** whoosh nas transições, pop quando um card entra, impact no título, e uma música de fundo que **abaixa quando você fala** (ducking), com a voz sempre pelo menos 12 dB acima.
- **Pegar de:**
  - `kamgasimo/mix.mjs`: **a mixagem profissional** (ffmpeg `sidechaincompress`, loudnorm −14 LUFS e a verificação da margem de 12 dB na pior janela).
  - `kamgasimo/sfx.mjs` e `sound.md`: o vocabulário evento → som por estilo, descartando um som fraco a menos de 0,15 s de um forte.
  - `motion-script/SoundDesign.tsx`: SFX como `<Audio>` no Remotion.
  - `motion-script/generate-sounds.mjs` e `kamgasimo/synth.mjs`: **sons sintetizados**, sem problema de licença.
  - `ghost-editor/library/*/manifest.json` e `sfx_fetch.py`: catálogos de SFX e música royalty-free (Mixkit) e os volumes por papel (ui −14, whoosh −12, impact −8 dB).
- **Música:** F1 com upload do seu arquivo ou uma biblioteca local; F2 com música gerada por IA.

### 09 — Cor e fundo · F2
- **O que faz:** correção de cor focada no rosto (levanta o rosto escuro contra uma janela clara; **o rosto nunca sai mais escuro**), mais o look do estilo. Na F3: desfoque de fundo e texto **atrás** da pessoa.
- **Pegar de:**
  - `kamgasimo/grade.mjs`: o grade face-first em ffmpeg.
  - `kamgasimo/cutouts.mjs`: os recortes para o "texto atrás".
  - `motion-script/matte-footage.py`: RobustVideoMatting, desfoque sem halo, grain (pesado; F3, na VPS).

### 10 — Estilos e o "seu gosto" · F1
- **O que faz:** um estilo é um JSON com paleta, fontes, legenda, câmera, transições, densidade de gráficos, SFX e música. Você escolhe um estilo pronto e ajusta o seu.
- **Pegar de:**
  - `kamgasimo/styles/*.json`: **o formato mais completo** (o `dynamic.json` tem palette, fonts, captions, camera, transitions, graphics.coverage, maxStatic, sfx, music, grade, hook, cta e progress). Vira o nosso esquema base.
  - `ghost-editor/styles/*.json` e `styles.md`: 7 estilos (clean, editorial, meme, cinematic, launch, kinetic, pop) para converter para o nosso esquema.
  - `EverythingAI/taste.yaml` e `ve_taste.py`: a ideia de **"um arquivo, o seu gosto"**. No nosso caso vira uma tela de "Meu estilo" no app.
- **Estilos da F1:** Dynamic creator (padrão), Clean premium, Pop, Minimal.

### 11 — Copiar o estilo de um reel de referência · F2
- **O que faz:** você sobe um reel que admira, a IA analisa como ele foi editado (cortes, legendas, animações, sons, paleta) e gera um **estilo novo** com base nele.
- **Pegar de:**
  - `ghost-editor/reference-study-prompt.md`: **o prompt pronto** (log de edição frame a frame, sistema de legendas, cenas, transições, som, paleta e "as 5 coisas que definem este estilo").
  - `ghost-editor/reference_study.py`: extrai os frames com ffmpeg (contact sheet) e chama a IA.
- **Adaptar:** a saída deixa de ser Markdown e passa a ser o JSON do nosso estilo, via structured outputs.

### 12 — Editor web (timeline) · F1
- **O que faz:** preview ao vivo, timeline com faixas (vídeo, legendas, B-roll, gráficos, áudio), cortar, mover, desfazer/refazer, inspector de propriedades, trocar um B-roll pelas alternativas, arrastar a legenda.
- **Pegar de (autobroll):** `editor/` (`Editor.tsx`, `Timeline.tsx`, `Inspector.tsx`, `AssetsSidebar.tsx`, `store.ts` com zustand e undo/redo, `keys.ts` com atalhos) e `src/` (composição `MultiClipVideo.tsx`).
- **Adaptar:** migrar de Vite para Next.js, trocar o `server/index.mjs` por API routes e jobs, e ampliar o store para o `EditPlan` completo (overlays, transições, SFX).
- **Bônus:** `autobroll/mcp/server.mjs`, um servidor MCP que deixa o Claude Code editar o projeto conversando. Útil para ajustes por chat (F3).

### 13 — Vídeo longo → Shorts, thumbnail e legenda do post · F3
- **Pegar de:**
  - `EverythingAI/ve_shorts.py`: rubrica de 8 padrões de gancho.
  - `EverythingAI/ve_virality.py`: pontuação por **energia da voz**, risadas e pausa dramática.
  - `EverythingAI/ve_postpack.py`: legenda, gancho e hashtags por plataforma.
  - `kamgasimo/moments.mjs` e `thumbnail.mjs`: thumbnail com o frame mais expressivo, recortado e com título.
  - `openshorts/hooks.py` e `thumbnail.py`.

### 14 — Render, exportação e controle de qualidade · F1
- **O que faz:** gera o MP4 final (~12 Mbps, −14 LUFS) e, opcionalmente, a versão "limpa" e a camada de B-roll transparente (ProRes 4444) para editar em outro programa.
- **Pegar de:**
  - `motion-script/render-edit.mjs` e `export-social.mjs`: três saídas e o encode para redes.
  - `kamgasimo/render.mjs` e `compose.mjs`: um render por formato (9:16, 1:1, 16:9).
  - `kamgasimo/verify.mjs`, `review.md` e `ghost-editor/qa.py`: **QA automático** (legenda sobre o rosto? áudio cortado no corte? tela parada mais de 4 s?).
  - `kamgasimo/fcpxml.mjs`: exporta a timeline para DaVinci, Premiere ou Final Cut (F3).
  - `openshorts/render-service/`: referência de um serviço de render.
- **Na Vercel:** `@remotion/vercel` (Vercel Sandbox). **Na VPS:** `@remotion/renderer` direto, em Docker.

---

## 7. Fluxo de processamento (jobs)

| # | Etapa | Onde roda | IA? | Duração aprox. (vídeo de 1 min) |
|---|---|---|---|---|
| 1 | Upload → Blob | navegador | — | depende da internet |
| 2 | Proxy 1080x1920 30 fps + extração de áudio | worker (ffmpeg) | — | 15–30 s |
| 3 | Transcrição | API | Scribe/Whisper | 5–15 s |
| 4 | Correção da transcrição | API | Diretor | 5–10 s |
| 5 | Escolha de takes + cortes | API + código | Diretor | 10–20 s |
| 6 | Rastreamento de rosto | worker (Python/MediaPipe) | — | 20–40 s |
| 7 | Plano criativo (zoom, legendas, B-roll, gráficos, SFX) | API | Diretor (1–2 chamadas) | 20–60 s |
| 8 | Busca e download de assets | worker | ImageGen (opcional) | 10–30 s |
| 9 | **Preview no editor** | navegador | — | instantâneo |
| 10 | Render final + mixagem | worker (Remotion + ffmpeg) | — | 1–4 min |

O status de cada etapa fica no Supabase, e a tela mostra uma barra de progresso. O formato `PROGRESS:pct:label` do autobroll é reaproveitado.

---

## 8. Roteiro de desenvolvimento

### Fase 1 — MVP na Vercel
1. Criar o projeto Next.js + Remotion + Tailwind + Supabase + Vercel Blob.
2. Escrever os adaptadores (`Storage`, `Runner`, `Transcriber`, `Director`) e o esquema `EditPlan` com validação (zod).
3. Módulo 01 (transcrição via API + correção).
4. Módulo 02 (autocut + escolha de takes).
5. Módulo 03 (legendas + safezone) e módulo 04 (zoom).
6. Módulo 05 (face track) e módulo 06 (B-roll Pexels + seus arquivos, templates card/split/takeover).
7. Módulo 07 (5 componentes) e módulo 08 (SFX).
8. Módulo 10 (4 estilos) e módulo 12 (editor portado do autobroll).
9. Módulo 14 (render via `@remotion/vercel`).
10. Seletor Claude/OpenAI + modo Comparar.
- **Pronto quando:** você sobe um vídeo seu e recebe um reel legendado, com zooms, B-roll e animações, ajustável no editor.

### Fase 2 — Qualidade
- Biblioteca completa de motion graphics, imagens por IA, música com ducking, grade de cor, copiar estilo de referência, reframe 16:9 → 9:16, QA automático e exportação multi-formato.

### Fase 3 — VPS e extras
- Docker na VPS dedicada (MinIO, worker, fila), matting e texto atrás da pessoa, vídeo longo → Shorts, thumbnails, memes, vídeos gerados por IA, edição por chat (MCP) e exportação FCPXML.

---

## 9. Vercel agora, VPS depois

**Na Vercel (fase 1):**
- **Plano:** o Hobby (gratuito) proíbe uso comercial, mas uso próprio é permitido. Mesmo assim, o **Pro** é recomendado pelos limites maiores de tempo de função e de Sandbox.
- **Uploads:** precisam usar o *client upload* do Blob, porque as funções aceitam no máximo 4,5 MB.
- **Funções:** não fazem processamento pesado, só disparam jobs no **Vercel Sandbox**. O Sandbox é uma VM Linux onde roda ffmpeg, Python e o render.
- **Custo:** o Sandbox é cobrado por CPU-hora. Vídeos curtos custam pouco; vídeos longos ficam caros, e esse é o sinal para migrar.
- **Antes de começar:** confirmar os limites atuais de duração e de memória do Sandbox no plano escolhido.

**Na VPS (fase 3).** Recomendação mínima: **8 vCPU, 16 GB de RAM, 160 GB SSD e swap de 4 GB**.
- O render do Remotion usa Chromium headless e paraleliza por núcleo, então mais vCPU significa render mais rápido.
- O docker-compose sobe: `web` (Next.js), `worker` (Node + Python + ffmpeg + Chromium), `minio` e `redis` (fila).
- A troca é feita por variáveis de ambiente: `RUNNER=local`, `STORAGE=s3`.

---

## 10. Chaves e contas necessárias

| Serviço | Para quê | Fase |
|---|---|---|
| Anthropic API | IA diretora (Claude) | F1 |
| OpenAI API | IA diretora alternativa, whisper-1 e imagens | F1 |
| ElevenLabs (ou Groq) | Transcrição | F1 |
| Pexels API (grátis) | B-roll de banco | F1 |
| Vercel (Pro recomendado) | Hospedagem, Blob e Sandbox | F1 |
| Supabase | Banco e status dos jobs | F1 |
| Replicate (opcional) | Flux e geração de vídeo | F2/F3 |

---

## 11. Riscos e cuidados

- **Os repositórios são novos e pequenos** (0–19 estrelas). Usamos as ideias e o código como base, mas tudo passa por revisão e testes nossos.
- **Os prompts originais estão em italiano, russo e inglês.** Todos serão reescritos em português, para fala em PT-BR.
- **Componentes HyperFrames (kamgasimo, ghost-editor):** precisam ser reescritos em React. O esforço é médio, mas a lógica e os props já estão definidos.
- **Licenças:** todo o código é MIT (manter `LICENCAS/`). A fonte *Montra* do motion-script **não** é redistribuível; usar Montserrat, Inter ou Anton (OFL). Os sons do Mixkit e do Pixabay são livres para uso. O **Remotion** é gratuito para pessoas físicas e empresas de até 3 pessoas; acima disso exige licença paga.
- **O "bom gosto" da IA vem de iteração:** os primeiros vídeos vão precisar de ajuste fino dos prompts. O modo Comparar e os seus vídeos de referência ajudam nisso.
