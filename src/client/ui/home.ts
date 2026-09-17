import type { GamesToWin } from '../../shared/match';
import type { BotDifficulty } from '../game/bot';
import { loadSettings, saveSettings } from '../settings';
import { el, segmented } from './dom';

export interface PracticeChoice {
  nickname: string;
  gamesToWin: GamesToWin;
  difficulty: BotDifficulty;
}

export const CONTROLS_HELP: Array<[string, string]> = [
  ['Mouse', 'Move the paddle'],
  ['Click', 'Toss the ball to serve'],
  ['Swing up', 'Topspin'],
  ['Swing down', 'Backspin'],
  ['Swing sideways', 'Sidespin and aim'],
  ['Esc', 'Menu'],
];

export function controlsList(): HTMLElement {
  return el(
    'dl',
    { class: 'controls' },
    CONTROLS_HELP.flatMap(([key, action]) => [el('dt', { text: key }), el('dd', { text: action })]),
  );
}

/** Renders the landing screen; returns a cleanup function. */
export function renderHome(root: HTMLElement, onPractice: (choice: PracticeChoice) => void): () => void {
  const settings = loadSettings();
  let gamesToWin = settings.gamesToWin;
  let difficulty = settings.difficulty;

  const nickname = el('input', {
    class: 'input',
    attrs: { type: 'text', maxlength: '16', placeholder: 'Your nickname', value: settings.nickname, id: 'nickname' },
  });

  const start = () => {
    const name = nickname.value.trim() || 'Player';
    saveSettings({ nickname: nickname.value.trim(), gamesToWin, difficulty });
    onPractice({ nickname: name, gamesToWin, difficulty });
  };

  const screen = el('main', { class: 'home' }, [
    el('div', { class: 'home-grid', attrs: { 'aria-hidden': 'true' } }),
    el('header', { class: 'home-header' }, [
      el('h1', { class: 'logo' }, [el('span', { text: 'NEON' }), el('span', { class: 'logo-accent', text: 'TABLE TENNIS' })]),
      el('p', { class: 'tagline', text: 'One link. One colleague. First to eleven.' }),
    ]),
    el('section', { class: 'panel home-panel' }, [
      el('label', { class: 'field-label', text: 'Nickname', attrs: { for: 'nickname' } }),
      nickname,
      el('span', { class: 'field-label', text: 'Match format' }),
      segmented<GamesToWin>(
        [
          { value: 1, label: '1 game' },
          { value: 2, label: 'Best of 3' },
          { value: 3, label: 'Best of 5' },
        ],
        gamesToWin,
        (value) => (gamesToWin = value),
      ),
      el('div', { class: 'mode-grid' }, [
        el('div', { class: 'mode' }, [
          el('h2', { class: 'mode-title', text: 'Practice' }),
          el('p', { class: 'mode-text', text: 'Warm up against a bot.' }),
          segmented<BotDifficulty>(
            [
              { value: 'easy', label: 'Easy' },
              { value: 'normal', label: 'Normal' },
              { value: 'hard', label: 'Hard' },
            ],
            difficulty,
            (value) => (difficulty = value),
          ),
          el('button', { class: 'btn btn-primary', text: 'Play vs bot', attrs: { type: 'button' }, on: { click: start } }),
        ]),
        el('div', { class: 'mode mode-disabled' }, [
          el('h2', { class: 'mode-title', text: 'Challenge' }),
          el('p', { class: 'mode-text', text: 'Create a session and send your colleague the invite link.' }),
          el('span', { class: 'badge', text: 'Coming next' }),
          el('button', { class: 'btn btn-secondary', text: 'Create invite link', attrs: { type: 'button', disabled: '' } }),
        ]),
      ]),
    ]),
    el('section', { class: 'panel help-panel' }, [el('h2', { class: 'panel-title', text: 'Controls' }), controlsList()]),
  ]);

  nickname.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') start();
  });

  root.append(screen);
  return () => screen.remove();
}
