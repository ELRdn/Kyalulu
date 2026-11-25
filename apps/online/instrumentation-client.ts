// Runs before the Next client hydrates or starts routing.
import { capturePairing } from './app/_runtime/pairing';

capturePairing();
window.addEventListener('hashchange', capturePairing);
