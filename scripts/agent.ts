import { Octokit } from "@octokit/rest";
import Anthropic from "@anthropic-ai/sdk";
import { execSync } from "child_process";
import fs from "fs";
import path from "path";
import dotenv from "dotenv";

dotenv.config();

const MAX_LOOPS = 5;
const MODEL = "claude-sonnet-4-6";
const MAX_TOKENS = 8096;

interface AgentState {
  issueNumber: number;
  issueTitle: string;
  issueBody: string;
  commentBody: string;
  isPr: boolean;
  intent: string;
  plan: string;
  targetFilesContent: Record<string, string>;
  testOutput: string;
  testPassed: boolean;
  loopCount: number;
  messages: Anthropic.MessageParam[];
  prUrl: string;
  prHeadBranch: string;
}

const octokit = new Octokit({ auth: process.env.GITHUB_TOKEN });
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const owner = process.env.GITHUB_REPOSITORY_OWNER || "nisyuu";
const repo =
  (process.env.GITHUB_REPOSITORY || "").split("/")[1] || "makasete-ai";

// Merge consecutive same-role messages to satisfy Anthropic API requirements
const normalizeMessages = (
  messages: Anthropic.MessageParam[],
): Anthropic.MessageParam[] => {
  const result: Anthropic.MessageParam[] = [];
  for (const msg of messages) {
    const last = result[result.length - 1];
    if (
      last &&
      last.role === msg.role &&
      typeof last.content === "string" &&
      typeof msg.content === "string"
    ) {
      result[result.length - 1] = {
        role: last.role,
        content: last.content + "\n\n" + msg.content,
      };
    } else {
      result.push({ ...msg });
    }
  }
  return result;
};

const callModel = async (
  messages: Anthropic.MessageParam[],
): Promise<string> => {
  const response = await anthropic.messages.create({
    model: MODEL,
    max_tokens: MAX_TOKENS,
    messages: normalizeMessages(messages),
  });
  return response.content
    .filter((block): block is Anthropic.TextBlock => block.type === "text")
    .map((b) => b.text)
    .join("");
};

// Helper for shell commands
const runCmd = (cmd: string) => {
  try {
    return execSync(cmd, { encoding: "utf8", stdio: "pipe" });
  } catch (error: unknown) {
    const e = error as { stdout?: string; stderr?: string };
    return (e.stdout ?? "") + (e.stderr ?? "");
  }
};

// Helper for shell commands with success/failure status
const runCmdWithStatus = (cmd: string) => {
  try {
    const output = execSync(cmd, { encoding: "utf8", stdio: "pipe" });
    return { output, passed: true };
  } catch (error: unknown) {
    const e = error as { stdout?: string; stderr?: string };
    return { output: (e.stdout ?? "") + (e.stderr ?? ""), passed: false };
  }
};

// Nodes
const fetchContext = async (
  state: AgentState,
): Promise<Partial<AgentState>> => {
  console.log("--- Fetching Context ---");
  const { data: issue } = await octokit.issues.get({
    owner,
    repo,
    issue_number: state.issueNumber,
  });

  let prHeadBranch = "";
  if (state.isPr) {
    const { data: pr } = await octokit.pulls.get({
      owner,
      repo,
      pull_number: state.issueNumber,
    });
    prHeadBranch = pr.head.ref;
    console.log(`Working on PR branch: ${prHeadBranch}`);
    runCmd(`git fetch origin ${prHeadBranch}`);
    runCmd(`git checkout ${prHeadBranch}`);
  }

  const contextMessage = `Context: ${state.isPr ? "Pull Request" : "Issue"} #${state.issueNumber}
Title: ${issue.title}
Body: ${issue.body || "No body provided."}
${state.commentBody ? `Comment: ${state.commentBody}` : ""}

Please address the request.`;

  return {
    issueTitle: issue.title,
    issueBody: issue.body || "",
    prHeadBranch,
    messages: [{ role: "user", content: contextMessage }],
  };
};

const analyzeIntent = async (
  state: AgentState,
): Promise<Partial<AgentState>> => {
  console.log("--- Analyzing Intent ---");
  const prompt = `Analyze the request. Is this a request to modify the codebase (implement features, fix bugs, refactor, delete files) or just a general question/conversation/explanation?
Respond with ONLY one word: "IMPLEMENT" or "CHAT".`;

  const text = await callModel([
    ...state.messages,
    { role: "user", content: prompt },
  ]);

  const intent = text.trim().toUpperCase();
  console.log(`Intent determined: ${intent}`);

  return {
    intent: intent.includes("IMPLEMENT") ? "IMPLEMENT" : "CHAT",
    messages: [
      ...state.messages,
      { role: "user", content: prompt },
      { role: "assistant", content: text },
    ],
  };
};

const chatNode = async (state: AgentState): Promise<Partial<AgentState>> => {
  console.log("--- Chatting ---");
  const prompt = `Provide a helpful response to the user's question or comment in JAPANESE.
Since you are NOT going to modify any code, focus on explanation, advice, or answering the question based on your knowledge of the project.
If they asked to implement something but you chose CHAT, explain why (e.g., instructions were unclear).`;

  const text = await callModel([
    ...state.messages,
    { role: "user", content: prompt },
  ]);

  await octokit.issues.createComment({
    owner,
    repo,
    issue_number: state.issueNumber,
    body: `## @ai-power からの回答\n\n${text}`,
  });

  return {
    messages: [
      ...state.messages,
      { role: "user", content: prompt },
      { role: "assistant", content: text },
    ],
  };
};

const planNode = async (state: AgentState): Promise<Partial<AgentState>> => {
  console.log("--- Planning ---");
  // Use find to search codebase including root level
  const fileList = runCmd(
    "find . -maxdepth 2 -not -path '*/.*' && find server -maxdepth 2 -not -path '*/.*' && find widget -maxdepth 2 -not -path '*/.*'",
  );

  const prompt = `Analyze the issue and codebase. Determine which files need modification and provide a detailed plan.
Codebase structure:
${fileList}

Respond with a plan in JAPANESE.
IMPORTANT:
- DO NOT modify configuration files (e.g., package.json, vitest.config.ts, next.config.js, tsconfig.json) unless the issue SPECIFICALLY requests it.
- Respect the existing project structure and conventions.
- If you need to create a new file, specify it in FILES_TO_MODIFY.

You MUST include a line "FILES_TO_MODIFY: path1, path2" (comma-separated relative paths) followed by your "DETAILED_INSTRUCTIONS" written in JAPANESE.
The detailed instructions will be used as the summary of the Pull Request, so please make it clear and professional.`;

  const text = await callModel([
    ...state.messages,
    { role: "user", content: prompt },
  ]);

  return {
    plan: text,
    messages: [
      ...state.messages,
      { role: "user", content: prompt },
      { role: "assistant", content: text },
    ],
  };
};

const loadFiles = async (state: AgentState): Promise<Partial<AgentState>> => {
  console.log("--- Loading Files ---");
  // More robust path extraction
  const match = state.plan.match(/FILES_TO_MODIFY:\s*(.*)/i);
  const paths = (match ? match[1] : "")
    .split(/,|\n/)
    .map((p) => p.trim().replace(/^[-*]\s*/, "")) // handle bullets
    .filter((p) => p.length > 0 && !p.includes(" "));

  const targetFilesContent: Record<string, string> = {};
  for (const p of paths) {
    try {
      if (fs.existsSync(p) && fs.lstatSync(p).isFile()) {
        targetFilesContent[p] = fs.readFileSync(p, "utf8");
      } else if (!fs.existsSync(p)) {
        // AI wants to create a new file
        console.log(`AI intends to create a new file: ${p}`);
        targetFilesContent[p] = "";
      }
    } catch {
      console.warn(`Failed to read file: ${p}`);
    }
  }

  return { targetFilesContent };
};

const writeCode = async (state: AgentState): Promise<Partial<AgentState>> => {
  console.log(`--- Writing Code (Loop: ${state.loopCount + 1}) ---`);
  const fileContext = Object.entries(state.targetFilesContent)
    .map(([p, content]) => `File: ${p}\nContent:\n\`\`\`\n${content}\n\`\`\``)
    .join("\n\n");

  const prompt = state.testOutput
    ? `The previous attempt failed with the following test errors:\n${state.testOutput.slice(-3000)}\n\nPlease fix the code accordingly.`
    : `Please implement the requested changes based on the following files:\n${fileContext}\n\nPlan:\n${state.plan}`;

  const text = await callModel([
    {
      role: "user",
      content:
        prompt +
        "\n\nProvide the complete updated content for each modified file. Use the following format for each file:\n\nFILE: path/to/file\n```\n(complete file content here)\n```",
    },
  ]);

  const fileBlocks = text.split(/FILE:\s*/).slice(1); // ignore preamble

  const updatedFiles: Record<string, string> = { ...state.targetFilesContent };
  for (const block of fileBlocks) {
    const match = block.match(/^([^\n]+)\n```(?:\w+)?\n([\s\S]*?)```/);
    if (match) {
      const filePath = match[1].trim();
      const fileContent = match[2];
      try {
        fs.mkdirSync(path.dirname(filePath), { recursive: true });
        fs.writeFileSync(filePath, fileContent);
        updatedFiles[filePath] = fileContent;
        console.log(`Updated file: ${filePath}`);
      } catch {
        console.error(`Failed to write file: ${filePath}`);
      }
    }
  }

  return {
    targetFilesContent: updatedFiles,
    loopCount: state.loopCount + 1,
  };
};

const runTests = async (): Promise<Partial<AgentState>> => {
  console.log("--- Running Tests ---");
  // Use exit code to determine success/failure accurately
  const { output, passed } = runCmdWithStatus(
    "pnpm typecheck && pnpm lint && pnpm test",
  );

  // Trim output for next loop
  const trimmedOutput = output.length > 5000 ? output.slice(-5000) : output;

  return {
    testOutput: passed ? "" : trimmedOutput,
    testPassed: passed,
  };
};

const createPR = async (state: AgentState): Promise<Partial<AgentState>> => {
  console.log("--- Creating or Updating Pull Request ---");

  // Configure git for CI environment
  runCmd(`git config user.name "github-actions[bot]"`);
  runCmd(
    `git config user.email "github-actions[bot]@users.noreply.github.com"`,
  );

  const branchName =
    state.isPr && state.prHeadBranch
      ? state.prHeadBranch
      : `autonomous-agent-issue-${state.issueNumber}-${Date.now()}`;

  if (!state.isPr) {
    runCmd(`git checkout -b ${branchName}`);
  }

  // ONLY add files that were actually modified by the AI (whitelist from targetFilesContent)
  const modifiedFiles = Object.keys(state.targetFilesContent);
  for (const file of modifiedFiles) {
    if (fs.existsSync(file)) {
      runCmd(`git add "${file}"`);
      console.log(`Staged for commit: ${file}`);
    }
  }

  const commitMessage = state.isPr
    ? `Update PR #${state.issueNumber} based on @ai-power mention`
    : `Autonomous agent fix for issue #${state.issueNumber}`;

  runCmd(`git commit -m "${commitMessage}"`);
  runCmd(`git push origin ${branchName}`);

  if (state.isPr) {
    const commentBody = `## @ai-power による自動更新
修正が完了しました。

**テスト結果:** ${state.testPassed ? "✅ 合格" : "❌ 不合格 (最大ループ回数に達しました)"}

### 修正されたファイル
${modifiedFiles.map((f) => `- ${f}`).join("\n")}

### 修正内容の要約
${state.plan.replace(/FILES_TO_MODIFY:.*\n/i, "").trim()}

${!state.testPassed ? "#### テスト失敗ログ\n```\n" + state.testOutput + "\n```" : ""}
`;
    await octokit.issues.createComment({
      owner,
      repo,
      issue_number: state.issueNumber,
      body: commentBody,
    });
    return {
      prUrl: `https://github.com/${owner}/${repo}/pull/${state.issueNumber}`,
    };
  }

  const prBody = `## 自律型開発エージェントによる自動PR
このPRは Claude Sonnet 4.6 を使用して自動生成されました。

**対象Issue:** #${state.issueNumber}
**テスト結果:** ${state.testPassed ? "✅ 合格" : "❌ 不合格 (最大ループ回数に達しました)"}

### 修正されたファイル
${modifiedFiles.map((f) => `- ${f}`).join("\n")}

### 修正内容の要約
${state.plan.replace(/FILES_TO_MODIFY:.*\n/i, "").trim()}

${!state.testPassed ? "#### テスト失敗ログ\n```\n" + state.testOutput + "\n```" : ""}

---
Fixes #${state.issueNumber}
`;

  try {
    const { data: pr } = await octokit.pulls.create({
      owner,
      repo,
      title: `[AI Power] ${state.issueTitle}`,
      body: prBody,
      head: branchName,
      base: "develop",
    });

    // Add nisyuu as a reviewer
    await octokit.pulls.requestReviewers({
      owner,
      repo,
      pull_number: pr.number,
      reviewers: ["nisyuu"],
    });

    return { prUrl: pr.html_url };
  } catch (err: unknown) {
    const e = err as { response?: { data: unknown }; message?: string };
    console.error(
      "GitHub API 経由の PR 作成またはレビュアー追加に失敗しました:",
      e.response?.data || e.message,
    );
    throw err;
  }
};

// Decision function
const checkLoopEnd = (state: AgentState): "createPR" | "writeCode" => {
  if (state.testPassed) return "createPR";
  if (state.loopCount >= MAX_LOOPS) return "createPR";
  return "writeCode";
};

export const runAgent = async (initialState: AgentState): Promise<AgentState> => {
  let state = { ...initialState };

  state = { ...state, ...(await fetchContext(state)) };
  state = { ...state, ...(await analyzeIntent(state)) };

  if (state.intent === "IMPLEMENT") {
    state = { ...state, ...(await planNode(state)) };
    state = { ...state, ...(await loadFiles(state)) };

    while (checkLoopEnd(state) === "writeCode") {
      state = { ...state, ...(await writeCode(state)) };
      state = { ...state, ...(await runTests()) };
    }

    state = { ...state, ...(await createPR(state)) };
  } else {
    state = { ...state, ...(await chatNode(state)) };
  }

  return state;
};

// Execution logic
if (require.main === module) {
  const issueNumber = parseInt(process.argv[2]);
  const commentBody = process.argv[3] || "";
  const isPr = process.argv[4] === "true";

  if (isNaN(issueNumber)) {
    console.error("Please provide a valid issue number as an argument.");
    process.exit(1);
  }

  runAgent({
    issueNumber,
    commentBody,
    isPr,
    intent: "CHAT",
    loopCount: 0,
    messages: [],
    targetFilesContent: {},
    testOutput: "",
    testPassed: false,
    prUrl: "",
    prHeadBranch: "",
    plan: "",
    issueTitle: "",
    issueBody: "",
  })
    .then((finalState) => {
      console.log(
        `Finished processing ${isPr ? "PR" : "Issue"} #${issueNumber}. Intent: ${finalState.intent}`,
      );
    })
    .catch((err) => {
      console.error("Agent failed:", err);
      process.exit(1);
    });
}
