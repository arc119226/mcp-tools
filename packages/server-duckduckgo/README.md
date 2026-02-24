# mcp-server-duckduckgo

MCP server for web search via DuckDuckGo. **Zero API key required.**

## Features

- **Zero config** — No API keys, no registration, no setup
- **Two tools** — `search` (web search) + `fetch` (URL → markdown)
- **Lightweight** — No Puppeteer/Playwright, pure HTTP
- **Fast** — Direct HTML parsing, no headless browser overhead

## Quick Start

### With Claude Desktop

Add to your `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "duckduckgo": {
      "command": "npx",
      "args": ["-y", "@anthropic-arc/mcp-server-duckduckgo"]
    }
  }
}
```

### With Claude Code

Add to your `.mcp.json`:

```json
{
  "mcpServers": {
    "duckduckgo": {
      "command": "npx",
      "args": ["-y", "@anthropic-arc/mcp-server-duckduckgo"]
    }
  }
}
```

## Tools

### `search`

Search the web via DuckDuckGo.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `query` | string | Yes | Search query |
| `maxResults` | number | No | Max results (1-20, default: 8) |

### `fetch`

Fetch a URL and convert its content to markdown.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `url` | string | Yes | URL to fetch |

## Why This Exists

Most search MCP servers require API keys (Brave, Google, Tavily). This one uses DuckDuckGo's HTML endpoint — no registration, no billing, no rate limit worries. Just install and search.

## License

MIT
