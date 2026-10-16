// ===== Snack Stand – UI and app flow =====
import * as db from './db.js';
import { fileToThumb, approxBytes } from './images.js';
import {
  isInt, formatCents, centsToPlain, parsePrice, parseCount, parseAmount, unitCostFromPack, uuid,
  dateKey, shiftDateKey, dayRange, friendlyDay, longDay, timeString, periodRange,
  normalizeItem, normalizeSale, normalizeIngredient, itemUnitNet, matchesSearch, initialOf,
  cartAdd, cartSetQty, cartTotal, cartCount, buildSale,
  saleNet, saleUnknownCostQty, summarizeSales, rankBy, salesToCSV, validateBackup, firstGrapheme, isIOS,
  STORES, UNKNOWN_STORE, pickPrice, syncIngredientPrice,
} from './logic.js';
import {
  UNIT_PICKS, MARGIN_PICKS, ROUND_PICKS, ingredientUnitCost, recipeCost, marginOf, suggestPrice,
  parseDelimited, buildImportPlan, TEMPLATE_CSV, pricingCSV, sheetFetchUrls, isGoogleSheetLink, shortLink, storeSearchUrl,
} from './pricing.js';

const SEED_ITEMS = [
  { name: 'Chips', priceCents: 150, emoji: '🥔' },
  { name: 'Soda', priceCents: 200, emoji: '🥤' },
  { name: 'Candy Bar', priceCents: 125, emoji: '🍫' },
  { name: 'Water', priceCents: 100, emoji: '💧' },
];

// Fallback tile colours when an item has no photo.
const TINTS = ['#F4B942', '#E9875F', '#7FB7A4', '#D9A5B3', '#9DB6D9', '#C9B36E'];
const TABS = ['dashboard', 'register', 'sales', 'profit', 'menu', 'backup'];
const PROFIT_ITEM_KEY = 'snack-stand:profit-item';
const MENU_VIEWS = ['items', 'ingredients', 'pricing'];
const TAB_KEY = 'snack-stand:tab';
const PRICING_KEY = 'snack-stand:pricing';

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
const today = () => dateKey(new Date());

const state = {
  items: [],            // every menu item, including removed (active: false) ones
  ingredients: [],
  cart: [],             // [{ itemId, name, emoji, unitPriceCents, unitCostCents, qty }]
  tab: 'dashboard',
  menuView: 'items',
  period: 'today',
  day: today(),
  daySales: [],
  search: { register: '', menu: '', ingredients: '' },
  pricing: { marginPct: 60, roundTo: 25 },
  editingId: null,
  editor: { image: null, costMode: 'pack', recipe: [] },
  editingIngredientId: null,
  editorIng: { prices: [] }, // [{ store, custom, price, units, checkedAt }] while editing an ingredient
  store: { name: '', location: '' }, // the store whose prices are used for costs
  pricingItemId: null,
  profitItemId: null,
  profitPeriod: 'today',
  importPlan: null,
  importSource: null,   // { kind: 'link' | 'file' | 'paste', link }
  sheetLink: '',        // remembered Google Sheets link
  sheetSyncedAt: null,
  viewingSaleId: null,
};

// ---------- small helpers ----------

function buzz(pattern = 12) {
  try {
    if (navigator.userActivation && !navigator.userActivation.hasBeenActive) return;
    if (navigator.vibrate) navigator.vibrate(pattern);
  } catch (_) { /* unsupported */ }
}

function tint(id) {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return TINTS[h % TINTS.length];
}

function activeItems() {
  return state.items.filter((i) => i.active).sort((a, b) => a.createdAt - b.createdAt);
}

function sortedIngredients() {
  return state.ingredients.slice().sort((a, b) => a.name.localeCompare(b.name));
}

function ingredientsById() {
  return new Map(state.ingredients.map((g) => [g.id, g]));
}

/** Photo, else emoji, else the item's initial on a coloured background. */
function mediaHTML(item) {
  if (item.image) return `<img src="${item.image}" alt="">`;
  if (item.emoji) return `<span class="is-emoji" aria-hidden="true">${esc(item.emoji)}</span>`;
  return `<span aria-hidden="true">${esc(initialOf(item.name))}</span>`;
}

function signClass(cents) { return cents < 0 ? 'is-neg' : ''; }

/** Fractional cents (an ingredient's unit cost) shown to the cent, or finer when it would read as $0.00. */
function formatUnitCost(cents) {
  if (cents >= 1 || cents === 0) return formatCents(Math.round(cents));
  return `$${(cents / 100).toFixed(3)}`;
}

function amountText(n) {
  return Number.isInteger(n) ? String(n) : String(Math.round(n * 1000) / 1000);
}

let toastTimer = null;
function toast(message, type = '') {
  const el = $('#toast');
  el.textContent = message;
  el.className = `toast${type ? ` toast--${type}` : ''}`;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, 2600);
}

function openModal(modal) { modal.hidden = false; }
function closeModal(modal) {
  if (modal.hidden) return;
  modal.hidden = true;
  modal.dispatchEvent(new CustomEvent('closed'));
}

function confirmDialog({ title, message, confirmText = 'OK', cancelText = 'Cancel', danger = false }) {
  const modal = $('#modal-confirm');
  const okBtn = $('#confirm-ok');
  $('#confirm-title').textContent = title;
  $('#confirm-message').textContent = message;
  $('#confirm-cancel').textContent = cancelText;
  okBtn.textContent = confirmText;
  okBtn.className = `btn ${danger ? 'btn--danger' : 'btn--primary'}`;
  openModal(modal);
  return new Promise((resolve) => {
    const cleanup = () => {
      okBtn.removeEventListener('click', onOk);
      modal.removeEventListener('closed', onClosed);
    };
    const onOk = () => { cleanup(); closeModal(modal); resolve(true); };
    const onClosed = () => { cleanup(); resolve(false); };
    okBtn.addEventListener('click', onOk);
    modal.addEventListener('closed', onClosed);
  });
}

function unknownCostNote(qty, where = 'the Menu tab') {
  return `${plural(qty, 'item')} sold had no cost set, so ${qty === 1 ? 'it counts' : 'they count'} as $0.00 cost and net income may be higher than reality. Add costs in ${where}.`;
}

function renderSeg(sel, options, active) {
  $(sel).innerHTML = options.map((o) => `<button class="seg__btn ${o.value === active ? 'is-active' : ''}" type="button" role="tab" data-value="${o.value}">${esc(o.label)}</button>`).join('');
}

async function saveFile(filename, text, mime) {
  const blob = new Blob([text], { type: mime });
  if (isIOS() && navigator.share && typeof File === 'function') {
    try {
      const file = new File([blob], filename, { type: mime });
      if (!navigator.canShare || navigator.canShare({ files: [file] })) {
        await navigator.share({ files: [file], title: filename });
        return;
      }
    } catch (err) {
      if (err && err.name === 'AbortError') return;
    }
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}

async function loadItems() {
  state.items = (await db.getAllItems()).map(normalizeItem);
}

async function loadIngredients() {
  state.ingredients = (await db.getAllIngredients()).map(normalizeIngredient);
}

async function salesBetween(startMs, endMs) {
  return (await db.getSalesBetween(startMs, endMs)).map(normalizeSale);
}

/** Items built from ingredients get their cost refreshed whenever an ingredient changes. */
async function recomputeRecipeCosts() {
  const byId = ingredientsById();
  const changed = [];
  for (const it of state.items) {
    if (it.costMode !== 'recipe') continue;
    const rc = recipeCost(it.recipe, byId, it.extraCostCents);
    const cost = it.recipe.length || it.extraCostCents > 0 ? rc.totalCents : null;
    if (cost !== it.costCents) {
      it.costCents = cost;
      changed.push(it);
    }
  }
  if (changed.length) await db.putItems(changed);
  for (const l of state.cart) {
    const it = state.items.find((i) => i.id === l.itemId);
    if (it) l.unitCostCents = it.costCents;
  }
  return changed.length;
}

// ---------- startup ----------

async function init() {
  try {
    if (navigator.storage && navigator.storage.persist) await navigator.storage.persist();
  } catch (_) { /* not supported */ }

  await db.open();
  await seedIfNeeded();
  await loadItems();
  await loadIngredients();

  try {
    const saved = JSON.parse(localStorage.getItem(PRICING_KEY) || 'null');
    if (saved && MARGIN_PICKS.includes(saved.marginPct) && ROUND_PICKS.some((r) => r.cents === saved.roundTo)) state.pricing = saved;
  } catch (_) { /* ignore */ }
  state.sheetLink = (await db.getMeta('sheetLink')) || '';
  state.sheetSyncedAt = (await db.getMeta('sheetSyncedAt')) || null;
  const store = await db.getMeta('store');
  state.store = store && typeof store.name === 'string' ? { name: store.name, location: String(store.location || '') } : { name: '', location: '' };
  await applyStoreToIngredients();

  bindEvents();
  updateDate();
  renderMenuGrid();
  renderCart();
  updateOnlineBadge();

  let saved = null;
  try { saved = localStorage.getItem(TAB_KEY); } catch (_) { /* private mode */ }
  switchTab(TABS.includes(saved) ? saved : 'dashboard');
  registerServiceWorker();
}

async function seedIfNeeded() {
  if (await db.getMeta('seeded')) return;
  const existing = await db.getAllItems();
  if (existing.length === 0) {
    const now = Date.now();
    for (let i = 0; i < SEED_ITEMS.length; i++) {
      await db.putItem({ id: uuid(), ...SEED_ITEMS[i], costCents: null, active: true, createdAt: now + i });
    }
  }
  await db.setMeta('seeded', true);
}

function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  navigator.serviceWorker.register('./sw.js').then((reg) => {
    reg.addEventListener('updatefound', () => {
      const worker = reg.installing;
      if (!worker) return;
      worker.addEventListener('statechange', () => {
        if (worker.state === 'installed' && navigator.serviceWorker.controller) {
          toast('Update installed. Close and reopen the app to use it.');
        }
      });
    });
  }).catch((err) => console.warn('Service worker not registered:', err));
}

function updateOnlineBadge() {
  $('#net-badge').hidden = navigator.onLine !== false;
}

function updateDate() {
  $('#topbar-date').textContent = new Date().toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });
}

// ---------- events ----------

function bindEvents() {
  $('.tabbar').addEventListener('click', (e) => {
    const tab = e.target.closest('.tab');
    if (tab) switchTab(tab.dataset.tab);
  });

  // Dashboard
  $('#period-seg').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-period]');
    if (!btn) return;
    state.period = btn.dataset.period;
    renderDashboard();
  });

  // Search boxes
  bindSearch('#search-register', '#search-register-clear', (q) => { state.search.register = q; renderMenuGrid(); });
  bindSearch('#search-menu', '#search-menu-clear', (q) => { state.search.menu = q; renderMenuManage(); });
  bindSearch('#search-ingredients', '#search-ingredients-clear', (q) => { state.search.ingredients = q; renderIngredients(); });

  // Register: tile steppers
  $('#menu-grid').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    const tile = btn.closest('.tile');
    const item = state.items.find((i) => i.id === tile.dataset.id);
    if (!item) return;
    const line = state.cart.find((l) => l.itemId === item.id);
    if (btn.dataset.action === 'inc') cartAdd(state.cart, item);
    else if (line) cartSetQty(state.cart, item.id, line.qty - 1);
    buzz();
    renderCart();
  });

  // Cart
  $('#cart-lines').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    const id = btn.closest('.line').dataset.id;
    const line = state.cart.find((l) => l.itemId === id);
    if (!line) return;
    const action = btn.dataset.action;
    if (action === 'inc') cartSetQty(state.cart, id, line.qty + 1);
    else if (action === 'dec') cartSetQty(state.cart, id, line.qty - 1);
    else if (action === 'remove') cartSetQty(state.cart, id, 0);
    buzz();
    renderCart();
  });
  $('#cart-clear').addEventListener('click', async () => {
    const ok = await confirmDialog({ title: 'Clear this sale?', message: 'Everything in the current sale will be removed.', confirmText: 'Clear', danger: true });
    if (!ok) return;
    state.cart = [];
    renderCart();
    closeCart();
  });
  $('#cart-bar').addEventListener('click', openCart);
  $('#cart-close').addEventListener('click', closeCart);
  $('#checkout-btn').addEventListener('click', openCheckout);

  // Checkout
  $('#cash-input').addEventListener('input', updatePaid);
  $('#cash-input').addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    if (!$('#confirm-sale').disabled) confirmSale();
  });
  $('#quick-cash').addEventListener('click', (e) => {
    const btn = e.target.closest('button');
    if (!btn) return;
    const cents = btn.dataset.cents === 'exact' ? cartTotal(state.cart) : Number(btn.dataset.cents);
    $('#cash-input').value = centsToPlain(cents);
    updatePaid();
  });
  $('#confirm-sale').addEventListener('click', confirmSale);
  $('#done').addEventListener('click', hideDone);

  // Profit
  $('#profit-item').addEventListener('change', (e) => {
    state.profitItemId = e.target.value;
    try { localStorage.setItem(PROFIT_ITEM_KEY, state.profitItemId); } catch (_) { /* ignore */ }
    renderProfit();
  });
  $('#profit-period').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-period]');
    if (!btn) return;
    state.profitPeriod = btn.dataset.period;
    renderProfit();
  });
  $('#profit-edit').addEventListener('click', () => { if (state.profitItemId) openItemModal(state.profitItemId); });
  $('#profit-options').addEventListener('click', () => { if (state.profitItemId) openPricingDetail(state.profitItemId); });

  // Sales
  $('#day-prev').addEventListener('click', () => setDay(shiftDateKey(state.day, -1)));
  $('#day-next').addEventListener('click', () => setDay(shiftDateKey(state.day, 1)));
  $('#day-today').addEventListener('click', () => setDay(today()));
  $('#day-input').addEventListener('change', (e) => { if (e.target.value) setDay(e.target.value); });
  $('#day-input').addEventListener('click', (e) => {
    if (window.matchMedia('(pointer: coarse)').matches) return;
    try { e.target.showPicker && e.target.showPicker(); } catch (_) { /* ignore */ }
  });
  $('#sales-list').addEventListener('click', (e) => {
    const sale = e.target.closest('.sale');
    if (sale) openSaleDetail(sale.dataset.id);
  });
  $('#delete-sale').addEventListener('click', deleteCurrentSale);

  // Menu sections
  $('#menu-seg').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-view]');
    if (btn) setMenuView(btn.dataset.view);
  });

  // Items
  $('#add-item').addEventListener('click', () => openItemModal(null));
  $('#item-list').addEventListener('click', (e) => {
    const row = e.target.closest('.item-row');
    if (row) openItemModal(row.dataset.id);
  });
  $('#item-form').addEventListener('submit', (e) => { e.preventDefault(); saveItem(); });
  $('#item-remove').addEventListener('click', removeCurrentItem);
  $('#emoji-picks').addEventListener('click', (e) => {
    const btn = e.target.closest('button');
    if (btn) $('#item-emoji').value = btn.textContent.trim();
  });
  $('#photo-choose').addEventListener('click', () => $('#photo-input').click());
  $('#photo-input').addEventListener('change', onPhotoChosen);
  $('#photo-remove').addEventListener('click', () => { state.editor.image = null; renderPhotoPreview(); });
  $('#cost-mode').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-mode]');
    if (!btn) return;
    setCostMode(btn.dataset.mode);
    updateCostResult();
  });
  ['#item-price', '#item-pack-price', '#item-pack-qty', '#item-unit-cost', '#item-extra-cost'].forEach((sel) => {
    $(sel).addEventListener('input', updateCostResult);
  });

  // Recipe builder (inside the item editor)
  $('#recipe-add').addEventListener('click', () => addRecipeRow(''));
  $('#recipe-new').addEventListener('click', () => openIngredientModal(null, { fromItem: true }));
  $('#recipe-rows').addEventListener('change', (e) => {
    const row = e.target.closest('.recipe__row');
    if (!row || e.target.dataset.field !== 'ingredient') return;
    state.editor.recipe[Number(row.dataset.idx)].ingredientId = e.target.value;
    renderRecipeRows();
    updateCostResult();
  });
  $('#recipe-rows').addEventListener('input', (e) => {
    const row = e.target.closest('.recipe__row');
    if (!row || e.target.dataset.field !== 'amount') return;
    state.editor.recipe[Number(row.dataset.idx)].amount = e.target.value;
    updateCostResult();
  });
  $('#recipe-rows').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-remove]');
    if (!btn) return;
    state.editor.recipe.splice(Number(btn.closest('.recipe__row').dataset.idx), 1);
    renderRecipeRows();
    updateCostResult();
  });

  // Ingredients
  $('#add-ingredient').addEventListener('click', () => openIngredientModal(null));
  $('#ingredient-list').addEventListener('click', (e) => {
    const row = e.target.closest('.item-row');
    if (row) openIngredientModal(row.dataset.id);
  });
  $('#ingredient-form').addEventListener('submit', (e) => { e.preventDefault(); saveIngredient(); });
  $('#ing-delete').addEventListener('click', deleteCurrentIngredient);
  $('#unit-picks').innerHTML = UNIT_PICKS.map((u) => `<button type="button">${u}</button>`).join('');
  $('#unit-picks').addEventListener('click', (e) => {
    const btn = e.target.closest('button');
    if (!btn) return;
    $('#ing-unit').value = btn.textContent.trim();
    syncUnitLabels();
    updateIngredientResult();
  });
  $('#ing-unit').addEventListener('input', () => { syncUnitLabels(); updateIngredientResult(); });
  $('#ing-name').addEventListener('input', updateLookupLinks);
  $('#price-add').addEventListener('click', () => addPriceRow(''));
  $('#price-rows').addEventListener('change', (e) => {
    if (e.target.dataset.field !== 'store') return;
    const row = state.editorIng.prices[Number(e.target.closest('.price-line').dataset.idx)];
    row.store = e.target.value;
    renderPriceRows();
    updateIngredientResult();
    if (row.store === '__other') {
      const custom = $(`#price-rows .price-line[data-idx="${state.editorIng.prices.indexOf(row)}"] [data-field="custom"]`);
      if (custom) custom.focus();
    }
  });
  $('#price-rows').addEventListener('input', (e) => {
    const field = e.target.dataset.field;
    if (!field || field === 'store') return;
    const row = state.editorIng.prices[Number(e.target.closest('.price-line').dataset.idx)];
    row[field] = e.target.value;
    if (field === 'custom') updateLookupLinks();
    updateIngredientResult();
  });
  $('#price-rows').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-remove]');
    if (!btn) return;
    state.editorIng.prices.splice(Number(btn.closest('.price-line').dataset.idx), 1);
    renderPriceRows();
    updateIngredientResult();
  });

  // My store
  $('#store-change').addEventListener('click', openStoreModal);
  $('#pricing-store-change').addEventListener('click', openStoreModal);
  $('#store-select').addEventListener('change', (e) => {
    $('#store-custom-field').hidden = e.target.value !== '__other';
    if (e.target.value === '__other') $('#store-custom').focus();
  });
  $('#store-location').addEventListener('change', (e) => {
    $('#store-location-custom-field').hidden = e.target.value !== '__other';
    if (e.target.value === '__other') $('#store-location-custom').focus();
  });
  $('#store-form').addEventListener('submit', (e) => { e.preventDefault(); saveStore(); });

  // Pricing assistant
  $('#margin-seg').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-value]');
    if (!btn) return;
    state.pricing.marginPct = Number(btn.dataset.value);
    savePricingPrefs();
    renderPricing();
  });
  $('#round-seg').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-value]');
    if (!btn) return;
    state.pricing.roundTo = Number(btn.dataset.value);
    savePricingPrefs();
    renderPricing();
  });
  $('#pricing-list').addEventListener('click', (e) => {
    const apply = e.target.closest('[data-apply]');
    if (apply) { applyPrice(apply.dataset.apply, Number(apply.dataset.cents)); return; }
    const edit = e.target.closest('[data-edit]');
    if (edit) { openItemModal(edit.dataset.edit); return; }
    const detail = e.target.closest('[data-detail]');
    if (detail) openPricingDetail(detail.dataset.detail);
  });
  $('#apply-all-prices').addEventListener('click', applyAllPrices);
  $('#pricing-apply').addEventListener('click', () => {
    const item = state.items.find((i) => i.id === state.pricingItemId);
    const s = item && isInt(item.costCents) ? suggestPrice(item.costCents, state.pricing.marginPct, state.pricing.roundTo) : null;
    if (!s) return;
    closeModal($('#modal-pricing'));
    applyPrice(item.id, s.priceCents);
  });
  $('#export-pricing').addEventListener('click', exportPricing);

  // Spreadsheet import
  $('#import-sheet').addEventListener('click', () => openImportModal());
  $('#sync-sheet').addEventListener('click', () => openImportModal({ autoFetch: true }));
  $('#import-fetch').addEventListener('click', () => fetchSheetAndPreview($('#import-link').value));
  $('#import-link').addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    fetchSheetAndPreview(e.target.value);
  });
  $('#import-unlink').addEventListener('click', forgetSheetLink);
  $('#import-site-csv').addEventListener('click', async () => {
    const btn = $('#import-site-csv');
    btn.disabled = true;
    showImportMessage('Loading prices.csv…');
    try {
      const res = await fetch('./prices.csv', { cache: 'no-store' });
      if (!res.ok) throw new Error('There is no prices.csv on this website yet. Upload one next to index.html and try again.');
      previewImport(await res.text(), { kind: 'file' });
    } catch (err) {
      state.importPlan = null;
      showImportMessage(esc(err.message || 'Could not load prices.csv.'), 'err');
    } finally {
      btn.disabled = false;
    }
  });
  $('#download-template').addEventListener('click', () => saveFile('snack-stand-ingredients-template.csv', TEMPLATE_CSV, 'text/csv'));
  $('#import-sheet-file').addEventListener('click', () => $('#import-sheet-input').click());
  $('#import-sheet-input').addEventListener('change', async (e) => {
    const file = e.target.files && e.target.files[0];
    e.target.value = '';
    if (!file) return;
    try {
      const text = await file.text();
      $('#import-text').value = text;
      previewImport(text, { kind: 'file' });
    } catch (err) {
      toast(`Could not read that file: ${err.message || err}`, 'error');
    }
  });
  $('#import-text').addEventListener('input', (e) => previewImport(e.target.value, { kind: 'paste' }));
  $('#import-run').addEventListener('click', runImport);

  // Backup
  $('#export-json').addEventListener('click', exportJSON);
  $('#import-json').addEventListener('click', () => $('#import-file').click());
  $('#import-file').addEventListener('change', importJSON);
  $('#export-csv').addEventListener('click', exportCSV);

  // Modals: tap the dark backdrop or any [data-close] button to close
  $$('.modal').forEach((modal) => {
    modal.addEventListener('click', (e) => {
      if (e.target === modal || e.target.closest('[data-close]')) closeModal(modal);
    });
  });

  // iOS nudges the page when the keyboard closes; snap it back.
  document.addEventListener('focusout', () => setTimeout(() => window.scrollTo(0, 0), 50));
  document.addEventListener('visibilitychange', () => { if (!document.hidden) updateDate(); });
  window.addEventListener('online', updateOnlineBadge);
  window.addEventListener('offline', updateOnlineBadge);
}

function bindSearch(inputSel, clearSel, onChange) {
  const input = $(inputSel);
  const clear = $(clearSel);
  input.addEventListener('input', () => {
    clear.hidden = input.value === '';
    onChange(input.value);
  });
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') input.blur(); });
  clear.addEventListener('click', () => {
    input.value = '';
    clear.hidden = true;
    onChange('');
    input.focus();
  });
}

function savePricingPrefs() {
  try { localStorage.setItem(PRICING_KEY, JSON.stringify(state.pricing)); } catch (_) { /* ignore */ }
}

// ---------- tabs ----------

function switchTab(tab) {
  state.tab = tab;
  $$('.tab').forEach((t) => t.classList.toggle('is-active', t.dataset.tab === tab));
  $$('.screen').forEach((s) => s.classList.toggle('is-active', s.dataset.screen === tab));
  closeCart();
  try { localStorage.setItem(TAB_KEY, tab); } catch (_) { /* ignore */ }
  updateDate();
  if (tab === 'dashboard') renderDashboard();
  if (tab === 'sales') renderSales();
  if (tab === 'profit') renderProfit();
  if (tab === 'menu') renderMenu();
  if (tab === 'backup') renderBackup();
}

function renderProfitIfActive() {
  if (state.tab === 'profit') renderProfit();
}

// ---------- profit (one item at a time) ----------

function renderCompareBars(container, rows) {
  const max = Math.max(1, ...rows.map((r) => Math.abs(r.cents)));
  container.innerHTML = rows.map((r) => {
    const pct = Math.max(1, Math.round(Math.abs(r.cents) / max * 100));
    const neg = r.cents < 0;
    return `
      <span class="bar__label">${esc(r.label)}</span>
      <div class="bar__track" title="${esc(r.label)}: ${formatCents(r.cents)}"><div class="bar__fill kind-${r.kind} ${neg ? 'is-neg' : ''}" style="width:${pct}%"></div></div>
      <span class="bar__value"><b class="${neg ? 'is-neg' : ''}">${formatCents(r.cents)}</b></span>`;
  }).join('');
}

async function renderProfit() {
  const items = activeItems().slice().sort((a, b) => a.name.localeCompare(b.name));
  const select = $('#profit-item');
  $('#profit-empty').hidden = items.length > 0;
  $('#profit-body').hidden = items.length === 0;
  if (!items.length) { select.innerHTML = ''; return; }

  if (!state.profitItemId) {
    try { state.profitItemId = localStorage.getItem(PROFIT_ITEM_KEY); } catch (_) { /* ignore */ }
  }
  if (!items.some((i) => i.id === state.profitItemId)) state.profitItemId = items[0].id;
  select.innerHTML = items.map((i) => `<option value="${i.id}" ${i.id === state.profitItemId ? 'selected' : ''}>${esc(i.name)}</option>`).join('');
  const item = items.find((i) => i.id === state.profitItemId);

  // Each one you sell
  const hasCost = isInt(item.costCents);
  const hasPrice = item.priceCents > 0;
  const net = hasCost ? item.priceCents - item.costCents : null;
  const margin = hasCost ? marginOf(item.priceCents, item.costCents) : null;
  $('#profit-price').textContent = formatCents(item.priceCents);
  $('#profit-cost').textContent = hasCost ? formatCents(item.costCents) : '—';
  const netEl = $('#profit-net');
  netEl.textContent = hasCost ? formatCents(net) : '—';
  netEl.className = hasCost && net < 0 ? 'is-neg' : '';
  $('#profit-margin').textContent = !hasCost ? 'no cost set' : !hasPrice ? 'no selling price yet' : `${margin}% of the price is profit`;

  const itemRows = [{ label: 'You sell it for', cents: item.priceCents, kind: 'price' }];
  if (hasCost) {
    itemRows.push({ label: 'It costs you', cents: item.costCents, kind: 'cost' });
    itemRows.push({ label: 'You keep', cents: net, kind: 'net' });
  }
  renderCompareBars($('#profit-bars-item'), itemRows);

  let sentence;
  if (!hasPrice && !hasCost) sentence = `${item.name} has no selling price or cost yet. Tap “Change price or cost” to add them.`;
  else if (!hasPrice) sentence = `${item.name} costs you ${formatCents(item.costCents)} but has no selling price yet. “See price options” will suggest one.`;
  else if (!hasCost) sentence = `You sell ${item.name} for ${formatCents(item.priceCents)}. Add what it costs you to see what you keep.`;
  else if (net < 0) sentence = `You sell ${item.name} for ${formatCents(item.priceCents)} but it costs you ${formatCents(item.costCents)}, so you lose ${formatCents(-net)} on each one. Raise the price or lower the cost.`;
  else sentence = `You sell ${item.name} for ${formatCents(item.priceCents)}. It costs you ${formatCents(item.costCents)}, so you keep ${formatCents(net)} on each one${margin == null ? '' : ` (${margin}% of the price)`}.`;
  $('#profit-sentence').textContent = sentence;
  $('#profit-breakdown').innerHTML = costBreakdownHTML(item);
  $('#profit-options').hidden = !hasCost;

  // All you've sold
  $$('#profit-period .seg__btn').forEach((b) => b.classList.toggle('is-active', b.dataset.period === state.profitPeriod));
  const range = periodRange(state.profitPeriod, today());
  $('#profit-period-sub').textContent = range.sub;
  const sales = await salesBetween(range.startMs, range.endMs);
  const sum = summarizeSales(sales).items.find((x) => x.name === item.name) || { qty: 0, grossCents: 0, costCents: 0, netCents: 0, unknownCostQty: 0 };
  $('#profit-units').textContent = sum.qty;
  $('#profit-gross').textContent = formatCents(sum.grossCents);
  const salesNet = $('#profit-sales-net');
  salesNet.textContent = formatCents(sum.netCents);
  salesNet.className = sum.netCents < 0 ? 'is-neg' : '';
  const bars = $('#profit-bars-sales');
  bars.hidden = sum.qty === 0;
  if (sum.qty) {
    renderCompareBars(bars, [
      { label: 'Gross income', cents: sum.grossCents, kind: 'gross' },
      { label: 'Cost', cents: sum.costCents, kind: 'cost' },
      { label: 'Net income', cents: sum.netCents, kind: 'net' },
    ]);
  }
  const when = state.profitPeriod === 'today' ? 'today' : state.profitPeriod === 'week' ? 'in the last 7 days' : 'so far';
  $('#profit-sales-sentence').textContent = sum.qty
    ? `You sold ${sum.qty} ${when} for ${formatCents(sum.grossCents)} gross. After ${formatCents(sum.costCents)} of cost you kept ${formatCents(sum.netCents)}.`
    : `No ${item.name} sold ${when}.`;
  const note = $('#profit-note');
  note.hidden = sum.unknownCostQty === 0;
  note.textContent = `${sum.unknownCostQty} of these were sold before a cost was set, so their cost counts as $0.00 and net income may be higher than reality.`;
}

/** The lines that make up an item's cost: ingredients, a pack, or a typed-in unit cost. */
function costBreakdownHTML(item) {
  if (!isInt(item.costCents)) {
    return '<div class="receipt__line"><span>No cost set yet.</span><span>—</span></div>';
  }
  const lines = [];
  if (item.costMode === 'recipe') {
    const rc = recipeCost(item.recipe, ingredientsById(), item.extraCostCents);
    for (const l of rc.lines) {
      lines.push(`<div class="receipt__line"><span>${amountText(l.amount)} ${esc(l.unit)} ${esc(l.name)}${l.missing ? ' <small>missing</small>' : ''}</span><span>${formatCents(Math.round(l.costCents))}</span></div>`);
    }
    if (rc.extraCents) lines.push(`<div class="receipt__line"><span>Other costs (packaging etc.)</span><span>${formatCents(rc.extraCents)}</span></div>`);
  } else if (item.costMode === 'pack' && isInt(item.packPriceCents) && item.packQty) {
    lines.push(`<div class="receipt__line"><span>Pack of ${item.packQty} for ${formatCents(item.packPriceCents)}${item.supplier ? ` <small>${esc(item.supplier)}</small>` : ''}</span><span>${formatCents(item.costCents)}</span></div>`);
  } else {
    lines.push(`<div class="receipt__line"><span>Cost per unit you entered</span><span>${formatCents(item.costCents)}</span></div>`);
  }
  return lines.join('');
}

function setMenuView(view) {
  if (!MENU_VIEWS.includes(view)) view = 'items';
  state.menuView = view;
  renderMenu();
}

function renderMenu() {
  $$('#menu-seg .seg__btn').forEach((b) => b.classList.toggle('is-active', b.dataset.view === state.menuView));
  for (const v of MENU_VIEWS) $(`#menu-view-${v}`).hidden = v !== state.menuView;
  renderStoreCards();
  if (state.menuView === 'items') renderMenuManage();
  if (state.menuView === 'ingredients') renderIngredients();
  if (state.menuView === 'pricing') renderPricing();
}

// ---------- dashboard ----------

async function renderDashboard() {
  $$('#period-seg .seg__btn').forEach((b) => b.classList.toggle('is-active', b.dataset.period === state.period));
  const range = periodRange(state.period, today());
  $('#period-sub').textContent = range.sub;

  const sales = await salesBetween(range.startMs, range.endMs);
  const sum = summarizeSales(sales);

  $('#dash-gross').textContent = formatCents(sum.grossCents);
  const net = $('#dash-net');
  net.textContent = formatCents(sum.netCents);
  net.className = signClass(sum.netCents);
  $('#dash-cost').textContent = `after ${formatCents(sum.costCents)} of cost`;
  $('#dash-count').textContent = sum.count;
  $('#dash-units').textContent = `${plural(sum.units, 'item')} sold`;

  const note = $('#dash-note');
  note.hidden = sum.unknownCostQty === 0;
  note.textContent = unknownCostNote(sum.unknownCostQty);

  const empty = sales.length === 0;
  $('#dash-empty').hidden = !empty;
  $('#dash-empty-title').textContent = state.period === 'today' ? 'No sales yet today' : state.period === 'week' ? 'No sales in the last 7 days' : 'No sales yet';
  $('#dash-units-panel').hidden = empty;
  $('#dash-net-panel').hidden = empty;
  if (empty) return;

  renderBars($('#bars-units'), rankBy(sum.items, 'qty'), (i) => i.qty, (i) => `<b>${i.qty}</b><small>${formatCents(i.grossCents)}</small>`);
  renderBars($('#bars-net'), rankBy(sum.items, 'netCents'), (i) => i.netCents, (i) => `<b class="${signClass(i.netCents)}">${formatCents(i.netCents)}</b><small>${costLabel(i)}</small>`);
}

function costLabel(i) {
  if (i.unknownCostQty === 0) return `${formatCents(i.costCents)} cost`;
  if (i.unknownCostQty === i.qty) return 'no cost set';
  return `${formatCents(i.costCents)} cost · ${i.unknownCostQty} sold before a cost was set`;
}

function renderBars(container, items, valueOf, labelOf, limit = 10) {
  const shown = items.slice(0, limit);
  const max = Math.max(1, ...shown.map((i) => Math.abs(valueOf(i))));
  container.innerHTML = shown.map((i) => {
    const v = valueOf(i);
    const pct = Math.max(2, Math.round(Math.abs(v) / max * 100));
    return `
      <span class="bar__label" title="${esc(i.name)}">${esc(i.name)}</span>
      <div class="bar__track" title="${esc(i.name)}: ${plural(i.qty, 'unit')}, ${formatCents(i.grossCents)} gross, ${formatCents(i.netCents)} net"><div class="bar__fill ${signClass(v)}" style="width:${pct}%"></div></div>
      <span class="bar__value">${labelOf(i)}</span>`;
  }).join('') + (items.length > limit ? `<span class="bars__more">and ${plural(items.length - limit, 'more item')}</span>` : '');
}

// ---------- register & cart ----------

function renderMenuGrid() {
  const all = activeItems();
  const q = state.search.register;
  const items = all.filter((i) => matchesSearch(i, q));
  $('#menu-empty').hidden = all.length > 0;
  $('#menu-nomatch').hidden = !(all.length > 0 && items.length === 0);
  $('#menu-nomatch-text').textContent = `Nothing on the menu matches “${q.trim()}”.`;
  $('#menu-grid').innerHTML = items.map((item) => `
    <div class="tile" data-id="${item.id}" style="--tint:${tint(item.id)}">
      <div class="tile__media">${mediaHTML(item)}</div>
      <div class="tile__info">
        <span class="tile__name">${esc(item.name)}</span>
        <span class="tile__price">${formatCents(item.priceCents)}</span>
      </div>
      <div class="tile__stepper">
        <button class="step step--minus" type="button" data-action="dec" aria-label="Remove one ${esc(item.name)}" disabled>−</button>
        <span class="tile__qty" aria-live="polite" aria-label="In cart">0</span>
        <button class="step step--plus" type="button" data-action="inc" aria-label="Add one ${esc(item.name)}">+</button>
      </div>
    </div>`).join('');
  syncTiles();
}

function syncTiles() {
  $$('.tile').forEach((tile) => {
    const line = state.cart.find((l) => l.itemId === tile.dataset.id);
    const qty = line ? line.qty : 0;
    tile.classList.toggle('tile--active', qty > 0);
    tile.querySelector('.tile__qty').textContent = qty;
    tile.querySelector('.step--minus').disabled = qty === 0;
  });
}

function renderCart() {
  const total = cartTotal(state.cart);
  const count = cartCount(state.cart);
  const empty = state.cart.length === 0;

  $('#cart-empty').hidden = !empty;
  $('#cart-clear').hidden = empty;
  $('#checkout-btn').disabled = empty;
  $('#checkout-btn').textContent = empty ? 'Charge' : `Charge ${formatCents(total)}`;
  $('#cart-count').textContent = plural(count, 'item');
  $('#cart-total').textContent = formatCents(total);
  $('#cart-lines').innerHTML = state.cart.map((l) => `
    <div class="line" data-id="${l.itemId}">
      <div class="line__main">
        <div class="line__name">${esc(l.name)}</div>
        <div class="line__calc">${l.qty} × ${formatCents(l.unitPriceCents)}</div>
      </div>
      <div class="line__total">${formatCents(l.unitPriceCents * l.qty)}</div>
      <div class="line__ctrl">
        <button class="mini" type="button" data-action="dec" aria-label="One less ${esc(l.name)}">−</button>
        <span class="line__qty">${l.qty}</span>
        <button class="mini" type="button" data-action="inc" aria-label="One more ${esc(l.name)}">+</button>
        <button class="mini mini--danger" type="button" data-action="remove" aria-label="Remove ${esc(l.name)}">✕</button>
      </div>
    </div>`).join('');

  $('#cart-bar').hidden = empty;
  $('#cart-bar-count').textContent = count;
  $('#cart-bar-total').textContent = formatCents(total);
  if (empty) closeCart();
  syncTiles();
}

function openCart() { $('#cart').classList.add('is-open'); }
function closeCart() { $('#cart').classList.remove('is-open'); }

// ---------- checkout ----------

function openCheckout() {
  if (!state.cart.length) return;
  $('#checkout-lines').innerHTML = state.cart.map((l) => `
    <div class="receipt__line"><span>${l.qty} × ${esc(l.name)}</span><span>${formatCents(l.unitPriceCents * l.qty)}</span></div>`).join('');
  $('#checkout-total').textContent = formatCents(cartTotal(state.cart));
  const input = $('#cash-input');
  input.value = '';
  updatePaid();
  openModal($('#modal-checkout'));
  input.focus();
}

function updatePaid() {
  const total = cartTotal(state.cart);
  const raw = $('#cash-input').value;
  const paid = parsePrice(raw);
  const row = $('#change-row');
  const label = $('#change-label');
  const amount = $('#change-amount');
  const btn = $('#confirm-sale');

  if (raw.trim() === '') {
    row.className = 'change change--none';
    label.textContent = 'Change due';
    amount.textContent = '—';
    btn.disabled = false;
    btn.textContent = 'Complete sale';
    return;
  }
  if (paid == null) {
    row.className = 'change change--short';
    label.textContent = 'Enter a valid amount';
    amount.textContent = '—';
    btn.disabled = true;
    btn.textContent = 'Complete sale';
    return;
  }
  const diff = paid - total;
  if (diff < 0) {
    row.className = 'change change--short';
    label.textContent = 'Still owed';
    amount.textContent = formatCents(-diff);
    btn.disabled = true;
    btn.textContent = `Needs ${formatCents(-diff)} more`;
    return;
  }
  row.className = 'change';
  label.textContent = diff === 0 ? 'Exact amount' : 'Change due';
  amount.textContent = diff === 0 ? 'No change' : formatCents(diff);
  btn.disabled = false;
  btn.textContent = diff === 0 ? 'Complete sale' : `Complete · give ${formatCents(diff)} change`;
}

async function confirmSale() {
  if (!state.cart.length) return;
  const btn = $('#confirm-sale');
  const raw = $('#cash-input').value.trim();
  const paid = raw === '' ? null : parsePrice(raw);
  if (raw !== '' && (paid == null || paid < cartTotal(state.cart))) return;

  btn.disabled = true;
  try {
    const sale = buildSale(state.cart, Date.now(), uuid(), paid);
    await db.putSale(sale);
    state.cart = [];
    renderCart();
    closeModal($('#modal-checkout'));
    buzz([30, 40, 30]);
    showDone(sale);
    if (state.tab === 'sales') renderSales();
    if (state.tab === 'dashboard') renderDashboard();
    renderProfitIfActive();
  } catch (err) {
    toast(`Could not save the sale: ${err.message || err}`, 'error');
  } finally {
    btn.disabled = false;
  }
}

let doneTimer = null;
function showDone(sale) {
  const el = $('#done');
  const hasChange = isInt(sale.changeCents);
  $('#done-amount').textContent = hasChange ? formatCents(sale.changeCents) : formatCents(sale.totalCents);
  $('#done-sub').textContent = hasChange
    ? (sale.changeCents === 0 ? `Exact amount · ${formatCents(sale.totalCents)} sale` : `change to give back · ${formatCents(sale.totalCents)} sale`)
    : 'sale saved';
  $('.done__title').textContent = hasChange && sale.changeCents > 0 ? 'Change due' : 'Sale complete';
  el.hidden = false;
  clearTimeout(doneTimer);
  doneTimer = setTimeout(hideDone, hasChange && sale.changeCents > 0 ? 4000 : 1800);
}
function hideDone() {
  clearTimeout(doneTimer);
  $('#done').hidden = true;
}

// ---------- sales ----------

function setDay(key) {
  state.day = key;
  renderSales();
}

function saleItemsText(sale) {
  return sale.lines.map((l) => `${l.qty}× ${l.name}`).join(', ');
}

async function renderSales() {
  const [start, end] = dayRange(state.day);
  const sales = (await salesBetween(start, end)).sort((a, b) => b.timestamp - a.timestamp);
  state.daySales = sales;

  const t = today();
  $('#day-label').textContent = friendlyDay(state.day, t);
  $('#day-input').value = state.day;
  $('#day-input').max = t;
  $('#day-next').disabled = state.day >= t;
  $('#day-today').hidden = state.day === t;

  const sum = summarizeSales(sales);
  $('#day-title').textContent = state.day === t ? `Today, ${longDay(t).split(', ').slice(1).join(', ')}` : longDay(state.day);
  $('#day-count').textContent = `${plural(sum.count, 'sale')} · ${plural(sum.units, 'item')}`;
  $('#stat-gross').textContent = formatCents(sum.grossCents);
  $('#stat-cost').textContent = formatCents(sum.costCents);
  const net = $('#stat-net');
  net.textContent = formatCents(sum.netCents);
  net.className = signClass(sum.netCents);

  const note = $('#sales-note');
  note.hidden = sum.unknownCostQty === 0;
  note.textContent = unknownCostNote(sum.unknownCostQty);

  $('#stat-items').hidden = sum.items.length === 0;
  $('#stat-items').innerHTML = sum.items.map((i) => `<span><b>${i.qty}×</b> ${esc(i.name)}</span>`).join('');

  $('#sales-empty').hidden = sales.length > 0;
  $('#sales-empty-text').textContent = state.day === t ? 'No sales yet today' : 'No sales on this day';
  $('#sales-list').innerHTML = sales.map((s) => {
    const netC = saleNet(s);
    const paid = isInt(s.paidCents)
      ? `Paid ${formatCents(s.paidCents)} · Change ${formatCents(Math.max(0, s.changeCents))}`
      : 'Amount paid not recorded';
    return `
    <button class="sale" type="button" data-id="${s.id}">
      <span class="sale__time">${timeString(s.timestamp)}</span>
      <span class="sale__items">${esc(saleItemsText(s))}</span>
      <span class="sale__gross">${formatCents(s.totalCents)}</span>
      <span class="sale__detail">Cost ${formatCents(s.costCents)} · Net <b class="${signClass(netC)}">${formatCents(netC)}</b> · ${paid}</span>
    </button>`;
  }).join('');
}

function openSaleDetail(id) {
  const sale = state.daySales.find((s) => s.id === id);
  if (!sale) return;
  state.viewingSaleId = id;
  $('#sale-when').textContent = new Date(sale.timestamp).toLocaleString([], { weekday: 'long', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  $('#sale-lines').innerHTML = sale.lines.map((l) => `
    <div class="receipt__line">
      <span>${l.qty} × ${esc(l.name)} <small>${formatCents(l.unitPriceCents)} each · ${isInt(l.unitCostCents) ? `cost ${formatCents(l.unitCostCents)} each` : 'no cost set'}</small></span>
      <span>${formatCents(l.unitPriceCents * l.qty)}</span>
    </div>`).join('');
  $('#sale-gross').textContent = formatCents(sale.totalCents);
  $('#sale-cost').textContent = formatCents(sale.costCents);
  const net = $('#sale-net');
  net.textContent = formatCents(saleNet(sale));
  net.className = signClass(saleNet(sale));
  $('#sale-paid').textContent = isInt(sale.paidCents) ? formatCents(sale.paidCents) : 'Not recorded';
  $('#sale-change').textContent = isInt(sale.changeCents) ? formatCents(Math.max(0, sale.changeCents)) : 'Not recorded';
  const unknown = saleUnknownCostQty(sale);
  const note = $('#sale-note');
  note.hidden = unknown === 0;
  note.textContent = unknownCostNote(unknown);
  openModal($('#modal-sale'));
}

async function deleteCurrentSale() {
  const sale = state.daySales.find((s) => s.id === state.viewingSaleId);
  if (!sale) return;
  const ok = await confirmDialog({
    title: 'Delete this sale?',
    message: `The ${formatCents(sale.totalCents)} sale at ${timeString(sale.timestamp)} will be removed for good.`,
    confirmText: 'Delete',
    danger: true,
  });
  if (!ok) return;
  await db.deleteSale(sale.id);
  closeModal($('#modal-sale'));
  buzz();
  toast('Sale deleted');
  renderSales();
}

// ---------- menu: items ----------

function costText(item) {
  if (!isInt(item.costCents)) return '<span class="tag">No cost set</span>';
  const net = itemUnitNet(item);
  const where = item.supplier ? ` · ${esc(item.supplier)}` : '';
  let how = 'Cost';
  let warn = '';
  if (item.costMode === 'recipe') {
    how = 'Costs';
    const rc = recipeCost(item.recipe, ingredientsById(), item.extraCostCents);
    if (rc.missing) warn = ` · <span class="warn">${plural(rc.missing, 'ingredient')} missing</span>`;
  }
  return `${how} <b>${formatCents(item.costCents)}</b>${item.costMode === 'recipe' ? ' to make' : ''} · Net <b class="${signClass(net)}">${formatCents(net)}</b> each${where}${warn}`;
}

function renderMenuManage() {
  const all = activeItems();
  const q = state.search.menu;
  const items = all.filter((i) => matchesSearch(i, q));
  $('#menu-manage-empty').hidden = all.length > 0;
  $('#menu-manage-nomatch').hidden = !(all.length > 0 && items.length === 0);
  $('#menu-manage-nomatch-text').textContent = `Nothing on the menu matches “${q.trim()}”.`;

  const missing = all.filter((i) => !isInt(i.costCents)).length;
  const tip = $('#menu-tip');
  tip.hidden = missing === 0 || all.length === 0;
  tip.innerHTML = `<b>${plural(missing, 'item')}</b> ${missing === 1 ? 'has' : 'have'} no cost set. Tap an item and fill in “Your cost” so the Sales, Dashboard and Pricing sections can work out net income.`;

  $('#item-list').innerHTML = items.map((i) => `
    <button class="item-row" type="button" data-id="${i.id}" style="--tint:${tint(i.id)}">
      <span class="item-row__media" aria-hidden="true">${mediaHTML(i)}</span>
      <span class="item-row__text">
        <span class="item-row__name">${esc(i.name)}</span>
        <span class="item-row__meta">${costText(i)}</span>
      </span>
      <span class="item-row__price">${formatCents(i.priceCents)}</span>
      <span class="item-row__chev" aria-hidden="true">›</span>
    </button>`).join('');
}

function setCostMode(mode) {
  state.editor.costMode = mode;
  $$('#cost-mode .seg__btn').forEach((b) => b.classList.toggle('is-active', b.dataset.mode === mode));
  $('#cost-recipe').hidden = mode !== 'recipe';
  $('#cost-pack').hidden = mode !== 'pack';
  $('#cost-unit').hidden = mode !== 'unit';
  if (mode === 'recipe') renderRecipeRows();
}

function renderPhotoPreview() {
  const box = $('#photo-preview');
  const img = state.editor.image;
  box.classList.toggle('has-photo', Boolean(img));
  box.innerHTML = img ? `<img src="${img}" alt="Item photo">` : '<svg class="photo-preview__icon" aria-hidden="true"><use href="#i-camera"/></svg>';
  $('#photo-remove').hidden = !img;
  $('#photo-choose').textContent = img ? 'Change photo' : 'Choose photo';
  $('#photo-hint').textContent = img
    ? `Photo saved at about ${Math.max(1, Math.round(approxBytes(img) / 1024))} KB.`
    : 'Take a photo or pick one from your library. It is shrunk to save space.';
}

async function onPhotoChosen(e) {
  const file = e.target.files && e.target.files[0];
  e.target.value = '';
  if (!file) return;
  $('#photo-choose').disabled = true;
  try {
    state.editor.image = await fileToThumb(file);
    renderPhotoPreview();
  } catch (err) {
    showItemError(err.message || 'Could not use that photo.');
  } finally {
    $('#photo-choose').disabled = false;
  }
}

// Recipe builder

function addRecipeRow(ingredientId) {
  state.editor.recipe.push({ ingredientId, amount: '1' });
  renderRecipeRows();
  updateCostResult();
}

function renderRecipeRows() {
  const rows = state.editor.recipe;
  const ings = sortedIngredients();
  const byId = ingredientsById();
  $('#recipe-hint').textContent = ings.length
    ? 'Add the ingredients one of these uses and how much of each.'
    : 'No ingredients yet. Tap “New ingredient…” to create one, for example Butter at $3.00 for 8 tbsp.';
  $('#recipe-add').disabled = ings.length === 0;
  $('#recipe-rows').innerHTML = rows.map((r, idx) => {
    const ing = byId.get(r.ingredientId);
    return `
    <div class="recipe__row" data-idx="${idx}">
      <select class="input" data-field="ingredient" aria-label="Ingredient">
        <option value="" ${r.ingredientId ? '' : 'selected'}>Choose…</option>
        ${ings.map((i) => `<option value="${i.id}" ${i.id === r.ingredientId ? 'selected' : ''}>${esc(i.name)}</option>`).join('')}
      </select>
      <input class="input" data-field="amount" type="text" inputmode="decimal" placeholder="1" value="${esc(r.amount)}" aria-label="Amount used">
      <span class="recipe__unit" title="${esc(ing ? ing.unit : '')}">${esc(ing ? ing.unit : '')}</span>
      <button class="mini mini--danger" type="button" data-remove aria-label="Remove this ingredient">✕</button>
    </div>`;
  }).join('');
}

/** Read the cost fields. Returns { costCents, packPriceCents, packQty, recipe, extraCostCents } or { error }. */
function readCost() {
  const mode = state.editor.costMode;
  const none = { costCents: null, packPriceCents: null, packQty: null, recipe: [], extraCostCents: 0 };

  if (mode === 'recipe') {
    const extraRaw = $('#item-extra-cost').value.trim();
    const extraCostCents = extraRaw === '' ? 0 : parsePrice(extraRaw);
    if (extraCostCents == null) return { error: 'Enter a valid other cost per item, for example 0.10, or leave it blank.' };
    const recipe = [];
    for (const r of state.editor.recipe) {
      if (!r.ingredientId) return { error: 'Choose an ingredient for every row, or remove the empty row.' };
      const amount = parseAmount(r.amount);
      if (amount == null) return { error: 'Enter how much of each ingredient one item uses, as a number above 0.' };
      recipe.push({ ingredientId: r.ingredientId, amount });
    }
    if (recipe.length === 0 && extraCostCents === 0) return { ...none, breakdown: null };
    const breakdown = recipeCost(recipe, ingredientsById(), extraCostCents);
    return { costCents: breakdown.totalCents, packPriceCents: null, packQty: null, recipe, extraCostCents, breakdown };
  }

  if (mode === 'pack') {
    const priceRaw = $('#item-pack-price').value.trim();
    const qtyRaw = $('#item-pack-qty').value.trim();
    if (priceRaw === '' && qtyRaw === '') return none;
    const pack = parsePrice(priceRaw);
    const qty = parseCount(qtyRaw);
    if (pack == null) return { error: 'Enter the pack price, for example 30.00.' };
    if (qty == null) return { error: 'Enter how many units are in the pack, as a whole number.' };
    return { ...none, costCents: unitCostFromPack(pack, qty), packPriceCents: pack, packQty: qty };
  }

  const raw = $('#item-unit-cost').value.trim();
  if (raw === '') return none;
  const c = parsePrice(raw);
  if (c == null) return { error: 'Enter a valid cost per unit, for example 1.00.' };
  return { ...none, costCents: c };
}

function updateCostResult() {
  const el = $('#cost-result');
  const r = readCost();
  if (r.error) {
    el.className = 'cost__result cost__result--error';
    el.textContent = r.error;
    return;
  }
  el.className = 'cost__result';
  const mode = state.editor.costMode;
  if (r.costCents == null) {
    el.textContent = mode === 'recipe'
      ? 'Add at least one ingredient to see what this costs to make.'
      : mode === 'pack'
        ? 'Enter the pack price and units per pack to see your cost per unit.'
        : 'Enter what one unit costs you.';
    return;
  }
  const price = parsePrice($('#item-price').value);
  let html;
  if (mode === 'recipe') {
    const b = r.breakdown;
    html = `Ingredients <b>${formatCents(b.ingredientCents)}</b>${b.extraCents ? ` + other <b>${formatCents(b.extraCents)}</b>` : ''} = Cost per item <b>${formatCents(r.costCents)}</b>`;
  } else {
    const pack = r.packQty ? `${formatCents(r.packPriceCents)} ÷ ${r.packQty} = ` : '';
    html = `${pack}Cost per unit <b>${formatCents(r.costCents)}</b>`;
  }
  if (price == null) html += ' · enter a selling price to see profit per unit';
  else {
    const net = price - r.costCents;
    html += ` · Profit per unit <b class="${net < 0 ? 'neg' : 'pos'}">${formatCents(net)}</b>`;
  }
  el.innerHTML = html;
}

function openItemModal(id) {
  state.editingId = id;
  const item = id ? state.items.find((i) => i.id === id) : null;
  state.editor.image = item ? item.image : null;
  state.editor.recipe = item ? item.recipe.map((r) => ({ ingredientId: r.ingredientId, amount: amountText(r.amount) })) : [];
  $('#item-modal-title').textContent = item ? 'Edit item' : 'Add item';
  $('#item-name').value = item ? item.name : '';
  $('#item-price').value = item ? centsToPlain(item.priceCents) : '';
  $('#item-emoji').value = item ? item.emoji : '';
  $('#item-supplier').value = item ? item.supplier : '';
  $('#item-pack-price').value = item && isInt(item.packPriceCents) ? centsToPlain(item.packPriceCents) : '';
  $('#item-pack-qty').value = item && isInt(item.packQty) ? String(item.packQty) : '';
  $('#item-unit-cost').value = item && isInt(item.costCents) && item.costMode === 'unit' ? centsToPlain(item.costCents) : '';
  $('#item-extra-cost').value = item && item.extraCostCents > 0 ? centsToPlain(item.extraCostCents) : '';
  setCostMode(item ? item.costMode : (state.ingredients.length ? 'recipe' : 'pack'));
  updateCostResult();
  renderPhotoPreview();
  $('#item-error').hidden = true;
  $('#item-remove').hidden = !item;
  $('#item-save').textContent = item ? 'Save' : 'Add item';
  $('#item-form').scrollTop = 0;
  openModal($('#modal-item'));
}

function showItemError(message) {
  const el = $('#item-error');
  el.textContent = message;
  el.hidden = false;
  el.scrollIntoView({ block: 'nearest' });
}

async function saveItem() {
  const name = $('#item-name').value.trim();
  const priceCents = parsePrice($('#item-price').value);
  const emoji = firstGrapheme($('#item-emoji').value);
  const supplier = $('#item-supplier').value.trim();
  const cost = readCost();

  if (!name) return showItemError('Please enter a name.');
  if (priceCents == null) return showItemError('Please enter a valid selling price of $0.00 or more, for example 1.50.');
  if (cost.error) return showItemError(cost.error);

  const editing = Boolean(state.editingId);
  const existing = editing ? state.items.find((i) => i.id === state.editingId) : null;
  const item = normalizeItem({
    ...(existing || { id: uuid(), active: true, createdAt: Date.now() }),
    name, priceCents, emoji, supplier,
    costMode: state.editor.costMode,
    costCents: cost.costCents,
    packPriceCents: cost.packPriceCents,
    packQty: cost.packQty,
    recipe: cost.recipe,
    extraCostCents: cost.extraCostCents,
    image: state.editor.image,
  });

  try {
    await db.putItem(item);
  } catch (err) {
    return showItemError(`Could not save: ${err.message || err}`);
  }
  state.items = state.items.filter((i) => i.id !== item.id).concat(item);
  for (const l of state.cart) {
    if (l.itemId === item.id) {
      l.name = item.name;
      l.emoji = item.emoji;
      l.unitPriceCents = item.priceCents;
      l.unitCostCents = item.costCents;
    }
  }

  closeModal($('#modal-item'));
  buzz();
  toast(editing ? 'Item updated' : 'Item added', 'success');
  renderMenu();
  renderMenuGrid();
  renderCart();
  renderProfitIfActive();
}

async function removeCurrentItem() {
  const item = state.items.find((i) => i.id === state.editingId);
  if (!item) return;
  const ok = await confirmDialog({
    title: `Remove ${item.name}?`,
    message: 'It will disappear from the register. Past sales are not affected.',
    confirmText: 'Remove',
    danger: true,
  });
  if (!ok) return;
  const updated = { ...item, active: false };
  await db.putItem(updated);
  state.items = state.items.map((i) => (i.id === item.id ? updated : i));
  cartSetQty(state.cart, item.id, 0);
  closeModal($('#modal-item'));
  buzz();
  toast('Item removed');
  renderMenu();
  renderMenuGrid();
  renderCart();
  renderProfitIfActive();
}

// ---------- menu: ingredients ----------

function usedIn(ingredientId) {
  return activeItems().filter((i) => i.recipe.some((r) => r.ingredientId === ingredientId));
}

function renderIngredients() {
  const all = sortedIngredients();
  const q = state.search.ingredients.trim().toLowerCase();
  const list = q ? all.filter((g) => g.name.toLowerCase().includes(q) || (g.supplier || '').toLowerCase().includes(q)) : all;
  $('#ingredient-empty').hidden = all.length > 0;
  $('#ingredient-nomatch').hidden = !(all.length > 0 && list.length === 0);
  $('#ingredient-nomatch-text').textContent = `No ingredient matches “${state.search.ingredients.trim()}”.`;
  $('#ingredient-list').innerHTML = list.map((g) => {
    const uses = usedIn(g.id).length;
    const active = pickPrice(g, myStore());
    const others = g.prices.filter((p) => p !== active);
    const main = active
      ? `<b>${esc(active.store)}</b> ${formatCents(active.packPriceCents)} for ${amountText(active.packUnits)} ${esc(g.unit)} · <b>${formatUnitCost(active.packPriceCents / active.packUnits)}</b> per ${esc(g.unit)}`
      : '<span class="tag">No price yet</span>';
    const more = others.length ? ` · also ${others.map((p) => `${esc(p.store)} ${formatUnitCost(p.packPriceCents / p.packUnits)}`).join(', ')}` : '';
    return `
    <button class="item-row" type="button" data-id="${g.id}" style="--tint:${tint(g.id)}">
      <span class="item-row__media item-row__media--text" aria-hidden="true">${esc(initialOf(g.name))}</span>
      <span class="item-row__text">
        <span class="item-row__name">${esc(g.name)}</span>
        <span class="item-row__meta">${main}${more} · ${uses ? `used in ${plural(uses, 'item')}` : 'not used yet'}</span>
      </span>
      <span class="item-row__chev" aria-hidden="true">›</span>
    </button>`;
  }).join('');
}

// ---------- my store ----------

function myStore() {
  return state.store && state.store.name ? state.store.name : '';
}

function storeLabel() {
  const s = state.store || {};
  if (!s.name) return '';
  return s.location ? `${s.name} · ${s.location}` : s.name;
}

function allStoreNames() {
  const names = new Set(STORES);
  for (const g of state.ingredients) for (const p of g.prices) names.add(p.store);
  if (myStore()) names.add(myStore());
  return [...names];
}

function storeOptions(selected) {
  const names = allStoreNames();
  const sel = String(selected || '');
  const opts = names.map((n) => `<option value="${esc(n)}" ${n === sel ? 'selected' : ''}>${esc(n)}</option>`);
  if (sel && sel !== '__other' && !names.includes(sel)) opts.push(`<option value="${esc(sel)}" selected>${esc(sel)}</option>`);
  opts.push(`<option value="__other" ${sel === '__other' ? 'selected' : ''}>Other…</option>`);
  return opts.join('');
}

function renderStoreCards() {
  const label = storeLabel();
  $('#store-card-text').innerHTML = label
    ? `Your store: <b>${esc(label)}</b>. Costs use its prices when you have them.`
    : 'No store picked yet. Pick where you shop so costs use that store\'s prices.';
  $('#store-change').textContent = label ? 'Change' : 'Pick store';
  $('#pricing-store-text').innerHTML = label
    ? `Costs use prices from <b>${esc(label)}</b>`
    : 'Costs use the cheapest price you have for each ingredient';
  $('#store-list').innerHTML = allStoreNames().map((n) => `<option value="${esc(n)}"></option>`).join('');
}

function openStoreModal() {
  const s = state.store || {};
  const known = allStoreNames().includes(s.name);
  $('#store-select').innerHTML = '<option value="">Choose a store…</option>' + storeOptions(s.name ? (known ? s.name : '__other') : '');
  $('#store-custom').value = s.name && !known ? s.name : '';
  $('#store-custom-field').hidden = !(s.name && !known);
  const locSelect = $('#store-location');
  const knownLoc = [...locSelect.options].some((o) => o.value !== '__other' && o.value === s.location);
  locSelect.value = s.location ? (knownLoc ? s.location : '__other') : 'West Palm Beach, FL';
  $('#store-location-custom').value = s.location && !knownLoc ? s.location : '';
  $('#store-location-custom-field').hidden = locSelect.value !== '__other';
  $('#store-error').hidden = true;
  openModal($('#modal-store'));
}

async function saveStore() {
  let name = $('#store-select').value;
  if (name === '__other') name = $('#store-custom').value.trim();
  let location = $('#store-location').value;
  if (location === '__other') location = $('#store-location-custom').value.trim();
  if (!name) {
    const el = $('#store-error');
    el.textContent = 'Pick a store, or choose “Other…” and type its name.';
    el.hidden = false;
    return;
  }
  const firstPick = !myStore();
  state.store = { name, location };
  await db.setMeta('store', state.store);
  closeModal($('#modal-store'));

  // Prices typed in before a store was chosen: offer to label them with this store.
  const unlabeled = state.ingredients.filter((g) => g.prices.some((p) => p.store === UNKNOWN_STORE));
  if (firstPick && unlabeled.length) {
    const ok = await confirmDialog({
      title: `Are those ${name} prices?`,
      message: `${plural(unlabeled.length, 'ingredient')} ${unlabeled.length === 1 ? 'has' : 'have'} a price with no store on it. Mark ${unlabeled.length === 1 ? 'it' : 'them'} as ${name}?`,
      confirmText: `Yes, ${name}`,
      cancelText: 'Leave as is',
    });
    if (ok) {
      for (const g of unlabeled) {
        const already = g.prices.some((p) => p.store.toLowerCase() === name.toLowerCase());
        g.prices = already ? g.prices.filter((p) => p.store !== UNKNOWN_STORE) : g.prices.map((p) => (p.store === UNKNOWN_STORE ? { ...p, store: name } : p));
      }
      await db.putIngredients(unlabeled);
    }
  }

  const switched = await applyStoreToIngredients();
  buzz();
  toast(switched ? `Using ${name} prices · ${plural(switched, 'ingredient')} switched` : `Using ${name} prices`, 'success');
  if (state.tab === 'menu') renderMenu();
  renderMenuGrid();
  renderCart();
}

/** Point every ingredient at the chosen store's price and refresh recipe costs. Returns how many switched. */
async function applyStoreToIngredients() {
  const changed = state.ingredients.filter((g) => syncIngredientPrice(g, myStore()));
  if (changed.length) await db.putIngredients(changed);
  await recomputeRecipeCosts();
  return changed.length;
}

// ---------- ingredient editor ----------

let ingredientFromItem = false;

function openIngredientModal(id, opts = {}) {
  state.editingIngredientId = id;
  ingredientFromItem = Boolean(opts.fromItem);
  const g = id ? state.ingredients.find((x) => x.id === id) : null;
  state.editorIng.prices = g
    ? g.prices.map((p) => ({ store: p.store, custom: '', price: centsToPlain(p.packPriceCents), units: amountText(p.packUnits), checkedAt: p.checkedAt }))
    : [{ store: myStore() || '__other', custom: '', price: '', units: '', checkedAt: 0 }];
  $('#ingredient-modal-title').textContent = g ? 'Edit ingredient' : 'Add ingredient';
  $('#ing-name').value = g ? g.name : '';
  $('#ing-unit').value = g ? g.unit : '';
  $('#ing-error').hidden = true;
  $('#ing-delete').hidden = !g;
  $('#ing-save').textContent = g ? 'Save' : 'Add ingredient';
  const usage = $('#ing-usage');
  const uses = g ? usedIn(g.id) : [];
  usage.hidden = uses.length === 0;
  usage.textContent = uses.length ? `Used in: ${uses.map((i) => i.name).join(', ')}. Saving a new price updates their cost.` : '';
  renderPriceRows();
  updateIngredientResult();
  $('#ingredient-form').scrollTop = 0;
  openModal($('#modal-ingredient'));
  if (!g) $('#ing-name').focus();
}

function priceRowStore(r) {
  return (r.store === '__other' ? r.custom : r.store).trim();
}

function addPriceRow(store) {
  state.editorIng.prices.push({ store: store || '__other', custom: '', price: '', units: '', checkedAt: 0 });
  renderPriceRows();
  updateIngredientResult();
}

/** The store a "Look up" link should search: the row's store, else your store. */
function lookupStoreFor(row) {
  const store = priceRowStore(row);
  return store && store !== UNKNOWN_STORE ? store : myStore();
}

function lookupUrlFor(row) {
  const name = $('#ing-name').value.trim();
  return storeSearchUrl(lookupStoreFor(row), name || 'ingredient', (state.store && state.store.location) || '');
}

function lookupLabelFor(row) {
  const store = lookupStoreFor(row);
  return `Look up${store ? ` at ${store}` : ' online'} ↗`;
}

function renderPriceRows() {
  const unit = $('#ing-unit').value.trim() || 'each';
  $('#price-rows').innerHTML = state.editorIng.prices.map((r, idx) => {
    return `
    <div class="price-line" data-idx="${idx}">
      <div class="price-line__store">
        <select class="input" data-field="store" aria-label="Store">${storeOptions(r.store)}</select>
        <input class="input" data-field="custom" type="text" maxlength="40" autocomplete="off" autocapitalize="words" placeholder="Store name" value="${esc(r.custom)}" ${r.store === '__other' ? '' : 'hidden'} aria-label="Store name">
      </div>
      <div class="price-line__nums">
        <div class="money-input"><span aria-hidden="true">$</span><input class="input" data-field="price" type="text" inputmode="decimal" placeholder="3.00" value="${esc(r.price)}" aria-label="Package price"></div>
        <span class="price-line__for">for</span>
        <input class="input" data-field="units" type="text" inputmode="decimal" placeholder="8" value="${esc(r.units)}" aria-label="Portions in the package">
        <span class="price-line__unit">${esc(unit)}</span>
      </div>
      <div class="price-line__foot">
        <a class="link-btn" data-lookup href="${esc(lookupUrlFor(r))}" target="_blank" rel="noopener">${esc(lookupLabelFor(r))}</a>
        <span class="price-line__badge" hidden>used for costs</span>
        <button class="mini mini--danger" type="button" data-remove aria-label="Remove this store price">✕</button>
      </div>
    </div>`;
  }).join('');
}

function syncUnitLabels() {
  const unit = $('#ing-unit').value.trim() || 'each';
  $$('#price-rows .price-line__unit').forEach((u) => { u.textContent = unit; });
}

function updateLookupLinks() {
  $$('#price-rows .price-line').forEach((line) => {
    const row = state.editorIng.prices[Number(line.dataset.idx)];
    const a = line.querySelector('[data-lookup]');
    if (!row || !a) return;
    a.href = lookupUrlFor(row);
    a.textContent = lookupLabelFor(row);
  });
}

function readIngredient() {
  const name = $('#ing-name').value.trim();
  const unit = $('#ing-unit').value.trim() || 'each';
  const rows = state.editorIng.prices.map((r) => ({
    store: priceRowStore(r),
    packPriceCents: parsePrice(r.price),
    packUnits: parseAmount(r.units),
    checkedAt: r.checkedAt,
  }));
  return { name, unit, rows };
}

function updateIngredientResult() {
  const el = $('#ing-result');
  const { unit, rows } = readIngredient();
  const valid = rows.filter((r) => r.store && r.packPriceCents != null && r.packUnits != null);
  const active = valid.length ? pickPrice({ prices: valid }, myStore()) : null;
  $$('#price-rows .price-line').forEach((line, idx) => {
    const on = Boolean(active) && rows[idx] && rows[idx].store === active.store && rows[idx].packPriceCents === active.packPriceCents && rows[idx].packUnits === active.packUnits;
    line.classList.toggle('is-active', on);
    line.querySelector('.price-line__badge').hidden = !on;
  });
  if (!active) {
    el.textContent = 'Enter what a package costs and how many portions it holds, e.g. $3.00 for 8 tbsp of butter.';
    return;
  }
  let html = `At <b>${esc(active.store)}</b>: ${formatCents(active.packPriceCents)} ÷ ${amountText(active.packUnits)} = <b>${formatUnitCost(active.packPriceCents / active.packUnits)}</b> per ${esc(unit)}`;
  html += myStore() && active.store.toLowerCase() !== myStore().toLowerCase()
    ? ` · used for costs (no ${esc(myStore())} price yet)`
    : ' · used for costs';
  if (valid.length > 1) {
    const cheapest = pickPrice({ prices: valid }, '');
    if (cheapest.store !== active.store) html += ` · <b>${esc(cheapest.store)}</b> is cheaper at ${formatUnitCost(cheapest.packPriceCents / cheapest.packUnits)} per ${esc(unit)}`;
  }
  el.innerHTML = html;
}

function showIngredientError(message) {
  const el = $('#ing-error');
  el.textContent = message;
  el.hidden = false;
}

async function saveIngredient() {
  const { name, unit, rows } = readIngredient();
  if (!name) return showIngredientError('Please enter a name, for example Butter.');
  if (!rows.length) return showIngredientError('Add at least one store price.');
  const prices = [];
  for (const r of rows) {
    if (!r.store) return showIngredientError('Pick a store for each price, or choose “Other…” and type its name.');
    if (r.packPriceCents == null) return showIngredientError(`${r.store}: enter what a package costs there, for example 3.00.`);
    if (r.packUnits == null) return showIngredientError(`${r.store}: enter how many portions that package holds, as a number above 0.`);
    if (prices.some((p) => p.store.toLowerCase() === r.store.toLowerCase())) return showIngredientError(`${r.store} is listed twice. Keep one price per store.`);
    prices.push({ store: r.store, packPriceCents: r.packPriceCents, packUnits: r.packUnits, checkedAt: r.checkedAt });
  }
  const dup = state.ingredients.find((g) => g.name.toLowerCase() === name.toLowerCase() && g.id !== state.editingIngredientId);
  if (dup) return showIngredientError(`You already have an ingredient called ${dup.name}.`);

  const existing = state.editingIngredientId ? state.ingredients.find((g) => g.id === state.editingIngredientId) : null;
  const now = Date.now();
  for (const p of prices) {
    const prev = existing ? existing.prices.find((x) => x.store.toLowerCase() === p.store.toLowerCase()) : null;
    if (!prev || prev.packPriceCents !== p.packPriceCents || prev.packUnits !== p.packUnits) p.checkedAt = now;
  }
  const ing = normalizeIngredient({ ...(existing || { id: uuid(), createdAt: now }), name, unit, prices });
  syncIngredientPrice(ing, myStore());
  try {
    await db.putIngredient(ing);
  } catch (err) {
    return showIngredientError(`Could not save: ${err.message || err}`);
  }
  state.ingredients = state.ingredients.filter((g) => g.id !== ing.id).concat(ing);
  const changed = await recomputeRecipeCosts();

  closeModal($('#modal-ingredient'));
  buzz();
  toast(existing ? (changed ? `Ingredient updated · ${plural(changed, 'item cost')} refreshed` : 'Ingredient updated') : 'Ingredient added', 'success');

  if (ingredientFromItem && !$('#modal-item').hidden) {
    if (!existing) addRecipeRow(ing.id);
    else { renderRecipeRows(); updateCostResult(); }
  }
  ingredientFromItem = false;
  if (state.tab === 'menu') renderMenu();
  renderMenuGrid();
  renderCart();
  renderProfitIfActive();
}

async function deleteCurrentIngredient() {
  const g = state.ingredients.find((x) => x.id === state.editingIngredientId);
  if (!g) return;
  const uses = usedIn(g.id);
  const ok = await confirmDialog({
    title: `Delete ${g.name}?`,
    message: uses.length
      ? `${plural(uses.length, 'item')} use${uses.length === 1 ? 's' : ''} it (${uses.map((i) => i.name).join(', ')}). It will be taken out of their ingredients and their cost will drop.`
      : 'It is not used by any item.',
    confirmText: 'Delete',
    danger: true,
  });
  if (!ok) return;
  await db.deleteIngredient(g.id);
  state.ingredients = state.ingredients.filter((x) => x.id !== g.id);
  const touched = state.items.filter((i) => i.recipe.some((r) => r.ingredientId === g.id));
  for (const it of touched) it.recipe = it.recipe.filter((r) => r.ingredientId !== g.id);
  if (touched.length) await db.putItems(touched);
  await recomputeRecipeCosts();
  if (!$('#modal-item').hidden) {
    state.editor.recipe = state.editor.recipe.filter((r) => r.ingredientId !== g.id);
    renderRecipeRows();
    updateCostResult();
  }
  closeModal($('#modal-ingredient'));
  buzz();
  toast('Ingredient deleted');
  if (state.tab === 'menu') renderMenu();
  renderMenuGrid();
  renderCart();
}

// ---------- menu: pricing assistant ----------

function pricingRows() {
  const { marginPct, roundTo } = state.pricing;
  return activeItems().map((item) => ({
    item,
    suggestion: isInt(item.costCents) ? suggestPrice(item.costCents, marginPct, roundTo) : null,
  }));
}

function renderPricing() {
  renderSeg('#margin-seg', MARGIN_PICKS.map((m) => ({ value: m, label: `${m}%` })), state.pricing.marginPct);
  renderSeg('#round-seg', ROUND_PICKS.map((r) => ({ value: r.cents, label: r.label })), state.pricing.roundTo);

  const rows = pricingRows();
  $('#pricing-empty').hidden = rows.length > 0;
  const missing = rows.filter((r) => !r.suggestion).length;
  const note = $('#pricing-note');
  note.hidden = missing === 0;
  note.textContent = `${plural(missing, 'item')} ${missing === 1 ? 'has' : 'have'} no cost set, so there is nothing to base a price on yet. Tap ${missing === 1 ? 'it' : 'them'} to add a cost.`;

  const applicable = rows.filter((r) => r.suggestion && r.suggestion.priceCents !== r.item.priceCents);
  const applyAll = $('#apply-all-prices');
  applyAll.hidden = applicable.length === 0;
  applyAll.textContent = `Apply all ${applicable.length} suggested price${applicable.length === 1 ? '' : 's'}`;

  const linked = $('#linked-sheet');
  linked.hidden = !state.sheetLink;
  if (state.sheetLink) {
    const when = state.sheetSyncedAt ? ` · last updated ${new Date(state.sheetSyncedAt).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}` : '';
    $('#linked-text').innerHTML = `Linked to <b>${esc(shortLink(state.sheetLink))}</b>${when}`;
  }

  $('#pricing-list').innerHTML = rows.map(({ item, suggestion }) => {
    const media = `<span class="item-row__media" aria-hidden="true" style="--tint:${tint(item.id)}">${mediaHTML(item)}</span>`;
    if (!suggestion) {
      return `
      <div class="price-row">
        <button class="price-row__main" type="button" data-edit="${item.id}">
          ${media}
          <span class="price-row__text"><span class="price-row__name">${esc(item.name)}</span><span class="price-row__meta"><span class="tag">No cost set</span> · now ${formatCents(item.priceCents)} · tap to add a cost</span></span>
        </button>
      </div>`;
    }
    const m = marginOf(item.priceCents, item.costCents);
    const losing = item.priceCents < item.costCents;
    const meta = `${item.costMode === 'recipe' ? 'Costs' : 'Cost'} ${formatCents(item.costCents)}${item.costMode === 'recipe' ? ' to make' : ''} · now ${formatCents(item.priceCents)}${m == null ? '' : ` (${m}% profit)`}${losing ? ' · <span class="loss">below cost</span>' : ''}`;
    const same = suggestion.priceCents === item.priceCents;
    return `
    <div class="price-row ${losing ? 'price-row--loss' : ''}">
      <button class="price-row__main" type="button" data-detail="${item.id}">
        ${media}
        <span class="price-row__text"><span class="price-row__name">${esc(item.name)}</span><span class="price-row__meta">${meta}</span></span>
        <span class="price-row__suggest"><small>Suggested</small><b>${formatCents(suggestion.priceCents)}</b><small>${suggestion.marginPct}% profit</small></span>
      </button>
      ${same ? '<span class="price-row__ok">✓ Set</span>' : `<button class="btn btn--primary price-row__apply" type="button" data-apply="${item.id}" data-cents="${suggestion.priceCents}">Apply</button>`}
    </div>`;
  }).join('');
}

async function applyPrice(id, priceCents) {
  const item = state.items.find((i) => i.id === id);
  if (!item || !isInt(priceCents)) return;
  const updated = { ...item, priceCents };
  await db.putItem(updated);
  state.items = state.items.map((i) => (i.id === id ? updated : i));
  for (const l of state.cart) if (l.itemId === id) l.unitPriceCents = priceCents;
  buzz();
  toast(`${item.name} is now ${formatCents(priceCents)}`, 'success');
  renderMenu();
  renderMenuGrid();
  renderCart();
  renderProfitIfActive();
}

async function applyAllPrices() {
  const rows = pricingRows().filter((r) => r.suggestion && r.suggestion.priceCents !== r.item.priceCents);
  if (!rows.length) return;
  const ok = await confirmDialog({
    title: `Update ${plural(rows.length, 'price')}?`,
    message: `Every item with a cost gets its suggested price at ${state.pricing.marginPct}% profit. You can still change any price by hand afterwards.`,
    confirmText: 'Update prices',
  });
  if (!ok) return;
  const updated = rows.map((r) => ({ ...r.item, priceCents: r.suggestion.priceCents }));
  await db.putItems(updated);
  const byId = new Map(updated.map((i) => [i.id, i]));
  state.items = state.items.map((i) => byId.get(i.id) || i);
  for (const l of state.cart) if (byId.has(l.itemId)) l.unitPriceCents = byId.get(l.itemId).priceCents;
  buzz();
  toast(`${plural(rows.length, 'price')} updated`, 'success');
  renderMenu();
  renderMenuGrid();
  renderCart();
  renderProfitIfActive();
}

function openPricingDetail(id) {
  const item = state.items.find((i) => i.id === id);
  if (!item || !isInt(item.costCents)) return;
  state.pricingItemId = id;
  $('#pricing-title').textContent = item.name;

  $('#pricing-breakdown').innerHTML = costBreakdownHTML(item);
  $('#pricing-cost').textContent = formatCents(item.costCents);

  const { marginPct, roundTo } = state.pricing;
  $('#pricing-ladder').innerHTML = MARGIN_PICKS.map((m) => {
    const s = suggestPrice(item.costCents, m, roundTo);
    return `<div class="ladder__row ${m === marginPct ? 'is-active' : ''}"><span>${m}% profit target</span><b>${formatCents(s.priceCents)}</b><span>keep ${formatCents(s.profitCents)}</span></div>`;
  }).join('');

  const cur = marginOf(item.priceCents, item.costCents);
  const profit = item.priceCents - item.costCents;
  $('#pricing-current').textContent = item.priceCents < item.costCents
    ? `Right now it sells for ${formatCents(item.priceCents)}, which is below what it costs. You lose ${formatCents(-profit)} on each one.`
    : `Right now it sells for ${formatCents(item.priceCents)} and you keep ${formatCents(profit)} of that${cur == null ? '' : ` (${cur}%)`}.`;

  const s = suggestPrice(item.costCents, marginPct, roundTo);
  const apply = $('#pricing-apply');
  apply.hidden = !s || s.priceCents === item.priceCents;
  apply.textContent = s ? `Use ${formatCents(s.priceCents)}` : '';
  openModal($('#modal-pricing'));
}

async function exportPricing() {
  const rows = pricingRows().map((r) => ({ name: r.item.name, costCents: r.item.costCents, priceCents: r.item.priceCents, suggestion: r.suggestion }));
  if (!rows.length) { toast('No items to export yet'); return; }
  try {
    await saveFile(`snack-stand-prices-${today()}.csv`, pricingCSV(rows, state.pricing.marginPct), 'text/csv');
  } catch (err) {
    toast(`Export failed: ${err.message || err}`, 'error');
  }
}

// Spreadsheet import

function openImportModal(opts = {}) {
  $('#import-text').value = '';
  $('#import-link').value = state.sheetLink || '';
  $('#import-unlink').hidden = !state.sheetLink;
  state.importPlan = null;
  state.importSource = null;
  $('#import-preview').hidden = true;
  $('#import-run').disabled = true;
  $('#import-fetch').disabled = false;
  openModal($('#modal-import'));
  if (opts.autoFetch && state.sheetLink) fetchSheetAndPreview(state.sheetLink);
}

function showImportMessage(html, cls = '') {
  const box = $('#import-preview');
  box.hidden = false;
  box.innerHTML = cls ? `<span class="${cls}">${html}</span>` : html;
}

/** Read a Google Sheet (shared as "Anyone with the link") or any CSV link as text. */
async function fetchSheetText(link) {
  const urls = sheetFetchUrls(link);
  if (!urls.length) throw new Error('That does not look like a spreadsheet link. Copy the address from the Google Sheets page and paste the whole thing.');
  if (navigator.onLine === false) throw new Error('You are offline. Connect to the internet to read the spreadsheet, or use a CSV file or paste instead.');
  let notShared = false;
  for (const url of urls) {
    try {
      const res = await fetch(url, { cache: 'no-store', redirect: 'follow' });
      if (!res.ok) { notShared = notShared || res.status === 401 || res.status === 403 || res.status === 404; continue; }
      const text = await res.text();
      if (/^\s*<(!doctype|html|meta)/i.test(text)) { notShared = true; continue; }
      if (text.trim()) return text;
    } catch (_) {
      notShared = true; // a private sheet redirects to a sign-in page the browser is not allowed to read
    }
  }
  const google = isGoogleSheetLink(link);
  throw new Error(google
    ? (notShared
      ? 'Google would not hand over that sheet. Open it in Google Sheets, tap Share, set General access to “Anyone with the link”, then try again.'
      : 'Could not read that sheet. Check the link and your internet connection, then try again.')
    : 'Could not read that link as a CSV. For Excel or Numbers, export the sheet as CSV and use “Choose a CSV file”, or upload it to Google Sheets and paste its link.');
}

async function fetchSheetAndPreview(link) {
  link = String(link || '').trim();
  if (!link) { showImportMessage('Paste the link to your Google Sheet first.', 'err'); return; }
  const btn = $('#import-fetch');
  btn.disabled = true;
  $('#import-run').disabled = true;
  showImportMessage('Reading your spreadsheet…');
  try {
    const text = await fetchSheetText(link);
    previewImport(text, { kind: 'link', link });
  } catch (err) {
    state.importPlan = null;
    showImportMessage(esc(err.message || 'Could not read the spreadsheet.'), 'err');
  } finally {
    btn.disabled = false;
  }
}

async function forgetSheetLink() {
  state.sheetLink = '';
  state.sheetSyncedAt = null;
  await db.setMeta('sheetLink', '');
  await db.setMeta('sheetSyncedAt', null);
  $('#import-link').value = '';
  $('#import-unlink').hidden = true;
  toast('Spreadsheet link forgotten');
  if (state.tab === 'menu') renderMenu();
}

function previewImport(text, source) {
  const box = $('#import-preview');
  const run = $('#import-run');
  const rows = parseDelimited(text);
  state.importSource = source || null;
  if (!rows.length) {
    state.importPlan = null;
    if (source && source.kind === 'link') showImportMessage('That sheet looks empty. Put the column names in the first row and the data below it.', 'err');
    else box.hidden = true;
    run.disabled = true;
    return;
  }
  const plan = buildImportPlan(rows, state.items, state.ingredients);
  state.importPlan = plan;
  const newIng = plan.ingredients.filter((g) => g.isNew).length;
  const newItems = plan.items.filter((i) => i.isNew).length;
  const packItems = plan.items.filter((i) => i.pack).length;
  const something = plan.ingredients.length || plan.items.length || plan.recipes.length;
  const parts = [];
  if (plan.ingredients.length) parts.push(`${plural(plan.ingredients.length, 'ingredient')} (${newIng} new, ${plan.ingredients.length - newIng} updated)`);
  if (plan.items.length) parts.push(`${plural(plan.items.length, 'item')} (${newItems} new${packItems ? `, ${packItems} priced by the pack` : ''})`);
  if (plan.recipes.length) parts.push(`${plural(plan.recipes.length, 'recipe line')}`);
  box.hidden = false;
  box.innerHTML = (something ? `<span class="ok">Ready to import:</span> ${parts.join(' · ')}.` : 'Nothing usable found yet.')
    + (plan.errors.length ? `<ul>${plan.errors.slice(0, 8).map((e) => `<li class="err">Row ${e.line}: ${esc(e.message)}</li>`).join('')}${plan.errors.length > 8 ? `<li class="err">…and ${plan.errors.length - 8} more</li>` : ''}</ul>` : '');
  run.disabled = !something;
}

async function runImport() {
  const plan = state.importPlan;
  if (!plan) return;
  $('#import-run').disabled = true;
  try {
    const now = Date.now();
    const ingByName = new Map(state.ingredients.map((g) => [g.name.toLowerCase(), g]));
    const ingToSave = [];
    plan.ingredients.forEach((p, i) => {
      const existing = ingByName.get(p.key);
      let prices = existing ? existing.prices.slice() : [];
      for (const sp of p.prices) {
        const store = sp.store || myStore() || UNKNOWN_STORE;
        prices = prices.filter((x) => x.store.toLowerCase() !== store.toLowerCase());
        prices.push({ store, packPriceCents: sp.packPriceCents, packUnits: sp.packUnits, checkedAt: now });
      }
      const ing = normalizeIngredient({ ...(existing || { id: uuid(), createdAt: now + i }), name: p.name, unit: p.unit || (existing ? existing.unit : 'each'), prices });
      syncIngredientPrice(ing, myStore());
      ingByName.set(p.key, ing);
      ingToSave.push(ing);
    });
    if (ingToSave.length) await db.putIngredients(ingToSave);
    const saved = new Map(ingToSave.map((g) => [g.id, g]));
    state.ingredients = state.ingredients.filter((g) => !saved.has(g.id)).concat(ingToSave);

    const itemByName = new Map(state.items.filter((i) => i.active).map((i) => [i.name.toLowerCase(), i]));
    const recipesByItem = new Map();
    for (const r of plan.recipes) {
      const ing = ingByName.get(r.ingredientKey);
      if (!ing) continue;
      if (!recipesByItem.has(r.itemKey)) recipesByItem.set(r.itemKey, []);
      const lines = recipesByItem.get(r.itemKey);
      const dup = lines.find((l) => l.ingredientId === ing.id);
      if (dup) dup.amount += r.amount; else lines.push({ ingredientId: ing.id, amount: r.amount });
    }
    const byId = ingredientsById();
    const itemsToSave = [];
    plan.items.forEach((p, i) => {
      const existing = itemByName.get(p.key);
      const recipe = recipesByItem.get(p.key);
      const base = existing || { id: uuid(), active: true, createdAt: now + 1000 + i, emoji: '', priceCents: 0 };
      const draft = { ...base, name: p.name };
      if (isInt(p.priceCents)) draft.priceCents = p.priceCents;
      if (recipe && recipe.length) {
        draft.costMode = 'recipe';
        draft.recipe = recipe;
        draft.costCents = recipeCost(recipe, byId, base.extraCostCents || 0).totalCents;
      } else if (p.pack) {
        // Sold straight from a pack: cost per unit is the pack price divided by the count.
        draft.costMode = 'pack';
        draft.recipe = [];
        draft.packPriceCents = p.pack.packPriceCents;
        draft.packQty = p.pack.packQty;
        draft.costCents = unitCostFromPack(p.pack.packPriceCents, p.pack.packQty);
        draft.supplier = p.pack.store || base.supplier || myStore();
      }
      itemsToSave.push(normalizeItem(draft));
    });
    if (itemsToSave.length) await db.putItems(itemsToSave);
    const savedItems = new Map(itemsToSave.map((i) => [i.id, i]));
    state.items = state.items.filter((i) => !savedItems.has(i.id)).concat(itemsToSave);
    await recomputeRecipeCosts();

    if (state.importSource && state.importSource.kind === 'link') {
      state.sheetLink = state.importSource.link;
      state.sheetSyncedAt = Date.now();
      await db.setMeta('sheetLink', state.sheetLink);
      await db.setMeta('sheetSyncedAt', state.sheetSyncedAt);
    }

    closeModal($('#modal-import'));
    buzz();
    toast(`Imported ${plural(plan.ingredients.length, 'ingredient')} and ${plural(plan.items.length, 'item')}${state.importSource && state.importSource.kind === 'link' ? ' from your spreadsheet' : ''}`, 'success');
    renderMenu();
    renderMenuGrid();
    renderCart();
    renderProfitIfActive();
  } catch (err) {
    toast(`Import failed: ${err.message || err}`, 'error');
  } finally {
    $('#import-run').disabled = false;
  }
}

// ---------- backup ----------

async function renderBackup() {
  const sales = await db.getAllSales();
  const active = activeItems();
  const photos = active.filter((i) => i.image).length;
  let storage = 'best effort';
  try {
    if (navigator.storage && navigator.storage.persisted && (await navigator.storage.persisted())) storage = 'persistent';
  } catch (_) { /* ignore */ }
  $('#about-stats').innerHTML = `
    <div>${plural(active.length, 'menu item')} (${plural(photos, 'photo')}) · ${plural(state.ingredients.length, 'ingredient')} · ${plural(sales.length, 'sale')} stored on this device</div>
    <div>Storage protection: ${storage}</div>
    <div>Snack Stand v2.1</div>`;
}

async function exportJSON() {
  try {
    const [items, sales, ingredients] = await Promise.all([db.getAllItems(), db.getAllSales(), db.getAllIngredients()]);
    const payload = {
      app: 'snack-stand', version: 3, exportedAt: new Date().toISOString(),
      store: state.store,
      items: items.map(normalizeItem), sales: sales.map(normalizeSale), ingredients: ingredients.map(normalizeIngredient),
    };
    await saveFile(`snack-stand-backup-${today()}.json`, JSON.stringify(payload, null, 2), 'application/json');
  } catch (err) {
    toast(`Export failed: ${err.message || err}`, 'error');
  }
}

async function exportCSV() {
  try {
    const [start, end] = dayRange(today());
    const sales = await salesBetween(start, end);
    if (!sales.length) { toast('No sales yet today'); return; }
    await saveFile(`snack-stand-sales-${today()}.csv`, salesToCSV(sales), 'text/csv');
  } catch (err) {
    toast(`Export failed: ${err.message || err}`, 'error');
  }
}

async function importJSON(e) {
  const file = e.target.files && e.target.files[0];
  e.target.value = '';
  if (!file) return;

  let parsed;
  let rawStore = null;
  try {
    const raw = JSON.parse(await file.text());
    parsed = validateBackup(raw);
    if (raw && raw.store && typeof raw.store.name === 'string') rawStore = { name: raw.store.name, location: String(raw.store.location || '') };
  } catch (err) {
    toast(`Import failed: ${err.message || 'could not read the file'}`, 'error');
    return;
  }

  const currentSales = await db.getAllSales();
  const ok = await confirmDialog({
    title: 'Restore this backup?',
    message: `This replaces everything on this device (${plural(state.items.length, 'item')}, ${plural(state.ingredients.length, 'ingredient')}, ${plural(currentSales.length, 'sale')}) with the backup (${plural(parsed.items.length, 'item')}, ${plural(parsed.ingredients.length, 'ingredient')}, ${plural(parsed.sales.length, 'sale')}).`,
    confirmText: 'Restore',
    danger: true,
  });
  if (!ok) return;

  try {
    await db.replaceAll(parsed);
    await db.setMeta('seeded', true);
  } catch (err) {
    toast(`Import failed: ${err.message || err}`, 'error');
    return;
  }
  await loadItems();
  await loadIngredients();
  if (rawStore && rawStore.name) {
    state.store = rawStore;
    await db.setMeta('store', state.store);
  }
  await applyStoreToIngredients();
  state.cart = [];
  renderMenuGrid();
  renderCart();
  renderBackup();
  buzz();
  toast('Backup restored', 'success');
}

// ---------- go ----------

init().catch((err) => {
  console.error(err);
  document.body.insertAdjacentHTML('beforeend',
    `<div style="position:fixed;inset:0;background:#fff;padding:24px;font-family:sans-serif;z-index:999">
      <h2>Snack Stand could not start</h2><p>${esc(err.message || err)}</p>
      <p>Try closing and reopening the app. If it keeps happening, your browser may be blocking storage (private browsing).</p></div>`);
});
