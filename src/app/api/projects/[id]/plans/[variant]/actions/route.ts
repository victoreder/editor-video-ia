// Ações rápidas sobre um plano (rodam na hora, sem job): refazer cortes,
// regerar legendas, trocar estilo, recalcular posições/SFX, QA e SRT.
import {z} from 'zod';
import {EditPlanSchema, StyleIdSchema} from '@/lib/plan/schema';
import {autoCut, snapClipsToWords} from '@/lib/modules/cuts';
import {buildCaptions, toSrt} from '@/lib/modules/captions';
import {runQa} from '@/lib/modules/qa';
import {assignClipZoom} from '@/lib/modules/creative';
import {styleOf} from '@/lib/styles';
import {finalize, restyle} from '@/lib/pipeline/plan-builder';
import {route} from '@/lib/server/http';
import {listCustomStyles} from '@/lib/styles/store';

export const dynamic = 'force-dynamic';

const Body = z.object({
  plan: EditPlanSchema,
  action: z.enum(['autocut', 'captions', 'finalize', 'restyle', 'qa', 'srt']),
  level: z.enum(['gentle', 'medium', 'tight']).optional(),
  minPause: z.number().min(0.1).max(2).optional(),
  removeMistakes: z.boolean().optional(),
  style: StyleIdSchema.optional(),
});

export async function POST(req: Request) {
  return route(async () => {
    const {plan, action, level, style, minPause, removeMistakes} = Body.parse(await req.json());
    switch (action) {
      case 'autocut': {
        const {clips, report} = autoCut(plan.sources, plan.words, level ?? 'medium', removeMistakes !== false, minPause);
        const next = {...plan, cutReport: report, clips: assignClipZoom(snapClipsToWords(clips, plan.words, plan.sources), styleOf(plan))};
        return {plan: finalize({...next, captions: {...next.captions, chunks: buildCaptions(next)}})};
      }
      case 'captions':
        return {plan: finalize({...plan, captions: {...plan.captions, chunks: buildCaptions(plan)}})};
      case 'finalize':
        return {plan: finalize(plan)};
      case 'restyle': {
        const id = style ?? plan.style;
        const custom = id.startsWith('custom_') ? (await listCustomStyles()).find((s) => s.id === id) : undefined;
        return {plan: restyle(plan, custom ?? id)};
      }
      case 'qa':
        return {issues: runQa(plan)};
      case 'srt':
        return new Response(toSrt(plan), {headers: {'Content-Type': 'application/x-subrip; charset=utf-8', 'Content-Disposition': 'attachment; filename="legendas.srt"'}});
    }
  });
}
