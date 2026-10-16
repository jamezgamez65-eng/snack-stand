// ===== Snack Stand – pure logic (no DOM, no storage) =====
// Money is always integer cents. A cost of null means "no cost set".

const pad2 = (n) => String(n).padStart(2, '0');
export const isInt = (n) => Number.isInteger(n);

// ----- Money -----

/** 150 -> "$1.50", 100025 -> "$1,000.25", -250 -> "-$2.50" */
export function formatCents(cents) {
  const n = Math.trunc(Number(cents) || 0);
  const neg = n < 0;
  const abs = Math.abs(n);
  return `${neg ? '-' : ''}$${Math.floor(abs / 100).toLocaleString('en-US')}.${pad2(abs % 100)}`;
}

/** 150 -> "1.50" (inputs and CSV: no symbol, no separators) */
export function centsToPlain(cents) {
  const n = Math.trunc(Number(cents) || 0);
  const abs = Math.abs(n);
  return `${n < 0 ? '-' : ''}${Math.floor(abs / 100)}.${pad2(abs % 100)}`;
}

/**
 * Parse typed dollars into integer cents. Accepts "1.50", "1.5", "$2", ".99", "1,000.25".
 * Returns null for anything invalid, negative, or with more than 2 decimals.
 */
export function parsePrice(input) {
  if (input == null) return null;
  const s = String(input).trim().replace(/^\$/, '').replace(/,/g, '').trim();
  if (s === '') return null;
  const m = /^(\d*)(?:\.(\d{0,2}))?$/.exec(s);
  if (!m) return null;
  const whole = m[1] || '';
  const frac = m[2] || '';
  if (whole === '' && frac === '') return null;
  if (whole.length > 7) return null;
  const dollars = whole === '' ? 0 : parseInt(whole, 10);
  const cents = frac === '' ? 0 : parseInt(frac.padEnd(2, '0'), 10);
  return dollars * 100 + cents;
}

/** Whole number of 1 or more (units per pack). */
export function parseCount(input) {
  if (input == null) return null;
  const s = String(input).trim();
  if (!/^\d{1,6}$/.test(s)) return null;
  const n = parseInt(s, 10);
  return n >= 1 ? n : null;
}

/** Positive decimal amount (units per package, amount of an ingredient used). Up to 3 decimals. */
export function parseAmount(input) {
  if (input == null) return null;
  const s = String(input).trim().replace(/,/g, '');
  if (s === '' || s === '.' || !/^\d{0,7}(?:\.\d{0,3})?$/.test(s)) return null;
  const n = Number(s);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** $30.00 pack of 30 -> 100 cents each. Rounds to the nearest cent. */
export function unitCostFromPack(packPriceCents, packQty) {
  if (!isInt(packPriceCents) || packPriceCents < 0 || !isInt(packQty) || packQty < 1) return null;
  return Math.round(packPriceCents / packQty);
}

export function changeDue(totalCents, paidCents) {
  return paidCents - totalCents;
}

// ----- Menu items -----

/** Fill in defaults so items saved by older versions keep working. */
export function normalizeItem(raw) {
  const it = raw || {};
  const packQty = isInt(it.packQty) && it.packQty >= 1 ? it.packQty : null;
  const recipe = (Array.isArray(it.recipe) ? it.recipe : [])
    .filter((r) => r && typeof r.ingredientId === 'string' && r.ingredientId && Number.isFinite(Number(r.amount)) && Number(r.amount) > 0)
    .map((r) => ({ ingredientId: r.ingredientId, amount: Number(r.amount) }));
  let costMode = it.costMode;
  if (costMode !== 'pack' && costMode !== 'unit' && costMode !== 'recipe') {
    costMode = recipe.length ? 'recipe' : (packQty ? 'pack' : 'unit');
  }
  return {
    id: String(it.id ?? ''),
    name: String(it.name ?? ''),
    priceCents: isInt(it.priceCents) && it.priceCents >= 0 ? it.priceCents : 0,
    costCents: isInt(it.costCents) && it.costCents >= 0 ? it.costCents : null,
    costMode,
    packPriceCents: isInt(it.packPriceCents) && it.packPriceCents >= 0 ? it.packPriceCents : null,
    packQty,
    recipe,
    extraCostCents: isInt(it.extraCostCents) && it.extraCostCents >= 0 ? it.extraCostCents : 0,
    supplier: typeof it.supplier === 'string' ? it.supplier : '',
    emoji: typeof it.emoji === 'string' ? it.emoji : '',
    image: typeof it.image === 'string' && it.image.startsWith('data:image/') ? it.image : null,
    active: it.active !== false,
    createdAt: isInt(it.createdAt) ? it.createdAt : 0,
  };
}

/** Common US grocery and bulk stores; any other name can be typed in. */
export const STORES = [
  'Costco', "Sam's Club", "BJ's Wholesale", 'Restaurant Depot', 'Walmart', 'Target', 'Publix', 'Kroger',
  'Whole Foods', "Trader Joe's", 'Aldi', 'Winn-Dixie', 'Sprouts', 'Amazon', 'Dollar Tree',
];

/** Label for prices recorded before a store was chosen. */
export const UNKNOWN_STORE = 'Unknown store';

/** One store's price for an ingredient: what a package costs there and how many portions it holds. */
export function normalizePrice(raw) {
  const p = raw || {};
  const packUnits = Number(p.packUnits);
  if (!isInt(p.packPriceCents) || p.packPriceCents < 0 || !Number.isFinite(packUnits) || packUnits <= 0) return null;
  return {
    store: String(p.store ?? '').trim() || UNKNOWN_STORE,
    packPriceCents: p.packPriceCents,
    packUnits,
    checkedAt: isInt(p.checkedAt) ? p.checkedAt : 0,
  };
}

/**
 * An ingredient: a unit name (tbsp, slice, each…) and prices at one or more stores.
 * packPriceCents / packUnits are the price currently used for costs (your store's, or the cheapest).
 */
export function normalizeIngredient(raw) {
  const r = raw || {};
  let prices = (Array.isArray(r.prices) ? r.prices : []).map(normalizePrice).filter(Boolean);
  const legacyUnits = Number(r.packUnits);
  if (!prices.length && isInt(r.packPriceCents) && r.packPriceCents >= 0) {
    prices = [{
      store: String(r.supplier ?? '').trim() || UNKNOWN_STORE,
      packPriceCents: r.packPriceCents,
      packUnits: Number.isFinite(legacyUnits) && legacyUnits > 0 ? legacyUnits : 1,
      checkedAt: isInt(r.createdAt) ? r.createdAt : 0,
    }];
  }
  const activeStore = typeof r.activeStore === 'string' ? r.activeStore : '';
  const active = prices.find((p) => p.store === activeStore) || prices[0] || null;
  return {
    id: String(r.id ?? ''),
    name: String(r.name ?? '').trim(),
    unit: String(r.unit ?? '').trim() || 'each',
    prices,
    activeStore: active ? active.store : '',
    packPriceCents: isInt(r.packPriceCents) && r.packPriceCents >= 0 ? r.packPriceCents : (active ? active.packPriceCents : 0),
    packUnits: Number.isFinite(legacyUnits) && legacyUnits > 0 ? legacyUnits : (active ? active.packUnits : 1),
    supplier: active ? active.store : (typeof r.supplier === 'string' ? r.supplier : ''),
    createdAt: isInt(r.createdAt) ? r.createdAt : 0,
  };
}

/** The price to use: the chosen store's if recorded, otherwise the cheapest per unit. */
export function pickPrice(ing, store) {
  const prices = ing.prices || [];
  if (!prices.length) return null;
  const s = String(store || '').trim().toLowerCase();
  const match = s ? prices.find((p) => p.store.toLowerCase() === s) : null;
  if (match) return match;
  return prices.reduce((best, p) => (!best || p.packPriceCents / p.packUnits < best.packPriceCents / best.packUnits ? p : best), null);
}

/** Point the ingredient's cost at the chosen store's price. Returns true when something changed. */
export function syncIngredientPrice(ing, store) {
  const p = pickPrice(ing, store);
  if (!p) return false;
  const changed = ing.packPriceCents !== p.packPriceCents || ing.packUnits !== p.packUnits || ing.activeStore !== p.store;
  ing.packPriceCents = p.packPriceCents;
  ing.packUnits = p.packUnits;
  ing.activeStore = p.store;
  ing.supplier = p.store;
  return changed;
}

/** Profit on one unit at the current selling price, or null when no cost is set. */
export function itemUnitNet(item) {
  return isInt(item.costCents) ? item.priceCents - item.costCents : null;
}

export function matchesSearch(item, query) {
  const q = String(query || '').trim().toLowerCase();
  if (!q) return true;
  return item.name.toLowerCase().includes(q) || (item.supplier || '').toLowerCase().includes(q);
}

export function initialOf(name) {
  const s = String(name || '').trim();
  return s ? Array.from(s)[0].toUpperCase() : '?';
}

// ----- Cart -----
// A cart is an array of lines: { itemId, name, emoji, unitPriceCents, unitCostCents|null, qty }

export function cartAdd(cart, item) {
  const line = cart.find((l) => l.itemId === item.id);
  if (line) {
    line.qty += 1;
  } else {
    cart.push({
      itemId: item.id,
      name: item.name,
      emoji: item.emoji || '',
      unitPriceCents: item.priceCents,
      unitCostCents: isInt(item.costCents) ? item.costCents : null,
      qty: 1,
    });
  }
  return cart;
}

export function cartSetQty(cart, itemId, qty) {
  const i = cart.findIndex((l) => l.itemId === itemId);
  if (i < 0) return cart;
  if (qty <= 0) cart.splice(i, 1);
  else cart[i].qty = qty;
  return cart;
}

export const cartTotal = (cart) => cart.reduce((sum, l) => sum + l.unitPriceCents * l.qty, 0);
export const cartCost = (cart) => cart.reduce((sum, l) => sum + (isInt(l.unitCostCents) ? l.unitCostCents : 0) * l.qty, 0);
export const cartCount = (cart) => cart.reduce((sum, l) => sum + l.qty, 0);
export const cartUnknownCostQty = (cart) => cart.reduce((sum, l) => sum + (isInt(l.unitCostCents) ? 0 : l.qty), 0);

/** Snapshot the cart into a Sale. Names, prices and costs are copied, so later menu edits never change it. */
export function buildSale(cart, timestamp, id, paidCents = null) {
  const lines = cart.map((l) => ({
    name: l.name,
    unitPriceCents: l.unitPriceCents,
    unitCostCents: isInt(l.unitCostCents) ? l.unitCostCents : null,
    qty: l.qty,
  }));
  const totalCents = cartTotal(cart);
  const sale = { id, timestamp, totalCents, costCents: cartCost(cart), lines, paidCents: null, changeCents: null };
  if (isInt(paidCents)) {
    sale.paidCents = paidCents;
    sale.changeCents = paidCents - totalCents;
  }
  return sale;
}

// ----- Sales -----

/** Fill in defaults for sales saved by older versions (no costs, no paid amount). */
export function normalizeSale(raw) {
  const s = raw || {};
  const lines = (Array.isArray(s.lines) ? s.lines : []).map((l) => ({
    name: String((l && l.name) ?? ''),
    unitPriceCents: l && isInt(l.unitPriceCents) ? l.unitPriceCents : 0,
    unitCostCents: l && isInt(l.unitCostCents) && l.unitCostCents >= 0 ? l.unitCostCents : null,
    qty: l && isInt(l.qty) ? l.qty : 0,
  }));
  const computedTotal = lines.reduce((a, l) => a + l.unitPriceCents * l.qty, 0);
  const totalCents = isInt(s.totalCents) ? s.totalCents : computedTotal;
  const costCents = lines.reduce((a, l) => a + (isInt(l.unitCostCents) ? l.unitCostCents : 0) * l.qty, 0);
  const paidCents = isInt(s.paidCents) ? s.paidCents : null;
  const changeCents = isInt(s.changeCents) ? s.changeCents : (paidCents == null ? null : paidCents - totalCents);
  return { id: String(s.id ?? ''), timestamp: Number(s.timestamp) || 0, totalCents, costCents, lines, paidCents, changeCents };
}

export const saleNet = (sale) => sale.totalCents - sale.costCents;
export const saleUnknownCostQty = (sale) => sale.lines.reduce((a, l) => a + (isInt(l.unitCostCents) ? 0 : l.qty), 0);

// ----- Dates (all local time) -----

export function dateKey(d) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

export function parseDateKey(key) {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d);
}

export function shiftDateKey(key, days) {
  const d = parseDateKey(key);
  d.setDate(d.getDate() + days);
  return dateKey(d);
}

/** [startMs, endMs) for the local calendar day */
export function dayRange(key) {
  const start = parseDateKey(key);
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  return [start.getTime(), end.getTime()];
}

export function friendlyDay(key, todayKey) {
  if (key === todayKey) return 'Today';
  if (key === shiftDateKey(todayKey, -1)) return 'Yesterday';
  const opts = { weekday: 'short', month: 'short', day: 'numeric' };
  if (key.slice(0, 4) !== todayKey.slice(0, 4)) opts.year = 'numeric';
  return parseDateKey(key).toLocaleDateString([], opts);
}

export function longDay(key) {
  return parseDateKey(key).toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' });
}

export function shortDate(key) {
  return parseDateKey(key).toLocaleDateString([], { month: 'short', day: 'numeric' });
}

export function timeString(ts) {
  return new Date(ts).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

/** Dashboard periods: 'today' | 'week' (last 7 days incl. today) | 'all' */
export function periodRange(period, todayKey) {
  if (period === 'week') {
    const startKey = shiftDateKey(todayKey, -6);
    return { startMs: dayRange(startKey)[0], endMs: dayRange(todayKey)[1], label: 'This week', sub: `${shortDate(startKey)} – ${shortDate(todayKey)}` };
  }
  if (period === 'all') {
    return { startMs: 0, endMs: Number.MAX_SAFE_INTEGER, label: 'All time', sub: 'Every sale on this device' };
  }
  const [startMs, endMs] = dayRange(todayKey);
  return { startMs, endMs, label: 'Today', sub: longDay(todayKey) };
}

// ----- Reports -----

/**
 * Totals for a list of sales.
 * gross = selling price × qty, cost = unit cost × qty (unknown costs count as $0), net = gross − cost.
 */
export function summarizeSales(sales) {
  let grossCents = 0;
  let costCents = 0;
  let unknownCostQty = 0;
  let units = 0;
  const byName = new Map();
  for (const s of sales) {
    grossCents += s.totalCents;
    costCents += s.costCents;
    for (const l of s.lines) {
      units += l.qty;
      const cur = byName.get(l.name) || { name: l.name, qty: 0, grossCents: 0, costCents: 0, unknownCostQty: 0 };
      cur.qty += l.qty;
      cur.grossCents += l.unitPriceCents * l.qty;
      if (isInt(l.unitCostCents)) {
        cur.costCents += l.unitCostCents * l.qty;
      } else {
        cur.unknownCostQty += l.qty;
        unknownCostQty += l.qty;
      }
      byName.set(l.name, cur);
    }
  }
  const items = [...byName.values()]
    .map((i) => ({ ...i, netCents: i.grossCents - i.costCents }))
    .sort((a, b) => b.qty - a.qty || a.name.localeCompare(b.name));
  return { count: sales.length, units, grossCents, costCents, netCents: grossCents - costCents, unknownCostQty, items };
}

export function rankBy(items, key) {
  return [...items].sort((a, b) => b[key] - a[key] || a.name.localeCompare(b.name));
}

function csvCell(v) {
  let s = String(v ?? '');
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`; // keep spreadsheets from treating it as a formula
  if (/[",\r\n]/.test(s)) s = `"${s.replace(/"/g, '""')}"`;
  return s;
}

export const CSV_COLUMNS = [
  'Sale ID', 'Date', 'Time', 'Item', 'Qty', 'Unit Price', 'Line Gross', 'Unit Cost', 'Line Cost', 'Line Net',
  'Sale Gross', 'Sale Cost', 'Sale Net', 'Amount Paid', 'Change Given',
];

export function salesToCSV(sales) {
  const rows = [CSV_COLUMNS];
  const sorted = [...sales].sort((a, b) => a.timestamp - b.timestamp);
  for (const s of sorted) {
    const d = new Date(s.timestamp);
    const paid = isInt(s.paidCents) ? centsToPlain(s.paidCents) : '';
    const change = isInt(s.changeCents) ? centsToPlain(s.changeCents) : '';
    for (const l of s.lines) {
      const lineGross = l.unitPriceCents * l.qty;
      const known = isInt(l.unitCostCents);
      rows.push([
        s.id, dateKey(d), timeString(s.timestamp), l.name, l.qty,
        centsToPlain(l.unitPriceCents), centsToPlain(lineGross),
        known ? centsToPlain(l.unitCostCents) : '',
        known ? centsToPlain(l.unitCostCents * l.qty) : '',
        known ? centsToPlain(lineGross - l.unitCostCents * l.qty) : '',
        centsToPlain(s.totalCents), centsToPlain(s.costCents), centsToPlain(saleNet(s)),
        paid, change,
      ]);
    }
  }
  return rows.map((r) => r.map(csvCell).join(',')).join('\r\n') + '\r\n';
}

// ----- Backup validation -----

export function validateBackup(data) {
  if (!data || typeof data !== 'object') throw new Error('this is not a Snack Stand backup file.');
  if (!Array.isArray(data.items) || !Array.isArray(data.sales)) throw new Error('the file is missing its items or sales list.');

  const items = data.items.map((it, i) => {
    if (!it || typeof it.id !== 'string' || typeof it.name !== 'string' || !isInt(it.priceCents) || it.priceCents < 0) {
      throw new Error(`menu item #${i + 1} is invalid.`);
    }
    const n = normalizeItem(it);
    if (!n.createdAt) n.createdAt = Date.now() + i;
    return n;
  });

  const sales = data.sales.map((s, i) => {
    if (!s || typeof s.id !== 'string' || !Number.isFinite(s.timestamp) || !Array.isArray(s.lines)) {
      throw new Error(`sale #${i + 1} is invalid.`);
    }
    for (const l of s.lines) {
      if (!l || typeof l.name !== 'string' || !isInt(l.unitPriceCents) || !isInt(l.qty)) {
        throw new Error(`sale #${i + 1} has an invalid line item.`);
      }
    }
    return normalizeSale(s);
  });

  const ingredients = (Array.isArray(data.ingredients) ? data.ingredients : []).map((g, i) => {
    if (!g || typeof g.id !== 'string' || typeof g.name !== 'string' || !g.name.trim()) {
      throw new Error(`ingredient #${i + 1} is invalid.`);
    }
    const n = normalizeIngredient(g);
    if (!n.createdAt) n.createdAt = Date.now() + i;
    return n;
  });

  return { items, sales, ingredients };
}

// ----- Misc -----

export function uuid() {
  if (globalThis.crypto && crypto.randomUUID) return crypto.randomUUID();
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

/** Keep only the first emoji/character the user typed. */
export function firstGrapheme(s) {
  s = String(s || '').trim();
  if (!s) return '';
  if (typeof Intl !== 'undefined' && Intl.Segmenter) {
    const seg = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
    const first = seg.segment(s)[Symbol.iterator]().next().value;
    return first ? first.segment : '';
  }
  return s.slice(0, 16);
}

export function isIOS() {
  const ua = navigator.userAgent || '';
  return /iPad|iPhone|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}
