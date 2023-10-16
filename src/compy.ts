import { expandGlob } from 'std/fs/expand_glob.ts';
import { dirname } from 'std/path/dirname.ts';
import { resolve } from 'std/path/resolve.ts';
import { toFileUrl } from 'std/path/to_file_url.ts';
import * as z from 'zod/mod.ts';

import { EggLoader } from '~/egg.ts';
import { assert } from 'std/assert/assert.ts';

import { ConfigLoader, DenoConfigContext } from '~/config.ts';

export const COMPY_GLOB = '.compy.@(ts|json)';

export const zCompyConfig = z.object({
  name: z.string(),
  modules: z.string().optional().default('packages'),
  config: z.string().optional().default('deno.@(jsonc|json)'),
  aliasFn: z.function()
    .args(z.string())
    .returns(z.string())
    .optional()
    .default(() => (module: string) => `@${module}/`),
});

export type CompyConfig = z.infer<typeof zCompyConfig>;

export type Compy = {
  cwd: string;
  root: string;
  config: CompyConfig;
  nests: string;
  eggs: EggLoader;
  denoConfig: DenoConfigContext;
};

// export const zCompyShell = z.object({
//   default: zCompy,
// }).transform((shell) => shell.default).or(zCompy);

type CompyLoaderArgs = {
  cwd: string;
  rootDir?: string;
  glob?: string;
};

export class CompyLoader {
  private readonly cwd: string;
  private readonly rootDir: string;
  private readonly glob: string;

  constructor({ cwd, rootDir = resolve('/'), glob = COMPY_GLOB }: CompyLoaderArgs) {
    this.cwd = cwd;
    this.rootDir = rootDir;
    this.glob = glob;
  }

  static async from(cwdOrArgs: string | CompyLoaderArgs): Promise<Compy> {
    const args = typeof cwdOrArgs === 'string' ? { cwd: cwdOrArgs } : cwdOrArgs;

    const loader = new CompyLoader(args);

    return await loader.load();
  }

  async load(): Promise<Compy> {
    const compyUrl = await this.lookup();

    if (!compyUrl) {
      throw new Deno.errors.NotFound(
        `Not a Compy project: could not find ${this.glob} in current working dir or in any parent directory`,
      );
    }

    const compyModule = await import(compyUrl.href);

    const compyConfig = zCompyConfig.parse(compyModule.default ?? compyModule);

    const compyRoot = dirname(compyUrl.pathname);
    const nestsRoot = resolve(compyRoot, compyConfig.modules);

    const configLoader = new ConfigLoader({ cwd: compyRoot, glob: compyConfig.config });
    const denoConfig = await configLoader.load(compyRoot);
    assert(denoConfig, `Missing config file: ${compyConfig.config}`);

    return {
      cwd: this.cwd,
      root: compyRoot,
      config: compyConfig,
      nests: nestsRoot,
      eggs: new EggLoader({ cwd: nestsRoot }),
      denoConfig: denoConfig,
    };
  }

  async lookup(dir = this.cwd): Promise<URL | null> {
    for await (const entry of expandGlob(this.glob, { root: dir })) {
      if (!entry.isFile) {
        continue;
      }

      return toFileUrl(entry.path);
    }

    if (dir === this.rootDir) {
      return null;
    }

    return this.lookup(resolve(dir, '..'));
  }
}
