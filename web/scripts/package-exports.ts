import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

type ExportTarget = string | { import?: string };

interface PackageJson {
  exports?: Record<string, ExportTarget>;
}

const SOURCE_CODE_PATH = /^\.\/src\/.+\.(?:[cm]?ts|tsx)$/;

const readPackageJson = (packageDir: string): PackageJson =>
  JSON.parse(readFileSync(path.join(packageDir, 'package.json'), 'utf8')) as PackageJson;

const readSourcePath = (target: ExportTarget): string | null => {
  const value = typeof target === 'string' ? target : target.import;
  return value ?? null;
};

const toEntryName = (sourcePath: string): string =>
  sourcePath.replace(/^\.\/src\//, '').replace(/\.(?:[cm]?ts|tsx)$/, '');

export const createEntriesFromPackageExports = (
  configModuleUrl: string,
): Record<string, string> => {
  const packageDir = path.dirname(fileURLToPath(configModuleUrl));
  const packageJson = readPackageJson(packageDir);

  return Object.values(packageJson.exports ?? {})
    .map(readSourcePath)
    .filter(
      (sourcePath): sourcePath is string =>
        sourcePath !== null && SOURCE_CODE_PATH.test(sourcePath),
    )
    .sort()
    .reduce<Record<string, string>>((entries, sourcePath) => {
      entries[toEntryName(sourcePath)] = sourcePath.replace(/^\.\//, '');
      return entries;
    }, {});
};
