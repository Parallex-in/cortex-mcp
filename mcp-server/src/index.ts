import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import fs from "fs/promises";
import path from "path";
import { execFileSync } from "child_process";

const VAULT = process.env.CORTEX_VAULT ?? path.join(process.env.HOME!, "Documents/obsidian-vault");
const MEMORY = path.join(VAULT, "claude-memory");
const DAILY = path.join(VAULT, "daily-notes");

const server = new McpServer({ name: "cortex", version: "2.0.0" });

// ── helpers ──────────────────────────────────────────────────────────────────

interface Frontmatter {
  name?: string;
  description?: string;
  type?: string;
  tags?: string[];
  status?: string;
  updated?: string;
  related?: string[];
  [key: string]: unknown;
}

function parseFrontmatter(content: string): Frontmatter {
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return {};
  const fm: Frontmatter = {};
  for (const line of match[1].split("\n")) {
    const colon = line.indexOf(": ");
    if (colon === -1) continue;
    const key = line.slice(0, colon).trim();
    const raw = line.slice(colon + 2).trim();
    if (!key) continue;
    // Parse YAML arrays: [a, b, c]
    if (raw.startsWith("[") && raw.endsWith("]")) {
      fm[key] = raw
        .slice(1, -1)
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
    } else {
      fm[key] = raw;
    }
  }
  return fm;
}

function buildFrontmatter(fm: Frontmatter): string {
  const lines: string[] = ["---"];
  for (const [k, v] of Object.entries(fm)) {
    if (v === undefined || v === null || v === "") continue;
    if (Array.isArray(v)) {
      lines.push(`${k}: [${v.join(", ")}]`);
    } else {
      lines.push(`${k}: ${v}`);
    }
  }
  lines.push("---");
  return lines.join("\n");
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

async function resolveMemoryFile(input: string): Promise<string | null> {
  const exact = input.endsWith(".md") ? input : `${input}.md`;
  const files = await fs.readdir(MEMORY);
  if (files.includes(exact)) return exact;
  const lower = input.toLowerCase();
  return files.find((f) => f.endsWith(".md") && f.toLowerCase().includes(lower)) ?? null;
}

function git(...args: string[]): string {
  return execFileSync("git", ["-C", VAULT, ...args], { encoding: "utf8" }).trim();
}

// ── tools ────────────────────────────────────────────────────────────────────

server.tool(
  "memory_list",
  "List claude-memory files with name, type, tags, status, and description. Filter by type or tag.",
  {
    type: z.enum(["user", "feedback", "project", "reference", "all"]).default("all"),
    tag: z.string().optional().describe("Filter by a specific tag, e.g. 'active'"),
  },
  async ({ type, tag }) => {
    const files = await fs.readdir(MEMORY);
    const mds = files.filter((f) => f.endsWith(".md") && f !== "MEMORY.md");

    const rows = await Promise.all(
      mds.map(async (f) => {
        const content = await fs.readFile(path.join(MEMORY, f), "utf8");
        return { file: f, fm: parseFrontmatter(content) };
      })
    );

    let filtered = rows;
    if (type !== "all") filtered = filtered.filter((r) => r.fm.type === type);
    if (tag) filtered = filtered.filter((r) => (r.fm.tags as string[] | undefined)?.includes(tag));

    if (filtered.length === 0) {
      return { content: [{ type: "text", text: "No memories match the filter." }] };
    }

    const lines = filtered.map(({ file, fm }) => {
      const tags = Array.isArray(fm.tags) && fm.tags.length ? ` [${fm.tags.join(", ")}]` : "";
      const status = fm.status ? ` (${fm.status})` : "";
      const updated = fm.updated ? ` — updated ${fm.updated}` : "";
      return `${file} | ${fm.type ?? "?"} | ${fm.name ?? file}${status}${tags}${updated}\n  ${fm.description ?? ""}`;
    });

    return { content: [{ type: "text", text: lines.join("\n") }] };
  }
);

server.tool(
  "memory_read",
  "Read a memory file. Accepts exact filename ('project_doozi.md') or partial match ('doozi').",
  {
    filename: z.string().describe("Exact or partial filename, e.g. 'doozi'"),
  },
  async ({ filename }) => {
    const resolved = await resolveMemoryFile(filename);
    if (!resolved) {
      return { content: [{ type: "text", text: `No memory matching '${filename}'` }], isError: true };
    }
    const content = await fs.readFile(path.join(MEMORY, resolved), "utf8");
    return { content: [{ type: "text", text: `[${resolved}]\n\n${content}` }] };
  }
);

server.tool(
  "memory_write",
  "Create a new memory file with full frontmatter and auto-update MEMORY.md with a [[wikilink]].",
  {
    filename: z.string().regex(/\.md$/, "Must end in .md"),
    name: z.string(),
    description: z.string(),
    type: z.enum(["user", "feedback", "project", "reference"]),
    body: z.string().describe("Content after frontmatter. Include **Why:** and **How to apply:** for feedback/project."),
    tags: z.array(z.string()).default([]),
    status: z.string().optional().describe("e.g. 'active', 'complete', 'archived'"),
    related: z.array(z.string()).default([]).describe("Related memory filenames (without .md)"),
  },
  async ({ filename, name, description, type, body, tags, status, related }) => {
    const file = path.join(MEMORY, filename);
    try {
      await fs.access(file);
      return { content: [{ type: "text", text: `Already exists: ${filename} — use memory_update.` }], isError: true };
    } catch {}

    const fm = buildFrontmatter({ name, description, type, tags, status, updated: today(), related });
    const relatedLinks = related.length
      ? "\n\n## Related\n" + related.map((r) => `- [[${r}]]`).join("\n")
      : "";
    await fs.writeFile(file, `${fm}\n\n${body}${relatedLinks}\n`, "utf8");

    // Update MEMORY.md with wikilink
    const indexPath = path.join(MEMORY, "MEMORY.md");
    const index = await fs.readFile(indexPath, "utf8");
    const slug = filename.replace(/\.md$/, "");
    const pointer = `- [[${slug}]] — ${description}`;
    await fs.writeFile(indexPath, index.trimEnd() + "\n" + pointer + "\n", "utf8");

    return { content: [{ type: "text", text: `Created: ${filename}\nLinked in MEMORY.md` }] };
  }
);

server.tool(
  "memory_update",
  "Update a memory file. Merges new frontmatter fields and replaces body. Accepts partial filename.",
  {
    filename: z.string().describe("Exact or partial filename"),
    body: z.string().describe("New body content"),
    tags: z.array(z.string()).optional(),
    status: z.string().optional(),
    related: z.array(z.string()).optional(),
  },
  async ({ filename, body, tags, status, related }) => {
    const resolved = await resolveMemoryFile(filename);
    if (!resolved) {
      return { content: [{ type: "text", text: `No memory matching '${filename}'` }], isError: true };
    }
    const file = path.join(MEMORY, resolved);
    const existing = await fs.readFile(file, "utf8");
    const fmMatch = existing.match(/^---\n[\s\S]*?\n---\n/);
    if (!fmMatch) {
      return { content: [{ type: "text", text: `No frontmatter in ${resolved}` }], isError: true };
    }

    const oldFm = parseFrontmatter(existing);
    const newFm: Frontmatter = {
      ...oldFm,
      updated: today(),
      ...(tags !== undefined && { tags }),
      ...(status !== undefined && { status }),
      ...(related !== undefined && { related }),
    };

    const relatedLinks =
      Array.isArray(newFm.related) && newFm.related.length
        ? "\n\n## Related\n" + (newFm.related as string[]).map((r) => `- [[${r}]]`).join("\n")
        : "";

    await fs.writeFile(file, `${buildFrontmatter(newFm)}\n\n${body.trimEnd()}${relatedLinks}\n`, "utf8");
    return { content: [{ type: "text", text: `Updated: ${resolved}` }] };
  }
);

server.tool(
  "memory_delete",
  "Delete a memory file and remove its wikilink from MEMORY.md.",
  {
    filename: z.string().describe("Exact or partial filename"),
  },
  async ({ filename }) => {
    const resolved = await resolveMemoryFile(filename);
    if (!resolved) {
      return { content: [{ type: "text", text: `No memory matching '${filename}'` }], isError: true };
    }
    await fs.unlink(path.join(MEMORY, resolved));

    const slug = resolved.replace(/\.md$/, "");
    const indexPath = path.join(MEMORY, "MEMORY.md");
    const index = await fs.readFile(indexPath, "utf8");
    const cleaned = index
      .split("\n")
      .filter((l) => !l.includes(`[[${slug}]]`) && !l.includes(`(${resolved})`))
      .join("\n");
    await fs.writeFile(indexPath, cleaned, "utf8");

    return { content: [{ type: "text", text: `Deleted: ${resolved}\nRemoved from MEMORY.md` }] };
  }
);

server.tool(
  "memory_search",
  "Search the vault with ripgrep. Returns file paths and matching lines.",
  {
    query: z.string().describe("Search term or regex"),
    scope: z.enum(["memory", "vault"]).default("memory"),
    max_results: z.number().int().min(1).max(50).default(10),
    tag: z.string().optional().describe("Only return results from files with this tag"),
  },
  async ({ query, scope, max_results, tag }) => {
    const dir = scope === "memory" ? MEMORY : VAULT;
    let output: string;
    try {
      output = execFileSync(
        "rg",
        ["--color=never", "-n", `--max-count=${max_results}`, query, dir],
        { encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] }
      ).trim();
    } catch (e: any) {
      if (e.status === 1) return { content: [{ type: "text", text: `No matches for "${query}"` }] };
      return { content: [{ type: "text", text: `Search failed: ${e.message}` }], isError: true };
    }

    if (tag) {
      const lines = output.split("\n");
      const filtered: string[] = [];
      for (const line of lines) {
        const filePath = line.split(":")[0];
        try {
          const fc = await fs.readFile(filePath, "utf8");
          const fm = parseFrontmatter(fc);
          if ((fm.tags as string[] | undefined)?.includes(tag)) filtered.push(line);
        } catch {}
      }
      output = filtered.join("\n");
    }

    return { content: [{ type: "text", text: output || `No matches for "${query}"` }] };
  }
);

server.tool(
  "memory_graph",
  "Return the full link graph — which memory files link to which. Use to understand relationships without reading every file.",
  {},
  async () => {
    const files = await fs.readdir(MEMORY);
    const mds = files.filter((f) => f.endsWith(".md"));
    const graph: Record<string, string[]> = {};

    await Promise.all(
      mds.map(async (f) => {
        const content = await fs.readFile(path.join(MEMORY, f), "utf8");
        const wikilinks = [...content.matchAll(/\[\[([^\]]+)\]\]/g)].map((m) => m[1]);
        if (wikilinks.length) graph[f] = wikilinks;
      })
    );

    return { content: [{ type: "text", text: JSON.stringify(graph, null, 2) }] };
  }
);

server.tool(
  "session_boot",
  "Return SESSION_BOOTSTRAP.md — load this at the start of every session for full context.",
  {},
  async () => {
    const content = await fs.readFile(path.join(VAULT, "SESSION_BOOTSTRAP.md"), "utf8");
    return { content: [{ type: "text", text: content }] };
  }
);

server.tool(
  "daily_note_read",
  "Read a daily note. Defaults to today.",
  {
    date: z.string().optional().describe("YYYY-MM-DD, defaults to today"),
  },
  async ({ date }) => {
    const d = date ?? today();
    try {
      const content = await fs.readFile(path.join(DAILY, `${d}.md`), "utf8");
      return { content: [{ type: "text", text: content }] };
    } catch {
      return { content: [{ type: "text", text: `No daily note for ${d}` }], isError: true };
    }
  }
);

server.tool(
  "daily_note_append",
  "Append text to a section in today's daily note. Creates the note from template if needed.",
  {
    section: z.enum(["Focus", "Brain Dump", "Claude Sessions", "Memory Updates"]),
    text: z.string(),
  },
  async ({ section, text }) => {
    const d = today();
    const file = path.join(DAILY, `${d}.md`);

    let content: string;
    try {
      content = await fs.readFile(file, "utf8");
    } catch {
      const template = await fs.readFile(path.join(VAULT, "templates/daily-note.md"), "utf8");
      content = template.replace(/\{\{date:YYYY-MM-DD\}\}/g, d);
    }

    const marker = `## ${section}`;
    const idx = content.indexOf(marker);
    if (idx === -1) {
      content = content.trimEnd() + `\n\n${marker}\n${text}\n`;
    } else {
      const nl = content.indexOf("\n", idx + marker.length);
      const insertAt = nl === -1 ? content.length : nl + 1;
      content = content.slice(0, insertAt) + text + "\n" + content.slice(insertAt);
    }

    await fs.writeFile(file, content, "utf8");
    return { content: [{ type: "text", text: `Appended to '${section}' in ${d}.md` }] };
  }
);

server.tool(
  "vault_sync",
  "Git add, commit, and push all vault changes to GitHub.",
  {
    message: z.string().optional(),
  },
  async ({ message }) => {
    try {
      git("add", "-A");
      execFileSync("git", ["-C", VAULT, "diff", "--cached", "--quiet"], {
        stdio: ["pipe", "pipe", "pipe"],
      });
      return { content: [{ type: "text", text: "Nothing to commit" }] };
    } catch {
      // staged changes exist — proceed
    }
    try {
      const msg = message ?? `mcp sync: ${new Date().toISOString().slice(0, 19).replace("T", " ")}`;
      git("commit", "-m", msg);
      git("push", "origin", "main");
      return { content: [{ type: "text", text: `Pushed: ${msg}` }] };
    } catch (e: any) {
      return { content: [{ type: "text", text: `Sync failed: ${e.stderr ?? e.message}` }], isError: true };
    }
  }
);

// ── shutdown ──────────────────────────────────────────────────────────────────

process.on("SIGINT", () => process.exit(0));
process.on("SIGTERM", () => process.exit(0));

// ── start ─────────────────────────────────────────────────────────────────────

const transport = new StdioServerTransport();
await server.connect(transport);
