import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

export type McpTool = {
  name: string;
  description?: string;
  inputSchema: any;
  _serverName: string;
};

export class McpManager {
  private clients: Map<string, Client> = new Map();
  private transports: Map<string, StdioClientTransport> = new Map();

  async connectAll(servers: Array<{name: string, command: string, args: string[]}>) {
    try {
      for (const s of servers) {
        const transport = new StdioClientTransport({
          command: s.command,
          args: s.args,
        });
        this.transports.set(s.name, transport);
        const client = new Client({ name: "neuralswarm", version: "1.0.0" }, { capabilities: {} });
        await client.connect(transport);
        this.clients.set(s.name, client);
      }
    } catch (e) {
      await this.disconnectAll();
      throw e;
    }
  }

  async listTools(): Promise<McpTool[]> {
    const allTools: McpTool[] = [];
    for (const [name, client] of this.clients.entries()) {
      const res = await client.listTools();
      for (const t of res.tools) {
        allTools.push({ ...t, _serverName: name });
      }
    }
    return allTools;
  }

  async callTool(serverName: string, toolName: string, args: any) {
    const client = this.clients.get(serverName);
    if (!client) throw new Error(`MCP server not found: ${serverName}`);
    return client.callTool({ name: toolName, arguments: args });
  }

  async disconnectAll() {
    for (const transport of this.transports.values()) {
      await transport.close();
    }
    this.clients.clear();
    this.transports.clear();
  }
}
