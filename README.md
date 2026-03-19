# openclaw-plugin-crystallization

**The final gate -- growth vectors become permanent character traits.**

This is the endpoint of the meta-cognitive loop. The stability plugin observes your agent's behavior and records growth vectors when the agent resolves tensions in principled ways. Those vectors accumulate over days and weeks. But accumulation isn't identity -- a stack of observations is just a log. This plugin takes growth vectors that have proven themselves over time, checks them against the agent's principles, asks the human for approval, and writes the result into `character-traits.json` as a permanent part of who the agent is.

## What This Actually Does

Most agent systems can learn from interactions, but what they learn stays in a log or a vector store. The agent's actual character never changes. Growth vectors pile up, reflections get recorded, but the agent doesn't *become* anything different. It just accumulates observations about itself.

The crystallization plugin closes that gap. When a behavioral pattern has been consistent for long enough, aligns with the agent's defined principles, and gets explicit human approval, it stops being an observation and becomes a trait. The agent doesn't just know it tends toward directness -- directness becomes part of its permanent character definition.

This matters for long-running agents. Without crystallization, an agent that's been running for six months has the same character definition as one that started yesterday. All that accumulated experience sits in logs that may or may not get surfaced. With crystallization, the agent's identity document grows based on demonstrated behavior.

## How It Works

Crystallization uses a three-gate conjunction model. All three gates must pass before anything changes permanently. No shortcuts.

### Gate 1: Time

Growth vectors must be at least N days old before they're eligible for crystallization (default: 30 days / 2,592,000,000ms). A pattern that showed up last week could be noise -- a reaction to a specific project, a temporary shift in conversational tone. Thirty days of consistent behavior is signal.

The scanner (`lib/scanner.js`) filters vectors by creation date, skips anything already pending review or previously approved, and ignores unresolved vectors. Only vectors that have survived long enough make it past this gate.

### Gate 2: Principle Alignment

The pattern must align with one or more of the agent's defined principles. By default, these are `courage`, `word`, and `brand` (from the Code of the West), but you configure whatever principles your agent operates under.

The plugin sends each candidate vector to the LLM (via Ollama) with a classification prompt: *which principle does this align with?* The LLM returns a principle, confidence score, and rationale for each vector. The plugin then finds the dominant principle -- the one most vectors cluster around -- and filters to only vectors aligned with that principle.

If fewer than `minVectors` (default: 3) vectors align with any single principle, crystallization doesn't proceed. Scattered alignment across multiple principles means the pattern isn't coherent enough yet.

### Gate 3: Human Review

The agent proposes the trait to the user and waits for approval. No trait becomes permanent without a human saying yes.

This is the gate that prevents the system from drifting in ways the user doesn't want. The agent might have a consistent pattern of being blunt in code reviews, and it might align with a "directness" principle, but maybe the user doesn't want that crystallized. The human gets final say.

## The Approval Flow

When all time and alignment gates pass, the plugin synthesizes a single first-person trait statement from the aligned vectors and sends it to the user:

```
I've noticed a pattern emerging from our conversations:

**I default to concrete examples over abstract explanations when
helping debug issues.**

This aligns with **groundedness** and I've demonstrated it 4 times.

Should this become part of my permanent character?
- Reply **yes** to crystallize
- Reply **no** to leave as-is
- Reply **edit: ...** to modify first
```

The user has three options:

- **"yes"** (or "approve" / "crystallize") -- the trait is written to `character-traits.json` with a full provenance record: which vectors it came from, which principle it aligns with, when it was approved, and by whom.
- **"no"** (or "reject" / "skip") -- the vectors are marked `rejected_crystallization`. They remain in the growth vectors file but won't be proposed again.
- **"edit: [revised trait text]"** -- the proposed trait text is updated with the user's revision and stays in `pending_review` status for a subsequent yes/no decision.

If the user doesn't respond within `approvalTimeoutDays` (default: 7), the proposal expires.

The approval detection runs on the `agent_end` hook, so it picks up the user's response naturally during normal conversation -- no special command interface needed.

## Installation

```bash
openclaw plugins install openclaw-plugin-crystallization
```

Or from source:

```bash
git clone https://github.com/CoderofTheWest/openclaw-plugin-crystallization.git
openclaw plugins install ./openclaw-plugin-crystallization
```

Then restart your OpenClaw gateway.

This plugin depends on **openclaw-plugin-nightshift** (for scheduling crystallization scans) and **openclaw-plugin-stability** (for reading growth vectors). Install those first if you haven't already.

## Configuration Reference


### Local Configuration Overrides

For private or deployment-specific settings, create a `config.local.json` in the plugin directory. This file is git-ignored and overlays values from `config.default.json` without modifying tracked files.

```bash
cp config.local.example.json config.local.json
# Edit config.local.json with your overrides
```

The merge order is: `config.default.json` → `config.local.json` → `openclaw.json` plugin config. Later sources override earlier ones.

Override any defaults in your `openclaw.json` plugin config:

```json
{
  "plugins": {
    "crystallization": {
      "gates": {
        "minAge": 2592000000,
        "principles": ["courage", "word", "brand"]
      },
      "crystallization": {
        "minVectors": 3
      }
    }
  }
}
```

### Gates

| Setting | Default | What It Does |
|---|---|---|
| `minAge` | `2592000000` (30 days) | Minimum age in ms before a growth vector is eligible |
| `principles` | `["courage", "word", "brand"]` | Principles the LLM classifies vectors against |
| `patterns` | `["directness", "honesty", "reflection", "curiosity", "groundedness"]` | Candidate behavioral patterns for trait synthesis |

### Crystallization

| Setting | Default | What It Does |
|---|---|---|
| `minVectors` | `3` | Minimum aligned vectors needed to propose a trait |
| `maxPending` | `5` | Maximum proposals awaiting review before new scans stop |
| `approvalTimeoutDays` | `7` | Days before an unanswered proposal expires |

### Output

| Setting | Default | What It Does |
|---|---|---|
| `traitsPath` | `null` | Path to `character-traits.json`. Resolves at runtime from workspace metadata |
| `vectorsPath` | `null` | Path to growth vectors file. Resolves at runtime from workspace metadata |

### Prompts

| Setting | Default | What It Does |
|---|---|---|
| `approvalRequest` | *(see config.default.json)* | Template for the approval message sent to the user. Supports `{trait}`, `{principle}`, and `{count}` placeholders |

### Ollama

| Setting | Default | What It Does |
|---|---|---|
| `url` | `http://localhost:11434/api/generate` | Ollama API endpoint |
| `model` | `llama3.1` | Model used for principle alignment and trait synthesis |
| `temperature` | `0.2` | Low temperature for consistent classification |

## Enterprise Notes

Crystallization can be disabled after your agent's training period. Once the traits you want are written to `character-traits.json`, the file persists independently of the plugin. You can run crystallization during a calibration phase, build out the agent's character, then turn it off for production deployment. The crystallized traits stay.

## Part of the Meta-Cognitive Suite

This plugin is one piece of a six-plugin architecture for agent self-awareness:

1. [openclaw-plugin-stability](https://github.com/CoderofTheWest/openclaw-plugin-stability) -- Entropy monitoring, drift detection, growth vectors
2. [openclaw-plugin-continuity](https://github.com/CoderofTheWest/openclaw-plugin-continuity) -- Cross-session memory, semantic search, context budgeting
3. [openclaw-plugin-metabolism](https://github.com/CoderofTheWest/openclaw-plugin-metabolism) -- Autonomous learning from high-entropy conversations
4. [openclaw-plugin-nightshift](https://github.com/CoderofTheWest/openclaw-plugin-nightshift) -- Off-hours task scheduling for heavy LLM work
5. [openclaw-plugin-contemplation](https://github.com/CoderofTheWest/openclaw-plugin-contemplation) -- Self-directed inquiry over time
6. [openclaw-plugin-crystallization](https://github.com/CoderofTheWest/openclaw-plugin-crystallization) -- Trait formation from growth vectors *(this plugin)*

See [openclaw-metacognitive-suite](https://github.com/CoderofTheWest/openclaw-metacognitive-suite) for the full picture.

## Changelog & Growth Feed

When a trait is approved and crystallized, two additional outputs are generated:

### Changelog

Each crystallized trait is appended to a markdown changelog file. The changelog provides a human-readable history of character evolution over time.

| Setting | Default | What It Does |
|---|---|---|
| `output_changelog.changelogPath` | `"../../workspace/memory/soul/changelog.md"` | Path to changelog file (relative to plugin dir) |

Entry format:
```markdown
### 2026-03-13 — directness
- **Trait:** I default to concrete examples over abstract explanations.
- **Principle:** groundedness
- **Sources:** 4 growth vectors
- **Approved by:** user
```

### Growth Feed (Telegram Notification)

Optionally notify a Telegram topic when a new trait crystallizes. Useful for tracking character growth in a dedicated channel.

| Setting | Default | What It Does |
|---|---|---|
| `output_changelog.growthFeed.enabled` | `false` | Enable Telegram notifications |
| `output_changelog.growthFeed.chatId` | `""` | Telegram chat ID for notifications |
| `output_changelog.growthFeed.threadId` | `""` | Telegram thread/topic ID (optional) |

Requires `TELEGRAM_BOT_TOKEN` environment variable.

## Cron Integration

The following crons complement the crystallization pipeline:

| Cron | Schedule | Purpose |
|---|---|---|
| `metacog-monday-review` | Mon 09:30 CET | Reviews crystallization candidates with approval buttons |
| `metacog-weekly-growth-check` | Fri 18:00 CET | Checks if new growth vectors were created |
| `metacog-monthly-calibration` | 1st Mon/month 10:00 CET | Chain-wide calibration reminder |

## License

MIT
