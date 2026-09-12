import 'dotenv/config';
import { runTask } from './runTask.js';

const [, , url, ...rest] = process.argv;
const task = rest.join(' ');

if (!url || !task) {
  console.error('Usage: npm run task -- <startUrl> <task description...>');
  process.exit(1);
}

runTask(url, task).then((r) => {
  console.log(JSON.stringify(r, null, 2));
});
