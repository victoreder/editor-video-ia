// Ações rápidas sobre um plano (rodam na hora, sem job): refazer cortes,
// regerar legendas, trocar estilo, recalcular posições/SFX, QA e SRT.
import {z} from 'zod';
import {EditPlanSchema, StyleIdSchema} from '@/lib/plan/schema';
import {autoCut, snapClipsToWords} from '@/lib/modules/cuts';
import {buildCaptions, toSrt} from '@/lib/modules/captions';
import {runQa} from '@/lib/modules/qa';
import {assignClipZoom} from '@/lib/modules/creative';
import {getStyle} from '@/lib/styles';
import {finalize, restyle} from '@/lib/pipeline/plan-builder';
import {route} from '@/lib/server/http';

export const dynamic = 'force-dynamic';

const Body = z.object({
  plan: EditPlanSchema,
  action: z.enum(['autocut', 'captions', 'finalize', 'restyle', 'qa', 'srt']),
  level: z.enum(['gentle', 'medium', 'tight']).optional(),
  style: StyleIdSchema.optional(),
});

export async function POST(req: Request) {
  return route(async () => {
    const {plan, action, level, style} = Body.parse(await req.json());
    switch (action) {
      case 'autocut': {
        const {clips} = autoCut(plan.sources, plan.words, level ?? 'medium', true);
        const next = {...plan, clips: assignClipZoom(snapClipsToWords(clips, plan.words), getStyle(plan.style))};
        return {plan: finalize({...next, captions: {...next.captions, chunks: buildCaptions(next)}})};
      }
      case 'captions':
        return {plan: finalize({...plan, captions: {...plan.captions, chunks: buildCaptions(plan)}})};
      case 'finalize':
        return {plan: finalize(plan)};
      case 'restyle':
        return {plan: restyle(plan, style ?? plan.style)};
      case 'qa':
        return {issues: runQa(plan)};
      case 'srt':
        return new Response(toSrt(plan), {headers: {'Content-Type': 'application/x-subrip; charset=utf-8', 'Content-Disposition': 'attachment; filename="legendas.srt"'}});
    }
  });
}
