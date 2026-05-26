import { Router, Request, Response } from 'express';
import { randomUUID } from 'crypto';
import { getDb } from '../lib/db';
import { logger } from '../lib/logger';

export const mcpServersRouter = Router();

mcpServersRouter.get('/', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const servers = db.prepare('SELECT * FROM mcp_servers ORDER BY created_at DESC').all();
    res.json({ servers: servers.map((s: any) => ({
      ...s,
      config: JSON.parse(s.config || '[]')
    })) });
  } catch (err) {
    logger.error({ error: err }, 'GET /mcp-servers failed');
    res.status(500).json({ error: 'Failed to fetch MCP servers' });
  }
});

mcpServersRouter.post('/', (req: Request, res: Response) => {
  try {
    const { name, config } = req.body;
    if (!name || !config) {
      return res.status(400).json({ error: 'name and config are required' });
    }

    const db = getDb();
    const id = randomUUID();
    const now = Math.floor(Date.now() / 1000);

    db.prepare(`
      INSERT INTO mcp_servers (id, name, config, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(
      id,
      name,
      JSON.stringify(config),
      now,
      now
    );

    const server = db.prepare('SELECT * FROM mcp_servers WHERE id = ?').get(id) as any;
    res.status(201).json({
      ...server,
      config: JSON.parse(server.config || '[]')
    });
  } catch (err) {
    logger.error({ error: err }, 'POST /mcp-servers failed');
    res.status(500).json({ error: 'Failed to create MCP server' });
  }
});

mcpServersRouter.put('/:id', (req: Request, res: Response) => {
  try {
    const { name, config } = req.body;
    if (!name || !config) {
      return res.status(400).json({ error: 'name and config are required' });
    }

    const db = getDb();
    const now = Math.floor(Date.now() / 1000);
    const id = req.params.id;

    const existing = db.prepare('SELECT id FROM mcp_servers WHERE id = ?').get(id);
    if (!existing) {
      return res.status(404).json({ error: 'MCP server not found' });
    }

    db.prepare(`
      UPDATE mcp_servers SET name = ?, config = ?, updated_at = ?
      WHERE id = ?
    `).run(
      name,
      JSON.stringify(config),
      now,
      id
    );

    const server = db.prepare('SELECT * FROM mcp_servers WHERE id = ?').get(id) as any;
    res.json({
      ...server,
      config: JSON.parse(server.config || '[]')
    });
  } catch (err) {
    logger.error({ error: err }, 'PUT /mcp-servers/:id failed');
    res.status(500).json({ error: 'Failed to update MCP server' });
  }
});

mcpServersRouter.delete('/:id', (req: Request, res: Response) => {
  try {
    const db = getDb();
    db.prepare('DELETE FROM mcp_servers WHERE id = ?').run(req.params.id);
    res.status(204).send();
  } catch (err) {
    logger.error({ error: err }, 'DELETE /mcp-servers failed');
    res.status(500).json({ error: 'Failed to delete MCP server' });
  }
});
