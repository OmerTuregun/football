/**
 * Wrapper: run web pregenerate script against shared DB volume.
 */
import { spawnSync } from 'child_process';
import path from 'path';

const webDir = path.resolve(__dirname, '../../../web');
const result = spawnSync(
  'npm',
  ['run', 'pregenerate-puzzles'],
  {
    cwd: webDir,
    stdio: 'inherit',
    shell: true,
    env: {
      ...process.env,
      DB_PATH: process.env.DB_PATH ?? path.resolve(__dirname, '../../data/football.db'),
    },
  }
);

process.exit(result.status ?? 1);
