export class InstructionHistory {
  private readonly past: string[] = [];
  private readonly future: string[] = [];
  private composition?: { previous: string; current: string };

  get composing() { return this.composition !== undefined; }

  beginComposition(value: string) { this.composition = { previous: value, current: value }; }

  finishComposition(value = this.composition?.current) {
    const composition = this.composition;
    this.composition = undefined;
    if (composition && value !== undefined) this.record(composition.previous, value);
  }

  record(previous: string, next: string) {
    if (this.composition) {
      this.composition.current = next;
      return;
    }
    if (previous === next) return;
    this.past.push(previous);
    this.future.length = 0;
  }

  move(action: 'undo' | 'redo', current: string) {
    const [from, to] = action === 'undo' ? [this.past, this.future] : [this.future, this.past];
    const value = from.pop();
    if (value !== undefined) to.push(current);
    return value;
  }

  reset() {
    this.past.length = 0;
    this.future.length = 0;
    this.composition = undefined;
  }
}
