import { NextResponse } from "next/server";
import { rateLimit, getClientIp } from "@/app/lib/limiter";

const PISTON_URL = "https://emkc.org/api/v2/piston/execute";

// Safety limits
const MAX_CODE_CHARS = 40_000;
const MAX_INPUT_CHARS = 4_000;
const MAX_CASES_RUN = 12;
const MAX_STDOUT_CHARS = 8_000;
const FETCH_TIMEOUT_MS = 8_500;

function mapLanguage(lang) {
  const l = (lang || "").toLowerCase();
  if (l === "javascript") return { language: "javascript", version: "18.15.0" };
  if (l === "typescript") return { language: "typescript", version: "5.0.3" };
  if (l === "python") return { language: "python", version: "3.10.0" };
  return { language: "javascript", version: "18.15.0" };
}

function looksJsonLike(s) {
  const t = String(s ?? "").trim();
  return (
    (t.startsWith("{") && t.endsWith("}")) ||
    (t.startsWith("[") && t.endsWith("]")) ||
    (t.startsWith('"') && t.endsWith('"'))
  );
}

function normalizeOutput(value) {
  const raw = String(value ?? "").trim();

  // normalize null/true/false
  if (raw === "null") return "null";
  if (raw === "true") return "true";
  if (raw === "false") return "false";

  // normalize numbers (e.g. "01" -> "1")
  if (raw !== "" && !Number.isNaN(Number(raw)) && /^-?\d+(\.\d+)?$/.test(raw)) {
    return String(Number(raw));
  }

  // normalize JSON (object/array/string JSON)
  if (looksJsonLike(raw)) {
    try {
      return JSON.stringify(JSON.parse(raw));
    } catch {
      return raw;
    }
  }

  // everything else: keep trimmed string
  return raw;
}

function jsHarness(userCode, inputJsonString, functionName = "solve") {
  return `
"use strict";
${userCode}

function __print(v) {
  if (typeof v === "string") return process.stdout.write(v);
  if (typeof v === "number" || typeof v === "boolean") return process.stdout.write(String(v));
  try { return process.stdout.write(JSON.stringify(v)); } catch { return process.stdout.write(String(v)); }
}

(async () => {
  try {
    const __input = JSON.parse(${JSON.stringify(inputJsonString)});
    if (typeof ${functionName} !== "function") throw new Error("Missing function ${functionName}(input).");
    const __result = await ${functionName}(__input);
    __print(__result);
  } catch (e) {
    console.error(String(e && e.stack ? e.stack : e));
    process.exit(1);
  }
})();
`.trim();
}

function tsHarness(userCode, inputJsonString, functionName = "solve") {
  return `
${userCode}

function __print(v: any) {
  if (typeof v === "string") return process.stdout.write(v);
  if (typeof v === "number" || typeof v === "boolean") return process.stdout.write(String(v));
  try { return process.stdout.write(JSON.stringify(v)); } catch { return process.stdout.write(String(v)); }
}

(async () => {
  try {
    const __input = JSON.parse(${JSON.stringify(inputJsonString)});
    // @ts-ignore
    if (typeof (globalThis as any)["${functionName}"] !== "function") throw new Error("Missing function ${functionName}(input).");
    // @ts-ignore
    const __result = await (globalThis as any)["${functionName}"](__input);
    __print(__result);
  } catch (e: any) {
    console.error(String(e?.stack ?? e));
    process.exit(1);
  }
})();
`.trim();
}

function pyHarness(userCode, inputJsonString, functionName = "solve") {
  return `
import json, sys, traceback

${userCode}

def __print(v):
    if isinstance(v, str):
        sys.stdout.write(v); return
    try:
        sys.stdout.write(json.dumps(v))
    except Exception:
        sys.stdout.write(str(v))

try:
    __input = json.loads(${JSON.stringify(inputJsonString)})
    if "${functionName}" not in globals() or not callable(globals()["${functionName}"]):
        raise Exception("Missing function ${functionName}(input).")
    __result = globals()["${functionName}"](__input)
    __print(__result)
except Exception:
    traceback.print_exc()
    sys.exit(1)
`.trim();
}

async function runOnPiston(runtime, code) {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const res = await fetch(PISTON_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: controller.signal,
      body: JSON.stringify({
        language: runtime.language,
        version: runtime.version,
        files: [{ name: "main", content: code }],
      }),
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Runner error: ${text}`);
    }
    return res.json();
  } finally {
    clearTimeout(t);
  }
}

export async function POST(req) {
  try {
    // Rate limit: 30 runs per 5 minutes per IP
    const ip = getClientIp(req);
    const rl = rateLimit({ key: `run:${ip}`, limit: 30, windowMs: 5 * 60 * 1000 });
    if (!rl.allowed) {
      return NextResponse.json(
        { error: "Too many run requests. Try again later." },
        { status: 429, headers: { "Retry-After": String(Math.ceil((rl.resetAt - Date.now()) / 1000)) } }
      );
    }

    const body = await req.json();
    const {
      code,
      language,
      functionName = "solve",
      testCases = [],
      hiddenTestCases = [],
      mode = "run", // "run" | "submit"
    } = body || {};

    if (!code || typeof code !== "string") {
      return NextResponse.json({ error: "code is required" }, { status: 400 });
    }
    if (code.length > MAX_CODE_CHARS) {
      return NextResponse.json({ error: "Code is too long" }, { status: 400 });
    }

    const visible = Array.isArray(testCases) ? testCases : [];
    const hidden = Array.isArray(hiddenTestCases) ? hiddenTestCases : [];

    const casesToRun =
      mode === "submit" ? [...visible, ...hidden] : [...visible];

    if (casesToRun.length === 0) {
      return NextResponse.json({ error: "testCases are required" }, { status: 400 });
    }

    const runtime = mapLanguage(language);

    const results = [];
    let passedCount = 0;
    const started = Date.now();

    for (let i = 0; i < Math.min(casesToRun.length, MAX_CASES_RUN); i++) {
      const tc = casesToRun[i] || {};
      const name = tc.name ?? `Case ${i + 1}`;
      const input = String(tc.input ?? "null");
      const expectedOutput = String(tc.expectedOutput ?? "");

      if (input.length > MAX_INPUT_CHARS) {
        results.push({
          name,
          passed: false,
          expectedOutput,
          actualOutput: "",
          stderr: "Input too large.",
          exitCode: 1,
          runtimeMs: 0,
          hidden: mode === "submit" && i >= visible.length,
        });
        continue;
      }

      // Validate JSON input string
      try {
        JSON.parse(input);
      } catch {
        results.push({
          name,
          passed: false,
          expectedOutput,
          actualOutput: "",
          stderr: "Testcase input is not valid JSON.",
          exitCode: 1,
          runtimeMs: 0,
          hidden: mode === "submit" && i >= visible.length,
        });
        continue;
      }

      let program;
      if (runtime.language === "javascript") program = jsHarness(code, input, functionName);
      else if (runtime.language === "typescript") program = tsHarness(code, input, functionName);
      else program = pyHarness(code, input, functionName);

      const caseStart = Date.now();

      let piston;
      try {
        piston = await runOnPiston(runtime, program);
      } catch (e) {
        results.push({
          name,
          passed: false,
          expectedOutput,
          actualOutput: "",
          stderr: String(e?.message || e),
          exitCode: 1,
          runtimeMs: Date.now() - caseStart,
          hidden: mode === "submit" && i >= visible.length,
        });
        continue;
      }

      let stdout = (piston?.run?.stdout ?? "").trim();
      const stderr = (piston?.run?.stderr ?? "").trim();
      const exitCode = piston?.run?.code ?? 0;

      // Output limit
      if (stdout.length > MAX_STDOUT_CHARS) {
        stdout = stdout.slice(0, MAX_STDOUT_CHARS) + "\n...[truncated]";
      }

      const actualNorm = normalizeOutput(stdout);
      const expectedNorm = normalizeOutput(expectedOutput);

      const passed = exitCode === 0 && actualNorm === expectedNorm;
      if (passed) passedCount++;

      results.push({
        name,
        passed,
        expectedOutput,
        actualOutput: stdout,
        stderr,
        exitCode,
        runtimeMs: Date.now() - caseStart,
        hidden: mode === "submit" && i >= visible.length,
      });
    }

    const totalRuntimeMs = Date.now() - started;

    return NextResponse.json(
      {
        mode,
        passedCount,
        total: results.length,
        allPassed: passedCount === results.length,
        totalRuntimeMs,
        results,
      },
      { status: 200 }
    );
  } catch (err) {
    console.error("Error in /api/run:", err);
    return NextResponse.json({ error: "Server error running code" }, { status: 500 });
  }
}
