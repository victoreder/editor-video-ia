// Apaga as snapshots da Vercel Sandbox (logado: /api/sandbox/cleanup). O editor não usa
// snapshots; as que existem são sobras de versões anteriores e lotam a cota do Hobby.
import {cleanupSandboxSnapshots} from '@/lib/adapters/runner';
import {json} from '@/lib/server/http';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET() {
  try {
    const r = await cleanupSandboxSnapshots();
    return json({ok: true, maquinasAntigasApagadas: r.sandboxes, snapshotsApagadas: r.deleted, liberado: `${(r.bytes / 1e9).toFixed(2)} GB`});
  } catch (e) {
    return json({ok: false, error: e instanceof Error ? e.message : String(e)}, 500);
  }
}
