import * as cheerio from "cheerio";

const BASE = "https://results.eci.gov.in/ResultAcGenMay2026";
const PAGE_NUMS = Array.from({ length: 12 }, (_, i) => i + 1);
const OUT = "results.csv";

const HEADERS = [
  "State",
  "Constituency",
  "Const. No.",
  "Leading Candidate",
  "Leading Party",
  "Trailing Candidate",
  "Trailing Party",
  "Margin",
  "Current Round",
  "Total Rounds",
  "Status",
];

function csvEscape(v: string) {
  return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

async function scrapePage(n: number): Promise<string[][]> {
  const url = `${BASE}/statewiseS22${n}.htm`;
  const res = await fetch(url, {
    headers: {
      "User-Agent": "curl/8.4.0",
      "Accept": "*/*",
    },
  });
  if (!res.ok) throw new Error(`${url} -> HTTP ${res.status}`);
  const html = await res.text();
  const $ = cheerio.load(html);

  const state = $("h2 span").first().text().trim();
  const table = $("table.table.table-striped.table-bordered").first();
  const trs = table.find("tr").filter((_, tr) => $(tr).children("td").length === 9).toArray();

  const rows: string[][] = [];
  for (const tr of trs) {
    const tds = $(tr).children("td");
    const cell = (i: number) => {
      const $td = tds.eq(i);
      const inner = $td.children("table").first();
      const text = inner.length
        ? inner.find("tbody > tr > td").first().text().trim()
        : $td.text().trim();
      return text.replace(/\s+/g, " ");
    };
    const round = cell(7);
    const [cur, total] = round.includes("/") ? round.split("/") : [round, ""];
    rows.push([
      state,
      cell(0), cell(1), cell(2), cell(3), cell(4), cell(5), cell(6),
      cur.trim(), total.trim(),
      cell(8),
    ]);
  }
  console.error(`page ${n}: ${rows.length} rows`);
  return rows;
}

const all = (await Promise.all(PAGE_NUMS.map(scrapePage))).flat();
const csv = [HEADERS, ...all].map(r => r.map(csvEscape).join(",")).join("\n") + "\n";
await Bun.write(OUT, csv);
console.error(`wrote ${all.length} rows -> ${OUT}`);
