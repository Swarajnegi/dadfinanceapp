/**
 * ═══════════════════════════════════════════════════════════════
 *  RFM Statement Parser — Phase 5
 *  Client-side CAS / MF statement parser
 *  Extracts structured investment data from PDF text
 * ═══════════════════════════════════════════════════════════════
 *
 *  Architecture:
 *    pdf.js extracts raw text → detectStatementType() routes it
 *    → specific parser (CDSL/NSDL/CAMS/KFintech)
 *    → normalizeToInvestments() maps to our app's shape
 *
 *  This file has ZERO dependencies on Alpine, Capacitor, or DOM.
 *  It is a pure function library: text in → structured data out.
 */

// ════════════════════════════════════════════════════════════════
//  DETECTION — What type of statement is this?
// ════════════════════════════════════════════════════════════════

function detectStatementType(text) {
    const t = text.toUpperCase();

    // CDSL CAS
    if (t.includes('CONSOLIDATED ACCOUNT STATEMENT') &&
        (t.includes('CDSL') || t.includes('CENTRAL DEPOSITORY'))) {
        return 'CDSL_CAS';
    }

    // NSDL CAS
    if (t.includes('CONSOLIDATED ACCOUNT STATEMENT') &&
        (t.includes('NSDL') || t.includes('NATIONAL SECURITIES'))) {
        return 'NSDL_CAS';
    }

    // CAMS Mutual Fund
    if ((t.includes('COMPUTER AGE MANAGEMENT') || t.includes('CAMS')) &&
        t.includes('MUTUAL FUND')) {
        return 'CAMS_MF';
    }

    // KFintech Mutual Fund
    if ((t.includes('KFIN TECHNOLOGIES') || t.includes('KFINTECH') || t.includes('KARVY')) &&
        t.includes('STATEMENT')) {
        return 'KFINTECH_MF';
    }

    return 'UNKNOWN';
}


// ════════════════════════════════════════════════════════════════
//  COMMON REGEX PATTERNS
// ════════════════════════════════════════════════════════════════

const ISIN_REGEX = /\b(IN[A-Z0-9]{10})\b/g;
const PAN_REGEX  = /PAN\s*[:\-]?\s*([A-Z]{5}\d{4}[A-Z])/i;
const NAME_REGEX = /(?:Name|Holder)\s*[:\-]?\s*(.+)/i;

// Parse Indian number format: "1,23,456.78" → 123456.78
function parseIndianNumber(str) {
    if (!str) return 0;
    return parseFloat(String(str).replace(/,/g, '').trim()) || 0;
}

// Clean up extracted text lines
function cleanLine(line) {
    return line.replace(/\s+/g, ' ').trim();
}


// ════════════════════════════════════════════════════════════════
//  CDSL CAS PARSER
// ════════════════════════════════════════════════════════════════

function parseCDSL(text) {
    const result = {
        type: 'CDSL_CAS',
        investor: extractInvestorInfo(text),
        holdings: []
    };

    const lines = text.split('\n').map(cleanLine).filter(l => l.length > 0);

    // ── Strategy: Walk line-by-line, find ISINs, then extract surrounding context ──
    // CAS PDFs have holdings in tabular blocks. Each holding typically appears as:
    //   ISIN line → Security name → Quantity → Valuation

    let inHoldingsSection = false;
    let currentHolding = null;

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];

        // Detect start of holdings section
        if (/demat\s+account|equity\s+&\s+mutual|securities\s+held/i.test(line)) {
            inHoldingsSection = true;
            continue;
        }

        // Detect end of holdings section (next major section)
        if (inHoldingsSection && /^\s*(transaction\s+statement|statement\s+of\s+transaction)/i.test(line)) {
            // Flush last holding
            if (currentHolding && currentHolding.isin) {
                result.holdings.push(currentHolding);
            }
            inHoldingsSection = false;
            continue;
        }

        if (!inHoldingsSection) continue;

        // Look for ISIN on this line
        const isinMatch = line.match(/\b(IN[A-Z0-9]{10})\b/);

        if (isinMatch) {
            // Flush previous holding
            if (currentHolding && currentHolding.isin) {
                result.holdings.push(currentHolding);
            }

            currentHolding = {
                isin: isinMatch[1],
                name: '',
                units: 0,
                value: 0,
                type: inferTypeFromISIN(isinMatch[1]),
                folioNumber: '',
                dpId: ''
            };

            // The security name is often on the same line after the ISIN,
            // or on the next line
            const afterIsin = line.substring(line.indexOf(isinMatch[1]) + isinMatch[1].length).trim();
            if (afterIsin.length > 3 && !/^\d/.test(afterIsin)) {
                currentHolding.name = afterIsin;
            }
            continue;
        }

        // If we have a current holding and no name yet, this line might be the name
        if (currentHolding && !currentHolding.name) {
            // Skip purely numeric lines or very short lines
            if (line.length > 3 && !/^[\d,.\s₹]+$/.test(line)) {
                currentHolding.name = line;
                continue;
            }
        }

        // Look for quantity / units
        if (currentHolding) {
            const qtyMatch = line.match(/([\d,]+\.?\d*)\s*(?:units?|quantity|shares?|nos?\.?)/i);
            if (qtyMatch) {
                currentHolding.units = parseIndianNumber(qtyMatch[1]);
                continue;
            }

            // Look for valuation / market value
            const valMatch = line.match(/(?:valuation|market\s*value|value\s*in\s*inr|total\s*value)\s*[:\-]?\s*₹?\s*([\d,]+\.?\d*)/i);
            if (valMatch) {
                currentHolding.value = parseIndianNumber(valMatch[1]);
                continue;
            }

            // Folio number
            const folioMatch = line.match(/folio\s*(?:no\.?)?\s*[:\-]?\s*(\S+)/i);
            if (folioMatch) {
                currentHolding.folioNumber = folioMatch[1];
                continue;
            }

            // DP ID
            const dpMatch = line.match(/(?:dp\s*id|bo\s*id)\s*[:\-]?\s*(\d+)/i);
            if (dpMatch) {
                currentHolding.dpId = dpMatch[1];
                continue;
            }

            // Standalone number that might be value (last number on a line in holdings context)
            // Only grab if we already have an ISIN and name but no value
            if (currentHolding.name && currentHolding.value === 0) {
                const numMatch = line.match(/^₹?\s*([\d,]+\.\d{2})\s*$/);
                if (numMatch) {
                    currentHolding.value = parseIndianNumber(numMatch[1]);
                }
            }
        }
    }

    // Flush last holding
    if (currentHolding && currentHolding.isin) {
        result.holdings.push(currentHolding);
    }

    // ── Fallback: If section-based parsing found nothing, try ISIN-scanning ──
    if (result.holdings.length === 0) {
        result.holdings = fallbackISINScan(lines);
    }

    return result;
}


// ════════════════════════════════════════════════════════════════
//  NSDL CAS PARSER
// ════════════════════════════════════════════════════════════════

function parseNSDL(text) {
    // NSDL CAS structure is very similar to CDSL.
    // Key differences: uses "DP ID - Client ID" and slightly different headers.
    // We reuse the CDSL logic with minor adjustments.
    const result = parseCDSL(text);
    result.type = 'NSDL_CAS';

    // Fix DP ID extraction for NSDL format
    const dpMatch = text.match(/DP\s*ID\s*[-:]?\s*(\w+)\s*[-]?\s*Client\s*ID\s*[-:]?\s*(\w+)/i);
    if (dpMatch) {
        result.holdings.forEach(h => {
            if (!h.dpId) h.dpId = dpMatch[1] + '-' + dpMatch[2];
        });
    }

    return result;
}


// ════════════════════════════════════════════════════════════════
//  CAMS MUTUAL FUND PARSER
// ════════════════════════════════════════════════════════════════

function parseCAMS(text) {
    const result = {
        type: 'CAMS_MF',
        investor: extractInvestorInfo(text),
        holdings: []
    };

    const lines = text.split('\n').map(cleanLine).filter(l => l.length > 0);

    let currentFolio = '';
    let currentScheme = '';
    let currentHolding = null;

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];

        // Folio number
        const folioMatch = line.match(/folio\s*(?:no\.?)?\s*[:\-]?\s*(\S+)/i);
        if (folioMatch) {
            // Flush previous
            if (currentHolding && currentHolding.name) {
                result.holdings.push(currentHolding);
            }
            currentFolio = folioMatch[1];
            currentScheme = '';
            currentHolding = null;
            continue;
        }

        // If we have a folio but no scheme yet, the next non-trivial line is the scheme name
        if (currentFolio && !currentScheme) {
            // Skip date lines, header lines, etc.
            if (line.length > 10 && !/^[\d\s\-\/]+$/.test(line) && !/^(date|transaction|amount|units|nav)/i.test(line)) {
                currentScheme = line;
                currentHolding = {
                    isin: '',
                    name: currentScheme,
                    units: 0,
                    value: 0,
                    nav: 0,
                    type: 'Mutual Fund',
                    folioNumber: currentFolio,
                    dpId: ''
                };

                // Try to extract ISIN from scheme line or nearby
                const isinMatch = line.match(/\b(IN[A-Z0-9]{10})\b/);
                if (isinMatch) {
                    currentHolding.isin = isinMatch[1];
                    currentHolding.name = line.replace(isinMatch[0], '').trim();
                }
                continue;
            }
        }

        if (currentHolding) {
            // ISIN on a separate line
            const isinMatch = line.match(/\b(IN[A-Z0-9]{10})\b/);
            if (isinMatch && !currentHolding.isin) {
                currentHolding.isin = isinMatch[1];
            }

            // Closing unit balance
            const unitsMatch = line.match(/(?:closing|balance)\s*(?:unit)?\s*[:\-]?\s*([\d,]+\.\d{3,4})/i);
            if (unitsMatch) {
                currentHolding.units = parseIndianNumber(unitsMatch[1]);
                continue;
            }

            // NAV
            const navMatch = line.match(/NAV\s*(?:on)?\s*[\d\-\/]*\s*[:\-]?\s*(?:INR\s*)?₹?\s*([\d,]+\.\d{2,4})/i);
            if (navMatch) {
                currentHolding.nav = parseIndianNumber(navMatch[1]);
                continue;
            }

            // Market / Valuation value
            const valMatch = line.match(/(?:market|valuation|value)\s*[:\-]?\s*₹?\s*(?:INR\s*)?([\d,]+\.?\d*)/i);
            if (valMatch) {
                currentHolding.value = parseIndianNumber(valMatch[1]);
                continue;
            }

            // Standalone units (3-4 decimal places is a strong MF signal)
            if (currentHolding.units === 0) {
                const standaloneUnits = line.match(/^([\d,]+\.\d{3,4})\s*$/);
                if (standaloneUnits) {
                    currentHolding.units = parseIndianNumber(standaloneUnits[1]);
                    continue;
                }
            }
        }
    }

    // Flush last
    if (currentHolding && currentHolding.name) {
        result.holdings.push(currentHolding);
    }

    // Calculate value from units × NAV if value is missing
    result.holdings.forEach(h => {
        if (h.value === 0 && h.units > 0 && h.nav > 0) {
            h.value = Math.round(h.units * h.nav * 100) / 100;
        }
    });

    return result;
}


// ════════════════════════════════════════════════════════════════
//  KFINTECH MUTUAL FUND PARSER
// ════════════════════════════════════════════════════════════════

function parseKFintech(text) {
    // KFintech format is structurally similar to CAMS.
    // Reuse CAMS parser with adjusted type.
    const result = parseCAMS(text);
    result.type = 'KFINTECH_MF';
    return result;
}


// ════════════════════════════════════════════════════════════════
//  HELPER FUNCTIONS
// ════════════════════════════════════════════════════════════════

function extractInvestorInfo(text) {
    const investor = { name: '', pan: '' };

    const panMatch = text.match(PAN_REGEX);
    if (panMatch) investor.pan = panMatch[1];

    const nameMatch = text.match(NAME_REGEX);
    if (nameMatch) investor.name = nameMatch[1].trim();

    return investor;
}

function inferTypeFromISIN(isin) {
    if (!isin) return 'Other';
    // Indian ISIN classification:
    // INF... → Mutual Fund (MF units are in INF* range)
    // INE... → Equity, Bond, ETF (most common prefix)
    // IN0... → Government Securities
    if (isin.startsWith('INF')) return 'Mutual Fund';
    if (isin.startsWith('IN0')) return 'Government Bond';
    // INE could be stock, bond, or ETF — we can't distinguish purely from ISIN
    // Name-based inference happens in normalizeToInvestments
    return 'Stock'; // Default for INE; refined later by name keywords
}

function inferTypeFromName(name, currentType) {
    if (!name) return currentType;
    const n = name.toUpperCase();

    // Bond keywords
    if (/\bNCD\b|DEBENTURE|BOND|\bBD\b/.test(n)) return 'Bond';
    // ETF keywords
    if (/\bETF\b|EXCHANGE\s*TRADED/.test(n)) return 'ETF';
    // FD keywords
    if (/\bFD\b|FIXED\s*DEPOSIT/.test(n)) return 'FD';
    // Government securities
    if (/\bGSEC\b|GOI|GOVERNMENT|TREASURY|SDL\b/.test(n)) return 'Government Bond';
    // SGB
    if (/SOVEREIGN\s*GOLD|SGB/.test(n)) return 'SGB';
    // ELSS
    if (/ELSS|TAX\s*SAVER/.test(n)) return 'ELSS';

    return currentType;
}

/**
 * Fallback: If section-based parsing fails, scan ALL lines for ISINs
 * and extract minimal data around each one.
 */
function fallbackISINScan(lines) {
    const holdings = [];
    const seenISINs = new Set();

    for (let i = 0; i < lines.length; i++) {
        const match = lines[i].match(/\b(IN[A-Z0-9]{10})\b/);
        if (match && !seenISINs.has(match[1])) {
            seenISINs.add(match[1]);

            // Try to grab the name from adjacent lines
            let name = '';
            const afterIsin = lines[i].substring(lines[i].indexOf(match[1]) + match[1].length).trim();
            if (afterIsin.length > 3 && !/^[\d,.\s]+$/.test(afterIsin)) {
                name = afterIsin;
            } else if (i + 1 < lines.length && lines[i+1].length > 3 && !/^[\d,.\s₹]+$/.test(lines[i+1])) {
                name = lines[i+1];
            }

            // Scan nearby lines for a value
            let value = 0;
            for (let j = i; j < Math.min(i + 5, lines.length); j++) {
                const numMatch = lines[j].match(/₹?\s*([\d,]+\.\d{2})\s*$/);
                if (numMatch) {
                    value = parseIndianNumber(numMatch[1]);
                    break;
                }
            }

            holdings.push({
                isin: match[1],
                name: name || match[1],
                units: 0,
                value: value,
                type: inferTypeFromISIN(match[1]),
                folioNumber: '',
                dpId: ''
            });
        }
    }

    return holdings;
}


// ════════════════════════════════════════════════════════════════
//  NORMALIZATION — Convert parsed holdings to our app's shape
// ════════════════════════════════════════════════════════════════

function normalizeToInvestments(parsed) {
    return parsed.holdings.map((h, idx) => {
        // Refine type using name-based heuristics
        const refinedType = inferTypeFromName(h.name, h.type);

        return {
            id: Date.now() + idx,
            name:           h.name || h.isin || 'Unknown',
            type:           refinedType,
            issuer:         extractIssuerFromName(h.name),
            amount:         h.value || 0,        // Backward compat: amount = market value
            rate:           0,                    // Unknown from CAS — user can edit later
            payout:         refinedType === 'Mutual Fund' ? 'Cumulative' : 'Annual',
            rating:         '',                   // Not in CAS
            maturityDate:   '',                   // Not in CAS summary (only in transaction details)

            // ── Phase 5 extended fields ──
            isin:           h.isin || '',
            units:          h.units || 0,
            nav:            h.nav || 0,
            currentValue:   h.value || 0,
            folioNumber:    h.folioNumber || '',
            dpId:           h.dpId || '',
            importSource:   parsed.type,
            importDate:     new Date().toISOString().slice(0, 10),
            transactions:   []
        };
    });
}

/**
 * Extract a rough issuer name from the full security name.
 * E.g., "Bajaj Finance Limited 9.5% NCD" → "Bajaj Finance"
 */
function extractIssuerFromName(name) {
    if (!name) return '';
    // Remove common suffixes
    let issuer = name
        .replace(/\b(Limited|Ltd|Pvt|Private|Inc|Corp|NCD|Bond|ETF|Fund|Growth|Direct|Regular|Plan|Option|Dividend|IDCW)\b/gi, '')
        .replace(/\d+\.?\d*%/g, '')  // Remove rate percentages
        .replace(/\s{2,}/g, ' ')
        .trim();
    // Take first 2-3 words as issuer name
    const words = issuer.split(/\s+/);
    return words.slice(0, Math.min(3, words.length)).join(' ');
}


// ════════════════════════════════════════════════════════════════
//  MAIN ENTRY POINT — Called by app.js
// ════════════════════════════════════════════════════════════════

/**
 * Parse a PDF statement's text and return normalized investment data.
 * @param {string} text - Raw text extracted from PDF by pdf.js
 * @returns {{ type: string, investor: object, holdings: object[], investments: object[] }}
 */
function parseStatement(text) {
    const type = detectStatementType(text);

    if (type === 'UNKNOWN') {
        return {
            type: 'UNKNOWN',
            error: 'Could not identify this PDF. Supported formats: CDSL CAS, NSDL CAS, CAMS MF Statement, KFintech MF Statement.',
            investor: {},
            holdings: [],
            investments: []
        };
    }

    let parsed;
    switch (type) {
        case 'CDSL_CAS':    parsed = parseCDSL(text);     break;
        case 'NSDL_CAS':    parsed = parseNSDL(text);     break;
        case 'CAMS_MF':     parsed = parseCAMS(text);     break;
        case 'KFINTECH_MF': parsed = parseKFintech(text); break;
        default:            parsed = { type, investor: {}, holdings: [] };
    }

    const investments = normalizeToInvestments(parsed);

    return {
        type: parsed.type,
        investor: parsed.investor,
        holdings: parsed.holdings,
        investments: investments
    };
}

// Expose to global scope (loaded via <script> tag, not a module)
window.RFMParser = {
    parseStatement,
    detectStatementType,
    parseIndianNumber
};
