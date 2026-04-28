---
name: web-search
description: Search the web for up-to-date information, news, definitions, and topic overviews. Combines DuckDuckGo Instant Answer, Wikipedia, and a reader-proxied SERP so it returns useful content for almost any query — not just the rare ones DuckDuckGo answers directly.
---

# Web Search

## Instructions

Call the `run_js` tool using `index.html` and a JSON string for `data` with the following fields:

- **query**: Required. The search topic in natural language. Prefer short keyword form (3–8 words) over long sentences — strip filler words like "what is", "tell me about", "can you find". Keep entity names, dates, and distinguishing terms. Examples: `"2026 Oscars best picture"`, `"kubernetes pod eviction signals"`, `"webgpu safari support"`. For time-sensitive or recurring topics (elections, awards, sports seasons, releases), include the year. If the user omits the year, default to the current year.
- **lang**: Required. The 2-letter language code matching the language of the `query` you provided. Use standard codes, e.g. `"en"` (English), `"es"` (Spanish), `"zh"` (Chinese), `"fr"` (French), `"de"` (German), `"ja"` (Japanese), `"ko"` (Korean), `"it"` (Italian), `"pt"` (Portuguese), `"ru"` (Russian), `"ar"` (Arabic), `"hi"` (Hindi).

The tool returns a JSON object: `{ "result": "<plain-text bundle>" }` on success, or `{ "error": "..." }` on failure. The `result` text contains these labelled sections (any may be absent):

```
QUERY: <echo>
ANSWER: <DuckDuckGo direct answer, if any>
ABSTRACT: <DuckDuckGo abstract, if any>
DEFINITION: <DuckDuckGo definition, if any>

WIKIPEDIA:
- <article title> — <url>
  <1–3 sentence extract>

PAGES:
[1] <result title> — <url>
<extracted page content, ~2500 chars>
[2] ...
```

If the result text contains `NO_DIRECT_INFO_FOUND`, no source returned usable content — say so to the user and offer the `CANDIDATE_LINKS` (if any).

**Constraints:**

- Provide a concise answer (1–4 complete sentences) grounded in the returned text. Always end with a finished sentence. Your response **must be written in the same language** as the user's original prompt.
- Prefer `ANSWER` / `ABSTRACT` / `DEFINITION` when present — they are direct, structured answers. Otherwise synthesize from `WIKIPEDIA` and `PAGES`, and cite the most relevant source URL inline.
- If the user's exact question is not answered by the returned text, briefly acknowledge this, then proactively offer the closest related fact you *did* find rather than guessing.
- Do not invent details that aren't in the returned text. If a section is absent, treat it as missing data, not as a negative answer.
- Quote at most ~125 characters from any single source; paraphrase otherwise.
