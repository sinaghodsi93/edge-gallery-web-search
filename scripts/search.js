// Web Search skill — DuckDuckGo Instant Answer API
// Usage (Edge Gallery webview / Node 18+): search(query) -> Promise<object>
// CLI:  node scripts/search.js "your query"

async function search(query) {
  if (!query || typeof query !== 'string') {
    throw new Error('search(query): query must be a non-empty string');
  }

  const url =
    'https://api.duckduckgo.com/?q=' +
    encodeURIComponent(query) +
    '&format=json&no_html=1&skip_disambig=1';

  const res = await fetch(url, {
    headers: { Accept: 'application/json' },
  });

  if (!res.ok) {
    throw new Error('DuckDuckGo request failed: ' + res.status);
  }

  const data = await res.json();

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

  return {
    heading: data.Heading || '',
    answer: data.Answer || '',
    abstract: data.AbstractText || '',
    abstractUrl: data.AbstractURL || '',
    definition: data.Definition || '',
    definitionUrl: data.DefinitionURL || '',
    relatedTopics,
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
