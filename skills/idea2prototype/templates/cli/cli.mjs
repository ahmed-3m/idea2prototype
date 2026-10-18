#!/usr/bin/env node
// Idea2Prototype cli template — zero-dependency command-line tool (Node >= 18)
import { readFile } from 'node:fs/promises';

const HELP = `Usage: {{slug}} <command> [args]

Commands:
  greet <name>   Print a greeting
  help           Show this help
  version        Print the version
`;

const [command, ...args] = process.argv.slice(2);

switch (command) {
  case 'greet': {
    const name = args[0] ?? 'world';
    console.log(`Hello, ${name}!`);
    break;
  }
  case 'version':
  case '--version':
  case '-v': {
    const pkg = JSON.parse(await readFile(new URL('./package.json', import.meta.url), 'utf8'));
    console.log(pkg.version);
    break;
  }
  case 'help':
  case '--help':
  case '-h':
  case undefined:
    console.log(HELP);
    break;
  default:
    console.error(`Unknown command: ${command}`);
    console.error(HELP);
    process.exitCode = 1;
}
