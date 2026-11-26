import assert from 'node:assert/strict';
import { test } from 'node:test';
import { isLargePaste, pasteMarker } from '../src/ui/largePaste.js';

test('short pastes stay in the classic composer path', () => {
  assert.equal(isLargePaste('fix the logo'), false);
  assert.equal(isLargePaste('one\ntwo\nthree'), false);
});

test('long and many-line pastes are stashed instead', () => {
  assert.equal(isLargePaste('x'.repeat(2000)), true);
  assert.equal(isLargePaste(Array.from({ length: 24 }, (_, i) => 'line ' + i).join('\n')), true);
});

test('marker reports the line count', () => {
  assert.equal(pasteMarker('a\nb\nc'), '[(3)#]');
  assert.equal(pasteMarker('a\r\nb\r\nc'), '[(3)#]');
});
