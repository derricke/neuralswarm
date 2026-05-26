import { randomUUID } from 'crypto';
import { getDb } from '../lib/db';
import { logger } from '../lib/logger';
import { spawnAgent } from '../agents/spawner';
import { createRole } from '../roles/roleManager';
import type { AgentConfig, AgentProvider } from '../agents/types';
import { isProviderAvailable, resolveDefaultProviderModel } from '../agents/providerConfig';

export type DispatchResult =
  | { action: 'route'; jobId: string; complexity?: 'low' | 'high' }
  | { action: 'breakdown' }
  | { action: 'fallback' };

function getDispatcherConfig(): AgentConfig {
  if (process.env.COORDINATOR_PROVIDER && process.env.COORDINATOR_MODEL) {
    return {
      provider: process.env.COORDINATOR_PROVIDER as AgentProvider,
      model: process.env.COORDINATOR_MODEL,
      temperature: 0.1,
    };
  }

  const defaults = resolveDefaultProviderModel();
  return { provider: defaults.provider, model: defaults.model, temperature: 0.1 };
}

export async function dispatchTask(taskId: string): Promise<DispatchResult> {
  const db = getDb();
  
  const task = db.prepare('SELECT * FROM tasks WHERE id = ?').get(taskId) as any;
  if (!task) return { action: 'fallback' };
  
  // If task already has a required job, no need to dispatch
  if (task.required_job) return { action: 'fallback' };

  const allJobs = db.prepare(`
    SELECT
      sj.id,
      COALESCE(g.title, sj.title) as title,
      COALESCE(g.description, sj.description) as description,
      COALESCE(g.provider, sj.provider) as provider,
      COALESCE(g.model, sj.model) as model
    FROM swarm_jobs sj 
    LEFT JOIN global_jobs g ON g.id = sj.global_job_id 
    WHERE sj.swarm_id = ?
  `).all(task.swarm_id) as Array<{
    id: string;
    title: string;
    description: string;
    provider: AgentProvider;
    model: string;
  }>;

  const jobs = allJobs.filter((job) => isProviderAvailable(job.provider));

  const config = getDispatcherConfig();

  const allMcpServers = db.prepare('SELECT id, name, config FROM mcp_servers').all() as Array<{ id: string; name: string; config: string }>;

  const systemPrompt = `You are the AI Coordinator Dispatcher for a multi-agent system.
Your job is to analyze the incoming task and decide how to handle it. You MUST output your decision as a strict JSON object.

AVAILABLE JOBS IN THE SWARM:
${jobs.length === 0 ? "None" : jobs.map(j => `- ID: ${j.id}\n  Title: ${j.title}\n  Description: ${j.description || 'No description'}`).join('\n\n')}

AVAILABLE TOOLS (MCP SERVERS):
${allMcpServers.length === 0 ? "None" : allMcpServers.map(m => `- ID: ${m.id} (${m.name})\n  Config: ${m.config}`).join('\n')}

DECISION TYPES (Choose exactly one):

1. ROUTE: If the task perfectly matches one of the Available Jobs, route it to that job.
You MUST also grade the task's complexity ("low" or "high"). Mark it "low" if it is a simple script, basic text formatting, or straightforward query that can be safely executed by a cheap/fast model. Otherwise mark it "high".
{ "action": "route", "job_id": "<id>", "complexity": "low|high", "reasoning": "..." }

2. BREAKDOWN: If the task is too complex or requires multiple steps/skills that should be done concurrently or sequentially by different agents, break it down.
{ "action": "breakdown", "subtasks": ["subtask 1 description", "subtask 2 description"] }

3. HIRE: If the task requires a single specific capability that does NOT exist in the Available Jobs, create a new job profile to hire a new agent.
If the agent needs to execute commands, read files, or interact with systems, you MUST assign it the relevant tool IDs from the AVAILABLE TOOLS list.
IMPORTANT: The \`system_prompt\` MUST explicitly instruct the agent to execute its task autonomously using the provided tools. Tell the agent that it operates in a non-interactive environment, so it MUST NEVER ask questions or request user permission. It must make reasonable assumptions and execute immediately. Include relevant context from the MCP server configs (like allowed directory paths or shell commands) directly in the system_prompt so the agent knows its working directory and capabilities.
{ "action": "hire", "new_job_title": "<title>", "description": "<detailed role description>", "system_prompt": "<instructions for the agent>", "mcp_servers": ["<tool_id>"] }

Return ONLY the raw JSON object. Do not wrap in markdown tags like \`\`\`json.`;

  try {
    const result = await spawnAgent(task.description, {
      ...config,
      systemPrompt,
    });

    let decision: any;
    try {
      const cleanOutput = result.output.replace(/^```json/, '').replace(/```$/, '').trim();
      decision = JSON.parse(cleanOutput);
    } catch (parseError) {
      logger.error({ taskId, output: result.output, error: parseError }, 'dispatcher failed to parse json');
      return { action: 'fallback' };
    }

    logger.info({ taskId, action: decision.action }, 'dispatcher made a decision');

    if (decision.action === 'route' && decision.job_id) {
      db.prepare('UPDATE tasks SET required_job = ?, complexity = COALESCE(?, complexity), updated_at = unixepoch() WHERE id = ?').run(decision.job_id, decision.complexity || 'high', taskId);
      return { action: 'route', jobId: decision.job_id, complexity: decision.complexity };
    } 
    
    if (decision.action === 'breakdown' && Array.isArray(decision.subtasks) && decision.subtasks.length > 0) {
      const insert = db.prepare('INSERT INTO tasks (id, swarm_id, parent_id, description) VALUES (?, ?, ?, ?)');
      db.transaction(() => {
        for (const sub of decision.subtasks) {
          insert.run(randomUUID(), task.swarm_id, taskId, String(sub));
        }
        db.prepare("UPDATE tasks SET status = 'cancelled', result = 'Broken down into subtasks by Coordinator', updated_at = unixepoch() WHERE id = ?").run(taskId);
      })();
      return { action: 'breakdown' };
    }
    
    if (decision.action === 'hire' && decision.new_job_title && decision.system_prompt) {
      const mcpServers = Array.isArray(decision.mcp_servers) ? decision.mcp_servers : [];

      const newJob = await createRole(task.swarm_id, {
        title: decision.new_job_title,
        description: decision.description || decision.new_job_title,
        provider: config.provider,
        model: config.model,
        system_prompt: decision.system_prompt,
        mcpServers: mcpServers as any
      });

      const hiredAgentId = randomUUID();
      db.prepare(
        `INSERT INTO agents (id, swarm_id, provider, model, job_id) VALUES (?, ?, ?, ?, ?)`
      ).run(hiredAgentId, task.swarm_id, newJob.provider, newJob.model, newJob.id);

      logger.info(
        {
          taskId,
          roleId: newJob.id,
          agentId: hiredAgentId,
          provider: newJob.provider,
          model: newJob.model,
        },
        'dispatcher auto-hired agent for new role'
      );
      
      db.prepare('UPDATE tasks SET required_job = ?, updated_at = unixepoch() WHERE id = ?').run(newJob.id, taskId);
      return { action: 'route', jobId: newJob.id };
    }

    return { action: 'fallback' };
  } catch (err) {
    logger.error({ taskId, error: err }, 'dispatcher failed');
    return { action: 'fallback' };
  }
}
