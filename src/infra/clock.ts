import { DomainError } from "../domain/errors.js";

export interface Clock {
  now(): Date;
}

export class SystemClock implements Clock {
  now(): Date {
    return new Date();
  }
}

export class DemoClock implements Clock {
  private current: Date;

  constructor(
    current: Date,
    private readonly enabled: boolean,
  ) {
    this.current = new Date(current);
  }

  now(): Date {
    return this.enabled ? new Date(this.current) : new Date();
  }

  advance(milliseconds: number): Date {
    if (!this.enabled) {
      throw new DomainError(
        "DEMO_CLOCK_DISABLED",
        "Demo clock is disabled",
        false,
        403,
      );
    }
    if (!Number.isSafeInteger(milliseconds) || milliseconds <= 0) {
      throw new DomainError(
        "INVALID_CLOCK_ADVANCE",
        "milliseconds must be positive",
      );
    }
    const nextTime = this.current.getTime() + milliseconds;
    const candidate = new Date(nextTime);
    if (!Number.isFinite(candidate.getTime())) {
      throw new DomainError(
        "INVALID_CLOCK_ADVANCE",
        "milliseconds must be positive",
      );
    }
    this.current = candidate;
    return this.now();
  }
}
