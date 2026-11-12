// THEPOOLsheets – Offline-Web-App für Leadsheets und Setlists
const APP_VERSION = '1.1.0';

/* ------------------------------------------------------------------ *
 * Hilfsfunktionen
 * ------------------------------------------------------------------ */
const $ = (s, r = document) => r.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
const collator = new Intl.Collator('de', { sensitivity: 'base', numeric: true });
const norm = (s) => String(s || '').toLocaleLowerCase('de').normalize('NFD').replace(/[̀-ͯ]/g, '');

let toastTimer;
function toast(text, actionLabel, action, ms = 3500) {
  const t = $('#toast');
  t.innerHTML = `<span>${esc(text)}</span>`;
  if (actionLabel) {
    const b = document.createElement('button');
    b.className = 'btn primary';
    b.textContent = actionLabel;
    b.onclick = () => { t.hidden = true; action(); };
    t.appendChild(b);
    ms = Math.max(ms, 15000);
  }
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (t.hidden = true), ms);
}
function busy(on, text = 'Wird verarbeitet …') {
  $('#busy').hidden = !on;
  $('#busyText').textContent = text;
}

/* ------------------------------------------------------------------ *
 * Datenbank (IndexedDB) – alles bleibt lokal auf dem Gerät
 * ------------------------------------------------------------------ */
const DB_NAME = 'leadsheets';
let dbp;
function db() {
  if (!dbp) dbp = new Promise((res, rej) => {
    const r = indexedDB.open(DB_NAME, 1);
    r.onupgradeneeded = () => {
      const d = r.result;
      d.createObjectStore('songs', { keyPath: 'id' });
      d.createObjectStore('files', { keyPath: 'id' });
      d.createObjectStore('setlists', { keyPath: 'id' });
    };
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
  return dbp;
}
async function tx(store, mode, fn) {
  const d = await db();
  return new Promise((res, rej) => {
    const t = d.transaction(store, mode);
    const s = t.objectStore(store);
    let out;
    Promise.resolve(fn(s)).then((v) => (out = v));
    t.oncomplete = () => res(out);
    t.onerror = () => rej(t.error);
    t.onabort = () => rej(t.error || new Error('Abgebrochen'));
  });
}
const reqP = (r) => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
const getAll = (store) => tx(store, 'readonly', (s) => reqP(s.getAll()));
const getOne = (store, id) => tx(store, 'readonly', (s) => reqP(s.get(id)));
const putOne = (store, obj) => tx(store, 'readwrite', (s) => { s.put(obj); });
const delOne = (store, id) => tx(store, 'readwrite', (s) => { s.delete(id); });

/* ------------------------------------------------------------------ *
 * Zustand
 * ------------------------------------------------------------------ */
const state = {
  songs: [],
  setlists: [],
  currentSetlist: null,
  editSongId: null,
};
const prefs = Object.assign({ fit: 'page', night: false, hideHint: false },
  (() => { try { return JSON.parse(localStorage.getItem('prefs') || '{}'); } catch { return {}; } })());
const savePrefs = () => { try { localStorage.setItem('prefs', JSON.stringify(prefs)); } catch {} };

const songById = (id) => state.songs.find((s) => s.id === id);
const sortedSongs = () => [...state.songs].sort((a, b) => collator.compare(a.title, b.title));

async function loadAll() {
  state.songs = await getAll('songs');
  state.setlists = await getAll('setlists');
}

/* ------------------------------------------------------------------ *
 * Import von Dateien
 * ------------------------------------------------------------------ */
function detectType(file) {
  const n = file.name.toLowerCase();
  if (n.endsWith('.pdf') || file.type === 'application/pdf') return 'pdf';
  if (n.endsWith('.docx')) return 'docx';
  if (n.endsWith('.doc')) return 'doc';
  if (file.type.startsWith('image/') || /\.(jpe?g|png|gif|webp|heic|heif)$/.test(n)) return 'image';
  return null;
}
const titleFromName = (name) => name.replace(/\.[^.]+$/, '').replace(/[_]+/g, ' ').replace(/\s+/g, ' ').trim();

async function fileToRecord(file) {
  const type = detectType(file);
  if (!type) throw new Error(`„${file.name}“: Dateityp wird nicht unterstützt.`);
  if (type === 'doc') throw new Error(`„${file.name}“ ist im alten Word-Format (.doc). Bitte in Word als .docx oder PDF speichern.`);
  const data = await file.arrayBuffer();
  const rec = { data, mime: file.type || '', fileName: file.name };
  if (type === 'docx') {
    const r = await window.mammoth.convertToHtml({ arrayBuffer: data.slice(0) });
    rec.html = r.value;
    return { kind: 'html', rec };
  }
  return { kind: type, rec };
}

async function importFiles(files) {
  if (!files.length) return;
  busy(true, `Importiere ${files.length} Datei(en) …`);
  const errors = [];
  let ok = 0;
  for (const f of files) {
    try {
      const { kind, rec } = await fileToRecord(f);
      const id = uid();
      await putOne('files', { id, ...rec });
      const song = { id, title: titleFromName(f.name), key: '', bpm: '', notes: '', type: kind, fileName: f.name, created: Date.now() };
      await putOne('songs', song);
      state.songs.push(song);
      ok++;
    } catch (e) {
      errors.push(e.message || String(e));
    }
  }
  busy(false);
  renderSongs();
  requestPersist();
  if (errors.length) alert(errors.join('\n\n'));
  if (ok) toast(`${ok} Song(s) hinzugefügt`);
}

async function requestPersist() {
  try { if (navigator.storage?.persist && !(await navigator.storage.persisted())) await navigator.storage.persist(); } catch {}
}

/* ------------------------------------------------------------------ *
 * Ansichten / Navigation
 * ------------------------------------------------------------------ */
function showView(name) {
  document.querySelectorAll('.view').forEach((v) => v.classList.toggle('active', v.id === 'view-' + name));
  const tab = name === 'setlist' ? 'setlists' : name;
  document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('active', t.dataset.tab === tab));
  window.scrollTo(0, 0);
}
document.querySelectorAll('.tab').forEach((t) => t.addEventListener('click', () => {
  showView(t.dataset.tab);
  if (t.dataset.tab === 'setlists') renderSetlists();
}));

const typeLabel = { pdf: 'PDF', html: 'WORD', image: 'BILD' };
const metaLine = (s) => [s.key && `Tonart ${s.key}`, s.bpm && `${s.bpm} BPM`].filter(Boolean).join(' · ');

/* ---------- Songs ---------- */
function filteredSongs() {
  const q = norm($('#songSearch').value);
  return sortedSongs().filter((s) => !q || norm(s.title).includes(q) || norm(s.notes).includes(q));
}
function renderSongs() {
  const list = filteredSongs();
  $('#songsEmpty').hidden = state.songs.length > 0;
  $('#songList').innerHTML = list.map((s) => `
    <li class="item" data-id="${s.id}">
      <div class="main" data-act="open">
        <div class="t">${esc(s.title)}</div>
        <div class="s">${esc(metaLine(s)) || '&nbsp;'}</div>
      </div>
      <span class="badge">${typeLabel[s.type] || ''}</span>
      <button class="act" data-act="edit" aria-label="Bearbeiten">✎</button>
    </li>`).join('');
}
$('#songSearch').addEventListener('input', renderSongs);
$('#fileInput').addEventListener('change', async (e) => {
  const files = [...e.target.files];
  e.target.value = '';
  await importFiles(files);
});
$('#songList').addEventListener('click', (e) => {
  const li = e.target.closest('.item'); if (!li) return;
  const act = e.target.closest('[data-act]')?.dataset.act;
  if (act === 'edit') return openSongDialog(li.dataset.id);
  if (act === 'open') {
    const ids = filteredSongs().map((s) => s.id);
    openViewer(ids, ids.indexOf(li.dataset.id), null);
  }
});

/* ---------- Song bearbeiten ---------- */
function openSongDialog(id) {
  const s = songById(id); if (!s) return;
  state.editSongId = id;
  const f = $('#dlgSong form');
  f.title.value = s.title; f.key.value = s.key || ''; f.bpm.value = s.bpm || ''; f.notes.value = s.notes || '';
  $('#dlgSongFile').textContent = `Datei: ${s.fileName || '–'}`;
  $('#dlgSong').showModal();
}
$('#dlgSong').addEventListener('close', async () => {
  if ($('#dlgSong').returnValue !== 'ok') return;
  const s = songById(state.editSongId); if (!s) return;
  const f = $('#dlgSong form');
  Object.assign(s, { title: f.title.value.trim() || s.title, key: f.key.value.trim(), bpm: f.bpm.value.trim(), notes: f.notes.value.trim() });
  await putOne('songs', s);
  renderSongs();
  if (state.currentSetlist) renderSetlistDetail();
});
$('#replaceInput').addEventListener('change', async (e) => {
  const file = e.target.files[0]; e.target.value = '';
  const s = songById(state.editSongId); if (!file || !s) return;
  try {
    busy(true);
    const { kind, rec } = await fileToRecord(file);
    await putOne('files', { id: s.id, ...rec });
    Object.assign(s, { type: kind, fileName: file.name });
    await putOne('songs', s);
    viewerCache.forget(s.id);
    $('#dlgSongFile').textContent = `Datei: ${file.name}`;
    renderSongs();
    toast('Datei ersetzt');
  } catch (err) { alert(err.message || err); }
  finally { busy(false); }
});
$('#btnDeleteSong').addEventListener('click', async () => {
  const s = songById(state.editSongId); if (!s) return;
  const used = state.setlists.filter((l) => l.songIds.includes(s.id));
  const hint = used.length ? `\n\nEr wird auch aus ${used.length} Setlist(s) entfernt.` : '';
  if (!confirm(`„${s.title}“ wirklich löschen?${hint}`)) return;
  await delOne('songs', s.id);
  await delOne('files', s.id);
  for (const l of used) { l.songIds = l.songIds.filter((x) => x !== s.id); await putOne('setlists', l); }
  state.songs = state.songs.filter((x) => x.id !== s.id);
  viewerCache.forget(s.id);
  $('#dlgSong').close('deleted');
  renderSongs();
});

/* ---------- Setlists ---------- */
const fmtDate = (d) => { if (!d) return ''; const [y, m, t] = d.split('-'); return `${t}.${m}.${y}`; };
function renderSetlists() {
  const lists = [...state.setlists].sort((a, b) => (b.date || '').localeCompare(a.date || '') || b.created - a.created);
  $('#setlistsEmpty').hidden = lists.length > 0;
  $('#setlistList').innerHTML = lists.map((l) => `
    <li class="item" data-id="${l.id}">
      <div class="main" data-act="open">
        <div class="t">${esc(l.name || 'Ohne Namen')}</div>
        <div class="s">${[fmtDate(l.date), `${l.songIds.length} Songs`].filter(Boolean).join(' · ')}</div>
      </div>
      <button class="act add" data-act="play" aria-label="Starten">▶</button>
    </li>`).join('');
}
$('#setlistList').addEventListener('click', (e) => {
  const li = e.target.closest('.item'); if (!li) return;
  const l = state.setlists.find((x) => x.id === li.dataset.id);
  const act = e.target.closest('[data-act]')?.dataset.act;
  if (act === 'play') return playSetlist(l, 0);
  if (act === 'open') openSetlist(l);
});
$('#btnNewSetlist').addEventListener('click', async () => {
  const l = { id: uid(), name: 'Neue Setlist', date: new Date().toISOString().slice(0, 10), songIds: [], created: Date.now() };
  state.setlists.push(l);
  await putOne('setlists', l);
  openSetlist(l);
  setTimeout(() => { $('#setlistName').focus(); $('#setlistName').select(); }, 50);
});

function openSetlist(l) {
  state.currentSetlist = l;
  $('#setlistName').value = l.name;
  $('#setlistDate').value = l.date || '';
  renderSetlistDetail();
  showView('setlist');
}
function renderSetlistDetail() {
  const l = state.currentSetlist; if (!l) return;
  l.songIds = l.songIds.filter((id) => songById(id));
  $('#setlistCount').textContent = `${l.songIds.length} Songs`;
  $('#setlistSongsEmpty').hidden = l.songIds.length > 0;
  $('#setlistSongs').innerHTML = l.songIds.map((id, i) => {
    const s = songById(id);
    return `
    <li class="item" data-pos="${i}">
      <span class="handle" aria-label="Verschieben">≡</span>
      <span class="num">${i + 1}</span>
      <div class="main" data-act="open">
        <div class="t">${esc(s.title)}</div>
        <div class="s">${esc(metaLine(s)) || '&nbsp;'}</div>
      </div>
      <button class="act" data-act="remove" aria-label="Entfernen">✕</button>
    </li>`;
  }).join('');
}
const saveSetlist = () => state.currentSetlist && putOne('setlists', state.currentSetlist);
$('#setlistName').addEventListener('input', (e) => { state.currentSetlist.name = e.target.value; saveSetlist(); });
$('#setlistDate').addEventListener('change', (e) => { state.currentSetlist.date = e.target.value; saveSetlist(); });
$('#btnBackSetlists').addEventListener('click', () => { state.currentSetlist = null; renderSetlists(); showView('setlists'); });
$('#btnPlaySetlist').addEventListener('click', () => playSetlist(state.currentSetlist, 0));
$('#setlistSongs').addEventListener('click', (e) => {
  const li = e.target.closest('.item'); if (!li) return;
  const pos = +li.dataset.pos;
  const act = e.target.closest('[data-act]')?.dataset.act;
  if (act === 'remove') { state.currentSetlist.songIds.splice(pos, 1); saveSetlist(); renderSetlistDetail(); }
  if (act === 'open') playSetlist(state.currentSetlist, pos);
});
new window.Sortable($('#setlistSongs'), {
  handle: '.handle', animation: 150, ghostClass: 'sortable-ghost', chosenClass: 'sortable-chosen',
  onEnd: (ev) => {
    if (ev.oldIndex === ev.newIndex) return;
    const ids = state.currentSetlist.songIds;
    const [m] = ids.splice(ev.oldIndex, 1);
    ids.splice(ev.newIndex, 0, m);
    saveSetlist();
    renderSetlistDetail();
  },
});

/* Songs zur Setlist hinzufügen */
function renderPicker() {
  const q = norm($('#pickerSearch').value);
  const ids = state.currentSetlist.songIds;
  $('#pickerList').innerHTML = sortedSongs().filter((s) => !q || norm(s.title).includes(q)).map((s) => {
    const n = ids.filter((x) => x === s.id).length;
    return `
    <li class="item" data-id="${s.id}">
      <div class="main" data-act="add"><div class="t">${esc(s.title)}</div><div class="s">${esc(metaLine(s)) || '&nbsp;'}</div></div>
      <span class="count">${n ? '✓' + (n > 1 ? n : '') : ''}</span>
      <button class="act add" data-act="add" aria-label="Hinzufügen">+</button>
    </li>`;
  }).join('') || '<p class="empty">Keine Songs gefunden.</p>';
}
$('#btnAddSongs').addEventListener('click', () => { $('#pickerSearch').value = ''; renderPicker(); $('#dlgPicker').showModal(); });
$('#pickerSearch').addEventListener('input', renderPicker);
$('#pickerList').addEventListener('click', (e) => {
  const li = e.target.closest('.item'); if (!li || !e.target.closest('[data-act="add"]')) return;
  state.currentSetlist.songIds.push(li.dataset.id);
  saveSetlist(); renderPicker();
  toast(`„${songById(li.dataset.id).title}“ hinzugefügt`, null, null, 1200);
});
$('#btnPickerDone').addEventListener('click', () => { $('#dlgPicker').close(); renderSetlistDetail(); });
$('#dlgPicker').addEventListener('close', renderSetlistDetail);

$('#btnSetlistMore').addEventListener('click', () => $('#dlgSetlistMore').showModal());
$('#btnMoreClose').addEventListener('click', () => $('#dlgSetlistMore').close());
$('#btnDupSetlist').addEventListener('click', async () => {
  const src = state.currentSetlist;
  const l = { ...src, id: uid(), name: src.name + ' (Kopie)', songIds: [...src.songIds], created: Date.now() };
  state.setlists.push(l); await putOne('setlists', l);
  $('#dlgSetlistMore').close(); openSetlist(l); toast('Setlist dupliziert');
});
$('#btnDelSetlist').addEventListener('click', async () => {
  const l = state.currentSetlist;
  if (!confirm(`Setlist „${l.name}“ löschen? Die Songs selbst bleiben erhalten.`)) return;
  await delOne('setlists', l.id);
  state.setlists = state.setlists.filter((x) => x.id !== l.id);
  state.currentSetlist = null;
  $('#dlgSetlistMore').close(); renderSetlists(); showView('setlists');
});

function playSetlist(l, pos) {
  const ids = l.songIds.filter((id) => songById(id));
  if (!ids.length) return toast('Die Setlist ist noch leer.');
  openViewer(ids, pos, l);
}

/* ------------------------------------------------------------------ *
 * Bühnenansicht
 * ------------------------------------------------------------------ */
let pdfjs;
async function getPdfjs() {
  if (!pdfjs) {
    pdfjs = await import('https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/legacy/build/pdf.min.mjs');
    // Worker-Code über den (offline gecachten) Seitenkontext laden und als Blob starten
    const code = await (await fetch('https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/legacy/build/pdf.worker.min.mjs', { mode: 'cors' })).text();
    const url = URL.createObjectURL(new Blob([code], { type: 'text/javascript' }));
    pdfjs.GlobalWorkerOptions.workerPort = new Worker(url, { type: 'module' });
  }
  return pdfjs;
}

// Cache für geladene Dokumente und fertig gerenderte Seiten, damit das Umblättern sofort geht
const viewerCache = {
  docs: new Map(),   // songId -> Promise<{type, pdf?, html?, url?}>
  pages: new Map(),  // key -> canvas
  async get(id) {
    if (this.docs.has(id)) { const p = this.docs.get(id); this.docs.delete(id); this.docs.set(id, p); return p; }
    const p = (async () => {
      const song = songById(id);
      const f = await getOne('files', id);
      if (!f) throw new Error('Datei nicht gefunden');
      if (song.type === 'pdf') {
        const lib = await getPdfjs();
        const pdf = await lib.getDocument({
          data: new Uint8Array(f.data.slice(0)),
          standardFontDataUrl: 'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/standard_fonts/',
          useWorkerFetch: false,
          isEvalSupported: false,
        }).promise;
        return { type: 'pdf', pdf, pages: pdf.numPages };
      }
      if (song.type === 'html') return { type: 'html', html: f.html, pages: 1 };
      const url = URL.createObjectURL(new Blob([f.data], { type: f.mime || 'image/jpeg' }));
      return { type: 'image', url, pages: 1 };
    })();
    this.docs.set(id, p);
    while (this.docs.size > 6) {
      const [oldId, oldP] = this.docs.entries().next().value;
      this.docs.delete(oldId);
      oldP.then((d) => { d.pdf?.destroy(); d.url && URL.revokeObjectURL(d.url); }).catch(() => {});
    }
    return p;
  },
  forget(id) {
    const p = this.docs.get(id);
    if (p) { this.docs.delete(id); p.then((d) => { d.pdf?.destroy(); d.url && URL.revokeObjectURL(d.url); }).catch(() => {}); }
    for (const k of [...this.pages.keys()]) if (k.startsWith(id + ':')) this.pages.delete(k);
  },
  clearPages() { this.pages.clear(); },
};

const V = { ids: [], idx: 0, page: 1, setlist: null, token: 0, wake: null, open: false };
const stage = $('#stage');
const viewerEl = $('#viewer');

function stageSize() { return { W: viewerEl.clientWidth, H: viewerEl.clientHeight }; }

async function renderPdfPage(pdf, num, W, H, fit) {
  const page = await pdf.getPage(num);
  const vp1 = page.getViewport({ scale: 1 });
  const scale = fit === 'page' ? Math.min(W / vp1.width, H / vp1.height) : W / vp1.width;
  let dpr = window.devicePixelRatio || 1;
  const maxPx = 16e6; // iOS-Grenze für Canvas-Größe
  while ((vp1.width * scale * dpr) * (vp1.height * scale * dpr) > maxPx && dpr > 1) dpr -= 0.25;
  const vp = page.getViewport({ scale: scale * dpr });
  const c = document.createElement('canvas');
  c.width = Math.floor(vp.width); c.height = Math.floor(vp.height);
  c.style.width = Math.floor(vp.width / dpr) + 'px';
  c.style.height = Math.floor(vp.height / dpr) + 'px';
  await page.render({ canvasContext: c.getContext('2d', { alpha: false }), viewport: vp, background: '#ffffff' }).promise;
  return c;
}
async function cachedPage(id, doc, num, W, H) {
  const key = `${id}:${num}:${W}x${H}`;
  if (viewerCache.pages.has(key)) return viewerCache.pages.get(key);
  const p = renderPdfPage(doc.pdf, num, W, H, 'page');
  viewerCache.pages.set(key, p);
  while (viewerCache.pages.size > 8) viewerCache.pages.delete(viewerCache.pages.keys().next().value);
  p.catch(() => viewerCache.pages.delete(key));
  return p;
}

function fitHtml(el) {
  // Schrift so groß wie möglich, ohne dass gescrollt werden muss
  let lo = 9, hi = 48, best = lo;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    el.style.fontSize = mid + 'px';
    if (el.scrollHeight <= el.clientHeight + 1 && el.scrollWidth <= el.clientWidth + 1) { best = mid; lo = mid + 1; } else hi = mid - 1;
  }
  el.style.fontSize = best + 'px';
  return el.scrollHeight <= el.clientHeight + 1;
}

async function renderCurrent() {
  const token = ++V.token;
  const id = V.ids[V.idx];
  const song = songById(id);
  const fit = prefs.fit;
  const { W, H } = stageSize();
  updateOverlay();
  let doc;
  try { doc = await viewerCache.get(id); }
  catch (e) { stage.className = 'stage'; stage.innerHTML = `<div class="msg">„${esc(song?.title)}“ konnte nicht geöffnet werden.<br>${esc(e.message)}</div>`; return; }
  if (token !== V.token) return;
  V.pages = doc.pages;
  if (V.page > doc.pages) V.page = doc.pages;
  if (V.page < 1) V.page = 1;

  if (doc.type === 'pdf') {
    if (fit === 'page') {
      const c = await cachedPage(id, doc, V.page, W, H);
      if (token !== V.token) return;
      stage.className = 'stage';
      stage.replaceChildren(c);
      showBadge(doc.pages > 1 ? `Seite ${V.page}/${doc.pages}` : '');
      preload(doc, W, H);
    } else {
      stage.className = 'stage scroll';
      stage.replaceChildren();
      stage.scrollTop = 0;
      for (let n = 1; n <= doc.pages; n++) {
        const c = await renderPdfPage(doc.pdf, n, W, H, 'width');
        if (token !== V.token) return;
        stage.appendChild(c);
        if (V.atEnd && n === doc.pages) stage.scrollTop = stage.scrollHeight;
      }
      showBadge('');
    }
  } else if (doc.type === 'image') {
    stage.className = fit === 'page' ? 'stage' : 'stage scroll';
    const img = new Image(); img.src = doc.url; img.alt = '';
    stage.replaceChildren(img);
    showBadge('');
  } else {
    const div = document.createElement('div');
    div.className = 'html-doc';
    div.innerHTML = doc.html;
    if (fit === 'page') {
      stage.className = 'stage';
      stage.replaceChildren(div);
      if (!fitHtml(div)) { stage.className = 'stage scroll'; div.style.fontSize = '20px'; }
    } else {
      stage.className = 'stage scroll';
      div.style.fontSize = '22px';
      stage.replaceChildren(div);
    }
    showBadge('');
  }
  if (V.atEnd && stage.classList.contains('scroll')) stage.scrollTop = stage.scrollHeight;
  V.atEnd = false;
  if (fit === 'page' && doc.type === 'pdf') return;
  preloadNextSong(W, H);
}

function preload(doc, W, H) {
  const id = V.ids[V.idx];
  setTimeout(() => {
    if (V.page < doc.pages) cachedPage(id, doc, V.page + 1, W, H).catch(() => {});
    else preloadNextSong(W, H);
  }, 50);
}
function preloadNextSong(W, H) {
  const nid = V.ids[V.idx + 1]; if (!nid) return;
  setTimeout(async () => {
    try {
      const d = await viewerCache.get(nid);
      if (d.type === 'pdf' && prefs.fit === 'page') cachedPage(nid, d, 1, W, H).catch(() => {});
    } catch {}
  }, 80);
}

let badgeTimer;
function showBadge(text) {
  const b = $('#pageBadge');
  b.textContent = text;
  b.classList.toggle('show', !!text);
  clearTimeout(badgeTimer);
  if (text) badgeTimer = setTimeout(() => b.classList.remove('show'), 1800);
}

function updateOverlay() {
  const s = songById(V.ids[V.idx]);
  const pos = V.ids.length > 1 ? `${V.idx + 1}/${V.ids.length}  ` : '';
  $('#vTitle').textContent = pos + (s?.title || '');
  $('#vMeta').textContent = [V.setlist?.name, metaLine(s || {})].filter(Boolean).join(' · ');
  const nx = songById(V.ids[V.idx + 1]);
  $('#vNext').textContent = nx ? `Als Nächstes: ${nx.title}` : (V.ids.length > 1 ? 'Letzter Song' : '');
  $('#vNotes').hidden = !s?.notes;
  $('#vNotes').textContent = s?.notes || '';
  $('#vFit').textContent = prefs.fit === 'page' ? 'Ansicht: ganze Seite' : 'Ansicht: Breite';
  $('#vNight').classList.toggle('on', prefs.night);
  viewerEl.classList.toggle('night', prefs.night);
}

function isScrollable() { return stage.classList.contains('scroll') && stage.scrollHeight > stage.clientHeight + 2; }

function next() {
  if (isScrollable() && stage.scrollTop + stage.clientHeight < stage.scrollHeight - 4) {
    stage.scrollBy({ top: stage.clientHeight * 0.85, behavior: 'smooth' }); return;
  }
  if (prefs.fit === 'page' && V.pages > 1 && V.page < V.pages) { V.page++; renderCurrent(); return; }
  if (V.idx < V.ids.length - 1) { V.idx++; V.page = 1; renderCurrent(); return; }
  showBadge(V.ids.length > 1 ? 'Ende der Setlist' : 'Ende');
}
function prev() {
  if (isScrollable() && stage.scrollTop > 4) {
    stage.scrollBy({ top: -stage.clientHeight * 0.85, behavior: 'smooth' }); return;
  }
  if (prefs.fit === 'page' && V.page > 1) { V.page--; renderCurrent(); return; }
  if (V.idx > 0) { V.idx--; V.page = 9999; V.atEnd = true; renderCurrent(); return; }
  showBadge('Anfang');
}
function jumpTo(i) { V.idx = i; V.page = 1; $('#jumpList').hidden = true; renderCurrent(); }

async function openViewer(ids, idx, setlist) {
  Object.assign(V, { ids, idx: Math.max(0, idx), page: 1, setlist, open: true, atEnd: false });
  viewerEl.hidden = false;
  $('#toast').hidden = true;
  $('#overlay').hidden = true;
  $('#jumpList').hidden = true;
  document.body.style.overflow = 'hidden';
  if (!isStandalone() && document.documentElement.requestFullscreen) document.documentElement.requestFullscreen().catch(() => {});
  await acquireWake();
  renderCurrent();
}
function closeViewer() {
  V.open = false; V.token++;
  viewerEl.hidden = true;
  stage.replaceChildren();
  document.body.style.overflow = '';
  releaseWake();
  if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
}

async function acquireWake() {
  try { if ('wakeLock' in navigator && !V.wake) { V.wake = await navigator.wakeLock.request('screen'); V.wake.addEventListener('release', () => (V.wake = null)); } } catch {}
}
function releaseWake() { try { V.wake?.release(); } catch {} V.wake = null; }
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && V.open) acquireWake(); });

// Gesten: Tippen links/rechts, Mitte = Menü, Wischen
let ptr = null;
viewerEl.addEventListener('pointerdown', (e) => {
  if (e.target.closest('.ov-top, .ov-bottom, .ov-notes, .jump')) return;
  ptr = { x: e.clientX, y: e.clientY, t: Date.now(), st: stage.scrollTop };
});
viewerEl.addEventListener('pointerup', (e) => {
  if (!ptr) return;
  const dx = e.clientX - ptr.x, dy = e.clientY - ptr.y, dt = Date.now() - ptr.t;
  const scrolled = Math.abs(stage.scrollTop - ptr.st) > 5;
  ptr = null;
  if (!$('#jumpList').hidden) { $('#jumpList').hidden = true; return; }
  if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.5 && dt < 800) { dx < 0 ? next() : prev(); return; }
  if (Math.abs(dx) > 12 || Math.abs(dy) > 12 || scrolled || dt > 700) return;
  const w = viewerEl.clientWidth;
  if (e.clientX > w * 0.65) next();
  else if (e.clientX < w * 0.35) prev();
  else $('#overlay').hidden = !$('#overlay').hidden;
});
viewerEl.addEventListener('pointercancel', () => (ptr = null));

// Tastatur & Bluetooth-Pedale
window.addEventListener('keydown', (e) => {
  if (!V.open) return;
  if (['ArrowRight', 'ArrowDown', 'PageDown', ' ', 'Enter'].includes(e.key)) { e.preventDefault(); next(); }
  else if (['ArrowLeft', 'ArrowUp', 'PageUp', 'Backspace'].includes(e.key)) { e.preventDefault(); prev(); }
  else if (e.key === 'Escape') closeViewer();
});

$('#vClose').addEventListener('click', closeViewer);
$('#vPrev').addEventListener('click', prev);
$('#vNextBtn').addEventListener('click', next);
$('#vFit').addEventListener('click', () => { prefs.fit = prefs.fit === 'page' ? 'width' : 'page'; savePrefs(); V.page = 1; renderCurrent(); });
$('#vNight').addEventListener('click', () => { prefs.night = !prefs.night; savePrefs(); updateOverlay(); });
$('#vList').addEventListener('click', () => {
  $('#jumpItems').innerHTML = V.ids.map((id, i) => `<li data-i="${i}" class="${i === V.idx ? 'cur' : ''}">${esc(songById(id)?.title)}</li>`).join('');
  $('#jumpList').hidden = false;
  $('#jumpItems .cur')?.scrollIntoView({ block: 'center' });
});
$('#vJumpClose').addEventListener('click', () => ($('#jumpList').hidden = true));
$('#jumpItems').addEventListener('click', (e) => { const li = e.target.closest('li'); if (li) jumpTo(+li.dataset.i); });

let resizeTimer;
window.addEventListener('resize', () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => { viewerCache.clearPages(); if (V.open) renderCurrent(); }, 200);
});

/* ------------------------------------------------------------------ *
 * Backup (Export / Import)
 * ------------------------------------------------------------------ */
function bufToB64(buf) {
  const bytes = new Uint8Array(buf); let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
function b64ToBuf(b64) {
  const s = atob(b64); const bytes = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) bytes[i] = s.charCodeAt(i);
  return bytes.buffer;
}
async function exportBackup() {
  busy(true, 'Backup wird erstellt …');
  try {
    const files = await getAll('files');
    const out = {
      app: 'leadsheets', version: 1, exported: new Date().toISOString(),
      songs: state.songs, setlists: state.setlists,
      files: files.map((f) => ({ ...f, data: bufToB64(f.data) })),
    };
    const name = `THEPOOLsheets-Backup-${new Date().toISOString().slice(0, 10)}.json`;
    const file = new File([JSON.stringify(out)], name, { type: 'application/json' });
    busy(false);
    // Teilen braucht einen frischen Tipp – daher als zweiter Schritt
    toast('Backup ist bereit.', 'Sichern …', async () => {
      if (navigator.canShare?.({ files: [file] })) {
        try { await navigator.share({ files: [file], title: name }); } catch {}
      } else {
        const a = document.createElement('a');
        a.href = URL.createObjectURL(file); a.download = name; a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 10000);
      }
    });
  } catch (e) { busy(false); alert('Backup fehlgeschlagen: ' + (e.message || e)); }
}
async function importBackup(file) {
  let data;
  try { data = JSON.parse(await file.text()); } catch { return alert('Die Datei ist kein gültiges Backup.'); }
  if (data.app !== 'leadsheets') return alert('Die Datei ist kein Leadsheets-Backup.');
  if (!confirm(`${data.songs.length} Songs und ${data.setlists.length} Setlists importieren?\n\nVorhandene Einträge bleiben erhalten; gleiche Einträge aus dem Backup werden aktualisiert.`)) return;
  busy(true, 'Backup wird importiert …');
  try {
    for (const f of data.files) await putOne('files', { ...f, data: b64ToBuf(f.data) });
    for (const s of data.songs) await putOne('songs', s);
    for (const l of data.setlists) await putOne('setlists', l);
    for (const s of data.songs) viewerCache.forget(s.id);
    await loadAll();
    renderSongs(); renderSetlists();
    requestPersist();
    toast('Backup importiert');
  } catch (e) { alert('Import fehlgeschlagen: ' + (e.message || e)); }
  finally { busy(false); }
}

$('#btnSettings').addEventListener('click', async () => {
  let info = '';
  try {
    const est = await navigator.storage?.estimate?.();
    const persisted = await navigator.storage?.persisted?.();
    if (est) info = `${state.songs.length} Songs · ${state.setlists.length} Setlists · ca. ${(est.usage / 1048576).toFixed(1)} MB belegt`;
    if (persisted !== undefined) info += persisted ? ' · Speicher dauerhaft geschützt' : ' · Speicher nicht dauerhaft geschützt – App über den Home-Bildschirm nutzen';
  } catch {}
  $('#storageInfo').textContent = info;
  $('#appVersion').textContent = `Version ${APP_VERSION}`;
  $('#dlgSettings').showModal();
});
$('#btnSettingsClose').addEventListener('click', () => $('#dlgSettings').close());
$('#btnExport').addEventListener('click', () => { $('#dlgSettings').close(); exportBackup(); });
$('#importInput').addEventListener('change', (e) => { const f = e.target.files[0]; e.target.value = ''; $('#dlgSettings').close(); if (f) importBackup(f); });

/* ------------------------------------------------------------------ *
 * Installation / Offline
 * ------------------------------------------------------------------ */
function isStandalone() {
  return navigator.standalone === true || matchMedia('(display-mode: standalone)').matches || matchMedia('(display-mode: fullscreen)').matches;
}
if (!isStandalone() && !prefs.hideHint) $('#installHint').hidden = false;
$('#btnHideHint').addEventListener('click', () => { prefs.hideHint = true; savePrefs(); $('#installHint').hidden = true; });

if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  const hadController = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.register('./sw.js').then((reg) => {
    reg.addEventListener('updatefound', () => {
      const nw = reg.installing;
      nw?.addEventListener('statechange', () => {
        if (nw.state === 'activated' && hadController && !V.open) {
          toast('Neue Version installiert.', 'Neu laden', () => location.reload());
        }
      });
    });
  }).catch(() => {});
}

/* ------------------------------------------------------------------ */
(async function init() {
  await loadAll();
  renderSongs();
  renderSetlists();
})();
