import { expect, it } from 'vitest';
import { legacyPath } from './legacyPath';

it('preserves old app links, queries and section anchors on the same origin', () => {
  expect(legacyPath('#/', 'https://app.test')).toBe('/');
  expect(legacyPath('#/profile/settings?lang=en#help', 'https://app.test')).toBe('/profile/settings?lang=en#help');
});

it('leaves pairing to its own entry handler and rejects malformed or external bookmarks', () => {
  for (const fragment of ['#remote=fixture', '#help', '#///', '#//other.test', '#/\\other.test']) {
    expect(legacyPath(fragment, 'https://app.test')).toBeNull();
  }
});
