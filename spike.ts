import * as cheerio from "cheerio";

const html = await Bun.file("/tmp/eci-spike.html").text();
const $ = cheerio.load(html);

const state = $("h2 span").first().text().trim();
const table = $("table.table.table-striped.table-bordered").first();

const trs = table.find("tr").filter((_, tr) => $(tr).children("td").length === 9).toArray();
console.log("State:", state, "| Rows:", trs.length);

const parsed: string[][] = [];
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
  parsed.push([cell(0), cell(1), cell(2), cell(3), cell(4), cell(5), cell(6), cur.trim(), total.trim(), cell(8)]);
}

console.log(JSON.stringify(parsed.slice(0, 2), null, 2));
