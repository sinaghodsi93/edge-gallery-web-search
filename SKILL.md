---
name: web-search
description: Searches the web using DuckDuckGo. Returns Instant Answer abstracts when available, and otherwise scrapes the DuckDuckGo HTML SERP and fetches the top result pages so you always get usable content. No API key required.
metadata:
  homepage: https://github.com/sinaghodsi93/edge-gallery-web-search
---

# Web Search

Search the web with a two-stage strategy:

1. **Instant Answer API** (`api.duckduckgo.com`) — fast, structured
   abstracts/definitions for queries DuckDuckGo has a direct answer for.
2. **HTML SERP fallback** — when the Instant Answer is empty (the common
   case for ~90% of real queries), the skill scrapes
   `html.duckduckgo.com/html/` for organic result links and then fetches
   the actual page content from the top results, returning extracted text
   so the model has something concrete to summarize.

No API key is required.

## When to use

Invoke this skill when the user asks a factual question, requests a
definition, or wants a topic overview that benefits from up-to-date
public information (e.g. "what is X?", "who is Y?", "search the web for Z",
"latest on …").

## How it works

```
1. GET https://api.duckduckgo.com/?q=<QUERY>&format=json&no_html=1&skip_disambig=1
   -> if AbstractText / Answer / Definition is non-empty, return it.

2. Otherwise:
   GET https://html.duckduckgo.com/html/?q=<QUERY>
   -> parse <a class="result__a"> links (decoding the /l/?uddg= wrapper),
      then for the top 3 results, fetch the page and extract plain text
      (script/style/comments stripped, entities decoded, whitespace
      collapsed, capped at 4000 chars per page).
```

Each outbound request uses a desktop User-Agent and an 8s timeout.
Page-content fetches are best-effort: failures are skipped silently so a
single bad URL doesn't break the response.

## Usage

```
node scripts/search.js "<query>"
```

Programmatically:

```js
const { search } = require('./scripts/search.js');
const result = await search('your query');
```

Summarize the response in natural language. Prefer `answer` / `abstract`
/ `definition` when present; otherwise synthesize from `pages[].content`
and cite `pages[].url`.

## Parameters

- `query` (string, required): The search query in natural language.

## Output shape

```json
{
  "heading": "...",
  "answer": "...",
  "abstract": "...",
  "abstractUrl": "...",
  "definition": "...",
  "definitionUrl": "...",
  "relatedTopics": [
    { "text": "...", "url": "..." }
  ],
  "results": [
    { "title": "...", "url": "..." }
  ],
  "pages": [
    { "title": "...", "url": "...", "content": "extracted plain text…" }
  ]
}
```

- `results` and `pages` are populated **only** when the Instant Answer
  fields are empty (i.e., the fallback path ran).
- `pages[].content` is plain text with HTML stripped, capped at 4000
  characters per page.

## Tuning

These constants live at the top of `scripts/search.js`:

- `MAX_PAGES` (default `3`) — how many top SERP results to fetch.
- `MAX_CHARS_PER_PAGE` (default `4000`) — per-page text cap.
- `FETCH_TIMEOUT_MS` (default `8000`) — per-request timeout.

## Notes

- The HTML SERP endpoint is unauthenticated but unofficial; DuckDuckGo
  may change its markup. The parser targets `a.result__a` and the
  `/l/?uddg=` redirect wrapper.
- Page extraction is text-only — it does not execute JavaScript, so
  heavily client-rendered sites may yield little content. The model
  should fall back to `results[]` titles/URLs in that case.
- Respect rate limits; avoid tight loops over many queries.
