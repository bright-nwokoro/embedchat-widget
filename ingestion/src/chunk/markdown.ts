import type { Chunk } from "../types";
import { countTokens } from "../tokenizer";

const TARGET_TOKENS = 500;
const HARD_CAP_TOKENS = 1200;

interface ChunkOptions {
  sourcePath: string;
  siteId?: string;
}

type Block =
  | { type: "heading"; level: 1 | 2 | 3 | 4 | 5 | 6; text: string }
  | { type: "code"; text: string }
  | { type: "para"; text: string };

/** Split the markdown into a flat list of structural blocks. */
function tokenizeBlocks(md: string): Block[] {
  const blocks: Block[] = [];
  const lines = md.split("\n");
  let i = 0;
  while (i < lines.length) {
    const line = lines[i]!;

    // Code fence.
    if (line.startsWith("```")) {
      const buf: string[] = [line];
      i++;
      while (i < lines.length && !lines[i]!.startsWith("```")) {
        buf.push(lines[i]!);
        i++;
      }
      if (i < lines.length) buf.push(lines[i]!); // closing fence
      i++;
      blocks.push({ type: "code", text: buf.join("\n") });
      continue;
    }

    // ATX heading.
    const hmatch = line.match(/^(#{1,6})\s+(.*)$/);
    if (hmatch) {
      blocks.push({
        type: "heading",
        level: hmatch[1]!.length as 1 | 2 | 3 | 4 | 5 | 6,
        text: hmatch[2]!.trim(),
      });
      i++;
      continue;
    }

    // Blank line: skip.
    if (line.trim() === "") {
      i++;
      continue;
    }

    // Paragraph: consume until blank, heading, or code.
    const buf: string[] = [line];
    i++;
    while (
      i < lines.length &&
      lines[i]!.trim() !== "" &&
      !lines[i]!.startsWith("```") &&
      !/^#{1,6}\s+/.test(lines[i]!)
    ) {
      buf.push(lines[i]!);
      i++;
    }
    blocks.push({ type: "para", text: buf.join("\n") });
  }
  return blocks;
}

interface Section {
  headingPath: string;
  blocks: Block[];
}

/** Group blocks into sections split by H2/H3 boundaries; H1 is the doc title prefix. */
function groupSections(blocks: Block[]): Section[] {
  const sections: Section[] = [];
  let h1: string | null = null;
  let h2: string | null = null;
  let h3: string | null = null;
  let current: Section | null = null;

  function startSection() {
    const parts: string[] = [];
    if (h1) parts.push(`# ${h1}`);
    if (h2) parts.push(`## ${h2}`);
    if (h3) parts.push(`### ${h3}`);
    const headingPath = parts.join(" > ");
    current = { headingPath, blocks: [] };
    sections.push(current);
  }

  for (const b of blocks) {
    if (b.type === "heading") {
      if (b.level === 1) {
        h1 = b.text;
        h2 = null;
        h3 = null;
        startSection();
      } else if (b.level === 2) {
        h2 = b.text;
        h3 = null;
        startSection();
      } else if (b.level === 3) {
        h3 = b.text;
        startSection();
      } else {
        if (!current) startSection();
        current!.blocks.push({ type: "para", text: `${"#".repeat(b.level)} ${b.text}` });
      }
      continue;
    }
    if (!current) startSection();
    current!.blocks.push(b);
  }

  return sections.filter((s) => s.blocks.length > 0);
}

/** Split one section's block list into content chunks respecting token caps. */
function splitSection(section: Section): string[] {
  const joined = section.blocks.map((b) => b.text).join("\n\n");

  if (countTokens(joined) <= TARGET_TOKENS) {
    return [joined];
  }

  const out: string[] = [];
  let buf: string[] = [];

  function flush() {
    if (buf.length > 0) {
      out.push(buf.join("\n\n"));
      buf = [];
    }
  }

  for (const b of section.blocks) {
    const text = b.text;
    const candidate = buf.length === 0 ? text : `${buf.join("\n\n")}\n\n${text}`;
    const candidateTokens = countTokens(candidate);

    if (b.type === "code") {
      if (buf.length > 0 && candidateTokens > HARD_CAP_TOKENS) {
        flush();
      }
      buf.push(text);
      flush();
      continue;
    }

    if (candidateTokens <= TARGET_TOKENS) {
      buf.push(text);
      continue;
    }

    flush();
    if (countTokens(text) <= HARD_CAP_TOKENS) {
      buf.push(text);
      flush();
    } else {
      const sentences = text.split(/(?<=[.!?])\s+/);
      let sbuf: string[] = [];
      for (const s of sentences) {
        const cand = sbuf.length === 0 ? s : `${sbuf.join(" ")} ${s}`;
        if (countTokens(cand) > TARGET_TOKENS && sbuf.length > 0) {
          out.push(sbuf.join(" "));
          sbuf = [s];
        } else {
          sbuf.push(s);
        }
      }
      if (sbuf.length > 0) out.push(sbuf.join(" "));
    }
  }

  flush();
  return out.filter((s) => s.trim().length > 0);
}

export function chunkMarkdown(md: string, opts: ChunkOptions): Chunk[] {
  const blocks = tokenizeBlocks(md);
  const sections = groupSections(blocks);
  const chunks: Chunk[] = [];
  let idx = 0;
  for (const section of sections) {
    const parts = splitSection(section);
    for (const content of parts) {
      chunks.push({
        site_id: opts.siteId ?? "",
        source_path: opts.sourcePath,
        heading_path: section.headingPath || null,
        chunk_index: idx++,
        content,
        token_count: countTokens(content),
      });
    }
  }
  return chunks;
}
