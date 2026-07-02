// Config loader — merges config/sports.json with env overrides.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

export function loadConfig(env = process.env) {
  const sportsCfg = JSON.parse(fs.readFileSync(path.join(ROOT, 'config', 'sports.json'), 'utf8'));
  return {
    sports: sportsCfg.sports,
    minSourcesPerEvent: Number(env.MIN_SOURCES_PER_EVENT ?? sportsCfg.minSourcesPerEvent ?? 2),
    dateBucketHours: sportsCfg.dateBucketHours ?? 24,
    maxEventsPerRun: Number(env.MAX_EVENTS_PER_RUN ?? sportsCfg.maxEventsPerRun ?? 12),
    perSportPerRun: Number(env.PER_SPORT_PER_RUN ?? sportsCfg.perSportPerRun ?? 3),
    koreanFloor: Number(env.KOREAN_FLOOR ?? sportsCfg.koreanFloor ?? 2),
    plagiarismJaccardMax: Number(env.PLAGIARISM_JACCARD_MAX ?? 0.30),
  };
}

export const ROOT_DIR = ROOT;
export const LEDGER_PATH = path.join(ROOT, 'data', 'fingerprints.ndjson');
