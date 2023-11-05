import { assert, basename, dim, dirname, green, italic, relative, white, yellow } from '../deps/std.ts';

import { Compy } from './compy.ts';
import { Embryo } from './embryo.ts';

import cacheDef from './commands/cache.ts';
import fmtDef from './commands/fmt.ts';
import lintDef from './commands/lint.ts';
import runDef from './commands/run.ts';
import testDef from './commands/test.ts';

// TODO(danilo-valente): add support for other commands: bench, check, compile, doc, eval, repl, task
const cli = {
  cache: cacheDef,
  fmt: fmtDef,
  lint: lintDef,
  start: runDef,
  dev: runDef,
  test: testDef,
};

export type Cmd = keyof typeof cli;

// TODO(danilo-valente): add flag to specify env file

// TODO(danilo-valente): multiple roots

export const buildLogger = (scope: string) => {
  return (tag: string, ...data: string[]) => {
    if (data.length === 0) {
      return;
    }

    console.log(
      green(`[compy:${scope}]`),
      yellow(tag),
      ...data.map((arg) => {
        if (arg.startsWith('-')) {
          return arg;
        }

        if (arg.startsWith('/')) {
          return `${dim(dirname(arg) + '/')}${white(basename(arg))}`;
        }

        if (arg.startsWith('./') || arg.startsWith('../')) {
          return `${dirname(arg) + '/'}${white(basename(arg))}`;
        }

        return arg;
      }),
    );
  };
};

export type ShellCommand = {
  userCwd: string;
  exec: string | URL;
  cwd: string;
  args: string[];
  env: Record<string, string>;
  log: ReturnType<typeof buildLogger>;
};

export const buildNative = async (
  compy: Compy,
  [cmd, script]: [Cmd] | ['run', string],
  eggName: string,
  /**
   * @deprecated remove support for `argv` in favor of `egg.config.args`
   */
  argv?: string[],
): Promise<ShellCommand> => {
  assert(eggName, 'Missing package name');
  assert(cmd, 'Missing command');

  const egg = await compy.eggs.load(eggName);

  const buildEmbryo = () => {
    if (cmd === 'run') {
      const embryo = egg.config.run?.[script];
      assert(embryo, `Missing 'run.${script}' config`);

      const cliCmd = runDef;
      const log = buildLogger(`run:${script}`);

      return { embryo, cliCmd, log };
    }

    const embryo = egg.config[cmd];
    const cliCmd = cli[cmd];
    const log = buildLogger(cmd);

    return { embryo, cliCmd, log };
  };

  // TODO(danilo-valente): implement command inheritance
  const buildCli = () => {
    const { embryo, cliCmd, log } = buildEmbryo();

    const mergedEmbryo: Embryo = {
      flags: cliCmd.flags.strip().parse({
        ...egg.config.flags,
        ...embryo?.flags,
      }),
      entry: embryo?.entry || egg.config.entry,
      args: embryo?.args ?? [],
      env: embryo?.env ?? {},
    };

    assert(mergedEmbryo.entry, 'Missing entry file');

    // TODO(danilo-valente): provide ability to merge config files
    const configRelativePath = relative(egg.nest, compy.denoConfig.path);
    const { command, args } = cliCmd.build({
      config: configRelativePath,
      ...mergedEmbryo.flags,
    });

    return {
      exec: command,
      env: mergedEmbryo.env,
      args: [
        ...args,
        mergedEmbryo.entry,
        ...mergedEmbryo.args,
      ],
      log: log,
    };
  };

  const { exec, env, args: cliArgs, log } = buildCli();
  const args = [
    ...cliArgs,
    ...(argv ?? []),
  ];

  return {
    userCwd: compy.cwd,
    exec,
    cwd: egg.nest,
    args,
    env,
    log,
  };
};

export const runNative = async ({ userCwd, cwd, exec, args, env, log }: ShellCommand) => {
  log('cwd:', relative(userCwd, cwd));

  log(
    '$',
    exec.toString(),
    ...args,
  );

  log(
    'env:',
    ...Object.entries(env).map(([key, value]) => italic(`\n    - ${key}=${String(value).replace(/./g, '*')}`)),
  );

  const command = new Deno.Command(exec, {
    cwd: cwd,
    env: env,
    args: args,
    stdin: 'piped',
    stdout: 'piped',
    stderr: 'piped',
  });

  const process = command.spawn();

  process.stdout.pipeTo(Deno.stdout.writable);
  process.stderr.pipeTo(Deno.stderr.writable);

  Deno.addSignalListener('SIGINT', () => {
    process.kill('SIGINT');
    Deno.exit(0);
  });

  Deno.addSignalListener('SIGTERM', () => {
    process.kill('SIGTERM');
    Deno.exit(1);
  });

  // Deno.addSignalListener('SIGKILL', () => {
  //   process.kill('SIGKILL');
  //   Deno.exit(1);
  // });

  const { code } = await process.status;

  return code;
};

export const exportNative = async (native: ShellCommand, shell: string) => {
  const shEnv = Object.entries(native.env).map(
    ([key, value]) => `export ${key}="${value.replace(/"/g, '\\"')}"`,
  );

  const shArgs = native.args.map(
    (arg) => arg.replace(/([\\\s])/g, '\\$1'),
  );

  const script = `
    #!/usr/bin/env ${shell}

    # Script generated by compy
    # https://deno.land/x/compy

    cd ${native.cwd}

    ${shEnv.join('\n')}

    ${native.exec} ${shArgs.join(' ')}
  `;

  return script
    .replace(/^[ \t]+/gm, '')
    .replace(/\n{3,}/g, '\n\n');
};
