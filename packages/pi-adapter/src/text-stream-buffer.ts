export class TextStreamBuffer {
  #pending = "";
  #timer: ReturnType<typeof setTimeout> | null = null;
  readonly #flush: (text: string) => void;
  readonly #intervalMs: number;

  constructor(flush: (text: string) => void, intervalMs = 32) {
    this.#flush = flush;
    this.#intervalMs = intervalMs;
  }

  push(delta: string): void {
    if (!delta) return;
    this.#pending += delta;
    if (this.#timer) return;
    this.#timer = setTimeout(() => this.flush(), this.#intervalMs);
  }

  flush(): void {
    if (this.#timer) clearTimeout(this.#timer);
    this.#timer = null;
    if (!this.#pending) return;
    const text = this.#pending;
    this.#pending = "";
    this.#flush(text);
  }

  close(): void {
    this.flush();
  }
}
