// Worker: o mesmo código roda no processo local, no Docker da VPS e na Vercel Sandbox.
//   tsx worker/cli.ts <jobId>
import {runJob} from '../src/lib/pipeline/run-job';

const jobId = process.argv[2];
if (!jobId) {
  console.error('uso: tsx worker/cli.ts <jobId>');
  process.exit(1);
}
runJob(jobId)
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
