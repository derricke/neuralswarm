# Environment Variables Guide

NeuralSwarm is configured via environment variables. You can set them in a `.env` file in the root directory or directly in your shell/container.

## Required

At least one LLM provider API key must be configured:

### `ANTHROPIC_API_KEY`
- Enables Claude models via Anthropic API
- Get it from: https://console.anthropic.com/
- Format: `sk-ant-...` (long alphanumeric string)
- Models available: `claude-3-5-sonnet`, `claude-3-haiku`, etc.

### `OPENAI_API_KEY`
- Enables GPT models via OpenAI API
- Get it from: https://platform.openai.com/api-keys
- Format: `sk-...` (long alphanumeric string)
- Models available: `gpt-4o`, `gpt-4-turbo`, `gpt-3.5-turbo`

### `GOOGLE_API_KEY`
- Enables Gemini models via Google AI API
- Get it from: https://ai.google.dev/
- Format: Long alphanumeric string
- Models available: `gemini-2.0-flash`, `gemini-1.5-pro`

### `OLLAMA_HOST`
- Enables local models via Ollama
- Default: `http://localhost:11434` (no API key needed)
- Format: `http://host:port`
- Requires: Ollama running locally with models pulled (e.g., `ollama run llama2`)

## Optional

### `PORT`
- Backend server port
- Default: `3000`
- Type: integer
- Example: `3001`

### `DATABASE_URL`
- SQLite database file path
- Default: `./data/neuralswarm.db` (created automatically)
- Type: string (file path)
- Blank/whitespace values are treated as unset and fall back to `./data/neuralswarm.db`
- Special values: `:memory:` for in-memory (testing only)
- Example: `/var/data/swarm.db` or `:memory:`

### `NODE_ENV`
- Environment mode
- Default: `development`
- Valid values: `development`, `production`
- Effect in production: disables pretty-printed logs

### `NEXT_PUBLIC_API_BASE_URL`
- Backend URL for frontend dashboard
- Default: `http://localhost:3000`
- Type: string (full URL)
- Example: `https://api.myapp.com` (for production deployment)
- Note: Set this in the root `.env` file; the frontend reads it from there

### `NEXT_PUBLIC_API_KEY`
- API key used by the frontend to call protected backend endpoints
- Default: empty (protected endpoints will return unauthorized)
- Type: string
- Example: `your-generated-api-key`
- Note: This value is exposed to the browser because it is `NEXT_PUBLIC_*`; use only for local/dev setups
- Runtime behavior: The frontend prefers a browser-stored key (`localStorage`) over this env var
- Recovery behavior: On `401` + `Invalid or expired API key`, the frontend clears the stored key and retries once

## Setup Examples

### Local Development (with Anthropic)

```bash
cp .env.example .env
# Edit .env:
ANTHROPIC_API_KEY=sk-ant-your-key-here
PORT=3000
NODE_ENV=development
```

Then run:

```bash
npm run dev
# In another terminal:
npm --prefix web run dev
```

### Local Development (with Ollama)

```bash
# Install Ollama from https://ollama.ai
# Pull a model:
ollama pull llama2

# Set env:
export OLLAMA_HOST=http://localhost:11434
export PORT=3000

npm run dev
```

### Production Deployment

```bash
# Build
npm run build
npm --prefix web run build

# Start
PORT=8080 \
  ANTHROPIC_API_KEY=sk-ant-prod-key \
  NODE_ENV=production \
  DATABASE_URL=/data/swarm.db \
  node dist/index.js
```

### Docker

```bash
docker run -e ANTHROPIC_API_KEY=sk-ant-... \
           -e PORT=3000 \
           -e NODE_ENV=production \
           -v swarm-data:/data \
           -p 3000:3000 \
           neuralswarm
```

## Security Notes

1. **Never commit `.env` files to Git** — use `.env.example` as a template
2. **Rotate API keys regularly** — treat them like passwords
3. **Use different keys per environment** — dev, staging, production
4. **Limit key permissions** — API providers allow scoping API keys to specific models/permissions
5. **Monitor usage** — set up billing alerts in your API provider console
6. **Logs sanitize keys** — but still be careful with `DEBUG=*` or verbose logging

## Verification

To verify your environment is set up correctly:

```bash
# Check if a key is loaded
echo $ANTHROPIC_API_KEY

# Test the backend
curl http://localhost:3000/health

# Check metrics
curl http://localhost:3000/metrics
```

## Troubleshooting

### "API key not found" error

- Check that the env var is set: `echo $ANTHROPIC_API_KEY`
- Make sure it's in the `.env` file if using it
- Restart the app after setting env vars

### "Invalid or expired API key" from frontend

- Generate a fresh backend key: `npm run api-key:create -- --name frontend-dev`
- Paste the returned `key` into the API key field in the web UI
- If `DATABASE_URL` is blank in `.env.local`, backend now falls back to `./data/neuralswarm.db`; restart backend if needed

### "Failed to create message" (Anthropic)

- Verify the key is valid and not expired
- Check usage/billing on https://console.anthropic.com/
- Ensure the model name is correct (`claude-3-5-sonnet`)

### "Connection refused" (OpenAI/Google)

- Check internet connectivity
- Verify the API endpoint is correct (shouldn't need to change)
- Check if the API service is up (visit their status page)

### "OLLAMA_HOST connection refused"

- Ensure Ollama is running: `ollama serve`
- Check the host:port is correct (default `http://localhost:11434`)
- Verify the model is pulled: `ollama list`

### SQLite "database is locked"

- Multiple processes accessing the same `.db` file
- Delete WAL files: `rm -f data/swarm.db-wal data/swarm.db-shm`
- Use `:memory:` for testing (each test gets a fresh DB)

## Reference

For more on the env setup, see:

- Backend setup: [README.md](./README.md#configuration)
- API documentation: [README.md](./README.md#api-reference)
- Product architecture: [product_docs/ARCHITECTURE.md](./product_docs/ARCHITECTURE.md)
