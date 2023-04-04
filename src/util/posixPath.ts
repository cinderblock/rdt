export function posixPath(path: string) {
  return path.replace(/\\/g, '/');
}
