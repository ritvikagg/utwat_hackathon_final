# hivemind — Host setup

You're setting up the **shared hub** — the machine your teammates connect to. Everyone else just needs the `hivemind-member.zip` package and the URL/token you give them at the end of this guide.

See `PROJECT_OVERVIEW.md` for what hivemind actually does and how it works. This file is just the setup steps.

## 1. Prerequisites

- Node.js 18+ (`node -v` to check)
- A [Steel.dev](https://steel.dev) API key (free tier: 100 browser hours) — **this is the one key the whole team shares**, so grab it now if you don't have it: [app.steel.dev/settings/api-keys](https://app.steel.dev/settings/api-keys)
- Either an [Anthropic API key](https://console.anthropic.com) (recommended — more reliable) **or** [LM Studio](https://lmstudio.ai) running locally with a tool-calling-capable model loaded

## 2. Install

```bash
npm install
```

## 3. Configure

```bash
cp .env.example .env
```

Open `.env` and fill in:
- `STEEL_API_KEY` — your team's Steel key
- `LLM_PROVIDER=anthropic` + `ANTHROPIC_API_KEY`, **or** `LLM_PROVIDER=local` + `LOCAL_LLM_BASE_URL`/`LOCAL_LLM_MODEL`
- Leave `HIVEMIND_HUB_URL` and `HIVEMIND_API_TOKEN` **blank** — the hub itself never points at another hub.

## 4. Start the hub

```bash
npm run hub
```

Confirm it's up: open `http://localhost:4001` in a browser — you should see a login/signup screen.

## 5. Make it reachable by your team

The hub only listens on `localhost` by default — nobody outside your machine can reach it yet. Easiest fix, a free tunnel (no account needed):

```bash
brew install cloudflared          # macOS; see cloudflared docs for other OSes
cloudflared tunnel --url http://localhost:4001
```

It'll print a URL like `https://random-words-here.trycloudflare.com`. **That's the URL you give your whole team** — for both the dashboard and their `.env` files.

Two things worth knowing:
- This URL changes every time you restart the tunnel — don't restart it mid-demo.
- Your machine has to stay awake and connected the whole time this is running — it's not hosted anywhere else, it's your laptop.

## 6. Create your own account and group

Open the tunnel URL (or `http://localhost:4001` if you're testing locally first) in a browser:
1. Sign up with your email
2. Create a group (e.g. your team name) — everyone who joins this same group shares one library

## 7. Get your own API token (only if you also want to run tasks from your terminal)

Click the gear icon (top right) → **Copy API token**. Paste it into your own `.env` as `HIVEMIND_API_TOKEN`, then:

```bash
npm run task -- "https://example.com" "click the Learn more link"
```

## 8. Hand off to your team

Give everyone:
- The tunnel URL from step 5
- Your Steel API key (same one, shared — see the member package's setup guide for what they do with it)

They can either use the dashboard directly in a browser (no install needed) or run the member setup for CLI access with their own local model.
