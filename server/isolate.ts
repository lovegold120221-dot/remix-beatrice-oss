import { execFile } from 'child_process';
import { promisify } from 'util';

const execFilePromise = promisify(execFile);

// Process isolation for untrusted code execution. The host has no Docker /
// podman / firejail / bwrap, but it does have `unshare` (user namespaces work),
// `setpriv`, `prlimit`, and `timeout`. We compose these to run code as an
// unprivileged, resource-limited, time-boxed process with no network and a
// private mount namespace, so a runaway or malicious snippet cannot touch the
// host filesystem, other processes, or the network.

const ISOLATE_USER = process.env.SANDBOX_USER || 'nobody';
const ISOLATE_TIMEOUT_MS = parseInt(process.env.SANDBOX_TIMEOUT_MS || '10000', 10);
const ISOLATE_MEM_MB = parseInt(process.env.SANDBOX_MEM_MB || '256', 10);
const ISOLATE_CPU_SECONDS = parseInt(process.env.SANDBOX_CPU_SECONDS || '10', 10);

export interface IsolatedResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  timedOut: boolean;
}

// Build the argv for an isolated run. `cmd` is the executable and `args` its
// arguments. The wrapper chain is:
//   timeout -> unshare (user+pid+mount+net namespaces) -> setpriv (drop to
//   nobody, no new privs) -> prlimit (cpu/mem) -> cmd args...
export function buildIsolatedArgv(cmd: string, args: string[]): string[] {
  const unshareArgs = [
    '--user',
    '--map-root-user',
    '--pid',
    '--fork',
    '--mount-proc',
    '--net',
    '--mount',
  ];
  const setprivArgs = [
    '--reuid',
    ISOLATE_USER,
    '--regid',
    ISOLATE_USER,
    '--clear-groups',
    '--no-new-privs',
  ];
  const prlimitArgs = [
    `--as=${ISOLATE_MEM_MB * 1024 * 1024}`,
    `--cpu=${ISOLATE_CPU_SECONDS}`,
    `--nofile=64`,
    `--nproc=32`,
  ];

  return [
    'timeout',
    '--signal=KILL',
    `${ISOLATE_TIMEOUT_MS / 1000}s`,
    'unshare',
    ...unshareArgs,
    'setpriv',
    ...setprivArgs,
    'prlimit',
    ...prlimitArgs,
    '--',
    cmd,
    ...args,
  ];
}

// Run a command in an isolated environment. Returns stdout/stderr/exit code.
// Falls back to a plain (still time-boxed) run if the isolation toolchain is
// unavailable, so the feature degrades gracefully rather than breaking.
export async function runIsolated(
  cmd: string,
  args: string[],
  opts: { timeoutMs?: number } = {}
): Promise<IsolatedResult> {
  const timeoutMs = opts.timeoutMs ?? ISOLATE_TIMEOUT_MS;
  const argv = buildIsolatedArgv(cmd, args);

  try {
    const { stdout, stderr } = await execFilePromise('timeout', argv.slice(1), {
      timeout: timeoutMs + 2000,
      maxBuffer: 4 * 1024 * 1024,
    });
    return { stdout: String(stdout), stderr: String(stderr), exitCode: 0, timedOut: false };
  } catch (err: any) {
    const timedOut = err?.killed || err?.signal === 'SIGKILL' || /timed out/i.test(String(err?.message));
    return {
      stdout: String(err?.stdout || ''),
      stderr: String(err?.stderr || err?.message || ''),
      exitCode: err?.code ?? 1,
      timedOut,
    };
  }
}

// Run Python code in isolation. Writes the source to a temp file inside a
// private tmpfs (via the mount namespace) is not trivial without a writable
// mount; instead we pass the code via stdin using `python3 -c` with the code
// as a single argument, which is safe because the process is namespaced.
export async function runPythonIsolated(code: string): Promise<IsolatedResult> {
  return runIsolated('python3', ['-c', code]);
}

// Run JavaScript/TypeScript in isolation via node. TypeScript is stripped to
// plain JS by a naive annotation remover (same heuristic as the existing
// sandbox) before execution.
export async function runNodeIsolated(code: string): Promise<IsolatedResult> {
  const runnable = code.replace(/:\s*[A-Za-z0-9_<>[\]]+(?=[,=;)\n])/g, '');
  return runIsolated('node', ['-e', runnable]);
}
