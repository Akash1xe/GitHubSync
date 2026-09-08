import fs from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { LeetCodeClient } from "./leetcode.mjs";
import { pickPrimaryTopic, topicDisplayName } from "./topics.mjs";

const ROOT = process.cwd();
const SOLUTIONS_DIR = path.join(ROOT, "solutions");
const STATE_DIR = path.join(ROOT, ".githubsync");
const STATE_FILE = path.join(STATE_DIR, "state.json");

const args = parseArgs(process.argv.slice(2));

if (args.help) {
  printHelp();
  process.exit(0);
}

const session = process.env.LEETCODE_SESSION?.trim();
if (!session) {
  console.error("Missing LEETCODE_SESSION.");
  console.error("Set it only in your local terminal; never paste or commit it.");
  console.error('PowerShell:  $env:LEETCODE_SESSION="your_cookie_value"');
  process.exit(1);
}

const preferredLanguage = args.language || process.env.PREFERRED_LANGUAGE || "cpp";
const client = new LeetCodeClient({
  session,
  csrf: process.env.LEETCODE_CSRF?.trim() || "",
  delayMs: args.delay
});

await fs.mkdir(SOLUTIONS_DIR, { recursive: true });
await fs.mkdir(STATE_DIR, { recursive: true });

const state = await loadState();
console.log("Reading solved problems from LeetCode...");
const solved = await client.listSolvedQuestions();

if (!solved.length) {
  console.error("No solved problems were returned. Check that your LeetCode session is valid and signed in.");
  process.exit(1);
}

console.log(`Found ${solved.length} solved problems.`);
let imported = 0;
let skipped = 0;
let failed = 0;

for (let index = 0; index < solved.length; index += 1) {
  const question = solved[index];
  const existing = state.problems[question.titleSlug];

  if (existing && !args.refresh) {
    skipped += 1;
    console.log(`[${index + 1}/${solved.length}] skip  ${question.frontendId}. ${question.title}`);
    continue;
  }

  try {
    console.log(`[${index + 1}/${solved.length}] fetch ${question.frontendId}. ${question.title}`);
    const submission = await client.latestAcceptedSubmission(question.titleSlug, preferredLanguage);
    if (!submission) throw new Error("No accepted submission found.");

    const details = await client.submissionDetails(submission.id);
    if (!details?.code) throw new Error("Submission source code was not returned.");

    const tags = mergeTags(question.topicTags, details.topicTags);
    const topic = pickPrimaryTopic(tags);
    const language = details.lang?.name || submission.lang || "text";
    const extension = extensionForLanguage(language);
    const number = formatProblemNumber(question.frontendId);
    const fileName = `${number}-${sanitizeSegment(question.titleSlug)}.${extension}`;
    const relativePath = path.posix.join("solutions", topic, fileName);
    const absolutePath = path.join(ROOT, ...relativePath.split("/"));

    if (existing?.path && existing.path !== relativePath) {
      await fs.rm(path.join(ROOT, ...existing.path.split("/")), { force: true });
    }

    await fs.mkdir(path.dirname(absolutePath), { recursive: true });
    await fs.writeFile(absolutePath, normalizeCode(details.code), "utf8");

    state.problems[question.titleSlug] = {
      frontendId: String(question.frontendId),
      title: question.title,
      titleSlug: question.titleSlug,
      difficulty: normalizeDifficulty(question.difficulty),
      topic,
      tags: tags.map((tag) => tag.name),
      language,
      submissionId: String(submission.id),
      submittedAt: normalizeTimestamp(details.timestamp || submission.timestamp || question.lastSubmittedAt),
      path: relativePath
    };

    await saveState(state);
    imported += 1;
  } catch (error) {
    failed += 1;
    console.error(`  failed: ${error.message}`);
  }
}

await generateIndexes(state);
await saveState(state);

console.log("");
console.log(`Imported/updated: ${imported}`);
console.log(`Already present:  ${skipped}`);
console.log(`Failed:           ${failed}`);
console.log(`Total tracked:    ${Object.keys(state.problems).length}`);

if (args.push) {
  commitAndPush();
} else {
  console.log("");
  console.log("Files are ready locally. Review them, then run:");
  console.log("  npm run sync -- --push");
}

function parseArgs(argv) {
  const parsed = { push: false, refresh: false, help: false, language: null, delay: 400 };
  for (let i = 0; i < argv.length; i += 1) {
    const value = argv[i];
    if (value === "--push") parsed.push = true;
    else if (value === "--refresh") parsed.refresh = true;
    else if (value === "--help" || value === "-h") parsed.help = true;
    else if (value === "--language") parsed.language = argv[++i];
    else if (value.startsWith("--language=")) parsed.language = value.split("=")[1];
    else if (value === "--delay") parsed.delay = Number(argv[++i]);
    else if (value.startsWith("--delay=")) parsed.delay = Number(value.split("=")[1]);
    else throw new Error(`Unknown argument: ${value}`);
  }

  if (!Number.isFinite(parsed.delay) || parsed.delay < 0) {
    throw new Error("--delay must be a non-negative number of milliseconds.");
  }
  return parsed;
}

function printHelp() {
  console.log(`GitHubSync - import previous accepted LeetCode solutions topic-wise\n\nUsage:\n  npm run sync\n  npm run sync -- --push\n\nOptions:\n  --push              Commit generated files and push the current branch\n  --refresh           Re-fetch problems already present in .githubsync/state.json\n  --language <lang>   Prefer this accepted language (default: cpp); falls back to latest accepted\n  --delay <ms>        Delay between LeetCode requests (default: 400)\n  -h, --help          Show this help\n`);
}

async function loadState() {
  try {
    const raw = await fs.readFile(STATE_FILE, "utf8");
    const parsed = JSON.parse(raw);
    return { version: 1, problems: parsed.problems || {} };
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    return { version: 1, problems: {} };
  }
}

async function saveState(current) {
  const sortedProblems = Object.fromEntries(
    Object.entries(current.problems).sort(([, a], [, b]) => compareProblemIds(a.frontendId, b.frontendId))
  );
  const payload = { version: 1, problems: sortedProblems };
  await fs.writeFile(STATE_FILE, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

function mergeTags(...groups) {
  const byName = new Map();
  for (const group of groups) {
    for (const tag of group || []) {
      const normalized = typeof tag === "string" ? { name: tag, slug: "" } : tag;
      if (normalized?.name) byName.set(normalized.name, { name: normalized.name, slug: normalized.slug || "" });
    }
  }
  return [...byName.values()];
}

function extensionForLanguage(language = "") {
  const key = language.toLowerCase().replaceAll(" ", "");
  const extensions = {
    cpp: "cpp", "c++": "cpp", cpp17: "cpp", cpp20: "cpp", cpp23: "cpp",
    c: "c", java: "java", python: "py", python3: "py", javascript: "js", nodejs: "js",
    typescript: "ts", go: "go", golang: "go", rust: "rs", kotlin: "kt", csharp: "cs", "c#": "cs",
    ruby: "rb", php: "php", swift: "swift", scala: "scala", dart: "dart", racket: "rkt",
    elixir: "ex", erlang: "erl", mysql: "sql", mssql: "sql", oracle: "sql", postgresql: "sql",
    bash: "sh", shell: "sh"
  };
  return extensions[key] || "txt";
}

function normalizeCode(code) {
  return code.endsWith("\n") ? code : `${code}\n`;
}

function normalizeDifficulty(value) {
  if (!value) return "Unknown";
  const lower = String(value).toLowerCase();
  return lower.charAt(0).toUpperCase() + lower.slice(1);
}

function normalizeTimestamp(value) {
  if (!value) return null;
  if (/^\d+$/.test(String(value))) {
    const seconds = Number(value);
    return new Date(seconds * 1000).toISOString();
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : date.toISOString();
}

function formatProblemNumber(value) {
  const text = String(value ?? "unknown");
  if (/^\d+$/.test(text)) return text.padStart(4, "0");
  return sanitizeSegment(text);
}

function sanitizeSegment(value) {
  return String(value)
    .trim()
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, "-")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^[-.]+|[-.]+$/g, "") || "problem";
}

async function generateIndexes(current) {
  const problems = Object.values(current.problems).sort((a, b) => compareProblemIds(a.frontendId, b.frontendId));
  const grouped = new Map();

  for (const problem of problems) {
    if (!grouped.has(problem.topic)) grouped.set(problem.topic, []);
    grouped.get(problem.topic).push(problem);
  }

  for (const [topic, items] of grouped) {
    const topicDir = path.join(SOLUTIONS_DIR, topic);
    await fs.mkdir(topicDir, { recursive: true });
    const lines = [
      `# ${topicDisplayName(topic)}`,
      "",
      `Solved problems: **${items.length}**`,
      "",
      "| # | Problem | Difficulty | Language | Tags |",
      "|---:|---|---|---|---|"
    ];

    for (const problem of items) {
      const file = path.basename(problem.path);
      const title = escapeMarkdownCell(problem.title);
      const tags = (problem.tags || []).map(escapeMarkdownCell).join(", ");
      lines.push(`| ${problem.frontendId} | [${title}](${encodeURI(file)}) | ${problem.difficulty} | ${escapeMarkdownCell(problem.language)} | ${tags} |`);
    }

    await fs.writeFile(path.join(topicDir, "README.md"), `${lines.join("\n")}\n`, "utf8");
  }

  const topicRows = [...grouped.entries()]
    .sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]))
    .map(([topic, items]) => `| [${topicDisplayName(topic)}](solutions/${topic}/) | ${items.length} |`);

  const easy = problems.filter((p) => p.difficulty === "Easy").length;
  const medium = problems.filter((p) => p.difficulty === "Medium").length;
  const hard = problems.filter((p) => p.difficulty === "Hard").length;

  const readme = `# GitHubSync\n\nTopic-wise archive of accepted LeetCode solutions, generated from your own authenticated LeetCode history.\n\n> Your LeetCode session cookie is read only from the local environment and is never written to this repository.\n\n## Solved\n\n**Total: ${problems.length}** · Easy: ${easy} · Medium: ${medium} · Hard: ${hard}\n\n| Topic | Problems |\n|---|---:|\n${topicRows.join("\n")}\n\n## Sync previous LeetCode submissions\n\nRequirements: **Node.js 18+**, Git, and an authenticated LeetCode session in your browser.\n\n### Windows PowerShell\n\n\`\`\`powershell\ngit clone https://github.com/Akash1xe/GitHubSync.git\ncd GitHubSync\n$env:LEETCODE_SESSION="PASTE_THE_COOKIE_VALUE_HERE"\nnpm run sync\n\`\`\`\n\nReview the generated files. To commit and push only the generated solution data:\n\n\`\`\`powershell\nnpm run sync -- --push\n\`\`\`\n\nTo prefer another language, use for example:\n\n\`\`\`powershell\nnpm run sync -- --language python3\n\`\`\`\n\nThe importer prefers the requested language when it appears among recent accepted submissions for a problem; otherwise it falls back to the latest accepted submission so solved problems are not omitted.\n\n## Getting LEETCODE_SESSION safely\n\n1. Sign in to LeetCode in your browser.\n2. Open Developer Tools (F12).\n3. Open **Application → Cookies → https://leetcode.com**.\n4. Copy only the value of **LEETCODE_SESSION**.\n5. Put it in your local terminal as shown above.\n6. Do **not** paste it into chat, source files, commits, issues, or screenshots.\n\nThe environment variable exists only in that terminal session unless you persist it yourself.\n\n## Repository structure\n\n\`\`\`text\nsolutions/\n├── Binary-Search/\n├── Sliding-Window/\n├── Dynamic-Programming/\n├── Graphs/\n├── Trees/\n├── Greedy/\n└── ...\n\n.githubsync/state.json   # non-secret sync state\nsrc/                     # importer\n\`\`\`\n\nEach problem is stored once under a deterministic primary topic. All LeetCode topic tags are retained in the topic README, so multi-tag problems do not create duplicate source files.\n\n## Re-sync\n\nA normal sync skips problems already present in \`.githubsync/state.json\`. To re-fetch existing solutions too:\n\n\`\`\`powershell\nnpm run sync -- --refresh\n\`\`\`\n\nThe LeetCode GraphQL API is undocumented and may change. The client includes a fallback solved-problem query and basic retry/backoff behavior.\n`;

  await fs.writeFile(path.join(ROOT, "README.md"), readme, "utf8");
}

function compareProblemIds(a, b) {
  const aNum = Number(a);
  const bNum = Number(b);
  if (Number.isFinite(aNum) && Number.isFinite(bNum)) return aNum - bNum;
  return String(a).localeCompare(String(b), undefined, { numeric: true });
}

function escapeMarkdownCell(value) {
  return String(value ?? "").replaceAll("|", "\\|").replaceAll("\n", " ");
}

function git(argsList, options = {}) {
  const result = spawnSync("git", argsList, { cwd: ROOT, encoding: "utf8", ...options });
  if (result.status !== 0) {
    throw new Error(result.stderr?.trim() || result.stdout?.trim() || `git ${argsList.join(" ")} failed`);
  }
  return result.stdout.trim();
}

function commitAndPush() {
  try {
    git(["rev-parse", "--is-inside-work-tree"]);
    git(["add", "README.md", "solutions", ".githubsync"]);

    const staged = spawnSync("git", ["diff", "--cached", "--quiet"], { cwd: ROOT });
    if (staged.status === 0) {
      console.log("No generated changes to commit.");
      return;
    }

    git(["commit", "-m", "Sync LeetCode solutions topic-wise"]);
    git(["push"]);
    console.log("Committed and pushed generated solutions to GitHub.");
  } catch (error) {
    console.error(`Git push failed: ${error.message}`);
    console.error("Your generated files are still saved locally.");
    process.exitCode = 1;
  }
}
