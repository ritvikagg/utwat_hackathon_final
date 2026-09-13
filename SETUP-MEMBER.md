# hivemind — Joining an existing hub

Someone on your team is already hosting a shared hivemind hub. You have two options — pick based on whether you want to use your own local model or just use the dashboard.

See `PROJECT_OVERVIEW.md` for what hivemind actually does and how it works. This file is just the setup steps.

## Option A: No install — just use the dashboard

1. Open the URL your host gave you in a browser.
2. Sign up with your email, then join their group (search for the team name, or ask them what it's called).
3. Use the "Run a task" form right there in the browser. That's it — no local setup at all.

This is the fastest way to participate, but tasks run using the *host's* configured brain (their Claude key or their local model), not yours.

## Option B: Run tasks from your own terminal (your own local model or Claude key)

Do this if you want to use your own LM Studio model, your own Claude key, or just prefer the CLI.

### 1. Prerequisites

- Node.js 18+ (`node -v` to check)
- Either an [Anthropic API key](https://console.anthropic.com) **or** [LM Studio](https://lmstudio.ai) running locally with a tool-calling-capable model loaded

### 2. Install

```bash
npm install
```

### 3. Get your API token

Open the host's URL in a browser, sign up (or log in), and join the team's group. Click the gear icon (top right) → **Copy API token**.

### 4. Configure

```bash
cp .env.example .env
```

Fill in:
- `STEEL_API_KEY` — ask your host for the team's shared Steel key (same key everyone uses — it's tied to the account, not any one machine)
- `HIVEMIND_HUB_URL` — the URL your host gave you
- `HIVEMIND_API_TOKEN` — the token you copied in step 3
- `LLM_PROVIDER=anthropic` + `ANTHROPIC_API_KEY`, **or** `LLM_PROVIDER=local` + `LOCAL_LLM_BASE_URL`/`LOCAL_LLM_MODEL` (point this at your own LM Studio, running on your own machine)

### 5. Verify before running anything real

```bash
npm run smoke          # confirms your Steel connection works
npm run smoke:local    # only if using a local model — confirms tool-calling works
```

### 6. Run a task

```bash
npm run task -- "https://example.com" "click the Learn more link"
```

If someone else already solved this exact task, you'll see `llmCalls: 0` and it'll finish in about a second — that's the shared library working. Once you're set up, you'll also show up live in the dashboard's top bar for the whole team to see (green dot = online, spinner = task running).
