// ===== Snack Stand – ingredients, recipes, price suggestions, spreadsheet import =====
// Pure functions: no DOM, no storage. Money is integer cents except where a note says "may be fractional".
import { isInt, parsePrice, parseAmount, parseCount, centsToPlain } from './logic.js';

export const UNIT_PICKS = ['each', 'slice', 'tbsp', 'tsp', 'cup', 'oz', 'scoop', 'squeeze', 'serving'];
export const MARGIN_PICKS = [50, 60, 70, 75];
export const ROUND_PICKS = [
  { cents: 25, label: '25¢' },
  { cents: 50, label: '50¢' },
  { cents: 100, label: '$1' },
  { cents: 1, label: 'exact' },
];

/** Cost of one unit of an ingredient, in cents. May be fractional (a $3.00 stick of butter ÷ 8 tbsp = 37.5). */
export function ingredientUnitCost(ing) {
  return ing.packPriceCents / ing.packUnits;
}

/** What one item costs to make from its recipe. Missing ingredients (deleted) count as $0 and are flagged. */
export function recipeCost(recipe, ingredientsById, extraCostCents = 0) {
  const lines = [];
  let sum = 0;
  let missing = 0;
  for (const r of recipe || []) {
    const ing = ingredientsById.get(r.ingredientId);
    if (!ing) {
      missing += 1;
      lines.push({ ingredientId: r.ingredientId, name: 'Missing ingredient', amount: r.amount, unit: '', costCents: 0, missing: true });
      continue;
    }
    const c = ingredientUnitCost(ing) * r.amount;
    sum += c;
    lines.push({ ingredientId: ing.id, name: ing.name, amount: r.amount, unit: ing.unit, costCents: c, missing: false });
  }
  const extra = isInt(extraCostCents) && extraCostCents > 0 ? extraCostCents : 0;
  return { totalCents: Math.round(sum + extra), ingredientCents: Math.round(sum), extraCents: extra, lines, missing };
}

/** Percent of the selling price that is profit, or null when there is no price. */
export function marginOf(priceCents, costCents) {
  if (!isInt(priceCents) || priceCents <= 0 || !isInt(costCents)) return null;
  return Math.round((priceCents - costCents) / priceCents * 100);
}

/**
 * A selling price where `marginPct` of every sale is profit, rounded UP to the next `roundTo` cents.
 * $1.13 cost at 60% → $2.825 → $3.00 (25¢ steps): you keep $1.87, which is 62%.
 */
export function suggestPrice(costCents, marginPct, roundTo = 25) {
  if (!isInt(costCents) || costCents < 0 || !(marginPct >= 0 && marginPct < 100)) return null;
  const step = isInt(roundTo) && roundTo >= 1 ? roundTo : 1;
  const raw = costCents / (1 - marginPct / 100);
  const priceCents = Math.ceil(Math.round(raw * 1000) / 1000 / step) * step;
  const profitCents = priceCents - costCents;
  return { priceCents, profitCents, marginPct: priceCents > 0 ? Math.round(profitCents / priceCents * 100) : 0 };
}

// ----- Spreadsheet import -----

/** Split CSV / TSV text (pasted cells or a file) into rows of trimmed cells. Handles quotes. */
export function parseDelimited(text) {
  const src = String(text || '').replace(/^﻿/, '');
  if (!src.trim()) return [];
  const firstLine = src.split(/\r?\n/)[0] || '';
  let delim = ',';
  if (firstLine.includes('\t')) delim = '\t';
  else if ((firstLine.match(/;/g) || []).length > (firstLine.match(/,/g) || []).length) delim = ';';

  const rows = [];
  let row = [];
  let cell = '';
  let inQuotes = false;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (inQuotes) {
      if (ch === '"') {
        if (src[i + 1] === '"') { cell += '"'; i += 1; } else inQuotes = false;
      } else {
        cell += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === delim) {
      row.push(cell);
      cell = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && src[i + 1] === '\n') i += 1;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else {
      cell += ch;
    }
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  return rows.map((r) => r.map((c) => c.trim())).filter((r) => r.some((c) => c !== ''));
}

const COLUMN_SYNONYMS = {
  item: ['item', 'menu item', 'item name', 'product', 'dish', 'food', 'menu'],
  ingredient: ['ingredient', 'ingredient name', 'name', 'supply', 'material'],
  amount: ['amount', 'amount used', 'amount per item', 'qty', 'quantity', 'qty per item', 'uses', 'used', 'per item', 'how much'],
  packPrice: ['package price', 'pack price', 'package cost', 'pack cost', 'purchase price', 'bought for', 'what i pay', 'price', 'cost'],
  packUnits: ['units per package', 'units per pack', 'servings per package', 'quantity per package', 'package size', 'pack size', 'units', 'servings', 'portions', 'count'],
  unit: ['unit', 'unit name', 'measure', 'per'],
  sellPrice: ['selling price', 'sell price', 'menu price', 'sale price', 'sells for', 'price each'],
  store: ['store', 'where i buy it', 'where', 'supplier', 'bought at', 'shop', 'store name'],
};

const normHeader = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();

/** Map spreadsheet header cells to fields. Returns { field: columnIndex }. */
export function matchColumns(headerRow) {
  const cols = {};
  const used = new Set();
  const entries = [];
  for (const [field, names] of Object.entries(COLUMN_SYNONYMS)) {
    for (const n of names) entries.push({ field, name: n });
  }
  entries.sort((a, b) => b.name.length - a.name.length); // longer, more specific names first
  headerRow.forEach((h, idx) => {
    const key = normHeader(h);
    if (!key) return;
    const hit = entries.find((e) => e.name === key && cols[e.field] == null);
    if (hit && !used.has(idx)) { cols[hit.field] = idx; used.add(idx); }
  });
  return cols;
}

/**
 * Turn parsed rows into a plan: which ingredients to add or update, which items to create,
 * and the recipe lines to set. Nothing is saved here; the app applies the plan.
 */
export function buildImportPlan(rows, existingItems, existingIngredients) {
  const plan = { ingredients: [], items: [], recipes: [], errors: [], columns: {} };
  if (!rows || rows.length < 2) {
    plan.errors.push({ line: 1, message: 'Need a header row plus at least one row of data.' });
    return plan;
  }
  const cols = matchColumns(rows[0]);
  plan.columns = cols;
  if (cols.ingredient == null) {
    plan.errors.push({ line: 1, message: 'Could not find an "Ingredient" column in the first row. Use the template headers.' });
    return plan;
  }

  const ingByName = new Map(existingIngredients.map((i) => [i.name.toLowerCase(), i]));
  const itemByName = new Map(existingItems.filter((i) => i.active).map((i) => [i.name.toLowerCase(), i]));
  const ingredients = new Map();
  const items = new Map();
  const get = (r, f) => (cols[f] == null ? '' : (r[cols[f]] || '').trim());
  const data = rows.slice(1).map((r, idx) => ({ r, line: idx + 2 }));

  // Pass 1: ingredient definitions (any row with a package price or units).
  for (const { r, line } of data) {
    const ingName = get(r, 'ingredient');
    if (!ingName) continue;
    const key = ingName.toLowerCase();
    const priceRaw = get(r, 'packPrice');
    const unitsRaw = get(r, 'packUnits');
    if (!priceRaw && !unitsRaw) continue;
    const packPriceCents = parsePrice(priceRaw);
    const packUnits = unitsRaw ? parseAmount(unitsRaw) : 1;
    if (packPriceCents == null) { plan.errors.push({ line, message: `${ingName}: package price "${priceRaw}" is not a valid amount.` }); continue; }
    if (packUnits == null) { plan.errors.push({ line, message: `${ingName}: units per package "${unitsRaw}" is not a number above 0.` }); continue; }
    const existing = ingByName.get(key);
    const store = get(r, 'store');
    if (!ingredients.has(key)) {
      ingredients.set(key, { key, name: existing ? existing.name : ingName, unit: get(r, 'unit') || (existing ? existing.unit : 'each'), isNew: !existing, prices: [] });
    }
    const plan1 = ingredients.get(key);
    if (!plan1.unit && get(r, 'unit')) plan1.unit = get(r, 'unit');
    plan1.prices = plan1.prices.filter((p) => p.store.toLowerCase() !== store.toLowerCase());
    plan1.prices.push({ store, packPriceCents, packUnits });
  }

  // Pass 2: recipe lines and items.
  for (const { r, line } of data) {
    const ingName = get(r, 'ingredient');
    const itemName = get(r, 'item');
    if (!itemName) continue;
    const ikey = itemName.toLowerCase();
    if (!items.has(ikey)) {
      const ex = itemByName.get(ikey);
      items.set(ikey, { key: ikey, name: ex ? ex.name : itemName, isNew: !ex, id: ex ? ex.id : null, priceCents: null });
    }
    const sell = get(r, 'sellPrice');
    if (sell && items.get(ikey).priceCents == null) {
      const p = parsePrice(sell);
      if (p == null) plan.errors.push({ line, message: `${itemName}: selling price "${sell}" is not a valid amount.` });
      else items.get(ikey).priceCents = p;
    }
    if (!ingName) {
      // An item sold straight from a pack (drinks, chips, cookies…): price and count on the item row itself.
      const priceRaw = get(r, 'packPrice');
      const unitsRaw = get(r, 'packUnits');
      if (priceRaw || unitsRaw) {
        const packPriceCents = parsePrice(priceRaw);
        const packQty = parseCount(unitsRaw);
        if (packPriceCents == null) plan.errors.push({ line, message: `${itemName}: pack price "${priceRaw}" is not a valid amount.` });
        else if (packQty == null) plan.errors.push({ line, message: `${itemName}: units per package "${unitsRaw}" must be a whole number above 0.` });
        else items.get(ikey).pack = { packPriceCents, packQty, store: get(r, 'store') };
      }
      continue;
    }
    const key = ingName.toLowerCase();
    if (!ingredients.has(key) && !ingByName.has(key)) {
      plan.errors.push({ line, message: `${ingName} needs a package price and units per package somewhere in the sheet (it is not in your ingredients yet).` });
      continue;
    }
    const amountRaw = get(r, 'amount');
    const amount = parseAmount(amountRaw);
    if (amount == null) {
      plan.errors.push({ line, message: `${itemName}: amount of ${ingName} used is ${amountRaw ? `"${amountRaw}", which is not a number above 0` : 'missing'}.` });
      continue;
    }
    plan.recipes.push({ itemKey: ikey, ingredientKey: key, amount });
  }

  plan.ingredients = [...ingredients.values()];
  plan.items = [...items.values()];
  return plan;
}

// ----- Spreadsheet links -----

/**
 * Turn a Google Sheets link (or any direct CSV link) into the URLs to try, in order.
 * Google Sheets shared as "Anyone with the link" can be read as CSV without signing in.
 */
export function sheetFetchUrls(link) {
  const s = String(link || '').trim();
  if (!s) return [];
  let url;
  try {
    url = new URL(/^https?:\/\//i.test(s) ? s : `https://${s}`);
  } catch (_) {
    return [];
  }
  const host = url.hostname.toLowerCase();
  if (host === 'docs.google.com' || host === 'spreadsheets.google.com') {
    const gidMatch = url.searchParams.get('gid') || (url.hash.match(/gid=(\d+)/) || [])[1] || '';
    const gid = /^\d+$/.test(gidMatch) ? gidMatch : '';
    const published = url.pathname.match(/\/spreadsheets\/d\/e\/([^/]+)\/pub/);
    if (published) {
      return [`https://docs.google.com/spreadsheets/d/e/${published[1]}/pub?output=csv${gid ? `&gid=${gid}` : ''}`];
    }
    const m = url.pathname.match(/\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/);
    if (!m) return [];
    const id = m[1];
    return [
      `https://docs.google.com/spreadsheets/d/${id}/gviz/tq?tqx=out:csv${gid ? `&gid=${gid}` : ''}`,
      `https://docs.google.com/spreadsheets/d/${id}/export?format=csv${gid ? `&gid=${gid}` : ''}`,
    ];
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return [];
  if (!/^[a-z0-9-]+(\.[a-z0-9-]+)+$/i.test(url.hostname)) return [];
  return [url.href];
}

// ----- Stores -----

const STORE_SEARCH = {
  'costco': 'https://www.costco.com/CatalogSearch?dept=All&keyword={q}',
  "sam's club": 'https://www.samsclub.com/s/{q}',
  "bj's wholesale": 'https://www.bjs.com/search/{q}',
  'walmart': 'https://www.walmart.com/search?q={q}',
  'target': 'https://www.target.com/s?searchTerm={q}',
  'publix': 'https://www.publix.com/search?searchTerm={q}',
  'kroger': 'https://www.kroger.com/search?query={q}',
  'whole foods': 'https://www.wholefoodsmarket.com/search?text={q}',
  "trader joe's": 'https://www.traderjoes.com/home/search?q={q}&global=yes',
  'aldi': 'https://www.aldi.us/results?q={q}',
  'sprouts': 'https://shop.sprouts.com/search?search_term={q}',
  'amazon': 'https://www.amazon.com/s?k={q}',
};

/** Where to look up an ingredient's price: the store's own search when we know it, else a web search with the store and location. */
export function storeSearchUrl(store, query, location = '') {
  const key = String(store || '').trim().toLowerCase();
  const term = String(query || '').trim();
  if (STORE_SEARCH[key] && term) return STORE_SEARCH[key].replace('{q}', encodeURIComponent(term));
  const words = [term, 'price', String(store || '').trim(), String(location || '').trim()].filter(Boolean).join(' ');
  return `https://www.google.com/search?q=${encodeURIComponent(words)}`;
}

export function isGoogleSheetLink(link) {
  try {
    const host = new URL(String(link).trim()).hostname.toLowerCase();
    return host === 'docs.google.com' || host === 'spreadsheets.google.com';
  } catch (_) {
    return false;
  }
}

/** "docs.google.com/spreadsheets/d/1BxiM…" for showing a saved link. */
export function shortLink(link) {
  try {
    const url = new URL(String(link).trim());
    const path = url.pathname.length > 32 ? `${url.pathname.slice(0, 30)}…` : url.pathname;
    return `${url.hostname}${path}`;
  } catch (_) {
    return String(link || '').slice(0, 40);
  }
}

export const TEMPLATE_ROWS = [
  ['Item', 'Ingredient', 'Amount used', 'Package price', 'Units per package', 'Unit', 'Store', 'Selling price'],
  ['Grilled Cheese', 'Butter', '1', '3.00', '8', 'tbsp', 'Costco', '3.00'],
  ['Grilled Cheese', 'Cheese', '2', '4.00', '16', 'slice', 'Costco', ''],
  ['Grilled Cheese', 'Bread', '2', '2.50', '20', 'slice', 'Publix', ''],
  ['Burger', 'Bun', '1', '3.00', '8', 'each', 'Publix', '5.00'],
  ['Burger', 'Patty', '1', '12.00', '10', 'each', 'Costco', ''],
  ['Burger', 'Ketchup', '1', '3.50', '100', 'squeeze', 'Walmart', ''],
  ['', 'Relish', '', '2.00', '40', 'tsp', 'Walmart', ''],
  ['Soda', '', '', '18.49', '35', 'can', 'Costco', '1.50'],
  ['Chips', '', '', '23.49', '54', 'bag', 'Costco', '1.25'],
];

function csvCell(v) {
  let s = String(v ?? '');
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  if (/[",\r\n]/.test(s)) s = `"${s.replace(/"/g, '""')}"`;
  return s;
}

export const TEMPLATE_CSV = TEMPLATE_ROWS.map((r) => r.map(csvCell).join(',')).join('\r\n') + '\r\n';

/** rows: [{ name, costCents|null, priceCents, suggestion|null }] */
export function pricingCSV(rows, marginPct) {
  const out = [['Item', 'Cost to make', 'Current price', 'Current profit', `Suggested price (${marginPct}% profit target)`, 'Profit at suggested', 'Profit % at suggested']];
  for (const r of rows) {
    const hasCost = isInt(r.costCents);
    out.push([
      r.name,
      hasCost ? centsToPlain(r.costCents) : 'no cost set',
      centsToPlain(r.priceCents),
      hasCost ? centsToPlain(r.priceCents - r.costCents) : '',
      r.suggestion ? centsToPlain(r.suggestion.priceCents) : '',
      r.suggestion ? centsToPlain(r.suggestion.profitCents) : '',
      r.suggestion ? `${r.suggestion.marginPct}%` : '',
    ]);
  }
  return out.map((r) => r.map(csvCell).join(',')).join('\r\n') + '\r\n';
}
