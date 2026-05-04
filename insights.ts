// Reads results.csv, writes docs/insights.json.
// Alliance config sourced from the 2026 TN election Wikipedia page.

const ALLIANCES: Record<string, { name: string; parties: string[] }> = {
  DMK_FRONT: {
    name: "DMK-led INDIA Alliance",
    parties: [
      "Dravida Munnetra Kazhagam",
      "Indian National Congress",
      "Viduthalai Chiruthaigal Katchi",
      "Communist Party of India",
      "Communist Party of India (Marxist)",
      "Indian Union Muslim League",
      "Desiya Murpokku Dravida Kazhagam",
      "Marumalarchi Dravida Munnetra Kazhagam",
      "Kongunadu Makkal Desia Katchi",
    ],
  },
  AIADMK_FRONT: {
    name: "AIADMK-led NDA",
    parties: [
      "All India Anna Dravida Munnetra Kazhagam",
      "Bharatiya Janata Party",
      "Pattali Makkal Katchi",
      "Amma Makkal Munnettra Kazagam", // ECI spelling
    ],
  },
  TVK: { name: "TVK", parties: ["Tamilaga Vettri Kazhagam"] },
  NTK: { name: "NTK", parties: ["Naam Tamilar Katchi"] },
};

const MARGIN_BUCKETS: { label: string; max: number }[] = [
  { label: "< 1,000", max: 1_000 },
  { label: "1,000 – 5,000", max: 5_000 },
  { label: "5,000 – 10,000", max: 10_000 },
  { label: "10,000 – 25,000", max: 25_000 },
  { label: "25,000 – 50,000", max: 50_000 },
  { label: "50,000+", max: Infinity },
];

function parseCsv(text: string): Record<string, string>[] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') inQuotes = false;
      else field += c;
    } else {
      if (c === '"') inQuotes = true;
      else if (c === ",") { row.push(field); field = ""; }
      else if (c === "\n") { row.push(field); rows.push(row); row = []; field = ""; }
      else if (c === "\r") {/* skip */}
      else field += c;
    }
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  const [header, ...data] = rows.filter(r => r.length > 1 || (r.length === 1 && r[0]));
  return data.map(r => Object.fromEntries(header.map((h, i) => [h, r[i] ?? ""])));
}

const csvText = await Bun.file("results.csv").text();
const records = parseCsv(csvText);

// Party aggregates — including knife-edge (<1k margin) leads and trails
type PartyAgg = { party: string; won: number; leading: number; leadingUnder1k: number; trailingUnder1k: number };
const partyMap = new Map<string, PartyAgg>();
const ensureParty = (name: string): PartyAgg => {
  if (!partyMap.has(name))
    partyMap.set(name, { party: name, won: 0, leading: 0, leadingUnder1k: 0, trailingUnder1k: 0 });
  return partyMap.get(name)!;
};
for (const r of records) {
  const margin = parseInt(r["Margin"] || "0", 10);
  const lead = r["Leading Party"];
  const trail = r["Trailing Party"];
  if (lead) {
    const e = ensureParty(lead);
    if (r["Status"] === "Result Declared") e.won++; else e.leading++;
    if (margin < 1_000) e.leadingUnder1k++;
  }
  if (trail) {
    const e = ensureParty(trail);
    if (margin < 1_000) e.trailingUnder1k++;
  }
}
const partyResults = [...partyMap.values()]
  .filter(p => p.won + p.leading > 0)
  .map(p => ({ ...p, total: p.won + p.leading }))
  .sort((a, b) => b.total - a.total);

// Alliance aggregates — track cushion (votes ahead in seats they lead)
// and gap (votes behind in seats they trail).
const partyToAlliance = new Map<string, string>();
for (const a of Object.values(ALLIANCES))
  for (const p of a.parties) partyToAlliance.set(p, a.name);
const allianceOf = (party: string) => partyToAlliance.get(party) ?? "Others / Unaligned";

type AllianceAgg = {
  alliance: string;
  parties: Set<string>;
  won: number;
  leading: number;
  cushionVotes: number;       // sum of margins in seats this alliance leads
  gapVotes: number;           // sum of margins in seats this alliance trails
  flippableUnder1k: number;   // seats trailing by < 1,000 (easy to flip)
  flippableUnder5k: number;   // seats trailing by < 5,000
  vulnerableUnder1k: number;  // leading seats with margin < 1,000 (could lose)
};

const allianceMap = new Map<string, AllianceAgg>();
const ensure = (name: string): AllianceAgg => {
  if (!allianceMap.has(name))
    allianceMap.set(name, {
      alliance: name, parties: new Set(),
      won: 0, leading: 0,
      cushionVotes: 0, gapVotes: 0,
      flippableUnder1k: 0, flippableUnder5k: 0, vulnerableUnder1k: 0,
    });
  return allianceMap.get(name)!;
};
for (const a of Object.values(ALLIANCES)) ensure(a.name);

for (const r of records) {
  const margin = parseInt(r["Margin"] || "0", 10);
  const leadAlliance = allianceOf(r["Leading Party"]);
  const trailAlliance = allianceOf(r["Trailing Party"]);

  const lead = ensure(leadAlliance);
  lead.parties.add(r["Leading Party"]);
  if (r["Status"] === "Result Declared") lead.won++; else lead.leading++;
  lead.cushionVotes += margin;
  if (margin < 1_000) lead.vulnerableUnder1k++;

  if (trailAlliance !== leadAlliance) {
    const trail = ensure(trailAlliance);
    trail.gapVotes += margin;
    if (margin < 1_000) trail.flippableUnder1k++;
    if (margin < 5_000) trail.flippableUnder5k++;
  }
}

const allianceResults = [...allianceMap.values()]
  .map(a => ({
    alliance: a.alliance,
    parties: [...a.parties].sort(),
    won: a.won,
    leading: a.leading,
    total: a.won + a.leading,
    cushionVotes: a.cushionVotes,
    gapVotes: a.gapVotes,
    flippableUnder1k: a.flippableUnder1k,
    flippableUnder5k: a.flippableUnder5k,
    vulnerableUnder1k: a.vulnerableUnder1k,
  }))
  .filter(a => a.total > 0 || a.gapVotes > 0)
  .sort((a, b) => b.total - a.total);

// Margin buckets — track per-alliance breakdown for tooltip
const buckets = MARGIN_BUCKETS.map(b => ({
  label: b.label, max: b.max, count: 0,
  byAlliance: {} as Record<string, number>,
  byParty: {} as Record<string, number>,
}));
for (const r of records) {
  const m = parseInt(r["Margin"] || "0", 10);
  if (!Number.isFinite(m)) continue;
  const bucket = buckets.find(b => m < b.max)!;
  bucket.count++;
  const alliance = allianceOf(r["Leading Party"]);
  bucket.byAlliance[alliance] = (bucket.byAlliance[alliance] ?? 0) + 1;
  bucket.byParty[r["Leading Party"]] = (bucket.byParty[r["Leading Party"]] ?? 0) + 1;
}
const marginBuckets = buckets.map(({ label, count, byAlliance, byParty }) => ({
  label, count, byAlliance, byParty,
}));

// Closest contests — only in-progress races (declared results can't flip)
const closest = records
  .map(r => ({
    constituency: r["Constituency"],
    constNo: r["Const. No."],
    leadingCandidate: r["Leading Candidate"],
    leadingParty: r["Leading Party"],
    trailingCandidate: r["Trailing Candidate"],
    trailingParty: r["Trailing Party"],
    margin: parseInt(r["Margin"] || "0", 10),
    round: `${r["Current Round"]}/${r["Total Rounds"]}`,
    status: r["Status"],
  }))
  .filter(r => r.status !== "Result Declared" && Number.isFinite(r.margin) && r.margin > 0)
  .sort((a, b) => a.margin - b.margin)
  .slice(0, 15);

// In-progress races within 1,000 votes — these are the actually-flippable seats
const razorActiveCount = records.filter(r => {
  const m = parseInt(r["Margin"] || "0", 10);
  return r["Status"] !== "Result Declared" && Number.isFinite(m) && m > 0 && m < 1_000;
}).length;

// Razor swing summary — across the 15 closest contests
const closestSummary = (() => {
  const acc: Record<string, { couldLose: number; couldGain: number; loseVotes: number; gainVotes: number }> = {};
  const ensure = (name: string) => acc[name] ||= { couldLose: 0, couldGain: 0, loseVotes: 0, gainVotes: 0 };
  for (const r of closest) {
    const lead = allianceOf(r.leadingParty);
    const trail = allianceOf(r.trailingParty);
    const e1 = ensure(lead);
    e1.couldLose++; e1.loseVotes += r.margin;
    if (trail !== lead) {
      const e2 = ensure(trail);
      e2.couldGain++; e2.gainVotes += r.margin;
    }
  }
  return Object.entries(acc)
    .map(([alliance, v]) => ({ alliance, ...v, net: v.couldGain - v.couldLose }))
    .sort((a, b) => b.net - a.net);
})();

// Status counts
const statusCounts: Record<string, number> = {};
for (const r of records) statusCounts[r["Status"]] = (statusCounts[r["Status"]] ?? 0) + 1;

// Superlatives: biggest and smallest winning margins right now
const sortedByMargin = [...records]
  .map(r => ({
    constituency: r["Constituency"],
    constNo: r["Const. No."],
    leadingCandidate: r["Leading Candidate"],
    leadingParty: r["Leading Party"],
    trailingCandidate: r["Trailing Candidate"],
    trailingParty: r["Trailing Party"],
    margin: parseInt(r["Margin"] || "0", 10),
    round: `${r["Current Round"]}/${r["Total Rounds"]}`,
    status: r["Status"],
  }))
  .filter(r => Number.isFinite(r.margin) && r.margin > 0);
const superlatives = {
  biggestMargin: sortedByMargin.slice().sort((a, b) => b.margin - a.margin)[0],
  smallestMargin: sortedByMargin.slice().sort((a, b) => a.margin - b.margin)[0],
};

// Counting progress
let roundsDone = 0, roundsTotal = 0, constituenciesComplete = 0;
for (const r of records) {
  const cur = parseInt(r["Current Round"] || "0", 10);
  const tot = parseInt(r["Total Rounds"] || "0", 10);
  if (Number.isFinite(cur)) roundsDone += cur;
  if (Number.isFinite(tot)) roundsTotal += tot;
  if (cur > 0 && cur === tot) constituenciesComplete++;
}
const countingProgress = {
  roundsDone,
  roundsTotal,
  pct: roundsTotal ? Math.round((roundsDone / roundsTotal) * 1000) / 10 : 0,
  constituenciesComplete,
};

// Full contest lookup keyed by uppercased constituency name (for VIP cards, etc.)
const contests: Record<string, any> = {};
for (const r of records) {
  contests[r["Constituency"].toUpperCase()] = {
    constituency: r["Constituency"],
    constNo: r["Const. No."],
    leadingCandidate: r["Leading Candidate"],
    leadingParty: r["Leading Party"],
    trailingCandidate: r["Trailing Candidate"],
    trailingParty: r["Trailing Party"],
    margin: parseInt(r["Margin"] || "0", 10),
    round: `${r["Current Round"]}/${r["Total Rounds"]}`,
    status: r["Status"],
  };
}

const insights = {
  generatedAt: new Date().toISOString(),
  state: records[0]?.["State"] ?? "",
  totals: {
    constituencies: records.length,
    declared: statusCounts["Result Declared"] ?? 0,
    inProgress: statusCounts["Result in Progress"] ?? 0,
  },
  partyResults,
  allianceResults,
  marginBuckets,
  closestContests: closest,
  closestSummary,
  razorActiveCount,
  contests,
  countingProgress,
  superlatives,
};

await Bun.write("docs/insights.json", JSON.stringify(insights, null, 2));
console.error(`wrote docs/insights.json (${records.length} constituencies, ${partyResults.length} parties, ${allianceResults.length} alliances)`);
