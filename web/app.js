document.addEventListener('alpine:init', () => {
    Alpine.data('appData', () => ({

        // ── UI State ────────────────────────────────────────────────
        activePage: 'home',
        showNotifications: false,

        // ── Data Stores ─────────────────────────────────────────────
        investments: [],

        // Pension is the single source of truth for pension income
        // (Engineering Principle #008: No Data Duplication)
        pension: {
            monthlyAmount: 56000,
            type: 'Government', // Government | Corporate | Military | Other
            revisions: []       // { date, previousAmount, note }
        },

        cashflow: {
            // NOTE: cashflow.pension is REMOVED. Income now flows from pension.monthlyAmount
            project: 0,
            otherIncome: 0,
            housing: 0,
            food: 0,
            medical: 0,
            otherExpense: 0
        },

        networth: {
            bank: 0, cash: 0, property: 0, otherAsset: 0,
            homeLoan: 0, personalLoan: 0, credit: 0, otherDebt: 0
        },

        emergency: {
            efMonthly: 50000, efMonths: 12, efCurrent: 0
        },

        // ── Tax Data Store (Phase 3) ─────────────────────────────
        tax: {
            // Inputs
            otherIncome:      0,    // Interest, rent, consulting, etc.
            deduction80C:     0,    // LIC, PPF, ELSS, NSC, home loan principal (max ₹1.5L)
            deduction80D:     0,    // Medical insurance premium (max ₹50K senior)
            deduction80TTA:   0,    // Savings account interest (max ₹10K, not for seniors)
            deduction80TTB:   0,    // Bank/PO/FD interest for seniors (max ₹50K)
            hra:              0,    // House Rent Allowance exemption
            homeLoanInterest: 0,    // Section 24 interest deduction (max ₹2L)
            otherDeductions:  0,    // Any other eligible deductions
            regime:          'compare', // 'old' | 'new' | 'compare'
            seniorCitizen:    true   // Age 60+ — different slabs & deductions apply
        },

        goals: [],

        // ── SIP & Recurring Investments (Phase 9) ───────────────────
        sips: [],
        addingSip: false,
        editingSip: null,
        editSipForm: {},

        // ── Investment Edit State (Deliverable 1) ───────────────────
        editingInv: null,
        editForm: {},
        addingInv: false,
        moreMenuOpen: false,

        // ── Goal Edit State (Deliverable 3) ─────────────────────────
        editingGoal: null,
        editGoalForm: {},

        // ── Add Forms ───────────────────────────────────────────────
        newInv: {
            name: '', type: 'Stock', issuer: '', amount: '',
            rate: '', payout: 'Monthly', rating: '', maturityDate: '',
            ticker: '', units: '', buyPrice: '', currentPrice: ''
        },
        newGoal: {
            name: '', type: 'Emergency Fund',
            target: '', current: '', targetDate: ''
        },
        newSip: {
            name: '', type: 'SIP', monthlyAmount: '',
            dayOfMonth: 5, startDate: '', endDate: '',
            status: 'Active', linkedInvestmentId: null, ticker: ''
        },

        // ── Internal chart instances (not reactive state) ────────────
        _allocationChart: null,
        _ratingChart: null,

        // ── Import State (Phase 5) ───────────────────────────────────
        importState: 'idle',
        importFile: null,
        importPassword: '',
        pdfPassword: '',
        importError: '',
        importResults: null,
        importSelections: {},
        importDuplicateMode: 'skip',
        importStats: null,

        // ── Regenerative Wealth State ────────────────────────────────
        regenWealth: {
            apiKey:       '',
            apiKeySet:    false,
            showKeyInput: false,
            loading:      false,
            progressMsg:  '',
            error:        '',
            analysis:     null   // The cached/live analysis result object
        },

        // ════════════════════════════════════════════════════════════
        //  LIFECYCLE
        // ════════════════════════════════════════════════════════════
        init() {
            this.loadData();
            this.initCapacitor();
            this.$watch('investments',  () => this.saveData(), { deep: true });
            this.$watch('cashflow',     () => this.saveData(), { deep: true });
            this.$watch('networth',     () => this.saveData(), { deep: true });
            this.$watch('emergency',    () => this.saveData(), { deep: true });
            this.$watch('tax',          () => this.saveData(), { deep: true });
            this.$watch('goals',        () => this.saveData(), { deep: true });
            this.$watch('pension',      () => this.saveData(), { deep: true });
            // ITR checklist state (UI-only, not persisted)
            this.itrCheckState = {};

            // ── Regenerative Wealth: restore API key and load cached analysis ──
            const savedKey = localStorage.getItem('rfm_gemini_key');
            if (savedKey) {
                this.regenWealth.apiKey    = savedKey;
                this.regenWealth.apiKeySet = true;
            }
            const cached = window.RegenWealth?.loadCached();
            if (cached) this.regenWealth.analysis = cached;
        },

        async initCapacitor() {
            const isNative = window.AppPlugins && window.AppPlugins.Capacitor.isNativePlatform();
            if (!isNative) return;

            const { App, NativeBiometric, SplashScreen, StatusBar, Style } = window.AppPlugins;

            // Hide Splash Screen once Alpine is mounted and UI is ready
            try { await SplashScreen.hide(); } catch (e) {}

            // Match status bar to our dark background color
            try { 
                await StatusBar.setStyle({ style: Style.Dark });
                await StatusBar.setBackgroundColor({ color: '#051424' });
            } catch (e) {}

            let isPrompting = false;
            let isAuthenticated = false;

            const enforceBiometric = async () => {
                if (isPrompting || isAuthenticated) return;
                isPrompting = true;

                try {
                    const result = await NativeBiometric.isAvailable();
                    if (result.isAvailable) {
                        await NativeBiometric.verifyIdentity({
                            reason: "Authenticate to access RFM",
                            title: "RFM Secure Login",
                            subtitle: "Confirm your fingerprint or face ID",
                            description: "Touch the sensor to continue",
                            negativeButtonText: "Cancel"
                        });
                        isAuthenticated = true;
                    }
                } catch (e) {
                    console.error("Biometric authentication error:", e);
                    isPrompting = false;
                    isAuthenticated = false;
                    
                    // Delay slightly before retrying to allow system UI to settle
                    setTimeout(() => {
                        enforceBiometric();
                    }, 500);
                    return;
                }
                isPrompting = false;
            };

            // Lock on cold start
            await enforceBiometric();

            // Lock on resume when returning from background
            App.addListener('appStateChange', ({ isActive }) => {
                if (this.isSelectingFile) {
                    if (isActive) {
                        setTimeout(() => { this.isSelectingFile = false; }, 2000);
                    }
                    return;
                }
                if (!isActive) {
                    isAuthenticated = false;
                } else if (isActive && !isAuthenticated && !isPrompting) {
                    enforceBiometric();
                }
            });
        },

        // ════════════════════════════════════════════════════════════
        //  DATA PERSISTENCE
        // ════════════════════════════════════════════════════════════
        loadData() {
            // ── Load V1 format ──
            let saved = localStorage.getItem('rfm_v1');
            if (saved) {
                const p = JSON.parse(saved);
                this.investments = p.investments || [];
                this.goals       = p.goals       || [];
                this.sips        = p.sips        || [];

                // Pension: migrate old cashflow.pension if pension module not yet saved
                if (p.pension) {
                    this.pension = { ...this.pension, ...p.pension };
                } else if (p.cashflow && p.cashflow.pension) {
                    this.pension.monthlyAmount = Number(p.cashflow.pension) || 56000;
                }

                // Cashflow: drop old .pension key if it exists
                if (p.cashflow) {
                    const { pension: _removed, ...rest } = p.cashflow;
                    this.cashflow = { ...this.cashflow, ...rest };
                }

                this.networth  = { ...this.networth,  ...(p.networth  || {}) };
                this.emergency = { ...this.emergency, ...(p.emergency  || {}) };

                if (p.tax) {
                    // Migrate old keys: taxOther → otherIncome, taxDeduction → deduction80C
                    const { taxIncome: _ti, taxOther, taxDeduction, ...taxRest } = p.tax;
                    this.tax = {
                        ...this.tax,
                        ...taxRest,
                        // Map legacy fields to new names if new keys not present
                        otherIncome:    taxRest.otherIncome    ?? (taxOther    || 0),
                        deduction80C:   taxRest.deduction80C   ?? (taxDeduction || 0),
                    };
                }
                return;
            }

            // ── Fallback: Migrate MVP 0.3 (rfm03) data ──
            let legacy = localStorage.getItem('rfm03');
            if (legacy) {
                try {
                    const p = JSON.parse(legacy);
                    this.investments = p.i || [];
                    this.pension.monthlyAmount = Number(p.pension) || 56000;
                    this.cashflow = {
                        project:      Number(p.project)      || 0,
                        otherIncome:  Number(p.otherIncome)  || 0,
                        housing:      Number(p.housing)      || 0,
                        food:         Number(p.food)         || 0,
                        medical:      Number(p.medical)      || 0,
                        otherExpense: Number(p.otherExpense) || 0
                    };
                    this.networth = {
                        bank:         Number(p.bank)         || 0,
                        cash:         Number(p.cash)         || 0,
                        property:     Number(p.property)     || 0,
                        otherAsset:   Number(p.otherAsset)   || 0,
                        homeLoan:     Number(p.homeLoan)     || 0,
                        personalLoan: Number(p.personalLoan) || 0,
                        credit:       Number(p.credit)       || 0,
                        otherDebt:    Number(p.otherDebt)    || 0
                    };
                    this.emergency = {
                        efMonthly: Number(p.efMonthly) || 50000,
                        efMonths:  Number(p.efMonths)  || 12,
                        efCurrent: Number(p.efCurrent) || 0
                    };
                    this.tax = {
                        taxOther:     Number(p.taxOther)     || 0,
                        taxDeduction: Number(p.taxDeduction) || 0
                    };
                    this.saveData();
                } catch (e) {
                    console.error('Migration from rfm03 failed', e);
                }
            }
        },

        saveData() {
            localStorage.setItem('rfm_v1', JSON.stringify({
                version:     '2.0',
                investments: this.investments,
                pension:     this.pension,
                cashflow:    this.cashflow,
                networth:    this.networth,
                emergency:   this.emergency,
                tax:         this.tax,
                goals:       this.goals,
                sips:        this.sips
            }));
        },

        // ════════════════════════════════════════════════════════════
        //  COMPUTED PROPERTIES — CASH FLOW
        // ════════════════════════════════════════════════════════════

        // Single source of truth: pension.monthlyAmount feeds totalIncome
        get totalIncome() {
            return Number(this.pension.monthlyAmount)
                 + Number(this.cashflow.project)
                 + Number(this.cashflow.otherIncome);
        },
        get totalExpense() {
            return Number(this.cashflow.housing)
                 + Number(this.cashflow.food)
                 + Number(this.cashflow.medical)
                 + Number(this.cashflow.otherExpense)
                 + this.totalMonthlySipOutflow;  // Phase 9: SIP outflows are real expenses
        },
        get monthlySurplus() { return this.totalIncome - this.totalExpense; },
        get savingsRate() {
            if (this.totalIncome <= 0) return 0;
            return ((this.monthlySurplus / this.totalIncome) * 100).toFixed(1);
        },

        // ════════════════════════════════════════════════════════════
        //  COMPUTED PROPERTIES — SIP & RECURRING (Phase 9)
        // ════════════════════════════════════════════════════════════
        get activeSips() {
            return this.sips.filter(s => s.status === 'Active');
        },
        get totalMonthlySipOutflow() {
            return this.activeSips.reduce((sum, s) => sum + Number(s.monthlyAmount || 0), 0);
        },
        get activeSipCount() {
            return this.activeSips.length;
        },
        get totalSipInvestedToDate() {
            return this.sips.reduce((sum, s) => {
                if (!s.startDate) return sum;
                const start  = new Date(s.startDate);
                const end    = s.endDate ? new Date(s.endDate) : new Date();
                const months = Math.max(0, (end.getFullYear() - start.getFullYear()) * 12
                             + (end.getMonth() - start.getMonth()) + 1);
                return sum + (Number(s.monthlyAmount || 0) * months);
            }, 0);
        },
        get upcomingSipDebits() {
            const today = new Date().getDate();
            return this.activeSips
                .slice()
                .sort((a, b) => {
                    const da = Number(a.dayOfMonth) >= today ? Number(a.dayOfMonth) : Number(a.dayOfMonth) + 31;
                    const db = Number(b.dayOfMonth) >= today ? Number(b.dayOfMonth) : Number(b.dayOfMonth) + 31;
                    return da - db;
                });
        },

        // ════════════════════════════════════════════════════════════
        //  VALUATION & P&L HELPERS (Phase 8: Dynamic Equity Engine)
        // ════════════════════════════════════════════════════════════
        getInvCurrentValue(inv) {
            const units = Number(inv.units) || 0;
            const currentPrice = Number(inv.currentPrice) || Number(inv.nav) || Number(inv.buyPrice) || 0;
            if (units > 0 && currentPrice > 0) {
                return units * currentPrice;
            }
            return Number(inv.currentValue) || Number(inv.amount) || 0;
        },

        getInvInvestedCost(inv) {
            const units = Number(inv.units) || 0;
            const buyPrice = Number(inv.buyPrice) || Number(inv.nav) || 0;
            if (units > 0 && buyPrice > 0) {
                return units * buyPrice;
            }
            return Number(inv.amount) || 0;
        },

        getInvPnL(inv) {
            return this.getInvCurrentValue(inv) - this.getInvInvestedCost(inv);
        },

        getInvPnLPct(inv) {
            const cost = this.getInvInvestedCost(inv);
            if (cost <= 0) return '0.00';
            return ((this.getInvPnL(inv) / cost) * 100).toFixed(2);
        },

        // ════════════════════════════════════════════════════════════
        //  COMPUTED PROPERTIES — NET WORTH
        // ════════════════════════════════════════════════════════════
        get totalAssets() {
            const invTotal = this.investments.reduce((s, i) => s + this.getInvCurrentValue(i), 0);
            return Number(this.networth.bank)
                 + Number(this.networth.cash)
                 + Number(this.networth.property)
                 + Number(this.networth.otherAsset)
                 + invTotal;
        },
        get totalLiabilities() {
            return Number(this.networth.homeLoan)
                 + Number(this.networth.personalLoan)
                 + Number(this.networth.credit)
                 + Number(this.networth.otherDebt);
        },
        get netWorthTotal()  { return this.totalAssets - this.totalLiabilities; },
        get debtRatio() {
            if (this.totalAssets <= 0) return 0;
            return ((this.totalLiabilities / this.totalAssets) * 100).toFixed(1);
        },

        getAssetTotal(type) {
            return this.investments
                .filter(i => i.type === type)
                .reduce((sum, i) => sum + this.getInvCurrentValue(i), 0);
        },

        get totalInvestedCost() {
            return this.investments.reduce((s, i) => s + this.getInvInvestedCost(i), 0);
        },

        get totalUnrealizedPnL() {
            return this.investments.reduce((s, i) => s + this.getInvPnL(i), 0);
        },

        get totalUnrealizedPnLPct() {
            const cost = this.totalInvestedCost;
            if (cost <= 0) return '0.00';
            return ((this.totalUnrealizedPnL / cost) * 100).toFixed(2);
        },

        // ════════════════════════════════════════════════════════════
        //  COMPUTED PROPERTIES — INVESTMENTS
        // ════════════════════════════════════════════════════════════
        get monthlyInvestmentIncome() {
            return this.investments.reduce((sum, inv) => {
                if (inv.payout === 'Cumulative') return sum;
                const yearly = Number(inv.amount) * (Number(inv.rate) / 100);
                return sum + (yearly / 12);
            }, 0);
        },

        // ── Portfolio Analysis (Deliverable 2) ──────────────────────
        get assetAllocation() {
            const groups = {};
            this.investments.forEach(inv => {
                const t = inv.type || 'Other';
                groups[t] = (groups[t] || 0) + Number(inv.amount);
            });
            return groups;
        },

        get ratingDistribution() {
            const groups = {};
            this.investments.forEach(inv => {
                const r = inv.rating || 'Not Rated';
                groups[r] = (groups[r] || 0) + Number(inv.amount);
            });
            return groups;
        },

        get weightedAvgReturn() {
            const total = this.investments.reduce((s, i) => s + Number(i.amount), 0);
            if (total === 0) return '0.00';
            const wSum = this.investments.reduce(
                (s, i) => s + Number(i.amount) * Number(i.rate), 0);
            return (wSum / total).toFixed(2);
        },

        get concentrationWarnings() {
            const total = this.investments.reduce((s, i) => s + Number(i.amount), 0);
            if (total === 0) return [];
            const byIssuer = {};
            this.investments.forEach(inv => {
                const key = inv.issuer || inv.name;
                byIssuer[key] = (byIssuer[key] || 0) + Number(inv.amount);
            });
            return Object.entries(byIssuer)
                .filter(([, amt]) => (amt / total) > 0.5)
                .map(([name, amt]) => ({
                    name,
                    pct: ((amt / total) * 100).toFixed(0)
                }));
        },

        get totalInvested() {
            return this.investments.reduce((s, i) => s + Number(i.amount), 0);
        },

        // ════════════════════════════════════════════════════════════
        //  COMPUTED PROPERTIES — EMERGENCY FUND
        // ════════════════════════════════════════════════════════════
        get efRequired() { return Number(this.emergency.efMonthly) * Number(this.emergency.efMonths); },
        get efGap()      { return Math.max(0, this.efRequired - Number(this.emergency.efCurrent)); },
        get efProgress() {
            if (this.efRequired <= 0) return 100;
            return Math.min(100, (Number(this.emergency.efCurrent) / this.efRequired) * 100).toFixed(0);
        },

        // ════════════════════════════════════════════════════════════
        //  COMPUTED PROPERTIES — PENSION
        // ════════════════════════════════════════════════════════════
        get annualPension() { return Number(this.pension.monthlyAmount) * 12; },

        // ════════════════════════════════════════════════════════════
        //  COMPUTED PROPERTIES — TAX ENGINE (Phase 3)
        // ════════════════════════════════════════════════════════════

        // Annual interest income derived from investments (monthly non-cumulative income × 12)
        get annualInterestIncome() {
            return this.investments.reduce((sum, inv) => {
                if (inv.payout === 'Cumulative') return sum;
                return sum + (Number(inv.amount) * (Number(inv.rate) / 100));
            }, 0);
        },

        // Total gross annual income for tax purposes
        get grossAnnualIncome() {
            return this.annualPension
                 + this.annualInterestIncome
                 + Number(this.tax.otherIncome);
        },

        get totalInterestIncome() { return this.annualInterestIncome; },
        get totalTds() { return 0; }, // Placeholder for actual TDS
        get netTaxPayable() {
            const tax = Math.min(this.oldRegimeTax.tax, this.newRegimeTax.tax);
            return Math.max(0, tax - this.totalTds);
        },

        // ── OLD REGIME CALCULATION ───────────────────────────────────
        // Old Regime: Standard deduction ₹50K for pension, then all applicable deductions.
        // Senior Citizen (60–79): No tax up to ₹3L, 5% on 3L-5L, 20% on 5L-10L, 30% above 10L
        // Super Senior Citizen (80+): No tax up to ₹5L
        get oldRegimeTax() {
            const gross = this.grossAnnualIncome;
            // Standard deduction: ₹50,000 for pension income
            const stdDeduction = Math.min(50000, gross);
            // Section 80C
            const ded80C  = Math.min(Number(this.tax.deduction80C),  150000);
            // Section 80D — Senior citizen premium limit ₹50K, self + parents max ₹1L
            const ded80D  = Math.min(Number(this.tax.deduction80D),  50000);
            // Section 80TTB (seniors) — interest income deduction up to ₹50K
            const ded80TTB = Math.min(Number(this.tax.deduction80TTB), 50000);
            // Section 24 — Home loan interest (max ₹2L)
            const dedHomeLoan = Math.min(Number(this.tax.homeLoanInterest), 200000);
            // HRA
            const dedHRA  = Number(this.tax.hra);
            // Other
            const dedOther = Number(this.tax.otherDeductions);

            const totalDeductions = stdDeduction + ded80C + ded80D + ded80TTB + dedHomeLoan + dedHRA + dedOther;
            const taxableIncome   = Math.max(0, gross - totalDeductions);

            // Senior Citizen slabs (FY 2024-25 / AY 2025-26)
            let tax = 0;
            if (taxableIncome <= 300000) {
                tax = 0;
            } else if (taxableIncome <= 500000) {
                tax = (taxableIncome - 300000) * 0.05;
            } else if (taxableIncome <= 1000000) {
                tax = 10000 + (taxableIncome - 500000) * 0.20;
            } else {
                tax = 110000 + (taxableIncome - 1000000) * 0.30;
            }

            // Rebate u/s 87A (max ₹12,500 if taxable income ≤ ₹5L) — NOT available for seniors above 60 if income > 5L
            // For seniors: 87A rebate applies if taxable ≤ 5L
            if (taxableIncome <= 500000) tax = 0;

            // Surcharge: 10% if income > 50L, 15% if > 1Cr
            let surcharge = 0;
            if (taxableIncome > 10000000) surcharge = tax * 0.15;
            else if (taxableIncome > 5000000) surcharge = tax * 0.10;

            const taxAfterSurcharge = tax + surcharge;
            // Health & Education Cess: 4%
            const cess = taxAfterSurcharge * 0.04;
            const totalTax = taxAfterSurcharge + cess;

            return {
                gross,
                totalDeductions,
                taxableIncome,
                tax: Math.round(totalTax),
                breakdown: {
                    stdDeduction, ded80C, ded80D, ded80TTB,
                    dedHomeLoan, dedHRA, dedOther, surcharge: Math.round(surcharge), cess: Math.round(cess)
                }
            };
        },

        // ── NEW REGIME CALCULATION ───────────────────────────────────
        // New Regime (FY 2024-25): Standard deduction ₹75K. No other deductions.
        // Slabs: 0-3L: 0%, 3-7L: 5%, 7-10L: 10%, 10-12L: 15%, 12-15L: 20%, >15L: 30%
        // Rebate u/s 87A: If income ≤ ₹7L, full rebate (no tax)
        get newRegimeTax() {
            const gross = this.grossAnnualIncome;
            const stdDeduction = Math.min(75000, gross); // New regime standard deduction
            const taxableIncome = Math.max(0, gross - stdDeduction);

            let tax = 0;
            if (taxableIncome <= 300000) {
                tax = 0;
            } else if (taxableIncome <= 700000) {
                tax = (taxableIncome - 300000) * 0.05;
            } else if (taxableIncome <= 1000000) {
                tax = 20000 + (taxableIncome - 700000) * 0.10;
            } else if (taxableIncome <= 1200000) {
                tax = 50000 + (taxableIncome - 1000000) * 0.15;
            } else if (taxableIncome <= 1500000) {
                tax = 80000 + (taxableIncome - 1200000) * 0.20;
            } else {
                tax = 140000 + (taxableIncome - 1500000) * 0.30;
            }

            // Rebate: If taxable income ≤ ₹7L, no tax
            if (taxableIncome <= 700000) tax = 0;

            // Marginal relief if taxable is slightly above ₹7L
            if (taxableIncome > 700000 && tax > (taxableIncome - 700000)) {
                tax = taxableIncome - 700000;
            }

            // Surcharge
            let surcharge = 0;
            if (taxableIncome > 10000000) surcharge = tax * 0.15;
            else if (taxableIncome > 5000000) surcharge = tax * 0.10;

            const taxAfterSurcharge = tax + surcharge;
            const cess = taxAfterSurcharge * 0.04;
            const totalTax = taxAfterSurcharge + cess;

            return {
                gross,
                stdDeduction,
                taxableIncome,
                tax: Math.round(totalTax),
                breakdown: { surcharge: Math.round(surcharge), cess: Math.round(cess) }
            };
        },

        // Best regime (lower tax wins)
        get recommendedRegime() {
            const oldTax = this.oldRegimeTax.tax;
            const newTax = this.newRegimeTax.tax;
            if (oldTax === newTax) return 'equal';
            return oldTax < newTax ? 'old' : 'new';
        },

        get taxSavingByOptimalRegime() {
            return Math.abs(this.oldRegimeTax.tax - this.newRegimeTax.tax);
        },

        // ── ADVANCE TAX SCHEDULE ─────────────────────────────────────
        // Advance tax is only required if total tax liability > ₹10,000
        // Pension earners (TDS on pension by bank) are usually exempt,
        // but for self-assessment income they may need to pay.
        get advanceTaxSchedule() {
            const annualTax = Math.min(this.oldRegimeTax.tax, this.newRegimeTax.tax);
            if (annualTax <= 10000) return null; // Below threshold — no advance tax needed

            const year  = new Date().getFullYear();
            const nextFY = new Date().getMonth() >= 3 ? year : year - 1; // FY starts April

            return [
                { due: `15 Jun ${nextFY}`,   pct: 15, amount: Math.round(annualTax * 0.15) },
                { due: `15 Sep ${nextFY}`,   pct: 45, amount: Math.round(annualTax * 0.45) },
                { due: `15 Dec ${nextFY}`,   pct: 75, amount: Math.round(annualTax * 0.75) },
                { due: `15 Mar ${nextFY + 1}`, pct: 100, amount: annualTax }
            ];
        },

        // ── ITR FORM SELECTOR ────────────────────────────────────────
        get itrFormRecommendation() {
            const hasCapGains     = false; // Phase 6+ — broker integration
            const hasForeignAssets = false; // Phase 6+ — INDstocks
            const hasBusiness     = Number(this.cashflow.project) > 0;
            const income          = this.grossAnnualIncome;

            if (hasForeignAssets) return 'ITR-2';
            if (hasCapGains)      return 'ITR-2';
            if (hasBusiness)      return 'ITR-3';
            // ITR-1 (Sahaj): Salary/Pension + one house property + other sources ≤ ₹50L total
            if (income <= 5000000) return 'ITR-1';
            return 'ITR-2';
        },

        get itrDeadline() {
            const year = new Date().getFullYear();
            // Standard deadline: 31 July of assessment year
            return `31 July ${new Date().getMonth() >= 3 ? year + 1 : year}`;
        },

        // ── ITR CHECKLIST ITEMS ──────────────────────────────────────
        get itrChecklist() {
            const items = [
                // Always required
                { cat: 'Identity & Bank', done: false, doc: 'PAN Card', note: 'Required for all ITR forms' },
                { cat: 'Identity & Bank', done: false, doc: 'Aadhaar Number', note: 'Linked to PAN for e-verification' },
                { cat: 'Identity & Bank', done: false, doc: 'Bank Account Details (IFSC, Account No.)', note: 'For refund credit' },
                // Income docs
                { cat: 'Income Documents', done: false, doc: 'Form 16 / Pension Certificate', note: `Annual pension: ${this.formatCurrency(this.annualPension)}` },
                { cat: 'Income Documents', done: false, doc: 'Bank Interest Certificates (Form 16A)', note: 'From all banks where FDs or savings accounts exist' },
                { cat: 'Income Documents', done: false, doc: 'Annual Information Statement (AIS)', note: 'Download from Income Tax portal — cross-check all entries' },
                { cat: 'Income Documents', done: false, doc: 'Form 26AS', note: 'Tax credit statement — must match your filing' },
            ];

            // Conditional items
            if (this.tax.deduction80C > 0)
                items.push({ cat: 'Deduction Proofs', done: false, doc: '80C Proof (LIC/PPF/NSC/ELSS receipts)', note: `Claimed: ${this.formatCurrency(this.tax.deduction80C)}` });
            if (this.tax.deduction80D > 0)
                items.push({ cat: 'Deduction Proofs', done: false, doc: '80D Medical Insurance Premium Receipt', note: `Claimed: ${this.formatCurrency(this.tax.deduction80D)}` });
            if (this.tax.deduction80TTB > 0)
                items.push({ cat: 'Deduction Proofs', done: false, doc: '80TTB Interest Income Statement (Senior)', note: `Claimed: ${this.formatCurrency(this.tax.deduction80TTB)}` });
            if (this.tax.homeLoanInterest > 0)
                items.push({ cat: 'Deduction Proofs', done: false, doc: 'Home Loan Interest Certificate (Sec 24)', note: `Claimed: ${this.formatCurrency(this.tax.homeLoanInterest)}` });
            if (Number(this.cashflow.project) > 0)
                items.push({ cat: 'Income Documents', done: false, doc: 'Consulting/Project Income Records', note: 'Invoice copies, payment receipts' });

            // Investment-related
            if (this.investments.length > 0)
                items.push({ cat: 'Investments', done: false, doc: 'Bond/FD Maturity & Interest Statements', note: `${this.investments.length} holdings — collect from each issuer` });

            // Filing
            items.push({ cat: 'Filing', done: false, doc: `File ${this.itrFormRecommendation} on Income Tax Portal`, note: `Due: ${this.itrDeadline}` });
            items.push({ cat: 'Filing', done: false, doc: 'E-verify ITR (within 30 days)', note: 'Via Aadhaar OTP, Net Banking, or DSC' });

            return items;
        },

        // Group ITR checklist by category
        get itrChecklistGrouped() {
            const groups = {};
            this.itrChecklist.forEach(item => {
                if (!groups[item.cat]) groups[item.cat] = [];
                groups[item.cat].push(item);
            });
            return Object.entries(groups).map(([cat, items]) => ({ cat, items }));
        },

        // ════════════════════════════════════════════════════════════
        //  COMPUTED PROPERTIES — GOALS (Deliverable 3)
        // ════════════════════════════════════════════════════════════
        get goalsProgress() {
            return this.goals.map(g => {
                const target  = Number(g.target)  || 0;
                const current = Number(g.current) || 0;
                const pct     = target > 0 ? Math.min(100, (current / target) * 100).toFixed(0) : 0;
                const gap     = Math.max(0, target - current);

                let monthlyNeeded = 0;
                if (g.targetDate && current < target) {
                    const now   = new Date();
                    const end   = new Date(g.targetDate);
                    const months = Math.max(1,
                        (end.getFullYear() - now.getFullYear()) * 12 +
                        (end.getMonth()    - now.getMonth()));
                    monthlyNeeded = Math.ceil(gap / months);
                }

                return { ...g, pct: Number(pct), gap, monthlyNeeded };
            });
        },

        get nextGoalMilestone() {
            const active = this.goalsProgress.filter(g => g.pct < 100);
            if (active.length === 0) return null;
            return active.sort((a, b) => b.pct - a.pct)[0];
        },

        // ════════════════════════════════════════════════════════════
        //  COMPUTED PROPERTIES — FINANCIAL HEALTH SCORE (Phase 3 upgrade)
        //  5 Dimensions: Savings, Emergency, Diversification, Liquidity, Concentration
        // ════════════════════════════════════════════════════════════

        // Dim 1 — Savings Rate (0–30 pts)
        get scoreD1Savings() {
            if (this.totalIncome <= 0) return 0;
            const sr = (this.monthlySurplus / this.totalIncome) * 100;
            if (sr >= 30) return 30;
            if (sr >= 20) return 22;
            if (sr >= 10) return 14;
            if (sr >   0) return 7;
            return 0;
        },

        // Dim 2 — Emergency Fund (0–25 pts)
        get scoreD2Emergency() {
            const monthsCovered = this.emergency.efMonthly > 0
                ? Number(this.emergency.efCurrent) / Number(this.emergency.efMonthly)
                : 0;
            if (monthsCovered >= 12) return 25;
            if (monthsCovered >= 6)  return 20;
            if (monthsCovered >= 3)  return 12;
            if (monthsCovered >= 1)  return 5;
            return 0;
        },

        // Dim 3 — Diversification (0–20 pts)
        get scoreD3Diversification() {
            const types   = new Set(this.investments.map(i => i.type)).size;
            const issuers = new Set(this.investments.map(i => i.issuer || i.name)).size;
            let pts = 0;
            if (types >= 4)   pts += 10; else if (types >= 2) pts += 5;
            if (issuers >= 5) pts += 10; else if (issuers >= 3) pts += 5;
            return pts;
        },

        // Dim 4 — Liquidity (0–15 pts)
        // % of total assets in liquid form (bank + cash vs. locked in FD/bonds)
        get scoreD4Liquidity() {
            const liquid = Number(this.networth.bank) + Number(this.networth.cash);
            const total  = this.totalAssets;
            if (total <= 0) return 0;
            const pct = (liquid / total) * 100;
            if (pct >= 20) return 15;
            if (pct >= 10) return 10;
            if (pct >= 5)  return 5;
            return 0;
        },

        // Dim 5 — Concentration Risk (0–10 pts)
        get scoreD5Concentration() {
            if (this.investments.length === 0) return 0;
            return this.concentrationWarnings.length === 0 ? 10 : 2;
        },

        get financialHealthScore() {
            return Math.min(100, Math.max(0,
                this.scoreD1Savings +
                this.scoreD2Emergency +
                this.scoreD3Diversification +
                this.scoreD4Liquidity +
                this.scoreD5Concentration
            ));
        },

        get healthLabel() {
            const s = this.financialHealthScore;
            if (s >= 80) return 'Excellent';
            if (s >= 60) return 'Good';
            if (s >= 40) return 'Fair';
            return 'Needs Attention';
        },

        // ── Formatters & Notifications ─────────────────────────────────
        formatCurrency(amount) {
            const val = Number(amount) || 0;
            return new Intl.NumberFormat('en-IN', {
                style: 'currency',
                currency: 'INR',
                maximumFractionDigits: 0
            }).format(val);
        },

        formatDate(dateStr) {
            if (!dateStr) return 'N/A';
            try {
                const d = new Date(dateStr);
                if (isNaN(d.getTime())) return dateStr;
                return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
            } catch (e) {
                return dateStr;
            }
        },

        get notificationsList() {
            const list = [];
            const today = new Date();

            // 1. Maturing Investments (within 90 days)
            (this.investments || []).forEach(inv => {
                if (inv.maturityDate) {
                    const mDate = new Date(inv.maturityDate);
                    const diffDays = Math.ceil((mDate - today) / (1000 * 60 * 60 * 24));
                    if (diffDays >= 0 && diffDays <= 90) {
                        list.push({
                            id: 'mat_' + inv.id,
                            type: 'warning',
                            icon: 'calendar_clock',
                            title: `${inv.name} Maturing Soon`,
                            detail: `Matures in ${diffDays} days (${this.formatDate(inv.maturityDate)}) — Value: ${this.formatCurrency(this.getInvCurrentValue(inv))}`,
                            actionPage: 'investments'
                        });
                    } else if (diffDays < 0) {
                        list.push({
                            id: 'mat_exp_' + inv.id,
                            type: 'alert',
                            icon: 'history',
                            title: `${inv.name} Has Matured`,
                            detail: `Matured on ${this.formatDate(inv.maturityDate)}. Consider reinvesting.`,
                            actionPage: 'investments'
                        });
                    }
                }
            });

            // 2. Concentration Risk Warnings
            (this.concentrationWarnings || []).forEach((w, idx) => {
                list.push({
                    id: 'conc_' + idx,
                    type: 'alert',
                    icon: 'warning',
                    title: 'High Concentration Risk',
                    detail: `${w.name} accounts for ${w.pct}% of your total portfolio. Consider diversifying.`,
                    actionPage: 'investments'
                });
            });

            // 3. Upcoming SIP Debits (Next 7 days)
            const currentDay = today.getDate();
            (this.activeSips || []).forEach(sip => {
                const debitDay = Number(sip.dayOfMonth) || 5;
                let daysUntil = debitDay - currentDay;
                if (daysUntil < 0) daysUntil += 30;
                if (daysUntil <= 7) {
                    list.push({
                        id: 'sip_' + sip.id,
                        type: 'info',
                        icon: 'event_repeat',
                        title: `SIP Debit Approaching: ${sip.name}`,
                        detail: `₹${sip.monthlyAmount} will be debited on the ${debitDay}th of the month.`,
                        actionPage: 'investments'
                    });
                }
            });

            // 4. Emergency Fund Gap Alert
            if (this.efGap > 0) {
                list.push({
                    id: 'ef_gap',
                    type: 'info',
                    icon: 'shield_locked',
                    title: 'Emergency Fund Below Target',
                    detail: `Gap of ${this.formatCurrency(this.efGap)} to reach ${this.emergency.efMonths} months safety buffer.`,
                    actionPage: 'home'
                });
            }

            // Default System Welcome Notification if list is empty
            if (list.length === 0) {
                list.push({
                    id: 'welcome',
                    type: 'success',
                    icon: 'check_circle',
                    title: 'All Systems Optimal',
                    detail: 'No urgent portfolio actions or upcoming maturity alerts at this time.',
                    actionPage: 'home'
                });
            }

            return list;
        },

        get healthStrengths() {
            const s = [];
            if (this.monthlySurplus > 0) s.push('Positive monthly cash flow');
            if (this.emergency.efCurrent >= this.emergency.efMonthly * 6) s.push('6-month emergency fund funded');
            else if (this.emergency.efCurrent >= this.emergency.efMonthly * 3) s.push('3-month emergency buffer exists');
            if (this.investments.length > 0) s.push('Active investment portfolio');
            if (this.concentrationWarnings.length === 0 && this.investments.length > 1) s.push('Diversified portfolio');
            return s;
        },

        get healthImprovements() {
            const i = [];
            if (this.emergency.efCurrent < this.emergency.efMonthly * 6)
                i.push('Increase emergency fund to 6 months');
            if (this.concentrationWarnings.length > 0)
                i.push('Reduce concentration risk — one issuer holds majority of portfolio');
            if (Number(this.savingsRate) < 20)
                i.push('Aim for a 20% savings rate');
            return i;
        },

        // ════════════════════════════════════════════════════════════
        //  ACTIONS — INVESTMENTS (Deliverable 1 & Phase 8)
        // ════════════════════════════════════════════════════════════
        refreshingLivePrices: false,
        livePriceMsg: '',

        addInvestment() {
            if (!this.newInv.name) return;
            const isEquity = ['Stock', 'Equity', 'Mutual Fund', 'ETF'].includes(this.newInv.type);
            const units = Number(this.newInv.units) || 0;
            const buyPrice = Number(this.newInv.buyPrice) || 0;
            const currentPrice = Number(this.newInv.currentPrice) || buyPrice || 0;
            
            let amount = Number(this.newInv.amount) || 0;
            if (isEquity && units > 0 && (currentPrice > 0 || buyPrice > 0)) {
                amount = units * (currentPrice || buyPrice);
            }

            this.investments.push({
                ...this.newInv,
                id:           Date.now(),
                amount:       amount,
                units:        units,
                buyPrice:     buyPrice,
                currentPrice: currentPrice || buyPrice,
                currentValue: amount,
                rate:         Number(this.newInv.rate) || 0
            });
            this.newInv = {
                name: '', type: 'Stock', issuer: '', amount: '',
                rate: '', payout: 'Monthly', rating: '', maturityDate: '',
                ticker: '', units: '', buyPrice: '', currentPrice: ''
            };
        },

        deleteInvestment(id) {
            if (confirm('Are you sure you want to delete this investment?')) {
                this.investments = this.investments.filter(i => i.id !== id);
            }
        },

        openEditModal(inv) {
            this.editForm    = { ...inv };
            this.editingInv  = inv;
        },

        saveEdit() {
            const idx = this.investments.findIndex(i => i.id === this.editForm.id);
            if (idx !== -1) {
                const isEquity = ['Stock', 'Equity', 'Mutual Fund', 'ETF'].includes(this.editForm.type);
                const units = Number(this.editForm.units) || 0;
                const buyPrice = Number(this.editForm.buyPrice) || 0;
                const currentPrice = Number(this.editForm.currentPrice) || buyPrice || 0;
                
                let amount = Number(this.editForm.amount) || 0;
                if (isEquity && units > 0 && (currentPrice > 0 || buyPrice > 0)) {
                    amount = units * (currentPrice || buyPrice);
                }

                this.editForm.amount       = amount;
                this.editForm.units        = units;
                this.editForm.buyPrice     = buyPrice;
                this.editForm.currentPrice = currentPrice || buyPrice;
                this.editForm.currentValue = amount;
                this.editForm.rate         = Number(this.editForm.rate) || 0;

                this.investments[idx] = { ...this.editForm };
                this.investments = [...this.investments];
            }
            this.editingInv = null;
        },

        async fetchLivePrices() {
            if (this.investments.length === 0) return;
            this.refreshingLivePrices = true;
            this.livePriceMsg = 'Fetching live prices...';
            let updatedCount = 0;

            for (let inv of this.investments) {
                const isEquity = ['Stock', 'Equity', 'Mutual Fund', 'ETF'].includes(inv.type);
                if (!isEquity && !inv.ticker && !inv.isin) continue;

                try {
                    const newPrice = await this.fetchSingleLivePrice(inv);
                    if (newPrice && newPrice > 0) {
                        inv.currentPrice = newPrice;
                        inv.nav          = newPrice;
                        inv.lastUpdated  = new Date().toISOString();
                        if (inv.units > 0) {
                            inv.currentValue = inv.units * newPrice;
                            inv.amount       = inv.currentValue;
                        }
                        updatedCount++;
                    }
                } catch (e) {
                    console.warn(`Failed to update live price for ${inv.name}:`, e);
                }
            }

            this.investments = [...this.investments];
            this.refreshingLivePrices = false;
            this.livePriceMsg = updatedCount > 0 ? `Updated ${updatedCount} asset prices!` : 'No prices found to update.';
            setTimeout(() => { this.livePriceMsg = ''; }, 4000);
        },

        async fetchSingleLivePrice(inv) {
            const ticker = (inv.ticker || '').trim();
            const isin   = (inv.isin || '').trim();

            // 1. Mutual Funds via AMFI API (api.mfapi.in)
            if (inv.type === 'Mutual Fund' || /^\d{6}$/.test(ticker)) {
                let schemeCode = ticker;
                if (!/^\d{6}$/.test(schemeCode)) {
                    const searchRes = await fetch(`https://api.mfapi.in/mf/search?q=${encodeURIComponent(inv.name)}`);
                    if (searchRes.ok) {
                        const list = await searchRes.json();
                        if (list && list.length > 0) schemeCode = list[0].schemeCode;
                    }
                }
                if (schemeCode && /^\d{6}$/.test(schemeCode)) {
                    const res = await fetch(`https://api.mfapi.in/mf/${schemeCode}`);
                    if (res.ok) {
                        const data = await res.json();
                        if (data && data.data && data.data.length > 0) {
                            return parseFloat(data.data[0].nav);
                        }
                    }
                }
            }

            // 2. Stocks / ETFs via Yahoo Finance (using allorigins / corsproxy)
            if (ticker) {
                let symbol = ticker.toUpperCase();
                if (!symbol.includes('.') && inv.type !== 'US Stock') {
                    symbol += '.NS';
                }

                const targetUrl = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d`;
                const proxyUrl  = `https://api.allorigins.win/raw?url=${encodeURIComponent(targetUrl)}`;

                const res = await fetch(proxyUrl);
                if (res.ok) {
                    const data = await res.json();
                    const meta = data?.chart?.result?.[0]?.meta;
                    if (meta && meta.regularMarketPrice) {
                        return parseFloat(meta.regularMarketPrice);
                    }
                }
            }

            return null;
        },

        cancelEdit() { this.editingInv = null; },

        getMonthlyEquivalent(inv) {
            if (inv.payout === 'Cumulative') return 'Reinvested';
            const yearly = Number(inv.amount) * (Number(inv.rate) / 100);
            return this.formatCurrency(yearly / 12);
        },

        // ════════════════════════════════════════════════════════════
        //  ACTIONS — PORTFOLIO CHARTS (Deliverable 2)
        // ════════════════════════════════════════════════════════════
        renderPortfolioCharts() {
            // Defer to next tick so x-show has revealed the canvas elements
            this.$nextTick(() => {
                // ── Allocation Doughnut ──
                if (this._allocationChart) this._allocationChart.destroy();
                const allocCtx = document.getElementById('allocationChart');
                const alloc    = this.assetAllocation;
                if (allocCtx && Object.keys(alloc).length > 0) {
                    this._allocationChart = new Chart(allocCtx, {
                        type: 'doughnut',
                        data: {
                            labels:   Object.keys(alloc),
                            datasets: [{
                                data:            Object.values(alloc),
                                backgroundColor: [
                                    '#00c9a7','#38debb','#5ffbd6',
                                    '#d4af37','#f3d87f','#b8c8de'
                                ],
                                borderWidth: 2,
                                borderColor: '#122131'
                            }]
                        },
                        options: {
                            responsive: true,
                            cutout: '65%',
                            plugins: {
                                legend: { position: 'bottom', labels: { color: '#bacac3', padding: 16, font: { size: 13 } } },
                                tooltip: {
                                    callbacks: {
                                        label: ctx => {
                                            const val = ctx.raw;
                                            return ` ₹${Number(val).toLocaleString('en-IN')}`;
                                        }
                                    }
                                }
                            }
                        }
                    });
                }

                // ── Rating Bar ──
                if (this._ratingChart) this._ratingChart.destroy();
                const ratingCtx = document.getElementById('ratingChart');
                const ratings   = this.ratingDistribution;
                if (ratingCtx && Object.keys(ratings).length > 0) {
                    this._ratingChart = new Chart(ratingCtx, {
                        type: 'bar',
                        data: {
                            labels:   Object.keys(ratings),
                            datasets: [{
                                label:           'Amount (₹)',
                                data:            Object.values(ratings),
                                backgroundColor: '#00c9a7',
                                borderRadius:    6
                            }]
                        },
                        options: {
                            responsive: true,
                            indexAxis:  'y',
                            plugins:    { legend: { display: false } },
                            scales: {
                                x: {
                                    ticks: {
                                        color: '#bacac3',
                                        callback: v => '₹' + Number(v).toLocaleString('en-IN', { maximumFractionDigits: 0 })
                                    },
                                    grid: { color: 'rgba(255,255,255,0.05)' }
                                },
                                y: {
                                    ticks: { color: '#bacac3' },
                                    grid: { color: 'rgba(255,255,255,0.05)' }
                                }
                            }
                        }
                    });
                }
            });
        },

        // ════════════════════════════════════════════════════════════
        //  ACTIONS — GOALS (Deliverable 3)
        // ════════════════════════════════════════════════════════════
        addGoal() {
            if (!this.newGoal.name || !this.newGoal.target) return;
            this.goals.push({
                ...this.newGoal,
                id:      Date.now(),
                target:  Number(this.newGoal.target),
                current: Number(this.newGoal.current) || 0
            });
            this.newGoal = { name: '', type: 'Emergency Fund', target: '', current: '', targetDate: '' };
        },

        deleteGoal(id) {
            if (confirm('Delete this goal?')) {
                this.goals = this.goals.filter(g => g.id !== id);
            }
        },

        openGoalEdit(goal) {
            this.editGoalForm = { ...goal };
            this.editingGoal  = goal;
        },

        saveGoalEdit() {
            const idx = this.goals.findIndex(g => g.id === this.editGoalForm.id);
            if (idx !== -1) {
                this.editGoalForm.target  = Number(this.editGoalForm.target);
                this.editGoalForm.current = Number(this.editGoalForm.current);
                this.goals[idx] = { ...this.editGoalForm };
                this.goals = [...this.goals];
            }
            this.editingGoal = null;
        },

        cancelGoalEdit() { this.editingGoal = null; },

        goalTypeEmoji(type) {
            const map = {
                'Emergency Fund': '🛡️', 'Retirement': '🏖️', 'New Car': '🚗',
                'House': '🏠', 'Education': '📚', 'Travel': '✈️', 'Custom': '🎯'
            };
            return map[type] || '🎯';
        },

        // ════════════════════════════════════════════════════════════
        //  ACTIONS — PENSION (Deliverable 4)
        // ════════════════════════════════════════════════════════════
        updatePension(newAmount) {
            const prev = Number(this.pension.monthlyAmount);
            const next = Number(newAmount);
            if (prev === next) return;
            // Log revision before applying change
            this.pension.revisions.push({
                date:            new Date().toISOString().slice(0, 10),
                previousAmount:  prev,
                note:            'Manual update'
            });
            this.pension.monthlyAmount = next;
        },

        deletePensionRevision(idx) {
            if (confirm('Delete this revision record?')) {
                this.pension.revisions.splice(idx, 1);
            }
        },

        get maturingInvestments() {
            return (this.investments || [])
                .filter(inv => inv.maturityDate)
                .map(inv => {
                    const today = new Date();
                    const mDate = new Date(inv.maturityDate);
                    const daysLeft = Math.ceil((mDate - today) / (1000 * 60 * 60 * 24));
                    let status = 'normal';
                    if (daysLeft < 0) status = 'expired';
                    else if (daysLeft <= 30) status = 'urgent';
                    else if (daysLeft <= 90) status = 'soon';
                    return { ...inv, daysLeft, status };
                })
                .sort((a, b) => new Date(a.maturityDate) - new Date(b.maturityDate));
        },

        // ── used by the pension input field (two-way without full update overhead)
        pensionInput: null, // tracks the draft input value

        // ════════════════════════════════════════════════════════════
        //  ACTIONS — IMPORT (Phase 5)
        // ════════════════════════════════════════════════════════════
        isSelectingFile: false,

        handleFileUpload(event) {
            this.isSelectingFile = false;
            this.handleImportFile(event);
        },

        get pdfPassword() { return this.importPassword; },
        set pdfPassword(val) { this.importPassword = val; },

        async processStatement() {
            return this.parseStatement();
        },

        handleImportFile(event) {
            this.isSelectingFile = false;
            const file = event.target.files?.[0];
            if (file && file.type === 'application/pdf') {
                this.importFile = file;
                this.importError = '';
                this.importResults = null;
                this.importStats = null;
                this.importState = 'idle';
            }
        },

        handleImportDrop(event) {
            const file = event.dataTransfer.files[0];
            if (file && file.type === 'application/pdf') {
                this.importFile = file;
                this.importError = '';
                this.importResults = null;
                this.importStats = null;
                this.importState = 'idle';
            } else {
                this.importError = 'Please drop a PDF file.';
            }
        },

        async parseStatement() {
            if (!this.importFile) return;

            this.importState = 'loading';
            this.importError = '';
            this.importResults = null;
            this.importStats = null;

            try {
                const text = await this.extractPdfText(this.importFile, this.importPassword);

                if (!text || text.trim().length < 50) {
                    this.importError = 'Could not extract text from this PDF. It may be image-based or corrupted. Please use the original PDF from your email.';
                    this.importState = 'error';
                    return;
                }

                // Use the parser engine
                const result = window.RFMParser.parseStatement(text);

                if (result.type === 'UNKNOWN') {
                    this.importError = result.error;
                    this.importState = 'error';
                    return;
                }

                if (result.investments.length === 0) {
                    this.importError = 'Statement was recognized as ' + result.type.replace('_', ' ') + ' but no holdings could be extracted. The PDF format may have changed.';
                    this.importState = 'error';
                    return;
                }

                this.importResults = result;
                // Select all by default
                this.importSelections = {};
                result.investments.forEach((_, idx) => {
                    this.importSelections[idx] = true;
                });
                this.importState = 'parsed';

            } catch (err) {
                console.error('Parse error:', err);
                if (err.name === 'PasswordException' || (err.message && err.message.includes('password'))) {
                    this.importError = 'Incorrect password. CAS files are usually encrypted with your PAN number (e.g., ABCDE1234F).';
                } else {
                    this.importError = 'Failed to parse PDF: ' + (err.message || 'Unknown error');
                }
                this.importState = 'error';
            }
        },

        async extractPdfText(file, password) {
            const pdfjsLib = window.pdfjsLib;
            if (!pdfjsLib) {
                throw new Error('PDF library not loaded. Please reload the app.');
            }

            if (pdfjsLib.GlobalWorkerOptions && !pdfjsLib.GlobalWorkerOptions.workerSrc) {
                pdfjsLib.GlobalWorkerOptions.workerSrc = 'pdf.worker.min.mjs';
            }

            const arrayBuffer = await file.arrayBuffer();
            const loadingConfig = { data: arrayBuffer };
            if (password) loadingConfig.password = password;

            const pdf = await pdfjsLib.getDocument(loadingConfig).promise;

            let fullText = '';
            for (let i = 1; i <= pdf.numPages; i++) {
                const page = await pdf.getPage(i);
                const content = await page.getTextContent();
                const pageText = content.items.map(item => item.str).join(' ');
                fullText += pageText + '\n';
            }

            return fullText;
        },

        findDuplicate(newItem) {
            // 1. Match by ISIN (strongest signal)
            if (newItem.isin) {
                const match = this.investments.find(inv => inv.isin === newItem.isin);
                if (match) return match;
            }
            // 2. Fuzzy match by name + type
            const newName = (newItem.name || '').toLowerCase().trim();
            if (newName.length > 3) {
                return this.investments.find(inv => {
                    const existName = (inv.name || '').toLowerCase().trim();
                    return existName === newName && inv.type === newItem.type;
                });
            }
            return null;
        },

        toggleAllImports(checked) {
            if (!this.importResults) return;
            this.importResults.investments.forEach((_, idx) => {
                this.importSelections[idx] = checked;
            });
        },

        countSelectedImports() {
            if (!this.importResults) return 0;
            return this.importResults.investments.filter((_, idx) =>
                this.importSelections[idx] !== false
            ).length;
        },

        countDuplicateImports() {
            if (!this.importResults) return 0;
            return this.importResults.investments.filter(inv =>
                this.findDuplicate(inv)
            ).length;
        },

        importSelected() {
            if (!this.importResults) return;

            let imported = 0;
            let duplicates = 0;
            let skipped = 0;

            this.importResults.investments.forEach((inv, idx) => {
                // Skip unselected
                if (this.importSelections[idx] === false) {
                    skipped++;
                    return;
                }

                const existing = this.findDuplicate(inv);

                if (existing) {
                    if (this.importDuplicateMode === 'skip') {
                        duplicates++;
                        return;
                    }
                    // Overwrite: update amount/units/nav but preserve manual edits
                    const existIdx = this.investments.findIndex(i => i.id === existing.id);
                    if (existIdx !== -1) {
                        this.investments[existIdx] = {
                            ...this.investments[existIdx],
                            amount:       inv.amount,
                            units:        inv.units,
                            nav:          inv.nav,
                            currentValue: inv.currentValue,
                            isin:         inv.isin || this.investments[existIdx].isin,
                            importSource: inv.importSource,
                            importDate:   inv.importDate
                        };
                        duplicates++;
                        imported++;
                    }
                } else {
                    // New entry
                    this.investments.push(inv);
                    imported++;
                }
            });

            // Trigger reactivity
            this.investments = [...this.investments];

            this.importStats = { total: this.importResults.investments.length, imported, duplicates, skipped };
            this.importResults = null;
            this.importFile = null;
            this.importState = 'done';
        },

        // ════════════════════════════════════════════════════════════
        //  UTILITIES
        // ════════════════════════════════════════════════════════════
        formatCurrency(num) {
            return '₹' + Number(num).toLocaleString('en-IN', { maximumFractionDigits: 0 });
        },

        formatDate(str) {
            if (!str) return '—';
            return new Date(str).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
        },

        // ════════════════════════════════════════════════════════════
        //  REGENERATIVE WEALTH METHODS
        // ════════════════════════════════════════════════════════════

        // Save the Gemini API key to localStorage and mark as set
        saveRegenApiKey() {
            const key = (this.regenWealth.apiKey || '').trim();
            if (key.length < 20) {
                this.regenWealth.error = 'Please enter a valid Gemini API key (it starts with "AIzaSy").';
                return;
            }
            localStorage.setItem('rfm_gemini_key', key);
            this.regenWealth.apiKeySet    = true;
            this.regenWealth.showKeyInput = false;
            this.regenWealth.error        = '';
        },

        // Remove stored API key
        clearRegenApiKey() {
            localStorage.removeItem('rfm_gemini_key');
            this.regenWealth.apiKey       = '';
            this.regenWealth.apiKeySet    = false;
            this.regenWealth.showKeyInput = false;
            this.regenWealth.analysis     = null;
            window.RegenWealth?.clearCache();
        },

        // Clear cached analysis and force fresh fetch
        clearRegenCache() {
            window.RegenWealth?.clearCache();
            this.regenWealth.analysis = null;
        },

        // Main analysis runner — called by the Analyze button
        async runRegenWealthAnalysis() {
            if (!window.RegenWealth) {
                this.regenWealth.error = 'Analysis engine not loaded. Please refresh the page.';
                return;
            }
            if (!this.regenWealth.apiKeySet) {
                this.regenWealth.showKeyInput = true;
                return;
            }

            this.regenWealth.loading    = true;
            this.regenWealth.error      = '';
            this.regenWealth.progressMsg = 'Starting analysis...';

            try {
                const result = await window.RegenWealth.analyze(
                    this.$data,
                    this.regenWealth.apiKey,
                    (msg) => { this.regenWealth.progressMsg = msg; }
                );
                this.regenWealth.analysis    = result;
                this.regenWealth.progressMsg = '';
            } catch (err) {
                this.regenWealth.error       = err.message || 'Analysis failed. Please try again.';
                this.regenWealth.progressMsg = '';
            } finally {
                this.regenWealth.loading = false;
            }
        },

        // Helper: priority badge colour class
        regenPriorityClass(priority) {
            if (priority === 'High')   return 'bg-[#d4af37]/20 text-[#d4af37] border-[#d4af37]/40';
            if (priority === 'Medium') return 'bg-primary-container/40 text-primary border-primary/30';
            return 'bg-white/10 text-on-surface-variant border-white/10';
        },

        // Helper: priority glow class for card border
        regenCardGlow(priority) {
            if (priority === 'High')   return 'border-[#d4af37]/40 shadow-[0_8px_30px_rgba(212,175,55,0.15)]';
            if (priority === 'Medium') return 'border-primary/30 shadow-[0_8px_30px_rgba(0,201,167,0.12)]';
            return 'border-white/8 shadow-[0_4px_16px_rgba(0,0,0,0.3)]';
        },

        // Helper: asset class icon name
        regenAssetIcon(assetClass) {
            const map = {
                'Gold': 'diamond', 'Sovereign Gold Bonds': 'diamond',
                'Bonds': 'account_balance', 'RBI Bonds': 'account_balance',
                'Fixed Deposits': 'savings', 'SCSS': 'savings',
                'Mutual Funds': 'trending_up', 'PPF': 'savings',
                'Equity': 'candlestick_chart',
                'Real Estate': 'home', 'REITs': 'home',
                'NPS': 'shield',
            };
            return map[assetClass] || 'auto_awesome';
        },

        // Helper: sentiment colour
        regenSentimentClass(sentiment) {
            if (!sentiment) return 'text-on-surface-variant';
            const s = sentiment.toLowerCase();
            if (s.includes('bullish')) return 'text-[#00c9a7]';
            if (s.includes('bearish')) return 'text-red-400';
            if (s.includes('cautious')) return 'text-[#d4af37]';
            return 'text-on-surface-variant';
        },

        // ════════════════════════════════════════════════════════════
        //  ACTIONS — BACKUP & RESTORE (Phase 7)
        // ════════════════════════════════════════════════════════════
        backupData() {
            const data = localStorage.getItem('rfm_v1');
            if (!data) {
                alert('No data to backup.');
                return;
            }
            const blob = new Blob([data], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `rfm_backup_${new Date().toISOString().slice(0, 10)}.json`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
        },

        async restoreData(event) {
            const file = event.target.files[0];
            if (!file) return;

            try {
                const text = await file.text();
                const parsed = JSON.parse(text);
                
                if (!parsed.version || !parsed.investments) {
                    alert('Invalid backup file format.');
                    return;
                }

                if (confirm('This will overwrite your current data. Are you sure you want to proceed?')) {
                    localStorage.setItem('rfm_v1', JSON.stringify(parsed));
                    // Reload data into state
                    this.loadData();
                    // Reset charts if they are rendered
                    if (this.activePage === 'portfolio') {
                        this.renderPortfolioCharts();
                    }
                    alert('Data restored successfully!');
                }
            } catch (err) {
                console.error('Restore error:', err);
                alert('Error reading backup file: ' + err.message);
            }
            // Reset file input so the same file can be selected again
            event.target.value = '';
        },

        // ════════════════════════════════════════════════════════════
        //  ACTIONS — SIP & RECURRING (Phase 9)
        // ════════════════════════════════════════════════════════════
        addSip() {
            if (!this.newSip.name || !this.newSip.monthlyAmount) return;
            this.sips.push({
                ...this.newSip,
                id:            Date.now(),
                monthlyAmount: Number(this.newSip.monthlyAmount),
                dayOfMonth:    Number(this.newSip.dayOfMonth) || 5
            });
            this.newSip = {
                name: '', type: 'SIP', monthlyAmount: '',
                dayOfMonth: 5, startDate: '', endDate: '',
                status: 'Active', linkedInvestmentId: null, ticker: ''
            };
            this.addingSip = false;
        },

        deleteSip(id) {
            if (confirm('Delete this recurring plan?')) {
                this.sips = this.sips.filter(s => s.id !== id);
            }
        },

        openEditSipModal(sip) {
            this.editSipForm = { ...sip };
            this.editingSip  = sip;
        },

        saveSipEdit() {
            const idx = this.sips.findIndex(s => s.id === this.editSipForm.id);
            if (idx !== -1) {
                this.editSipForm.monthlyAmount = Number(this.editSipForm.monthlyAmount);
                this.editSipForm.dayOfMonth    = Number(this.editSipForm.dayOfMonth) || 5;
                this.sips[idx] = { ...this.editSipForm };
                this.sips = [...this.sips];
            }
            this.editingSip = null;
        },

        cancelSipEdit() { this.editingSip = null; },

        toggleSipStatus(sip) {
            const idx = this.sips.findIndex(s => s.id === sip.id);
            if (idx !== -1) {
                this.sips[idx].status = this.sips[idx].status === 'Active' ? 'Paused' : 'Active';
                this.sips = [...this.sips];
            }
        },

        getSipLinkedName(sip) {
            if (!sip.linkedInvestmentId) return '';
            const inv = this.investments.find(i => i.id === sip.linkedInvestmentId);
            return inv ? inv.name : '';
        },

        getSipDaysUntilDebit(sip) {
            const today = new Date().getDate();
            const debit = Number(sip.dayOfMonth);
            const diff  = debit >= today ? debit - today : (31 - today) + debit;
            return diff === 0 ? 'Today!' : `in ${diff} day${diff !== 1 ? 's' : ''}`;
        }

    }));
});