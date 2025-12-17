"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Editor from "@monaco-editor/react";
import { Inter } from "next/font/google";

const inter = Inter({ subsets: ["latin"], display: "swap" });

function defaultStarter(lang) {
  if (lang === "python") {
    return `def solve(input):
    """
    input: parsed JSON value (number/string/list/dict/etc)
    return: value that matches expectedOutput
    """
    # TODO: implement
    return None
`;
  }
  if (lang === "typescript") {
    return `export function solve(input: unknown): unknown {
  // input: parsed JSON value
  // return: value that matches expectedOutput
  return null;
}
`;
  }
  return `export function solve(input) {
  // input: parsed JSON value
  // return: value that matches expectedOutput
  return null;
}
`;
}

function starterMatchesLanguage(starterCode, lang) {
  const sc = String(starterCode || "");
  const looksPy = sc.includes("def solve");
  const looksJS = sc.includes("export function solve") || sc.includes("function solve");
  return lang === "python" ? looksPy : looksJS;
}

function CoolLogo() {
  return (
    <div className="h-9 w-9 rounded-2xl overflow-hidden shadow-sm border border-slate-200 bg-white">
      <svg viewBox="0 0 64 64" className="h-full w-full">
        <defs>
          <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#6366F1" />
            <stop offset="0.45" stopColor="#06B6D4" />
            <stop offset="1" stopColor="#22C55E" />
          </linearGradient>
          <filter id="s" x="-20%" y="-20%" width="140%" height="140%">
            <feDropShadow dx="0" dy="2" stdDeviation="2" floodOpacity="0.25" />
          </filter>
        </defs>
        <rect x="0" y="0" width="64" height="64" rx="18" fill="url(#g)" />
        <path
          d="M18 22c6-8 22-8 28 0"
          stroke="rgba(255,255,255,0.65)"
          strokeWidth="4"
          fill="none"
          strokeLinecap="round"
        />
        <path
          d="M18 42c6 8 22 8 28 0"
          stroke="rgba(255,255,255,0.65)"
          strokeWidth="4"
          fill="none"
          strokeLinecap="round"
        />
        <g filter="url(#s)">
          <text
            x="32"
            y="39"
            textAnchor="middle"
            fontSize="20"
            fontWeight="800"
            fill="white"
            fontFamily="ui-sans-serif, system-ui, -apple-system, Segoe UI, Inter"
          >
            CS
          </text>
        </g>
      </svg>
    </div>
  );
}

export default function Home() {
  const [docsUrl, setDocsUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const [questions, setQuestions] = useState([]);
  const [error, setError] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);

  const [code, setCode] = useState("");
  const [activeTab, setActiveTab] = useState("testcases");
  const [activeCaseIndex, setActiveCaseIndex] = useState(0);
  const [language, setLanguage] = useState("javascript");

  const [toast, setToast] = useState("");

  // header collapse + persisted prefs
  const [headerCollapsed, setHeaderCollapsed] = useState(false);

  // runner result
  const [runLoading, setRunLoading] = useState(false);
  const [runResult, setRunResult] = useState(null);

  const toastTimer = useRef(null);

  // Approx header heights (px) used for editor sizing
  const headerH = headerCollapsed ? 56 : 124;

  // ---- Load prefs ----
  useEffect(() => {
    try {
      const savedLang = localStorage.getItem("cs:language");
      const savedUrl = localStorage.getItem("cs:docsUrl");
      const savedCollapsed = localStorage.getItem("cs:headerCollapsed");

      if (savedLang) setLanguage(savedLang);
      if (savedUrl) setDocsUrl(savedUrl);
      if (savedCollapsed === "true") setHeaderCollapsed(true);
    } catch {}
  }, []);

  // ---- Save prefs ----
  useEffect(() => {
    try {
      localStorage.setItem("cs:language", language);
    } catch {}
  }, [language]);

  useEffect(() => {
    try {
      localStorage.setItem("cs:docsUrl", docsUrl);
    } catch {}
  }, [docsUrl]);

  useEffect(() => {
    try {
      localStorage.setItem("cs:headerCollapsed", String(headerCollapsed));
    } catch {}
  }, [headerCollapsed]);

  function popToast(msg, ms = 1400) {
    setToast(msg);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(""), ms);
  }

  const currentQuestion =
    questions.length > 0 ? questions[Math.min(selectedIndex, questions.length - 1)] : null;

  // sync starter code & enforce correct language
  useEffect(() => {
    if (!currentQuestion) return;
    const sc = currentQuestion.starterCode || "";
    const ok = starterMatchesLanguage(sc, language);
    setCode(ok && sc.trim() ? sc : defaultStarter(language));
  }, [currentQuestion, language]);

  // reset testcase selection when question changes
  useEffect(() => {
    setActiveCaseIndex(0);
    setRunResult(null);
    setActiveTab("testcases");
  }, [selectedIndex]);

  // keyboard shortcuts
  useEffect(() => {
    const onKeyDown = (e) => {
      const isMac = navigator.platform.toLowerCase().includes("mac");
      const mod = isMac ? e.metaKey : e.ctrlKey;
      if (!mod) return;

      if (e.key === "Enter") {
        e.preventDefault();
        const submit = e.shiftKey;
        runCode(submit ? "submit" : "run");
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code, language, currentQuestion, questions]);

  const difficultyMeta = (difficulty) => {
    const d = (difficulty || "").toLowerCase();
    if (["beginner", "easy"].includes(d))
      return { label: difficulty || "Easy", chip: "bg-emerald-100 text-emerald-700 border-emerald-200" };
    if (["intermediate", "medium"].includes(d))
      return { label: difficulty || "Medium", chip: "bg-amber-100 text-amber-700 border-amber-200" };
    if (["advanced", "hard"].includes(d))
      return { label: difficulty || "Hard", chip: "bg-rose-100 text-rose-700 border-rose-200" };
    return { label: difficulty || "Unspecified", chip: "bg-slate-100 text-slate-700 border-slate-200" };
  };

  const meta = difficultyMeta(currentQuestion?.difficulty);

  const monacoLang =
    language === "typescript" ? "typescript" : language === "python" ? "python" : "javascript";

  const fileLabel =
    language === "python" ? "main.py" : language === "typescript" ? "main.ts" : "main.js";

  const testCases = useMemo(() => {
    const tc = currentQuestion?.testCases;
    return Array.isArray(tc) ? tc : [];
  }, [currentQuestion]);

  const hiddenTestCases = useMemo(() => {
    const tc = currentQuestion?.hiddenTestCases;
    return Array.isArray(tc) ? tc : [];
  }, [currentQuestion]);

  const activeTC =
    testCases[Math.min(activeCaseIndex, Math.max(0, testCases.length - 1))];

  function handleReset() {
    const sc = currentQuestion?.starterCode || "";
    const ok = starterMatchesLanguage(sc, language);
    setCode(ok && sc.trim() ? sc : defaultStarter(language));
  }

  async function handleGenerate(e) {
    e.preventDefault();
    setError("");
    setRunResult(null);
    setActiveTab("testcases");

    if (!docsUrl.trim()) {
      setError("Please enter a documentation URL.");
      return;
    }

    try {
      setLoading(true);

      const res = await fetch("/api/generate-questions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ docsUrl, language }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Failed to generate questions");

      const qs = data.questions || [];
      setQuestions(qs);
      setSelectedIndex(0);
      setActiveCaseIndex(0);

      // auto-collapse after success
      setHeaderCollapsed(true);

      popToast(`Generated ${qs.length} questions ✨`);
    } catch (err) {
      console.error(err);
      // IMPORTANT: keep old questions if generation fails
      setError(err.message);
      popToast("Generate failed ❌");
    } finally {
      setLoading(false);
    }
  }

  async function runCode(mode) {
    if (!currentQuestion || runLoading) return;

    setRunLoading(true);
    setRunResult(null);
    setActiveTab("output");

    try {
      const res = await fetch("/api/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          code,
          language,
          functionName: currentQuestion.functionName || "solve",
          testCases: currentQuestion.testCases || [],
          hiddenTestCases: currentQuestion.hiddenTestCases || [],
          mode,
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Run failed");

      setRunResult(data);

      // Auto-jump to first failing VISIBLE case if any
      if (!data.allPassed) {
        const firstFail = (data.results || []).findIndex((r) => !r.passed && !r.hidden);
        if (firstFail >= 0) setActiveCaseIndex(firstFail);
      }

      if (data.allPassed) {
        popToast(mode === "submit" ? "Submitted ✅ All tests passed!" : "All tests passed ✅");
      } else {
        popToast(`${data.passedCount}/${data.total} passed`);
      }
    } catch (e) {
      setRunResult({ error: String(e?.message || e) });
      popToast("Runner error ❌");
    } finally {
      setRunLoading(false);
    }
  }

  return (
    <main className={`${inter.className} h-[100dvh] bg-slate-50 text-slate-900 flex flex-col`}>
      {/* Collapsible header */}
      <header className="shrink-0 border-b border-slate-200 bg-white">
        <div className="mx-auto max-w-7xl px-3 sm:px-4">
          <div className="py-2.5 flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 min-w-0">
              <CoolLogo />
              <div className="min-w-0 leading-tight">
                <div className="text-sm font-extrabold tracking-tight truncate">
                  Coding<span className="text-indigo-600">Sim</span>
                </div>
                <div className="text-[11px] text-slate-500 hidden sm:block">
                  Ctrl/Cmd+Enter = Run • Ctrl/Cmd+Shift+Enter = Submit
                </div>
              </div>

              {currentQuestion && (
                <span className={`ml-2 px-2 py-1 rounded-full text-[11px] font-semibold border ${meta.chip}`}>
                  {meta.label}
                </span>
              )}
            </div>

            <button
              type="button"
              onClick={() => setHeaderCollapsed((v) => !v)}
              className="shrink-0 rounded-xl px-3 py-2 text-xs font-semibold bg-slate-100 border border-slate-200 hover:bg-slate-200"
              title={headerCollapsed ? "Expand" : "Collapse"}
            >
              {headerCollapsed ? "▼" : "▲"}
            </button>
          </div>

          {!headerCollapsed && (
            <div className="pb-3">
              <form onSubmit={handleGenerate} className="w-full">
                <div className="flex gap-2">
                  <input
                    type="url"
                    value={docsUrl}
                    onChange={(e) => setDocsUrl(e.target.value)}
                    placeholder="https://react.dev/reference/react/useState"
                    className="flex-1 rounded-xl bg-white border border-slate-200 px-3 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-indigo-400/60"
                  />
                  <button
                    type="submit"
                    disabled={loading}
                    className="rounded-xl px-3.5 py-2 text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-500 disabled:opacity-60"
                  >
                    {loading ? "..." : "Generate 5"}
                  </button>
                </div>

                <div className="mt-1 flex items-center justify-between">
                  <div className="text-[11px] text-rose-600">{error}</div>
                  <div className="text-[11px] text-slate-500 hidden sm:block">
                    Tip: focused docs pages work best
                  </div>
                </div>
              </form>
            </div>
          )}
        </div>
      </header>

      {/* Toast */}
      {toast && (
        <div className="fixed top-3 left-1/2 -translate-x-1/2 z-50">
          <div className="rounded-full bg-slate-900 text-white text-xs px-3 py-1.5 shadow">
            {toast}
          </div>
        </div>
      )}

      {/* Main */}
      <div className="flex-1 min-h-0">
        {currentQuestion ? (
          <div className="h-full mx-auto max-w-7xl px-3 sm:px-4 py-3 flex flex-col gap-3">
            {/* Q selector */}
            <div className="shrink-0 flex items-center justify-between gap-3">
              <div className="flex items-center gap-2 overflow-x-auto no-scrollbar">
                {questions.map((_, i) => (
                  <button
                    key={i}
                    onClick={() => setSelectedIndex(i)}
                    className={[
                      "shrink-0 px-3 py-1.5 rounded-full text-[11px] font-semibold border transition",
                      i === selectedIndex
                        ? "bg-slate-900 text-white border-slate-900"
                        : "bg-white text-slate-700 border-slate-200 hover:bg-slate-50",
                    ].join(" ")}
                  >
                    Q{i + 1}
                  </button>
                ))}
              </div>

              <div className="shrink-0 flex items-center gap-2">
                <select
                  className="bg-white border border-slate-200 text-xs rounded-xl px-2.5 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-400/60"
                  value={language}
                  onChange={(e) => setLanguage(e.target.value)}
                  title="Language"
                >
                  <option value="javascript">JavaScript</option>
                  <option value="typescript">TypeScript</option>
                  <option value="python">Python</option>
                </select>

                <div className="hidden md:block text-[11px] text-slate-500 truncate max-w-[420px]">
                  {currentQuestion.title || `Question ${selectedIndex + 1}`}
                </div>
              </div>
            </div>

            {/* Two panes */}
            <div className="flex-1 min-h-0 grid grid-cols-1 lg:grid-cols-[minmax(0,1.05fr)_minmax(0,1.2fr)] gap-3">
              {/* LEFT */}
              <section className="min-h-0 rounded-2xl bg-white border border-slate-200 overflow-hidden flex flex-col">
                <div className="shrink-0 px-4 py-3 border-b border-slate-200 flex items-center justify-between">
                  <div className="text-sm font-bold">Description</div>
                  <div className="text-[11px] text-slate-500">
                    {selectedIndex + 1}/{questions.length}
                  </div>
                </div>

                <div className="flex-1 min-h-0 overflow-y-auto px-4 py-3 space-y-4">
                  <h2 className="text-base font-extrabold tracking-tight">
                    {currentQuestion.title || `Question ${selectedIndex + 1}`}
                  </h2>

                  {currentQuestion.concept && (
                    <div className="rounded-xl bg-indigo-50 border border-indigo-100 p-3">
                      <div className="text-[11px] font-bold text-indigo-700">Concept</div>
                      <p className="text-sm text-slate-700 whitespace-pre-line mt-1 leading-relaxed">
                        {currentQuestion.concept}
                      </p>
                    </div>
                  )}

                  <div>
                    <div className="text-[11px] font-bold text-slate-600">Problem</div>
                    <p className="text-sm text-slate-800 whitespace-pre-line mt-1 leading-relaxed">
                      {currentQuestion.question}
                    </p>
                  </div>

                  {currentQuestion.instructions && (
                    <div className="rounded-xl bg-emerald-50 border border-emerald-100 p-3">
                      <div className="text-[11px] font-bold text-emerald-700">Task</div>
                      <p className="text-sm text-slate-700 mt-1 leading-relaxed">
                        {currentQuestion.instructions}
                      </p>
                    </div>
                  )}

                  {currentQuestion.hints?.length > 0 && (
                    <div className="rounded-xl bg-amber-50 border border-amber-100 p-3">
                      <div className="text-[11px] font-bold text-amber-700">Hints</div>
                      <ul className="mt-1 list-disc list-inside space-y-1 text-sm text-slate-700">
                        {currentQuestion.hints.map((h, i) => (
                          <li key={i}>{h}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              </section>

              {/* RIGHT */}
              <section className="min-h-0 rounded-2xl bg-white border border-slate-200 overflow-hidden flex flex-col">
                {/* Editor header */}
                <div className="shrink-0 px-4 py-3 border-b border-slate-200 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div className="text-sm font-bold">Code</div>
                    <span className="text-[11px] text-slate-500 font-mono">{fileLabel}</span>
                  </div>

                  <button
                    className="text-xs px-2.5 py-1.5 rounded-lg bg-slate-100 text-slate-700 border border-slate-200 hover:bg-slate-200"
                    onClick={handleReset}
                  >
                    Reset
                  </button>
                </div>

                {/* Editor fixed at 45% viewport height */}
                <div className="flex-1 min-h-0 flex flex-col">
                  <div
                    className="overflow-hidden bg-slate-950 border-b border-slate-200"
                    style={{ height: `calc((100dvh - ${headerH}px) * 0.45)` }}
                  >
                    <div className="h-9 border-b border-slate-800/70 px-3 flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className="h-2.5 w-2.5 rounded-full bg-rose-400" />
                        <span className="h-2.5 w-2.5 rounded-full bg-amber-300" />
                        <span className="h-2.5 w-2.5 rounded-full bg-emerald-300" />
                        <span className="ml-2 text-[11px] text-slate-300 font-mono">
                          implement <span className="text-sky-300">solve</span>(input)
                        </span>
                      </div>
                      <div className="text-[11px] text-slate-400 hidden sm:block">
                        Run = visible tests • Submit = visible + hidden ({hiddenTestCases.length})
                      </div>
                    </div>

                    <div className="h-[calc(100%-36px)] min-h-0">
                      <Editor
                        height="100%"
                        language={monacoLang}
                        value={code}
                        onChange={(v) => setCode(v ?? "")}
                        theme="vs-dark"
                        options={{
                          minimap: { enabled: false },
                          fontSize: 13,
                          fontLigatures: true,
                          wordWrap: "on",
                          scrollBeyondLastLine: false,
                          smoothScrolling: true,
                          padding: { top: 12, bottom: 12 },
                          cursorBlinking: "smooth",
                          cursorSmoothCaretAnimation: "on",
                          roundedSelection: true,
                          renderLineHighlight: "all",
                          bracketPairColorization: { enabled: true },
                          scrollbar: {
                            verticalScrollbarSize: 10,
                            horizontalScrollbarSize: 10,
                          },
                        }}
                      />
                    </div>
                  </div>

                  {/* Bottom scrollable panel */}
                  <div className="flex-1 min-h-0 bg-white flex flex-col">
                    <div className="sticky top-0 z-10 bg-white">
                      <div className="px-4 py-3 border-b border-slate-200 flex items-center justify-between">
                        <div className="flex gap-2">
                          <button
                            onClick={() => runCode("run")}
                            disabled={runLoading}
                            className="px-3 py-2 rounded-xl text-sm font-semibold bg-slate-100 border border-slate-200 hover:bg-slate-200 disabled:opacity-60"
                          >
                            {runLoading ? "Running..." : "Run"}
                          </button>
                          <button
                            onClick={() => runCode("submit")}
                            disabled={runLoading}
                            className="px-3 py-2 rounded-xl text-sm font-semibold text-white bg-indigo-600 hover:bg-indigo-500 disabled:opacity-60"
                          >
                            {runLoading ? "Submitting..." : "Submit"}
                          </button>
                        </div>

                        <div className="text-[11px] text-slate-500">
                          {activeTC?.name ? (
                            <>
                              Active: <span className="font-mono text-slate-800">{activeTC.name}</span>
                            </>
                          ) : (
                            <span className="font-mono">No testcases</span>
                          )}
                        </div>
                      </div>

                      <div className="flex border-b border-slate-200 text-xs">
                        <Tab active={activeTab === "testcases"} onClick={() => setActiveTab("testcases")}>
                          Testcases
                        </Tab>
                        <Tab active={activeTab === "output"} onClick={() => setActiveTab("output")}>
                          Output
                        </Tab>
                      </div>
                    </div>

                    <div className="flex-1 min-h-0 overflow-y-auto p-4 text-sm">
                      {activeTab === "testcases" ? (
                        testCases.length > 0 ? (
                          <div className="space-y-3">
                            <div className="flex gap-2 flex-wrap">
                              {testCases.map((tc, idx) => (
                                <Pill
                                  key={`${tc.name || "case"}-${idx}`}
                                  active={idx === activeCaseIndex}
                                  onClick={() => setActiveCaseIndex(idx)}
                                >
                                  {tc.name || `Case ${idx + 1}`}
                                </Pill>
                              ))}
                            </div>

                            <Block title="Example Input">{activeTC?.input || "// missing input"}</Block>
                            <Block title="Expected Output">{activeTC?.expectedOutput || "// missing expected"}</Block>

                            {activeTC?.explanation && (
                              <div className="rounded-xl bg-slate-50 border border-slate-200 p-3">
                                <div className="text-[11px] uppercase tracking-wide text-slate-500 font-semibold">
                                  Explanation
                                </div>
                                <p className="mt-1 text-sm text-slate-700 leading-relaxed">
                                  {activeTC.explanation}
                                </p>
                              </div>
                            )}
                          </div>
                        ) : (
                          <div className="rounded-xl bg-amber-50 border border-amber-200 p-3 text-sm text-amber-900">
                            No testcases returned.
                          </div>
                        )
                      ) : (
                        <OutputPanel runResult={runResult} />
                      )}
                    </div>
                  </div>
                </div>
              </section>
            </div>
          </div>
        ) : (
          <div className="h-full grid place-items-center px-4">
            <div className="max-w-xl w-full rounded-2xl bg-white border border-slate-200 p-6 text-center">
              <div className="text-lg font-extrabold tracking-tight">Ready when you are.</div>
              <p className="text-sm text-slate-600 mt-2">
                Expand the header to paste a docs URL and generate questions.
              </p>
              <button
                onClick={() => setHeaderCollapsed(false)}
                className="mt-4 inline-flex items-center justify-center rounded-xl px-4 py-2 text-sm font-semibold bg-indigo-600 text-white hover:bg-indigo-500"
              >
                Add docs URL
              </button>
            </div>
          </div>
        )}
      </div>

      <style jsx global>{`
        .no-scrollbar::-webkit-scrollbar {
          display: none;
        }
        .no-scrollbar {
          -ms-overflow-style: none;
          scrollbar-width: none;
        }
      `}</style>
    </main>
  );
}

function OutputPanel({ runResult }) {
  if (!runResult) {
    return (
      <div className="rounded-xl bg-slate-50 border border-slate-200 p-3 text-sm text-slate-700">
        Press <span className="font-bold">Run</span> or <span className="font-bold">Submit</span> to see results.
      </div>
    );
  }

  if (runResult.error) {
    return (
      <div className="rounded-xl bg-rose-50 border border-rose-200 p-3 text-sm text-rose-900">
        {runResult.error}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div
        className={[
          "rounded-xl border p-3 text-sm",
          runResult.allPassed
            ? "bg-emerald-50 border-emerald-200 text-emerald-900"
            : "bg-amber-50 border-amber-200 text-amber-900",
        ].join(" ")}
      >
        <div className="font-bold">
          {runResult.allPassed ? "All tests passed ✅" : "Some tests failed ⚠️"}
        </div>
        <div className="text-[13px] mt-1">
          {runResult.passedCount}/{runResult.total} passed • {runResult.totalRuntimeMs ?? 0}ms
        </div>
        <div className="text-[11px] text-slate-600 mt-1">
          Mode: <span className="font-mono">{runResult.mode}</span>
        </div>
      </div>

      <div className="space-y-2">
        {(runResult.results || []).map((r, idx) => (
          <div key={idx} className="rounded-xl bg-white border border-slate-200 p-3">
            <div className="flex items-center justify-between gap-2">
              <div className="font-semibold">
                {r.name}{" "}
                {r.hidden ? (
                  <span className="ml-2 text-[11px] px-2 py-0.5 rounded-full border bg-slate-50 border-slate-200 text-slate-600">
                    hidden
                  </span>
                ) : null}
              </div>
              <span
                className={[
                  "text-[11px] font-bold px-2 py-1 rounded-full border",
                  r.passed
                    ? "bg-emerald-50 border-emerald-200 text-emerald-700"
                    : "bg-rose-50 border-rose-200 text-rose-700",
                ].join(" ")}
              >
                {r.passed ? "PASS" : "FAIL"}
              </span>
            </div>

            <div className="mt-1 text-[11px] text-slate-500">
              exit={r.exitCode} • {r.runtimeMs ?? 0}ms
            </div>

            <div className="mt-2 grid grid-cols-1 md:grid-cols-2 gap-2">
              <div>
                <div className="text-[11px] uppercase tracking-wide text-slate-500 font-semibold">Expected</div>
                <pre className="rounded-lg bg-slate-50 border border-slate-200 p-2 font-mono text-xs whitespace-pre-wrap">
                  {r.expectedOutput ?? ""}
                </pre>
              </div>
              <div>
                <div className="text-[11px] uppercase tracking-wide text-slate-500 font-semibold">Actual</div>
                <pre className="rounded-lg bg-slate-50 border border-slate-200 p-2 font-mono text-xs whitespace-pre-wrap">
                  {r.actualOutput ?? ""}
                </pre>
              </div>
            </div>

            {r.stderr ? (
              <div className="mt-2">
                <div className="text-[11px] uppercase tracking-wide text-slate-500 font-semibold">Error</div>
                <pre className="rounded-lg bg-rose-50 border border-rose-200 p-2 font-mono text-xs whitespace-pre-wrap text-rose-900">
                  {r.stderr}
                </pre>
              </div>
            ) : null}
          </div>
        ))}
      </div>
    </div>
  );
}

function Tab({ active, onClick, children }) {
  return (
    <button
      onClick={onClick}
      className={[
        "px-4 py-2 font-semibold border-r border-slate-200",
        active ? "bg-white text-slate-900" : "bg-slate-50 text-slate-500 hover:bg-slate-100",
      ].join(" ")}
    >
      {children}
    </button>
  );
}

function Pill({ active, onClick, children }) {
  return (
    <button
      onClick={onClick}
      className={[
        "px-3 py-1.5 rounded-full text-xs font-semibold border",
        active
          ? "bg-slate-900 text-white border-slate-900"
          : "bg-white text-slate-700 border-slate-200 hover:bg-slate-50",
      ].join(" ")}
    >
      {children}
    </button>
  );
}

function Block({ title, children }) {
  return (
    <div className="space-y-1">
      <div className="text-[11px] uppercase tracking-wide text-slate-500 font-semibold">{title}</div>
      <pre className="rounded-xl bg-slate-50 border border-slate-200 p-3 font-mono text-xs text-slate-800 whitespace-pre-wrap">
        {children}
      </pre>
    </div>
  );
}
