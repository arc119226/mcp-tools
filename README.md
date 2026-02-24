# mcp-tools

A collection of simple, practical MCP (Model Context Protocol) servers. Zero config, just works.

## Packages

| Package | Description | Status |
|---------|-------------|--------|
| [`@aiprintmoney-arc/mcp-server-duckduckgo`](./packages/server-duckduckgo) | Web search via DuckDuckGo — no API key required | v0.1.0 |
| [`@aiprintmoney-arc/mcp-server-hexo`](./packages/server-hexo) | Manage Hexo blogs via AI | v0.1.0 |
| `@aiprintmoney-arc/mcp-server-jsonl` | JSONL event store for agent memory | Planned |

## Philosophy

- **Simple** — Each server does one thing well
- **Zero config** — Works out of the box, no API keys when possible
- **Practical** — Built from real daily usage, not theoretical needs
- **Lightweight** — Minimal dependencies, fast startup

## Quick Start

Each package can be used independently via `npx`:

```bash
# Example: DuckDuckGo search
npx @aiprintmoney-arc/mcp-server-duckduckgo
```

Or add to your Claude Desktop / Claude Code config. See each package's README for details.

## Development

This is a monorepo using npm workspaces.

```bash
# Install all dependencies
npm install

# Build all packages
npm run build

# Build a specific package
npm run build -w packages/server-duckduckgo
```

## License

MIT
