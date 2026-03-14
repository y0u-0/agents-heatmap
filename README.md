# agents-heatmap

GitHub-style activity heatmaps for AI coding agent token usage. Auto-detects **Claude Code**, **Codex CLI**, **Cursor**, and **OpenCode** from local data.

## Quick Start

```bash
bunx agents-heatmap
```

Generates two PNG heatmap images in the current directory.

## Options

```bash
bunx agents-heatmap                    # both per-agent and combined images
bunx agents-heatmap --combined         # only the combined "All Agents" view
bunx agents-heatmap --separate         # only per-agent separate views
bunx agents-heatmap --claude           # only Claude Code
bunx agents-heatmap --claude --codex   # only Claude Code and Codex
```

Available provider flags: `--claude`, `--codex`, `--cursor`, `--opencode`

### Single provider

![Claude only](assets/example-claude.png)

## Output

| File                        | Contents                                  |
| --------------------------- | ----------------------------------------- |
| `agents-heatmap.png`          | Per-agent sections (one heatmap per tool)  |
| `agents-heatmap-combined.png` | Single merged heatmap across all agents    |

### Combined

![Combined heatmap](assets/example-combined.png)

### Per-agent

![Per-agent heatmaps](assets/example-separate.png)

Each section shows:

- **Header** — tool name, input tokens, output tokens, total tokens
- **Heatmap** — GitHub-style year grid with quartile-based color levels
- **Footer** — most used model, last 30 days activity, longest streak, current streak

Images render at 4x resolution.

## Supported Agents

- **Claude Code** — reads from `~/.claude/`
- **Codex CLI** — reads from `~/.codex/`
- **Cursor** — auto-fetched from Cursor's dashboard API
- **OpenCode** — reads from `~/.local/share/opencode/opencode.db`

All sources are auto-detected. [Bun](https://bun.sh) runtime required.

## License

MIT
