# cortex-mcp

A persistent AI memory system for any MCP-compatible AI tool — built on an Obsidian vault, a purpose-built MCP server, and a brain CLI. Gives your AI structured, searchable, token-efficient access to everything it needs to remember about you and your projects.

Works with **Claude Code, Cursor, Windsurf, Zed**, and any other editor or CLI that supports the [Model Context Protocol](https://modelcontextprotocol.io). No MCP support? Use `brain boot` to paste your full context into any AI manually.

## What it does

| Layer | Tool | Purpose |
|-------|------|---------|
| Vault | Obsidian | Human-readable memory store, graph view, daily notes |
| CLI | `brain` | Interactive vault access from terminal |
| MCP | `cortex` | Your AI's programmatic API into the vault |
| Sync | Git | Everything backed up to GitHub automatically |

## Compatibility

| Tool | Support |
|------|---------|
| Claude Code | ✅ Full MCP |
| Cursor | ✅ Full MCP |
| Windsurf | ✅ Full MCP |
| Zed | ✅ Full MCP |
| Any MCP client | ✅ Full MCP |
| OpenAI Codex CLI, Gemini CLI, ChatGPT, etc. | ⚡ Partial — use `brain boot` to paste context manually |

## Setup

```bash
git clone https://github.com/your-username/cortex-mcp
cd cortex-mcp
bash setup.sh
```

`setup.sh` will:
1. Create your vault at `~/Documents/obsidian-vault` (or a path you choose)
2. Build the MCP server (`npm install && npm run build`)
3. Install `brain` to `~/.local/bin/brain`
4. Auto-configure `~/.claude/settings.json` with the cortex MCP (backs up first)
5. `git init` the vault + optional push to GitHub

Then:
1. Edit `SESSION_BOOTSTRAP.md` with your details
2. Add initial memory files with `brain mem`
3. Restart your AI tool

### Manual config (if not using setup.sh)

Add this to your tool's MCP config:

**Claude Code** (`~/.claude/settings.json`)
```json
{
  "mcpServers": {
    "cortex": {
      "command": "node",
      "args": ["/path/to/vault/mcp-server/dist/index.js"],
      "env": { "CORTEX_VAULT": "/path/to/vault" }
    }
  }
}
```

**Cursor / Windsurf** (`~/.cursor/mcp.json` or `~/.codeium/windsurf/mcp_settings.json`)
```json
{
  "mcpServers": {
    "cortex": {
      "command": "node",
      "args": ["/path/to/vault/mcp-server/dist/index.js"],
      "env": { "CORTEX_VAULT": "/path/to/vault" }
    }
  }
}
```

**No MCP support?** Run `brain boot` and paste the output at the start of any AI conversation.

## brain CLI

Interactive commands for the vault. Run from any terminal.

```bash
brain boot          # Print SESSION_BOOTSTRAP.md (paste into Claude)
brain today         # Open today's daily note in $EDITOR
brain mem "title"   # Create a new memory file
brain add "title"   # Quick-capture a note
brain search        # Fuzzy search vault (fzf + ripgrep)
brain grep "term"   # Raw ripgrep across vault
brain sync          # git add -A && commit && push
brain status        # git status + recent commits
brain ls            # List all .md files
brain read <file>   # Print a vault file
```

## MCP Tools (11)

Claude calls these directly — no permission prompts needed.

### Memory

| Tool | What it does |
|------|-------------|
| `memory_list` | Index scan — name, type, tags, status, description. Filter by type or tag. |
| `memory_read` | Read one file. Fuzzy match — `"doozi"` finds `project_doozi.md`. |
| `memory_write` | Create file with full frontmatter + auto-link in MEMORY.md. |
| `memory_update` | Replace body, merge frontmatter fields, stamp `updated` date. |
| `memory_delete` | Delete file + remove wikilink from MEMORY.md. |
| `memory_search` | ripgrep across memory or entire vault. Filter by tag. |
| `memory_graph` | Return full link graph as JSON — who links to whom. |

### Session

| Tool | What it does |
|------|-------------|
| `session_boot` | Return `SESSION_BOOTSTRAP.md` — full context in one call. |

### Daily Notes

| Tool | What it does |
|------|-------------|
| `daily_note_read` | Read today's (or any date's) daily note. |
| `daily_note_append` | Append to a section. Creates note from template if missing. |

### Sync

| Tool | What it does |
|------|-------------|
| `vault_sync` | `git add -A && commit && push`. Call after writing memories. |

## Memory frontmatter schema

```yaml
---
name: Project Name
description: One-line description shown in the index
type: user | feedback | project | reference
tags: [project, active, react-native]
status: active | complete | archived
updated: 2026-05-06
related: [project_active, reference_environment]
---
```

`related` files become `[[wikilinks]]` automatically — they show up as edges in Obsidian's graph view.

## Vault structure

```
vault/
├── claude-memory/
│   ├── MEMORY.md              ← graph hub — links to everything
│   ├── user_profile.md
│   ├── feedback_style.md
│   ├── project_active.md
│   └── project_*.md
├── daily-notes/               ← gitignored, stays local
├── projects/                  ← quick-capture notes
├── templates/
│   ├── daily-note.md
│   ├── memory-capture.md
│   └── project-note.md
└── SESSION_BOOTSTRAP.md
```

## Obsidian graph view

The vault ships with a pre-configured graph (`/.obsidian/graph.json`):
- `MEMORY.md` is the central hub — all memories link back to it
- Node colors: blue = project, orange = feedback, green = user, grey = reference
- Orphan nodes hidden by default
- `related` fields in frontmatter generate visible graph edges

## How Claude uses it

**Typical session flow:**

```
session_boot          → load full context (1 call)
memory_list           → scan index for relevant files
memory_read("doozi")  → read specific memory
memory_search("JWT")  → find across all files
memory_write(...)     → save new memory atomically
vault_sync()          → push to GitHub
```

## Updating the MCP server

```bash
cd ~/Documents/obsidian-vault/mcp-server
# edit src/index.ts
npm run build
# restart Claude Code
```

## Environment variable

Set `CORTEX_VAULT` to override the default vault path:
```json
{
  "mcpServers": {
    "cortex": {
      "command": "node",
      "args": ["/path/to/vault/mcp-server/dist/index.js"],
      "env": { "CORTEX_VAULT": "/path/to/vault" }
    }
  }
}
```
