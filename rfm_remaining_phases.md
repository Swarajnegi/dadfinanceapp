# RFM — Remaining Phases Implementation Handoff

> **Purpose**: Paste this entire document into a new chat to resume development. It contains full architectural context and detailed plans for every remaining phase.

---

## 1. PROJECT IDENTITY

| Field | Value |
|---|---|
| App Name | RFM (Rajender Finance Manager) |
| Repo | `e:\J.A.R.V.I.S\dadfinanceapp` |
| Target User | Senior citizen father (60+), conservative portfolio (FDs, Bonds, Govt schemes, MFs) |
| Platform | Android APK (Capacitor 8) + Browser preview |
| Data Model | 100% offline — `localStorage` key `rfm_v1`, JSON blob |

---

## 2. TECH STACK (Do Not Change)

| Layer | Technology |
|---|---|
| **UI Framework** | Alpine.js 3.13 (`x-data="appData"` single root) |
| **CSS** | Tailwind CSS via CDN (`cdn.tailwindcss.com`) with custom Material 3 dark theme tokens |
| **Design Language** | Stitch 3D Dark Elevation (navy glassmorphism `#051424` → `#122131`, mint primary `#44e5c2`, gold accent `#d4af37`) |
| **Charts** | Chart.js 4.4 (CDN) |
| **PDF Parsing** | `pdfjs-dist` 6.1 bundled into `parser.js` |
| **Native Bridge** | Capacitor 8 plugins bundled via esbuild into `web/plugins.js` |
| **Build** | `npm run build` → esbuild bundles `src/capacitor-bridge.js` → `web/plugins.js` |
| **Android** | `npx cap sync android` then `cd android && gradlew.bat assembleDebug` (JDK 21 at `android/jdk21/jdk-21.0.3+9`) |
| **Fonts** | Inter (body), Outfit (headlines/currency), Material Symbols Outlined |

---

## 3. FILE MAP

```
dadfinanceapp/
├── web/                          ← THE WEB APP (Capacitor webDir)
│   ├── index.html                ← 672 lines — Stitch 3D Dark UI, all screens
│   ├── app.js                    ← 1592 lines — Alpine.js appData component (ALL state + logic)
│   ├── parser.js                 ← Phase 5 PDF statement parser
│   ├── regenWealth.js            ← Gemini API integration for portfolio analysis
│   ├── plugins.js                ← Capacitor plugin bundle (esbuild output, do NOT edit)
│   └── styles.css                ← Minimal global styles + x-cloak
├── src/
│   └── capacitor-bridge.js       ← Source for plugins.js bundle
├── android/                      ← Capacitor Android project
│   ├── jdk21/jdk-21.0.3+9/      ← Bundled JDK for Gradle
│   └── app/build/outputs/apk/debug/app-debug.apk
├── capacitor.config.json         ← { appId: "com.rajendernegi.rfm", webDir: "web" }
├── package.json                  ← Dependencies and build script
└── scripts/                      ← Migration scripts (historical, not needed for new phases)
```

---

## 4. CURRENT STATE MODEL (`app.js` appData properties)

```javascript
// UI
activePage: 'home'  // 'home' | 'investments' | 'import' | 'tax'

// Data stores (all persisted to localStorage rfm_v1)
investments: []     // { id, name, type, issuer, amount, rate, payout, rating, maturityDate, ticker, units, buyPrice, currentPrice }
pension: { monthlyAmount: 56000, type: 'Government', revisions: [] }
cashflow: { project, otherIncome, housing, food, medical, otherExpense }
networth: { bank, cash, property, otherAsset, homeLoan, personalLoan, credit, otherDebt }
emergency: { efMonthly, efMonths, efCurrent }
tax: { otherIncome, deduction80C, deduction80D, deduction80TTA, deduction80TTB, hra, homeLoanInterest, otherDeductions, regime, seniorCitizen }
goals: []           // { id, name, type, target, current, targetDate }
sips: []            // { id, name, type, monthlyAmount, dayOfMonth, startDate, endDate, status, linkedInvestmentId, ticker }
```

### Key Computed Properties Already Implemented
- `totalInvested`, `monthlyInvestmentIncome`, `netWorthTotal`
- `totalMonthlySipOutflow`, `activeSipCount`
- `totalInterestIncome`, `totalTds`, `netTaxPayable`
- `getAssetTotal(type)` — filter investments by type and sum amounts
- `formatCurrency(n)` — Indian ₹ formatting with lakhs/crores
- `formatDate(d)` — human-readable date formatting

### Key Actions Already Implemented
- `addInvestment()`, `saveEdit()`, `cancelEdit()`, `openEditModal(inv)`, `deleteInvestment(id)`
- `addSip()`, `deleteSip(id)`
- `backupData()`, `restoreData(event)`
- `processStatement()`, `handleFileUpload(event)`
- `loadData()`, `saveData()` — localStorage persistence

---

## 5. COMPLETED PHASES

| Phase | What It Does | Key Files |
|---|---|---|
| 1 | Core engine: investments, net worth, cash flow, pension, emergency fund, goals | `app.js` L1–500 |
| 2 | Pension single-source-of-truth (`pension.monthlyAmount` drives cash flow) | `app.js` L494–498 |
| 3 | Senior citizen tax engine (Old vs New 2024-25 regime) + ITR Checklist | `app.js` L500–735 |
| 4 | Capacitor 8 mobile: Android build, biometrics, status bar | `app.js` L138–197, `src/capacitor-bridge.js` |
| 5 | PDF parser for CAMS/KFintech CAS + ICICI/SBI/HDFC bank statements (Blob URL Worker) | `parser.js`, `app.js` |
| 6 | Capital Gains (LTCG / STCG) Tax Calculator (FY 2024-25 12.5% LTCG / 20% STCG) | `app.js`, `index.html` |
| 7 | JSON backup export & restore | `app.js` L1477–1525 |
| 8 | Dynamic equity valuation engine (P&L helpers) | `app.js` L353–381 |
| 9 | SIP, RD & recurring cash flow auto-scheduler | `app.js` L54–84, L320–351 |
| 10a | Stitch 3D Dark theme for Dashboard, Investments, Import, Tax screens | `index.html` |
| 10b | Stitch 3D Dark theme for More Hub, Cash Flow, Net Worth, Pension, Emergency, Goals, Maturity | `index.html` |
| Feature | Regenerative Wealth Engine (Live RSS News + Gemini 2.0 Flash AI Rebalancing) | `regenWealth.js`, `index.html` |

---

## 6. REMAINING PHASES — DETAILED PLANS

---

### PHASE 11: Live NAV & Stock Price Ingestion

**Scope**: Fetch real-time Indian Mutual Fund NAVs from the AMFI API and stock prices from a free source, then auto-update `currentPrice` on investments.

#### API Sources
1. **Mutual Fund NAVs (Free, no API key)**: `https://api.mfapi.in/mf/{schemeCode}`
2. **Stock Prices**: `https://priceapi.moneycontrol.com/pricefeed/nse/equitycash/{symbol}`

---

### PHASE 12: Native Maturity & SIP Payment Local Notifications

**Scope**: Use `@capacitor/local-notifications` to schedule native Android push notifications for upcoming FD/Bond maturities (7 days prior) and monthly SIP payment reminders (1 day prior).

---

### PHASE 13: Universal AI Statement Classifier (Gemini 2.0 Flash)

**Scope**: Integrate Gemini 2.0 Flash for zero-shot transaction classification across Bank Statements, Credit Card statements, Insurance Policies, and Broker P&L statements.

#### Tax Rules to Implement

| Gain Type | Holding Period | Tax Rate | Exemption |
|---|---|---|---|
| **Equity LTCG** | > 12 months | 12.5% | ₹1.25 lakh/year tax-free |
| **Equity STCG** | ≤ 12 months | 20% | None |
| **Debt LTCG** (FD/Bonds) | > 36 months | At slab rate | Indexation benefit removed from FY24-25 |
| **Debt STCG** | ≤ 36 months | At slab rate | None |

#### Data Model Changes (`app.js`)

Add to each investment object (already partially present from Phase 8):
```javascript
// Extend investment schema
{
  ...existingFields,
  purchaseDate: '',      // NEW — date of purchase (needed for holding period calc)
  buyPrice: '',          // EXISTS — purchase price per unit
  currentPrice: '',      // EXISTS — current market price per unit
  units: '',             // EXISTS — number of units
  assetClass: 'equity'   // NEW — 'equity' | 'debt' | 'gold' | 'realestate'
}
```

Add to `tax` store:
```javascript
tax: {
  ...existingFields,
  capitalGainsOverride: null  // Allow manual override if auto-calc is wrong
}
```

#### New Computed Properties to Add (`app.js`)

```javascript
// After the existing tax computed properties section (~L735):

get equityLTCG() {
  // Filter investments where type is Stock/Mutual Fund, holding > 12 months
  // Sum: (currentPrice - buyPrice) * units for each
  // Apply ₹1.25L annual exemption
},

get equitySTCG() {
  // Same filter but holding ≤ 12 months
  // Tax at 20%
},

get debtCapitalGains() {
  // For FD/Bond types, calculate gains at slab rate
},

get totalCapitalGainsTax() {
  // equityLTCG tax + equitySTCG tax + debt gains at slab
}
```

#### UI Changes (`index.html`)

In the **Tax Summary** `<main x-show="activePage === 'tax'">` section (after the existing 3 cards at ~L407):

Add a new card block:
```html
<!-- Card 4: Capital Gains -->
<div class="bg-gradient-to-br from-[#23354a] to-[#1a2838] rounded-xl relative overflow-hidden ...">
  <div class="absolute left-0 top-0 bottom-0 w-2 bg-[#FF6B6B]"></div>
  <div class="p-6 pl-8">
    <span class="font-label-caps text-label-caps text-on-surface-variant">Capital Gains Tax</span>
    <div class="font-display-currency-mobile text-on-surface" x-text="formatCurrency(totalCapitalGainsTax)"></div>
    <div class="mt-3 space-y-1 text-xs text-on-surface-variant">
      <p>Equity LTCG (12.5%): <span x-text="formatCurrency(equityLTCG)" class="text-white"></span></p>
      <p>Equity STCG (20%): <span x-text="formatCurrency(equitySTCG)" class="text-white"></span></p>
    </div>
  </div>
</div>
```

Also update `netTaxPayable` computed to include `totalCapitalGainsTax`.

#### Verification
- Add a test investment: Stock, bought 2 years ago at ₹100, now ₹200, 100 units → LTCG = ₹10,000 (₹10K is under ₹1.25L exemption → tax = ₹0)
- Add a stock held 3 months → STCG at 20%
- Confirm Tax Summary card shows correct breakdown

---

### PHASE 10b: Stitch 3D Dark Theme for Secondary Screens

**Scope**: The current `index.html` only has 4 screens with the Stitch 3D elevation design (Dashboard, Investments, Import, Tax). The remaining screens exist in the old `index_old.html` / `index_new.html` with a light `bg-slate-50` theme. Port them to the Stitch 3D Dark design system.

#### Screens to Port (6 total)

Each screen must be added as a new `<main x-show="activePage === 'xxx'" x-cloak>` block in `index.html`, and the bottom nav / desktop top nav must be updated with new tabs.

1. **Cash Flow** (`activePage === 'cashflow'`)
   - Monthly income breakdown (pension.monthlyAmount, cashflow.project, cashflow.otherIncome, SIP outflows)
   - Monthly expense breakdown (housing, food, medical, otherExpense)
   - Net monthly surplus/deficit with color indicator
   - Use the existing computed properties: pension.monthlyAmount, totalMonthlySipOutflow, etc.

2. **Net Worth** (`activePage === 'networth'`)
   - Assets section (bank, cash, property, otherAsset + totalInvested)
   - Liabilities section (homeLoan, personalLoan, credit, otherDebt)
   - Net worth = total assets − total liabilities (use existing `netWorthTotal`)
   - Editable fields using dark input styling

3. **My Pension** (`activePage === 'pension'`)
   - Hero card showing `pension.monthlyAmount` in display currency
   - Pension type badge
   - Revision history list (pension.revisions array)
   - Use existing `addPensionRevision()` and `removePensionRevision()` actions

4. **Emergency Fund** (`activePage === 'emergency'`)
   - Gauge/progress showing `emergency.efCurrent` vs target (`efMonthly × efMonths`)
   - Use existing computed: `emergencyFundProgress`, `emergencyFundTarget`

5. **My Goals** (`activePage === 'goals'`)
   - Goal cards with progress bars
   - Add/Edit goal modals (use existing `addGoal()`, `saveGoalEdit()`, `cancelGoalEdit()`)

6. **Maturity Calendar** (`activePage === 'maturity'`)
   - List investments sorted by `maturityDate` ascending
   - Color-code: red = maturing within 30 days, yellow = within 90 days, green = 90+ days

#### Design Rules (Stitch 3D System)
- Background: `bg-[#051424]`
- Cards: `bg-gradient-to-br from-[#1c2b3c] to-[#0d1b2a]` or `from-[#23354a] to-[#1a2838]`
- Border: `border border-white/5`
- Shadow: `shadow-[0_12px_24px_rgba(0,0,0,0.5),0_4px_12px_rgba(0,0,0,0.2)]`
- Hover lift: `hover:-translate-y-2 transition-transform`
- Inputs: `bg-surface-container-lowest border border-white/10 text-white`
- Labels: `font-label-caps text-label-caps text-on-surface-variant`
- Headlines: `font-headline-md text-headline-md-mobile text-on-surface`
- Currency: `font-display-currency-mobile text-display-currency-mobile text-on-background`

#### Navigation Update
Add new tabs to both bottom nav and desktop top nav. Consider a "More" menu approach since 4+ tabs in the bottom bar gets crowded. One option: keep 4 primary tabs (Dashboard, Investments, Import, Tax) and add a hamburger/drawer for secondary screens.

#### Verification
- Each screen renders correctly in both mobile and desktop widths
- All data bindings show live values (not hardcoded)
- Navigation between all screens works seamlessly

---

### PHASE 11: Live NAV & Stock Price Ingestion

**Scope**: Fetch real-time Indian Mutual Fund NAVs from the AMFI API and stock prices from a free source, then auto-update `currentPrice` on investments.

#### API Sources

1. **Mutual Fund NAVs (Free, no API key)**
   - URL: `https://api.mfapi.in/mf/{schemeCode}`
   - Returns: `{ meta: { scheme_name, ... }, data: [{ date, nav }] }`
   - Need a scheme code lookup: `https://api.mfapi.in/mf/search?q={fund_name}`

2. **Stock Prices (Free, no API key)**
   - Option A: Google Finance scraping (fragile)
   - Option B: `https://priceapi.moneycontrol.com/pricefeed/nse/equitycash/{symbol}` (may have CORS issues)
   - Option C: Use a proxy or pre-fetched JSON approach
   - **Recommendation**: Start with AMFI MF NAVs only (reliable, free, no CORS). Stocks can be Phase 11b.

#### Data Model Changes

Add to investment schema:
```javascript
{
  ...existingFields,
  schemeCode: '',      // AMFI scheme code for mutual funds
  lastNavUpdate: '',   // ISO timestamp of last NAV fetch
}
```

Add app-level state:
```javascript
navFetchState: 'idle',  // 'idle' | 'fetching' | 'done' | 'error'
navFetchError: '',
lastNavFetchTime: null
```

#### New Actions (`app.js`)

```javascript
async fetchAllNavs() {
  // 1. Filter investments where type === 'Mutual Fund' && schemeCode exists
  // 2. For each, fetch https://api.mfapi.in/mf/{schemeCode}
  // 3. Update inv.currentPrice = latest NAV from response.data[0].nav
  // 4. Update inv.lastNavUpdate = new Date().toISOString()
  // 5. Rate-limit: 500ms between requests to avoid hammering the API
},

async searchMfScheme(query) {
  // Fetch https://api.mfapi.in/mf/search?q={query}
  // Return list of { schemeCode, schemeName } for user to pick
}
```

#### UI Changes

1. **Investments page**: Add a "↻ Refresh NAVs" button next to the Holdings header
2. **Add Investment modal**: When type is "Mutual Fund", show a scheme code search field
3. **Investment cards**: Show `lastNavUpdate` as small timestamp

#### CORS Handling
- On Android (Capacitor native), there's no CORS restriction
- In browser preview, AMFI API *does* support CORS, so it should work
- If CORS blocks, use `@capacitor/http` plugin for native HTTP

#### Verification
- Add a Mutual Fund with scheme code (e.g., `119551` for Parag Parikh Flexi Cap)
- Click "Refresh NAVs"
- Verify `currentPrice` updates to latest NAV value
- Verify portfolio valuation recalculates

---

### PHASE 12: Native Maturity & SIP Payment Alerts

**Scope**: Use `@capacitor/local-notifications` (already installed in package.json) to schedule native Android push notifications for upcoming FD/Bond maturities and monthly SIP payment reminders.

#### Notification Types

| Type | Trigger | Message |
|---|---|---|
| **Maturity Alert** | 7 days before `investment.maturityDate` | "₹{amount} {name} matures on {date}. Plan reinvestment." |
| **SIP Reminder** | 1 day before `sip.dayOfMonth` each month | "SIP: ₹{monthlyAmount} for {name} debits tomorrow." |

#### Implementation (`app.js`)

```javascript
async scheduleMaturityAlerts() {
  const { LocalNotifications } = window.AppPlugins;
  
  // 1. Request notification permission
  await LocalNotifications.requestPermissions();
  
  // 2. Cancel all existing scheduled notifications (clean slate)
  const pending = await LocalNotifications.getPending();
  if (pending.notifications.length > 0) {
    await LocalNotifications.cancel({ notifications: pending.notifications });
  }
  
  // 3. Schedule maturity alerts
  const alerts = [];
  this.investments.forEach((inv, i) => {
    if (!inv.maturityDate) return;
    const matDate = new Date(inv.maturityDate);
    const alertDate = new Date(matDate);
    alertDate.setDate(alertDate.getDate() - 7); // 7 days before
    
    if (alertDate > new Date()) { // Only future dates
      alerts.push({
        id: 10000 + i,
        title: 'Maturity Alert',
        body: `₹${this.formatCurrency(inv.amount)} ${inv.name} matures on ${this.formatDate(inv.maturityDate)}. Plan reinvestment.`,
        schedule: { at: alertDate },
        sound: 'default',
        smallIcon: 'ic_stat_notification'
      });
    }
  });
  
  // 4. Schedule SIP reminders (next 12 months)
  this.sips.filter(s => s.status === 'Active').forEach((sip, i) => {
    for (let month = 0; month < 12; month++) {
      const reminderDate = new Date();
      reminderDate.setMonth(reminderDate.getMonth() + month);
      reminderDate.setDate(sip.dayOfMonth - 1); // 1 day before
      reminderDate.setHours(9, 0, 0); // 9 AM
      
      if (reminderDate > new Date()) {
        alerts.push({
          id: 20000 + (i * 100) + month,
          title: 'SIP Reminder',
          body: `₹${this.formatCurrency(sip.monthlyAmount)} for ${sip.name} debits tomorrow.`,
          schedule: { at: reminderDate },
          sound: 'default'
        });
      }
    }
  });
  
  if (alerts.length > 0) {
    await LocalNotifications.schedule({ notifications: alerts });
  }
}
```

#### Trigger Points
- Call `scheduleMaturityAlerts()` inside `init()` after `loadData()`
- Call it again whenever investments or sips arrays are modified (inside `saveData()`)

#### UI Changes
- Add a "🔔 Alerts" toggle/status in the Dashboard or Settings
- Show count of scheduled alerts

#### Android Configuration
- The `@capacitor/local-notifications` plugin is already installed
- Need notification icon: create `android/app/src/main/res/drawable/ic_stat_notification.png` (24x24 white-on-transparent)
- No additional Gradle changes needed

#### Verification
- Add an investment with maturity date 8 days from now
- Check Android notification tray after a few seconds (test with immediate schedule first)
- Verify SIP reminders appear in `LocalNotifications.getPending()` list

---

## 7. BUILD & DEPLOY COMMANDS

```bash
# Browser preview (just open index.html or use a local server)
cd e:\J.A.R.V.I.S\dadfinanceapp
python -m http.server 8000 --directory web

# Sync web → Android
npx cap sync android

# Build Android APK (uses bundled JDK 21)
cmd /c "set JAVA_HOME=e:\J.A.R.V.I.S\dadfinanceapp\android\jdk21\jdk-21.0.3+9&& set PATH=e:\J.A.R.V.I.S\dadfinanceapp\android\jdk21\jdk-21.0.3+9\bin;%PATH%&& cd android && gradlew.bat assembleDebug"

# APK output location
android\app\build\outputs\apk\debug\app-debug.apk

# Rebuild plugins.js after editing src/capacitor-bridge.js
npm run build
```

---

## 8. CRITICAL GOTCHAS

> [!WARNING]
> 1. **Single Alpine component** — Everything lives in ONE `Alpine.data('appData', ...)` call. Do NOT create separate components.
> 2. **Tailwind via CDN** — Config is inline in `<script id="tailwind-config">` inside `index.html`. Do NOT install Tailwind as a build step.
> 3. **No bundler for app code** — `app.js`, `parser.js`, `regenWealth.js` are raw ES5/ES6 scripts loaded via `<script defer>`. Only `plugins.js` is bundled.
> 4. **plugins.js is generated** — Never edit `web/plugins.js` directly. Edit `src/capacitor-bridge.js` and run `npm run build`.
> 5. **x-cloak** — Every `<main>` section that isn't the default page MUST have `x-cloak` to prevent flash of unstyled content.
> 6. **Stitch design tokens** — Use the Tailwind color names (`primary`, `surface-container`, `on-surface`, etc.) defined in the config, NOT raw hex. Exception: accent gold `#d4af37` is not in the token system.
> 7. **localStorage only** — No server, no database, no network calls (except Phase 11 NAV fetching). All data in `localStorage.getItem('rfm_v1')`.
