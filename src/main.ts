import './styles.css';
import { Game } from './app/game';
import { FALCON_9 } from './sim/vehicle/falcon9';

function supportsWebGL2(): boolean {
  try {
    return !!document.createElement('canvas').getContext('webgl2');
  } catch {
    return false;
  }
}

const root = document.querySelector<HTMLElement>('#app')!;
if (!supportsWebGL2()) {
  root.querySelector('[data-fallback]')?.removeAttribute('hidden');
} else {
  const game = new Game({ root, vehicle: FALCON_9 });
  if (import.meta.hot) import.meta.hot.dispose(() => game.dispose());
}
