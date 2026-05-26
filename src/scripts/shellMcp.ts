import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

const server = new Server(
  {
    name: 'shell-server',
    version: '1.0.0',
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: 'execute_command',
        description: 'Execute a bash/shell command. Returns stdout and stderr.',
        inputSchema: {
          type: 'object',
          properties: {
            command: { type: 'string', description: 'The exact command to run (e.g., "npm install", "mkdir test")' },
            cwd: { type: 'string', description: 'Optional current working directory to run the command in' }
          },
          required: ['command'],
        },
      },
    ],
  };
});

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  if (request.params.name === 'execute_command') {
    const args = request.params.arguments as any;
    const command = args.command;
    const cwd = args.cwd || process.cwd();

    try {
      const { stdout, stderr } = await execAsync(command, { cwd });
      return {
        content: [
          {
            type: 'text',
            text: `STDOUT:\n${stdout}\n\nSTDERR:\n${stderr}`,
          },
        ],
      };
    } catch (err: any) {
      return {
        content: [
          {
            type: 'text',
            text: `Command failed: ${err.message}\n\nSTDOUT:\n${err.stdout || ''}\n\nSTDERR:\n${err.stderr || ''}`,
          },
        ],
        isError: true,
      };
    }
  }
  throw new Error(`Tool not found: ${request.params.name}`);
});

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('Shell MCP Server running on stdio');
}

main().catch((err) => {
  console.error('Fatal error in shell MCP server:', err);
  process.exit(1);
});
