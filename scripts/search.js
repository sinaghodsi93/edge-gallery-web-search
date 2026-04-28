// Web Search skill — DuckDuckGo Instant Answer + HTML fallback
// Usage (Edge Gallery webview / Node 18+): search(query) -> Promise<object>
// CLI:  node scripts/search.js "your query"

const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) ' +
  'AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

const MAX_PAGES = 3;
const MAX_CHARS_PER_PAGE = 4000;
const FETCH_TIMEOUT_MS = 8000;

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

async function duckduckgoHtmlSearch(query) {
  const url =
    'https://html.duckduckgo.com/html/?q=' + encodeURIComponent(query);
  const res = await fetchWithTimeout(url, {
    headers: { 'User-Agent': UA, Accept: 'text/html' },
  });
  if (!res.ok) return [];
  const html = await res.text();

  const results = [];
  const re = /<a[^>]+class="[^"]*result__a[^"]*"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g;
  let m;
  while ((m = re.exec(html)) !== null) {
    let href = m[1];
    // DuckDuckGo wraps real URLs in /l/?uddg=<encoded>
    const uddg = /[?&]uddg=([^&]+)/.exec(href);
    if (uddg) href = decodeURIComponent(uddg[1]);
    if (!/^https?:\/\//.test(href)) continue;
    const title = stripHtml(m[2]);
    results.push({ title, url: href });
    if (results.length >= 8) break;
  }
  return results;
}

async function fetchPageText(url) {
  try {
    const res = await fetchWithTimeout(url, {
      headers: { 'User-Agent': UA, Accept: 'text/html,*/*' },
      redirect: 'follow',
    });
    if (!res.ok) return '';
    const ct = res.headers.get('content-type') || '';
    if (!/text\/html|text\/plain|application\/xhtml/i.test(ct)) return '';
    const html = await res.text();
    const text = stripHtml(html);
    return text.slice(0, MAX_CHARS_PER_PAGE);
  } catch {
    return '';
  }
}

async function search(query) {
  if (!query || typeof query !== 'string') {
    throw new Error('search(query): query must be a non-empty string');
  }

  const iaUrl =
    'https://api.duckduckgo.com/?q=' +
    encodeURIComponent(query) +
    '&format=json&no_html=1&skip_disambig=1';

  let data = {};
  try {
    const res = await fetchWithTimeout(iaUrl, {
      headers: { Accept: 'application/json', 'User-Agent': UA },
    });
    if (res.ok) data = await res.json();
  } catch {
    data = {};
  }

  const relatedTopics = [];
  for (const t of data.RelatedTopics || []) {
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

  const out = {
    heading: data.Heading || '',
    answer: data.Answer || '',
    abstract: data.AbstractText || '',
    abstractUrl: data.AbstractURL || '',
    definition: data.Definition || '',
    definitionUrl: data.DefinitionURL || '',
    relatedTopics,
    results: [],
    pages: [],
  };

  const hasInstant = out.answer || out.abstract || out.definition;
  if (hasInstant) return out;

  // Fallback: scrape DuckDuckGo HTML SERP and fetch top page contents.
  const serp = await duckduckgoHtmlSearch(query);
  out.results = serp;

  const targets = serp.slice(0, MAX_PAGES);
  const fetched = await Promise.all(
    targets.map(async (r) => ({
      title: r.title,
      url: r.url,
      content: await fetchPageText(r.url),
    }))
  );
  out.pages = fetched.filter((p) => p.content);

  return out;
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
