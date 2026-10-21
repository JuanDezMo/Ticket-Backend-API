import { Writable } from 'node:stream';

/** Captura todo lo que escribe pino para poder revisar que no se filtren datos sensibles. */
export function createLogCapture() {
  const lines: string[] = [];
  const stream = new Writable({
    write(chunk, _enc, cb) {
      lines.push(chunk.toString());
      cb();
    },
  });
  return { stream, lines, text: () => lines.join('') };
}
