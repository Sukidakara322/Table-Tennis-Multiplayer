import '@fontsource/orbitron/600.css';
import '@fontsource/orbitron/800.css';
import '@fontsource/rajdhani/500.css';
import '@fontsource/rajdhani/600.css';
import './styles.css';
import { PracticeSession } from './game/practice';
import { renderHome } from './ui/home';

const app = document.getElementById('app')!;

function showHome(): void {
  const cleanup = renderHome(app, (choice) => {
    cleanup();
    const session = new PracticeSession(app, {
      ...choice,
      onExit: () => {
        session.dispose();
        showHome();
      },
    });
  });
}

showHome();
