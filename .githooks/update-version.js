import { writeFile } from 'node:fs/promises';

const now = new Date();
const pad = value => String(value).padStart(2, '0');
const version = `v${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}.${pad(now.getHours())}h${pad(now.getMinutes())}`;

await writeFile(
  new URL('../js/version.js', import.meta.url),
  `// Updated by the Git pre-commit hook. The version is part of the commit,\n// so every visitor sees the version that was committed with the app.\nexport const APP_VERSION = '${version}';\n`,
);
