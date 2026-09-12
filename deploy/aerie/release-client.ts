import { encodeReleaseConfig, parseReleaseArgs, releasePlan } from './release-config';

export async function runReleaseClient(mode: 'deploy' | 'rollback', args: string[]): Promise<void> {
  const { config, dryRun, restoreDatabase } = parseReleaseArgs(args);
  if (dryRun) {
    console.log(
      JSON.stringify(
        { dryRun: true, mode, target: config, steps: releasePlan(mode, config, restoreDatabase) },
        null,
        2
      )
    );
    return;
  }
  const provision = Bun.spawn(
    ['ssh', config.host, '/bin/zsh', `${config.checkout}/deploy/aerie/provision-runtime.sh`],
    { stdin: 'inherit', stdout: 'inherit', stderr: 'inherit' }
  );
  const provisionStatus = await provision.exited;
  if (provisionStatus !== 0)
    throw new Error(`app runtime provisioning failed with exit code ${provisionStatus}`);
  const remoteArgs = [
    config.host,
    config.bunExecutable,
    `${config.checkout}/deploy/aerie/remote-release.ts`,
    mode,
    encodeReleaseConfig(config)
  ];
  if (restoreDatabase) remoteArgs.push('--restore-database');
  const child = Bun.spawn(['ssh', ...remoteArgs], {
    stdin: 'inherit',
    stdout: 'inherit',
    stderr: 'inherit'
  });
  const status = await child.exited;
  if (status !== 0) throw new Error(`${mode} failed with exit code ${status}`);
}
