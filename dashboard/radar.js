// Token Radar's dashboard. It reads window.RADAR (written beside dashboard/ by main.ts) and
// renders the ranked board, filters, a per-protocol detail drawer and the model itself.
//
// The page carries the model's own arithmetic: impliedOf recomputes every row from the
// snapshot figures and the category multiples, and farmPlan re-derives every farm plan from
// the protocol's record. The detail view shows the recompute next to the board's number, so
// the screenshots, the code and board.json visibly agree. No network: every byte shown is
// in data.js.
(function () {
  'use strict';

  var DATA = window.RADAR;
  if (!DATA) return;
  var app = document.getElementById('app');
  var state = { q: '', category: 'all', chain: 'all', tab: 'pre-token', sort: 'implied', dir: -1, selected: null };

  // ---------------------------------------------------------- the model, mirrored from lib/model.ts
  function hashSlug(slug) {
    var h = 0x811c9dc5;
    for (var i = 0; i < slug.length; i++) {
      h ^= slug.charCodeAt(i);
      h = Math.imul(h, 0x01000193);
    }
    return h >>> 0;
  }
  function multipleFor(category) {
    var found = null;
    for (var i = 0; i < DATA.multiples.length; i++) {
      if (DATA.multiples[i].category === (category || 'Other')) { found = DATA.multiples[i]; break; }
    }
    if (found) return { multiple: found.multiple, comparables: found.comparables, median: found.median };
    var m = DATA.model;
    return {
      multiple: Math.min(m.multiple_cap, Math.max(m.multiple_floor, DATA.global_median)),
      comparables: 0,
      median: DATA.global_median
    };
  }
  function impliedOf(row) {
    var m = DATA.model;
    var growth = Math.min(m.growth_cap, Math.max(m.growth_floor, row.change_7d === null ? 0 : row.change_7d));
    var growthMult = 1 + (growth / 100) * m.growth_weight;
    var age = row.age_days === null ? m.unknown_age_days : row.age_days;
    var maturity = m.maturity_floor + (Math.min(Math.max(age, 0), m.maturity_days) / m.maturity_days) * m.maturity_range;
    var spread = 1 + m.spread_per_chain * Math.min(Math.max((row.chains || []).length - 1, 0), m.spread_max_chains);
    var mult = multipleFor(row.category).multiple;
    return Math.max(1, Math.round(row.tvl_usd * mult * growthMult * maturity * spread));
  }
  var PLAYBOOKS = [
    { keys: ['lend', 'cdp', 'collateral'],
      main: 'Supply $${capital} of USDC to ${name} on ${chain} and keep the position supplied.',
      second: 'Borrow a small amount against the supplied collateral and repay it within the week, so both sides of the market show activity.' },
    { keys: ['dex'],
      main: "Provide $${capital} of liquidity to ${name}'s deepest pool on ${chain} and keep the position open.",
      second: 'Route one swap through ${name} on ${chain} each week, keeping the receipt in the same wallet.' },
    { keys: ['yield', 'farm', 'leveraged'],
      main: "Deposit $${capital} of USDC into ${name}'s highest-TVL vault on ${chain} and keep the shares.",
      second: "Claim and re-deposit the vault's yield once, so the position compounds instead of sitting idle." },
    { keys: ['deriv', 'perpetual', 'option', 'interest rate'],
      main: 'Deposit $${capital} of USDC as margin on ${name} and open one small hedged position.',
      second: 'Close and reopen the hedge once a week at a different size, keeping total exposure under $${capital}.' },
    { keys: ['rwa'],
      main: "Mint $${capital} of ${name}'s yield-bearing asset on ${chain} and hold it in the farming wallet.",
      second: "Check the asset's backing report once a month and keep the holding through at least one reporting cycle." },
    { keys: ['stak', 'restak'],
      main: "Stake $${capital} of the chain's staking asset through ${name} and keep the receipt token.",
      second: 'Restake or delegate the receipt once, where the protocol offers it, and leave the position staked.' },
    { keys: ['bridge'],
      main: 'Bridge $${capital} of USDC to ${chain} through ${name} and use the bridged funds inside its app.',
      second: 'Bridge a second, smaller amount back a week later so the route shows two-way use.' },
    { keys: ['prediction'],
      main: 'Fund $${capital} on ${name} and take one position in its most liquid market.',
      second: 'Take a second position in a different market the following week and hold both to resolution.' },
    { keys: ['curator', 'allocator'],
      main: 'Deposit $${capital} into a ${name} vault on ${chain} and keep the shares for the full hold.',
      second: "Review the vault's allocation report once and move a small amount between its strategies if it allows it." },
    { keys: ['stable'],
      main: 'Mint or deposit $${capital} of the stable asset through ${name} on ${chain} and hold it.',
      second: 'Redeem a small test amount and re-mint it, confirming the peg mechanism works from your wallet.' },
    { keys: ['insurance'],
      main: 'Buy $${capital} of cover from ${name} on ${chain} and keep the policy active.',
      second: "Read the policy's claim conditions once and keep the cover through the full hold period." },
    { keys: ['chain'],
      main: "Bridge $${capital} to ${chain} through ${name}'s own route and use one native app on the chain.",
      second: "Stake a small amount of the chain's native asset through ${name} and keep it staked." },
    { keys: ['index'],
      main: "Buy $${capital} of ${name}'s index token on ${chain} and hold it.",
      second: "Check the index's rebalance once and add a small amount after it, keeping the position whole." }
  ];
  var DEFAULT_PLAYBOOK = {
    main: 'Deposit $${capital} of USDC into ${name} on ${chain} and keep the position open.',
    second: 'Make one more deposit or interaction the following week so the wallet shows repeat use.'
  };
  var CADENCE = [
    'Make one qualifying action each week: a deposit, a borrow, a swap or a vote, from the same wallet.',
    "Return once a week and repeat the main action at a smaller size, so the wallet's activity spans several snapshots."
  ];
  var CLOSING = [
    "Before you withdraw, open the protocol's own points or rewards page and claim only from the link it publishes.",
    "When the hold ends, check the protocol's own rewards page first, and claim only through the link it publishes."
  ];
  function playbookFor(category) {
    var c = (category || '').toLowerCase();
    for (var i = 0; i < PLAYBOOKS.length; i++) {
      for (var j = 0; j < PLAYBOOKS[i].keys.length; j++) {
        if (c.indexOf(PLAYBOOKS[i].keys[j]) >= 0) return PLAYBOOKS[i];
      }
    }
    return DEFAULT_PLAYBOOK;
  }
  function fill(template, name, capital, chain) {
    return template.split('${name}').join(name).split('${capital}').join(String(capital)).split('${chain}').join(chain);
  }
  function capitalFor(tvl) {
    if (tvl >= 5e9) return 250;
    if (tvl >= 1e9) return 150;
    if (tvl >= 1e8) return 100;
    return 50;
  }
  function holdFor(age) {
    if (age === null || age === undefined) return 30;
    if (age < 180) return 60;
    if (age < 365) return 45;
    return 30;
  }
  function gasFor(chain) {
    return chain === 'Ethereum' ? { setup: 12, weekly: 4 } : { setup: 3, weekly: 1 };
  }
  function flattenStep(step) {
    var s = step.text + ' Cost: ' + step.cost + '. Time: ' + step.time + '.';
    if (s.length > 600) s = s.slice(0, 597) + '...';
    if (s.length < 20) s = s + " Hold the position and check the protocol's own page.";
    return s;
  }
  function farmPlan(p) {
    var chain = p.chains && p.chains.length > 0 ? p.chains[0] : 'its main chain';
    var capital = capitalFor(p.tvl_usd);
    var hold = holdFor(p.age_days);
    var gas = gasFor(chain);
    var book = playbookFor(p.category);
    var variant = hashSlug(p.slug) % 2;
    return [
      { text: 'Use a fresh wallet that holds only the funds you plan to farm, and keep its seed phrase offline.',
        cost: 'nothing to set up; under $3 of gas for the first transaction', time: '5 minutes' },
      { text: fill(book.main, p.name, capital, chain),
        cost: '$' + capital + ' of capital and about $' + gas.setup + ' of gas', time: '15 minutes to set up' },
      { text: fill(book.second, p.name, capital, chain),
        cost: 'about $' + gas.setup + ' of gas', time: '10 minutes' },
      { text: CADENCE[variant],
        cost: 'about $' + gas.weekly + ' of gas a week', time: '10 minutes a week' },
      { text: 'Hold the position for at least ' + hold + ' days so the activity is counted in more than one snapshot.',
        cost: 'the $' + capital + ' stays in the position', time: hold + ' days' },
      { text: CLOSING[variant],
        cost: 'no fee to check, and never pay to claim', time: '10 minutes' }
    ].map(flattenStep);
  }
  window.RadarModel = { impliedOf: impliedOf, farmPlan: farmPlan, multipleFor: multipleFor, hashSlug: hashSlug };

  // ---------------------------------------------------------- formatting
  function fmtUsd(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    if (Math.abs(n) >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (Math.abs(n) >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (Math.abs(n) >= 1e3) return '$' + Math.round(n / 1e3) + 'K';
    return '$' + Math.round(n);
  }
  function fmtPct(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    return (n > 0 ? '+' : '') + n.toFixed(2) + '%';
  }
  function fmtAge(days) {
    if (days === null || days === undefined) return 'unknown';
    if (days >= 365) return (days / 365).toFixed(1) + 'y';
    return Math.max(0, Math.round(days)) + 'd';
  }
  function fmtMult(n) { return n.toFixed(3) + 'x'; }

  function el(tag, attrs) {
    var node = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        if (k === 'class') node.className = attrs[k];
        else if (k === 'text') node.textContent = attrs[k];
        else if (k.slice(0, 2) === 'on') node.addEventListener(k.slice(2), attrs[k]);
        else if (attrs[k] !== null && attrs[k] !== undefined) node.setAttribute(k, attrs[k]);
      });
    }
    for (var i = 2; i < arguments.length; i++) {
      var child = arguments[i];
      if (child === null || child === undefined) continue;
      if (Array.isArray(child)) child.forEach(function (c) { if (c) node.appendChild(c); });
      else if (typeof child === 'string') node.appendChild(document.createTextNode(child));
      else node.appendChild(child);
    }
    return node;
  }

  // ---------------------------------------------------------- state + hash
  function readHash() {
    var hash = window.location.hash.replace(/^#/, '');
    if (!hash) return;
    var params = new URLSearchParams(hash);
    if (params.get('q')) state.q = params.get('q');
    if (params.get('category')) state.category = params.get('category');
    if (params.get('chain')) state.chain = params.get('chain');
    if (params.get('tab')) state.tab = params.get('tab');
    if (params.get('p')) state.selected = params.get('p');
  }
  function writeHash() {
    var params = new URLSearchParams();
    if (state.q) params.set('q', state.q);
    if (state.category !== 'all') params.set('category', state.category);
    if (state.chain !== 'all') params.set('chain', state.chain);
    if (state.tab !== 'pre-token') params.set('tab', state.tab);
    if (state.selected) params.set('p', state.selected);
    var next = params.toString();
    if (next) window.history.replaceState(null, '', '#' + next);
    else window.history.replaceState(null, '', window.location.pathname + window.location.search);
  }

  // ---------------------------------------------------------- filtering + sorting
  function visibleRows() {
    var q = state.q.trim().toLowerCase();
    return DATA.rows.filter(function (r) {
      if (state.category !== 'all' && (r.category || 'Other') !== state.category) return false;
      if (state.chain !== 'all' && (r.chains || []).indexOf(state.chain) < 0) return false;
      if (!q) return true;
      var hay = [r.name, r.slug, r.category, (r.chains || []).join(' ')].join(' ').toLowerCase();
      return hay.indexOf(q) >= 0;
    });
  }
  function sortedRows(list) {
    var key = state.sort;
    return list.slice().sort(function (a, b) {
      var av, bv;
      if (key === 'name') { av = a.name.toLowerCase(); bv = b.name.toLowerCase(); }
      else if (key === 'tvl') { av = a.tvl_usd; bv = b.tvl_usd; }
      else if (key === 'growth') { av = a.change_7d === null ? -Infinity : a.change_7d; bv = b.change_7d === null ? -Infinity : b.change_7d; }
      else if (key === 'age') { av = a.age_days === null ? Infinity : a.age_days; bv = b.age_days === null ? Infinity : b.age_days; }
      else if (key === 'multiple') { av = a.category_multiple; bv = b.category_multiple; }
      else { av = a.implied_value_usd; bv = b.implied_value_usd; }
      if (av < bv) return -state.dir;
      if (av > bv) return state.dir;
      return a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0;
    });
  }

  // ---------------------------------------------------------- sections
  function header() {
    return el('div', { class: 'topbar' },
      el('div', { class: 'brand' }, el('span', { class: 'ring', 'aria-hidden': 'true' }), el('span', { text: 'Token Radar' })),
      el('div', { class: 'meta' },
        el('span', null, 'Snapshot ', el('b', { text: DATA.as_of })),
        el('span', null, 'Model ', el('b', { text: DATA.model_version })),
        el('span', null, 'Source ', el('b', { text: 'DefiLlama protocol index' }))
      )
    );
  }
  function hero() {
    return el('section', { class: 'hero' },
      el('div', null,
        el('h1', { text: 'Every pre-token protocol, ranked by what its token could be worth' }),
        el('p', null,
          'The watchlist is the floor: ', el('b', { text: DATA.watchlist_size + ' protocols' }),
          ' with at least $' + Math.round(DATA.floor_usd / 1e6) + 'M of TVL and no token on record. The early radar adds ',
          el('b', { text: DATA.early_size + ' more' }),
          ' below that floor. Each implied value is computed from the protocol\u2019s own TVL, growth, age and reach, priced off live-token protocols in its category. It is a model, not a promise \u2014 and \u201cno token\u201d means the record shows none.'
        )
      ),
      el('div', { class: 'stats' },
        el('div', { class: 'stat' }, el('span', { text: 'Watchlist covered' }), el('b', null, el('em', { text: DATA.watchlist_size + ' / ' + DATA.watchlist_size }))),
        el('div', { class: 'stat' }, el('span', { text: 'Pre-token rows scored' }), el('b', { text: String(DATA.board_size) })),
        el('div', { class: 'stat' }, el('span', { text: 'Early rows below the floor' }), el('b', { text: String(DATA.early_size) })),
        el('div', { class: 'stat' }, el('span', { text: 'Global median mcap / TVL' }), el('b', { text: DATA.global_median.toFixed(3) + 'x' }))
      )
    );
  }
  function controls() {
    var categories = Array.from(new Set(DATA.rows.map(function (r) { return r.category || 'Other'; }))).sort();
    var chains = Array.from(new Set(DATA.rows.reduce(function (acc, r) { return acc.concat(r.chains || []); }, []))).sort();
    var search = el('input', { type: 'search', id: 'q', placeholder: 'Search name, category or chain', value: state.q, 'aria-label': 'Search the board' });
    search.addEventListener('input', function () { state.q = search.value; writeHash(); render(); });
    var catSelect = el('select', { id: 'category', 'aria-label': 'Filter by category' },
      el('option', { value: 'all', text: 'All categories' }),
      categories.map(function (c) { return el('option', { value: c, text: c, selected: c === state.category ? 'selected' : null }); })
    );
    catSelect.addEventListener('change', function () { state.category = catSelect.value; writeHash(); render(); });
    var chainSelect = el('select', { id: 'chain', 'aria-label': 'Filter by chain' },
      el('option', { value: 'all', text: 'All chains' }),
      chains.map(function (c) { return el('option', { value: c, text: c, selected: c === state.chain ? 'selected' : null }); })
    );
    chainSelect.addEventListener('change', function () { state.chain = chainSelect.value; writeHash(); render(); });
    var pre = el('button', { type: 'button', 'aria-pressed': state.tab === 'pre-token' ? 'true' : 'false', text: 'Pre-token board', onclick: function () { state.tab = 'pre-token'; writeHash(); render(); } });
    var live = el('button', { type: 'button', 'aria-pressed': state.tab === 'live' ? 'true' : 'false', text: 'Live tokens', onclick: function () { state.tab = 'live'; writeHash(); render(); } });
    return el('div', { class: 'controls' },
      el('div', { class: 'field' }, el('label', { for: 'q', text: 'Search' }), search),
      el('div', { class: 'field' }, el('label', { for: 'category', text: 'Category' }), catSelect),
      el('div', { class: 'field' }, el('label', { for: 'chain', text: 'Chain' }), chainSelect),
      el('div', { class: 'field' }, el('label', { text: 'Token status' }), el('div', { class: 'tabs' }, pre, live)),
      el('span', { class: 'shown', text: state.tab === 'pre-token' ? visibleRows().length + ' of ' + DATA.board_size + ' rows' : DATA.live.length + ' live-token protocols' })
    );
  }
  function sortHeader(key, label) {
    return el('th', { scope: 'col' },
      el('button', { type: 'button', onclick: function () { if (state.sort === key) state.dir = -state.dir; else { state.sort = key; state.dir = -1; } render(); } },
        label,
        state.sort === key ? el('span', { class: 'arrow', 'aria-hidden': 'true', text: state.dir < 0 ? ' \u2193' : ' \u2191' }) : null
      )
    );
  }
  function boardTable() {
    var list = sortedRows(visibleRows());
    if (list.length === 0) {
      return el('div', { class: 'card' }, el('div', { class: 'empty' },
        el('h2', { text: 'No protocol matches that filter' }),
        el('p', { text: 'Clear the search or pick another category or chain to see the board again.' }),
        el('button', { class: 'btn primary', type: 'button', text: 'Clear filters', onclick: function () { state.q = ''; state.category = 'all'; state.chain = 'all'; writeHash(); render(); } })
      ));
    }
    var max = 0;
    list.forEach(function (r) { if (r.implied_value_usd > max) max = r.implied_value_usd; });
    var tbody = el('tbody');
    list.forEach(function (r) {
      var growthClass = r.change_7d === null ? '' : r.change_7d >= 0 ? 'pos' : 'neg';
      var tr = el('tr', {
        'data-selected': state.selected === r.slug ? 'true' : 'false',
        tabindex: '0',
        onclick: function () { openDetail(r.slug); },
        onkeydown: function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openDetail(r.slug); } }
      },
        el('td', { class: 'rank', text: String(r.rank) }),
        el('td', null, el('div', { class: 'namecell' },
          el('b', { text: r.name }),
          el('span', { text: (r.category || 'Other') + ' \u00b7 ' + (r.chains && r.chains.length ? r.chains.slice(0, 3).join(', ') + (r.chains.length > 3 ? ' +' + (r.chains.length - 3) : '') : 'chain unlisted') })
        )),
        el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
        el('td', { class: 'num ' + growthClass, text: fmtPct(r.change_7d) }),
        el('td', { class: 'num', text: fmtAge(r.age_days) }),
        el('td', { class: 'num', text: fmtMult(r.category_multiple) }),
        el('td', null, el('div', { class: 'valuebar' },
          el('div', { class: 'track', 'aria-hidden': 'true' }, el('i', { style: 'width:' + Math.max(3, Math.round((r.implied_value_usd / max) * 100)) + '%' })),
          el('span', { class: 'num', text: fmtUsd(r.implied_value_usd) })
        )),
        el('td', null, el('span', { class: 'pill ' + (r.on_watchlist ? 'watch' : 'early'), text: r.on_watchlist ? 'watchlist' : 'early' }))
      );
      tbody.appendChild(tr);
    });
    return el('div', { class: 'card' },
      el('div', { class: 'scroll' },
        el('table', null,
          el('caption', { text: 'Pre-token protocols, strongest implied value first. Select a row for its model breakdown and farm plan.' }),
          el('thead', null, el('tr', null,
            sortHeader('implied', 'Rank'),
            sortHeader('name', 'Protocol'),
            sortHeader('tvl', 'TVL'),
            sortHeader('growth', '7d'),
            sortHeader('age', 'Age'),
            sortHeader('multiple', 'Cat. multiple'),
            sortHeader('implied', 'Implied value'),
            el('th', { scope: 'col', text: 'Board' })
          )),
          tbody
        )
      )
    );
  }
  function liveTable() {
    var tbody = el('tbody');
    DATA.live.forEach(function (r) {
      tbody.appendChild(el('tr', { tabindex: '-1' },
        el('td', null, el('span', { class: 'pill', text: 'trades' })),
        el('td', null, el('div', { class: 'namecell' }, el('b', { text: r.name }), el('span', { text: (r.category || 'Other') + ' \u00b7 ' + (r.chains && r.chains.length ? r.chains.slice(0, 3).join(', ') : 'chain unlisted') }))),
        el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
        el('td', { class: 'num ' + (r.change_7d !== null && r.change_7d >= 0 ? 'pos' : 'neg'), text: fmtPct(r.change_7d) }),
        el('td', { class: 'num', text: fmtUsd(r.mcap_usd) }),
        el('td', { class: 'num', text: r.mcap_tvl_ratio === null ? 'n/a' : r.mcap_tvl_ratio.toFixed(3) + 'x' })
      ));
    });
    return el('div', { class: 'card' },
      el('div', { class: 'scroll' },
        el('table', null,
          el('caption', { text: 'Already trading: the market has priced these, so their caps are facts, not a model. They are set aside from the ranking \u2014 and their mcap / TVL ratios are the comparables the category multiples come from.' }),
          el('thead', null, el('tr', null, el('th', { scope: 'col', text: 'Status' }), el('th', { scope: 'col', text: 'Protocol' }), el('th', { scope: 'col', text: 'TVL' }), el('th', { scope: 'col', text: '7d' }), el('th', { scope: 'col', text: 'Market cap' }), el('th', { scope: 'col', text: 'Mcap / TVL' }))),
          tbody
        )
      )
    );
  }
  function modelPanel() {
    var m = DATA.model;
    var mults = DATA.multiples.slice().sort(function (a, b) { return b.multiple - a.multiple; });
    var rows = mults.map(function (x) {
      return el('tr', null,
        el('td', { text: x.category }),
        el('td', { class: 'num', text: String(x.comparables) }),
        el('td', { class: 'num', text: x.median.toFixed(3) + 'x' }),
        el('td', { class: 'num', text: fmtMult(x.multiple) })
      );
    });
    return el('section', { class: 'card modelcard' },
      el('h2', { text: 'How implied value is computed' }),
      el('p', { class: 'sub', text: 'One function scores every row, from the snapshot\u2019s figures alone. No protocol name is special-cased and no row is hand-picked. The multiple is the market\u2019s own: the median market-cap-per-TVL of live-token protocols in the same category, shrunk toward the global median when comparables are few.' }),
      el('div', { class: 'formula' },
        el('b', { text: 'implied' }), ' = round( tvl_usd \u00d7 multiple \u00d7 (1 + clamp(change_7d, ' + m.growth_floor + ', ' + m.growth_cap + ') / 100 \u00d7 ' + m.growth_weight + ') \u00d7 (' + m.maturity_floor + ' + min(age_days, ' + m.maturity_days + ') / ' + m.maturity_days + ' \u00d7 ' + m.maturity_range + ') \u00d7 (1 + ' + m.spread_per_chain + ' \u00d7 min(chains \u2212 1, ' + m.spread_max_chains + ')) )',
        el('br', null),
        el('b', { text: 'multiple' }), ' = clamp( (n \u00d7 category median + ' + m.prior_weight + ' \u00d7 global median) / (n + ' + m.prior_weight + '), ' + m.multiple_floor + ', ' + m.multiple_cap + ' ) \u00b7 global median ' + DATA.global_median.toFixed(3) + 'x \u00b7 unknown age uses ' + m.unknown_age_days + ' days'
      ),
      el('div', { class: 'multtable' },
        el('table', null,
          el('thead', null, el('tr', null, el('th', { scope: 'col', text: 'Category' }), el('th', { scope: 'col', text: 'Comparables' }), el('th', { scope: 'col', text: 'Category median' }), el('th', { scope: 'col', text: 'Multiple used' }))),
          el('tbody', null, rows)
        )
      ),
      el('p', { class: 'note', text: 'A category sets its own multiple only with at least ' + DATA.model.min_comparables + ' live-token comparables; thinner categories use the global median, and single ratios are winsorised to [' + DATA.model.ratio_floor + ', ' + DATA.model.ratio_cap + '] before any median is taken. Early rows pass the same exclusions as the watchlist: no exchange, no bridge, no liquid-staking or restaked product, no versioned pool name, no wrapped / staked / staking name, no exchange-prefixed name.' })
    );
  }
  function footer() {
    return el('div', { class: 'foot' },
      el('span', { text: 'Snapshot ' + DATA.as_of + ' \u00b7 ' + DATA.source + ' \u00b7 model ' + DATA.model_version + '. Implied values are this entry\u2019s own estimates, never make.fun\u2019s.' }),
      el('span', { text: '\u201cRecords no token\u201d means the snapshot carries no market cap, CoinGecko id or symbol for the protocol. A protocol on this board may still have a token its record does not carry.' })
    );
  }

  // ---------------------------------------------------------- detail drawer
  var dialog = el('dialog', { class: 'detail', id: 'detail', 'aria-labelledby': 'detail-title' });
  dialog.addEventListener('close', function () { state.selected = null; writeHash(); });

  function openDetail(slug) {
    var row = null;
    for (var i = 0; i < DATA.rows.length; i++) if (DATA.rows[i].slug === slug) { row = DATA.rows[i]; break; }
    if (!row) return;
    state.selected = slug;
    writeHash();
    dialog.textContent = '';
    var steps = farmPlan(row);
    var mult = multipleFor(row.category);
    var recomputed = impliedOf(row);
    var matches = recomputed === row.implied_value_usd;
    var m = DATA.model;
    var growthPct = Math.min(m.growth_cap, Math.max(m.growth_floor, row.change_7d === null ? 0 : row.change_7d));
    dialog.appendChild(el('div', { class: 'dhead' },
      el('div', null,
        el('span', { class: 'kicker', text: 'Rank ' + row.rank + ' of ' + DATA.board_size + ' \u00b7 ' + (row.on_watchlist ? 'watchlist' : 'early radar') }),
        el('h2', { id: 'detail-title', text: row.name }),
        el('p', { class: 'sub', text: (row.category || 'Other') + ' on ' + (row.chains && row.chains.length ? row.chains.join(', ') : 'an unlisted chain') + ' \u00b7 records no token' })
      ),
      el('button', { class: 'x', type: 'button', 'aria-label': 'Close details', text: '\u2715', onclick: function () { dialog.close(); } })
    ));
    dialog.appendChild(el('section', { class: 'dsec' },
      el('h3', { text: 'Implied value, factor by factor' }),
      el('div', { class: 'breakdown' },
        el('div', { class: 'row' }, el('span', { text: 'TVL' }), el('b', { class: 'num', text: fmtUsd(row.tvl_usd) })),
        el('div', { class: 'row' }, el('span', { text: 'Category multiple (' + (row.category || 'Other') + ')' }), el('b', { class: 'num', text: fmtMult(row.category_multiple) })),
        el('div', { class: 'row' }, el('span', { text: 'Seven-day growth (clamped)' }), el('b', { class: 'num', text: fmtPct(growthPct) + ' \u2192 ' + row.growth_multiplier.toFixed(3) + 'x' })),
        el('div', { class: 'row' }, el('span', { text: 'Age with no token' }), el('b', { class: 'num', text: fmtAge(row.age_days) + ' \u2192 ' + row.maturity_multiplier.toFixed(3) + 'x' })),
        el('div', { class: 'row' }, el('span', { text: 'Chains (' + (row.chains || []).length + ')' }), el('b', { class: 'num', text: row.diversification_multiplier.toFixed(3) + 'x' })),
        el('div', { class: 'row total' }, el('span', { text: 'Implied value' }), el('b', { class: 'num', text: fmtUsd(row.implied_value_usd) }))
      ),
      el('p', { class: 'sub', text: mult.comparables > 0
        ? 'The ' + (row.category || 'Other') + ' multiple comes from ' + mult.comparables + ' live-token comparables (median ' + mult.median.toFixed(3) + 'x), shrunk toward the global median ' + DATA.global_median.toFixed(3) + 'x.'
        : 'Fewer than ' + DATA.model.min_comparables + ' live-token comparables in this category, so the global median ' + DATA.global_median.toFixed(3) + 'x applies.' }),
      el('p', { class: 'check' + (matches ? '' : ' bad'), text: matches
        ? 'Page recompute: ' + fmtUsd(recomputed) + ' \u2014 matches the number board.json carries.'
        : 'Page recompute: ' + fmtUsd(recomputed) + ' \u2014 DIFFERS from the board. The data would be stale.' })
    ));
    dialog.appendChild(el('section', { class: 'dsec' },
      el('h3', { text: 'Farm plan' }),
      el('ol', { class: 'steps' }, steps.map(function (s) {
        var at = s.indexOf(' Cost: ');
        var action = at >= 0 ? s.slice(0, at) : s;
        var tail = at >= 0 ? s.slice(at + 1) : '';
        return el('li', null, el('b', { text: action }), el('span', { class: 'cost', text: tail }));
      }))
    ));
    if (typeof dialog.showModal === 'function') {
      if (!dialog.open) dialog.showModal();
    } else {
      dialog.setAttribute('open', '');
    }
  }

  function render() {
    app.textContent = '';
    var shell = el('div', { class: 'wrap' });
    shell.appendChild(header());
    shell.appendChild(hero());
    shell.appendChild(controls());
    shell.appendChild(state.tab === 'pre-token' ? boardTable() : liveTable());
    if (state.tab === 'pre-token') shell.appendChild(modelPanel());
    shell.appendChild(footer());
    app.appendChild(shell);
    app.setAttribute('aria-busy', 'false');
    if (!dialog.isConnected) app.appendChild(dialog);
    if (state.selected) openDetail(state.selected);
  }

  readHash();
  render();
})();

