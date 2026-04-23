import "dotenv/config";

function getEnv(name: string): string {
  const v = process.env[name];
  if (!v) {
    console.error(`register-site: missing env var ${name} (check ingestion/.env)`);
    process.exit(1);
  }
  return v;
}

interface Args {
  siteId?: string;
  name?: string;
  knowledgeUrl?: string;
  systemPrompt?: string;
  allowedOrigins?: string[];
  command: "register" | "status" | "reingest" | "delete";
}

function parseArgs(argv: string[]): Args {
  const args: Args = { command: "register" };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === "--site-id") args.siteId = argv[++i];
    else if (a === "--name") args.name = argv[++i];
    else if (a === "--knowledge-url") args.knowledgeUrl = argv[++i];
    else if (a === "--system-prompt") args.systemPrompt = argv[++i];
    else if (a === "--allowed-origins") args.allowedOrigins = argv[++i]!.split(",").map((s) => s.trim());
    else if (a === "--status") {
      args.command = "status";
      args.siteId = argv[++i];
    } else if (a === "--reingest") {
      args.command = "reingest";
      args.siteId = argv[++i];
    } else if (a === "--delete") {
      args.command = "delete";
      args.siteId = argv[++i];
    }
  }
  return args;
}

function printUsage(): void {
  console.log(`Usage:
  pnpm register-site \\
    --site-id <id> \\
    --name <name> \\
    --knowledge-url <sitemap-url> \\
    --system-prompt <prompt> \\
    --allowed-origins <origin1,origin2>

  pnpm register-site --status <siteId>
  pnpm register-site --reingest <siteId>
  pnpm register-site --delete <siteId>`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const apiUrl = getEnv("API_URL");
  const adminKey = getEnv("ADMIN_API_KEY");
  const headers: Record<string, string> = {
    authorization: `Bearer ${adminKey}`,
    "content-type": "application/json",
  };

  if (args.command === "status") {
    if (!args.siteId) { printUsage(); process.exit(1); }
    const res = await fetch(`${apiUrl}/admin/sites/${args.siteId}`, { headers });
    console.log(res.status, await res.text());
    process.exit(res.ok ? 0 : 1);
  }

  if (args.command === "reingest") {
    if (!args.siteId) { printUsage(); process.exit(1); }
    const res = await fetch(`${apiUrl}/admin/sites/${args.siteId}/reingest`, {
      method: "POST",
      headers,
    });
    console.log(res.status, await res.text());
    process.exit(res.ok ? 0 : 1);
  }

  if (args.command === "delete") {
    if (!args.siteId) { printUsage(); process.exit(1); }
    const res = await fetch(`${apiUrl}/admin/sites/${args.siteId}`, {
      method: "DELETE",
      headers,
    });
    console.log(res.status, await res.text());
    process.exit(res.ok ? 0 : 1);
  }

  if (
    !args.siteId ||
    !args.name ||
    !args.knowledgeUrl ||
    !args.systemPrompt ||
    !args.allowedOrigins ||
    args.allowedOrigins.length === 0
  ) {
    printUsage();
    process.exit(1);
  }
  const body = JSON.stringify({
    siteId: args.siteId,
    name: args.name,
    knowledgeUrl: args.knowledgeUrl,
    systemPrompt: args.systemPrompt,
    allowedOrigins: args.allowedOrigins,
  });
  const res = await fetch(`${apiUrl}/admin/sites`, {
    method: "POST",
    headers,
    body,
  });
  console.log(res.status, await res.text());
  process.exit(res.ok ? 0 : 1);
}

main().catch((e) => {
  console.error(`register-site failed: ${(e as Error).message}`);
  process.exit(1);
});
