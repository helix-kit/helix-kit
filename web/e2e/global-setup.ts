/* eslint-disable no-console, sonarjs/no-os-command-from-path -- setup script: prints progress and shells out to `sudo` for the tty prep */
// Best-effort CP210x prep (sudo -n, never fatal); stty -hupcl disables hangup-on-close so the port does not reset the ESP32.
import { execFileSync } from 'node:child_process';

import { RUN_SERIAL_PREP, SERIAL_PORT_PATH } from './serial/config';

const STTY_MODE = [
  '115200',
  'cs8',
  '-cstopb',
  '-parenb',
  'cread',
  'clocal',
  '-hupcl',
  'min',
  '1',
  'time',
  '0',
  '-icanon',
  '-echo',
  '-isig',
  '-ixon',
  '-ixoff',
  'ignpar',
  '-parmrk',
  '-opost',
];

const runSudo = (label: string, args: string[]): void => {
  try {
    execFileSync('sudo', ['-n', ...args], { stdio: 'pipe' });
    console.log(`[serial-prep] ${label}: ok`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`[serial-prep] ${label}: skipped (${message.split('\n')[0] ?? message})`);
  }
};

const globalSetup = (): void => {
  if (!RUN_SERIAL_PREP) {
    return;
  }
  const user = process.env.USER ?? process.env.LOGNAME ?? '';
  console.log(`[serial-prep] preparing ${SERIAL_PORT_PATH}`);
  if (user !== '') {
    runSudo('setfacl', ['setfacl', '-m', `u:${user}:rw`, SERIAL_PORT_PATH]);
  }
  runSudo('stty', ['stty', '-F', SERIAL_PORT_PATH, ...STTY_MODE]);
};

export default globalSetup;
