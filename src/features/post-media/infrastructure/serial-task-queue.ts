// Runs tasks one at a time, in submission order. A failing task does not
// block the ones queued after it.
export class SerialTaskQueue {
  private tail: Promise<unknown> = Promise.resolve();

  run<T>(task: () => Promise<T> | T): Promise<T> {
    const result = this.tail.then(() => task());
    this.tail = result.catch(() => undefined);
    return result;
  }
}
