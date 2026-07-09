/* ============================================================================
   SHELF — Personal Book Library
   script.js · Vanilla JavaScript, no dependencies.

   Architecture
   ------------
   Store    → versioned localStorage persistence (books + history + prefs)
   State    → the single source of truth; nothing else holds data
   Derive   → pure functions: filter → search → sort → stats
   Render   → declarative painters, each reading only from State
   Actions  → the only place State is mutated; every action calls render()
   UI       → dialogs, toasts, keyboard, theme

   Data flows one way: action → mutate state → persist → render.
   ========================================================================= */
(() => {
  'use strict';

  /* ── Utilities ─────────────────────────────────────────────────────────── */
  const $  = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

  const uid = () => 'b' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

  const esc = (v = '') => String(v).replace(/[&<>"']/g, c => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));

  const nf = new Intl.NumberFormat();
  const num = n => nf.format(n);

  const dateFmt = new Intl.DateTimeFormat(undefined, { day: '2-digit', month: 'short', year: 'numeric' });
  const fmtDate = iso => (iso ? dateFmt.format(new Date(iso)) : '—');
  const stampFmt = iso => (iso ? new Date(iso).toISOString().slice(0, 10).replace(/-/g, ' · ') : '— — —');

  const startOfToday = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d; };
  const daysUntil = iso => Math.round((new Date(iso) - startOfToday()) / 864e5);
  const addDays = n => { const d = new Date(); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); };

  const debounce = (fn, ms = 140) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };

  const plural = (n, one, many) => `${num(n)} ${n === 1 ? one : many}`;

  /** Deterministic hue from any string — keeps a category's colour stable forever. */
  const hash = str => {
    let h = 0;
    for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) | 0;
    return Math.abs(h);
  };
  const catHue = cat => hash((cat || 'uncategorised').toLowerCase()) % 360;
  const spineOf = book => {
    const drift = (hash(book.title || '') % 17) - 8;
    return `hsl(${(catHue(book.category) + drift + 360) % 360} 44% 50%)`;
  };
  const chipColor = cat => `hsl(${catHue(cat)} 44% 52%)`;

  const stars = r => (r ? '★'.repeat(r) + '☆'.repeat(5 - r) : '');

  /** Reading status derived from progress — never stored twice. */
  const readState = b => (b.progress >= 100 ? 'finished' : b.progress > 0 ? 'reading' : 'unread');
  const isOverdue = b => b.status === 'borrowed' && b.dueAt && daysUntil(b.dueAt) < 0;

  const highlight = (text, q) => {
    const safe = esc(text);
    if (!q) return safe;
    const needle = esc(q).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return safe.replace(new RegExp(needle, 'ig'), m => `<mark>${m}</mark>`);
  };

  /* ── Store ─────────────────────────────────────────────────────────────── */
  const KEY = 'shelf.v1';

  const SEED = [
    ['The Left Hand of Darkness', 'Ursula K. Le Guin', 'Science Fiction', 1969, 304, '978-0-441-47812-5', 'An envoy arrives on a world whose people have no fixed gender, and discovers that politics is the coldest weather of all.', 5, 100, true],
    ['A Pattern Language', 'Christopher Alexander', 'Architecture', 1977, 1171, '978-0-19-501919-3', '253 patterns for building rooms, streets and towns that people actually want to be in.', 5, 42, true],
    ['The Overstory', 'Richard Powers', 'Fiction', 2018, 502, '978-0-393-63552-2', 'Nine strangers, each summoned in a different way by trees, converge on the last stand of virgin forest.', 4, 68, false],
    ['Thinking, Fast and Slow', 'Daniel Kahneman', 'Psychology', 2011, 499, '978-0-374-53355-7', 'Two systems drive the way we think: one quick and intuitive, one slow and deliberate. Neither is trustworthy alone.', 4, 100, false],
    ['The Design of Everyday Things', 'Don Norman', 'Design', 1988, 368, '978-0-465-05065-9', 'Why doors confuse us, and what that says about every object built without regard for the person using it.', 5, 100, true],
    ['Piranesi', 'Susanna Clarke', 'Fiction', 2020, 245, '978-1-63557-563-4', 'A man lives in an infinite house of statues and tides, keeping careful notes. The notes are not entirely his.', 5, 100, false],
    ['Sapiens', 'Yuval Noah Harari', 'History', 2011, 443, '978-0-06-231609-7', 'How an unremarkable ape came to tell stories convincing enough to organise millions of strangers.', 3, 24, false],
    ['The Soul of a New Machine', 'Tracy Kidder', 'Technology', 1981, 293, '978-0-316-49197-6', 'A year inside the crunch, as one engineering team builds a minicomputer against an impossible deadline.', 5, 0, false],
    ['Braiding Sweetgrass', 'Robin Wall Kimmerer', 'Nature', 2013, 391, '978-1-57131-335-5', 'A botanist reads the land twice — once through science, once through the language of gift and reciprocity.', 5, 55, true],
    ['Ways of Seeing', 'John Berger', 'Art', 1972, 166, '978-0-14-103579-6', 'Seven essays that pull the frame off the painting and ask who was allowed to look, and who was looked at.', 4, 100, false],
    ['The Beginning of Infinity', 'David Deutsch', 'Science', 2011, 487, '978-0-14-311969-8', 'Good explanations are hard to vary — and that single idea reaches from physics to art to the future of everything.', 4, 12, false],
    ['Norwegian Wood', 'Haruki Murakami', 'Fiction', 1987, 296, '978-0-375-70402-7', 'A student in 1960s Tokyo is caught between a girl bound to the dead and a girl impatient to live.', 4, 0, false],
  ].map(([title, author, category, year, pages, isbn, description, rating, progress, favorite], i) => ({
    id: 'seed' + i, title, author, category, year, pages, isbn, description, rating, progress, favorite,
    status: 'available', borrower: null, borrowedAt: null, dueAt: null,
    addedAt: new Date(Date.now() - (i + 1) * 36e5 * 29).toISOString(),
  }));

  const daysAgo = n => new Date(Date.now() - n * 864e5).toISOString();

  /** Builds the first-run demo shelf: two live loans, one of them overdue. */
  const seedState = () => {
    const books = structuredClone(SEED);
    const history = [];

    const lend = (i, borrower, lentAgo, dueIn) => {
      const b = books[i];
      const date = daysAgo(lentAgo);
      const due = daysAgo(-dueIn);
      Object.assign(b, { status: 'borrowed', borrower, borrowedAt: date, dueAt: due });
      history.push({ id: uid(), bookId: b.id, type: 'borrow', borrower, date, due });
    };

    // A loan that already came home
    const piranesi = books[5];
    history.push({ id: uid(), bookId: piranesi.id, type: 'borrow', borrower: 'Mira Haddad', date: daysAgo(26), due: daysAgo(12) });
    history.push({ id: uid(), bookId: piranesi.id, type: 'return', borrower: 'Mira Haddad', date: daysAgo(9), due: daysAgo(12) });

    lend(6, 'Tomás Vela', 9, 5);      // due next week
    lend(9, 'Inés Okafor', 27, -6);   // six days overdue
    return { books, history };
  };

  const Store = {
    read() {
      try {
        const raw = localStorage.getItem(KEY);
        if (!raw) return null;
        const data = JSON.parse(raw);
        if (!Array.isArray(data.books)) return null;
        return data;
      } catch { return null; }
    },
    write(state) {
      try {
        localStorage.setItem(KEY, JSON.stringify({
          version: 1, books: state.books, history: state.history,
          prefs: { theme: state.theme, layout: state.layout, sort: state.sort },
        }));
      } catch {
        toast('Storage is full — recent changes may not be saved.', 'error');
      }
    },
  };

  /* ── State ─────────────────────────────────────────────────────────────── */
  const saved = Store.read();
  const seed = saved ? null : seedState();

  const state = {
    books: saved?.books ?? seed.books,
    history: saved?.history ?? seed.history,
    theme: saved?.prefs?.theme ?? (matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark'),
    layout: saved?.prefs?.layout ?? 'grid',
    sort: saved?.prefs?.sort ?? 'added-desc',
    view: 'library',
    query: '',
    category: 'all',
    status: 'all',
    historyFilter: 'all',
    editingId: null,
    lendingId: null,
    pendingDelete: null,
  };

  const persist = () => Store.write(state);
  const byId = id => state.books.find(b => b.id === id);

  /* ── Derive (pure) ─────────────────────────────────────────────────────── */
  const SORTERS = {
    'added-desc':    (a, b) => new Date(b.addedAt) - new Date(a.addedAt),
    'added-asc':     (a, b) => new Date(a.addedAt) - new Date(b.addedAt),
    'title-asc':     (a, b) => a.title.localeCompare(b.title),
    'title-desc':    (a, b) => b.title.localeCompare(a.title),
    'author-asc':    (a, b) => a.author.localeCompare(b.author),
    'year-desc':     (a, b) => (b.year || 0) - (a.year || 0),
    'rating-desc':   (a, b) => (b.rating || 0) - (a.rating || 0),
    'progress-desc': (a, b) => b.progress - a.progress,
  };

  const matchesStatus = (b, status) => {
    if (status === 'all') return true;
    if (status === 'available' || status === 'borrowed') return b.status === status;
    return readState(b) === status;
  };

  const matchesQuery = (b, q) => {
    if (!q) return true;
    const hay = `${b.title} ${b.author} ${b.category} ${b.isbn || ''}`.toLowerCase();
    return hay.includes(q);
  };

  /** The visible collection for the current view + filters. */
  const visibleBooks = () => {
    const q = state.query.trim().toLowerCase();
    return state.books
      .filter(b => (state.view === 'favorites' ? b.favorite : true))
      .filter(b => (state.view === 'borrowed' ? b.status === 'borrowed' : true))
      .filter(b => state.category === 'all' || b.category === state.category)
      .filter(b => matchesStatus(b, state.status))
      .filter(b => matchesQuery(b, q))
      .sort(SORTERS[state.sort] ?? SORTERS['added-desc']);
  };

  const categories = () => [...new Set(state.books.map(b => b.category).filter(Boolean))].sort((a, b) => a.localeCompare(b));

  const metrics = () => {
    const bs = state.books;
    const borrowed = bs.filter(b => b.status === 'borrowed');
    const finished = bs.filter(b => readState(b) === 'finished');
    const reading = bs.filter(b => readState(b) === 'reading');
    const rated = bs.filter(b => b.rating);
    return {
      total: bs.length,
      borrowed: borrowed.length,
      available: bs.length - borrowed.length,
      overdue: bs.filter(isOverdue).length,
      categories: categories().length,
      favorites: bs.filter(b => b.favorite).length,
      finished: finished.length,
      reading: reading.length,
      unread: bs.length - finished.length - reading.length,
      pagesTotal: bs.reduce((n, b) => n + (b.pages || 0), 0),
      pagesRead: Math.round(bs.reduce((n, b) => n + ((b.pages || 0) * b.progress) / 100, 0)),
      avgRating: rated.length ? (rated.reduce((n, b) => n + b.rating, 0) / rated.length).toFixed(1) : null,
      loans: state.history.filter(h => h.type === 'borrow').length,
    };
  };

  /* ── Elements ──────────────────────────────────────────────────────────── */
  const el = {
    app: $('.app'),
    grid: $('#grid'),
    chips: $('#chips'),
    recent: $('#recent'),
    recentList: $('#recentList'),
    empty: $('#empty'),
    emptyTitle: $('#emptyTitle'),
    emptyText: $('#emptyText'),
    resultLine: $('#resultLine'),
    collection: $('#collectionView'),
    historyView: $('#historyView'),
    statsView: $('#statsView'),
    ledger: $('#ledger'),
    historyEmpty: $('#historyEmpty'),
    searchInput: $('#searchInput'),
    searchClear: $('#searchClear'),
    viewTitle: $('#viewTitle'),
    viewEyebrow: $('#viewEyebrow'),
    viewLede: $('#viewLede'),
    toasts: $('#toasts'),
    cardTpl: $('#cardTpl'),
  };

  const TEXTS = {
    library:   ['Dashboard', 'Your library', 'Everything you own, on loan, or halfway through.'],
    favorites: ['Collection', 'Favorites', 'The books you would rescue from a fire.'],
    borrowed:  ['Lending', 'Out on loan', 'Who has what, and when you should ask for it back.'],
    history:   ['Records', 'Borrowing history', 'A stamped record of every loan and return.'],
    stats:     ['Insight', 'Statistics', 'What the shelf says about how you read.'],
  };

  /* ── Render ────────────────────────────────────────────────────────────── */
  function render() {
    if (state.category !== 'all' && !state.books.some(b => b.category === state.category)) state.category = 'all';
    renderChrome();
    renderStats();
    renderNavCounts();
    if (state.view === 'history') renderLedger();
    else if (state.view === 'stats') renderStatsView();
    else { renderChips(); renderRecent(); renderGrid(); }
    persist();
  }

  function renderChrome() {
    const [eyebrow, title, lede] = TEXTS[state.view];
    el.viewEyebrow.textContent = eyebrow;
    el.viewTitle.textContent = title;
    el.viewLede.textContent = lede;

    const isCollection = ['library', 'favorites', 'borrowed'].includes(state.view);
    el.collection.hidden = !isCollection;
    el.historyView.hidden = state.view !== 'history';
    el.statsView.hidden = state.view !== 'stats';
    el.recent.hidden = state.view !== 'library' || state.books.length < 3;

    $$('.nav__item').forEach(btn => {
      const on = btn.dataset.view === state.view;
      btn.classList.toggle('is-active', on);
      if (on) btn.setAttribute('aria-current', 'page'); else btn.removeAttribute('aria-current');
    });

    el.searchClear.hidden = !state.query;
  }

  function renderNavCounts() {
    const m = metrics();
    const counts = { library: m.total, favorites: m.favorites, borrowed: m.borrowed, history: state.history.length };
    $$('[data-count]').forEach(n => { n.textContent = num(counts[n.dataset.count] ?? 0); });
  }

  function renderStats() {
    const m = metrics();
    const set = (k, v) => { const n = $(`[data-stat="${k}"]`); if (n) n.textContent = v; };

    set('total', num(m.total));
    set('totalMeta', m.total ? `${plural(m.pagesTotal, 'page', 'pages')} on the shelf` : 'Nothing catalogued yet');
    set('borrowed', num(m.borrowed));
    set('borrowedMeta', m.overdue ? `${plural(m.overdue, 'book is', 'books are')} overdue` : m.borrowed ? 'All within their due dates' : 'Nothing is out');
    set('available', num(m.available));
    set('availableMeta', m.reading ? `${plural(m.reading, 'book', 'books')} in progress` : 'Ready when you are');
    set('categories', num(m.categories));
    set('categoriesMeta', m.favorites ? `${plural(m.favorites, 'favorite', 'favorites')} marked` : 'No favorites yet');
  }

  function renderChips() {
    const counts = new Map();
    state.books.forEach(b => counts.set(b.category, (counts.get(b.category) || 0) + 1));

    const items = [['all', state.books.length], ...categories().map(c => [c, counts.get(c) || 0])];
    el.chips.innerHTML = items.map(([cat, n]) => {
      const on = state.category === cat;
      const label = cat === 'all' ? 'All categories' : cat;
      const color = cat === 'all' ? 'var(--accent)' : chipColor(cat);
      return `<button class="chip" type="button" data-cat="${esc(cat)}" aria-pressed="${on}"
                style="--spine:${color}">${esc(label)} <span class="chip__n">${num(n)}</span></button>`;
    }).join('');
  }

  function renderRecent() {
    if (el.recent.hidden) return;
    const recent = [...state.books].sort(SORTERS['added-desc']).slice(0, 5);
    el.recentList.innerHTML = recent.map(b => `
      <li>
        <button class="recent__item" type="button" data-open="${b.id}" style="--spine:${spineOf(b)}">
          <span class="recent__chip" aria-hidden="true"></span>
          <span class="recent__meta">
            <strong>${esc(b.title)}</strong>
            <span>${esc(b.author)} · added ${esc(fmtDate(b.addedAt))}</span>
          </span>
        </button>
      </li>`).join('');
  }

  function renderGrid() {
    const books = visibleBooks();
    const q = state.query.trim();

    el.grid.classList.toggle('is-list', state.layout === 'list');
    el.grid.replaceChildren(...books.map((b, i) => card(b, q, i)));

    el.grid.hidden = books.length === 0;
    el.empty.hidden = books.length !== 0;

    if (!books.length) {
      const filtered = q || state.category !== 'all' || state.status !== 'all';
      el.emptyTitle.textContent = filtered ? 'No books match those filters'
        : state.view === 'favorites' ? 'No favorites yet'
        : state.view === 'borrowed' ? 'Nothing is out on loan'
        : 'Your shelf is empty';
      el.emptyText.textContent = filtered ? 'Try a different category, or clear the search.'
        : state.view === 'favorites' ? 'Tap the heart on any cover and it will appear here.'
        : state.view === 'borrowed' ? 'Lend a book and it will be tracked here until it comes home.'
        : 'Add your first book and it will show up on this shelf.';
      $('[data-action="add-first"]').hidden = state.view !== 'library' && !filtered;
    }

    el.resultLine.textContent = books.length
      ? `${plural(books.length, 'book', 'books')}${q ? ` matching “${q}”` : ''}`
      : '';
  }

  function card(b, q, i) {
    const node = el.cardTpl.content.firstElementChild.cloneNode(true);
    const overdue = isOverdue(b);
    const out = b.status === 'borrowed';

    node.dataset.id = b.id;
    node.style.setProperty('--i', i);
    node.style.setProperty('--spine', spineOf(b));

    const open = $('[data-act="open"]', node);
    open.setAttribute('aria-label', `Open details for ${b.title} by ${b.author}`);
    $('.cover__cat', node).textContent = b.category || 'Uncategorised';
    $('.cover__title', node).textContent = b.title;
    $('.cover__author', node).textContent = b.author;

    const fav = $('[data-act="fav"]', node);
    fav.setAttribute('aria-pressed', String(!!b.favorite));
    fav.setAttribute('aria-label', b.favorite ? `Remove ${b.title} from favorites` : `Add ${b.title} to favorites`);

    const ribbon = $('.ribbon', node);
    if (out) {
      ribbon.hidden = false;
      ribbon.dataset.kind = overdue ? 'late' : 'loan';
      ribbon.textContent = overdue ? 'Overdue' : 'On loan';
    }

    $('.card__title', node).innerHTML = highlight(b.title, q);
    $('.card__author', node).innerHTML = highlight(b.author, q);
    $('.card__stars', node).textContent = stars(b.rating);

    $('.progress__fill', node).style.width = `${b.progress}%`;
    $('.progress__label', node).textContent = `${b.progress}%`;
    $('.progress', node).setAttribute('title', `${b.progress}% read`);

    const pill = $('.pill', node);
    pill.dataset.state = overdue ? 'overdue' : b.status;
    pill.textContent = overdue ? `${Math.abs(daysUntil(b.dueAt))}d late` : out ? b.borrower.split(' ')[0] : 'Shelved';

    const loan = $('[data-act="loan"]', node);
    loan.setAttribute('aria-label', out ? `Mark ${b.title} returned` : `Lend ${b.title}`);
    loan.innerHTML = `<svg class="icon" aria-hidden="true"><use href="#${out ? 'i-back' : 'i-out'}"/></svg>`;

    $('[data-act="edit"]', node).setAttribute('aria-label', `Edit ${b.title}`);
    $('[data-act="del"]', node).setAttribute('aria-label', `Delete ${b.title}`);
    return node;
  }

  function renderLedger() {
    const entries = state.history
      .filter(h => state.historyFilter === 'all' || h.type === state.historyFilter)
      .sort((a, b) => new Date(b.date) - new Date(a.date));

    el.ledger.hidden = !entries.length;
    el.historyEmpty.hidden = !!entries.length;

    el.ledger.innerHTML = entries.map((h, i) => {
      const b = byId(h.bookId);
      const title = b ? b.title : 'A removed book';
      const spine = b ? spineOf(b) : 'var(--line-strong)';
      const late = h.type === 'return' && h.due && new Date(h.date) > new Date(h.due);
      const verb = h.type === 'borrow' ? 'Lent to' : 'Returned by';
      const due = h.type === 'borrow' && h.due ? ` · due ${esc(fmtDate(h.due))}` : '';
      return `
        <li class="slip" style="--spine:${spine}; --i:${i}">
          <div class="slip__main">
            <span class="slip__kind" data-kind="${h.type}">${h.type === 'borrow' ? 'Loan' : 'Return'}</span>
            <p class="slip__title">${b ? `<button type="button" data-open="${b.id}">${esc(title)}</button>` : esc(title)}</p>
            <p class="slip__sub">${verb} <b>${esc(h.borrower)}</b>${due}${late ? ' · returned late' : ''}</p>
          </div>
          <div class="stamp" data-late="${late}">
            <small>${h.type === 'borrow' ? 'Date issued' : 'Date returned'}</small>
            <b>${esc(stampFmt(h.date))}</b>
          </div>
        </li>`;
    }).join('');
  }

  function renderStatsView() {
    const m = metrics();
    const set = (k, v) => { const n = $(`[data-stat="${k}"]`); if (n) n.textContent = v; };

    // Category bars
    const counts = new Map();
    state.books.forEach(b => counts.set(b.category || 'Uncategorised', (counts.get(b.category || 'Uncategorised') || 0) + 1));
    const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1]);
    const max = sorted[0]?.[1] || 1;
    $('#catBars').innerHTML = sorted.length ? sorted.map(([cat, n], i) => `
      <li class="bar" style="--spine:${chipColor(cat)}">
        <p class="bar__top"><b>${esc(cat)}</b><span>${num(n)}</span></p>
        <div class="bar__track" role="img" aria-label="${esc(cat)}: ${num(n)} books">
          <div class="bar__fill" style="--w:${(n / max) * 100}%; --i:${i}"></div>
        </div>
      </li>`).join('') : '<li class="bar"><p class="bar__top">Nothing to chart yet</p></li>';

    // Donut
    const C = 2 * Math.PI * 52;
    const total = m.total || 1;
    const fDone = m.finished / total;
    const fRead = m.reading / total;
    const done = $('.donut__seg--done');
    const reading = $('.donut__seg--reading');
    done.style.strokeDasharray = `${fDone * C} ${C}`;
    done.style.strokeDashoffset = '0';
    reading.style.strokeDasharray = `${fRead * C} ${C}`;
    reading.style.strokeDashoffset = `${-fDone * C}`;

    set('finishedPct', `${Math.round(fDone * 100)}%`);
    set('finished', num(m.finished));
    set('reading', num(m.reading));
    set('unread', num(m.unread));
    set('pagesRead', num(m.pagesRead));
    set('pagesTotal', num(m.pagesTotal));
    set('avgRating', m.avgRating ? `${m.avgRating} ★` : '—');

    // Authors
    const authors = new Map();
    state.books.forEach(b => authors.set(b.author, (authors.get(b.author) || 0) + 1));
    const top = [...authors.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 5);
    $('#authorRanks').innerHTML = top.length
      ? top.map(([a, n]) => `<li>${esc(a)}<span>${plural(n, 'book', 'books')}</span></li>`).join('')
      : '<li>No authors yet</li>';

    // Lending
    const borrowers = new Map();
    state.history.filter(h => h.type === 'borrow').forEach(h => borrowers.set(h.borrower, (borrowers.get(h.borrower) || 0) + 1));
    const topBorrower = [...borrowers.entries()].sort((a, b) => b[1] - a[1])[0];
    set('loans', num(m.loans));
    set('out', num(m.borrowed));
    set('overdue', num(m.overdue));
    set('topBorrower', topBorrower ? topBorrower[0] : '—');
  }

  /* ── Dialog controller (one for all modals) ────────────────────────────── */
  const Dialog = {
    open(dlg, focusSel) {
      if (!dlg.open) dlg.showModal();          // re-opening an open dialog throws
      const target = focusSel ? $(focusSel, dlg) : $('input, select, textarea, button:not([data-close])', dlg);
      target?.focus({ preventScroll: true });
    },
    close(dlg) {
      if (!dlg.open || dlg.classList.contains('is-closing')) return;
      const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
      if (reduce) return dlg.close();
      dlg.classList.add('is-closing');
      dlg.addEventListener('animationend', function done(e) {
        if (e.target !== dlg) return;          // ignore animations from descendants
        dlg.removeEventListener('animationend', done);
        dlg.classList.remove('is-closing');
        dlg.close();
      });
    },
  };

  $$('dialog').forEach(dlg => {
    dlg.addEventListener('cancel', e => { e.preventDefault(); Dialog.close(dlg); });
    dlg.addEventListener('click', e => {
      if (e.target.closest('[data-close]')) Dialog.close(dlg);
      else if (e.target === dlg) Dialog.close(dlg);   // click on the backdrop area
    });
  });

  /* ── Toasts ────────────────────────────────────────────────────────────── */
  let toastTimer;
  function toast(message, tone = 'ok', undo) {
    const node = document.createElement('div');
    node.className = 'toast';
    node.dataset.tone = tone;
    const icon = tone === 'error' ? 'i-alert' : tone === 'warn' ? 'i-clock' : 'i-check';
    node.innerHTML = `<svg class="icon" aria-hidden="true"><use href="#${icon}"/></svg><span>${esc(message)}</span>`;

    if (undo) {
      const btn = document.createElement('button');
      btn.className = 'toast__undo';
      btn.type = 'button';
      btn.textContent = 'Undo';
      btn.addEventListener('click', () => { undo(); dismiss(node); });
      node.append(btn);
    }

    el.toasts.append(node);
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => dismiss(node), undo ? 7000 : 3600);
  }
  function dismiss(node) {
    if (!node.isConnected) return;
    node.classList.add('is-out');
    node.addEventListener('animationend', () => node.remove(), { once: true });
    setTimeout(() => node.remove(), 400);
  }

  /* ── Actions ───────────────────────────────────────────────────────────── */
  function setView(view) {
    if (!TEXTS[view]) return;
    state.view = view;
    el.app.classList.remove('rail-open');
    $('#railToggle').setAttribute('aria-expanded', 'false');
    $('#scroll').scrollTo({ top: 0, behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
    render();
    el.viewTitle.setAttribute('tabindex', '-1');
    el.viewTitle.focus({ preventScroll: true });
  }

  function toggleFav(id) {
    const b = byId(id);
    if (!b) return;
    b.favorite = !b.favorite;
    render();
    toast(b.favorite ? `“${b.title}” added to favorites` : `“${b.title}” removed from favorites`);
  }

  function deleteBook(id) {
    const index = state.books.findIndex(b => b.id === id);
    if (index < 0) return;
    const [removed] = state.books.splice(index, 1);
    render();
    toast(`“${removed.title}” deleted`, 'warn', () => {
      state.books.splice(index, 0, removed);
      render();
      toast(`“${removed.title}” restored`);
    });
  }

  function returnBook(id) {
    const b = byId(id);
    if (!b || b.status !== 'borrowed') return;
    const late = isOverdue(b);
    state.history.push({
      id: uid(), bookId: b.id, type: 'return',
      borrower: b.borrower, date: new Date().toISOString(), due: b.dueAt,
    });
    const who = b.borrower;
    b.status = 'available'; b.borrower = null; b.borrowedAt = null; b.dueAt = null;
    render();
    toast(`“${b.title}” returned by ${who}${late ? ' — late' : ''}`, late ? 'warn' : 'ok');
  }

  /* ── Book form (add / edit) ────────────────────────────────────────────── */
  const form = $('#bookForm');
  const ratingInput = $('#ratingInput');
  let rating = 0;

  function paintRating() {
    $$('.rating__star', ratingInput).forEach(s => {
      const on = Number(s.dataset.value) <= rating;
      s.classList.toggle('is-on', on);
      s.setAttribute('aria-checked', String(Number(s.dataset.value) === rating));
      s.tabIndex = Number(s.dataset.value) === (rating || 1) ? 0 : -1;
    });
  }

  function openForm(id) {
    state.editingId = id ?? null;
    const b = id ? byId(id) : null;

    $('#formTitle').textContent = b ? 'Edit book' : 'Add a book';
    $('#formEyebrow').textContent = b ? 'Catalogue · edit' : 'Catalogue';
    $('#formSubmit').querySelector('span').textContent = b ? 'Save changes' : 'Add to library';

    form.reset();
    $$('.err', form).forEach(e => { e.hidden = true; });
    $$('input, textarea', form).forEach(i => i.removeAttribute('aria-invalid'));

    $('#f-title').value = b?.title ?? '';
    $('#f-author').value = b?.author ?? '';
    $('#f-category').value = b?.category ?? '';
    $('#f-year').value = b?.year ?? '';
    $('#f-pages').value = b?.pages ?? '';
    $('#f-isbn').value = b?.isbn ?? '';
    $('#f-desc').value = b?.description ?? '';
    $('#f-fav').checked = !!b?.favorite;
    $('#f-progress').value = b?.progress ?? 0;
    syncRange($('#f-progress'));
    rating = b?.rating ?? 0;
    paintRating();

    $('#categoryList').innerHTML = categories().map(c => `<option value="${esc(c)}">`).join('');
    Dialog.open($('#formModal'), '#f-title');
  }

  function validate() {
    let ok = true;
    const rules = [
      ['#f-title', '#e-title', v => v.trim().length > 0],
      ['#f-author', '#e-author', v => v.trim().length > 0],
      ['#f-year', '#e-year', v => v === '' || (Number(v) >= 1 && Number(v) <= 2100)],
      ['#f-pages', '#e-pages', v => v === '' || Number(v) >= 1],
    ];
    for (const [inputSel, errSel, test] of rules) {
      const input = $(inputSel), err = $(errSel);
      const valid = test(input.value);
      err.hidden = valid;
      input.setAttribute('aria-invalid', String(!valid));
      if (!valid && ok) { input.focus(); ok = false; }
    }
    return ok;
  }

  form.addEventListener('submit', e => {
    e.preventDefault();
    if (!validate()) return;

    const data = {
      title: $('#f-title').value.trim(),
      author: $('#f-author').value.trim(),
      category: $('#f-category').value.trim() || 'Uncategorised',
      year: $('#f-year').value ? Number($('#f-year').value) : null,
      pages: $('#f-pages').value ? Number($('#f-pages').value) : null,
      isbn: $('#f-isbn').value.trim() || null,
      description: $('#f-desc').value.trim(),
      progress: Number($('#f-progress').value),
      favorite: $('#f-fav').checked,
      rating,
    };

    if (state.editingId) {
      Object.assign(byId(state.editingId), data);
      toast(`“${data.title}” updated`);
    } else {
      state.books.unshift({
        id: uid(), ...data,
        status: 'available', borrower: null, borrowedAt: null, dueAt: null,
        addedAt: new Date().toISOString(),
      });
      toast(`“${data.title}” added to your library`);
    }
    state.editingId = null;
    Dialog.close($('#formModal'));
    render();
  });

  // Rating: click + roving-tabindex arrow keys (WAI-ARIA radiogroup pattern)
  ratingInput.addEventListener('click', e => {
    const star = e.target.closest('.rating__star');
    if (!star) return;
    rating = Number(star.dataset.value);
    paintRating();
  });
  $('#ratingClear').addEventListener('click', () => { rating = 0; paintRating(); });
  ratingInput.addEventListener('keydown', e => {
    if (!e.target.closest('.rating__star')) return;
    const dir = { ArrowRight: 1, ArrowUp: 1, ArrowLeft: -1, ArrowDown: -1 }[e.key];
    if (!dir) return;
    e.preventDefault();
    rating = Math.min(5, Math.max(1, (rating || 0) + dir));
    paintRating();
    $(`.rating__star[data-value="${rating}"]`, ratingInput).focus();
  });

  const syncRange = input => {
    input.style.setProperty('--fill', `${input.value}%`);
    const out = $('#progressOut');
    if (out && input.id === 'f-progress') out.textContent = `${input.value}%`;
  };
  $('#f-progress').addEventListener('input', e => syncRange(e.target));

  /* ── Borrow flow ───────────────────────────────────────────────────────── */
  const borrowForm = $('#borrowForm');

  function openBorrow(id) {
    const b = byId(id);
    if (!b) return;
    state.lendingId = id;
    $('#borrowBook').innerHTML = `<b>${esc(b.title)}</b> by ${esc(b.author)}`;
    borrowForm.reset();
    $('#e-borrower').hidden = true;
    $('#f-borrower').removeAttribute('aria-invalid');
    $('#f-due').value = addDays(14);
    $('#borrowerList').innerHTML = [...new Set(state.history.map(h => h.borrower))]
      .map(n => `<option value="${esc(n)}">`).join('');
    Dialog.open($('#borrowModal'), '#f-borrower');
  }

  borrowForm.addEventListener('submit', e => {
    e.preventDefault();
    const nameInput = $('#f-borrower');
    const name = nameInput.value.trim();
    if (!name) {
      $('#e-borrower').hidden = false;
      nameInput.setAttribute('aria-invalid', 'true');
      nameInput.focus();
      return;
    }
    const b = byId(state.lendingId);
    if (!b) return;

    const due = $('#f-due').value ? new Date($('#f-due').value).toISOString() : null;
    b.status = 'borrowed';
    b.borrower = name;
    b.borrowedAt = new Date().toISOString();
    b.dueAt = due;
    state.history.push({ id: uid(), bookId: b.id, type: 'borrow', borrower: name, date: b.borrowedAt, due });

    Dialog.close($('#borrowModal'));
    render();
    toast(`“${b.title}” lent to ${name}${due ? `, due ${fmtDate(due)}` : ''}`);
  });

  /* ── Confirm dialog ────────────────────────────────────────────────────── */
  let confirmAction = null;
  function confirmThen({ title, text, cta = 'Delete', action }) {
    $('#confirmTitle').textContent = title;
    $('#confirmText').textContent = text;
    $('#confirmOk').querySelector('span').textContent = cta;
    confirmAction = action;
    Dialog.open($('#confirmModal'), '.modal__foot [data-close]');   // focus the safe choice
  }
  $('#confirmOk').addEventListener('click', () => {
    Dialog.close($('#confirmModal'));
    confirmAction?.();
    confirmAction = null;
  });

  /* ── Detail dialog ─────────────────────────────────────────────────────── */
  function openDetail(id) {
    const b = byId(id);
    if (!b) return;
    const out = b.status === 'borrowed';
    const late = isOverdue(b);
    const dlg = $('#detailModal');

    const timeline = state.history
      .filter(h => h.bookId === b.id)
      .sort((a, x) => new Date(x.date) - new Date(a.date))
      .map(h => `
        <li style="--tint:${h.type === 'borrow' ? 'var(--brass)' : 'var(--jade)'}">
          <p>${h.type === 'borrow' ? 'Lent to' : 'Returned by'} <b>${esc(h.borrower)}</b></p>
          <time datetime="${esc(h.date)}">${esc(fmtDate(h.date))}</time>
        </li>`).join('');

    const loanCard = out ? `
      <div class="loan-card" data-late="${late}">
        <p class="row"><svg class="icon" aria-hidden="true"><use href="#i-user"/></svg>Lent to <b>${esc(b.borrower)}</b> on ${esc(fmtDate(b.borrowedAt))}</p>
        <p class="row"><svg class="icon" aria-hidden="true"><use href="#i-clock"/></svg>${
          b.dueAt
            ? late
              ? `Overdue by <b>${plural(Math.abs(daysUntil(b.dueAt)), 'day', 'days')}</b>`
              : `Due back in <b>${plural(Math.max(daysUntil(b.dueAt), 0), 'day', 'days')}</b> — ${esc(fmtDate(b.dueAt))}`
            : 'No due date set'
        }</p>
      </div>` : '';

    $('#detailBody').innerHTML = `
      <div class="detail" style="--spine:${spineOf(b)}">
        <div class="detail__cover">
          <span class="cover">
            <span class="cover__spine" aria-hidden="true"></span>
            <span class="cover__body">
              <span class="cover__cat">${esc(b.category)}</span>
              <span class="cover__title">${esc(b.title)}</span>
              <span class="cover__rule" aria-hidden="true"></span>
              <span class="cover__author">${esc(b.author)}</span>
            </span>
            <span class="cover__seal" aria-hidden="true"></span>
          </span>
        </div>

        <div class="detail__meta">
          <div class="modal__head" style="padding:0 0 var(--s3)">
            <div>
              <p class="detail__cat">${esc(b.category)}</p>
              <h2 id="detailTitle">${esc(b.title)}</h2>
              <p class="detail__author">${esc(b.author)}${b.year ? ` · ${b.year}` : ''}</p>
              ${b.rating ? `<p class="detail__stars" aria-label="Rated ${b.rating} out of 5">${stars(b.rating)}</p>` : ''}
            </div>
            <button type="button" class="icon-btn" data-close aria-label="Close dialog"><svg class="icon" aria-hidden="true"><use href="#i-x"/></svg></button>
          </div>

          ${b.description ? `<p class="detail__desc">${esc(b.description)}</p>` : ''}

          <dl class="facts">
            <div><dt>Status</dt><dd>${late ? 'Overdue' : out ? 'On loan' : 'Shelved'}</dd></div>
            <div><dt>Pages</dt><dd>${b.pages ? num(b.pages) : '—'}</dd></div>
            <div><dt>Published</dt><dd>${b.year || '—'}</dd></div>
            <div><dt>Added</dt><dd>${esc(fmtDate(b.addedAt))}</dd></div>
            <div><dt>ISBN</dt><dd class="mono" style="font-size:.78rem">${esc(b.isbn || '—')}</dd></div>
          </dl>

          ${loanCard}

          <div class="detail__progress">
            <div class="row">
              <label for="d-progress">Reading progress</label>
              <output id="d-out" class="mono">${b.progress}% · ${b.pages ? `${num(Math.round(b.pages * b.progress / 100))} of ${num(b.pages)} pages` : readState(b)}</output>
            </div>
            <input id="d-progress" type="range" min="0" max="100" step="1" value="${b.progress}" style="--fill:${b.progress}%" aria-describedby="d-out">
          </div>

          <div class="detail__acts">
            <button class="btn ${out ? 'btn--primary' : 'btn--primary'}" data-detail="loan">
              <svg class="icon" aria-hidden="true"><use href="#${out ? 'i-back' : 'i-out'}"/></svg>
              <span>${out ? 'Mark returned' : 'Lend book'}</span>
            </button>
            <button class="btn btn--ghost" data-detail="fav" aria-pressed="${!!b.favorite}">
              <svg class="icon" aria-hidden="true" ${b.favorite ? 'style="fill:var(--rose);color:var(--rose)"' : ''}><use href="#i-heart"/></svg>
              <span>${b.favorite ? 'Favorited' : 'Add to favorites'}</span>
            </button>
            <button class="btn btn--ghost" data-detail="edit"><svg class="icon" aria-hidden="true"><use href="#i-pencil"/></svg><span>Edit</span></button>
            <button class="btn btn--ghost" data-detail="del"><svg class="icon" aria-hidden="true"><use href="#i-trash"/></svg><span>Delete</span></button>
          </div>

          ${timeline ? `<div class="timeline"><h3>Borrowing history</h3><ol role="list">${timeline}</ol></div>` : ''}
        </div>
      </div>`;

    dlg.dataset.id = b.id;
    Dialog.open(dlg, '[data-detail="loan"]');
  }

  $('#detailBody').addEventListener('input', e => {
    if (e.target.id !== 'd-progress') return;
    const b = byId($('#detailModal').dataset.id);
    if (!b) return;
    b.progress = Number(e.target.value);
    e.target.style.setProperty('--fill', `${b.progress}%`);
    $('#d-out').textContent = `${b.progress}% · ${b.pages ? `${num(Math.round(b.pages * b.progress / 100))} of ${num(b.pages)} pages` : readState(b)}`;
    debouncedRender();
  });
  const debouncedRender = debounce(render, 220);

  $('#detailBody').addEventListener('click', e => {
    const btn = e.target.closest('[data-detail]');
    if (!btn) return;
    const id = $('#detailModal').dataset.id;
    const b = byId(id);
    if (!b) return;

    switch (btn.dataset.detail) {
      case 'loan':
        Dialog.close($('#detailModal'));
        b.status === 'borrowed' ? returnBook(id) : setTimeout(() => openBorrow(id), 180);
        break;
      case 'fav':
        toggleFav(id);
        openDetail(id);
        break;
      case 'edit':
        Dialog.close($('#detailModal'));
        setTimeout(() => openForm(id), 180);
        break;
      case 'del':
        Dialog.close($('#detailModal'));
        setTimeout(() => askDelete(id), 180);
        break;
    }
  });

  function askDelete(id) {
    const b = byId(id);
    if (!b) return;
    confirmThen({
      title: 'Delete this book?',
      text: `“${b.title}” will be removed from your library. You can undo this straight away.`,
      cta: 'Delete book',
      action: () => deleteBook(id),
    });
  }

  /* ── Grid & list events (delegated) ────────────────────────────────────── */
  el.grid.addEventListener('click', e => {
    const btn = e.target.closest('[data-act]');
    if (!btn) return;
    const id = btn.closest('.card').dataset.id;
    const b = byId(id);
    if (!b) return;

    switch (btn.dataset.act) {
      case 'open': openDetail(id); break;
      case 'fav': toggleFav(id); break;
      case 'edit': openForm(id); break;
      case 'del': askDelete(id); break;
      case 'loan': b.status === 'borrowed' ? returnBook(id) : openBorrow(id); break;
    }
  });

  document.addEventListener('click', e => {
    const opener = e.target.closest('[data-open]');
    if (opener) openDetail(opener.dataset.open);
  });

  el.chips.addEventListener('click', e => {
    const chip = e.target.closest('.chip');
    if (!chip) return;
    state.category = chip.dataset.cat;
    render();
  });

  $('[data-action="add-first"]').addEventListener('click', () => openForm());

  /* ── Toolbar ───────────────────────────────────────────────────────────── */
  $('#statusFilter').addEventListener('change', e => { state.status = e.target.value; render(); });
  $('#sortSelect').addEventListener('change', e => { state.sort = e.target.value; render(); });
  $('#historyFilter').addEventListener('change', e => { state.historyFilter = e.target.value; render(); });

  const setLayout = layout => {
    state.layout = layout;
    $('#gridBtn').classList.toggle('is-active', layout === 'grid');
    $('#listBtn').classList.toggle('is-active', layout === 'list');
    $('#gridBtn').setAttribute('aria-pressed', String(layout === 'grid'));
    $('#listBtn').setAttribute('aria-pressed', String(layout === 'list'));
    render();
  };
  $('#gridBtn').addEventListener('click', () => setLayout('grid'));
  $('#listBtn').addEventListener('click', () => setLayout('list'));

  $('#clearHistoryBtn').addEventListener('click', () => {
    if (!state.history.length) return toast('There is no history to clear.', 'warn');
    confirmThen({
      title: 'Clear the whole history?',
      text: 'Every loan and return record will be erased. Books currently on loan stay on loan.',
      cta: 'Clear history',
      action: () => { state.history = []; render(); toast('Borrowing history cleared', 'warn'); },
    });
  });

  /* ── Search ────────────────────────────────────────────────────────────── */
  $('#searchForm').addEventListener('submit', e => e.preventDefault());
  el.searchInput.addEventListener('input', debounce(e => {
    state.query = e.target.value;
    if (state.view === 'history' || state.view === 'stats') state.view = 'library';
    render();
  }, 120));
  el.searchClear.addEventListener('click', () => {
    el.searchInput.value = '';
    state.query = '';
    render();
    el.searchInput.focus();
  });

  /* ── Navigation & rail ─────────────────────────────────────────────────── */
  $$('.nav__item').forEach(btn => btn.addEventListener('click', () => setView(btn.dataset.view)));

  $('#railToggle').addEventListener('click', () => {
    const open = el.app.classList.toggle('rail-open');
    $('#railToggle').setAttribute('aria-expanded', String(open));
    if (open) $('.nav__item').focus();
  });
  el.app.addEventListener('click', e => {
    if (el.app.classList.contains('rail-open') && !e.target.closest('.rail') && !e.target.closest('#railToggle')) {
      el.app.classList.remove('rail-open');
      $('#railToggle').setAttribute('aria-expanded', 'false');
    }
  });

  /* ── Theme ─────────────────────────────────────────────────────────────── */
  const applyTheme = () => {
    document.documentElement.dataset.theme = state.theme;
    $('#themeBtn').setAttribute('aria-label', state.theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme');
  };
  const toggleTheme = () => { state.theme = state.theme === 'dark' ? 'light' : 'dark'; applyTheme(); persist(); };
  $('#themeBtn').addEventListener('click', toggleTheme);

  /* ── Import / export ───────────────────────────────────────────────────── */
  $('#exportBtn').addEventListener('click', () => {
    const blob = new Blob([JSON.stringify({ version: 1, books: state.books, history: state.history }, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `shelf-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
    toast(`Exported ${plural(state.books.length, 'book', 'books')}`);
  });

  $('#importBtn').addEventListener('click', () => $('#importInput').click());
  $('#importInput').addEventListener('change', async e => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const data = JSON.parse(await file.text());
      if (!Array.isArray(data.books)) throw new Error('shape');
      const existing = new Set(state.books.map(b => b.id));
      const incoming = data.books.filter(b => b.title && b.author).map(b => ({
        ...b, id: existing.has(b.id) ? uid() : (b.id || uid()),
        progress: Number(b.progress) || 0,
        status: b.status === 'borrowed' ? 'borrowed' : 'available',
        addedAt: b.addedAt || new Date().toISOString(),
      }));
      state.books.push(...incoming);
      if (Array.isArray(data.history)) state.history.push(...data.history.filter(h => h.bookId && h.type));
      render();
      toast(`Imported ${plural(incoming.length, 'book', 'books')}`);
    } catch {
      toast("That file isn't a Shelf export.", 'error');
    } finally {
      e.target.value = '';
    }
  });

  $('#shortcutsBtn').addEventListener('click', () => Dialog.open($('#keysModal')));
  $('#addBtn').addEventListener('click', () => openForm());

  /* ── Keyboard ──────────────────────────────────────────────────────────── */
  const VIEW_KEYS = { l: 'library', f: 'favorites', b: 'borrowed', h: 'history', s: 'stats' };
  let awaitingGo = false;

  document.addEventListener('keydown', e => {
    const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName);
    const inDialog = !!e.target.closest('dialog');

    if (e.key === 'Escape' && typing && e.target === el.searchInput) {
      el.searchInput.value = ''; state.query = ''; render(); return;
    }
    if (typing || inDialog || e.metaKey || e.ctrlKey || e.altKey) return;

    if (awaitingGo) {
      awaitingGo = false;
      const view = VIEW_KEYS[e.key.toLowerCase()];
      if (view) { e.preventDefault(); setView(view); return; }
    }

    switch (e.key.toLowerCase()) {
      case '/': e.preventDefault(); el.searchInput.focus(); break;
      case 'n': e.preventDefault(); openForm(); break;
      case 't': toggleTheme(); break;
      case 'g': awaitingGo = true; setTimeout(() => { awaitingGo = false; }, 1200); break;
      case '?': Dialog.open($('#keysModal')); break;
    }
  });

  /* ── Boot ──────────────────────────────────────────────────────────────── */
  applyTheme();
  $('#sortSelect').value = state.sort;
  setLayout(state.layout);   // calls render()
})();
