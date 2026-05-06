# Contributing to cortex-mcp

## Ways to contribute

- **Bug reports** — open an issue with steps to reproduce
- **Tool improvements** — PRs for better MCP tool logic, error handling, edge cases
- **New tools** — open an issue first to discuss before building
- **Docs** — README fixes, setup clarifications, examples

## Development

```bash
git clone https://github.com/Parallex-in/cortex-mcp
cd cortex-mcp/mcp-server
npm install
npm run dev        # watch mode
```

Edit `src/index.ts`, then test with:
```bash
echo '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}' | \
  CORTEX_VAULT=~/Documents/obsidian-vault node dist/index.js
```

## Guidelines

- Each tool should do one thing well — no monolithic tools
- All inputs validated with Zod schemas and descriptive messages
- Error responses must include `isError: true` with a user-friendly message
- Never expose secrets or personal data in tool responses
- Update `README.md` if you add or change a tool

## Submitting a PR

1. Fork the repo
2. Create a branch: `git checkout -b feat/my-tool`
3. Make changes + build: `npm run build`
4. Open a PR with a clear description of what and why
