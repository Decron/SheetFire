#!/usr/bin/env node

const { spawnSync } = require('child_process');

const [,, endpoint, collection, secret] = process.argv;

if (!endpoint || !collection || !secret) {
  console.error('Usage: node scripts/set-script-props.js <endpoint> <collection> <secret>');
  process.exit(1);
}

const params = JSON.stringify([{ endpoint, collection, secret }]);

const result = spawnSync('npx', ['clasp', 'run', 'setProperties', '--params', params], {
  stdio: 'inherit',
});

if (result.error) {
  console.error(result.error);
  process.exit(1);
}

process.exit(result.status);
