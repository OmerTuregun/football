/**
 * Backfill missing team.crest from football-data twins / known aliases.
 * Run: node scripts/backfill-team-crests.js (from web/)
 */
const Database = require('better-sqlite3');
const path = require('path');

const CREST_BASE = 'https://crests.football-data.org';

const ALIAS = {
  barcelona: `${CREST_BASE}/81.png`,
  'fc barcelona': `${CREST_BASE}/81.png`,
  girona: `${CREST_BASE}/298.png`,
  'girona fc': `${CREST_BASE}/298.png`,
  'manchester utd': `${CREST_BASE}/66.png`,
  'manchester united': `${CREST_BASE}/66.png`,
  'manchester united fc': `${CREST_BASE}/66.png`,
  'manchester city': `${CREST_BASE}/65.png`,
  'real madrid': `${CREST_BASE}/86.png`,
  'real madrid cf': `${CREST_BASE}/86.png`,
  arsenal: `${CREST_BASE}/57.png`,
  'arsenal fc': `${CREST_BASE}/57.png`,
  chelsea: `${CREST_BASE}/61.png`,
  liverpool: `${CREST_BASE}/64.png`,
  'liverpool fc': `${CREST_BASE}/64.png`,
  tottenham: `${CREST_BASE}/73.png`,
  'tottenham hotspur': `${CREST_BASE}/73.png`,
  juventus: `${CREST_BASE}/109.png`,
  'ac milan': `${CREST_BASE}/98.png`,
  inter: `${CREST_BASE}/108.png`,
  internazionale: `${CREST_BASE}/108.png`,
  napoli: `${CREST_BASE}/113.png`,
  'bayern münchen': `${CREST_BASE}/5.png`,
  'fc bayern münchen': `${CREST_BASE}/5.png`,
  'borussia dortmund': `${CREST_BASE}/4.png`,
  dortmund: `${CREST_BASE}/4.png`,
  'paris saint-germain': `${CREST_BASE}/524.png`,
  'atlético madrid': `${CREST_BASE}/78.png`,
  'atletico madrid': `${CREST_BASE}/78.png`,
  'atlético de madrid': `${CREST_BASE}/78.png`,
};

function norm(s) {
  return String(s || '')
    .normalize('NFC')
    .toLocaleLowerCase('en-US')
    .trim();
}

const dbPath = process.env.DB_PATH || path.resolve(__dirname, '../../data-pipeline/data/football.db');
const db = new Database(dbPath);

const withCrest = db
  .prepare(
    `SELECT id, name, crest FROM teams
     WHERE crest IS NOT NULL AND trim(crest) != ''
     ORDER BY CASE WHEN statpal_id IS NULL THEN 0 ELSE 1 END, id`
  )
  .all();

const byNorm = new Map();
for (const t of withCrest) {
  const k = norm(t.name);
  if (!byNorm.has(k)) byNorm.set(k, t.crest);
  // Also index without FC/CF suffix
  const stripped = k.replace(/\s+(fc|cf|sk)$/i, '').trim();
  if (stripped !== k && !byNorm.has(stripped)) byNorm.set(stripped, t.crest);
}

const missing = db
  .prepare(
    `SELECT id, name FROM teams WHERE crest IS NULL OR trim(crest) = ''`
  )
  .all();

const update = db.prepare(`UPDATE teams SET crest = ? WHERE id = ?`);
let updated = 0;
const samples = [];

const tx = db.transaction(() => {
  for (const t of missing) {
    const k = norm(t.name);
    let crest = ALIAS[k] || byNorm.get(k) || null;
    if (!crest) {
      const stripped = k.replace(/\s+(fc|cf|sk|utd)$/i, '').trim();
      crest = ALIAS[stripped] || byNorm.get(stripped) || null;
    }
    // Manchester Utd ↔ Manchester United FC
    if (!crest && k.includes('manchester utd')) crest = ALIAS['manchester united'];
    if (!crest && k === 'barcelona') crest = ALIAS.barcelona;
    if (!crest && k === 'girona') crest = ALIAS.girona;
    if (!crest) continue;
    update.run(crest, t.id);
    updated += 1;
    if (samples.length < 20) samples.push({ id: t.id, name: t.name, crest });
  }
});
tx();

console.log(JSON.stringify({ missing: missing.length, updated, samples }, null, 2));
db.close();
