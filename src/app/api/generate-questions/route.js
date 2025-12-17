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
You are CodingSim, an assistant that creates practical coding assessment questions
based on framework documentation.

Documentation URL:
${v.value}

Selected language (MUST follow): ${lang}

Task:
- Create EXACTLY 5 different LeetCode-style exercises based on the docs page topic.
- Each exercise MUST be meaningfully different (different concept/angle/edge cases).
- Each exercise MUST be solved by implementing a function named exactly: solve(input)

EXECUTION MODEL:
- Runner calls solve(input) where input = JSON.parse(testCase.input)
- The return value is printed (as JSON for arrays/objects) and compared to expectedOutput.

STARTER CODE RULES:
- starterCode MUST be in ${lang} ONLY.
- If ${lang} is python: def solve(input):
- If ${lang} is javascript/typescript: export function solve(input) { ... }
- Do NOT use any other function name.

TEST RULES:
- Provide 2–3 visible testCases (shown to user).
- Provide 3–5 hiddenTestCases (NOT shown to user).
- Hidden tests must include at least 2 edge cases that prevent trivial hardcoding.
- Every testCase.input MUST be VALID JSON (as a string).
- expectedOutput MUST be a plain string representing the final return value.
- Keep outputs simple (number/string/boolean/null/string/array/object) when possible.

Return ONLY valid JSON EXACTLY with this schema:

{
  "questions": [
    {
      "title": "short title",
      "concept": "1–2 sentence explanation",
      "question": "full question text",
      "functionName": "solve",
      "starterCode": "starter code for solve(input) in ${lang}",
      "instructions": "what the user must do",
      "hints": ["hint 1", "hint 2"],
      "difficulty": "beginner | intermediate | advanced",
      "testCases": [
        {
          "name": "Case 1",
          "input": "VALID JSON string",
          "expectedOutput": "string",
          "explanation": "1–2 sentences"
        }
      ],
      "hiddenTestCases": [
        {
          "name": "Hidden 1",
          "input": "VALID JSON string",
          "expectedOutput": "string",
          "explanation": "short explanation"
        }
      ]
    }
  ]
}

Formatting:
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
            "You are a helpful coding mentor that ONLY returns valid JSON following the user's schema.",
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

    payload.questions = payload.questions.slice(0, 5).map((q) => {
      const qq = q || {};
      qq.functionName = "solve";

      if (!starterLooksOk(qq.starterCode, lang))
        qq.starterCode = starterTemplate(lang);
      if (!Array.isArray(qq.testCases)) qq.testCases = [];
      if (!Array.isArray(qq.hiddenTestCases)) qq.hiddenTestCases = [];

      // cap sizes to protect runner
      qq.testCases = qq.testCases.slice(0, 3);
      qq.hiddenTestCases = qq.hiddenTestCases.slice(0, 6);

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
