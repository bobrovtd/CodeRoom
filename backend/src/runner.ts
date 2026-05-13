import http from 'node:http';
import { randomUUID } from 'node:crypto';
import type { RunResult } from './types.js';

const RUNNER_IMAGE = process.env.RUNNER_IMAGE || 'collab-python-runner';
const DOCKER_SOCKET = process.env.DOCKER_SOCKET || (process.platform === 'win32' ? '//./pipe/docker_engine' : '/var/run/docker.sock');
const TIMEOUT_MS = 5000;

type DockerCreateResponse = {
  Id: string;
};

type DockerWaitResponse = {
  StatusCode: number;
};

export type RunnerFile = {
  name: string;
  content: string;
};

function dockerRequest(method: string, path: string, body?: Buffer | object, contentType = 'application/json') {
  const payload = Buffer.isBuffer(body) ? body : body ? Buffer.from(JSON.stringify(body)) : undefined;

  return new Promise<Buffer>((resolve, reject) => {
    const request = http.request(
      {
        socketPath: DOCKER_SOCKET,
        path,
        method,
        headers: {
          Host: 'docker',
          ...(payload
            ? {
                'Content-Type': contentType,
                'Content-Length': payload.length
              }
            : {})
        }
      },
      (response) => {
        const chunks: Buffer[] = [];
        response.on('data', (chunk: Buffer) => chunks.push(chunk));
        response.on('end', () => {
          const data = Buffer.concat(chunks);
          if (response.statusCode && response.statusCode >= 200 && response.statusCode < 300) {
            resolve(data);
            return;
          }
          reject(new Error(`Docker API ${method} ${path} failed with ${response.statusCode}: ${data.toString('utf8')}`));
        });
      }
    );

    request.on('error', reject);
    if (payload) request.write(payload);
    request.end();
  });
}

function parseJson<T>(data: Buffer): T {
  return JSON.parse(data.toString('utf8')) as T;
}

function createTarEntry(filename: string, content: string) {
  const fileContent = Buffer.from(content, 'utf8');
  const header = Buffer.alloc(512, 0);

  header.write(filename, 0, 100);
  header.write('0000644', 100, 8);
  header.write('0000000', 108, 8);
  header.write('0000000', 116, 8);
  header.write(fileContent.length.toString(8).padStart(11, '0') + '\0', 124, 12);
  header.write(Math.floor(Date.now() / 1000).toString(8).padStart(11, '0') + '\0', 136, 12);
  header.fill(' ', 148, 156);
  header.write('0', 156, 1);
  header.write('ustar', 257, 6);
  header.write('00', 263, 2);

  let checksum = 0;
  for (const byte of header) checksum += byte;
  header.write(checksum.toString(8).padStart(6, '0') + '\0 ', 148, 8);

  const padding = Buffer.alloc((512 - (fileContent.length % 512)) % 512, 0);
  return Buffer.concat([header, fileContent, padding]);
}

function validateArchiveFileName(name: string) {
  if (!name || name.includes('/') || name.includes('\\') || name.includes('\0') || name === '.' || name === '..') {
    throw new Error(`Некорректное имя файла: ${name}`);
  }
  if (Buffer.byteLength(name, 'utf8') > 100) {
    throw new Error(`Слишком длинное имя файла для запуска: ${name}`);
  }
}

function createTarArchive(files: RunnerFile[]) {
  const usedNames = new Set<string>();
  const entries = files.map((file) => {
    validateArchiveFileName(file.name);
    if (usedNames.has(file.name)) throw new Error(`Дублирующееся имя файла: ${file.name}`);
    usedNames.add(file.name);
    return createTarEntry(file.name, file.content);
  });

  return Buffer.concat([...entries, Buffer.alloc(1024, 0)]);
}

function parseDockerLogs(data: Buffer) {
  let offset = 0;
  let stdout = '';
  let stderr = '';

  while (offset + 8 <= data.length) {
    const stream = data[offset];
    const size = data.readUInt32BE(offset + 4);
    const start = offset + 8;
    const end = start + size;
    if (end > data.length) break;

    const text = data.subarray(start, end).toString('utf8');
    if (stream === 2) stderr += text;
    else stdout += text;
    offset = end;
  }

  if (offset === 0 && data.length > 0) stdout = data.toString('utf8');
  return { stdout, stderr };
}

async function killContainer(id: string) {
  try {
    await dockerRequest('POST', `/containers/${id}/kill`);
  } catch {
    // The container may have exited between timeout detection and kill.
  }
}

async function removeContainer(id: string) {
  try {
    await dockerRequest('DELETE', `/containers/${id}?force=1&v=1`);
  } catch {
    // Best-effort cleanup. The run result is more important than cleanup noise.
  }
}

export async function runPythonFile(entryFileName: string, files: RunnerFile[]): Promise<RunResult> {
  const containerName = `collab-python-${randomUUID()}`;
  let containerId = '';
  let timedOut = false;

  try {
    validateArchiveFileName(entryFileName);
    if (!files.some((file) => file.name === entryFileName)) throw new Error(`Файл для запуска не найден: ${entryFileName}`);

    const created = parseJson<DockerCreateResponse>(
      await dockerRequest('POST', `/containers/create?name=${encodeURIComponent(containerName)}`, {
        Image: RUNNER_IMAGE,
        AttachStdout: true,
        AttachStderr: true,
        Cmd: ['python', `/app/${entryFileName}`],
        HostConfig: {
          NetworkMode: 'none',
          Memory: 128 * 1024 * 1024,
          NanoCpus: 500_000_000
        }
      })
    );
    containerId = created.Id;

    await dockerRequest('PUT', `/containers/${containerId}/archive?path=${encodeURIComponent('/app')}`, createTarArchive(files), 'application/x-tar');
    await dockerRequest('POST', `/containers/${containerId}/start`);

    const waitPromise = dockerRequest('POST', `/containers/${containerId}/wait`).then((data) => parseJson<DockerWaitResponse>(data));
    const timeoutPromise = new Promise<null>((resolve) => {
      setTimeout(async () => {
        timedOut = true;
        await killContainer(containerId);
        resolve(null);
      }, TIMEOUT_MS);
    });

    const waitResult = await Promise.race([waitPromise, timeoutPromise]);
    if (timedOut) await waitPromise.catch(() => undefined);

    const logs = parseDockerLogs(await dockerRequest('GET', `/containers/${containerId}/logs?stdout=1&stderr=1`));

    if (timedOut) {
      return {
        status: 'error',
        stdout: logs.stdout,
        stderr: `${logs.stderr}${logs.stderr ? '\n' : ''}Timeout: выполнение остановлено через 5 секунд`,
        exitCode: null
      };
    }

    const exitCode = waitResult?.StatusCode ?? null;
    return {
      status: exitCode === 0 ? 'success' : 'error',
      stdout: logs.stdout,
      stderr: logs.stderr,
      exitCode
    };
  } catch (error) {
    return {
      status: 'error',
      stdout: '',
      stderr: error instanceof Error ? error.message : 'Ошибка Docker runner',
      exitCode: null
    };
  } finally {
    if (containerId) await removeContainer(containerId);
  }
}
