---
name: web-search
description: Searches the web for instant answers, definitions, and topic overviews using the DuckDuckGo Instant Answer API. No API key required.
metadata:
  homepage: https://github.com/sinaghodsi93/edge-gallery-web-search
---

# Web Search

Search the web using the DuckDuckGo Instant Answer API to fetch concise
answers, definitions, abstracts, and related topics for a user query.
No API key is required.

## When to use

Invoke this skill when the user asks a factual question, requests a
definition, or wants a quick topic overview that benefits from up-to-date
public information (e.g. "what is X?", "who is Y?", "search the web for Z").

## How it works

The skill calls the DuckDuckGo Instant Answer endpoint:

```
https://api.duckduckgo.com/?q=<QUERY>&format=json&no_html=1&skip_disambig=1
```

It returns a JSON payload containing fields such as `AbstractText`,
`AbstractURL`, `Heading`, `Answer`, `Definition`, and `RelatedTopics`.

## Usage

Run the bundled script with the user's query:

```
scripts/search.js "<query>"
```

The script performs the fetch and prints a compact JSON object with the
fields most useful for answering the user. Summarize that response in
natural language and cite `AbstractURL` (or the relevant `RelatedTopics`
URL) as the source.

## Parameters

- `query` (string, required): The search query in natural language.

## Output shape

```json
{
  "heading": "...",
  "answer": "...",
  "abstract": "...",
  "abstractUrl": "...",
  "relatedTopics": [
    { "text": "...", "url": "..." }
  ]
}
```

## Notes

- DuckDuckGo Instant Answer only returns content for queries it has a
  direct answer for; many queries return empty fields. When that happens,
  fall back to the `RelatedTopics` list or tell the user no instant
  answer was found.
- The endpoint is rate-limited but does not require authentication.
