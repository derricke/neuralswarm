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
  const requestedLimit = limit ?? 5;
  
  // Fetch extra trajectories to ensure we can find enough unique models
  const similarRaw = await engine.findSimilarTrajectories(swarm_id, task, requestedLimit * 4, true);
  
  const similar = [];
  const seenModels = new Set<string>();
  
  for (const entry of similarRaw) {
    const key = `${entry.provider}-${entry.model}`;
    if (!seenModels.has(key)) {
      seenModels.add(key);
      similar.push(entry);
    }
  }

  const similarSliced = similar.slice(0, requestedLimit);
  const recommendation = similarSliced[0] ?? null;

  res.json({ recommendation, similar: similarSliced });
});
