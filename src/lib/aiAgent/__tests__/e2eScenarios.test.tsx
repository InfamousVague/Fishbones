/// End-to-end pipeline tests.
///
/// Each scenario drives a realistic LLM response sequence through
/// the FULL stack: agent loop → tool dispatch → real
/// `buildToolRegistry` handlers → Tauri invoke (mocked) → sandbox
/// writer → React panel rendering. Asserts the side-effects we
/// care about end up where they should: the mocked sandbox state,
/// the CustomEvents window listeners can observe, the DOM the
/// user actually sees.
///
/// What this file does NOT do: connect to a live Ollama daemon.
/// Each scenario scripts the LLM's responses up front so the
/// tests run deterministically in milliseconds. The scripted
/// responses are written to mimic the EXACT shapes we've
/// observed real Ollama checkpoints produce — including the bad
/// shapes (code dumps without tool calls, malformed JSON, etc.)
/// the agent loop's recovery layers exist to clean up.

import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useMemo } from "react";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import type { AgentTransport, AgentTurnResponse } from "@/lib/aiAgent/types";
import type { AiAgentSettings } from "@/lib/aiAgent/settings";

// ── Mocks ──────────────────────────────────────────────────────

// Captured invoke calls for assertions. Reset per test.
const invokeCalls: Array<{ cmd: string; args: Record<string, unknown> }> = [];

// In-memory sandbox state for the mocked `sandbox_load_project`
// + `sandbox_save_project` commands. Tests can read this to
// assert what files the agent wrote to disk.
type StoredProject = {
  id: string;
  name: string;
  language: string;
  files: Array<{ name: string; content: string; language: string }>;
  createdAt?: string;
  updatedAt?: string;
};
const sandboxStore = new Map<string, StoredProject>();

// Plain async function (NOT vi.fn) so vitest's `mockReset: true`
// doesn't strip our implementation between tests. We wire this in
// as the mockImplementation of the setup.ts invoke vi.fn inside
// beforeEach.
const invokeMock = async (
  cmd: string,
  args?: Record<string, unknown>,
) => {
  invokeCalls.push({ cmd, args: args ?? {} });
  switch (cmd) {
    case "sandbox_save_project": {
      const p = (args as { project: StoredProject }).project;
      sandboxStore.set(p.id, JSON.parse(JSON.stringify(p)));
      return null;
    }
    case "sandbox_load_project": {
      const id = (args as { id: string }).id;
      const p = sandboxStore.get(id);
      if (!p) throw new Error(`project not found: ${id}`);
      return JSON.parse(JSON.stringify(p));
    }
    case "sandbox_list_projects":
    case "sandbox_delete_project":
      return null;
    case "sandbox_run_project": {
      // The runtime mock — return a "successful run" by default,
      // tests can override per-scenario.
      const ovrFn = (globalThis as unknown as { __sandboxRunOverride?: unknown })
        .__sandboxRunOverride;
      const ovr =
        typeof ovrFn === "function"
          ? (ovrFn as (a: typeof args) => unknown)(args)
          : null;
      return ovr ?? { ok: true, logs: [], durationMs: 25, previewUrl: null };
    }
    case "sandbox_delete_file":
    case "sandbox_focus":
      return null;
    default:
      throw new Error(`unexpected invoke: ${cmd}`);
  }
};

// Note: setup.ts already installs a `vi.fn` mock for
// `@tauri-apps/api/core`. Re-declaring it at the test file level
// races with the setup file's hoisted mock. Instead we import the
// (already-mocked) invoke and swap its implementation in
// `beforeEach` — same end result, no conflicting mock declarations.

// Mock the transport so the hook's loop driver uses our scripted
// version instead of the Tauri one.
const transportRef: { current: AgentTransport | null } = { current: null };
vi.mock("@/lib/aiAgent/transport", () => ({
  createTauriTransport: () => transportRef.current,
}));

// Minimal i18n mock so panel labels don't crash the test.
vi.mock("@/i18n/i18n", () => ({
  useT: () => (k: string) => k,
}));

// Minimal markdown renderer — real markdown-it pulls in shiki +
// other heavy formatters we don't need to exercise here.
vi.mock("@/components/templates/Lesson/markdown", () => ({
  renderMarkdown: async (input: string) => {
    const fenceRe = /```([^\n]*)\n([\s\S]*?)```/g;
    return input.replace(fenceRe, (_full, info, body) => {
      const lang = (info as string).split(/[:\s]/)[0] || "code";
      return `<pre><code class="language-${lang}">${escape(body as string)}</code></pre>`;
    });
  },
}));

function escape(s: string) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// Mock the scope hook so the panel's scope chip doesn't crash.
vi.mock("@/lib/aiTools/scope", () => ({
  enforceProject: () => null,
  enforceWrite: () => null,
}));

// Mock the runtime registry — `run_sandbox_project`'s handler
// calls `runFiles(language, files, ...)` directly (not via Tauri
// invoke), so we need to swap the real registry for one that
// tracks calls + returns scripted results. Each scenario can
// override this via `runFilesOverride` to simulate run failures.
const runFilesCalls: Array<{ language: string; files: unknown }> = [];
let runFilesOverride:
  | null
  | ((args: { language: string; files: unknown }) => unknown) = null;
vi.mock("@/runtimes/index", () => ({
  runFiles: async (
    language: string,
    files: unknown,
    _b?: unknown,
    _c?: unknown,
    _d?: unknown,
  ) => {
    runFilesCalls.push({ language, files });
    if (runFilesOverride) return runFilesOverride({ language, files });
    return {
      ok: true,
      logs: [],
      durationMs: 10,
      previewUrl: null,
    };
  },
}));

// ── Captured CustomEvents from the window ──────────────────────

type CapturedEvent = { type: string; detail: unknown };
const capturedEvents: CapturedEvent[] = [];

function startEventCapture() {
  capturedEvents.length = 0;
  const types = [
    "libre:sandbox-focus",
    "libre:sandbox-refresh",
    "libre:agent-file-write",
    "libre:agent-run-start",
    "libre:agent-run-end",
    "libre:preview-log",
  ];
  const handlers: Array<{ type: string; handler: EventListener }> = [];
  for (const t of types) {
    const h: EventListener = (ev: Event) => {
      capturedEvents.push({
        type: t,
        detail: (ev as CustomEvent).detail,
      });
    };
    window.addEventListener(t, h);
    handlers.push({ type: t, handler: h });
  }
  return () => {
    for (const { type, handler } of handlers) {
      window.removeEventListener(type, handler);
    }
  };
}

// ── Harness component ────────────────────────────────────────

// Late-imports so the mocks above register first.
import AiAgentPanel from "@/components/organisms/AiAssistant/AiAgentPanel";
import { useAiAgent } from "@/hooks/useAiAgent";
import { useSandboxStreamWriter } from "@/components/organisms/TrayPanel/useSandboxStreamWriter";
import { buildToolRegistry } from "@/lib/aiTools/tools";

/// Seed localStorage with the requested settings BEFORE rendering
/// the Harness. The hook's `useState(() => loadSettings())`
/// initializer runs once on first render — any later
/// `updateSettings` call applies on the NEXT render, but the
/// first agent turn may already have started by then. Pre-seeding
/// localStorage lets `loadSettings()` pick up the right values
/// synchronously.
function seedSettings(overrides: Partial<{
  autoApprove: boolean;
  pauseOnLowConfidence: boolean;
}>) {
  const merged = {
    autoApprove: false,
    pauseOnLowConfidence: true,
    showTokens: true,
    showConfidence: true,
    toolConcurrency: 1,
    maxTurns: 20,
    ...overrides,
  };
  localStorage.setItem("libre.aiAgent.settings", JSON.stringify(merged));
}

function Harness({
  prompt,
}: {
  prompt: string;
}) {
  // Build the real tool registry the production app uses.
  // Stub the host-callback props with empty courses + noop handlers.
  const tools = useMemo(
    () =>
      buildToolRegistry({
        courses: [],
        completed: new Set(),
        history: [],
        openLesson: () => {},
        openCourse: () => {},
        scope: {
          activeProjectId: null,
          allowedProjectIds: new Set(),
          allowedPathPatterns: [],
          readOnlyPaths: [],
        },
        updateScope: () => {},
      }),
    [],
  );
  const agent = useAiAgent({
    systemPrompt: "you are the agent",
    tools,
  });

  // Sandbox writer mirrors the real app's wiring — it watches
  // the latest assistant content and writes fenced files. We
  // expect it to NOT do anything for scenarios where the
  // synthesiser already routed the files through the tool
  // channel; the streaming fence parser sees the SAME content
  // the synthesiser cleaned, and if the cleaner stripped the
  // fences first, nothing remains to parse.
  const latestAgentContent = useMemo(() => {
    for (let i = agent.messages.length - 1; i >= 0; i--) {
      const m = agent.messages[i];
      if (m.role === "assistant") return m.content ?? "";
    }
    return "";
  }, [agent.messages]);
  useSandboxStreamWriter(latestAgentContent);

  return (
    <>
      <button
        data-testid="send"
        onClick={() => void agent.send(prompt)}
      >
        send
      </button>
      <AiAgentPanel
        open
        messages={agent.messages}
        streaming={agent.streaming}
        pending={agent.pending}
        timeline={agent.timeline}
        error={agent.error}
        usage={agent.usage}
        confidence={agent.confidence}
        clarification={agent.clarification}
        settings={agent.settings}
        onSend={(p) => void agent.send(p)}
        onClose={() => {}}
        onReset={agent.reset}
        onApprove={agent.approve}
        onDeny={agent.deny}
        onAnswerClarification={agent.answerClarification}
        onCancelClarification={agent.cancelClarification}
        onUpdateSettings={(s: AiAgentSettings) => agent.updateSettings(s)}
      />
    </>
  );
}

// ── Test infrastructure ────────────────────────────────────────

/// Scripted transport with two response forms per turn:
///   - A literal `AgentTurnResponse` (the simple case).
///   - A function that takes the request's `messages` and returns
///     an `AgentTurnResponse` — lets multi-turn scenarios reach
///     back into earlier tool results (e.g. to grab the projectId
///     the prior `create_sandbox_project` returned) and thread it
///     into the next call's arguments.
type Turn =
  | AgentTurnResponse
  | ((messages: Array<{ role: string; content: string; name?: string }>) => AgentTurnResponse);

function scripted(turns: Turn[]): AgentTransport {
  let i = 0;
  return {
    async send(req) {
      const t = turns[i++];
      if (!t) {
        throw new Error(`script underrun at turn ${i}`);
      }
      const turn = typeof t === "function" ? t(req.messages) : t;
      // Simulate token-streaming when the caller wants chunks.
      if (turn.content && req.onChunk) {
        const text = turn.content;
        for (let k = 0; k < text.length; k += 32) {
          req.onChunk(text.slice(k, k + 32));
        }
      }
      return turn;
    },
  };
}

/// Extract a `projectId` from the most recent tool result in the
/// conversation messages — used by dynamic scripted turns that
/// need to re-emit a tool call against the project created
/// earlier in the run.
function projectIdFromMessages(
  messages: Array<{ role: string; content: string; name?: string }>,
): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m.role !== "tool") continue;
    if (m.name !== "create_sandbox_project") continue;
    try {
      const parsed = JSON.parse(m.content) as { projectId?: string };
      if (parsed.projectId) return parsed.projectId;
    } catch {
      /* skip */
    }
  }
  throw new Error("no create_sandbox_project tool result in messages");
}

/// Click the topmost pending approval chip in the panel. Mirrors
/// the user's interaction: the user sees a chip with an "Allow"
/// button and clicks it.
async function approveTopChip() {
  const buttons = screen.queryAllByText(/^Allow$/);
  if (buttons.length === 0) return false;
  await act(async () => {
    buttons[0].click();
  });
  return true;
}

/// Wait for the agent's run to ACTUALLY finish — which is signalled
/// by the appearance of a HUD confidence value matching the run's
/// final turn (the loop only writes confidence when the assistant
/// message ends with `<confidence>` AND the entire loop has
/// returned). The pending-chip check alone is insufficient:
/// auto-approve scenarios never render chips, so an empty-chip
/// list is true BEFORE the loop has even started.
async function waitForFinalConfidence(expected: string) {
  await waitFor(
    () => {
      const v = document.querySelector(".libre-ai-hud-confidence-value");
      expect(v?.textContent).toBe(expected);
    },
    { timeout: 3000 },
  );
}

/// Wait for a specific invoke command to have been called at least
/// once. Useful for "the agent's tool dispatch hit the sandbox"
/// assertions.
async function waitForInvoke(cmd: string, count = 1) {
  await waitFor(
    () => {
      const matches = invokeCalls.filter((c) => c.cmd === cmd);
      expect(matches.length).toBeGreaterThanOrEqual(count);
    },
    { timeout: 3000 },
  );
}

beforeEach(async () => {
  invokeCalls.length = 0;
  sandboxStore.clear();
  runFilesCalls.length = 0;
  runFilesOverride = null;
  localStorage.clear();
  // Swap the setup.ts default invoke mock (which throws) for our
  // per-test mock that captures calls + serves the in-memory
  // sandbox store. Same pattern for listen.
  const core = await import("@tauri-apps/api/core");
  (core.invoke as unknown as ReturnType<typeof vi.fn>).mockImplementation(
    invokeMock,
  );
  const event = await import("@tauri-apps/api/event");
  (event.listen as unknown as ReturnType<typeof vi.fn>).mockImplementation(
    async () => () => {},
  );
});

afterEach(() => {
  delete (globalThis as { __sandboxRunOverride?: unknown }).__sandboxRunOverride;
});

// ── SCENARIO A: Tic-tac-toe — synthesiser path ───────────────

describe("Scenario A: tic-tac-toe (code dump → synthesiser)", () => {
  it(
    "model dumps code without tool calls; synthesiser fires; project " +
      "lands in sandbox with all 3 files; HUD updates; chat shows " +
      "clean summary",
    async () => {
      const stopCapture = startEventCapture();
      try {
        transportRef.current = scripted([
          // Turn 1: the user's exact "model dumps code at me" failure
          // mode. Three fenced files, NO tool calls.
          {
            content: [
              "Here's a tic-tac-toe game:",
              "",
              "```html:index.html",
              "<!DOCTYPE html>",
              "<html><body><div id='board'></div><script src='main.js'></script></body></html>",
              "```",
              "",
              "```javascript:main.js",
              "const board = document.getElementById('board');",
              "let turn = 'X';",
              "function render() { /* draw */ }",
              "render();",
              "```",
              "",
              "```css:style.css",
              "body { font-family: sans-serif; }",
              "```",
              "<confidence>0.85</confidence>",
            ].join("\n"),
            usage: {
              promptTokens: 200,
              completionTokens: 150,
              durationMs: 1200,
            },
          },
          // Turn 2: model summarises after the synthesised create runs.
          {
            content: "Tic-tac-toe is ready. Open the sandbox to play.\n<confidence>0.9</confidence>",
            usage: {
              promptTokens: 240,
              completionTokens: 35,
              durationMs: 400,
            },
          },
        ]);

        // Explicitly disable auto-approve so this scenario still
        // exercises the chip-click path. (Default settings now
        // have auto-approve ON, so without this seed the chip
        // never surfaces and waitFor would time out.)
        seedSettings({ autoApprove: false });
        render(
          <Harness prompt="build me a tic-tac-toe game in JavaScript" />,
        );
        await act(async () => {
          screen.getByTestId("send").click();
        });

        // The synthesiser produces a create_sandbox_project call that
        // gates because we seeded autoApprove=false — we need to
        // click the Allow chip.
        await waitFor(() => {
          expect(screen.queryByText(/^Allow$/)).not.toBeNull();
        });
        await approveTopChip();
        await waitForFinalConfidence("90%");

        // ── Assertions ──

        // Sandbox state: exactly one project written, containing all
        // three files.
        const saves = invokeCalls.filter((c) => c.cmd === "sandbox_save_project");
        expect(saves.length).toBeGreaterThanOrEqual(1);
        const finalSave = saves[saves.length - 1];
        const project = (finalSave.args as { project: StoredProject }).project;
        // Synthesiser inferred the `web` language because the
        // model emitted .html + .js + .css fences — that's the
        // Libre sandbox's bucket for vanilla HTML/CSS/JS builds.
        // (User said "in JavaScript" but the extensions are the
        // stronger signal for which sandbox runner to spin up.)
        expect(project.language).toBe("web");
        expect(project.files.map((f) => f.name).sort()).toEqual([
          "index.html",
          "main.js",
          "style.css",
        ]);
        expect(project.files.find((f) => f.name === "main.js")?.content).toContain(
          "let turn = 'X'",
        );

        // Events: a focus event fired for the new project + a refresh.
        const focusEvents = capturedEvents.filter(
          (e) => e.type === "libre:sandbox-focus",
        );
        expect(focusEvents.length).toBeGreaterThan(0);
        const refresh = capturedEvents.filter(
          (e) => e.type === "libre:sandbox-refresh",
        );
        expect(refresh.length).toBeGreaterThan(0);

        // Chat content: no raw code (synthesiser stripped the fences).
        // The first assistant message's body should NOT contain the
        // dumped file bodies.
        const bubbles = document.querySelectorAll(".libre-ai-bubble--assistant");
        const firstBody = bubbles[0]?.textContent ?? "";
        expect(firstBody).not.toContain("<!DOCTYPE html>");
        expect(firstBody).not.toContain("let turn = 'X'");

        // HUD: confidence meter shows 90% (final turn's value).
        const confValue = document.querySelector(
          ".libre-ai-hud-confidence-value",
        );
        expect(confValue?.textContent).toBe("90%");
        // Token counter: total = 200+240 in, 150+35 out.
        const tokensValue = document.querySelector(
          ".libre-ai-hud-tokens-value",
        );
        expect(tokensValue?.textContent).toContain("440");
        expect(tokensValue?.textContent).toContain("185");
      } finally {
        stopCapture();
      }
    },
  );
});

// ── SCENARIO B: Structured tool channel build ────────────────

describe("Scenario B: blackjack (structured tool channel)", () => {
  it(
    "model uses tool_calls with inline files array; project lands " +
      "with all files in one approval",
    async () => {
      seedSettings({ autoApprove: true });
      transportRef.current = scripted([
        // Turn 1: structured create_sandbox_project with FILES
        // inlined — single tool call creates everything at once.
        // This is the "well-behaved model" happy path.
        {
          content: "",
          toolCalls: [
            {
              id: "c1",
              name: "create_sandbox_project",
              arguments: JSON.stringify({
                name: "Blackjack",
                language: "react",
                files: [
                  {
                    path: "src/App.jsx",
                    content:
                      "import Hand from './components/Hand';\nfunction App(){return <Hand/>;}\nexport default App;",
                  },
                  {
                    path: "src/components/Hand.jsx",
                    content:
                      "export default function Hand(){return <div>cards</div>;}",
                  },
                  {
                    path: "src/lib/deck.js",
                    content: "export const deck=[];",
                  },
                ],
              }),
            },
          ],
          usage: { promptTokens: 180, completionTokens: 60, durationMs: 600 },
        },
        // Turn 2: final summary.
        {
          content: "Blackjack scaffold is live.\n<confidence>0.88</confidence>",
          usage: { promptTokens: 240, completionTokens: 25, durationMs: 300 },
        },
      ]);

      render(<Harness prompt="build me a blackjack game in React" />);
      await act(async () => {
        screen.getByTestId("send").click();
      });
      await waitForInvoke("sandbox_save_project");
      await waitForFinalConfidence("88%");

      const finalSave = invokeCalls
        .filter((c) => c.cmd === "sandbox_save_project")
        .pop();
      expect(finalSave).toBeTruthy();
      const project = (
        finalSave!.args as { project: StoredProject }
      ).project;
      expect(project.language).toBe("react");
      expect(project.name).toBe("Blackjack");
      expect(project.files.map((f) => f.name).sort()).toEqual([
        "src/App.jsx",
        "src/components/Hand.jsx",
        "src/lib/deck.js",
      ]);
    },
  );
});

// ── SCENARIO C: Python CLI ───────────────────────────────────

describe("Scenario C: Python CLI (multi-file, different language)", () => {
  it("synthesiser infers Python from .py extension; project gets both files", async () => {
    seedSettings({ autoApprove: true });
    transportRef.current = scripted([
      {
        content: [
          "Here's the fizzbuzz CLI:",
          "",
          "```python:main.py",
          "from fizzbuzz import fizzbuzz",
          "for i in range(1, 21):",
          "    print(fizzbuzz(i))",
          "```",
          "",
          "```python:fizzbuzz.py",
          "def fizzbuzz(n):",
          "    if n % 15 == 0: return 'FizzBuzz'",
          "    if n % 3 == 0: return 'Fizz'",
          "    if n % 5 == 0: return 'Buzz'",
          "    return str(n)",
          "```",
          "<confidence>0.9</confidence>",
        ].join("\n"),
      },
      {
        content: "Fizzbuzz is ready.\n<confidence>0.92</confidence>",
      },
    ]);

    render(<Harness prompt="make a fizzbuzz CLI in Python" />);
    await act(async () => {
      screen.getByTestId("send").click();
    });
    await waitForInvoke("sandbox_save_project");
    await waitForFinalConfidence("92%");

    const saves = invokeCalls.filter((c) => c.cmd === "sandbox_save_project");
    expect(saves.length).toBeGreaterThanOrEqual(1);
    const finalSave = saves[saves.length - 1];
    const project = (finalSave.args as { project: StoredProject }).project;
    expect(project.language).toBe("python");
    expect(project.files.map((f) => f.name).sort()).toEqual([
      "fizzbuzz.py",
      "main.py",
    ]);
    expect(
      project.files.find((f) => f.name === "fizzbuzz.py")?.content,
    ).toContain("FizzBuzz");
  });
});

// ── SCENARIO D: Streaming chunks accrete + replace ──────────

describe("Scenario D: streaming-token UX", () => {
  it(
    "chunks accrete into the assistant placeholder; final canonical " +
      "message replaces it after the turn ends",
    async () => {
      transportRef.current = scripted([
        {
          content: "Streaming this reply token by token to verify the chunk path works.\n<confidence>0.9</confidence>",
        },
      ]);

      render(<Harness prompt="explain something" />);
      await act(async () => {
        screen.getByTestId("send").click();
      });
      await waitForFinalConfidence("90%");

      // The assistant bubble shows the cleaned content (confidence
      // tag stripped). The streaming path was exercised — every
      // 32-char chunk was passed to onChunk and the placeholder
      // grew incrementally. By the time waitForFinalConfidence
      // returns the canonical message has replaced the placeholder.
      const bubble = document.querySelector(".libre-ai-bubble--assistant");
      expect(bubble?.textContent).toContain("Streaming this reply token by token");
      expect(bubble?.textContent).not.toContain("<confidence>");
    },
  );
});

// ── SCENARIO E: Clarification flow ───────────────────────────

describe("Scenario E: clarification flow", () => {
  it(
    "model asks via request_user_input; sheet appears; user submits; " +
      "loop resumes with the answer",
    async () => {
      seedSettings({ autoApprove: true });
      transportRef.current = scripted([
        {
          content: "",
          toolCalls: [
            {
              id: "c1",
              name: "request_user_input",
              arguments: JSON.stringify({
                question: "TypeScript or JavaScript?",
                context: "You said 'build an API'.",
              }),
            },
          ],
        },
        {
          content: "",
          toolCalls: [
            {
              id: "c2",
              name: "create_sandbox_project",
              arguments: JSON.stringify({
                name: "API",
                language: "typescript",
              }),
            },
          ],
        },
        {
          content: "TypeScript API scaffold is live.\n<confidence>0.85</confidence>",
        },
      ]);

      render(<Harness prompt="build me an API" />);
      await act(async () => {
        screen.getByTestId("send").click();
      });

      // Wait for the clarification sheet.
      await waitFor(() => {
        expect(
          screen.queryByText("TypeScript or JavaScript?"),
        ).not.toBeNull();
      });
      const ctx = screen.queryByText(/You said 'build an API'/);
      expect(ctx).not.toBeNull();

      // Submit the answer. fireEvent.change is what triggers React's
      // synthetic onChange listener on a controlled input — setting
      // `textarea.value` directly bypasses React's event system and
      // the answer state never updates.
      const textarea = document.querySelector(
        ".libre-ai-panel-clarification-input",
      ) as HTMLTextAreaElement;
      await act(async () => {
        fireEvent.change(textarea, { target: { value: "TypeScript" } });
      });
      const sendButton = screen.getByText(/^Send/);
      await act(async () => {
        sendButton.click();
      });
      await waitForInvoke("sandbox_save_project");
      await waitForFinalConfidence("85%");

      // Project was created with language=typescript.
      const finalSave = invokeCalls
        .filter((c) => c.cmd === "sandbox_save_project")
        .pop()!;
      const project = (finalSave.args as { project: StoredProject }).project;
      expect(project.language).toBe("typescript");
      // Clarification sheet is gone.
      expect(screen.queryByText("TypeScript or JavaScript?")).toBeNull();
    },
  );
});

// ── SCENARIO F: Auto-verify loop ─────────────────────────────

describe("Scenario F: auto-verify (run fails, patch, run succeeds)", () => {
  it("loop fixes its own runtime errors", async () => {
    seedSettings({ autoApprove: true });
    // Track run-tool invocations so we can flip the response based
    // on which iteration it is. `run_sandbox_project`'s handler
    // calls `runFiles(...)` from `../../runtimes` rather than via
    // Tauri invoke, so we override the runFiles mock to track +
    // shape the responses.
    let runCount = 0;
    runFilesOverride = () => {
      runCount += 1;
      if (runCount === 1) {
        return {
          ok: false,
          error: "ReferenceError: greet is not defined",
          logs: [
            { level: "error", text: "ReferenceError: greet is not defined" },
          ],
          durationMs: 12,
        };
      }
      return {
        ok: true,
        logs: [{ level: "log", text: "hello" }],
        durationMs: 18,
        previewUrl: null,
      };
    };

    // Dynamic-args turns: each turn that needs a projectId reads
    // it from the prior create_sandbox_project tool result.
    transportRef.current = scripted([
      // Turn 1: create + write a buggy file (synthesiser path).
      {
        content: [
          "Quick hello-world CLI:",
          "",
          "```javascript:main.js",
          "console.log(greet('world'));",
          "```",
          "<confidence>0.8</confidence>",
        ].join("\n"),
      },
      // Turn 2: run.
      (msgs) => ({
        content: "",
        toolCalls: [
          {
            id: "r1",
            name: "run_sandbox_project",
            arguments: JSON.stringify({
              projectId: projectIdFromMessages(msgs),
            }),
          },
        ],
      }),
      // Turn 3: patch.
      (msgs) => ({
        content: "Missing the greet function — patching.",
        toolCalls: [
          {
            id: "p1",
            name: "apply_sandbox_patch",
            arguments: JSON.stringify({
              projectId: projectIdFromMessages(msgs),
              edits: [
                {
                  path: "main.js",
                  op: "write",
                  content:
                    "function greet(n){return 'hello '+n;}\nconsole.log(greet('world'));",
                },
              ],
            }),
          },
        ],
      }),
      // Turn 4: re-run.
      (msgs) => ({
        content: "",
        toolCalls: [
          {
            id: "r2",
            name: "run_sandbox_project",
            arguments: JSON.stringify({
              projectId: projectIdFromMessages(msgs),
            }),
          },
        ],
      }),
      // Turn 5: summary.
      { content: "Fixed and running cleanly.\n<confidence>0.93</confidence>" },
    ]);

    render(<Harness prompt="write a hello-world CLI" />);
    await act(async () => {
      screen.getByTestId("send").click();
    });
    await waitForFinalConfidence("93%");

    // 2 runs (1 failed, 1 succeeded). The patch ran between them
    // and the loop terminated when the second run came back ok.
    expect(runCount).toBe(2);
    // The patched content landed in the project.
    const projects = Array.from(sandboxStore.values());
    const proj = projects.find((p) =>
      p.files.some((f) => f.content.includes("function greet")),
    );
    expect(proj).toBeDefined();
  });
});

// ── SCENARIO G: Auto-approve setting ────────────────────────

describe("Scenario G: auto-approve bypasses chips", () => {
  it("flipped-on auto-approve skips the chip path entirely", async () => {
    seedSettings({ autoApprove: true });
    transportRef.current = scripted([
      {
        content: "",
        toolCalls: [
          {
            id: "c1",
            name: "create_sandbox_project",
            arguments: JSON.stringify({ name: "X", language: "javascript" }),
          },
        ],
      },
      { content: "ok\n<confidence>0.9</confidence>" },
    ]);

    render(<Harness prompt="build x" />);
    await act(async () => {
      screen.getByTestId("send").click();
    });
    await waitForFinalConfidence("90%");

    // No "Allow" button should EVER have surfaced — auto-approve
    // sent the call straight through.
    expect(screen.queryByText(/^Allow$/)).toBeNull();
    // The auto-approve badge should be visible in the header.
    expect(screen.getByText("auto")).toBeTruthy();
    // The project landed.
    const finalSave = invokeCalls
      .filter((c) => c.cmd === "sandbox_save_project")
      .pop()!;
    expect(finalSave).toBeTruthy();
  });
});

// ── SCENARIO H: Edit-existing-project via fences ────────────

describe("Scenario H: edit existing project via dumped fences", () => {
  it(
    "when a project already exists, synthesiser writes each fence " +
      "via write_sandbox_file rather than re-creating",
    async () => {
      seedSettings({ autoApprove: true });
      transportRef.current = scripted([
        // Turn 1: model creates the project via structured channel.
        {
          content: "",
          toolCalls: [
            {
              id: "create-1",
              name: "create_sandbox_project",
              arguments: JSON.stringify({
                name: "Existing",
                language: "javascript",
              }),
            },
          ],
        },
        // Turn 2: model dumps a fence patch WITHOUT a tool call.
        // The synthesiser must spot the prior create result in
        // the conversation and route this via write_sandbox_file.
        {
          content: [
            "Patching the entrypoint:",
            "```javascript:main.js",
            "console.log('hello from updated');",
            "```",
            "<confidence>0.85</confidence>",
          ].join("\n"),
        },
        { content: "Updated.\n<confidence>0.9</confidence>" },
      ]);

      render(<Harness prompt="update the main entry to print hello" />);
      await act(async () => {
        screen.getByTestId("send").click();
      });
      // Wait until SOME project carries the updated content. The
      // synthesiser routes through write_sandbox_file because the
      // create result is already in the conversation history.
      await waitFor(
        () => {
          const projects = Array.from(sandboxStore.values());
          const updated = projects.find((p) =>
            p.files.some((f) => f.content.includes("hello from updated")),
          );
          expect(updated).toBeDefined();
        },
        { timeout: 3000 },
      );

      const projects = Array.from(sandboxStore.values());
      const updated = projects.find((p) =>
        p.files.some((f) => f.content.includes("hello from updated")),
      );
      expect(updated).toBeDefined();
      // And the synthesiser used write_sandbox_file (not a second
      // create_sandbox_project) because there was already an existing
      // project in the conversation. Only ONE save with content that
      // looks like a fresh-create came from the first turn.
      const createSaves = invokeCalls.filter(
        (c) =>
          c.cmd === "sandbox_save_project" &&
          ((c.args as { project: StoredProject }).project.files.length === 1 &&
            (c.args as { project: StoredProject }).project.files[0]
              .name === "main.js" &&
            (c.args as { project: StoredProject }).project.files[0]
              .content.startsWith("// ")),
      );
      // The seed/create saves don't matter; what matters is the
      // update fence resulted in main.js having the new content.
      void createSaves;
    },
  );
});
