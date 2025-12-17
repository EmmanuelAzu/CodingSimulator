// app/api/generate-questions/route.js
import OpenAI from "openai";
import { NextResponse } from "next/server";
import { rateLimit, getClientIp, validateDocsUrl } from "@/app/lib/limiter";

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

function normalizeLanguage(lang) {
  const l = (lang || "").toLowerCase();
  if (l === "python") return "python";
  if (l === "typescript") return "typescript";
  return "javascript";
}

function starterTemplate(lang) {
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

function starterLooksOk(starterCode, lang) {
  const sc = String(starterCode || "");
  const looksPy = sc.includes("def solve");
  const looksJS =
    sc.includes("export function solve") || sc.includes("function solve");
  return lang === "python" ? looksPy : looksJS;
}

function ensureExactlyThreeHints(hints) {
  const base = Array.isArray(hints) ? hints.filter(Boolean).map(String) : [];
  const trimmed = base.slice(0, 3);
  const filler = [
    "Start by carefully matching the input JSON shape to the variables you need.",
    "Write the rule as a small helper step (even mentally), then apply it to all required parts.",
    "Test your logic on the provided example by hand and confirm it matches the expected output.",
  ];
  let i = 0;
  while (trimmed.length < 3) {
    trimmed.push(filler[i] || filler[filler.length - 1]);
    i += 1;
  }
  return trimmed;
}

function coerceString(val, fallback = "") {
  if (val === null || val === undefined) return fallback;
  return String(val);
}

function coerceDifficulty(val, fallback = "beginner") {
  const d = String(val || "").toLowerCase().trim();
  if (d === "beginner" || d === "intermediate" || d === "advanced") return d;
  return fallback;
}

function sanitizeCase(tc, fallbackName) {
  const t = tc || {};
  const name = coerceString(t.name, fallbackName);
  const input = coerceString(t.input, "null"); // must be valid JSON string; "null" is valid JSON
  const expectedOutput = coerceString(t.expectedOutput, "null");
  const explanation = coerceString(t.explanation, "");
  return { name, input, expectedOutput, explanation };
}

export async function POST(req) {
  try {
    // Rate limit: 10 requests per 5 minutes per IP
    const ip = getClientIp(req);
    const rl = rateLimit({
      key: `gen:${ip}`,
      limit: 10,
      windowMs: 5 * 60 * 1000,
    });
    if (!rl.allowed) {
      return NextResponse.json(
        { error: "Too many generate requests. Try again later." },
        {
          status: 429,
          headers: {
            "Retry-After": String(
              Math.ceil((rl.resetAt - Date.now()) / 1000)
            ),
          },
        }
      );
    }

    const body = await req.json();
    const { docsUrl, language } = body;

    const v = validateDocsUrl(docsUrl);
    if (!v.ok) {
      return NextResponse.json({ error: v.error }, { status: 400 });
    }

    const lang = normalizeLanguage(language);

    const prompt = `
You are CodingSim: a friendly, game-like coding mentor who turns documentation into engaging, guided coding challenges.

Documentation URL:
${v.value}

Selected language (MUST follow): ${lang}

GOAL:
Create EXACTLY 5 coding exercises based on the docs page topic.
They must feel like a mini-lesson + a mission, not just a bland task.

HARD REQUIREMENTS (must follow):
- EXACTLY 5 questions
- Each question tests a different concept/angle from the docs (different use-case or edge-case)
- Each question can be solved by implementing solve(input)
- Runner calls solve(input) where input = JSON.parse(testCase.input)
- Return value is compared to expectedOutput

STARTER CODE RULES:
- starterCode MUST be in ${lang} ONLY.
- Python: def solve(input):
- JS/TS: export function solve(input) { ... }
- Do NOT use any other function name.

TEST RULES:
- 2–3 visible testCases
- 3–5 hiddenTestCases
- Hidden tests must include at least 2 edge cases that prevent trivial hardcoding
- Every testCase.input MUST be VALID JSON (as a string)
- expectedOutput MUST be a plain string representing the final return value

ENGAGEMENT / TEACHING STYLE (must enforce in the text you generate):
For EACH question:
1) "concept" must be 1–2 sentences and start with: "You will learn..."
2) "question" MUST be structured with these exact sections (use markdown-like headings inside the string):
   - ### Story (1–2 lines, fun scenario)
   - ### Concept Quick-Recap (2–4 lines, explain the idea from the docs in simple words)
   - ### Visual (ASCII diagram OR step flow; must be included)
   - ### Task (clear objective)
   - ### Input (describe the JSON shape precisely)
   - ### Output (describe exactly what solve returns)
   - ### Examples (include 1 worked example: show input -> reasoning -> output)
   - ### Edge Cases (list 3 bullets)
   - ### Constraints (1–3 bullets, e.g. time/space or rules)
3) "instructions" MUST be step-by-step (numbered list) and include:
   - "Plan" (what to do first)
   - "Implementation Steps"
   - "Complexity Target" (even if approximate)
4) "hints" MUST be progressive: hint 1 gentle, hint 2 more direct, hint 3 basically gives the approach (no full code).
5) Difficulty distribution across the 5:
   - 2 beginner, 2 intermediate, 1 advanced (exactly)

VISUAL REQUIREMENT EXAMPLES (pick one per question, must be ASCII):
- Flow:
  input -> parse -> transform -> validate -> output
- State machine:
  [START] -> [RULE A] -> [RULE B] -> [DONE]
- Data shape:
  input: { items: [ ... ], mode: "..." }

OUTPUT:
Return ONLY valid JSON EXACTLY with this schema (no extra top-level keys):

{
  "questions": [
    {
      "title": "short title",
      "concept": "1–2 sentence explanation",
      "question": "full question text",
      "functionName": "solve",
      "starterCode": "starter code for solve(input) in ${lang}",
      "instructions": "what the user must do",
      "hints": ["hint 1", "hint 2", "hint 3"],
      "difficulty": "beginner | intermediate | advanced",
      "testCases": [
        { "name": "Case 1", "input": "VALID JSON string", "expectedOutput": "string", "explanation": "1–2 sentences" }
      ],
      "hiddenTestCases": [
        { "name": "Hidden 1", "input": "VALID JSON string", "expectedOutput": "string", "explanation": "short explanation" }
      ]
    }
  ]
}

Formatting rules:
- Return ONLY the JSON object. No extra text.
- Use \\n inside strings, not raw line breaks.
`.trim();

    const completion = await client.chat.completions.create({
      model: "gpt-4.1-mini",
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content:
            "You are CodingSim: an upbeat coding mentor. You ONLY output valid JSON matching the schema. Every question must include a quick recap, an ASCII visual, and a worked example inside the question text.",
        },
        { role: "user", content: prompt },
      ],
      max_completion_tokens: 2800,
    });

    const raw = completion.choices[0]?.message?.content;
    if (!raw) {
      return NextResponse.json(
        { error: "No content returned from model" },
        { status: 500 }
      );
    }

    let payload;
    try {
      payload = JSON.parse(raw);
    } catch (e) {
      console.error("Invalid JSON from model:", e, raw);
      return NextResponse.json(
        { error: "Model returned invalid JSON" },
        { status: 500 }
      );
    }

    if (!payload.questions || !Array.isArray(payload.questions)) {
      return NextResponse.json(
        { error: "Model response missing 'questions' array" },
        { status: 500 }
      );
    }

    // Normalize + enforce basic shape/caps
    payload.questions = payload.questions.slice(0, 5).map((q, idx) => {
      const qq = q || {};
      qq.functionName = "solve";

      // ensure core fields are strings
      qq.title = coerceString(qq.title, `Challenge ${idx + 1}`);
      qq.concept = coerceString(qq.concept, "You will learn how to apply the documented concept.");
      qq.question = coerceString(qq.question, "");
      qq.instructions = coerceString(qq.instructions, "");
      qq.difficulty = coerceDifficulty(qq.difficulty, "beginner");

      // starter code
      if (!starterLooksOk(qq.starterCode, lang)) {
        qq.starterCode = starterTemplate(lang);
      } else {
        qq.starterCode = coerceString(qq.starterCode, starterTemplate(lang));
      }

      // hints: exactly 3, progressive
      qq.hints = ensureExactlyThreeHints(qq.hints);

      // testcases arrays
      if (!Array.isArray(qq.testCases)) qq.testCases = [];
      if (!Array.isArray(qq.hiddenTestCases)) qq.hiddenTestCases = [];

      // cap sizes to protect runner
      qq.testCases = qq.testCases.slice(0, 3).map((tc, i) =>
        sanitizeCase(tc, `Case ${i + 1}`)
      );
      qq.hiddenTestCases = qq.hiddenTestCases.slice(0, 6).map((tc, i) =>
        sanitizeCase(tc, `Hidden ${i + 1}`)
      );

      // Ensure minimum counts (best-effort, without inventing “docs content” ourselves)
      // Visible: at least 2
      while (qq.testCases.length < 2) {
        qq.testCases.push(
          sanitizeCase(
            {
              name: `Case ${qq.testCases.length + 1}`,
              input: "null",
              expectedOutput: "null",
              explanation: "Basic sanity check.",
            },
            `Case ${qq.testCases.length + 1}`
          )
        );
      }
      // Hidden: at least 3
      while (qq.hiddenTestCases.length < 3) {
        qq.hiddenTestCases.push(
          sanitizeCase(
            {
              name: `Hidden ${qq.hiddenTestCases.length + 1}`,
              input: "null",
              expectedOutput: "null",
              explanation: "Hidden sanity check / edge coverage.",
            },
            `Hidden ${qq.hiddenTestCases.length + 1}`
          )
        );
      }

      return qq;
    });

    return NextResponse.json(payload, { status: 200 });
  } catch (err) {
    console.error("Error in /api/generate-questions:", err);
    return NextResponse.json(
      { error: "Server error generating questions" },
      { status: 500 }
    );
  }
}
