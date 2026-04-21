import ts from "typescript";
import type { Chunk } from "../types";
import { countTokens } from "../tokenizer";

interface ChunkOptions {
  sourcePath: string;
  siteId?: string;
}

function isExported(node: ts.Node): boolean {
  const modifiers = ts.canHaveModifiers(node) ? ts.getModifiers(node) : undefined;
  return modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword) ?? false;
}

function getSymbolName(node: ts.Statement): string | null {
  if (ts.isFunctionDeclaration(node) && node.name) return node.name.text;
  if (ts.isClassDeclaration(node) && node.name) return node.name.text;
  if (ts.isInterfaceDeclaration(node)) return node.name.text;
  if (ts.isTypeAliasDeclaration(node)) return node.name.text;
  if (ts.isEnumDeclaration(node)) return node.name.text;
  if (ts.isVariableStatement(node)) {
    const decl = node.declarationList.declarations[0];
    if (decl && ts.isIdentifier(decl.name)) return decl.name.text;
  }
  return null;
}

/** Return the source text from the first leading comment to the node's end. */
function getNodeTextWithLeadingComments(node: ts.Node, fullText: string): string {
  const ranges = ts.getLeadingCommentRanges(fullText, node.pos) ?? [];
  const start = ranges.length > 0 ? ranges[0]!.pos : node.getStart();
  return fullText.slice(start, node.end).trim();
}

function collectImports(sf: ts.SourceFile): string[] {
  const names: string[] = [];
  for (const stmt of sf.statements) {
    if (!ts.isImportDeclaration(stmt)) continue;
    const clause = stmt.importClause;
    if (!clause) continue;
    if (clause.name) names.push(clause.name.text);
    if (clause.namedBindings) {
      if (ts.isNamespaceImport(clause.namedBindings)) {
        names.push(`* as ${clause.namedBindings.name.text}`);
      } else if (ts.isNamedImports(clause.namedBindings)) {
        for (const spec of clause.namedBindings.elements) {
          names.push(spec.name.text);
        }
      }
    }
  }
  return names;
}

export function chunkTypeScript(source: string, opts: ChunkOptions): Chunk[] {
  const sf = ts.createSourceFile(
    opts.sourcePath,
    source,
    ts.ScriptTarget.ES2022,
    true,
    ts.ScriptKind.TS,
  );
  const imports = collectImports(sf);
  const prelude =
    imports.length > 0
      ? `// from ${opts.sourcePath}, imports: ${imports.join(", ")}`
      : `// from ${opts.sourcePath}`;

  const chunks: Chunk[] = [];
  let idx = 0;

  for (const stmt of sf.statements) {
    if (!isExported(stmt)) continue;
    const name = getSymbolName(stmt);
    if (!name) continue;
    const body = getNodeTextWithLeadingComments(stmt, source);
    const content = `${prelude}\n\n${body}`;
    chunks.push({
      site_id: opts.siteId ?? "",
      source_path: opts.sourcePath,
      heading_path: `${opts.sourcePath} > export: ${name}`,
      chunk_index: idx++,
      content,
      token_count: countTokens(content),
    });
  }

  return chunks;
}
