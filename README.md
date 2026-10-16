# Snack Stand

A point-of-sale register for a small snack stand. It is a Progressive Web App (PWA): plain HTML, CSS and JavaScript, no server, no accounts. Once added to an iPhone or iPad home screen it opens full screen and works with no internet connection.

Everything (menu, photos, sales) is stored on the device itself in IndexedDB. The iPhone and the iPad each keep their own data; use **Backup → Export data** to move data between them.

## What it does

- **Dashboard** (first tab): gross income, net income and number of sales for Today / This week / All time, plus two rankings: best sellers by units sold and most profitable by net income.
- **Register**: photo tiles with a − / quantity / + stepper on every item (tapping the tile itself does nothing), a search box, and the current sale. Checkout asks for the **amount paid**, shows the change due in big type, and won't complete a sale if the amount is short.
- **Sales**: pick a day, see gross income − cost = net income, what sold, and every sale with its gross, cost, net, amount paid and change given. Tap a sale for details or to delete it.
- **Profit**: pick one item from a dropdown and see, in plain words and bars, what you sell it for, what it costs you, what you keep on each one, what goes into the cost, and what you've made on it in total (sold, gross income, cost, net income) for today, this week or all time.
- **Menu → Items**: add or edit items with a name, selling price, a photo (camera or library; shrunk to ~40 KB before saving), an optional emoji, and your cost. An item's cost can come **from ingredients** (a recipe: 1 tbsp butter, 2 slices cheese, 2 slices bread…), **from a pack** (pack price ÷ units per pack) or be typed **per unit**.
- **Menu → Ingredients**: what a package of each ingredient costs you and how many portions it holds ($3.00 for 8 tbsp of butter = $0.375 per tbsp). Change a price and every item made from it gets its cost refreshed.
- **My store**: pick where you shop (Costco, Sam's Club, Publix, Whole Foods, Trader Joe's, Walmart, Aldi… or any name you type) and your location. Each ingredient can hold a price per store; costs use your store's price, or the cheapest one you have recorded. Every price row has a **Look up** button that opens that store's own search for the item so you can read the local price and type it in. The app cannot pull prices from store websites by itself: stores don't publish local prices for apps to read, and Costco warehouse prices aren't online at all.
- **Menu → Pricing**: the pricing assistant. Pick how much of each sale should be profit (50–75%) and how to round, and it shows what every item costs to make, what you keep now, and a suggested price. Apply prices one at a time or all at once; tap an item for the full breakdown and a ladder of price options. It is exact arithmetic built into the app, not a chatbot, so it works offline and never guesses.
- **Spreadsheet import**: paste the **link to your Google Sheet** and tap "Read sheet". The link is remembered, so after you edit the sheet you just tap **Update from spreadsheet** in the Pricing section. (The sheet must be shared as *Anyone with the link*: in Google Sheets tap Share → General access. Reading it needs internet; everything else works offline.) You can also paste cells or choose a CSV file, which also covers Excel and Numbers. Columns: *Item, Ingredient, Amount used, Package price, Units per package, Unit* and optionally *Store* and *Selling price*. The same ingredient can appear on several rows with different stores. For something sold straight from a pack (drinks, chips, cookies), leave Ingredient blank and put the pack price and count on the item's own row; it becomes a "From a pack" item. Ingredients are created or updated, items are created if missing, recipes are set, and prices are suggested for everything. A template CSV is one tap away.
- **Backup**: export everything as JSON (photos and ingredients included), import it back, or export today's sales as CSV.

### Money terms used everywhere

| Term | Meaning |
| --- | --- |
| Gross income | selling price × quantity, for everything sold |
| Cost | your unit cost × quantity (an item with no cost set counts as $0 and the app says so) |
| Net income | gross income − cost |

Each sale stores the item names, prices **and unit costs** at the time of the sale, so editing an item or its cost later never changes past numbers.

## What's in this folder

| File | Purpose |
| --- | --- |
| `index.html` | The screens and dialogs |
| `styles.css` | The look: ink header and tab bar, paper background, mustard accent |
| `app.js` | Screens, cart, checkout, menu editing, dashboard, backup |
| `logic.js` | Money math (integer cents), cart, cost/profit, dates, CSV, backup validation |
| `images.js` | Shrinks and compresses photos before they are stored |
| `pricing.js` | Ingredient and recipe costs, price suggestions, spreadsheet parsing and import planning |
| `db.js` | IndexedDB storage |
| `sw.js` | Service worker: caches the app so it loads offline. Has a `VERSION` you bump when you update |
| `manifest.webmanifest` | App name, colours and icons for "Add to Home Screen" |
| `fonts/baloo2.woff2` | The display font (Baloo 2 from Google Fonts, SIL Open Font License), bundled so it works offline |
| `icons/` | App icon (SVG, 192, 512 and the 180×180 `apple-touch-icon.png`) |
| `tests.html` | Automated checks for the money, cart, cost, date and CSV logic. Open it in a browser |
| `serve.ps1`, `preview.cmd` | Tiny local web server for previewing on Windows |

## Preview on your Windows PC

1. Open the `snack-stand` folder in File Explorer.
2. Double-click **`preview.cmd`**. A black window opens and says the app is running.
3. In your browser go to **http://localhost:8080/**
4. Close the black window to stop.

Open **http://localhost:8080/tests.html** to run the logic tests; the page title says PASS or FAIL.

If you'd rather use Python (already installed on this PC), open PowerShell in the folder and run:

```bash
py -m http.server 8080
```

## Put it online with GitHub Pages (free)

GitHub Pages serves the files over HTTPS, which iOS requires for offline mode and home-screen installs. You don't need to install anything: everything happens on the GitHub website.

### One-time setup

1. **Create a GitHub account.** Go to https://github.com and click **Sign up**. Your username becomes part of the app's address (`https://USERNAME.github.io/snack-stand/`).
2. **Create a repository.** Click the **+** in the top-right corner → **New repository**. Name it `snack-stand`, leave it **Public**, tick **Add a README file**, click **Create repository**.
3. **Upload the app files.** On the repository page click **Add file → Upload files**. Open the `snack-stand` folder in File Explorer, press **Ctrl+A**, and **drag everything into the upload area** (dragging keeps the `icons` and `fonts` folders intact; the "choose your files" link does not upload folders). Scroll down and click **Commit changes**.
4. **Turn on GitHub Pages.** **Settings** tab → **Pages** in the left sidebar → under **Build and deployment → Source** choose **Deploy from a branch** → Branch **main**, folder **/ (root)** → **Save**.
5. **Wait a minute or two**, then reload the Pages settings page. It says *Your site is live at `https://USERNAME.github.io/snack-stand/`*.

### Updating the app later

1. Edit the files on your PC and check them with `preview.cmd`.
2. Open `sw.js` and change the `VERSION` line (for example `'2.2.0'` → `'2.2.1'`), so every device fetches the new files.
3. On GitHub: **Add file → Upload files**, drag the changed files in (same names replace the old ones), **Commit changes**.
4. Wait a minute, then on each device **close the app fully and open it twice**. The first launch downloads the update in the background, the second launch runs it. A message saying "Update installed" appears when it's ready.

You never need to remove and re-add the home screen icon for an update; your data stays where it is. Only re-add the icon if the icon image itself changes.

### If you prefer Git on the command line

Install Git for Windows (https://git-scm.com), then in PowerShell inside the `snack-stand` folder:

```bash
git init
```
```bash
git add .
```
```bash
git commit -m "Snack Stand"
```
```bash
git branch -M main
```
```bash
git remote add origin https://github.com/USERNAME/snack-stand.git
```
```bash
git push -u origin main
```

Then follow step 4 above to turn on Pages. For later updates: `git add .`, `git commit -m "update"`, `git push`.

## Add it to the home screen

Use **Safari** for this.

### iPhone

1. Open Safari and go to `https://USERNAME.github.io/snack-stand/`.
2. Tap the **Share** button (the square with an arrow pointing up, at the bottom of the screen).
3. Scroll down and tap **Add to Home Screen**, then **Add**.
4. Close Safari and open the popcorn icon on your home screen. It opens full screen with no address bar.

### iPad

1. Open Safari and go to the same address.
2. Tap the **Share** button (top right, next to the address bar).
3. Tap **Add to Home Screen**, then **Add**.

Open the app once while online so it finishes caching; after that it works with no connection. Always launch it from the home screen icon rather than a Safari tab: iOS keeps home-screen apps' data, while ordinary Safari sites can have their storage cleared after a week of not being used.

## Your prices travel with the website (`prices.csv`)

`prices.csv` sits next to `index.html` and is uploaded with everything else. It holds the Sip n Snack menu: items, recipes, pack sizes, Costco Davie warehouse prices read from costco.com on 2026-10-16 where the item is listed online, your own numbers where it isn't (bread, buns, relish, onions, water, Jamaican patties), and the selling prices you chose. The "Price source" column says which is which.

On any device: Menu → Pricing → **Import spreadsheet** → **Load prices.csv from this website** → Import. That gives a fresh iPhone or iPad the whole menu in one tap. To change prices for every device, edit `prices.csv` (Excel, Numbers or Google Sheets, save as CSV), upload it to GitHub again, and tap the same button on each device. To refresh Costco numbers, ask Claude to re-check, or tap "Look up at Costco" on an ingredient and type in what you see.

## Backups

- **Backup → Export data (JSON)** saves everything, photos included. On iPhone/iPad the share sheet opens; choose **Save to Files** (or AirDrop / Mail it to yourself). On a PC it downloads.
- **Backup → Import data…** restores a JSON file. It replaces what's on the device, after a confirmation. Backups from the first version of the app import fine; their items show "No cost set" and their sales show "Amount paid not recorded".
- **Backup → Export today's sales (CSV)** gives one row per item sold with unit price, line gross, unit cost, line cost, line net, sale totals, amount paid and change.

Export a backup at the end of each day you use the stand. Deleting the app from the home screen deletes its data.

## Notes for the curious

- All prices are stored and added up in whole cents, so $1.10 × 3 is exactly $3.30.
- A cost from a pack is `round(pack price ÷ units per pack)` to the nearest cent, e.g. $12.99 ÷ 24 = $0.54.
- A recipe cost adds up `package price ÷ portions × amount used` for each ingredient (kept exact, e.g. 37.5¢ for a tablespoon of butter) plus any other per-item cost, then rounds once to the nearest cent.
- A suggested price is `cost ÷ (1 − profit %)` rounded **up** to the chosen step: $1.13 at 60% → $2.83 → $3.00 in 25¢ steps, where you keep $1.87 (62%).
- Photos are centre-cropped to a square, shrunk to 512 px and saved as JPEG inside IndexedDB.
- Removing a menu item only hides it (`active: false`); it stays in the backup file.
- The service worker serves the app from its cache first and refreshes the cache in the background. On `localhost` it does the reverse (network first) so your edits show up immediately while developing.
