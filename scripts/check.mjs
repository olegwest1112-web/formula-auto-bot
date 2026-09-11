import fs from 'node:fs';
import assert from 'node:assert/strict';
import { cars } from '../dist/cars.js';
const html = fs.readFileSync('dist/index.html', 'utf8');
for (const match of html.matchAll(/(?:src|href)="([^"]+)"/g)) {
  const ref = match[1];
  if (!ref.includes(':') && !ref.startsWith('#')) assert(fs.existsSync('dist/' + ref), ref);
}
assert.equal(new Set(cars.map(car => car.id)).size, cars.length);
for (const car of cars) {
  assert(car.price > 0);
  for (const image of car.images) {
    const bytes = fs.readFileSync('dist/' + image);
    assert(bytes.length > 1000 && bytes[0] === 255 && bytes[1] === 216, image);
  }
}
for (const file of ['dist/app.js', 'dist/config.js', 'dist/index.html']) {
  assert(!/\d{8,12}:[A-Za-z0-9_-]{30,}/.test(fs.readFileSync(file, 'utf8')), 'Credential in public files');
}
console.log('Catalog, local assets and public configuration validated');
