import { join } from 'path';

export function relativeToProjectRoot(path: string) {
  if (!path.match(/^\.\.?(\/|$)/)) return path;
  return 'file://' + join(process.cwd(), path);
}
