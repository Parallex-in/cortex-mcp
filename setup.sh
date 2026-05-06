#!/usr/bin/env bash
# cortex-mcp setup — installs the vault, brain CLI, and MCP server
set -e

BOLD="\033[1m"
GREEN="\033[0;32m"
YELLOW="\033[0;33m"
RED="\033[0;31m"
RESET="\033[0m"

log()  { echo -e "${GREEN}✔${RESET} $1"; }
warn() { echo -e "${YELLOW}!${RESET} $1"; }
fail() { echo -e "${RED}✘${RESET} $1"; exit 1; }
ask()  { echo -e "${BOLD}?${RESET} $1"; }

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo ""
echo -e "${BOLD}cortex-mcp setup${RESET}"
echo "────────────────────────────────────"
echo ""

# ── 1. Vault location ─────────────────────────────────────────────────────────

DEFAULT_VAULT="$HOME/Documents/obsidian-vault"
ask "Vault location [${DEFAULT_VAULT}]: "
read -r VAULT_INPUT
VAULT="${VAULT_INPUT:-$DEFAULT_VAULT}"
VAULT="${VAULT/#\~/$HOME}"

if [[ -d "$VAULT" ]]; then
  warn "Directory already exists: $VAULT"
  ask "Continue and merge files? [y/N]: "
  read -r CONFIRM
  [[ "$CONFIRM" =~ ^[Yy]$ ]] || fail "Aborted."
fi

mkdir -p "$VAULT"
log "Vault: $VAULT"

# ── 2. Copy vault template ────────────────────────────────────────────────────

cp -rn "$SCRIPT_DIR/claude-memory" "$VAULT/" 2>/dev/null || true
cp -rn "$SCRIPT_DIR/templates"     "$VAULT/" 2>/dev/null || true
cp -rn "$SCRIPT_DIR/.obsidian"     "$VAULT/" 2>/dev/null || true
mkdir -p "$VAULT/daily-notes" "$VAULT/projects"

# Create SESSION_BOOTSTRAP.md from template if not present
if [[ ! -f "$VAULT/SESSION_BOOTSTRAP.md" ]]; then
  cp "$SCRIPT_DIR/SESSION_BOOTSTRAP.template.md" "$VAULT/SESSION_BOOTSTRAP.md"
fi

log "Vault template installed"

# ── 3. Build MCP server ───────────────────────────────────────────────────────

MCP_DIR="$VAULT/mcp-server"
mkdir -p "$MCP_DIR/src"
cp "$SCRIPT_DIR/mcp-server/package.json"    "$MCP_DIR/"
cp "$SCRIPT_DIR/mcp-server/tsconfig.json"   "$MCP_DIR/"
cp "$SCRIPT_DIR/mcp-server/.gitignore"      "$MCP_DIR/"
cp "$SCRIPT_DIR/mcp-server/src/index.ts"    "$MCP_DIR/src/"

command -v node >/dev/null 2>&1 || fail "Node.js is required. Install from https://nodejs.org"
command -v npm  >/dev/null 2>&1 || fail "npm is required."

echo "  Installing MCP dependencies..."
(cd "$MCP_DIR" && npm install --silent)
echo "  Building MCP server..."
(cd "$MCP_DIR" && npm run build --silent)
log "MCP server built: $MCP_DIR/dist/index.js"

# ── 4. Install brain CLI ──────────────────────────────────────────────────────

BRAIN_DEST="$HOME/.local/bin/brain"
mkdir -p "$HOME/.local/bin"

# Copy brain as-is — it already reads CORTEX_VAULT env var
cp "$SCRIPT_DIR/brain" "$BRAIN_DEST"
chmod +x "$BRAIN_DEST"

# Determine shell RC file
SHELL_RC="$HOME/.bashrc"
[[ "$SHELL" == */zsh ]] && SHELL_RC="$HOME/.zshrc"

# Ensure ~/.local/bin is in PATH
if ! echo "$PATH" | grep -q "$HOME/.local/bin"; then
  echo 'export PATH="$HOME/.local/bin:$PATH"' >> "$SHELL_RC"
  warn "Added ~/.local/bin to PATH in $SHELL_RC"
fi

# Export CORTEX_VAULT if vault is not the default location
DEFAULT_VAULT_EXPANDED="$HOME/Documents/obsidian-vault"
if [[ "$VAULT" != "$DEFAULT_VAULT_EXPANDED" ]]; then
  if ! grep -q "CORTEX_VAULT" "$SHELL_RC" 2>/dev/null; then
    echo "export CORTEX_VAULT=\"$VAULT\"" >> "$SHELL_RC"
    log "Added CORTEX_VAULT to $SHELL_RC"
  fi
fi

log "brain CLI installed: $BRAIN_DEST"

# ── 5. Wire MCP into Claude Code ─────────────────────────────────────────────

SETTINGS="$HOME/.claude/settings.json"
mkdir -p "$HOME/.claude"

if [[ ! -f "$SETTINGS" ]]; then
  echo '{}' > "$SETTINGS"
fi

# Backup
cp "$SETTINGS" "${SETTINGS}.bak"
log "Backed up settings.json → settings.json.bak"

# Inject cortex MCP entry using node (safe JSON manipulation, no path interpolation)
node -e "
  const fs = require('fs');
  const settingsPath = process.argv[1];
  const mcpEntry = JSON.parse(process.argv[2]);
  const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
  settings.mcpServers = settings.mcpServers ?? {};
  settings.mcpServers.cortex = mcpEntry;
  fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + '\n');
" "$SETTINGS" "$(node -e "process.stdout.write(JSON.stringify({
  command: 'node',
  args: ['$MCP_DIR/dist/index.js'],
  env: { CORTEX_VAULT: '$VAULT' }
}))")"

log "Wired cortex MCP into ~/.claude/settings.json"

# ── 6. Git init ───────────────────────────────────────────────────────────────

if [[ ! -d "$VAULT/.git" ]]; then
  git -C "$VAULT" init -b main 2>/dev/null || \
    (git -C "$VAULT" init && git -C "$VAULT" checkout -b main 2>/dev/null || true)
  git -C "$VAULT" add -A
  git -C "$VAULT" commit -m "init: cortex vault"
  log "Git repository initialized"
else
  warn "Git already initialized in vault — skipping init"
fi

# ── 7. GitHub remote (optional) ───────────────────────────────────────────────

ask "Add a GitHub remote? Enter repo URL or leave blank to skip: "
read -r REMOTE_URL
if [[ -n "$REMOTE_URL" ]]; then
  git -C "$VAULT" remote add origin "$REMOTE_URL" 2>/dev/null || git -C "$VAULT" remote set-url origin "$REMOTE_URL"
  git -C "$VAULT" push -u origin main
  log "Pushed to $REMOTE_URL"
fi

# ── Done ──────────────────────────────────────────────────────────────────────

echo ""
echo -e "${BOLD}Setup complete!${RESET}"
echo ""
echo "  Vault:      $VAULT"
echo "  MCP server: $MCP_DIR/dist/index.js"
echo "  brain CLI:  $BRAIN_DEST"
echo ""
echo "Next steps:"
echo "  1. Edit $VAULT/SESSION_BOOTSTRAP.md with your details"
echo "  2. Restart Claude Code to activate the MCP server"
echo "  3. Run: brain boot"
echo ""
