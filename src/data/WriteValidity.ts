/** Cancellation is checked at execution time, including inside the file mutator. */
export class WriteInvalidatedError extends Error {
  constructor() { super("write invalidated"); this.name = "WriteInvalidatedError"; }
}

export function assertWriteValid(shouldContinue: () => boolean): void {
  if (!shouldContinue()) throw new WriteInvalidatedError();
}
