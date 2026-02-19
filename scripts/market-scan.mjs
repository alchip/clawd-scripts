#!/usr/bin/env node
/**
 * market-scan.mjs
 *
 * Lightweight 30-min scanner for US + HK using:
 * - US: stooq (free, delayed EOD-ish bars)
 * - HK: optional IBKR Client Portal Gateway (when available)
 * Produces a short actionable watchlist (max 4 symbols) + simple risk-managed trade plan.
 *
 * NOTE: This is NOT auto-trading. It only generates a suggested plan.
 */

import process from 'node:process';
import fs from 'node:fs';
import path from 'node:path';

const args = new Set(process.argv.slice(2));
const market = (process.argv.find(a => a.startsWith('--market='))?.split('=')[1] || 'us').toLowerCase();

const TZ = 'Asia/Shanghai';

function nowShanghai() {
  // Use Intl to avoid external deps.
  const fmt = new Intl.DateTimeFormat('en-GB', {
    timeZone: TZ,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hour12: false,
  });
  const parts = Object.fromEntries(fmt.formatToParts(new Date()).map(p => [p.type, p.value]));
  // yyyy-mm-dd hh:mm:ss
  return {
    y: Number(parts.year),
    mo: Number(parts.month),
    d: Number(parts.day),
    hh: Number(parts.hour),
    mm: Number(parts.minute),
    ss: Number(parts.second),
    iso: `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}:${parts.second} ${TZ}`,
    dow: new Date(new Date().toLocaleString('en-US', { timeZone: TZ })).getDay(), // 0 Sun..6 Sat (approx)
  };
}

function inWindow(mkt, t) {
  const mins = t.hh * 60 + t.mm;
  // 0=Sun,6=Sat
  const weekend = (t.dow === 0 || t.dow === 6);
  if (weekend) return false;

  if (mkt === 'hk') {
    // HKEX: 09:30–12:00, 13:00–16:00 Shanghai time
    const am = mins >= (9*60+30) && mins <= (12*60);
    const pm = mins >= (13*60) && mins <= (16*60);
    return am || pm;
  }

  if (mkt === 'us') {
    // US market hours shift with DST. Without a market calendar, we approximate:
    // - Regular: 21:30–04:00 (summer) OR 22:30–05:00 (winter)
    // We'll treat as open if within either window.
    const winA = (mins >= (21*60+30)) || (mins <= (4*60));
    const winB = (mins >= (22*60+30)) || (mins <= (5*60));
    return winA || winB;
  }

  return false;
}

function pct(n) {
  if (n == null || Number.isNaN(n)) return null;
  return Math.round(n * 100) / 100;
}

// IBKR Client Portal Gateway uses a self-signed cert. We disable TLS verification for this process.
// This script only talks to localhost.
if (!process.env.NODE_TLS_REJECT_UNAUTHORIZED) {
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
}

async function stooqQuote(symbols, { market } = {}) {
  // Stooq is free, but:
  // - US symbols use suffix .us (case-insensitive)
  // - HK symbols are not available on stooq (returns N/D)
  if (market === 'hk') {
    throw new Error('HK quotes not available from stooq.');
  }

  async function fetchOne(symRaw) {
    const sym = symRaw.toLowerCase() + '.us';
    const url = `https://stooq.com/q/l/?s=${encodeURIComponent(sym)}&f=sd2t2ohlcv&h&e=csv`;
    const res = await fetch(url, {
      headers: {
        'user-agent': 'clawdbot-market-scan/1.0',
        'accept': 'text/csv,*/*',
      }
    });
    if (!res.ok) throw new Error(`Stooq quote failed for ${symRaw}: ${res.status} ${res.statusText}`);
    const csv = (await res.text()).trim();
    const lines = csv.split(/\r?\n/);
    if (lines.length < 2) return null;
    const header = lines[0].split(',');
    const cols = lines[1].split(',');
    const idx = Object.fromEntries(header.map((h,i)=>[h,i]));

    const close = cols[idx.Close];
    if (!close || close === 'N/D') return null;

    const open = cols[idx.Open];
    const vol = cols[idx.Volume];
    const price = Number(close);
    const prevClose = (open && open !== 'N/D') ? Number(open) : null; // best-effort
    const changePct = (prevClose && price) ? ((price - prevClose) / prevClose * 100) : null;

    return {
      symbol: symRaw.toUpperCase(),
      name: symRaw.toUpperCase(),
      price,
      prevClose,
      changePct,
      volume: vol && vol !== 'N/D' ? Number(vol) : null,
      currency: 'USD',
      exchange: 'US',
      marketTime: null,
    };
  }

  const concurrency = 6;
  const queue = [...symbols];
  const out = [];
  const workers = Array.from({ length: Math.min(concurrency, queue.length) }, async () => {
    while (queue.length) {
      const sym = queue.shift();
      try {
        const q = await fetchOne(sym);
        if (q) out.push(q);
      } catch {
        // ignore single-symbol failures
      }
    }
  });
  await Promise.all(workers);
  return out;
}

function scoreSector(q) {
  // Simple momentum score: today % change + liquidity proxy (log volume)
  const ch = Number(q.changePct ?? 0);
  const vol = Number(q.volume ?? 0);
  const volScore = vol > 0 ? Math.min(2, Math.log10(vol) / 3) : 0; // 0..~2
  return ch + volScore;
}

function scoreStock(q, sectorScore) {
  const ch = Number(q.changePct ?? 0);
  const vol = Number(q.volume ?? 0);
  const volScore = vol > 0 ? Math.min(2.5, Math.log10(vol) / 3) : 0;
  // Prefer up-trending; penalize large negative movers.
  const trend = ch >= 0 ? ch : ch * 1.2;
  return (0.6 * sectorScore) + (0.8 * trend) + (0.3 * volScore);
}

function plan(q, accountUsd = 2000) {
  // Defaults tuned to your constraints:
  const maxPositions = 4;
  const targetNotional = accountUsd / maxPositions; // ~500
  const riskPerTradeUsd = accountUsd * 0.01; // $20
  const stopPct = 0.04; // 4%
  const takePct = 0.08; // 8%

  const price = Number(q.price);
  if (!price || price <= 0) return null;

  const stop = price * (1 - stopPct);
  const take = price * (1 + takePct);

  // shares based on risk, capped by notional
  const perShareRisk = price - stop;
  let sharesByRisk = Math.floor(riskPerTradeUsd / perShareRisk);
  if (!Number.isFinite(sharesByRisk) || sharesByRisk < 1) sharesByRisk = 1;

  const sharesByNotional = Math.max(1, Math.floor(targetNotional / price));
  const shares = Math.max(1, Math.min(sharesByRisk, sharesByNotional));

  return {
    targetNotional: Math.round(targetNotional),
    riskPerTradeUsd: Math.round(riskPerTradeUsd),
    shares,
    entry: price,
    stop: stop,
    take: take,
    stopPct: stopPct * 100,
    takePct: takePct * 100,
  };
}

function fmtMoney(x) {
  if (x == null || Number.isNaN(x)) return 'n/a';
  const n = Math.round(x * 100) / 100;
  return n.toLocaleString('en-US', { maximumFractionDigits: 2 });
}

function topN(arr, n) {
  return [...arr].sort((a,b) => (b.score - a.score)).slice(0, n);
}

function hkBaseSymbol(sym) {
  // Accept forms like 0700.HK, 700.HK, 9988.HK, 2800.HK
  return sym.toUpperCase().replace(/\.HK$/,'').replace(/^0+/, '') || '0';
}

async function ibkrSecdefConidHK(symbol) {
  const base = hkBaseSymbol(symbol);
  const url = `https://localhost:5005/v1/api/iserver/secdef/search?symbol=${encodeURIComponent(base)}&name=false&secType=STK`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`IBKR secdef search failed (${base}): ${res.status}`);
  const arr = await res.json();
  const hit = (arr || []).find(x => (x.companyHeader || '').includes('(SEHK)')) || (arr || [])[0];
  if (!hit?.conid) throw new Error(`IBKR: no conid for ${symbol} (base=${base})`);
  return String(hit.conid);
}

async function ibkrSsoValidate() {
  // CP Gateway sometimes needs an explicit validate call after browser login.
  const url = 'https://localhost:5005/v1/api/sso/validate';
  const res = await fetch(url);
  if (!res.ok) throw new Error(`IBKR sso/validate failed: ${res.status}`);
  return await res.json();
}

async function ibkrAuthStatus() {
  const url = 'https://localhost:5005/v1/api/iserver/auth/status';
  let res = await fetch(url);

  // If the user just logged in via the web UI, the gateway may still require
  // a validate step before API calls return 200.
  if (res.status === 401) {
    try {
      await ibkrSsoValidate();
    } catch {
      // ignore; we'll retry auth/status and surface the real status if still failing
    }
    res = await fetch(url);
  }

  if (!res.ok) throw new Error(`IBKR auth status failed: ${res.status}`);
  return await res.json();
}

async function ibkrQuoteHK(symbols) {
  // Ensure the brokerage bridge is up; otherwise snapshot calls fail with "no bridge".
  const st = await ibkrAuthStatus();
  if (!st?.authenticated || !st?.connected) {
    // Caller will decide whether to print NO_REPLY or verbose hints.
    const err = new Error('IBKR gateway not connected (auth/status unauthenticated). Open https://localhost:5005 and login (Client login succeeds).');
    err.code = 'IBKR_NOT_CONNECTED';
    throw err;
  }

  // Cache conids to reduce API calls.
  const cachePath = path.join(process.env.HOME || '', '.openclaw', 'tmp', 'ibkr-hk-conids.json');
  let cache = {};
  try { cache = JSON.parse(fs.readFileSync(cachePath, 'utf8')); } catch {}

  const need = [];
  for (const s of symbols) {
    if (!cache[s]) need.push(s);
  }
  for (const s of need) {
    try {
      cache[s] = await ibkrSecdefConidHK(s);
    } catch {
      // leave missing
    }
  }
  try {
    fs.mkdirSync(path.dirname(cachePath), { recursive: true });
    fs.writeFileSync(cachePath, JSON.stringify(cache, null, 2));
  } catch {}

  const conids = symbols.map(s => cache[s]).filter(Boolean);
  if (conids.length === 0) return [];

  const fields = ['31','83','87','70','71','55'];
  const url = `https://localhost:5005/v1/api/iserver/marketdata/snapshot?conids=${encodeURIComponent(conids.join(','))}&fields=${encodeURIComponent(fields.join(','))}`;
  async function snap() {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`IBKR snapshot failed: ${res.status}`);
    return await res.json();
  }

  let rows = await snap();
  // Sometimes the first call returns only conid; retry briefly.
  for (let i = 0; i < 3; i++) {
    const ok = (rows || []).some(r => r && (r['31'] != null || r['84'] != null));
    if (ok) break;
    await new Promise(r => setTimeout(r, 400));
    rows = await snap();
  }

  // Reverse-map conid -> original symbol
  const symByConid = new Map();
  for (const s of symbols) {
    const c = cache[s];
    if (c) symByConid.set(Number(c), s.toUpperCase());
  }

  return (rows || []).map(r => {
    const price = Number(r['31'] ?? r['84']);
    const ch = (r['83'] != null) ? Number(r['83']) : null;
    const prevClose = (price && ch != null) ? (price - ch) : null;
    const changePct = (prevClose && ch != null) ? (ch / prevClose * 100) : null;
    return {
      symbol: symByConid.get(Number(r.conid)) || (r['55'] ? `${r['55']}.HK` : String(r.conid)),
      name: symByConid.get(Number(r.conid)) || (r['55'] ? `${r['55']}.HK` : String(r.conid)),
      price: Number.isFinite(price) ? price : null,
      prevClose: Number.isFinite(prevClose) ? prevClose : null,
      changePct: Number.isFinite(changePct) ? changePct : null,
      volume: (r['87_raw'] != null) ? Number(r['87_raw']) : null,
      currency: 'HKD',
      exchange: 'SEHK',
      marketTime: null,
    };
  }).filter(x => x.price);
}

// Optional display names (keep lightweight and offline).
// Stooq quotes do not include company names, so we maintain a small mapping.
const US_NAMES = {
  AAPL: 'Apple',
  MSFT: 'Microsoft',
  NVDA: 'NVIDIA',
  AMD: 'AMD',
  AVGO: 'Broadcom',
  TSM: 'TSMC',
  JPM: 'JPMorgan',
  BAC: 'Bank of America',
  GS: 'Goldman Sachs',
  MS: 'Morgan Stanley',
  WFC: 'Wells Fargo',
  XOM: 'Exxon Mobil',
  CVX: 'Chevron',
  SLB: 'SLB',
  COP: 'ConocoPhillips',
  EOG: 'EOG Resources',
  LLY: 'Eli Lilly',
  UNH: 'UnitedHealth',
  JNJ: 'Johnson & Johnson',
  MRK: 'Merck',
  ABBV: 'AbbVie',
  CAT: 'Caterpillar',
  GE: 'GE Aerospace',
  BA: 'Boeing',
  HON: 'Honeywell',
  RTX: 'RTX',
  AMZN: 'Amazon',
  TSLA: 'Tesla',
  HD: 'Home Depot',
  MCD: "McDonald's",
  NKE: 'Nike',
};

const HK_NAMES = {
  '0700.HK': 'Tencent 腾讯',
  '9988.HK': 'Alibaba 阿里巴巴',
  '3690.HK': 'Meituan 美团',
  '0941.HK': 'China Mobile 中国移动',
  '1810.HK': 'Xiaomi 小米',
  '1024.HK': 'Kuaishou 快手',
  '0939.HK': 'CCB 建设银行',
  '1398.HK': 'ICBC 工商银行',
  '3988.HK': 'BOC 中国银行',
  '2318.HK': 'Ping An 平安',
  '2800.HK': 'Tracker Fund 盈富基金',
  '3033.HK': 'HS Tech ETF 恒生科技ETF',
  '2823.HK': 'iShares A50 安硕A50',
};

function displayName(sym) {
  if (!sym) return '';
  const s = sym.toUpperCase();
  if (s.endsWith('.HK')) return HK_NAMES[s] || '';
  return US_NAMES[s] || '';
}

const US_SECTORS = [
  { id: 'Tech', etf: 'XLK', stocks: ['AAPL','MSFT','NVDA','AMD','AVGO','TSM'] },
  { id: 'Financials', etf: 'XLF', stocks: ['JPM','BAC','GS','MS','WFC'] },
  { id: 'Energy', etf: 'XLE', stocks: ['XOM','CVX','SLB','COP','EOG'] },
  { id: 'Health', etf: 'XLV', stocks: ['LLY','UNH','JNJ','MRK','ABBV'] },
  { id: 'Industrials', etf: 'XLI', stocks: ['CAT','GE','BA','HON','RTX'] },
  { id: 'Consumer', etf: 'XLY', stocks: ['AMZN','TSLA','HD','MCD','NKE'] },
];

const HK_SECTORS = [
  { id: 'Broad Market', etf: '2800.HK', stocks: ['0700.HK','9988.HK','3690.HK','0941.HK'] },
  { id: 'Hang Seng Tech', etf: '3033.HK', stocks: ['0700.HK','9988.HK','3690.HK','1810.HK','1024.HK'] },
  { id: 'Financials', etf: '2823.HK', stocks: ['0939.HK','1398.HK','3988.HK','2318.HK'] },
];

async function run() {
  const t = nowShanghai();
  if (!args.has('--force') && !inWindow(market, t)) {
    // Keep cron quiet outside trading windows.
    if (args.has('--verbose')) {
      console.log(`[${t.iso}] ${market.toUpperCase()} outside trading window → NO_REPLY`);
    } else {
      console.log('NO_REPLY');
    }
    return;
  }

  const sectors = (market === 'hk') ? HK_SECTORS : US_SECTORS;

  const sectorEtfs = sectors.map(s => s.etf);
  let etfQuotes;
  try {
    etfQuotes = market === 'hk'
      ? await ibkrQuoteHK(sectorEtfs)
      : await stooqQuote(sectorEtfs, { market });
  } catch (err) {
    if (market === 'hk' && (err?.code === 'IBKR_NOT_CONNECTED')) {
      if (args.has('--verbose')) {
        console.log(`[${t.iso}] HK scan unavailable: IBKR gateway not connected. Please open https://localhost:5005 and login.`);
      } else {
        console.log('NO_REPLY');
      }
      return;
    }
    throw err;
  }
  const etfBySym = new Map(etfQuotes.map(q => [q.symbol, q]));

  const sectorScores = sectors.map(s => {
    const q = etfBySym.get(s.etf) || { symbol: s.etf, changePct: 0, volume: 0 };
    return {
      id: s.id,
      etf: s.etf,
      q,
      score: scoreSector(q),
      stocks: s.stocks,
    };
  });

  const topSectors = topN(sectorScores, 2);
  const candidateSyms = Array.from(new Set(topSectors.flatMap(s => s.stocks)));
  let stockQuotes;
  try {
    stockQuotes = market === 'hk'
      ? await ibkrQuoteHK(candidateSyms)
      : await stooqQuote(candidateSyms, { market });
  } catch (err) {
    if (market === 'hk' && (err?.code === 'IBKR_NOT_CONNECTED')) {
      if (args.has('--verbose')) {
        console.log(`[${t.iso}] HK scan unavailable: IBKR gateway not connected. Please open https://localhost:5005 and login.`);
      } else {
        console.log('NO_REPLY');
      }
      return;
    }
    throw err;
  }
  const stockBySym = new Map(stockQuotes.map(q => [q.symbol, q]));

  const scored = [];
  for (const s of topSectors) {
    for (const sym of s.stocks) {
      const q = stockBySym.get(sym);
      if (!q?.price) continue;
      const score = scoreStock(q, s.score);
      scored.push({ sector: s.id, sym, q, score });
    }
  }

  // Pick top 4 unique symbols (avoid duplicates across sectors)
  const picks = [];
  const seen = new Set();
  for (const p of topN(scored, 20)) {
    if (seen.has(p.sym)) continue;
    seen.add(p.sym);
    picks.push(p);
    if (picks.length >= 4) break;
  }

  const mktLabel = market === 'us' ? 'US 美股' : market === 'hk' ? 'HK 港股' : market.toUpperCase();
  const header = `[${t.iso}] Scan ${mktLabel} (delayed 延迟) — Top sectors 行业: ` +
    topSectors
      .map(s => {
        const nm = displayName(s.etf);
        const etfLabel = nm ? `${s.etf} (${nm})` : s.etf;
        return `${s.id}(${etfLabel} ${pct(s.q.changePct) ?? 0}%)`;
      })
      .join(', ');

  console.log(header);
  console.log('');

  if (picks.length === 0) {
    console.log('No candidates (data unavailable).');
    return;
  }

  for (const p of picks) {
    const q = p.q;
    const pl = plan(q);
    const ch = pct(q.changePct);
    const vol = q.volume ? q.volume.toLocaleString('en-US') : 'n/a';

    const nm = displayName(p.sym);
    console.log(`- ${p.sym}${nm ? ` (${nm})` : ''} — ${p.sector}（行业）`);
    console.log(`  px 现价: ${fmtMoney(q.price)} ${q.currency || ''} | chg 涨跌: ${ch ?? 'n/a'}% | vol 成交量: ${vol}`);
    if (pl) {
      console.log(`  plan 计划: BUY <= ${fmtMoney(pl.entry)} | stop 止损 ${fmtMoney(pl.stop)} (-${pl.stopPct}%) | take 止盈 ${fmtMoney(pl.take)} (+${pl.takePct}%)`);
      console.log(`  size 仓位: ~${pl.shares} 股 (target 目标 ~$${pl.targetNotional}, risk 风险 ~$${pl.riskPerTradeUsd}/trade)`);
    } else {
      console.log('  plan: n/a（缺少价格）');
    }
  }

  console.log('');
  console.log('Risk rules 风控: max 4 positions; per-trade risk ~1% (~$20); stop -4%; account DD stop -10% (-$200) → stop opening new trades.');
}

run().catch(err => {
  console.error('market-scan error:', err?.stack || err?.message || String(err));
  process.exitCode = 1;
});
