import type { MatchState } from '../../shared/match';
import type { FaultReason } from '../../shared/referee';
import type { PlayerIndex } from '../../shared/types';
import { el } from './dom';
import { controlsList } from './home';

export const REASON_TEXT: Record<FaultReason, string> = {
  'serve-no-own-bounce': 'Serve must bounce on the server’s side first',
  'serve-missed': 'Serve missed',
  net: 'Into the net',
  out: 'Out',
  'own-side': 'Bounced on own side',
  'double-bounce': 'Double bounce',
  'missed-return': 'Missed return',
  volley: 'Volley — let it bounce first',
  'double-hit': 'Double hit',
};

export interface GameUiCallbacks {
  onStart(): void;
  onResume(): void;
  onRestart(): void;
  onLeave(): void;
  onSensitivity(value: number): void;
  onAimMarker(enabled: boolean): void;
  onGlow(value: number): void;
}

interface PlayerCard {
  root: HTMLElement;
  points: HTMLElement;
  games: HTMLElement;
}

export class GameUi {
  readonly root: HTMLElement;
  private readonly cards: [PlayerCard, PlayerCard];
  private readonly status: HTMLElement;
  private readonly banner: HTMLElement;
  private readonly bannerTitle: HTMLElement;
  private readonly bannerSub: HTMLElement;
  private readonly hint: HTMLElement;
  private readonly startOverlay: HTMLElement;
  private readonly pauseOverlay: HTMLElement;
  private readonly pauseNote: HTMLElement;
  private readonly overOverlay: HTMLElement;
  private readonly overTitle: HTMLElement;
  private readonly overGames: HTMLElement;
  private bannerTimer = 0;

  constructor(
    parent: HTMLElement,
    names: [string, string],
    settings: { sensitivity: number; aimMarker: boolean; glow: number },
    callbacks: GameUiCallbacks,
  ) {
    this.cards = [this.playerCard(names[0], 0), this.playerCard(names[1], 1)];
    this.status = el('div', { class: 'score-status' });
    this.bannerTitle = el('div', { class: 'banner-title' });
    this.bannerSub = el('div', { class: 'banner-sub' });
    this.banner = el('div', { class: 'banner', attrs: { role: 'status', 'aria-live': 'polite' } }, [this.bannerTitle, this.bannerSub]);
    this.hint = el('div', { class: 'hint' });

    this.startOverlay = el('div', { class: 'overlay' }, [
      el('div', { class: 'panel menu' }, [
        el('h2', { class: 'menu-title', text: 'Ready?' }),
        controlsList(),
        el('button', { class: 'btn btn-primary', text: 'Click to play', attrs: { type: 'button' }, on: { click: () => callbacks.onStart() } }),
      ]),
    ]);

    const sensitivity = el('input', {
      class: 'range',
      attrs: { type: 'range', min: '0.3', max: '2.5', step: '0.05', value: String(settings.sensitivity), id: 'sensitivity' },
    });
    sensitivity.addEventListener('input', () => callbacks.onSensitivity(Number(sensitivity.value)));
    const glow = el('input', {
      class: 'range',
      attrs: { type: 'range', min: '0', max: '2', step: '0.05', value: String(settings.glow), id: 'glow' },
    });
    glow.addEventListener('input', () => callbacks.onGlow(Number(glow.value)));
    const aimMarker = el('input', { attrs: { type: 'checkbox', id: 'aim-marker' } });
    aimMarker.checked = settings.aimMarker;
    aimMarker.addEventListener('change', () => callbacks.onAimMarker(aimMarker.checked));

    this.pauseNote = el('p', { class: 'menu-note' });
    this.pauseOverlay = el('div', { class: 'overlay' }, [
      el('div', { class: 'panel menu' }, [
        el('h2', { class: 'menu-title', text: 'Paused' }),
        el('button', { class: 'btn btn-primary', text: 'Resume', attrs: { type: 'button' }, on: { click: () => callbacks.onResume() } }),
        this.pauseNote,
        el('div', { class: 'menu-settings' }, [
          el('label', { class: 'field-label', text: 'Mouse sensitivity', attrs: { for: 'sensitivity' } }),
          sensitivity,
          el('label', { class: 'field-label', text: 'Glow', attrs: { for: 'glow' } }),
          glow,
          el('label', { class: 'checkbox' }, [aimMarker, el('span', { text: 'Show where to meet the ball' })]),
        ]),
        el('button', { class: 'btn btn-secondary', text: 'Restart match', attrs: { type: 'button' }, on: { click: () => callbacks.onRestart() } }),
        el('button', { class: 'btn btn-danger', text: 'Leave match', attrs: { type: 'button' }, on: { click: () => callbacks.onLeave() } }),
      ]),
    ]);

    this.overTitle = el('h2', { class: 'menu-title' });
    this.overGames = el('p', { class: 'menu-games' });
    this.overOverlay = el('div', { class: 'overlay' }, [
      el('div', { class: 'panel menu' }, [
        this.overTitle,
        this.overGames,
        el('button', { class: 'btn btn-primary', text: 'Rematch', attrs: { type: 'button' }, on: { click: () => callbacks.onRestart() } }),
        el('button', { class: 'btn btn-secondary', text: 'Main menu', attrs: { type: 'button' }, on: { click: () => callbacks.onLeave() } }),
      ]),
    ]);

    this.root = el('div', { class: 'hud' }, [
      el('div', { class: 'scoreboard' }, [this.cards[0].root, this.status, this.cards[1].root]),
      this.banner,
      this.hint,
      this.startOverlay,
      this.pauseOverlay,
      this.overOverlay,
    ]);
    this.showOnly(this.startOverlay);
    parent.append(this.root);
  }

  setScore(match: MatchState, server: PlayerIndex | null): void {
    this.cards.forEach((card, i) => {
      card.points.textContent = String(match.score[i]);
      card.games.textContent = `Games ${match.gamesWon[i]}`;
      card.root.classList.toggle('serving', server === i && match.winner === null);
    });
    const gameNumber = match.completedGames.length + (match.winner === null ? 1 : 0);
    const format = match.config.gamesToWin === 1 ? 'Single game' : `Best of ${match.config.gamesToWin * 2 - 1}`;
    this.status.textContent = `Game ${gameNumber} · ${format}`;
  }

  showBanner(title: string, sub: string, player: PlayerIndex | null, seconds = 1.4): void {
    this.bannerTitle.textContent = title;
    this.bannerSub.textContent = sub;
    this.banner.dataset.player = player === null ? '' : String(player);
    this.banner.classList.remove('visible');
    void this.banner.offsetWidth; // restart the CSS animation
    this.banner.classList.add('visible');
    window.clearTimeout(this.bannerTimer);
    this.bannerTimer = window.setTimeout(() => this.banner.classList.remove('visible'), seconds * 1000);
  }

  setHint(text: string | null): void {
    this.hint.textContent = text ?? '';
    this.hint.classList.toggle('visible', Boolean(text));
  }

  showStart(): void {
    this.showOnly(this.startOverlay);
  }

  showPause(note = ''): void {
    this.pauseNote.textContent = note;
    this.showOnly(this.pauseOverlay);
  }

  showMatchOver(match: MatchState, names: [string, string]): void {
    const winner = match.winner ?? 0;
    this.overTitle.textContent = winner === 0 ? 'Victory' : `${names[winner]} wins`;
    this.overTitle.dataset.player = String(winner);
    this.overGames.textContent = match.completedGames.map(([a, b]) => `${a}–${b}`).join('   ·   ');
    this.showOnly(this.overOverlay);
  }

  hideOverlays(): void {
    this.showOnly(null);
  }

  dispose(): void {
    window.clearTimeout(this.bannerTimer);
    this.root.remove();
  }

  private showOnly(overlay: HTMLElement | null): void {
    for (const candidate of [this.startOverlay, this.pauseOverlay, this.overOverlay]) {
      candidate.classList.toggle('visible', candidate === overlay);
    }
  }

  private playerCard(name: string, player: PlayerIndex): PlayerCard {
    const points = el('div', { class: 'score-points', text: '0' });
    const games = el('div', { class: 'score-games', text: 'Games 0' });
    const root = el('div', { class: `score-card player-${player}` }, [
      el('div', { class: 'score-name' }, [el('span', { class: 'serve-dot', attrs: { title: 'Serving' } }), name]),
      points,
      games,
    ]);
    return { root, points, games };
  }
}
