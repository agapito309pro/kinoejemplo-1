// HentaiRD — plugin de Kino para hentaird.tv
// author: Hotaru Yume · creator: hotaruyume

var BASE = 'https://hentaird.tv';

// Orden de prioridad de servidores (los lentos al final, a pedido del autor).
var PRIO = ['lulu', 'sendvid', 'streamhls', 'byse', 'streamwish', 'voe', 'vidhide'];
var SERVERS = [
  { id: 'lulu', name: 'Lulu', re: /lulu/i },
  { id: 'sendvid', name: 'Sendvid', re: /sendvid/i },
  { id: 'streamhls', name: 'StreamHLS', re: /streamhls/i },
  { id: 'byse', name: 'Byse', re: /byse/i },
  { id: 'streamwish', name: 'StreamWish', re: /streamwish|awish|wish/i },
  { id: 'voe', name: 'VOE', re: /voe/i },
  { id: 'vidhide', name: 'VidHide', re: /vidhide/i },
  { id: 'gupload', name: 'Gupload', re: /gupload/i },
  { id: 'firestream', name: 'Firestream', re: /firestream/i }
];

// ---------- utilidades ----------

function abs(u) {
  if (!u) return u;
  u = String(u).trim();
  if (u.indexOf('http:') === 0) u = 'https:' + u.slice(5);
  if (u.indexOf('https:') === 0) return u;
  if (u.indexOf('//') === 0) return 'https:' + u;
  if (u.charAt(0) === '/') return BASE + u;
  return BASE + '/' + u;
}

function stripTags(s) {
  s = String(s || '').replace(/<[^>]*>/g, ' ');
  return decodeEntities(s).replace(/\s+/g, ' ').trim();
}

function decodeEntities(s) {
  return String(s)
    .replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, function (m, code) {
      if (code.charAt(0) === '#') {
        var n;
        if (code.charAt(1) === 'x' || code.charAt(1) === 'X') n = parseInt(code.slice(2), 16);
        else n = parseInt(code.slice(1), 10);
        return n > 0 && n < 65536 ? String.fromCharCode(n) : m;
      }
      var named = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', aacute: '\u00e1', eacute: '\u00e9', iacute: '\u00ed', oacute: '\u00f3', uacute: '\u00fa', ntilde: '\u00f1', Ntilde: '\u00d1', uuml: '\u00fc' };
      return named.hasOwnProperty(code) ? named[code] : m;
    });
}

function norm(t) {
  return stripTags(t).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

function safeId(s) {
  return String(s).replace(/[^A-Za-z0-9._~-]/g, '-').slice(0, 100);
}

async function fetchText(url, opts) {
  var o = opts || {};
  o.timeoutMs = o.timeoutMs || 12000;
  var r = await kino.fetch(url, o);
  if (!r.ok) throw kino.error('unavailable', 'HTTP ' + r.status);
  return await r.text();
}

function dedupe(items) {
  var seen = {}, out = [];
  for (var i = 0; i < items.length; i++) {
    var it = items[i];
    if (it && it.id && !seen[it.id]) { seen[it.id] = true; out.push(it); }
  }
  return out;
}

// ---------- parseo de tarjetas ----------

function firstImg(inner) {
  var m = inner.match(/<img[^>]+data-src=["']([^"']+)["']/i) || inner.match(/<img[^>]+src=["']([^"']+)["']/i);
  return m ? abs(m[1]) : undefined;
}

function parseGenres(inner) {
  var out = [], re = /<a[^>]+href="[^"]*\/generos\/[^"]*"[^>]*>([\s\S]*?)<\/a>/gi, m;
  while ((m = re.exec(inner)) && out.length < 5) {
    var t = stripTags(m[1]);
    if (t && out.indexOf(t) < 0) out.push(t.slice(0, 30));
  }
  return out;
}

function parseSeriesCards(html) {
  var out = [], re = /<a[^>]*class="[^"]*hrd-portada[^"]*"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi, m;
  while ((m = re.exec(html))) {
    var href = m[1], inner = m[2];
    var sm = href.match(/\/hentai-lista\/([^\/?#]+)\/?/);
    if (!sm) continue;
    var slug = safeId(sm[1]);
    var tm = inner.match(/<h3[^>]*>([\s\S]*?)<\/h3>/i);
    var title = tm ? stripTags(tm[1]) : '';
    if (!title || !slug) continue;
    var eps = (inner.match(/hrd-eps[^>]*>\s*(\d+)/i) || [])[1];
    var badges = [];
    if (/hrd-censura[^>]*hrd-c/.test(inner)) badges.push('Con censura');
    else if (/hrd-censura[^>]*hrd-s/.test(inner)) badges.push('Sin censura');
    if (eps) badges.push(eps + ' eps');
    out.push({
      id: 's~' + slug,
      ref: 'S|' + slug,
      kind: 'series',
      title: title.slice(0, 200),
      poster: firstImg(inner),
      badges: badges.slice(0, 3),
      genres: parseGenres(inner),
      adult: true
    });
  }
  return out;
}

function parseEpisodeCards(html) {
  var out = [], re = /<a[^>]*class="[^"]*hrd-episodio[^"]*"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi, m;
  while ((m = re.exec(html))) {
    var href = m[1], inner = m[2];
    var em = href.match(/\/video-hentai\/(.+?)-(\d+)\/?($|[?#])/);
    if (!em) continue;
    var slug = safeId(em[1]), num = parseInt(em[2], 10);
    var tm = inner.match(/<h3[^>]*>([\s\S]*?)<\/h3>/i);
    var seriesTitle = tm ? stripTags(tm[1]) : '';
    if (!seriesTitle || !slug || !(num > 0)) continue;
    var bm = inner.match(/hrd-badge[^>]*>([^<]+)</i);
    var badges = [];
    if (bm) { var b = stripTags(bm[1]); if (b) badges.push(b.slice(0, 20)); }
    out.push({
      id: ('e~' + slug + '~' + num).slice(0, 128),
      ref: 'E|' + slug + '|' + num,
      kind: 'movie',
      title: (seriesTitle + ' Ep. ' + num).slice(0, 200),
      poster: firstImg(inner),
      lang: 'es',
      badges: badges.slice(0, 3),
      adult: true
    });
  }
  return out;
}

function splitSections(html) {
  var out = [], re = /<h2[^>]*>([\s\S]*?)<\/h2>/gi, m, marks = [];
  while ((m = re.exec(html))) marks.push({ title: stripTags(m[1]), start: m.index, end: re.lastIndex });
  for (var i = 0; i < marks.length; i++) {
    var body = html.slice(marks[i].end, i + 1 < marks.length ? marks[i + 1].start : html.length);
    out.push({ title: norm(marks[i].title), body: body });
  }
  return out;
}

function findSection(secs, kw) {
  for (var i = 0; i < secs.length; i++) if (secs[i].title.indexOf(kw) >= 0) return secs[i];
  return null;
}

// ---------- home / browse / search ----------

export async function home() {
  var html = await fetchText(BASE + '/');
  var secs = splitSections(html);
  var rows = [];

  var sec = findSection(secs, 'nuevos cap');
  if (sec) {
    var items = dedupe(parseEpisodeCards(sec.body)).slice(0, 60);
    if (items.length) rows.push({ id: 'r~nuevos', title: 'Nuevos cap\u00edtulos', items: items, ref: 'B|home~nuevos' });
  }

  sec = findSection(secs, 'destacad');
  if (sec) {
    var items2 = dedupe(parseSeriesCards(sec.body)).slice(0, 60);
    if (items2.length) rows.push({ id: 'r~destacados', title: 'Destacados', items: items2, ref: 'B|home~destacados' });
  }

  sec = findSection(secs, 'ultimos');
  if (sec) {
    var items3 = dedupe(parseSeriesCards(sec.body)).slice(0, 60);
    if (items3.length) rows.push({ id: 'r~ultimos', title: '\u00daltimos hentai', items: items3, ref: 'B|/hentai-lista/?orden=recientes' });
  }

  sec = findSection(secs, 'mas visto');
  if (sec) {
    var items4 = dedupe(parseSeriesCards(sec.body)).slice(0, 60);
    if (items4.length) rows.push({ id: 'r~vistos', title: 'M\u00e1s vistos', items: items4, ref: 'B|/hentai-lista/?orden=vistos' });
  }

  var extra = await Promise.allSettled([
    fetchText(BASE + '/hentai-lista/estrenos/'),
    fetchText(BASE + '/hentai-lista/sin-censura/')
  ]);
  if (extra[0].status === 'fulfilled') {
    var est = dedupe(parseSeriesCards(extra[0].value)).slice(0, 60);
    if (est.length) rows.push({ id: 'r~estrenos', title: 'Estrenos', items: est, ref: 'B|/hentai-lista/estrenos/' });
  }
  if (extra[1].status === 'fulfilled') {
    var snc = dedupe(parseSeriesCards(extra[1].value)).slice(0, 60);
    if (snc.length) rows.push({ id: 'r~sincensura', title: 'Sin censura', items: snc, ref: 'B|/hentai-lista/sin-censura/' });
  }

  return rows.slice(0, 20);
}

function pagedCards(urls) {
  return Promise.allSettled(urls.map(function (u) { return fetchText(u); })).then(function (results) {
    var items = [], allOk = results.length > 0, lastOk = false;
    for (var i = 0; i < results.length; i++) {
      var res = results[i];
      if (res.status === 'fulfilled') {
        var found = parseSeriesCards(res.value).concat(parseEpisodeCards(res.value));
        items = items.concat(found);
        lastOk = found.length > 0;
      } else {
        allOk = false;
        break;
      }
    }
    return { items: dedupe(items), allOk: allOk && lastOk };
  });
}

function catalogUrls(path, page, count) {
  var sep = path.indexOf('?') >= 0 ? '&' : '?';
  var urls = [];
  for (var i = 0; i < count; i++) urls.push(BASE + path + sep + 'page=' + (page + i));
  return urls;
}

function homeSectionBrowse(key) {
  return fetchText(BASE + '/').then(function (html) {
    var sec = findSection(splitSections(html), key);
    if (!sec) return { items: [] };
    var items = key === 'nuevos cap'
      ? parseEpisodeCards(sec.body)
      : parseSeriesCards(sec.body);
    return { items: dedupe(items) };
  });
}

export async function browse(ref, cursor) {
  var path = String(ref).slice(2);
  if (path.indexOf('home~') === 0) {
    var key = path.slice(5);
    var res = await homeSectionBrowse(key);
    if (!res.items.length) throw kino.error('not_found', 'empty section');
    return { items: res.items.slice(0, 100) };
  }
  var page = Math.max(1, parseInt(cursor || '1', 10) || 1);
  var out = await pagedCards(catalogUrls(path, page, 4));
  if (!out.items.length && page === 1) throw kino.error('not_found', 'no results');
  var r = { items: out.items.slice(0, 100) };
  if (out.allOk) r.next = String(page + 4);
  return r;
}

export async function search(query) {
  var q = query && query.q ? String(query.q).trim() : '';
  if (!q) return [];
  var start = Math.max(1, parseInt((query && query.cursor) || '1', 10) || 1);
  var path = '/buscar/?t=' + encodeURIComponent(q);
  var out = await pagedCards(catalogUrls(path, start, 4));
  if (!out.items.length && start === 1) return [];
  var r = { items: out.items.slice(0, 100) };
  if (out.allOk) r.next = String(start + 4);
  return r;
}

// ---------- episodios ----------

function parseSeriesInfo(html, slug) {
  var info = {};
  var tm = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
  if (tm) info.title = stripTags(tm[1]).slice(0, 200);
  var pm = html.match(/<img[^>]+src=["'](https?:\/\/[^"']*\/upload\/portadas\/[^"']+)["']/i)
    || html.match(/<img[^>]+src=["']([^"']*\/upload\/portadas\/[^"']+)["']/i);
  if (pm) info.poster = abs(pm[1]);
  var om = html.match(/sinopsis<\/[^>]+>\s*<[^>]*>([\s\S]*?)<\/(?:p|div)>/i)
    || html.match(/<div[^>]*class="[^"]*sinopsis[^"]*"[^>]*>([\s\S]*?)<\/div>/i);
  if (om) {
    var ov = stripTags(om[1]);
    if (ov.length > 20) info.overview = ov.slice(0, 2000);
  }
  var ym = html.match(/a[ñn]o[^0-9]{0,30}(\d{4})/i);
  if (ym) info.year = ym[1];
  var gs = parseGenres(html);
  if (gs.length) info.genres = gs;
  return info;
}

export async function episodes(ref) {
  var slug = String(ref).slice(2);
  var html = await fetchText(BASE + '/hentai-lista/' + slug + '/');
  var series = parseSeriesInfo(html, slug);
  var seen = {}, eps = [], re = /<a[^>]+href="([^"]*\/video-hentai\/[^"]+)"[^>]*>([\s\S]*?)<\/a>/gi, m;
  while ((m = re.exec(html))) {
    var em = m[1].match(/\/video-hentai\/(.+?)-(\d+)\/?($|[?#])/);
    if (!em) continue;
    var n = parseInt(em[2], 10);
    if (!(n > 0) || seen[n]) continue;
    seen[n] = true;
    var label = stripTags(m[2]) || ('Episodio ' + n);
    eps.push({ season: 1, number: n, ref: 'E|' + slug + '|' + n, title: label.slice(0, 200) });
  }
  if (!eps.length) throw kino.error('not_found', 'no episodes');
  eps.sort(function (a, b) { return a.number - b.number; });
  return { series: series, episodes: eps.slice(0, 5000) };
}

// ---------- servidores y extracción ----------

function classify(src) {
  for (var i = 0; i < SERVERS.length; i++) {
    if (SERVERS[i].re.test(src)) return { id: SERVERS[i].id, name: SERVERS[i].name, url: abs(src) };
  }
  var host = (src.match(/^https?:\/\/([^\/?#]+)/) || [])[1] || 'servidor';
  return { id: 'h~' + safeId(host), name: host, url: abs(src), unknown: true };
}

function rank(s) {
  var i = PRIO.indexOf(s.id);
  if (i >= 0) return i;
  if (s.id === 'gupload') return 98;
  if (s.id === 'firestream') return 99;
  return 50;
}

function iframeSrc(entry) {
  var s = String(entry || '');
  if (s.indexOf('<') >= 0) {
    var m = s.match(/src=["']([^"']+)["']/i);
    return m ? m[1] : null;
  }
  return s.indexOf('http') === 0 ? s : null;
}

function parseVideoServers(html) {
  var found = [], seen = {};
  function add(src) {
    if (!src) return;
    var s = classify(src);
    if (seen[s.id]) return;
    seen[s.id] = true;
    found.push(s);
  }
  var vm = html.match(/var\s+videos\s*=\s*(\{[\s\S]*?\})\s*;/);
  if (vm) {
    var data = null;
    try { data = JSON.parse(vm[1]); } catch (e) { data = null; }
    if (data) {
      var keys = Object.keys(data).sort(function (a, b) { return (parseInt(a, 10) || 0) - (parseInt(b, 10) || 0); });
      for (var i = 0; i < keys.length; i++) {
        var arr = [].concat(data[keys[i]]);
        for (var j = 0; j < arr.length; j++) add(iframeSrc(arr[j]));
      }
    }
  }
  if (!found.length) {
    // Respaldo: solo iframes de servidores conocidos (evita iframes de publicidad).
    var re = /<iframe[^>]+src=["']([^"']+)["']/gi, m;
    while ((m = re.exec(html))) {
      for (var k = 0; k < SERVERS.length; k++) {
        if (SERVERS[k].re.test(m[1])) { add(m[1]); break; }
      }
    }
  }
  return found;
}

function orderServers(servers) {
  return servers.slice().sort(function (a, b) { return rank(a) - rank(b); });
}

// Desempaquetador de Dean Edwards (sin eval).
function decodeWord(w, radix) {
  var n = 0;
  for (var i = 0; i < w.length; i++) {
    var c = w.charCodeAt(i), v;
    if (c >= 48 && c <= 57) v = c - 48;
    else if (c >= 97 && c <= 122) v = c - 87;
    else if (c >= 65 && c <= 90) v = c - 29;
    else return -1;
    n = n * radix + v;
  }
  return n;
}

function parsePacked(seg) {
  var argIdx = seg.indexOf('}(');
  if (argIdx < 0) return null;
  var q = seg.charAt(argIdx + 2);
  if (q !== "'" && q !== '"') return null;
  var splitIdx = seg.indexOf('.split', argIdx);
  if (splitIdx < 0) return null;
  var wordsEnd = seg.lastIndexOf(q, splitIdx);
  if (wordsEnd < argIdx + 3) return null;
  var wordsStr = seg.slice(argIdx + 3, wordsEnd);
  var pre = seg.slice(argIdx, wordsEnd);
  var pm = pre.match(new RegExp('\\(([' + q + '])([\\s\\S]*)\\1,(\\d+),(\\d+),$'));
  if (!pm) return null;
  var radix = parseInt(pm[3], 10);
  if (!(radix > 1 && radix <= 62)) return null;
  return { payload: pm[2], radix: radix, words: wordsStr.split('|') };
}

function unpackPacked(pk) {
  return pk.payload.replace(/[0-9a-zA-Z]+/g, function (w) {
    var n = decodeWord(w, pk.radix);
    return (n >= 0 && n < pk.words.length && pk.words[n]) ? pk.words[n] : w;
  });
}

// Desempaqueta todos los scripts empaquetados de la página y devuelve el texto juntos.
function unpackAll(html) {
  var marker = 'eval(function(p,a,c,k,e,';
  var out = [], idx = html.indexOf(marker);
  while (idx >= 0 && out.length < 10) {
    var pk = parsePacked(html.slice(idx, idx + 300000));
    if (pk) {
      try { out.push(unpackPacked(pk)); } catch (e) {}
    }
    idx = html.indexOf(marker, idx + marker.length);
  }
  return out.join('\n');
}

function findStreamUrl(text) {
  var m = text.match(/(jwplayer|setup|sources)[\s\S]{0,400}?file\s*:\s*["'](https?:\/\/[^"']+)["']/i);
  if (m) return m[2];
  m = text.match(/file\s*:\s*["'](https?:\/\/[^"']+)["']/i);
  if (m) return m[1];
  var m2 = text.match(/["'](https?:\/\/[^"'\s]+\.m3u8[^"'\s]*)["']/i);
  if (m2) return m2[1];
  var m3 = text.match(/["'](https?:\/\/[^"'\s]+\.mp4[^"'\s]*)["']/i);
  if (m3) return m3[1];
  var m4 = text.match(/(https?:\/\/[^\s"'<>]+\.m3u8[^\s"'<>]*)/i);
  if (m4) return m4[1];
  return null;
}

function wrapStream(url, label) {
  var st = { url: url, label: label, expiresInSeconds: 14400 };
  if (/\.mp4(\?|$)/.test(url)) st.mime = 'video/mp4';
  return st;
}

async function extractPackedPage(url, label) {
  var html = await fetchText(url, { timeoutMs: 8000 });
  var text = html;
  try {
    var unpacked = unpackAll(html);
    if (unpacked) text = unpacked + '\n' + html;
  } catch (e) { text = html; }
  var u = findStreamUrl(text);
  return u ? wrapStream(u, label) : null;
}

async function extractSendvid(url, label) {
  var html = await fetchText(url, { timeoutMs: 8000 });
  var m = html.match(/<meta[^>]+property=["']og:video["'][^>]+content=["']([^"']+)["']/i)
    || html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:video["']/i);
  if (m && m[1].indexOf('http') === 0) {
    var st = wrapStream(m[1], label);
    st.mime = 'video/mp4';
    return st;
  }
  return null;
}

function resolveUrl(base, u) {
  if (u.indexOf('http') === 0) return u;
  if (u.indexOf('//') === 0) return 'https:' + u;
  if (u.charAt(0) === '/') {
    var hm = base.match(/^(https?:\/\/[^\/]+)/);
    return hm ? hm[1] + u : null;
  }
  return null;
}

async function tryFormPost(pageUrl, html) {
  var fm = html.match(/<form([^>]*)>([\s\S]*?)<\/form>/i);
  if (!fm) return null;
  var attrs = fm[1];
  if (!/method=["']post["']/i.test(attrs)) return null;
  var am = attrs.match(/action=["']([^"']+)["']/i);
  var action = am ? resolveUrl(pageUrl, am[1]) : pageUrl;
  if (!action) return null;
  var inputs = {}, ire = /<input[^>]*>/gi, im;
  while ((im = ire.exec(fm[2]))) {
    var tag = im[0];
    var nm = tag.match(/name=["']([^"']+)["']/i);
    var vm = tag.match(/value=["']([^"']*)["']/i);
    if (nm) inputs[nm[1]] = vm ? vm[1] : '';
  }
  var r = await kino.fetch(action, { method: 'POST', body: { form: inputs }, timeoutMs: 8000 });
  if (!r.ok) return null;
  return await r.text();
}

async function extractGeneric(url, label) {
  var html = await fetchText(url, { timeoutMs: 8000 });
  var u = findStreamUrl(html);
  if (u) return wrapStream(u, label);
  var unpacked = '';
  try { unpacked = unpackAll(html); } catch (e) { unpacked = ''; }
  u = unpacked ? findStreamUrl(unpacked) : null;
  if (u) return wrapStream(u, label);
  var posted = null;
  try { posted = await tryFormPost(url, html); } catch (e) { posted = null; }
  if (posted) {
    u = findStreamUrl(posted);
    if (!u) {
      var unpacked2 = '';
      try { unpacked2 = unpackAll(posted); } catch (e) { unpacked2 = ''; }
      u = unpacked2 ? findStreamUrl(unpacked2) : null;
    }
    if (u) return wrapStream(u, label);
  }
  return null;
}

async function extract(server) {
  try {
    if (server.id === 'sendvid') return await extractSendvid(server.url, server.name);
    if (server.id === 'lulu') return await extractPackedPage(server.url, server.name);
    if (server.id === 'streamhls') return await extractGeneric(server.url, server.name);
    return await extractGeneric(server.url, server.name);
  } catch (e) {
    return null;
  }
}

// ---------- resolve ----------

export async function resolve(ref) {
  var parts = String(ref).split('|');
  if (parts[0] !== 'E' || parts.length < 3) throw kino.error('not_found', 'bad ref');
  var slug = parts[1], num = parts[2], only = parts[3] || null;
  var html = await fetchText(BASE + '/video-hentai/' + slug + '-' + num + '/', { timeoutMs: 10000 });
  var servers = parseVideoServers(html);
  if (!servers.length) {
    throw kino.error('not_found', 'no servers', { userMessage: 'No se encontr\u00f3 ning\u00fan servidor para este cap\u00edtulo.' });
  }

  if (only) {
    var target = null;
    for (var i = 0; i < servers.length; i++) if (servers[i].id === only) target = servers[i];
    if (!target) throw kino.error('not_found', 'server gone', { userMessage: 'Ese servidor ya no est\u00e1 en este cap\u00edtulo. Prueba otro en el men\u00fa Servidor.' });
    var st1 = await extract(target);
    if (!st1) throw kino.error('unavailable', 'extract fail', { userMessage: 'Ese servidor no respondi\u00f3. Prueba otro en el men\u00fa Servidor.' });
    return st1;
  }

  var pref = 'auto';
  try { var cfg = await kino.config.get('server'); if (cfg) pref = String(cfg); } catch (e) {}
  var ordered = orderServers(servers);
  if (pref !== 'auto') {
    ordered.sort(function (a, b) {
      return (a.id === pref ? -1 : 0) - (b.id === pref ? -1 : 0);
    });
  }

  var primary = null, failed = [], tries = 0;
  for (var j = 0; j < ordered.length && tries < 4; j++) {
    tries++;
    var st = await extract(ordered[j]);
    if (st) { primary = st; primary.__sid = ordered[j].id; break; }
    failed.push(ordered[j].id);
  }
  if (!primary) {
    throw kino.error('unavailable', 'no stream', { userMessage: 'Ning\u00fan servidor respondi\u00f3. Intenta de nuevo en unos minutos.' });
  }

  var alternatives = [];
  for (var k = 0; k < ordered.length && alternatives.length < 8; k++) {
    var s = ordered[k];
    if (s.id === primary.__sid || failed.indexOf(s.id) >= 0) continue;
    alternatives.push({ label: s.name, ref: 'E|' + slug + '|' + num + '|' + s.id });
  }
  if (alternatives.length) primary.alternatives = alternatives;
  delete primary.__sid;
  return primary;
}