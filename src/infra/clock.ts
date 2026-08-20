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
  constructor(
    private current: Date,
    private readonly enabled: boolean,
  ) {}

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
    if (!Number.isFinite(milliseconds) || milliseconds <= 0) {
      throw new DomainError(
        "INVALID_CLOCK_ADVANCE",
        "milliseconds must be positive",
      );
    }
    this.current = new Date(this.current.getTime() + milliseconds);
    return this.now();
  }
}
