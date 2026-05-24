import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { logger } from '../lib/logger';

export type McpServerConfig = {
  name: string;
  command: string;
  args: string[];
};

export type McpClientMap = Record<string, Client>;

export async function connectMcpServers(servers: McpServerConfig[]): Promise<McpClientMap> {
  const clients: McpClientMap = {};

  for (const server of servers) {
    try {
      const transport = new StdioClientTransport({
        command: server.command,
        args: server.args,
      });

      const client = new Client(
        {
          name: `neuralswarm-agent`,
          version: '1.0.0',
        },
        {
          capabilities: {},
        }
      );

      await client.connect(transport);
      clients[server.name] = client;
      logger.info({ server: server.name }, 'Connected to MCP server');
    } catch (err) {
      logger.error({ server: server.name, error: err }, 'Failed to connect to MCP server');
    }
  }

  return clients;
}

export async function getMcpTools(clients: McpClientMap): Promise<any[]> {
  const allTools: any[] = [];

  for (const [serverName, client] of Object.entries(clients)) {
    try {
      const result = await client.listTools();
      for (const tool of result.tools) {
        // We namespace the tool name with the server name to avoid collisions
        // Format: serverName__toolName
        const namespacedName = `${serverName}__${tool.name}`;
        allTools.push({
          name: namespacedName,
          description: tool.description ?? '',
          input_schema: tool.inputSchema,
        });
      }
    } catch (err) {
      logger.error({ server: serverName, error: err }, 'Failed to list tools from MCP server');
    }
  }

  return allTools;
}

export async function executeMcpTool(
  clients: McpClientMap,
  namespacedName: string,
  args: any
): Promise<any> {
  const [serverName, ...toolNameParts] = namespacedName.split('__');
  const toolName = toolNameParts.join('__');

  const client = clients[serverName];
  if (!client) {
    throw new Error(`MCP server not found: ${serverName}`);
  }

  try {
    const result = await client.callTool({
      name: toolName,
      arguments: args,
    });
    return result;
  } catch (err) {
    logger.error({ server: serverName, tool: toolName, error: err }, 'MCP tool execution failed');
    throw err;
  }
}

export async function disconnectMcpServers(clients: McpClientMap): Promise<void> {
  for (const [serverName, client] of Object.entries(clients)) {
    try {
      await client.close();
      logger.info({ server: serverName }, 'Disconnected MCP server');
    } catch (err) {
      logger.error({ server: serverName, error: err }, 'Failed to disconnect MCP server');
    }
  }
}
