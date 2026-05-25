import { initDb, getDb, resetDb } from '../lib/db';
import { createRole } from '../roles/roleManager';
import { spawnAgent } from '../agents/spawner';
import { config } from 'dotenv';
config();

async function main() {
  initDb();
  const db = getDb();

  // Create a mock swarm
  db.prepare(`INSERT OR IGNORE INTO swarms (id, name) VALUES ('test-swarm', 'Test Swarm')`).run();

  // Create a job with MCP
  const job = await createRole('test-swarm', {
    title: 'MCP Tester',
    provider: 'anthropic',
    model: 'claude-3-5-sonnet-latest',
    system_prompt: 'You are an agent with access to the local filesystem. Read the package.json file and tell me the name of the project.',
    mcpServers: [
      {
        name: 'filesystem',
        command: 'npx',
        args: ['-y', '@modelcontextprotocol/server-filesystem', './']
      }
    ]
  });

  console.log('Spawning agent...');
  try {
    const result = await spawnAgent('Please read the package.json and tell me the name of the project.', {
      provider: job.provider as any,
      model: job.model,
      systemPrompt: job.system_prompt,
      mcpServers: job.mcpServers
    });

    console.log('Agent Output:', result.output);
  } catch (err) {
    console.error('Agent failed:', err);
  }

  resetDb();
}

main().catch(console.error);
