import { randomUUID } from 'crypto';
import { getDb } from '../lib/db';
import { logger } from '../lib/logger';
import { getLearningEngine } from '../learning/engine';
import type { AgentProvider } from '../agents/types';
import { isProviderAvailable, resolveDefaultProviderModel } from '../agents/providerConfig';
import type { FailurePattern } from '../agents/typeProfile';

type RoleRow = {
  id: string;
  swarm_id: string;
  global_role_id: string | null;
  title: string;
  description: string | null;
  required_capabilities: string;
  provider: string;
  model: string;
  system_prompt: string;
  mcp_servers: string | null;
  failure_patterns: string | null;
  tasks_assigned: number;
  tasks_completed: number;
  tasks_failed: number;
  created_at: number;
  updated_at: number;
};

export interface SwarmRole {
  id: string;
  swarm_id: string;
  global_role_id: string | null;
  global_job_id?: string | null;
  title: string;
  description?: string;
  required_capabilities: string[];
  provider: string;
  model: string;
  system_prompt: string;
  failure_patterns: FailurePattern[];
  mcpServers: Array<{ name: string; command: string; args: string[] }>;
  tasks_assigned: number;
  tasks_completed: number;
  tasks_failed: number;
  created_at: number;
  updated_at: number;
}

export interface GlobalRole {
  id: string;
  title: string;
  description?: string;
  required_capabilities: string[];
  provider: string;
  model: string;
  system_prompt: string;
  failure_patterns: FailurePattern[];
  mcpServers: Array<{ name: string; command: string; args: string[] }>;
  created_at: number;
  updated_at: number;
}

export interface CreateRoleInput {
  title: string;
  description?: string;
  required_capabilities?: string[];
  provider?: string;
  model?: string;
  system_prompt: string;
  recommendation_swarm_id?: string;
  mcpServers?: Array<{ name: string; command: string; args: string[] }>;
}

async function resolveRecommendedProviderModel(
  input: CreateRoleInput
): Promise<{ provider: string; model: string } | null> {
  const swarmId = input.recommendation_swarm_id?.trim();
  if (!swarmId) {
    return null;
  }

  const taskDescription = [input.title, input.description ?? '', input.system_prompt]
    .filter((value) => value.trim().length > 0)
    .join('\n\n');

  try {
    const rec = await getLearningEngine().recommendAgentProfile(swarmId, taskDescription);
    if (!rec) {
      return null;
    }

    if (!isProviderAvailable(rec.provider)) {
      logger.warn(
        { swarmId, provider: rec.provider },
        'recommended provider key not configured during role creation; using fallback'
      );
      return null;
    }

    logger.info(
      { swarmId, provider: rec.provider, model: rec.model, roleTitle: input.title },
      'using learning recommendation for role provider/model'
    );
    return rec;
  } catch (error) {
    logger.warn({ swarmId, error }, 'role recommendation failed; using fallback provider/model');
    return null;
  }
}

function baseRoleSelect(whereClause: string): string {
  return `
    SELECT
      sj.id,
      sj.swarm_id,
      COALESCE(sj.global_role_id, sj.global_job_id) AS global_role_id,
      COALESCE(g.title, sj.title) AS title,
      COALESCE(g.description, sj.description) AS description,
      COALESCE(g.required_capabilities, sj.required_capabilities) AS required_capabilities,
      COALESCE(g.provider, sj.provider) AS provider,
      COALESCE(g.model, sj.model) AS model,
      COALESCE(g.system_prompt, sj.system_prompt) AS system_prompt,
      COALESCE(g.mcp_servers, sj.mcp_servers) AS mcp_servers,
      COALESCE(g.failure_patterns, '[]') AS failure_patterns,
      sj.tasks_assigned,
      sj.tasks_completed,
      sj.tasks_failed,
      sj.created_at,
      sj.updated_at
    FROM swarm_jobs sj
    LEFT JOIN global_jobs g ON g.id = COALESCE(sj.global_role_id, sj.global_job_id)
    ${whereClause}
  `;
}

export async function createGlobalRole(input: CreateRoleInput): Promise<GlobalRole> {
  const db = getDb();
  const id = randomUUID();
  const now = Math.floor(Date.now() / 1000);
  const defaults = resolveDefaultProviderModel();
  const recommended = await resolveRecommendedProviderModel(input);
  const provider = input.provider?.trim() || recommended?.provider || defaults.provider;
  const model = input.model?.trim() || recommended?.model || defaults.model;

  db.prepare(
    `INSERT INTO global_jobs (
      id, title, description, required_capabilities,
      provider, model, system_prompt, mcp_servers, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    input.title,
    input.description || null,
    JSON.stringify(input.required_capabilities || []),
    provider,
    model,
    input.system_prompt,
    JSON.stringify(input.mcpServers || []),
    now,
    now
  );

  logger.info({ globalRoleId: id, title: input.title }, 'global role created');
  return getGlobalRoleById(id)!;
}

export function listGlobalRoles(): GlobalRole[] {
  const db = getDb();
  const rows = db.prepare('SELECT * FROM global_jobs ORDER BY created_at DESC').all() as any[];
  return rows.map((row) => ({
    id: row.id,
    title: row.title,
    description: row.description,
    required_capabilities: JSON.parse(row.required_capabilities || '[]'),
    provider: row.provider,
    model: row.model,
    system_prompt: row.system_prompt,
    failure_patterns: JSON.parse(row.failure_patterns || '[]'),
    mcpServers: JSON.parse(row.mcp_servers || '[]'),
    created_at: row.created_at,
    updated_at: row.updated_at,
  }));
}

export function getGlobalRoleById(globalRoleId: string): GlobalRole | null {
  const db = getDb();
  const row = db.prepare('SELECT * FROM global_jobs WHERE id = ?').get(globalRoleId) as any;
  if (!row) return null;

  return {
    id: row.id,
    title: row.title,
    description: row.description,
    required_capabilities: JSON.parse(row.required_capabilities || '[]'),
    provider: row.provider,
    model: row.model,
    system_prompt: row.system_prompt,
    failure_patterns: JSON.parse(row.failure_patterns || '[]'),
    mcpServers: JSON.parse(row.mcp_servers || '[]'),
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export async function assignGlobalRoleToSwarm(swarmId: string, globalRoleId: string): Promise<SwarmRole> {
  const db = getDb();
  const globalRole = getGlobalRoleById(globalRoleId);

  if (!globalRole) {
    throw new Error(`Global role not found: ${globalRoleId}`);
  }

  const existing = db
    .prepare(baseRoleSelect('WHERE sj.swarm_id = ? AND COALESCE(sj.global_role_id, sj.global_job_id) = ? LIMIT 1'))
    .get(swarmId, globalRoleId) as RoleRow | undefined;

  if (existing) {
    return parseRoleRow(existing);
  }

  const id = randomUUID();
  const now = Math.floor(Date.now() / 1000);
  db.prepare(
    `INSERT INTO swarm_jobs (
      id, swarm_id, global_job_id, global_role_id, title, description, required_capabilities,
      provider, model, system_prompt, mcp_servers, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    swarmId,
    globalRole.id,
    globalRole.id,
    globalRole.title,
    globalRole.description || null,
    JSON.stringify(globalRole.required_capabilities || []),
    globalRole.provider,
    globalRole.model,
    globalRole.system_prompt,
    JSON.stringify(globalRole.mcpServers || []),
    now,
    now
  );

  logger.info({ swarmId, globalRoleId, roleId: id }, 'global role assigned to swarm');
  return getRoleById(id)!;
}

export async function getOrCreateRole(swarmId: string, input: CreateRoleInput): Promise<SwarmRole> {
  const existing = getRoleByTitle(swarmId, input.title);
  if (existing) {
    return existing;
  }

  return createRole(swarmId, input);
}

export async function createRole(swarmId: string, input: CreateRoleInput): Promise<SwarmRole> {
  try {
    const global = await createGlobalRole(input);
    return assignGlobalRoleToSwarm(swarmId, global.id);
  } catch (err) {
    logger.error({ swarmId, input, error: err }, 'failed to create and assign global role');
    throw err;
  }
}

export function getRoleById(roleId: string): SwarmRole | null {
  const db = getDb();
  const stmt = db.prepare(baseRoleSelect('WHERE sj.id = ? LIMIT 1'));

  const row = stmt.get(roleId) as RoleRow | undefined;
  if (!row) return null;

  return parseRoleRow(row);
}

export function getRoleByTitle(swarmId: string, title: string): SwarmRole | null {
  const db = getDb();
  const stmt = db.prepare(
    baseRoleSelect('WHERE sj.swarm_id = ? AND (sj.title = ? OR g.title = ?) LIMIT 1')
  );

  const row = stmt.get(swarmId, title, title) as RoleRow | undefined;
  if (!row) return null;

  return parseRoleRow(row);
}

export function listRolesInSwarm(swarmId: string): SwarmRole[] {
  const db = getDb();
  const stmt = db.prepare(baseRoleSelect('WHERE sj.swarm_id = ? ORDER BY sj.created_at ASC'));

  const rows = stmt.all(swarmId) as RoleRow[];
  return rows.map(parseRoleRow);
}

export async function updateRoleSystemPrompt(roleId: string, systemPrompt: string): Promise<void> {
  const db = getDb();
  const now = Math.floor(Date.now() / 1000);
  const role = getRoleById(roleId);

  if (!role) {
    throw new Error('role_not_found');
  }

  try {
    if (role.global_role_id) {
      db.prepare('UPDATE global_jobs SET system_prompt = ?, updated_at = ? WHERE id = ?').run(
        systemPrompt,
        now,
        role.global_role_id
      );
      db.prepare('UPDATE swarm_jobs SET system_prompt = ?, updated_at = ? WHERE COALESCE(global_role_id, global_job_id) = ?').run(
        systemPrompt,
        now,
        role.global_role_id
      );
    } else {
      db.prepare('UPDATE swarm_jobs SET system_prompt = ?, updated_at = ? WHERE id = ?').run(
        systemPrompt,
        now,
        roleId
      );
    }

    logger.info({ roleId }, 'role system_prompt updated');
  } catch (err) {
    logger.error({ roleId, error: err }, 'failed to update role system_prompt');
    throw err;
  }
}

export async function deleteRole(roleId: string): Promise<void> {
  const db = getDb();

  const stmt = db.prepare(`
    DELETE FROM swarm_jobs WHERE id = ?
  `);

  try {
    stmt.run(roleId);
    logger.info({ roleId }, 'role deleted');
  } catch (err) {
    logger.error({ roleId, error: err }, 'failed to delete role');
    throw err;
  }
}

export function countAgentsForRole(roleId: string): number {
  const db = getDb();
  const stmt = db.prepare(`
    SELECT COUNT(*) as count FROM agents WHERE COALESCE(role_id, job_id) = ?
  `);

  const row = stmt.get(roleId) as any;
  return row?.count || 0;
}

export function listRolesWithAgentCounts(swarmId: string): (SwarmRole & { agents_count: number })[] {
  const roles = listRolesInSwarm(swarmId);
  return roles.map((role) => ({
    ...role,
    agents_count: countAgentsForRole(role.id),
  }));
}

function parseRoleRow(row: any): SwarmRole {
  return {
    id: row.id,
    swarm_id: row.swarm_id,
    global_role_id: row.global_role_id ?? null,
    global_job_id: row.global_role_id ?? null,
    title: row.title,
    description: row.description,
    required_capabilities: JSON.parse(row.required_capabilities || '[]'),
    provider: row.provider,
    model: row.model,
    system_prompt: row.system_prompt,
    failure_patterns: JSON.parse(row.failure_patterns || '[]'),
    mcpServers: JSON.parse(row.mcp_servers || '[]'),
    tasks_assigned: Number(row.tasks_assigned ?? 0),
    tasks_completed: Number(row.tasks_completed ?? 0),
    tasks_failed: Number(row.tasks_failed ?? 0),
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export async function updateGlobalRoleFailurePatterns(
  globalRoleId: string,
  taskType: string | undefined,
  error: string
): Promise<void> {
  const db = getDb();
  const globalRole = getGlobalRoleById(globalRoleId);
  if (!globalRole) return;

  const failurePatterns = globalRole.failure_patterns;
  const existingPattern = failurePatterns.find((p) => p.taskType === (taskType || 'unknown'));

  if (existingPattern) {
    existingPattern.count++;
  } else {
    failurePatterns.push({
      taskType: taskType || 'unknown',
      error: error.slice(0, 200),
      count: 1,
    });
  }

  db.prepare(
    'UPDATE global_jobs SET failure_patterns = ?, updated_at = unixepoch() WHERE id = ?'
  ).run(JSON.stringify(failurePatterns), globalRoleId);

  logger.debug({ globalRoleId, count: failurePatterns.length }, 'global role failure patterns updated');
}

// Backward-compatible aliases (jobs -> roles)
export type SwarmJob = SwarmRole;
export type GlobalJob = GlobalRole;
export type CreateJobInput = CreateRoleInput;

export const createGlobalJob = createGlobalRole;
export const listGlobalJobs = listGlobalRoles;
export const getGlobalJobById = getGlobalRoleById;
export const assignGlobalJobToSwarm = assignGlobalRoleToSwarm;
export const getOrCreateJob = getOrCreateRole;
export const createJob = createRole;
export const getJobById = getRoleById;
export const getJobByTitle = getRoleByTitle;
export const listJobsInSwarm = listRolesInSwarm;
export const updateJobSystemPrompt = updateRoleSystemPrompt;
export const deleteJob = deleteRole;
export const countAgentsForJob = countAgentsForRole;
export const listJobsWithAgentCounts = listRolesWithAgentCounts;
export const updateGlobalJobFailurePatterns = updateGlobalRoleFailurePatterns;
