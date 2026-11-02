import './style.css';
import { App } from './ui/app.ts';

const root = document.getElementById('app');
if (root) {
  root.textContent = '';
  new App(root);
}
