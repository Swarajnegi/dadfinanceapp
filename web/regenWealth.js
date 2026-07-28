// ══════════════════════════════════════════════════════════════════════════════
// regenWealth.js — Regenerative Wealth Analysis Engine
// Architecture Layer : Intelligence / Advisory Layer
// Depends on        : Gemini 2.0 Flash API, rss2json.com (free tier)
// No backend needed : runs 100% in the browser
// ══════════════════════════════════════════════════════════════════════════════

window.RegenWealth = (() => {

    // ── Constants ──────────────────────────────────────────────────────────────
    const GEMINI_ENDPOINT =
        'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent';
    const CACHE_KEY    = 'rfm_regen_cache';
    const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

    // Free RSS → JSON bridge (500 req/day free, no key needed)
    const RSS2JSON = 'https://api.rss2json.com/v1/api.json?count=8&rss_url=';

    // Indian financial news RSS feeds
    const NEWS_FEEDS = [
        {
            name: 'Economic Times Markets',
            url:  'https://economictimes.indiatimes.com/markets/rssfeeds/1977021501.cms'
        },
        {
            name: 'Moneycontrol Top News',
            url:  'https://www.moneycontrol.com/rss/MCtopnews.xml'
        },
        {
            name: 'RBI Press Releases',
            url:  'https://www.rbi.org.in/Scripts/rss.aspx'
        }
    ];

    // ── News Fetcher ───────────────────────────────────────────────────────────
    // Fetches a single RSS feed via rss2json bridge.
    // Returns { source, headlines[] } — never throws.
    async function fetchNewsFeed(feed) {
        try {
            const res = await fetch(
                RSS2JSON + encodeURIComponent(feed.url),
                { signal: AbortSignal.timeout(9000) }
            );
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const data = await res.json();
            if (data.status !== 'ok') throw new Error('Feed parse error');
            const headlines = (data.items || [])
                .map(i => i.title)
                .filter(Boolean)
                .slice(0, 6);
            return { source: feed.name, headlines };
        } catch (err) {
            console.warn(`[RegenWealth] Feed "${feed.name}" failed:`, err.message);
            return { source: feed.name, headlines: [] };
        }
    }

    // ── Portfolio Snapshot Builder ─────────────────────────────────────────────
    // Distills the Alpine appData state into a lean, token-efficient object
    // suitable for inclusion in the Gemini prompt.
    function buildPortfolioSnapshot(appData) {
        const investments = appData.investments || [];

        // Total capital deployed
        const totalInvested = investments.reduce(
            (s, i) => s + (parseFloat(i.amount) || 0), 0
        );

        // Per-asset-class breakdown ₹ and %
        const breakdown = {};
        investments.forEach(inv => {
            const t = inv.type || 'Other';
            breakdown[t] = (breakdown[t] || 0) + (parseFloat(inv.amount) || 0);
        });
        const allocationPct = {};
        Object.entries(breakdown).forEach(([type, amt]) => {
            allocationPct[type] = totalInvested > 0
                ? Math.round((amt / totalInvested) * 100)
                : 0;
        });

        // Concentration risk flags (anything >40% of portfolio)
        const concentrationRisks = Object.entries(allocationPct)
            .filter(([, pct]) => pct > 40)
            .map(([type, pct]) => `${type} (${pct}%)`);

        // Monthly income / expense / surplus
        const pension     = appData.pension?.monthlyAmount || 0;
        const cf          = appData.cashflow || {};
        const totalIncome = pension + (cf.project || 0) + (cf.otherIncome || 0);
        const totalExpense = (cf.housing || 0) + (cf.food || 0)
                           + (cf.medical || 0) + (cf.otherExpense || 0);
        const monthlySurplus = totalIncome - totalExpense;

        // Net worth
        const nw = appData.networth || {};
        const totalAssets      = (nw.bank || 0) + (nw.cash || 0)
                               + (nw.property || 0) + (nw.otherAsset || 0)
                               + totalInvested;
        const totalLiabilities = (nw.homeLoan || 0) + (nw.personalLoan || 0)
                               + (nw.credit || 0) + (nw.otherDebt || 0);

        // Emergency fund adequacy
        const ef = appData.emergency || {};
        const efTarget         = (ef.efMonthly || 0) * (ef.efMonths || 12);
        const efCurrent        = ef.efCurrent || 0;
        const efCoverageMonths = ef.efMonthly > 0
            ? Math.round(efCurrent / ef.efMonthly)
            : 0;

        return {
            totalInvested,
            holdingsCount: investments.length,
            allocationPct,
            breakdown,
            concentrationRisks,
            monthlyPension: pension,
            monthlyIncome: totalIncome,
            monthlyExpense: totalExpense,
            monthlySurplus,
            totalAssets,
            totalLiabilities,
            netWorth: totalAssets - totalLiabilities,
            efCoverageMonths,
            efTarget,
            efCurrent,
            efMonthlyNeeded: ef.efMonthly || 0,
            taxRegime:   appData.tax?.regime || 'new',
            is80CUsed:   (appData.tax?.deduction80C || 0) > 0,
            goals: (appData.goals || []).map(g => ({
                name:    g.name,
                target:  g.target,
                current: g.current
            }))
        };
    }

    // ── Prompt Builder ─────────────────────────────────────────────────────────
    // Constructs a structured Gemini prompt combining the portfolio snapshot
    // with live macro headlines. Requests strict JSON output.
    function buildPrompt(snapshot, newsFeeds) {
        const fmt = n => Number(n || 0).toLocaleString('en-IN');

        // Portfolio allocation narrative
        const allocationLines = Object.entries(snapshot.allocationPct)
            .map(([t, pct]) => `  - ${t}: ${pct}% (₹${fmt(snapshot.breakdown[t])})`)
            .join('\n') || '  - No investments recorded yet';

        // News headlines block
        const newsSections = newsFeeds
            .filter(f => f.headlines.length > 0)
            .map(f => `### ${f.source}\n${f.headlines.map((h, i) => `${i+1}. ${h}`).join('\n')}`)
            .join('\n\n');
        const hasNews = newsSections.length > 0;

        return `You are a senior Indian financial advisor specialising in retirement wealth management for senior citizens. Your role is to analyse the user's current portfolio alongside live macroeconomic signals and suggest where they should invest next.

## USER PORTFOLIO PROFILE
- **Total Invested:** ₹${fmt(snapshot.totalInvested)}
- **Number of Holdings:** ${snapshot.holdingsCount}
- **Asset Allocation:**
${allocationLines}
- **Concentration Risks:** ${snapshot.concentrationRisks.length > 0 ? snapshot.concentrationRisks.join(', ') : 'None detected'}
- **Monthly Pension Income:** ₹${fmt(snapshot.monthlyPension)}
- **Monthly Total Income:** ₹${fmt(snapshot.monthlyIncome)}
- **Monthly Expenses:** ₹${fmt(snapshot.monthlyExpense)}
- **Monthly Investable Surplus:** ₹${fmt(snapshot.monthlySurplus)}
- **Net Worth:** ₹${fmt(snapshot.netWorth)} (Assets ₹${fmt(snapshot.totalAssets)} − Liabilities ₹${fmt(snapshot.totalLiabilities)})
- **Emergency Fund:** ${snapshot.efCoverageMonths} months covered (target: ${Math.round(snapshot.efTarget / Math.max(snapshot.efMonthlyNeeded, 1))} months)
- **Tax Regime:** ${snapshot.taxRegime}
- **Section 80C Utilised:** ${snapshot.is80CUsed ? 'Yes' : 'No'}
- **Active Financial Goals:** ${snapshot.goals.length > 0 ? snapshot.goals.map(g => `${g.name} (target ₹${fmt(g.target)}, saved ₹${fmt(g.current)})`).join('; ') : 'None set'}

${hasNews
    ? `## LIVE MARKET INTELLIGENCE (real-time news headlines)\n${newsSections}`
    : '## MARKET CONTEXT\nUsing current general knowledge of Indian financial markets (July 2026).'}

## INSTRUCTIONS
1. Identify 4–6 specific, actionable investment opportunities ranked by urgency.
2. Prioritise capital preservation and stable income (senior citizen, fixed-income profile).
3. Consider Indian-specific instruments: Senior Citizen Savings Scheme (SCSS), Sovereign Gold Bonds (SGBs), RBI Floating Rate Bonds, PMVVY, NPS Tier 2, Debt Mutual Funds, REITs.
4. Leverage tax-efficient options: 80C, 80D, 80TTB (senior), Section 24 interest deduction.
5. Base suggested allocation amounts on the monthly surplus (₹${fmt(snapshot.monthlySurplus)}/month).
6. Justify each recommendation by connecting a specific macro signal from the headlines to a portfolio gap.

## REQUIRED OUTPUT FORMAT — respond ONLY with valid JSON, no markdown fences:
{
  "macroContext": "2–3 sentence summary of current Indian macro conditions relevant to a senior investor",
  "marketSentiment": "Bullish|Bearish|Neutral|Cautiously Optimistic",
  "portfolioHealthScore": 0-100,
  "portfolioHealthNote": "One sentence on overall portfolio health",
  "keyRisks": ["Risk 1", "Risk 2"],
  "recommendations": [
    {
      "id": "r1",
      "assetClass": "Gold|Bonds|Fixed Deposits|Mutual Funds|Equity|Real Estate|Sovereign Gold Bonds|PPF|SCSS|NPS|RBI Bonds|REITs|Other",
      "priority": "High|Medium|Low",
      "title": "Short actionable title (max 8 words)",
      "rationale": "2–3 sentences connecting a macro signal to a portfolio gap",
      "suggestedAllocation": "₹X – ₹Y (e.g. ₹25,000 – ₹50,000)",
      "timeHorizon": "e.g. 6–18 months",
      "risk": "Very Low|Low|Moderate|High",
      "urgencyScore": 0-100,
      "specificInstruments": ["Instrument name 1", "Instrument name 2"]
    }
  ]
}`;
    }

    // ── Helper: JSON Response Cleaner & Parser ────────────────────────────────
    function parseJSONResponse(text) {
        if (!text) throw new Error('AI returned an empty response. Please retry.');
        const clean = text
            .replace(/^```json\s*/i, '')
            .replace(/^```\s*/i, '')
            .replace(/\s*```\s*$/i, '')
            .trim();
        try {
            return JSON.parse(clean);
        } catch (e) {
            throw new Error(`Could not parse AI response as JSON: ${e.message}`);
        }
    }

    // ── Provider Auto-Detector ────────────────────────────────────────────────
    function detectProvider(apiKey) {
        const key = (apiKey || '').trim();
        if (key.startsWith('sk-or-')) return 'openrouter';
        if (key.startsWith('AIza')) return 'gemini';
        if (key.startsWith('sk-')) return 'openai';
        return 'openrouter'; // Default fallback for OpenRouter or custom proxy keys
    }

    // ── Universal Multi-Provider LLM Caller ────────────────────────────────────
    // Supports:
    // 1. OpenRouter (sk-or-v1-...) -> https://openrouter.ai/api/v1/chat/completions
    // 2. Direct Gemini (AIzaSy...)  -> https://generativelanguage.googleapis.com/...
    // 3. Direct OpenAI (sk-...)     -> https://api.openai.com/v1/chat/completions
    async function callLLM(prompt, apiKey, options = {}) {
        const key = (apiKey || '').trim();
        if (!key) throw new Error('No API key provided.');

        const provider = options.provider && options.provider !== 'auto'
            ? options.provider
            : detectProvider(key);

        const temperature = typeof options.temperature === 'number' ? options.temperature : 0.3;

        // 1. OpenRouter API Call
        if (provider === 'openrouter') {
            const model = options.model || 'google/gemini-2.0-flash-001';
            const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
                method:  'POST',
                headers: {
                    'Content-Type':  'application/json',
                    'Authorization': `Bearer ${key}`,
                    'HTTP-Referer':  'https://github.com/Swarajnegi/dadfinanceapp',
                    'X-Title':       'RFM Portfolio Advisor'
                },
                body: JSON.stringify({
                    model: model,
                    messages: [
                        { role: 'system', content: 'You are an expert Indian financial advisor. Output ONLY valid JSON.' },
                        { role: 'user', content: prompt }
                    ],
                    response_format: { type: 'json_object' },
                    temperature: temperature
                })
            });

            if (!res.ok) {
                const errBody = await res.json().catch(() => ({}));
                const msg = errBody?.error?.message || `HTTP ${res.status}`;
                if (res.status === 401) throw new Error('Invalid OpenRouter API key. Check key at openrouter.ai/keys');
                if (res.status === 402) throw new Error('OpenRouter credits depleted. Please top up your account.');
                if (res.status === 429) throw new Error('OpenRouter rate limit hit. Please retry in 30 seconds.');
                throw new Error(`OpenRouter API error: ${msg}`);
            }

            const data = await res.json();
            const text = data.choices?.[0]?.message?.content;
            return parseJSONResponse(text);
        }

        // 2. OpenAI API Call
        if (provider === 'openai') {
            const model = options.model || 'gpt-4o-mini';
            const res = await fetch('https://api.openai.com/v1/chat/completions', {
                method:  'POST',
                headers: {
                    'Content-Type':  'application/json',
                    'Authorization': `Bearer ${key}`
                },
                body: JSON.stringify({
                    model: model,
                    messages: [
                        { role: 'system', content: 'You are an expert Indian financial advisor. Output ONLY valid JSON.' },
                        { role: 'user', content: prompt }
                    ],
                    response_format: { type: 'json_object' },
                    temperature: temperature
                })
            });

            if (!res.ok) {
                const errBody = await res.json().catch(() => ({}));
                const msg = errBody?.error?.message || `HTTP ${res.status}`;
                throw new Error(`OpenAI API error: ${msg}`);
            }

            const data = await res.json();
            const text = data.choices?.[0]?.message?.content;
            return parseJSONResponse(text);
        }

        // 3. Direct Gemini (Google AI Studio) Call
        const GEMINI_ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent';
        const res = await fetch(`${GEMINI_ENDPOINT}?key=${key}`, {
            method:  'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                contents: [{ parts: [{ text: prompt }] }],
                generationConfig: {
                    responseMimeType: 'application/json',
                    temperature:      temperature,
                    maxOutputTokens:  4096
                }
            })
        });

        if (!res.ok) {
            const errBody = await res.json().catch(() => ({}));
            const msg = errBody?.error?.message || `HTTP ${res.status}`;
            if (res.status === 400) throw new Error(`Invalid Gemini key or request format: ${msg}`);
            if (res.status === 403) throw new Error('API key does not have Gemini access. Check AI Studio.');
            if (res.status === 429) throw new Error('Gemini rate limit hit. Wait 60 seconds.');
            throw new Error(`Gemini API error: ${msg}`);
        }

        const data = await res.json();
        const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
        return parseJSONResponse(text);
    }

    // ── Main Orchestrator ──────────────────────────────────────────────────────
    // Runs the full analysis pipeline: portfolio read → news fetch → AI call.
    // onProgress(msg) is called at each stage for UI feedback.
    async function analyze(appData, apiKey, options = {}, onProgress = () => {}) {
        if (!apiKey || apiKey.trim().length < 10) {
            throw new Error('Please enter a valid API key (OpenRouter, Gemini, or OpenAI).');
        }

        const key = apiKey.trim();
        const provider = (options.provider && options.provider !== 'auto')
            ? options.provider
            : detectProvider(key);

        const modelName = options.model || (provider === 'openrouter' ? 'google/gemini-2.0-flash-001' : 'gemini-2.0-flash');

        onProgress('Reading your portfolio snapshot...');
        const snapshot = buildPortfolioSnapshot(appData);

        onProgress('Fetching live market news from 3 RSS sources...');
        const newsResults = await Promise.all(NEWS_FEEDS.map(fetchNewsFeed));
        const successCount = newsResults.filter(f => f.headlines.length > 0).length;

        onProgress(`Building analysis prompt (${successCount}/3 news sources loaded)...`);
        const prompt = buildPrompt(snapshot, newsResults);

        const providerLabel = provider === 'openrouter' ? `OpenRouter (${modelName})` : provider === 'openai' ? `OpenAI (${modelName})` : 'Gemini 2.0 Flash';
        onProgress(`Running ${providerLabel} AI analysis...`);

        const result = await callLLM(prompt, key, { provider, model: modelName, temperature: 0.3 });

        // Sort by urgency score descending
        if (Array.isArray(result.recommendations)) {
            result.recommendations.sort((a, b) => (b.urgencyScore || 0) - (a.urgencyScore || 0));
        }

        const analysis = {
            ...result,
            portfolioSnapshot: snapshot,
            newsSources: newsResults.map(f => ({
                source: f.source,
                count:  f.headlines.length
            })),
            providerUsed: providerLabel,
            timestamp: new Date().toISOString()
        };

        // Cache for 24 hours
        try {
            localStorage.setItem(CACHE_KEY, JSON.stringify(analysis));
        } catch (_) { /* Storage full — skip caching */ }

        return analysis;
    }

    // ── Cache Utilities ────────────────────────────────────────────────────────
    function loadCached() {
        try {
            const raw = localStorage.getItem(CACHE_KEY);
            if (!raw) return null;
            const cached = JSON.parse(raw);
            const ageMs  = Date.now() - new Date(cached.timestamp).getTime();
            return ageMs < CACHE_TTL_MS ? cached : null;
        } catch {
            return null;
        }
    }

    function clearCache() {
        localStorage.removeItem(CACHE_KEY);
    }

    // ── Public API ─────────────────────────────────────────────────────────────
    return { callLLM, analyze, detectProvider, loadCached, clearCache };

})();

