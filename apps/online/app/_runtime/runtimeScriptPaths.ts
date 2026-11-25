import { readFileSync } from 'node:fs';

let paths: string[] | undefined;

export function runtimeScriptPaths(): string[] {
  if (paths !== undefined) return paths;
  try {
    // The release packager ships this manifest next to the running Next build.
    const manifest = JSON.parse(readFileSync('.next/react-loadable-manifest.json', 'utf8')) as Record<string, { files: string[] }>;
    const module = Object.entries(manifest).find(([key]) =>
      key.replaceAll('\\', '/').endsWith('/chatRouteModules.ts -> ./Runtime'))?.[1];
    paths = [...new Set(module?.files ?? [])]
      .filter(file => /^static\/chunks\/[\w-]+\.[a-f0-9]{8,64}\.js$/.test(file))
      .map(file => '/_next/' + file);
  } catch {
    // Development and builds without the manifest still load the route on demand.
    paths = [];
  }
  return paths;
}
