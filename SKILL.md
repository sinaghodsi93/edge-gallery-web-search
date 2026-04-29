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
QUERY: <echo of normalized query>

ASK: <a clarifying question to relay back to the user>   (only when results
ASK_REASON: <weather_city_missing | ambiguous_term | no_info>     are weak)

WEATHER:                       (only when the query is weather-related)
- place: <resolved city, region, country>
- observed: <local time>
- conditions: <e.g. Partly cloudy>
- temperature: <C and F, plus feels-like>
- today min .. / max ..
- humidity / wind / precipitation
- source: <wttr.in URL>

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

Filler like "what is", "tell me about", "current" is stripped automatically before searching, so you can pass the user's phrasing through if convenient. For weather queries (any language: weather/wetter/tiempo/météo/погода/天気/날씨/طقس…), live conditions come from wttr.in and are returned in the WEATHER block.

If the result text contains an `ASK:` line, the search was unable to give a confident answer. **Do not guess or fabricate.** Reply to the user with that single clarifying question (translated to the user's language) and stop — wait for their next message before searching again. The `ASK_REASON` tells you why:

- `weather_city_missing` — weather intent but no resolvable city. Ask which place.
- `ambiguous_term` — multiple plausible meanings. Ask which one, listing the options from the hint.
- `no_info` — nothing came back. Ask the user to rephrase or add a distinguishing detail (full name, year, location, context).

If the result text contains `NO_DIRECT_INFO_FOUND` (and no `ASK:` was provided), no source returned usable content — say so to the user and offer the `CANDIDATE_LINKS` (if any).

**Constraints:**

- Provide a concise answer (1–4 complete sentences) grounded in the returned text. Always end with a finished sentence. Your response **must be written in the same language** as the user's original prompt.
- Prefer `WEATHER` (for weather queries) and then `ANSWER` / `ABSTRACT` / `DEFINITION` when present — they are direct, structured answers. Otherwise synthesize from `WIKIPEDIA` and `PAGES`, and cite the most relevant source URL inline.
- If the user's exact question is not answered by the returned text, briefly acknowledge this, then proactively offer the closest related fact you *did* find rather than guessing. If `ASK:` is present, prefer asking that clarifying question over offering a partial guess.
- Do not invent details that aren't in the returned text. If a section is absent, treat it as missing data, not as a negative answer.
- Quote at most ~125 characters from any single source; paraphrase otherwise.
