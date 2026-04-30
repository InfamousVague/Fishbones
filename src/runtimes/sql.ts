import type { RunResult, LogLine, TestResult } from "./types";

/// SQL via sql.js (SQLite compiled to WASM, exposed through a thin
/// JavaScript wrapper). Each Run boots a fresh in-memory database,
/// executes the user's SQL, and renders every query's result set as a
/// table-shaped LogLine. State doesn't carry between runs — this is a
/// pure "scratch query" environment, not a persistent shell.
///
/// Tests follow the same shape as other runtimes: when `testCode` is
/// supplied, it's evaluated AFTER the user code on the same DB. The
/// test format is also SQL — each `SELECT` in the test body becomes
/// one TestResult, with the row count + first-row payload compared
/// against an inline `-- expect:` comment. Example:
///
///   -- expect: 1 row, {"name": "Mochi"}
///   SELECT name FROM pets WHERE name = 'Mochi';
///
/// This intentionally trades off complex assertion grammar for
/// "anyone who can read SQL can write a test."
///
/// sql.js's WASM blob is ~1MB; it's vendored under
/// `node_modules/sql.js/dist/sql-wasm.wasm` and we point the loader
/// at it via `locateFile`.

const TIMEOUT_MS = 8000;

/// Narrow shape of the Database we actually use — `exec` for running
/// statements, `close` to release the WASM heap. The full sql.js
/// Database surface is much larger; we just need these two methods.
interface SqlDatabase {
  exec(sql: string): QueryExecResult[];
  close(): void;
}

interface QueryExecResult {
  columns: string[];
  values: Array<Array<string | number | null>>;
}

let sqlPromise: Promise<{ Database: new () => SqlDatabase }> | null = null;

async function getSql(): Promise<{ Database: new () => SqlDatabase }> {
  if (sqlPromise) return sqlPromise;
  // sql.js ships its WASM as a sibling file. The loader needs a
  // `locateFile` callback so it knows where to fetch the .wasm from
  // — Vite resolves `?url` imports to a hashed asset URL at build
  // time, which means production deploys (kata web at fishbones.academy)
  // get the WASM served from `/assets/sql-wasm-<hash>.wasm` with
  // proper caching. Dev (`vite dev`) gets the file served from
  // `node_modules/.vite/deps`.
  const initSqlJs = (await import("sql.js")).default;
  const wasmUrl = (await import("sql.js/dist/sql-wasm.wasm?url")).default;
  const SQL = await initSqlJs({
    locateFile: () => wasmUrl,
  });
  sqlPromise = Promise.resolve({
    Database: SQL.Database as unknown as new () => SqlDatabase,
  });
  return sqlPromise;
}

export async function runSql(code: string, testCode?: string): Promise<RunResult> {
  const start = performance.now();
  const isTest = !!testCode;
  const logs: LogLine[] = [];
  let err: string | undefined;
  const tests: TestResult[] = [];

  try {
    const { Database } = await getSql();
    const db = new Database();

    // ── User code ──────────────────────────────────────────
    // sql.js's `db.exec(sql)` returns Array<QueryExecResult> where
    // each entry corresponds to one statement that produced rows.
    // DDL / INSERT / UPDATE statements don't appear in the result —
    // they execute silently. We mirror that: only SELECT-shaped
    // statements show up in logs, but DDL errors still bubble.
    let userResults: QueryExecResult[] = [];
    try {
      userResults = db.exec(code);
    } catch (e) {
      err = `SQL error: ${e instanceof Error ? e.message : String(e)}`;
    }
    if (!err) {
      for (const r of userResults) {
        logs.push({ level: "log", text: formatTable(r) });
      }
      // No row-producing statement ran — emit a friendly affirmation
      // so the output pane isn't empty. Common case: the user wrote
      // `INSERT` / `UPDATE` only and didn't include a `SELECT`.
      if (userResults.length === 0) {
        logs.push({
          level: "info",
          text: "(query executed; no rows returned — add a SELECT to see data)",
        });
      }
    }

    // ── Test code ──────────────────────────────────────────
    // Walk the test SQL one statement at a time so each SELECT
    // becomes a discrete TestResult. Comments preceding the
    // statement carry the expectation string — see parseTestExpect.
    if (testCode && !err) {
      const stmts = splitSqlStatements(testCode);
      for (const stmt of stmts) {
        const expect = parseTestExpect(stmt.leadingComments);
        if (!expect) continue; // not a test row
        let actualResult: QueryExecResult | null = null;
        try {
          const all = db.exec(stmt.body);
          actualResult = all.length > 0 ? all[all.length - 1] : null;
        } catch (e) {
          tests.push({
            name: expect.name,
            passed: false,
            error: e instanceof Error ? e.message : String(e),
          });
          continue;
        }
        const rowCount = actualResult ? actualResult.values.length : 0;
        if (expect.rowCount !== undefined && rowCount !== expect.rowCount) {
          tests.push({
            name: expect.name,
            passed: false,
            error: `expected ${expect.rowCount} row(s) but got ${rowCount}`,
          });
          continue;
        }
        if (expect.firstRow !== undefined) {
          if (!actualResult || actualResult.values.length === 0) {
            tests.push({
              name: expect.name,
              passed: false,
              error: "no rows returned",
            });
            continue;
          }
          const actualRow: Record<string, unknown> = {};
          for (let i = 0; i < actualResult.columns.length; i++) {
            actualRow[actualResult.columns[i]] = actualResult.values[0][i];
          }
          if (!shallowEqual(expect.firstRow, actualRow)) {
            tests.push({
              name: expect.name,
              passed: false,
              error: `expected first row ${JSON.stringify(expect.firstRow)} but got ${JSON.stringify(actualRow)}`,
            });
            continue;
          }
        }
        tests.push({ name: expect.name, passed: true });
      }
    }

    db.close();
  } catch (e) {
    err = e instanceof Error ? e.message : String(e);
  }

  const elapsed = performance.now() - start;
  if (elapsed > TIMEOUT_MS) {
    err = err ?? `SQL run exceeded ${TIMEOUT_MS / 1000}s`;
  }

  return {
    logs,
    error: err,
    tests: isTest ? tests : undefined,
    durationMs: elapsed,
    testsExpected: isTest,
  };
}

/// Render a result set as a fixed-width text table. Cap columns at
/// 32 chars so a wide TEXT column doesn't blow out the width.
function formatTable(r: QueryExecResult): string {
  const widths = r.columns.map((c) => Math.min(Math.max(c.length, 4), 32));
  for (const row of r.values) {
    for (let i = 0; i < row.length; i++) {
      const v = row[i] === null ? "NULL" : String(row[i]);
      if (v.length > widths[i]) widths[i] = Math.min(v.length, 32);
    }
  }
  const sep = "+" + widths.map((w) => "-".repeat(w + 2)).join("+") + "+";
  const renderRow = (cells: Array<string>) =>
    "|" +
    cells
      .map((c, i) => " " + truncate(c, widths[i]).padEnd(widths[i], " ") + " ")
      .join("|") +
    "|";
  const lines: string[] = [sep, renderRow(r.columns), sep];
  for (const row of r.values) {
    lines.push(
      renderRow(row.map((v) => (v === null ? "NULL" : String(v)))),
    );
  }
  lines.push(sep);
  lines.push(`${r.values.length} row${r.values.length === 1 ? "" : "s"}`);
  return lines.join("\n");
}

function truncate(s: string, n: number): string {
  if (s.length <= n) return s;
  return s.slice(0, Math.max(1, n - 1)) + "…";
}

interface SqlStmt {
  leadingComments: string[];
  body: string;
}

/// Split a SQL blob into statements, capturing the comments that
/// precede each one as `leadingComments`. We don't try to be a
/// full SQL parser — naive `;` splitting handles the test-language
/// shape (each statement is one SELECT, no nested string literals
/// containing semicolons in the test corpus we'd write). Misparses
/// on adversarial input — fine for a scratchpad runtime.
function splitSqlStatements(s: string): SqlStmt[] {
  const stmts: SqlStmt[] = [];
  let pendingComments: string[] = [];
  let buf = "";
  let inLineComment = false;
  let inBlockComment = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    const nx = s[i + 1];
    if (inLineComment) {
      if (c === "\n") inLineComment = false;
      buf += c;
      continue;
    }
    if (inBlockComment) {
      if (c === "*" && nx === "/") {
        inBlockComment = false;
        buf += "*/";
        i++;
      } else {
        buf += c;
      }
      continue;
    }
    if (c === "-" && nx === "-") {
      inLineComment = true;
      buf += "--";
      i++;
      continue;
    }
    if (c === "/" && nx === "*") {
      inBlockComment = true;
      buf += "/*";
      i++;
      continue;
    }
    if (c === ";") {
      const trimmed = buf.trim();
      if (trimmed) {
        // Pull comment lines off the front of `buf` so they're not
        // re-included in the body. Anything else stays.
        const comments: string[] = [];
        const remaining: string[] = [];
        let bodyStarted = false;
        for (const line of trimmed.split("\n")) {
          if (!bodyStarted && /^\s*(--|\/\*)/.test(line)) {
            comments.push(line);
          } else {
            bodyStarted = true;
            remaining.push(line);
          }
        }
        stmts.push({
          leadingComments: [...pendingComments, ...comments],
          body: remaining.join("\n").trim(),
        });
        pendingComments = [];
      }
      buf = "";
      continue;
    }
    buf += c;
  }
  // Trailing chunk without a `;` — only counts if it parsed as a
  // real body; bare comments at end-of-file are dropped.
  const tail = buf.trim();
  if (tail && !/^(?:--|\/\*)/.test(tail)) {
    stmts.push({ leadingComments: pendingComments, body: tail });
  }
  return stmts;
}

interface TestExpectation {
  name: string;
  rowCount?: number;
  firstRow?: Record<string, unknown>;
}

/// Read leading comments for an `expect:` clause. Two shapes:
///   `-- expect: 3 rows`
///   `-- expect: 1 row, {"name": "Mochi"}`
/// The first row payload is JSON. A name comment (`-- test: <text>`)
/// gives the row a custom title; default name is the first 60 chars
/// of the SQL body.
function parseTestExpect(comments: string[]): TestExpectation | null {
  let rowCount: number | undefined;
  let firstRow: Record<string, unknown> | undefined;
  let name: string | undefined;
  for (const raw of comments) {
    const line = raw.replace(/^\s*--\s*/, "").trim();
    const expectMatch = /^expect:\s*(.+)$/i.exec(line);
    if (expectMatch) {
      const payload = expectMatch[1];
      const rowMatch = /^(\d+)\s+rows?(?:\s*,\s*(\{.*\}))?$/i.exec(payload);
      if (rowMatch) {
        rowCount = parseInt(rowMatch[1], 10);
        if (rowMatch[2]) {
          try {
            firstRow = JSON.parse(rowMatch[2]) as Record<string, unknown>;
          } catch {
            // ignore parse error; the assertion just won't apply
          }
        }
        continue;
      }
      // Bare JSON without a row-count prefix — treat as a "first row equals" check
      try {
        firstRow = JSON.parse(payload) as Record<string, unknown>;
      } catch {
        // ignore
      }
      continue;
    }
    const nameMatch = /^test:\s*(.+)$/i.exec(line);
    if (nameMatch) name = nameMatch[1];
  }
  if (rowCount === undefined && firstRow === undefined) return null;
  return {
    name: name ?? "sql test",
    rowCount,
    firstRow,
  };
}

function shallowEqual(a: Record<string, unknown>, b: Record<string, unknown>): boolean {
  const aKeys = Object.keys(a);
  for (const k of aKeys) {
    // Compare with weak equality so a JSON-parsed `1` matches a
    // SQL-returned number, and a string matches a string.
    if (a[k] !== b[k]) return false;
  }
  return true;
}
