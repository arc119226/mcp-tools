#!/usr/bin/env node
/**
 * MCP Server — DuckDuckGo Search
 *
 * Zero-config web search for AI agents. No API key required.
 * Uses DuckDuckGo HTML endpoint which doesn't trigger CAPTCHAs.
 *
 * Tools:
 *   - search: Search the web via DuckDuckGo
 *   - fetch:  Fetch a URL and convert HTML to markdown
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

const DDG_URL = 'https://html.duckduckgo.com/html/';
const DEFAULT_TIMEOUT = 10_000;
const MAX_RESULTS = 8;
const MAX_FETCH_SIZE = 1024 * 1024; // 1MB
const MAX_REDIRECTS = 5;

// ── Search ─────────────────────────────────────────────────

interface SearchResult {
  title: string;
  url: string;
  snippet: string;
}

async function searchDDG(query: string, maxResults: number): Promise<SearchResult[]> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT);

  try {
    const response = await fetch(DDG_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      },
      body: new URLSearchParams({ q: query }).toString(),
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(`DuckDuckGo returned HTTP ${response.status}`);
    }

    const html = await response.text();
    return parseDDGHtml(html, maxResults);
  } finally {
    clearTimeout(timer);
  }
}

function parseDDGHtml(html: string, max: number): SearchResult[] {
  const results: SearchResult[] = [];

  const linkTagRegex = /<a\s[^>]*class="result__a"[^>]*>([\s\S]*?)<\/a>/gi;
  const hrefRegex = /href="([^"]*)"/i;
  const snippetRegex = /<a\s[^>]*class="result__snippet"[^>]*>([\s\S]*?)<\/a>/gi;

  const links: Array<{ url: string; title: string }> = [];
  let match: RegExpExecArray | null;

  while ((match = linkTagRegex.exec(html)) !== null) {
    const fullTag = match[0];
    const hrefMatch = hrefRegex.exec(fullTag);
    const url = hrefMatch?.[1]?.trim() ?? '';
    const title = stripHtml(match[1] ?? '').trim();
    if (url && title) {
      links.push({ url, title });
    }
  }

  const snippets: string[] = [];
  while ((match = snippetRegex.exec(html)) !== null) {
    snippets.push(stripHtml(match[1] ?? '').trim());
  }

  for (let i = 0; i < Math.min(links.length, max); i++) {
    const link = links[i]!;
    results.push({
      title: link.title,
      url: link.url,
      snippet: snippets[i] ?? '',
    });
  }

  return results;
}

// ── Fetch ──────────────────────────────────────────────────

interface FetchResultData {
  content: string;
  title: string;
  statusCode: number;
  url: string;
  contentLength: number;
}

async function fetchUrl(url: string): Promise<FetchResultData> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT);

  try {
    let currentUrl = url;
    let response: Response | undefined;
    let redirectCount = 0;

    while (redirectCount <= MAX_REDIRECTS) {
      response = await fetch(currentUrl, {
        signal: controller.signal,
        redirect: 'manual',
        headers: {
          'User-Agent': 'MCPBot/1.0 (Web Fetch)',
          Accept: 'text/html,application/xhtml+xml,text/plain,application/json',
        },
      });

      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get('location');
        if (!location) break;
        currentUrl = new URL(location, currentUrl).toString();
        redirectCount++;
        continue;
      }
      break;
    }

    if (!response) throw new Error('No response received');
    if (redirectCount > MAX_REDIRECTS) throw new Error(`Too many redirects (max ${MAX_REDIRECTS})`);
    if (!response.ok) throw new Error(`HTTP ${response.status}: ${response.statusText}`);

    const contentLength = Number(response.headers.get('content-length') ?? 0);
    if (contentLength > MAX_FETCH_SIZE) {
      throw new Error(`Response too large: ${(contentLength / 1024 / 1024).toFixed(1)}MB (max 1MB)`);
    }

    const rawText = await response.text();
    if (rawText.length > MAX_FETCH_SIZE) throw new Error('Response too large after download');

    const contentType = response.headers.get('content-type') ?? '';
    let content: string;
    let title: string;

    if (contentType.includes('text/html') || contentType.includes('application/xhtml')) {
      const parsed = htmlToMarkdown(rawText);
      content = parsed.content;
      title = parsed.title;
    } else if (contentType.includes('application/json')) {
      try {
        content = JSON.stringify(JSON.parse(rawText), null, 2);
      } catch {
        content = rawText;
      }
      title = '';
    } else {
      content = rawText;
      title = '';
    }

    return { content, title, statusCode: response.status, url: currentUrl, contentLength: content.length };
  } finally {
    clearTimeout(timer);
  }
}

// ── HTML → Markdown ────────────────────────────────────────

function htmlToMarkdown(html: string): { content: string; title: string } {
  let text = html;

  const titleMatch = text.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const title = titleMatch ? decodeEntities(titleMatch[1]!.trim()) : '';

  // Remove non-content tags
  text = text.replace(
    /<(script|style|nav|footer|header|aside|iframe|noscript)[^>]*>[\s\S]*?<\/\1>/gi,
    '',
  );
  text = text.replace(/<!--[\s\S]*?-->/g, '');

  // Convert structural elements
  text = text.replace(/<h1[^>]*>([\s\S]*?)<\/h1>/gi, '\n# $1\n');
  text = text.replace(/<h2[^>]*>([\s\S]*?)<\/h2>/gi, '\n## $1\n');
  text = text.replace(/<h3[^>]*>([\s\S]*?)<\/h3>/gi, '\n### $1\n');
  text = text.replace(/<h[4-6][^>]*>([\s\S]*?)<\/h[4-6]>/gi, '\n#### $1\n');
  text = text.replace(/<a[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi, '[$2]($1)');
  text = text.replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, '- $1\n');
  text = text.replace(/<\/(p|div)>/gi, '\n\n');
  text = text.replace(/<br\s*\/?>/gi, '\n');
  text = text.replace(/<(strong|b)[^>]*>([\s\S]*?)<\/\1>/gi, '**$2**');
  text = text.replace(/<(em|i)[^>]*>([\s\S]*?)<\/\1>/gi, '_$2_');
  text = text.replace(/<code[^>]*>([\s\S]*?)<\/code>/gi, '`$1`');
  text = text.replace(/<pre[^>]*>([\s\S]*?)<\/pre>/gi, '\n```\n$1\n```\n');

  // Strip remaining tags
  text = text.replace(/<[^>]+>/g, '');
  text = decodeEntities(text);

  // Clean whitespace
  text = text.replace(/\n{3,}/g, '\n\n');
  text = text.replace(/[ \t]+/g, ' ');
  text = text
    .split('\n')
    .map((line) => line.trim())
    .join('\n');
  text = text.trim();

  return { content: text, title };
}

function decodeEntities(text: string): string {
  return text
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&#(\d+);/g, (_, num) => String.fromCharCode(Number(num)))
    .replace(/&mdash;/g, '---')
    .replace(/&ndash;/g, '--')
    .replace(/&hellip;/g, '...')
    .replace(/&copy;/g, '(c)')
    .replace(/&reg;/g, '(R)');
}

function stripHtml(html: string): string {
  return html
    .replace(/<[^>]*>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ');
}

// ── MCP Server ─────────────────────────────────────────────

const server = new McpServer({
  name: 'mcp-server-duckduckgo',
  version: '0.1.0',
});

server.tool(
  'search',
  'Search the web via DuckDuckGo. No API key required.',
  {
    query: z.string().describe('Search query'),
    maxResults: z
      .number()
      .min(1)
      .max(20)
      .optional()
      .describe('Maximum number of results (default: 8)'),
  },
  async ({ query, maxResults }) => {
    if (!query.trim()) {
      return { content: [{ type: 'text' as const, text: 'Error: empty search query' }], isError: true };
    }

    try {
      const results = await searchDDG(query, maxResults ?? MAX_RESULTS);

      if (results.length === 0) {
        return { content: [{ type: 'text' as const, text: `No results found for: "${query}"` }] };
      }

      const text = results
        .map((r, i) => `${i + 1}. ${r.title}\n   ${r.url}\n   ${r.snippet}`)
        .join('\n\n');

      return { content: [{ type: 'text' as const, text }] };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { content: [{ type: 'text' as const, text: `Search failed: ${msg}` }], isError: true };
    }
  },
);

server.tool(
  'fetch',
  'Fetch a URL and convert its content to markdown. Useful for reading web pages.',
  {
    url: z.string().url().describe('URL to fetch'),
  },
  async ({ url }) => {
    try {
      const result = await fetchUrl(url);
      const header = result.title ? `# ${result.title}\n\n` : '';
      const meta = `[Status: ${result.statusCode}, Length: ${result.contentLength}]\n\n`;
      return { content: [{ type: 'text' as const, text: header + meta + result.content }] };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { content: [{ type: 'text' as const, text: `Fetch failed: ${msg}` }], isError: true };
    }
  },
);

// ── Start ──────────────────────────────────────────────────

const transport = new StdioServerTransport();
await server.connect(transport);
