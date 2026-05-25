import { Router, Request, Response } from 'express';
import * as roleManager from '../roles/roleManager';
import { registerAgent } from '../coordinator';
import { getDb } from '../lib/db';
import { logger } from '../lib/logger';
import type { AgentProvider } from '../agents/types';
import { isAgentProvider } from '../agents/providerConfig';

const router = Router();

/**
 * GET /jobs
 * List all global jobs
 */
router.get(['/jobs', '/roles'], async (_req: Request, res: Response) => {
  try {
    const jobs = roleManager.listGlobalRoles();
    res.json({ jobs });
  } catch (err) {
    logger.error({ error: err }, 'GET /jobs failed');
    res.status(500).json({ error: 'Failed to list global jobs' });
  }
});

/**
 * POST /jobs
 * Create a global job
 */
router.post(['/jobs', '/roles'], async (req: Request, res: Response) => {
  try {
    const {
      title,
      description,
      required_capabilities,
      provider,
      model,
      system_prompt,
      recommendation_swarm_id,
    } = req.body;

    if (!title || !system_prompt) {
      return res.status(400).json({
        error: 'Missing required fields: title, system_prompt',
      });
    }

    const job = await roleManager.createGlobalRole({
      title,
      description,
      required_capabilities,
      provider,
      model,
      system_prompt,
      recommendation_swarm_id,
    });

    res.status(201).json(job);
  } catch (err) {
    logger.error({ error: err }, 'POST /jobs failed');
    res.status(500).json({ error: 'Failed to create global job' });
  }
});

/**
 * POST /swarms/:swarmId/agents
 * Hire an agent for a specific job
 */
router.post('/swarms/:swarmId/agents', async (req: Request, res: Response) => {
  try {
    const swarmId = String(req.params.swarmId);
    const jobId = String(req.body.role_id ?? req.body.job_id ?? '');

    if (!jobId) {
      return res.status(400).json({ error: 'Missing required field: job_id' });
    }

    const job = roleManager.getRoleById(jobId);
    if (!job || job.swarm_id !== swarmId) {
      return res.status(404).json({ error: 'Job not found' });
    }

    const provider = req.body.provider ?? job.provider;
    const model = req.body.model ?? job.model;

    if (!isAgentProvider(provider) || typeof model !== 'string' || model.length === 0) {
      return res.status(400).json({ error: 'Invalid provider/model' });
    }

    const agentId = registerAgent(swarmId, provider, model, job.id);

    const db = getDb();
    const agent = db.prepare('SELECT * FROM agents WHERE id = ?').get(agentId);
    return res.status(201).json(agent);
  } catch (err) {
    logger.error({ error: err }, 'POST /swarms/:id/agents failed');
    return res.status(500).json({ error: 'Failed to hire agent' });
  }
});

/**
 * POST /swarms/:id/jobs
 * Assign a global job to a swarm, or create+assign when global_job_id is omitted
 */
router.post(['/swarms/:swarmId/jobs', '/swarms/:swarmId/roles'], async (req: Request, res: Response) => {
  try {
    const swarmId = String(req.params.swarmId);
    const {
      global_role_id,
      global_job_id,
      title,
      description,
      required_capabilities,
      provider,
      model,
      system_prompt,
    } = req.body;
    const globalId = String(global_role_id ?? global_job_id ?? '');

    if (globalId) {
      const job = await roleManager.assignGlobalRoleToSwarm(swarmId, globalId);
      res.status(201).json(job);
      return;
    }

    if (!title || !system_prompt) {
      return res.status(400).json({
        error: 'Missing required fields: global_job_id or title, system_prompt',
      });
    }

    const job = await roleManager.createRole(swarmId, {
      title,
      description,
      required_capabilities,
      provider,
      model,
      system_prompt,
      recommendation_swarm_id: swarmId,
    });

    res.status(201).json(job);
  } catch (err) {
    logger.error({ error: err }, 'POST /swarms/:id/jobs failed');
    res.status(500).json({ error: 'Failed to assign job' });
  }
});

/**
 * GET /swarms/:id/jobs
 * List all jobs in a swarm
 */
router.get(['/swarms/:swarmId/jobs', '/swarms/:swarmId/roles'], async (req: Request, res: Response) => {
  try {
    const swarmId = String(req.params.swarmId);
    const jobs = roleManager.listRolesWithAgentCounts(swarmId);
    res.json({ jobs });
  } catch (err) {
    logger.error({ error: err }, 'GET /swarms/:id/jobs failed');
    res.status(500).json({ error: 'Failed to list jobs' });
  }
});

/**
 * GET /swarms/:swarmId/jobs/:jobId
 * Get a specific job
 */
router.get(['/swarms/:swarmId/jobs/:jobId', '/swarms/:swarmId/roles/:jobId'], async (req: Request, res: Response) => {
  try {
    const jobId = String(req.params.jobId);
    const job = roleManager.getRoleById(jobId);

    if (!job) {
      return res.status(404).json({ error: 'Job not found' });
    }

    const agentsCount = roleManager.countAgentsForRole(jobId);
    res.json({ ...job, agents_count: agentsCount });
  } catch (err) {
    logger.error({ error: err }, 'GET /swarms/:id/jobs/:id failed');
    res.status(500).json({ error: 'Failed to get job' });
  }
});

/**
 * GET /swarms/:swarmId/jobs/:jobId/agents
 * List agents hired for a specific job
 */
router.get(['/swarms/:swarmId/jobs/:jobId/agents', '/swarms/:swarmId/roles/:jobId/agents'], async (req: Request, res: Response) => {
  try {
    const swarmId = String(req.params.swarmId);
    const jobId = String(req.params.jobId);
    const db = getDb();

    const job = db
      .prepare('SELECT id FROM swarm_jobs WHERE id = ? AND swarm_id = ?')
      .get(jobId, swarmId);

    if (!job) {
      return res.status(404).json({ error: 'Job not found' });
    }

    const agents = db
      .prepare('SELECT * FROM agents WHERE swarm_id = ? AND COALESCE(role_id, job_id) = ? ORDER BY created_at DESC')
      .all(swarmId, jobId);

    return res.json({ agents });
  } catch (err) {
    logger.error({ error: err }, 'GET /swarms/:id/jobs/:id/agents failed');
    return res.status(500).json({ error: 'Failed to list job agents' });
  }
});

/**
 * PUT /swarms/:swarmId/jobs/:jobId
 * Update a job
 */
router.put(['/swarms/:swarmId/jobs/:jobId', '/swarms/:swarmId/roles/:jobId'], async (req: Request, res: Response) => {
  try {
    const jobId = String(req.params.jobId);
    const { system_prompt } = req.body;

    if (!system_prompt) {
      return res.status(400).json({ error: 'Missing required field: system_prompt' });
    }

    await roleManager.updateRoleSystemPrompt(jobId, system_prompt);
    const updatedJob = roleManager.getRoleById(jobId);

    res.json(updatedJob);
  } catch (err) {
    logger.error({ error: err }, 'PUT /swarms/:id/jobs/:id failed');
    res.status(500).json({ error: 'Failed to update job' });
  }
});

/**
 * DELETE /swarms/:swarmId/jobs/:jobId
 * Delete a job
 */
router.delete(['/swarms/:swarmId/jobs/:jobId', '/swarms/:swarmId/roles/:jobId'], async (req: Request, res: Response) => {
  try {
    const jobId = String(req.params.jobId);

    await roleManager.deleteRole(jobId);
    res.status(204).send();
  } catch (err) {
    logger.error({ error: err }, 'DELETE /swarms/:id/jobs/:id failed');
    res.status(500).json({ error: 'Failed to delete job' });
  }
});

export default router;
