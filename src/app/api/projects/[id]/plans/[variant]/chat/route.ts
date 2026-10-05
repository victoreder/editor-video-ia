// Edição por chat (fase 3): mensagem + plano → operações aplicadas + resposta.
import {z} from 'zod';
import {EditPlanSchema} from '@/lib/plan/schema';
import {bestDirector} from '@/lib/adapters/director';
import {CHAT_SYSTEM, ChatEditSchema, applyOps, heuristicChat, planSummary} from '@/lib/modules/chat-edit';
import {finalize, restyle} from '@/lib/pipeline/plan-builder';
import {listCustomStyles} from '@/lib/styles/store';
import {route} from '@/lib/server/http';

export const dynamic = 'force-dynamic';

const Body = z.object({plan: EditPlanSchema, message: z.string().min(1).max(2000), history: z.array(z.object({role: z.enum(['user', 'assistant']), text: z.string()})).default([])});

export async function POST(req: Request) {
  return route(async () => {
    const {plan, message, history} = Body.parse(await req.json());
    const director = bestDirector();
    let out = heuristicChat(plan, message);
    let engine = 'regras';
    if (director.id !== 'heuristic') {
      const custom = await listCustomStyles();
      out = await director.json({
        name: 'chat_edit',
        system: CHAT_SYSTEM + (custom.length ? `\nEstilos próprios: ${custom.map((s) => `${s.id} (${s.name})`).join(', ')}` : ''),
        user: `PLANO ATUAL:\n${planSummary(plan)}\n\n${history.slice(-6).map((h) => `${h.role === 'user' ? 'USUÁRIO' : 'VOCÊ'}: ${h.text}`).join('\n')}\nUSUÁRIO: ${message}`,
        schema: ChatEditSchema,
        effort: 'medium',
      });
      engine = director.id;
    }
    const {plan: edited, applied, skipped} = applyOps(plan, out.ops);
    let next = edited;
    if (edited.style !== plan.style) {
      const custom = (await listCustomStyles()).find((s) => s.id === edited.style);
      next = restyle({...edited, style: plan.style}, custom ?? edited.style);
    }
    return {plan: finalize(next), reply: out.reply, applied, skipped, engine};
  });
}
