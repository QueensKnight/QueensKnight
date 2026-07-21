// generate-circuit.mjs
// Fetches real contribution data for GH_USERNAME using GH_TOKEN, computes
// stats + weekly totals, and renders both SVG variants to dist/.
//
// Required env vars:
//   GH_USERNAME  - the GitHub login to report on (e.g. "QueensKnight")
//   GH_TOKEN     - a token with at least `read:user` scope (classic PAT).
//                  Add `repo` too if you want private contributions counted.

import { mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { buildCircuitSvg } from "./svg-template.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));

const USERNAME = process.env.GH_USERNAME;
const TOKEN = process.env.GH_TOKEN;

if (!USERNAME || !TOKEN) {
  console.error(
    "Missing GH_USERNAME or GH_TOKEN. Set them as repo secrets and pass them " +
      "into this step's `env:` block — see .github/workflows/circuit-pulse.yml."
  );
  process.exit(1);
}

const QUERY = `
  query($login: String!) {
    user(login: $login) {
      contributionsCollection {
        contributionCalendar {
          totalContributions
          weeks {
            contributionDays {
              date
              contributionCount
            }
          }
        }
      }
    }
  }
`;

async function fetchCalendar() {
  const res = await fetch("https://api.github.com/graphql", {
    method: "POST",
    headers: {
      Authorization: `bearer ${TOKEN}`,
      "Content-Type": "application/json",
      "User-Agent": "circuit-pulse-generator",
    },
    body: JSON.stringify({ query: QUERY, variables: { login: USERNAME } }),
  });

  if (!res.ok) {
    throw new Error(`GitHub GraphQL request failed: ${res.status} ${res.statusText}`);
  }
  const json = await res.json();
  if (json.errors) {
    throw new Error(`GitHub GraphQL errors: ${JSON.stringify(json.errors)}`);
  }
  return json.data.user.contributionsCollection.contributionCalendar;
}

function computeStats(calendar) {
  const days = calendar.weeks.flatMap((w) => w.contributionDays);

  let longestStreak = 0;
  let run = 0;
  let activeDays = 0;
  for (const d of days) {
    if (d.contributionCount > 0) {
      run += 1;
      activeDays += 1;
      if (run > longestStreak) longestStreak = run;
    } else {
      run = 0;
    }
  }

  // current streak: walk backward from the most recent day
  let i = days.length - 1;
  let currentStreak = 0;
  while (i >= 0 && days[i].contributionCount > 0) {
    currentStreak += 1;
    i -= 1;
  }

  const weeklyTotals = calendar.weeks.map((w) =>
    w.contributionDays.reduce((sum, d) => sum + d.contributionCount, 0)
  );

  return {
    totalContributions: calendar.totalContributions,
    longestStreak,
    currentStreak,
    activeDays,
    weeklyTotals,
  };
}

async function main() {
  console.log(`Fetching contribution calendar for ${USERNAME}...`);
  const calendar = await fetchCalendar();
  const { weeklyTotals, ...stats } = computeStats(calendar);

  const tech = JSON.parse(readFileSync(join(__dirname, "tech.config.json"), "utf8"));

  const outDir = join(__dirname, "..", "dist");
  mkdirSync(outDir, { recursive: true });

  for (const mode of ["dark", "light"]) {
    const svg = buildCircuitSvg({ mode, stats, weeklyTotals, tech, handle: USERNAME.toLowerCase() });
    const outPath = join(outDir, `circuit-${mode}.svg`);
    writeFileSync(outPath, svg, "utf8");
    console.log(`wrote ${outPath}`);
  }

  console.log(
    `stats: total=${stats.totalContributions} streak=${stats.currentStreak}d ` +
      `longest=${stats.longestStreak}d active=${stats.activeDays}`
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});