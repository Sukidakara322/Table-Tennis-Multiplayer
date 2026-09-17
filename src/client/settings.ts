import type { GamesToWin } from '../shared/match';
import type { BotDifficulty } from './game/bot';

export interface Settings {
  nickname: string;
  gamesToWin: GamesToWin;
  difficulty: BotDifficulty;
  sensitivity: number;
  /** 0 = no glow, 1 = default, 2 = strong. */
  glow: number;
}

const STORAGE_KEY = 'linked-player.settings';

const DEFAULTS: Settings = {
  nickname: '',
  gamesToWin: 2,
  difficulty: 'normal',
  sensitivity: 1,
  glow: 1,
};

// Per-browser conveniences only; the game works the same when storage is unavailable.
export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? { ...DEFAULTS, ...(JSON.parse(raw) as Partial<Settings>) } : { ...DEFAULTS };
  } catch {
    return { ...DEFAULTS };
  }
}

export function saveSettings(patch: Partial<Settings>): Settings {
  const next = { ...loadSettings(), ...patch };
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // Storage blocked (private mode etc.): keep going with in-memory values.
  }
  return next;
}
