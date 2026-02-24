#!/usr/bin/env node
/**
 * MCP Server — Hexo Blog Manager
 *
 * Manage Hexo blogs via AI: create, edit, list, and publish posts.
 * Works directly with Hexo's source/_posts/ markdown files.
 *
 * Environment:
 *   HEXO_DIR — Path to Hexo project root (default: current working directory)
 *
 * Tools:
 *   - list_posts:  List all posts with metadata
 *   - read_post:   Read a post's content
 *   - create_post: Create a new post
 *   - update_post: Update an existing post
 *   - delete_post: Delete a post
 *   - list_tags:   List all tags and categories
 *   - generate:    Run hexo generate
 *   - deploy:      Run a custom deploy command
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { readdir, readFile, writeFile, unlink, rename, mkdir, stat } from 'node:fs/promises';
import { join, resolve, basename } from 'node:path';
import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { promisify } from 'node:util';
import { existsSync } from 'node:fs';

const execFileAsync = promisify(execFile);

// ── Config ─────────────────────────────────────────────────

const HEXO_DIR = resolve(process.env.HEXO_DIR ?? process.cwd());
const POSTS_DIR = join(HEXO_DIR, 'source', '_posts');
const DRAFTS_DIR = join(HEXO_DIR, 'source', '_drafts');

// ── Front matter parsing ───────────────────────────────────

interface PostMeta {
  title: string;
  date: string;
  tags: string[];
  categories: string[];
  [key: string]: unknown;
}

interface Post {
  filename: string;
  meta: PostMeta;
  body: string;
  raw: string;
}

function parseFrontMatter(content: string): { meta: Record<string, unknown>; body: string } {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
  if (!match) {
    return { meta: {}, body: content };
  }

  const yamlBlock = match[1]!;
  const body = match[2]!;
  const meta: Record<string, unknown> = {};

  let currentKey = '';
  let currentArray: string[] | null = null;

  for (const line of yamlBlock.split('\n')) {
    const trimmed = line.trimEnd();

    if (trimmed.startsWith('  - ') || trimmed.startsWith('    - ')) {
      if (currentArray) {
        currentArray.push(trimmed.replace(/^\s*-\s*/, '').replace(/^["']|["']$/g, ''));
      }
      continue;
    }

    if (currentArray) {
      meta[currentKey] = currentArray;
      currentArray = null;
    }

    const kvMatch = trimmed.match(/^(\w[\w-]*):\s*(.*)$/);
    if (kvMatch) {
      const [, key, rawValue] = kvMatch;
      const value = rawValue!.trim();
      currentKey = key!;

      if (value === '' || value === '[]') {
        currentArray = [];
      } else if (value === 'true') {
        meta[currentKey] = true;
      } else if (value === 'false') {
        meta[currentKey] = false;
      } else {
        meta[currentKey] = value.replace(/^["']|["']$/g, '');
      }
    }
  }

  if (currentArray) meta[currentKey] = currentArray;

  return { meta, body };
}

function buildFrontMatter(meta: PostMeta): string {
  const lines: string[] = ['---'];
  lines.push(`title: ${meta.title}`);
  lines.push(`date: ${meta.date}`);

  if (meta.tags.length > 0) {
    lines.push('tags:');
    for (const tag of meta.tags) lines.push(`  - ${tag}`);
  }

  if (meta.categories.length > 0) {
    lines.push('categories:');
    for (const cat of meta.categories) lines.push(`  - ${cat}`);
  }

  // Write any additional keys
  for (const [key, value] of Object.entries(meta)) {
    if (['title', 'date', 'tags', 'categories'].includes(key)) continue;
    if (Array.isArray(value)) {
      lines.push(`${key}:`);
      for (const item of value) lines.push(`  - ${item}`);
    } else if (typeof value === 'boolean') {
      lines.push(`${key}: ${value}`);
    } else if (value !== undefined && value !== null) {
      lines.push(`${key}: ${String(value)}`);
    }
  }

  lines.push('---');
  return lines.join('\n');
}

// ── File helpers ───────────────────────────────────────────

async function atomicWrite(filePath: string, content: string): Promise<void> {
  const dir = join(filePath, '..');
  await mkdir(dir, { recursive: true });
  const tmpPath = join(dir, `.tmp-${randomUUID()}`);
  await writeFile(tmpPath, content, 'utf-8');
  await rename(tmpPath, filePath);
}

async function listMarkdownFiles(dir: string): Promise<string[]> {
  try {
    const files = await readdir(dir);
    return files.filter((f) => f.endsWith('.md')).sort();
  } catch {
    return [];
  }
}

async function readPost(filename: string): Promise<Post> {
  const filePath = join(POSTS_DIR, filename);
  const raw = await readFile(filePath, 'utf-8');
  const { meta, body } = parseFrontMatter(raw);

  return {
    filename,
    meta: {
      title: String(meta.title ?? ''),
      date: String(meta.date ?? ''),
      tags: Array.isArray(meta.tags) ? meta.tags.map(String) : [],
      categories: Array.isArray(meta.categories) ? meta.categories.map(String) : [],
      ...meta,
    },
    body,
    raw,
  };
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\w\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

// ── MCP Server ─────────────────────────────────────────────

const server = new McpServer({
  name: 'mcp-server-hexo',
  version: '0.1.0',
});

// -- list_posts --

server.tool(
  'list_posts',
  'List all Hexo blog posts with their metadata (title, date, tags, categories).',
  {
    tag: z.string().optional().describe('Filter by tag'),
    category: z.string().optional().describe('Filter by category'),
    limit: z.number().min(1).max(100).optional().describe('Max posts to return (default: 50)'),
  },
  async ({ tag, category, limit }) => {
    const files = await listMarkdownFiles(POSTS_DIR);
    const max = limit ?? 50;
    const results: string[] = [];

    for (const file of files) {
      if (results.length >= max) break;

      try {
        const post = await readPost(file);

        if (tag && !post.meta.tags.some((t) => t.toLowerCase().includes(tag.toLowerCase()))) {
          continue;
        }
        if (
          category &&
          !post.meta.categories.some((c) => c.toLowerCase().includes(category.toLowerCase()))
        ) {
          continue;
        }

        const tags = post.meta.tags.length > 0 ? ` [${post.meta.tags.join(', ')}]` : '';
        results.push(`- ${post.meta.date || 'no-date'} | ${post.meta.title}${tags}\n  file: ${file}`);
      } catch {
        results.push(`- ? | (parse error) file: ${file}`);
      }
    }

    if (results.length === 0) {
      return { content: [{ type: 'text' as const, text: 'No posts found.' }] };
    }

    return {
      content: [
        {
          type: 'text' as const,
          text: `Posts (${results.length}/${files.length}):\n\n${results.join('\n')}`,
        },
      ],
    };
  },
);

// -- read_post --

server.tool(
  'read_post',
  'Read the full content of a Hexo blog post.',
  {
    filename: z.string().describe('Filename of the post (e.g. "my-post.md")'),
  },
  async ({ filename }) => {
    // Security: prevent path traversal
    if (filename.includes('..') || filename.includes('/') || filename.includes('\\')) {
      return {
        content: [{ type: 'text' as const, text: 'Invalid filename: must not contain path separators' }],
        isError: true,
      };
    }

    try {
      const post = await readPost(filename);
      return { content: [{ type: 'text' as const, text: post.raw }] };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { content: [{ type: 'text' as const, text: `Failed to read post: ${msg}` }], isError: true };
    }
  },
);

// -- create_post --

server.tool(
  'create_post',
  'Create a new Hexo blog post with front matter.',
  {
    title: z.string().describe('Post title'),
    content: z.string().describe('Post body content (markdown)'),
    tags: z.array(z.string()).optional().describe('Tags for the post'),
    categories: z.array(z.string()).optional().describe('Categories for the post'),
    slug: z.string().optional().describe('Custom filename slug (auto-generated from title if omitted)'),
    date: z.string().optional().describe('Post date (default: now, format: YYYY-MM-DD HH:mm:ss)'),
  },
  async ({ title, content, tags, categories, slug, date }) => {
    const postSlug = slug || slugify(title);
    const postDate = date || new Date().toISOString().replace('T', ' ').replace(/\.\d{3}Z$/, '');
    const filename = `${postSlug}.md`;
    const filePath = join(POSTS_DIR, filename);

    // Check if file already exists
    try {
      await stat(filePath);
      return {
        content: [{ type: 'text' as const, text: `Post already exists: ${filename}. Use update_post to modify it.` }],
        isError: true,
      };
    } catch {
      // File doesn't exist — good
    }

    const meta: PostMeta = {
      title,
      date: postDate,
      tags: tags ?? [],
      categories: categories ?? [],
    };

    const fullContent = `${buildFrontMatter(meta)}\n\n${content}\n`;

    try {
      await atomicWrite(filePath, fullContent);
      return {
        content: [
          {
            type: 'text' as const,
            text: `Post created: source/_posts/${filename}\n\nTitle: ${title}\nDate: ${postDate}\nTags: ${(tags ?? []).join(', ') || '(none)'}\nCategories: ${(categories ?? []).join(', ') || '(none)'}`,
          },
        ],
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { content: [{ type: 'text' as const, text: `Failed to create post: ${msg}` }], isError: true };
    }
  },
);

// -- update_post --

server.tool(
  'update_post',
  'Update an existing Hexo blog post. You can update the content, title, tags, or categories.',
  {
    filename: z.string().describe('Filename of the post to update'),
    content: z.string().optional().describe('New post body content (replaces existing)'),
    title: z.string().optional().describe('New title'),
    tags: z.array(z.string()).optional().describe('New tags (replaces existing)'),
    categories: z.array(z.string()).optional().describe('New categories (replaces existing)'),
  },
  async ({ filename, content, title, tags, categories }) => {
    if (filename.includes('..') || filename.includes('/') || filename.includes('\\')) {
      return {
        content: [{ type: 'text' as const, text: 'Invalid filename' }],
        isError: true,
      };
    }

    try {
      const post = await readPost(filename);
      const newMeta: PostMeta = {
        ...post.meta,
        title: title ?? post.meta.title,
        tags: tags ?? post.meta.tags,
        categories: categories ?? post.meta.categories,
      };
      const newBody = content ?? post.body;
      const fullContent = `${buildFrontMatter(newMeta)}\n${newBody.startsWith('\n') ? '' : '\n'}${newBody}`;

      const filePath = join(POSTS_DIR, filename);
      await atomicWrite(filePath, fullContent);

      const changes: string[] = [];
      if (title) changes.push('title');
      if (content) changes.push('content');
      if (tags) changes.push('tags');
      if (categories) changes.push('categories');

      return {
        content: [
          {
            type: 'text' as const,
            text: `Post updated: ${filename}\nChanged: ${changes.join(', ')}`,
          },
        ],
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { content: [{ type: 'text' as const, text: `Failed to update post: ${msg}` }], isError: true };
    }
  },
);

// -- delete_post --

server.tool(
  'delete_post',
  'Delete a Hexo blog post.',
  {
    filename: z.string().describe('Filename of the post to delete'),
  },
  async ({ filename }) => {
    if (filename.includes('..') || filename.includes('/') || filename.includes('\\')) {
      return {
        content: [{ type: 'text' as const, text: 'Invalid filename' }],
        isError: true,
      };
    }

    const filePath = join(POSTS_DIR, filename);

    try {
      await stat(filePath);
    } catch {
      return { content: [{ type: 'text' as const, text: `Post not found: ${filename}` }], isError: true };
    }

    try {
      await unlink(filePath);
      return { content: [{ type: 'text' as const, text: `Post deleted: ${filename}` }] };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { content: [{ type: 'text' as const, text: `Failed to delete post: ${msg}` }], isError: true };
    }
  },
);

// -- list_tags --

server.tool(
  'list_tags',
  'List all tags and categories used across all posts.',
  {},
  async () => {
    const files = await listMarkdownFiles(POSTS_DIR);
    const tagCounts = new Map<string, number>();
    const catCounts = new Map<string, number>();

    for (const file of files) {
      try {
        const post = await readPost(file);
        for (const tag of post.meta.tags) {
          tagCounts.set(tag, (tagCounts.get(tag) ?? 0) + 1);
        }
        for (const cat of post.meta.categories) {
          catCounts.set(cat, (catCounts.get(cat) ?? 0) + 1);
        }
      } catch {
        // Skip unparseable files
      }
    }

    const sortedTags = [...tagCounts.entries()].sort((a, b) => b[1] - a[1]);
    const sortedCats = [...catCounts.entries()].sort((a, b) => b[1] - a[1]);

    const tagLines = sortedTags.map(([tag, count]) => `  ${tag} (${count})`).join('\n');
    const catLines = sortedCats.map(([cat, count]) => `  ${cat} (${count})`).join('\n');

    return {
      content: [
        {
          type: 'text' as const,
          text: `Tags (${sortedTags.length}):\n${tagLines || '  (none)'}\n\nCategories (${sortedCats.length}):\n${catLines || '  (none)'}`,
        },
      ],
    };
  },
);

// -- generate --

server.tool(
  'generate',
  'Run hexo generate to build static files. Requires hexo CLI installed in the project.',
  {},
  async () => {
    const npxPath = process.platform === 'win32' ? 'npx.cmd' : 'npx';

    try {
      const { stdout, stderr } = await execFileAsync(npxPath, ['hexo', 'generate'], {
        cwd: HEXO_DIR,
        timeout: 60_000,
      });

      return {
        content: [
          {
            type: 'text' as const,
            text: `Hexo generate completed.\n\n${stdout}${stderr ? `\nWarnings:\n${stderr}` : ''}`,
          },
        ],
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return {
        content: [{ type: 'text' as const, text: `Generate failed: ${msg}` }],
        isError: true,
      };
    }
  },
);

// -- deploy --

server.tool(
  'deploy',
  'Run a deploy command in the Hexo project directory. Default: "npx hexo deploy". Set HEXO_DEPLOY_CMD env to customize.',
  {
    command: z
      .string()
      .optional()
      .describe('Custom deploy command (default: uses HEXO_DEPLOY_CMD env or "npx hexo deploy")'),
  },
  async ({ command }) => {
    // Use provided command, env var, or default
    const deployCmd = command ?? process.env.HEXO_DEPLOY_CMD ?? 'npx hexo deploy';
    const parts = deployCmd.split(/\s+/);
    const cmd = parts[0]!;
    const args = parts.slice(1);

    // Resolve command for Windows
    const resolvedCmd = process.platform === 'win32' && !cmd.includes('.') ? `${cmd}.cmd` : cmd;

    try {
      const { stdout, stderr } = await execFileAsync(resolvedCmd, args, {
        cwd: HEXO_DIR,
        timeout: 120_000,
      });

      return {
        content: [
          {
            type: 'text' as const,
            text: `Deploy completed.\nCommand: ${deployCmd}\n\n${stdout}${stderr ? `\nWarnings:\n${stderr}` : ''}`,
          },
        ],
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return {
        content: [{ type: 'text' as const, text: `Deploy failed: ${msg}` }],
        isError: true,
      };
    }
  },
);

// ── Startup validation ─────────────────────────────────────

if (!existsSync(POSTS_DIR)) {
  console.error(`Warning: Posts directory not found: ${POSTS_DIR}`);
  console.error(`Set HEXO_DIR environment variable to your Hexo project root.`);
}

// ── Start ──────────────────────────────────────────────────

const transport = new StdioServerTransport();
await server.connect(transport);
