export async function getUnofficialBuilds() {
  const res = await fetch('https://unofficial-builds.nodejs.org/download/release/index.tab');
  if (!res.ok) throw new Error(`Failed to fetch: ${res.status} ${res.statusText}`);

  const entries = (await res.text())
    .split('\n')
    .map(line => line.trim())
    .filter(line => line.length > 0)
    .map(line => line.split('\t').map(part => part.trim()));
  const columns = entries.shift();

  if (!columns) throw new Error('No columns found');

  type ExpectedType = {
    version: string;
    date: string;
    files: string[];
    npm: string;
    v8: string;
    uv: string;
    zlib: string;
    openssl: string;
    modules: number;
    lts: string | false;
    security: boolean;
  };

  if (columns.join(',') != 'version,date,files,npm,v8,uv,zlib,openssl,modules,lts,security')
    throw new Error('Unexpected columns: ' + columns.join(','));

  function partToTyped(part: string, index: number) {
    if (index == 2) return part.split(',');
    if (part == '-') return false;
    if (part == 'true') return true;
    if (part.match(/^\d+$/)) return Number(part);
    return part;
  }
  function getTypedEntries(part: string, index: number) {
    return [columns![index], partToTyped(part, index)];
  }

  return entries.map(parts => Object.fromEntries(parts.map(getTypedEntries))) as ExpectedType[];
}
