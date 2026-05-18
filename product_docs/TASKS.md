# Build Plan

## Milestone 0: Foundations [CURRENT]
- [x] Confirm scope and acceptance criteria
- [x] Set up project structure and tooling
- [x] Add baseline docs (PRD, SPEC, ARCHITECTURE, etc.)
- [x] Locked MVP decisions (coordinator as Node.js service, full HNSW learning, short-lived agents)
- [ ] Set up TypeScript + Express boilerplate
- [ ] Add .env.example + .gitignore (ANTHROPIC_API_KEY, OPENAI_API_KEY, GOOGLE_API_KEY)
- [ ] Skeleton API routes (GET /health, POST /swarms, GET /swarms/:id)

## Milestone 1: Core Orchestration
- [ ] **Task Parser**
  - [ ] Plain text parser ("Task 1\nTask 2\n...")
  - [ ] TODO format parser ("- [ ] Task 1\n- [ ] Task 2")
  - [ ] Unit tests for both formats
  - [ ] (Git issues → backlog, post-MVP)

- [ ] **Agent Spawner** (Short-lived LLM sessions)
  - [ ] Support Claude (via Anthropic SDK)
  - [ ] Support GPT-4 (via OpenAI SDK)
  - [ ] Support Gemini (via Google SDK)
  - [ ] Support Ollama (local fallback)
  - [ ] Provider detection / round-robin routing
  - [ ] Session lifecycle (spawn → execute → cleanup, no persistent state)

- [ ] **Coordinator Service** (Node.js, code-based)
  - [ ] Read task queue logic
  - [ ] Distribute tasks to available workers (poll-based)
  - [ ] Monitor task status
  - [ ] Retry failed tasks (exponential backoff, max 3 attempts)
  - [ ] Report completion + store trajectories
  - [ ] Stateless design (recover on restart from DB)
  - [ ] **Health monitoring** (detect + fire underperforming agents)
    - [ ] Track per-agent metrics (tasks assigned, completed, failed, consecutive failures, error types)
    - [ ] Implement multi-signal firing logic (>50% failure rate, 3+ consecutive, error pattern)
    - [ ] Terminate underperforming agent
    - [ ] Blacklist provider for 30min (ProviderBlacklist table)
    - [ ] Spawn replacement worker on different provider
    - [ ] Log all firing events (reason, metrics, replacement info)
    - [ ] Real-time notification to user: "Agent X fired, replaced with Y"

- [ ] **Memory Store**
  - [ ] SQLite schema (Swarm, Agent, Task, Trajectory tables)
  - [ ] CRUD operations for all entities
  - [ ] Trajectory logging (store step-by-step reasoning)
  - [ ] Unit tests

- [ ] **End-to-end flow**service + 3 short-lived worker sessions
  - [ ] Coordinator polls task queue, assigns to available workers
  - [ ] Worker executes via LLM API → collects trajectory → POST /tasks/:id/complete
  - [ ] Coordinator retries failures (max 3 attempts with backoff)
  - [ ] All data (tasks, trajectories, embeddings)tor retries failures
  - [ ] All data flows to SQLite
 (HNSW + embeddings from day 1)
  - [ ] Vector embeddings for trajectories (OpenAI text-embedding-3-small)
  - [ ] HNSW index build + search
  - [ ] Pattern replay: on task start, inject similar successful trajectories into prompt
  - [ ] Auto-learn from all runs (validation via explicit tagging in v2)
  - [ ] Measure speedup on repeat runs (success metric: 20% fastersuccessful trajectories
  - [ ] Inject patterns into agent context
  - [ ] Measure speedup on repeat runs (success metric)
 (Next.js + polished dashboard)
  - [ ] Next.js app skeleton + layout
  - [ ] Real-time swarm dashboard (SSE or polling for live updates)
  - [ ] Task queue viewer with status badges
  - [ ] Worker/agent status + logs viewer
  - [ ] Task upload form (plain text paste + file drag-drop for .txt, .md
  - [ ] Task upload form (plain text, file, or paste)

- [ ] **API Completeness**
  - [ ] GET /swarms/:id (full status)
  - [ ] GET /tasks/:id (including trajectories)
  - [ ] POST /ui/upload (file parsing + task creation)
  - [ ] GET /metrics (prometheus-compatible)
  - [ ] Error handling + proper HTTP status codes

- [ ] **Testing**
  - [ ] Unit tests: Task Parser, Memory Store, Agent Spawner (80%+ coverage)
  - [ ] Integration tests: spawn → assign → complete → learn cycle
  - [ ] E2E test: submit task list, run swarm, verify learning speedup

## Milestone 3: Quality + Polish
  ## Milestone 2: Job System (Specialized Agent Roles)

  ### Phase 1: Job Definitions
  - [x] **Schema**
    - [x] Add swarm_jobs table (id, swarm_id, title, description, provider, model, system_prompt)
    - [x] Modify agents table: add job_id foreign key
    - [x] Modify tasks table: add optional required_job field
    - [x] Database migrations

  - [x] **Job Management API**
    - [x] POST /swarms/:id/jobs (define a job in swarm)
    - [x] GET /swarms/:id/jobs (list all jobs)
    - [x] DELETE /swarms/:id/jobs/:id (remove job)
    - [x] PUT /swarms/:id/jobs/:id (update job system_prompt)

  - [x] **Job Service**
    - [x] getOrCreateJob(swarmId, title)
    - [x] listJobsInSwarm(swarmId)
    - [x] updateJobSystemPrompt(jobId, systemPrompt)

  - [x] **Tests**
    - [x] Unit tests for Job service
    - [x] API integration tests

  ### Phase 2: Job-based Agent Routing (Explicit)
  - [x] **Explicit Routing**
    - [x] Add required_job to task submission
    - [x] routeTaskWithJob(task) → find idle agent with matching job_id
    - [x] Error on job not found or no agents available

  - [x] **Agent Hiring**
    - [x] POST /swarms/:id/agents (hire agent for specific job)
    - [x] List agents per job (GET /swarms/:id/jobs/:id/agents)

  - [x] **Coordinator Update**
    - [x] Load job-specific system_prompt when spawning
    - [x] Track job_id in trajectory logs

  - [x] **Tests**
    - [x] Unit tests: explicit routing logic
    - [x] Integration tests: task assignment to job

  ### Phase 3: Auto-pick Routing (Flexible)
  - [x] **Auto-routing Logic**
    - [x] Modify routeTask() to check if required_job is null
    - [x] If null: use learning engine recommendation + availability
    - [x] Fallback: pick any idle agent
    - [x] Prefer agents with higher success_rate

  - [x] **Learning Integration**
    - [x] Agent-type-memory recommends provider/model based on task description
    - [x] Find agent in swarm matching recommendation
    - [x] Update job performance metrics

  - [x] **Tests**
    - [x] Unit tests: auto-pick logic
    - [x] Integration tests: mixed explicit + auto workflows
    - [x] Learning tests: verify recommendations improve over time

  ## Milestone 3: Quality + Polish
- [ ] **Error Handling**
  - [x] Graceful degradation (o (exponential backoff, max 3 attempts)
  - [x] User-friendly error messages (no API keys in errors)

- [x] **Observability**
  - [x] Structured logging (Pino + JSON, NO API keys)
  - [x] Prometheus metrics (agent spawns, task completions, latencies, retry_rate, **agents_fired_total, provider_blacklist_events_total**)
  - [x] Agent health dashboard (real-time scores, firing events)
  - [x] Database size monitoring (alert >500MB)

- [ ] **Data Management**
  - [ ] Trajectory archival job (>30 days old → archive table)
  - [ ] Cleanup job (>90 days in archive → delete)

- [ ] **Documentation**
  - [ ] README: quickstart, architecture, example workflow
  - [ ] API documentation (OpenAPI/Swagger)
  - [ ] Environment variables guide (ANTHROPIC_API_KEY, OPENAI_API_KEY, etc.)
  - [ ] Docker setup instructions

- [ ] **Deployment**
  - [ ] Docker image with Node.js + SQLite
  - [ ] docker-compose.yml (SQLite, optional Postgres migration path
  - [ ] docker-compose.yml (optional: Postgres instead of SQLite)
  - [ ] CI/CD pipeline (lint, test, build)

## Milestone 4: Beta Release
- [ ] Performance tuning (agent spawn <5s, task assign <1s)
- [ ] Load testing (verify 5-agent capacity)
- [ ] Final acceptance test: submit 10-task list, 90%+ completion, 15%+ learning speedup
- [ ] Release notes + changelog
- [ ] Beta user feedback loop

## Backlog (Post-MVP)
- [ ] Multi-coordinator architecture (scale beyond 5 agents)
- [ ] Agent pre-training on domain tasks
- [ ] Git push-based task triggering
- [ ] Advanced GOAP A* planning
- [ ] Web UI theme customization
- [ ] Agent federation (Slack-like cross-machine comms)
