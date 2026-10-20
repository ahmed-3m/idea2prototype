// Idea2Prototype feature: worker-jobs — demo API routes over the job queue.
// Contract: handlers return [status, payload]; the server sends payload as JSON.
// The queue module (jobs.mjs in the project root) holds the real logic.
import { enqueue, list } from '../jobs.mjs';

export default [
  {
    // Demo route: enqueue a job and return 202 immediately — the queue drains
    // in the background. Poll GET /api/jobs to watch statuses change.
    path: '/api/jobs',
    methods: {
      GET: async ({ url }) => {
        const status = url.searchParams.get('status');
        return [200, await list(status ? { status } : {})];
      },
      POST: async ({ body }) => {
        if (!body || typeof body !== 'object' || Array.isArray(body)) {
          return [400, { error: 'JSON object body required' }];
        }
        if (typeof body.type !== 'string' || !body.type.trim()) {
          return [400, { error: 'type (string) is required' }];
        }
        const job = await enqueue(body.type, body.payload ?? {});
        return [202, job];
      },
    },
  },
];
