import groups from './onlineRouteGroups.json';

export type OnlineRouteGroup = keyof typeof groups;
const matchers = (Object.keys(groups) as OnlineRouteGroup[]).map(group => {
  const paths = groups[group].map(path => path.replace(/:[a-zA-Z][a-zA-Z0-9_]*/g, '[^/]+'));
  return { group, path: new RegExp(`^(${paths.join('|')})${group === 'entry' ? '' : '/?'}$`) };
});

export function onlineRouteGroup(path: string): OnlineRouteGroup | null {
  return matchers.find(matcher => matcher.path.test(path))?.group ?? null;
}
