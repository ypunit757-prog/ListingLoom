# ListingLoom

Writes Etsy and eBay listings (title, description, tags) and suggests a price after marketplace fees.
The writing is done by an open-weight model behind any OpenAI-compatible chat endpoint, such as Ollama
running Gemma. With no model configured, the app still works in a simpler template mode.

## Run locally

```bash
npm install
cp .env.example .env     # optional
ollama pull gemma3:1b    # optional, for real model output
LLM_BASE_URL=http://localhost:11434/v1 LLM_MODEL=gemma3:1b npm start
```

Open http://localhost:3000.

## Settings

| Variable | Purpose |
| --- | --- |
| `LLM_BASE_URL` | Chat endpoint ending in `/v1`. Empty means template mode. |
| `LLM_MODEL` | Model name, for example `gemma3:1b` |
| `LLM_API_KEY` | Only needed for hosted providers |
| `DATA_DIR` | Where `waitlist.jsonl` is written (default `./data`) |

## Deploy on Render

1. Push this folder to a GitHub repository.
2. In Render choose New, then Blueprint, and select the repository. `render.yaml` creates the web service.
3. Fill in the three `LLM_*` variables when prompted, using one of the options below.

**Option A: hosted open-weight model (works on the free plan).** Use any provider with an OpenAI-compatible
API that serves open models. Set `LLM_BASE_URL` to the provider's `/v1` URL, `LLM_MODEL` to the model name it
lists for Gemma or Llama, and `LLM_API_KEY` to your key.

**Option B: run Ollama on Render.** Add a private service from the `ollama/` folder:

```yaml
  - type: pserv
    name: listingloom-ollama
    runtime: docker
    dockerfilePath: ./ollama/Dockerfile
    dockerContext: ./ollama
    plan: standard        # gemma3:1b needs about 2 GB of RAM
    envVars:
      - key: MODEL
        value: gemma3:1b
    disk:
      name: models
      mountPath: /root/.ollama
      sizeGB: 10
```

Then set on the web service: `LLM_BASE_URL=http://listingloom-ollama:11434/v1` and `LLM_MODEL=gemma3:1b`.

## Notes

- Render's free plan has an ephemeral disk, so `waitlist.jsonl` resets on redeploy. Signups are also printed
  to the service logs. Attach a disk and set `DATA_DIR` to keep the file.
- Fee percentages live in the `FEES` table in `server.js`. Check them against current marketplace fees.
- `/api/generate` is limited to 20 requests per IP every 10 minutes.
