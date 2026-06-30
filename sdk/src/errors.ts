export class RateLimitError extends Error {
  public readonly retryAfterLedgers: number;
  public readonly currentLedger: number;
  public readonly windowStart: number;

  constructor(
    message: string = "Rate limit exceeded",
    retryAfterLedgers: number = 10,
    currentLedger: number = 0,
    windowStart: number = 0
  ) {
    super(message);
    this.name = "RateLimitError";
    this.retryAfterLedgers = retryAfterLedgers;
    this.currentLedger = currentLedger;
    this.windowStart = windowStart;
  }

  static fromContractError(
    errorCode: number,
    currentLedger?: number,
    windowStart?: number
  ): RateLimitError | null {
    if (errorCode === 8) {
      // RateLimitExceeded
      const retry = windowStart !== undefined && currentLedger !== undefined
        ? Math.max(0, windowStart + 10 - currentLedger)
        : 10;
      return new RateLimitError(
        `Rate limit exceeded. Retry after ${retry} ledgers.`,
        retry,
        currentLedger ?? 0,
        windowStart ?? 0
      );
    }
    return null;
  }
}