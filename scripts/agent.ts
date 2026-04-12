import { Octokit } from "@octokit/rest";
import { ChatAnthropic } from "@langchain/anthropic";
import { StateGraph, START, END, Annotation } from "@langchain/langgraph";
import { BaseMessage, HumanMessage } from "@langchain/core/messages";
import { execSync } from "child_process";
import fs from "fs";
import path from "path";
import dotenv from "dotenv";

dotenv.config();

const MAX_LOOPS = 5;

// State definition
const AgentState = Annotation.Root({
  issueNumber: Annotation<number>(),
  issueTitle: Annotation<string>(),
  issueBody: Annotation<string>(),
  plan: Annotation<string>(),
  targetFilesContent: Annotation<Record<string, string>>(),
  testOutput: Annotation<string>(),
  testPassed: Annotation<boolean>(),
  loopCount: Annotation<number>(),
  messages: Annotation<BaseMessage[]>({
    reducer: (x, y) => x.concat(y),
  }),
  prUrl: Annotation<string>(),
});

type AgentStateSchema = typeof AgentState.State;

const octokit = new Octokit({ auth: process.env.GITHUB_TOKEN });
const model = new ChatAnthropic({
  model: "claude-sonnet-4-6",
  apiKey: process.env.ANTHROPIC_API_KEY,
  temperature: 0,
});

const owner = process.env.GITHUB_REPOSITORY_OWNER || "nisyuu";
const repo = process.env.GITHUB_REPOSITORY?.split("/")[1] || "makasete-ai";

// Helper for shell commands
const runCmd = (cmd: string) => {
  try {
    return execSync(cmd, { encoding: "utf8", stdio: "pipe" });
  } catch (error: unknown) {
    const e = error as { stdout?: string; stderr?: string };
    return (e.stdout ?? "") + (e.stderr ?? "");
  }
};

// Nodes
const fetchIssue = async (state: AgentStateSchema) => {
  console.log("--- Fetching Issue ---");
  const { data: issue } = await octokit.issues.get({
    owner,
    repo,
    issue_number: state.issueNumber,
  });

  // Authorization check is handled by GitHub Action (github.actor == 'nisyuu')
  return {
    issueTitle: issue.title,
    issueBody: issue.body || "",
    messages: [new HumanMessage(`Implement changes for issue: ${issue.title}\n\n${issue.body}`)],
  };
};

const planNode = async (state: AgentStateSchema) => {
  console.log("--- Planning ---");
  // Use find to search codebase including root level
  const fileList = runCmd("find . -maxdepth 2 -not -path '*/.*' && find src -maxdepth 3 -not -path '*/.*'");
  
  const response = await model.invoke([
    ...state.messages,
    new HumanMessage(`Analyze the issue and codebase. Determine which files need modification and provide a detailed plan.
Codebase structure:
${fileList}

Respond with a plan in JAPANESE. 
IMPORTANT: 
- DO NOT modify configuration files (e.g., package.json, vitest.config.ts, next.config.js, tsconfig.json) unless the issue SPECIFICALLY requests it.
- Respect the existing project structure and conventions.
- If you need to create a new file, specify it in FILES_TO_MODIFY.

You MUST include a line "FILES_TO_MODIFY: path1, path2" (comma-separated relative paths) followed by your "DETAILED_INSTRUCTIONS" written in JAPANESE.
The detailed instructions will be used as the summary of the Pull Request, so please make it clear and professional.`),
  ]);

  const planContent = response.content as string;
  return {
    plan: planContent,
    messages: [response],
  };
};

const loadFiles = async (state: AgentStateSchema) => {
  console.log("--- Loading Files ---");
  // More robust path extraction
  const match = state.plan.match(/FILES_TO_MODIFY:\s*(.*)/i);
  const paths = (match ? match[1] : "")
    .split(/,|\n/)
    .map(p => p.trim().replace(/^[-*]\s*/, "")) // handle bullets
    .filter(p => p.length > 0 && !p.includes(" "));

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

const writeCode = async (state: AgentStateSchema) => {
  console.log(`--- Writing Code (Loop: ${state.loopCount + 1}) ---`);
  const fileContext = Object.entries(state.targetFilesContent)
    .map(([p, content]) => `File: ${p}\nContent:\n\`\`\`\n${content}\n\`\`\``)
    .join("\n\n");

  const prompt = state.testOutput 
    ? `The previous attempt failed with the following test errors:\n${state.testOutput.slice(-3000)}\n\nPlease fix the code accordingly.`
    : `Please implement the requested changes based on the following files:\n${fileContext}\n\nPlan:\n${state.plan}`;

  const response = await model.invoke([
    new HumanMessage(prompt + "\n\nProvide the complete updated content for each modified file. Use the following format for each file:\n\nFILE: path/to/file\n```\n(complete file content here)\n```")
  ]);

  const content = response.content as string;
  const fileBlocks = content.split(/FILE:\s*/).slice(1); // ignore preamble
  
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
    messages: [response],
  };
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

// ... (fetchIssue, planNode, loadFiles, writeCode ...)

const runTests = async () => {
  console.log("--- Running Tests ---");
  // Use exit code to determine success/failure accurately
  const { output, passed } = runCmdWithStatus("pnpm typecheck && pnpm lint && pnpm test");

  // Trim output for next loop
  const trimmedOutput = output.length > 5000 ? output.slice(-5000) : output;

  return {
    testOutput: passed ? "" : trimmedOutput,
    testPassed: passed,
  };
};

const createPR = async (state: AgentStateSchema) => {
  console.log("--- Creating Pull Request ---");
  const branchName = `autonomous-agent-issue-${state.issueNumber}-${Date.now()}`;
  
  // Configure git for CI environment
  runCmd(`git config user.name "github-actions[bot]"`);
  runCmd(`git config user.email "github-actions[bot]@users.noreply.github.com"`);
  
  runCmd(`git checkout -b ${branchName}`);

  // ONLY add files that were actually modified by the AI (whitelist from targetFilesContent)
  const modifiedFiles = Object.keys(state.targetFilesContent);
  for (const file of modifiedFiles) {
    if (fs.existsSync(file)) {
      runCmd(`git add "${file}"`);
      console.log(`Staged for commit: ${file}`);
    }
  }

  runCmd(`git commit -m "Autonomous agent fix for issue #${state.issueNumber}"`);
  runCmd(`git push origin ${branchName}`);

  const body = `## 自律型開発エージェントによる自動PR
このPRは LangGraph と Claude Sonnet 4.6 を使用して自動生成されました。

**対象Issue:** #${state.issueNumber}
**テスト結果:** ${state.testPassed ? "✅ 合格" : "❌ 不合格 (最大ループ回数に達しました)"}

### 修正されたファイル
${modifiedFiles.map(f => `- ${f}`).join("\n")}

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
      body,
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
    console.error("GitHub API 経由の PR 作成またはレビュアー追加に失敗しました:", e.response?.data || e.message);
    throw err;
  }
};

// Decision Node
const checkLoopEnd = (state: AgentStateSchema) => {
  if (state.testPassed) return "createPR";
  if (state.loopCount >= MAX_LOOPS) return "createPR";
  return "writeCode";
};

// Graph Construction
const workflow = new StateGraph(AgentState)
  .addNode("fetchIssue", fetchIssue)
  .addNode("planNode", planNode)
  .addNode("loadFiles", loadFiles)
  .addNode("writeCode", writeCode)
  .addNode("runTests", runTests)
  .addNode("createPR", createPR)
  .addEdge(START, "fetchIssue")
  .addEdge("fetchIssue", "planNode")
  .addEdge("planNode", "loadFiles")
  .addEdge("loadFiles", "writeCode")
  .addEdge("writeCode", "runTests")
  .addConditionalEdges("runTests", checkLoopEnd)
  .addEdge("createPR", END);

export const agent = workflow.compile();

// Execution logic
if (require.main === module) {
  const issueNumber = parseInt(process.argv[2]);
  if (isNaN(issueNumber)) {
    console.error("Please provide a valid issue number as an argument.");
    process.exit(1);
  }

  agent.invoke({
    issueNumber,
    loopCount: 0,
    messages: [],
    targetFilesContent: {},
    testOutput: "",
    testPassed: false,
    prUrl: "",
    plan: "",
    issueTitle: "",
    issueBody: "",
  }).then((finalState) => {
    console.log(`Finished processing issue #${issueNumber}. PR URL: ${finalState.prUrl}`);
  }).catch((err) => {
    console.error("Agent failed:", err);
    process.exit(1);
  });
}
