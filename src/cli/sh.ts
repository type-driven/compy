import { Command } from 'cliffy/command/mod.ts';

import { buildNative } from '~/monorepo.ts';
import { CmdType, EggType, getCompy } from '~/cli/util.ts';

export const buildCommand = (shell: string) =>
  new Command()
    .name(shell)
    .description(`Generate a ${shell} shell script to run a Deno command in a module's context`)
    .type('cmd', new CmdType())
    .type('egg', new EggType())
    .arguments('<command:cmd> <module:egg>')
    .action(async (_options, cmd, module, ...args) => {
      const compy = await getCompy();
      const native = await buildNative(compy, cmd, module, args);

      const shEnv = Object.entries(native.env).map(
        ([key, value]) => `export ${key}="${value.replace(/"/g, '\\"')}"`,
      );

      const shArgs = native.args.map(
        (arg) => arg.replace(/([\\\s])/g, '\\$1'),
      );

      const scripts = `
        #!/usr/bin/env ${shell}

        # Script generated by compy
        # https://deno.land/x/compy

        cd ${native.cwd}

        ${shEnv.join('\n')}

        ${native.exec} ${shArgs.join(' ')}
      `.replace(/^[ \t]+/gm, '').replace(/\n{3,}/g, '\n\n');

      await Deno.stdout.write(
        new TextEncoder().encode(scripts),
      );
    });

export const sh = buildCommand('sh');
export const bash = buildCommand('bash');
export const zsh = buildCommand('zsh');
export const ash = buildCommand('ash');
export const fish = buildCommand('fish');