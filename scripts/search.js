// Web Search skill — multi-source: DuckDuckGo + Wikipedia + Jina Reader.
// Usage (Edge Gallery webview / Node 18+): search(query) -> Promise<object>
// CLI:  node scripts/search.js "your query"
//
// Strategy (each layer is best-effort; failures are skipped, not thrown):
//   1. DuckDuckGo Instant Answer API for direct abstracts/definitions.
//   2. Wikipedia full-text search + REST summary for the top matching
//      articles. Works for almost any noun-phrase query and is highly
//      reliable (no bot blocks).
//   3. DuckDuckGo HTML SERP scrape for organic web results.
//   4. Page content fetched via Jina Reader (https://r.jina.ai/<url>),
//      which returns clean markdown and bypasses most bot/JS walls.
//      Direct fetch is used as a fallback if Jina fails.

const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) ' +
  'AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

const MAX_PAGES = 3;
const MAX_PAGES_DEEP = 5; // additional pages fetched in escalation
const MAX_CHARS_PER_PAGE = 3500;
const MAX_WIKI_ARTICLES = 2;
const FETCH_TIMEOUT_MS = 10000;
const MIN_GOOD_PAGES = 2;   // below this, escalate
const MIN_PAGE_CHARS = 400; // a page is "substantive" only above this

async function fetchWithTimeout(url, opts = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    return await fetch(url, { ...opts, signal: ctrl.signal });
  } finally {
    clearTimeout(timer);
  }
}

function stripHtml(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(parseInt(n, 10)))
    .replace(/\s+/g, ' ')
    .trim();
}

async function instantAnswer(query) {
  const url =
    'https://api.duckduckgo.com/?q=' +
    encodeURIComponent(query) +
    '&format=json&no_html=1&skip_disambig=1';
  try {
    const res = await fetchWithTimeout(url, {
      headers: { Accept: 'application/json', 'User-Agent': UA },
    });
    if (!res.ok) return {};
    return await res.json();
  } catch {
    return {};
  }
}

async function wikipediaArticles(query) {
  try {
    const sUrl =
      'https://en.wikipedia.org/w/api.php?action=query&format=json' +
      '&list=search&srlimit=' +
      MAX_WIKI_ARTICLES +
      '&srsearch=' +
      encodeURIComponent(query) +
      '&origin=*';
    const sRes = await fetchWithTimeout(sUrl, {
      headers: { Accept: 'application/json', 'User-Agent': UA },
    });
    if (!sRes.ok) return [];
    const sJson = await sRes.json();
    const titles = (sJson.query && sJson.query.search ? sJson.query.search : [])
      .map((h) => h.title)
      .filter(Boolean)
      .slice(0, MAX_WIKI_ARTICLES);

    const summaries = await Promise.all(
      titles.map(async (title) => {
        try {
          const u =
            'https://en.wikipedia.org/api/rest_v1/page/summary/' +
            encodeURIComponent(title.replace(/ /g, '_'));
          const r = await fetchWithTimeout(u, {
            headers: { Accept: 'application/json', 'User-Agent': UA },
          });
          if (!r.ok) return null;
          const j = await r.json();
          if (!j.extract) return null;
          return {
            title: j.title || title,
            url:
              (j.content_urls &&
                j.content_urls.desktop &&
                j.content_urls.desktop.page) ||
              'https://en.wikipedia.org/wiki/' +
                encodeURIComponent(title.replace(/ /g, '_')),
            extract: j.extract,
          };
        } catch {
          return null;
        }
      })
    );
    return summaries.filter(Boolean);
  } catch {
    return [];
  }
}

async function bingSearchViaJina(query) {
  // Fetches Bing's SERP through Jina Reader (which returns markdown) and
  // extracts external result URLs. Used as an alternate SERP when DDG is
  // empty or blocked.
  try {
    const url =
      'https://r.jina.ai/https://www.bing.com/search?q=' +
      encodeURIComponent(query);
    const res = await fetchWithTimeout(url, {
      headers: { 'User-Agent': UA, Accept: 'text/plain, text/markdown' },
    });
    if (!res.ok) return [];
    const md = await res.text();
    const results = [];
    const seen = new Set();
    const re = /\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g;
    let m;
    while ((m = re.exec(md)) !== null) {
      const title = m[1].trim();
      const href = m[2];
      if (
        /(?:^|\.)bing\.com\//i.test(href) ||
        /(?:^|\.)microsoft\.com\//i.test(href) ||
        /(?:^|\.)microsofttranslator\.com\//i.test(href) ||
        /(?:^|\.)go\.microsoft\.com\//i.test(href) ||
        /^https?:\/\/r\.bing\.com\//i.test(href)
      )
        continue;
      if (!title || title.length < 3 || /^image\s+\d+/i.test(title)) continue;
      if (seen.has(href)) continue;
      seen.add(href);
      results.push({ title, url: href });
      if (results.length >= 8) break;
    }
    return results;
  } catch {
    return [];
  }
}

async function duckduckgoHtmlSearch(query) {
  try {
    const url =
      'https://html.duckduckgo.com/html/?q=' + encodeURIComponent(query);
    const res = await fetchWithTimeout(url, {
      headers: { 'User-Agent': UA, Accept: 'text/html' },
    });
    if (!res.ok) return [];
    const html = await res.text();
    const results = [];
    const re =
      /<a[^>]+class="[^"]*result__a[^"]*"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g;
    let m;
    while ((m = re.exec(html)) !== null) {
      let href = m[1];
      const uddg = /[?&]uddg=([^&]+)/.exec(href);
      if (uddg) href = decodeURIComponent(uddg[1]);
      if (!/^https?:\/\//.test(href)) continue;
      // Drop the DDG anti-abuse redirector if it ever leaks through.
      if (/^https?:\/\/(?:[^/]*\.)?duckduckgo\.com\//i.test(href)) continue;
      const title = stripHtml(m[2]);
      results.push({ title, url: href });
      if (results.length >= 8) break;
    }
    return results;
  } catch {
    return [];
  }
}

async function fetchViaJina(url) {
  try {
    const res = await fetchWithTimeout('https://r.jina.ai/' + url, {
      headers: { 'User-Agent': UA, Accept: 'text/plain, text/markdown' },
    });
    if (!res.ok) return '';
    const text = await res.text();
    // Jina returns markdown with a small header block — keep as-is, just trim.
    return text.trim().slice(0, MAX_CHARS_PER_PAGE);
  } catch {
    return '';
  }
}

async function fetchDirect(url) {
  try {
    const res = await fetchWithTimeout(url, {
      headers: { 'User-Agent': UA, Accept: 'text/html,*/*' },
      redirect: 'follow',
    });
    if (!res.ok) return '';
    const ct = res.headers.get('content-type') || '';
    if (!/text\/html|text\/plain|application\/xhtml/i.test(ct)) return '';
    const html = await res.text();
    return stripHtml(html).slice(0, MAX_CHARS_PER_PAGE);
  } catch {
    return '';
  }
}

async function fetchPageContent(url) {
  const viaJina = await fetchViaJina(url);
  if (viaJina && viaJina.length > 200) return { content: viaJina, via: 'jina' };
  const direct = await fetchDirect(url);
  if (direct) return { content: direct, via: 'direct' };
  return { content: '', via: '' };
}

async function search(query) {
  if (!query || typeof query !== 'string') {
    throw new Error('search(query): query must be a non-empty string');
  }

  // Run the three lookups in parallel.
  const [ia, wiki, serp] = await Promise.all([
    instantAnswer(query),
    wikipediaArticles(query),
    duckduckgoHtmlSearch(query),
  ]);

  const relatedTopics = [];
  for (const t of ia.RelatedTopics || []) {
    if (t.Text && t.FirstURL) {
      relatedTopics.push({ text: t.Text, url: t.FirstURL });
    } else if (Array.isArray(t.Topics)) {
      for (const sub of t.Topics) {
        if (sub.Text && sub.FirstURL) {
          relatedTopics.push({ text: sub.Text, url: sub.FirstURL });
        }
      }
    }
    if (relatedTopics.length >= 8) break;
  }

  const wikiUrls = new Set(wiki.map((w) => w.url));
  const fetchedUrls = new Set();
  const pages = [];

  async function fetchBatch(candidates) {
    const fresh = [];
    for (const r of candidates) {
      if (!r || !r.url) continue;
      if (fetchedUrls.has(r.url)) continue;
      if (wikiUrls.has(r.url)) continue;
      fresh.push(r);
      fetchedUrls.add(r.url);
    }
    const got = await Promise.all(
      fresh.map(async (r) => {
        const { content, via } = await fetchPageContent(r.url);
        return content && content.length >= MIN_PAGE_CHARS
          ? { title: r.title, url: r.url, via, content }
          : null;
      })
    );
    for (const p of got) if (p) pages.push(p);
  }

  // Phase 1: top-N from primary SERP.
  let allResults = serp.slice();
  await fetchBatch(allResults.slice(0, MAX_PAGES));

  const escalations = [];
  const hasInstant = ia.Answer || ia.AbstractText || ia.Definition;

  // Phase 2: dig deeper if the first pass came up thin.
  if (pages.length < MIN_GOOD_PAGES && !hasInstant) {
    escalations.push('serp-deep');
    await fetchBatch(allResults.slice(MAX_PAGES, MAX_PAGES + MAX_PAGES_DEEP));
  }

  // Phase 3: alternate SERP (Bing via Jina) if DDG was empty/blocked or
  // the deep dig still hasn't produced enough content.
  if (pages.length < MIN_GOOD_PAGES && !hasInstant) {
    escalations.push('bing');
    const bing = await bingSearchViaJina(query);
    const seenUrls = new Set(allResults.map((r) => r.url));
    for (const r of bing) if (!seenUrls.has(r.url)) allResults.push(r);
    await fetchBatch(bing.slice(0, MAX_PAGES_DEEP));
  }

  // Phase 4: pull full Wikipedia article bodies via Jina if we have wiki
  // candidates but still nothing else substantive.
  if (pages.length < MIN_GOOD_PAGES && wiki.length > 0) {
    escalations.push('wiki-full');
    await fetchBatch(
      wiki.map((w) => ({ title: w.title, url: w.url })).slice(0, 2)
    );
  }

  return {
    heading: ia.Heading || '',
    answer: ia.Answer || '',
    abstract: ia.AbstractText || '',
    abstractUrl: ia.AbstractURL || '',
    definition: ia.Definition || '',
    definitionUrl: ia.DefinitionURL || '',
    relatedTopics,
    wikipedia: wiki,
    results: allResults,
    pages,
    escalations,
  };
}

if (typeof module !== 'undefined') {
  module.exports = { search };
}

if (typeof require !== 'undefined' && require.main === module) {
  const query = process.argv.slice(2).join(' ');
  search(query)
    .then((r) => {
      process.stdout.write(JSON.stringify(r, null, 2) + '\n');
    })
    .catch((err) => {
      process.stderr.write('error: ' + err.message + '\n');
      process.exit(1);
    });
}
