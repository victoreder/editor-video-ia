// Roda dentro da Vercel Sandbox depois do job: apaga a própria Sandbox (e as snapshots
// dela), em vez de deixá-la ligada até o timeout. Usa o token OIDC passado pelo runner.
import {Sandbox} from '@vercel/sandbox';

const name = process.env.SANDBOX_NAME;
if (!name) process.exit(0);
const sb = await Sandbox.get({name});
await sb.delete({deleteOrphanSnapshots: true}).catch(async () => {
  await sb.stop();
});
