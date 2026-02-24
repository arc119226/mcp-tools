# mcp-server-hexo

MCP server for managing Hexo blogs via AI. Create, edit, list, and publish posts.

## Features

- **Full CRUD** — Create, read, update, delete posts
- **Smart metadata** — Auto-parse and generate Hexo front matter (tags, categories, dates)
- **Build & deploy** — Run `hexo generate` and custom deploy commands
- **Tag analytics** — List all tags/categories with post counts
- **Zero Hexo dependency for read/write** — Works directly with markdown files

## Quick Start

### With Claude Desktop

Add to your `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "hexo": {
      "command": "npx",
      "args": ["-y", "@aiprintmoney-arc/mcp-server-hexo"],
      "env": {
        "HEXO_DIR": "/path/to/your/hexo/blog"
      }
    }
  }
}
```

### With Claude Code

Add to your `.mcp.json`:

```json
{
  "mcpServers": {
    "hexo": {
      "command": "npx",
      "args": ["-y", "@aiprintmoney-arc/mcp-server-hexo"],
      "env": {
        "HEXO_DIR": "/path/to/your/hexo/blog"
      }
    }
  }
}
```

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `HEXO_DIR` | No | Path to Hexo project root (default: current directory) |
| `HEXO_DEPLOY_CMD` | No | Custom deploy command (default: `npx hexo deploy`) |

## Tools

### `list_posts`

List all posts with metadata.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `tag` | string | No | Filter by tag |
| `category` | string | No | Filter by category |
| `limit` | number | No | Max posts (1-100, default: 50) |

### `read_post`

Read a post's full content.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `filename` | string | Yes | Post filename (e.g. `my-post.md`) |

### `create_post`

Create a new post with front matter.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `title` | string | Yes | Post title |
| `content` | string | Yes | Post body (markdown) |
| `tags` | string[] | No | Tags |
| `categories` | string[] | No | Categories |
| `slug` | string | No | Custom filename slug |
| `date` | string | No | Post date (YYYY-MM-DD HH:mm:ss) |

### `update_post`

Update an existing post.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `filename` | string | Yes | Post filename |
| `content` | string | No | New body content |
| `title` | string | No | New title |
| `tags` | string[] | No | New tags |
| `categories` | string[] | No | New categories |

### `delete_post`

Delete a post.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `filename` | string | Yes | Post filename |

### `list_tags`

List all tags and categories with post counts.

### `generate`

Run `hexo generate` to build static files.

### `deploy`

Run a deploy command.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `command` | string | No | Custom deploy command |

## Why This Exists

Hugo has an MCP server. Hexo doesn't — until now. Hexo is hugely popular in Asia (Taiwan, China, Japan) and among developers who prefer a Node.js-based static site generator. This server lets AI manage your blog natively.

## License

MIT
