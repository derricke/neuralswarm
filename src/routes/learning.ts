import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { getLearningEngine } from '../learning/engine';

export const learningRouter = Router();

const RecommendSchema = z.object({
  swarm_id: z.string().uuid(),
  task: z.string().min(1),
  limit: z.number().int().min(1).max(10).optional(),
});

learningRouter.post('/recommend', async (req: Request, res: Response) => {
  const parsed = RecommendSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'invalid_request', details: parsed.error.flatten() });
    return;
  }

  const { swarm_id, task, limit } = parsed.data;
  const engine = getLearningEngine();
  const similar = await engine.findSimilarTrajectories(swarm_id, task, limit ?? 5, true);
  const recommendation = similar[0] ?? null;

  res.json({ recommendation, similar });
});
