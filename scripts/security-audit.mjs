#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const severityRank = {
  info: 0,
  low: 1,
  moderate: 2,
  high: 3,
  critical: 4,
};

function argValue(name, fallback) {
  const prefix = `--${name}=`;
  const found = process.argv.find((arg) => arg.startsWith(prefix));
  return found ? found.slice(prefix.length) : fallback;
}

function loadAllowlist() {
  try {
    return JSON.parse(readFileSync('.security-audit-allowlist.json', 'utf8'));
  } catch {
    return [];
  }
}

function advisoryTokens(vulnerability) {
  const tokens = new Set([vulnerability.name]);

  for (const via of vulnerability.via ?? []) {
    if (typeof via === 'string') {
      tokens.add(via);
      continue;
    }

    if (via.name) tokens.add(via.name);
    if (via.source) tokens.add(String(via.source));
    if (via.url) tokens.add(via.url);
    if (via.title) tokens.add(via.title);
  }

  return tokens;
}

function isAllowed(vulnerability, allowlist, today) {
  const tokens = advisoryTokens(vulnerability);

  return allowlist.some((entry) => {
    if (entry.expires && entry.expires < today) return false;
    if (entry.package && entry.package !== vulnerability.name) return false;

    if (entry.source && tokens.has(String(entry.source))) return true;
    if (entry.url && tokens.has(entry.url)) return true;
    if (entry.via && tokens.has(entry.via)) return true;

    return !entry.source && !entry.url && !entry.via;
  });
}

const minSeverity = argValue('min-severity', 'high');
const minRank = severityRank[minSeverity];

if (minRank === undefined) {
  console.error(`Unknown --min-severity value: ${minSeverity}`);
  process.exit(2);
}

const audit = spawnSync('npm', ['audit', '--workspaces', '--json'], {
  encoding: 'utf8',
  stdio: ['ignore', 'pipe', 'pipe'],
});

if (!audit.stdout.trim()) {
  process.stderr.write(audit.stderr);
  process.exit(audit.status ?? 1);
}

const report = JSON.parse(audit.stdout);
const allowlist = loadAllowlist();
const today = new Date().toISOString().slice(0, 10);
const vulnerabilities = Object.values(report.vulnerabilities ?? {});

const blocking = [];
const allowed = [];

for (const vulnerability of vulnerabilities) {
  const rank = severityRank[vulnerability.severity] ?? 0;
  if (rank < minRank) continue;

  if (isAllowed(vulnerability, allowlist, today)) {
    allowed.push(vulnerability);
  } else {
    blocking.push(vulnerability);
  }
}

if (allowed.length > 0) {
  console.warn('Allowed security audit findings:');
  for (const vulnerability of allowed) {
    console.warn(`- ${vulnerability.name} (${vulnerability.severity})`);
  }
}

if (blocking.length > 0) {
  console.error(`Blocking ${minSeverity}+ security audit findings:`);
  for (const vulnerability of blocking) {
    console.error(`- ${vulnerability.name} (${vulnerability.severity})`);
    for (const via of vulnerability.via ?? []) {
      if (typeof via === 'string') {
        console.error(`  via ${via}`);
      } else {
        console.error(`  ${via.title} (${via.url})`);
      }
    }
  }
  process.exit(1);
}

const counts = report.metadata?.vulnerabilities ?? {};
console.log(`Security audit passed for ${minSeverity}+ findings.`);
console.log(`Current audit totals: ${JSON.stringify(counts)}`);
