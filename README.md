# NeuralSwarm

**Lightweight agent-agnostic multi-agent orchestration platform.**

NeuralSwarm is a Node.js service that orchestrates multiple LLM agents, routes tasks intelligently based on learned patterns, and monitors agent health in real-time. It's designed to be minimal, stateless, and production-ready.

## Key Features

- **Multi-provider support**: Anthropic (Claude), OpenAI (GPT), Google (Gemini), Ollama (local)
- **Health monitoring**: Automatic agent firing on failure thresholds + provider blacklisting
- **Learning engine**: HNSW-backed trajectory similarity search for intelligent routing
- **Task orchestration**: Parse plain text, TODO lists, or headings into tasks and queue them
- **Observability**: Structured logging, system metrics, trajectory tracking
- **Web dashboard**: Real-time swarm status, task submission, and recommendation insights
- **API-first**: REST endpoints for swarms, agents, tasks, memories, and learning

## Quick Start

### Prerequisites

- Node.js 18+
- npm 9+
- API keys for at least one LLM provider (or Ollama running locally)

### Installation

```bash
git clone <repo>
cd neuralswarm
npm install
npm --prefix web install
```

### Configuration

Create a `.env` file in the root directory:

```env
# Required: at least one API key
ANTHROPIC_API_KEY=sk-ant-...
OPENAI_API_KEY=sk-...
GOOGLE_API_KEY=...
OLLAMA_HOST=http://localhost:11434

# Optional
PORT=3000
DATABASE_URL=./data/neuralswarm.db  # Empty/blank also falls back to data/neuralswarm.db
NODE_ENV=development

# Frontend -> backend
NEXT_PUBLIC_API_BASE_URL=http://localhost:3000
# Optional fallback key for frontend requests. Can also be set at runtime in the UI.
NEXT_PUBLIC_API_KEY=
```

Alternatively, copy and modify `.env.example`:

```bash
cp .env.example .env
# Edit .env with your API keys
```

### Run Backend

```bash
npm run dev
# API running at http://localhost:3000
```

### Run Dashboard

In a separate terminal:

```bash
npm --prefix web run dev
# Dashboard at http://localhost:3001
```

### Create API Key For Protected Endpoints

Most endpoints (including `POST /swarms`) require a bearer token.

```bash
npm run api-key:create -- --name frontend-dev
```

Run this command on the backend host. Copy the returned `key` value and paste it into the API key field on the swarm create page. The web app stores it in browser local storage and uses it for subsequent requests.

## Architecture

### Backend (Node.js + Express)

- **Coordinator**: Poll-based task dispatcher; selects agents based on health + learning recommendations
- **Health Monitor**: Tracks per-agent metrics; fires agents on >50% failure rate, 3+ consecutive failures, or error patterns
- **Learning Engine**: HNSW-backed similarity search; recommends best provider/model for each task
- **Memory Store**: SQLite backend with WAL mode; stores trajectories, embeddings, and audit trails
- **Scheduler**: Background job for trajectory cleanup (archival >30d, deletion >90d)

### Frontend (Next.js + React)

- **Dashboard**: Server-rendered SSR page with live stats, agent fleet status, and learning recommendations
- **Swarm Create**: Client-side form for creating orchestration groups
- **Task Upload**: Client-side form for task batch submission (plain text, TODO, headings)

### Database (SQLite)

| Table | Purpose |
|-------|---------|
| `swarms` | Agent groups and coordination units |
| `agents` | LLM provider/model registrations with health scores |
| `tasks` | Work items with status and retry counts |
| `trajectories` | Step-by-step reasoning logs with embeddings |
| `provider_blacklist` | Temporary provider bans after firing |

## API Reference

### Health

**`GET /health`** — System status and uptime

```json
{ "status": "ok", "db": "ok", "uptime": 1234.56, "timestamp": "2026-05-17T..." }
```

### Swarms

**API keys are created only via backend command**: `npm run api-key:create -- --name <name> [--expires-in <seconds>]`

**`POST /swarms`** — Create a swarm

```json
{ "name": "Data Pipeline", "config": {} }
```

**`GET /swarms`** — List all swarms

**`GET /swarms/:id`** — Get swarm with full status (counts, agents, tasks)

### Tasks

**`POST /tasks`** — Queue tasks for a swarm

```json
{ "swarm_id": "uuid", "input": "Task 1\nTask 2\n..." }
```

**`GET /tasks`** — List tasks (optionally filter by `?swarm_id=...`)

**`GET /tasks/:id`** — Get task detail with trajectories and agent info

### Agents

**`POST /agents`** — Register an agent in a swarm

```json
{ "swarm_id": "uuid", "provider": "anthropic", "model": "claude-3-5-sonnet" }
```

**`GET /agents`** — List agents (optionally filter by `?swarm_id=...`)

**`GET /agents/:id`** — Get agent status and health score

**`POST /agents/tasks/:taskId/run`** — Execute a task immediately

### Learning

**`POST /learning/recommend`** — Get routing recommendation for a task

```json
{ "swarm_id": "uuid", "task": "description", "limit": 5 }
```

Returns: recommended provider/model + top similar trajectories

### Memories

**`GET /memories/trajectories/:id`** — Get trajectory by ID

**`GET /memories/swarms/:swarmId/trajectories`** — List trajectories for a swarm

**`POST /memories/cleanup`** — Trigger manual cleanup (archival + deletion)

### UI

**`POST /ui/upload`** — Parse and queue tasks from web form

```json
{ "swarm_id": "uuid", "input": "..." }
```

### Metrics

**`GET /metrics`** — System-wide performance metrics (JSON)

```json
{
  "timestamp": "...",
  "uptime": 1234.56,
  "swarms": { "total": 2, "by_status": {} },
  "agents": { "total": 4, "average_health_score": 0.85, "fired_total": 1 },
  "tasks": { "total": 10, "by_status": {}, "completion_rate": 80.0 },
  "trajectories": { "total": 8, "success_rate": 87.5 }
}
```

## Development

### Auth Notes (Frontend)

- The frontend API client resolves auth key in this order: browser local storage, then `NEXT_PUBLIC_API_KEY`.
- On `401` with `Invalid or expired API key`, the client clears the stored key and retries once with fallback configuration.
- If a request still fails, create a new key with `npm run api-key:create -- --name frontend-dev` and paste it in the UI.

### Project Structure

```
.
├── src/
│   ├── agents/              # LLM provider integrations
│   ├── coordinator/         # Task dispatch + health monitoring
│   ├── learning/            # HNSW + embeddings
│   ├── memory/              # SQLite storage layer
│   ├── routes/              # API endpoints
│   ├── lib/                 # Database, logger, parser, scheduler
│   ├── tests/               # Jest unit tests
│   └── types/               # TypeScript interfaces
├── web/                     # Next.js dashboard
│   ├── src/app/             # Pages + layout
│   ├── src/components/      # React components
│   └── src/lib/             # API client
├── package.json
├── .env.example
└── README.md
```

### Testing

```bash
# Run all tests
npm test

# Watch mode
npm test:watch

# Specific test
npm test -- src/tests/coordinator/healthMonitor.test.ts
```

Current coverage: **23 tests** across 5 suites (task parser, agent spawner, coordinator, memory, learning)

### Building

```bash
# Backend
npm run build        # Compile TypeScript to dist/
npm run typecheck    # Check types without emitting

# Frontend
npm --prefix web run build    # Next.js static + SSR build
npm --prefix web run typecheck
```

### Code Style

- **TypeScript** strict mode
- **Zod** for runtime validation
- **Pino** for structured logging
- **ESLint** via Next.js defaults
- **Jest** for testing with mocked dependencies

## Design Decisions

### Stateless Coordinator

The coordinator recovers task state from the database on restart. No in-memory queue means horizontal scaling is possible (future work).

### HNSW Over Vector Databases

Embedded HNSW (`hnswlib-node`) avoids operational overhead of Postgres/Pinecone. Trajectories are indexed in-memory on startup; suitable for MVP.

### SQLite Over Postgres

SQLite WAL mode + foreign keys provide ACID guarantees without operational complexity. Migrate to Postgres post-MVP if needed.

### Short-lived Agents

Each task spawn is a fresh LLM session. No persistent context = predictable memory usage + easier provider rotation.

### Health Signals

Multi-signal firing (failure rate, consecutive failures, error patterns) reduces false positives and catches nuanced degradation.

## Performance Targets

- Agent spawn: <5s
- Task assignment: <1s
- Learning recommendation: <500ms
- Healthy agent capacity: 5 concurrent + unlimited queue

## Deployment

### Local

```bash
npm run dev           # Backend
npm --prefix web run dev  # Frontend (separate terminal)
```

### Docker (Post-MVP)

See `Dockerfile` and `docker-compose.yml` for containerized deployment.

### Environment

- **Production**: Set `NODE_ENV=production` to disable pretty logging
- **Monitoring**: Scrape `/metrics` endpoint for Prometheus-compatible stats
- **Logging**: Structured JSON logs go to stdout; pipe to centralized logging as needed

## Roadmap

### Completed (MVP)

- ✓ Multi-provider agent spawning
- ✓ Health monitoring + provider blacklisting
- ✓ HNSW-backed learning engine
- ✓ REST API for all operations
- ✓ Web dashboard + forms
- ✓ Background cleanup scheduler
- ✓ Error handling + sanitization
- ✓ Unit tests (23 tests, 80%+ coverage)

### Next (Post-MVP)

- [ ] WebSocket support for real-time updates
- [ ] Prometheus metrics export
- [ ] Agent pre-training on domain tasks
- [ ] Advanced GOAP A* planning
- [ ] Multi-coordinator federation
- [ ] Git push-based task triggering
- [ ] Postgres migration path

## License

MIT + Commons Clause (source-available, non-commercial resale prohibited)

## Contributing

Issues and PRs welcome. Please follow TypeScript + Jest conventions.

## Support

- **Docs**: See `product_docs/` for architecture & decision records
- **Examples**: Run `npm run dev` and visit http://localhost:3001 for the dashboard
- **Issues**: Open a GitHub issue with reproduction steps
