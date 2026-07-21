// svg-template.mjs
// Pure SVG builder for the "Circuit Pulse" profile visualization.
// Takes real contribution + stack data in, returns a finished animated SVG string.
// No network calls live here — keeps this file testable in isolation.

const PALETTE = {
  dark: {
    bg0: "#0d1117",
    bg1: "#0a0d12",
    grid: "#161b22",
    text: "#c9d1d9",
    dim: "#6b7280",
    trace: "#233047",
    lang: "#39ff14",
    stack: "#00fff9",
    tool: "#bc13fe",
    core: "#f5d90a",
  },
  light: {
    bg0: "#f6f8fa",
    bg1: "#ffffff",
    grid: "#e3e8ee",
    text: "#1b1f24",
    dim: "#57606a",
    trace: "#c7d0dc",
    lang: "#0a8f2e",
    stack: "#0089a8",
    tool: "#8b16c9",
    core: "#a3760a",
  },
};

const W = 960;
const H = 480;

// node geometry — kept as named constants so spine/stub math can't drift
// out of sync the way it did in the first draft (nodes were overlapping
// their own spines because the stub offset was smaller than half the
// node width). spineOffset MUST be > nodeW/2 + a visible stub length.
const NODE_W = 118;
const NODE_H = 28;
const STUB = 24;
const SPINE_OFFSET = NODE_W / 2 + STUB; // 83

// ---- layout helpers -------------------------------------------------

function columnLayout(items, colX, centerY, gap) {
  const n = items.length;
  const startY = centerY - ((n - 1) * gap) / 2;
  return items.map((label, i) => ({
    label,
    x: colX,
    y: startY + i * gap,
  }));
}

// orthogonal "PCB" path from the CPU pin, along the main bus, up/down the
// column spine, into the node. Used both as the visible trace and as the
// motion guide for the animated pulse.
function tracePath(cpuPin, spineX, nodeY, nodeLeftX) {
  return `M ${cpuPin.x} ${cpuPin.y} L ${spineX} ${cpuPin.y} L ${spineX} ${nodeY} L ${nodeLeftX} ${nodeY}`;
}

function escapeXml(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// ---- main build -------------------------------------------------------

/**
 * @param {"dark"|"light"} mode
 * @param {object} stats  { totalContributions, currentStreak, longestStreak, activeDays }
 * @param {number[]} weeklyTotals  52 values, oldest -> newest
 * @param {{languages:string[], stack:string[], tools:string[]}} tech
 * @param {string} handle  display handle for the CPU chip label
 */
export function buildCircuitSvg({ mode, stats, weeklyTotals, tech, handle }) {
  const c = PALETTE[mode];

  const centerY = 210;
  const cpu = { x: 60, w: 92, h: 92 };
  cpu.y = centerY - cpu.h / 2;
  const cpuPin = { x: cpu.x + cpu.w, y: centerY };

  const columns = [
    { key: "lang", title: "LANGUAGES", items: tech.languages, x: 340, color: c.lang },
    { key: "stack", title: "STACK", items: tech.stack, x: 610, color: c.stack },
    { key: "tool", title: "TOOLS", items: tech.tools, x: 880, color: c.tool },
  ];

  const gap = 46;

  const laidOut = columns.map((col) => ({
    ...col,
    nodes: columnLayout(col.items, col.x, centerY, gap),
  }));

  // ---- speed of the data pulses, driven by real recent activity ----
  const recentAvg =
    weeklyTotals.slice(-4).reduce((a, b) => a + b, 0) / Math.max(1, Math.min(4, weeklyTotals.length));
  const maxWeekly = Math.max(1, ...weeklyTotals);
  const intensity = Math.max(0, Math.min(1, recentAvg / (maxWeekly || 1)));
  // busier week -> shorter duration (faster pulses), clamped to a sane range
  const pulseDur = (3.6 - intensity * 2.4).toFixed(2); // 1.2s (busy) .. 3.6s (quiet)

  // ---- static trace + node markup, plus per-node motion-guide paths ----
  let traces = "";
  let nodesMarkup = "";
  let pulses = "";
  let pathDefs = "";
  let pulseId = 0;

  // main horizontal bus, spanning from the CPU pin to the last column's spine
  const lastSpineX = laidOut[laidOut.length - 1].x - SPINE_OFFSET;
  traces += `<path d="M ${cpuPin.x} ${cpuPin.y} L ${lastSpineX} ${cpuPin.y}" stroke="${c.trace}" stroke-width="2" fill="none" opacity="0.9"/>`;

  laidOut.forEach((col, colIdx) => {
    const spineX = col.x - SPINE_OFFSET;
    const ys = col.nodes.map((n) => n.y);
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);

    // vertical spine for this column
    traces += `<path d="M ${spineX} ${minY} L ${spineX} ${maxY}" stroke="${c.trace}" stroke-width="2" fill="none" opacity="0.9"/>`;
    // junction via-dot where the spine meets the main bus
    traces += `<circle cx="${spineX}" cy="${centerY}" r="3" fill="${col.color}" opacity="0.85"/>`;

    col.nodes.forEach((node, i) => {
      const nodeLeftX = node.x - NODE_W / 2;
      const stubY = node.y;

      // stub from spine into node
      traces += `<path d="M ${spineX} ${stubY} L ${nodeLeftX} ${stubY}" stroke="${c.trace}" stroke-width="2" fill="none" opacity="0.9"/>`;
      traces += `<circle cx="${spineX}" cy="${stubY}" r="2.5" fill="${col.color}" opacity="0.7"/>`;

      // node chip
      nodesMarkup += `
        <g>
          <rect x="${nodeLeftX}" y="${stubY - NODE_H / 2}" width="${NODE_W}" height="${NODE_H}" rx="7"
                fill="${c.bg1}" stroke="${col.color}" stroke-width="1.3" opacity="0.98"/>
          <circle cx="${nodeLeftX + 13}" cy="${stubY}" r="3.2" fill="${col.color}"/>
          <text x="${nodeLeftX + 23}" y="${stubY + 4}" font-family="'Fira Code', monospace" font-size="12"
                fill="${c.text}">${escapeXml(node.label)}</text>
        </g>`;

      // hidden motion-guide path (full CPU -> node route) for the pulse
      pulseId += 1;
      const pid = `pulse-path-${mode}-${pulseId}`;
      const d = tracePath(cpuPin, spineX, stubY, nodeLeftX);
      pathDefs += `<path id="${pid}" d="${d}" fill="none"/>`;

      const delay = ((colIdx * col.nodes.length + i) * 0.18).toFixed(2);
      pulses += `
        <circle r="3.4" fill="${col.color}">
          <animateMotion dur="${pulseDur}s" begin="${delay}s" repeatCount="indefinite" rotate="auto">
            <mpath href="#${pid}"/>
          </animateMotion>
          <animate attributeName="opacity" values="0;1;1;0" keyTimes="0;0.08;0.85;1"
                   dur="${pulseDur}s" begin="${delay}s" repeatCount="indefinite"/>
        </circle>`;
    });
  });

  // ---- column headers ----
  let colHeaders = "";
  laidOut.forEach((col) => {
    colHeaders += `<text x="${col.x - NODE_W / 2}" y="${Math.min(...col.nodes.map((n) => n.y)) - 20}"
      font-family="'Fira Code', monospace" font-size="11" letter-spacing="2"
      fill="${col.color}" opacity="0.85">${col.title}</text>`;
  });

  // ---- weekly-activity spectrum strip (bottom band) ----
  const stripX = 60;
  const stripY = 420;
  const stripW = W - 120;
  const barGap = 2;
  const barW = stripW / weeklyTotals.length - barGap;
  const maxBar = 40;
  let strip = "";
  weeklyTotals.forEach((v, i) => {
    const h = Math.max(2, (v / (maxWeekly || 1)) * maxBar);
    const x = stripX + i * (barW + barGap);
    const y = stripY - h;
    const op = 0.28 + 0.72 * (v / (maxWeekly || 1));
    strip += `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${barW.toFixed(1)}" height="${h.toFixed(
      1
    )}" rx="1.5" fill="${c.lang}" opacity="${op.toFixed(2)}"/>`;
  });
  // scanline sweeping across the spectrum, reading through the weeks
  const scan = `
    <rect x="${stripX}" y="${stripY - maxBar - 6}" width="14" height="${maxBar + 12}" fill="${c.stack}" opacity="0.25">
      <animate attributeName="x" values="${stripX};${stripX + stripW - 14};${stripX}" dur="9s" repeatCount="indefinite"/>
    </rect>`;

  const streakLine =
    `> total_commits: ${stats.totalContributions}   ` +
    `current_streak: ${stats.currentStreak}d   ` +
    `longest_streak: ${stats.longestStreak}d   ` +
    `active_days: ${stats.activeDays}`;

  return `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink">
  <defs>
    <pattern id="grid-${mode}" width="24" height="24" patternUnits="userSpaceOnUse">
      <path d="M 24 0 L 0 0 0 24" fill="none" stroke="${c.grid}" stroke-width="1"/>
    </pattern>
    <filter id="glow-${mode}" x="-60%" y="-60%" width="220%" height="220%">
      <feGaussianBlur stdDeviation="2.6" result="blur"/>
      <feMerge>
        <feMergeNode in="blur"/>
        <feMergeNode in="SourceGraphic"/>
      </feMerge>
    </filter>
    ${pathDefs}
  </defs>

  <rect width="${W}" height="${H}" fill="${c.bg0}"/>
  <rect width="${W}" height="${H}" fill="url(#grid-${mode})"/>

  <!-- title bar -->
  <text x="30" y="34" font-family="'Fira Code', monospace" font-size="15" fill="${c.text}">
    root@${escapeXml(handle)}:~/circuit-pulse$ <tspan fill="${c.lang}">status --live</tspan>
  </text>
  <text x="${W - 30}" y="34" text-anchor="end" font-family="'Fira Code', monospace" font-size="11.5" fill="${c.dim}">
    ${escapeXml(streakLine)}
  </text>
  <path d="M 30 44 L ${W - 30} 44" stroke="${c.trace}" stroke-width="1" opacity="0.6"/>

  <!-- circuit -->
  <g filter="url(#glow-${mode})">
    ${traces}
  </g>
  <g>
    <rect x="${cpu.x}" y="${cpu.y}" width="${cpu.w}" height="${cpu.h}" rx="10"
          fill="${c.bg1}" stroke="${c.core}" stroke-width="1.6"/>
    <text x="${cpu.x + cpu.w / 2}" y="${cpu.y + cpu.h / 2 - 4}" text-anchor="middle"
          font-family="'Fira Code', monospace" font-size="19" font-weight="700" fill="${c.core}">QK</text>
    <text x="${cpu.x + cpu.w / 2}" y="${cpu.y + cpu.h / 2 + 16}" text-anchor="middle"
          font-family="'Fira Code', monospace" font-size="9.5" letter-spacing="1.5" fill="${c.dim}">CORE</text>
  </g>
  ${colHeaders}
  ${nodesMarkup}
  <g filter="url(#glow-${mode})">
    ${pulses}
  </g>

  <!-- weekly activity spectrum -->
  <text x="${stripX}" y="${stripY - maxBar - 14}" font-family="'Fira Code', monospace" font-size="11"
        letter-spacing="2" fill="${c.dim}">CONTRIB_SPECTRUM :: ${weeklyTotals.length}w</text>
  <path d="M ${stripX} ${stripY + 4} L ${stripX + stripW} ${stripY + 4}" stroke="${c.trace}" stroke-width="1"/>
  ${strip}
  ${scan}

  <text x="30" y="${H - 16}" font-family="'Fira Code', monospace" font-size="10.5" fill="${c.dim}">
    generated on push &amp; every 12h via GitHub Actions — data is live, not decorative
  </text>
</svg>`;
}