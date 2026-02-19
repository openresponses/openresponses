import type { StreamingEvent, ValidationResult, Violation } from "./types.ts";
import { EventRouter } from "./router.ts";

export class ResponseStreamValidator {
  private router = new EventRouter();
  private lastSequenceNumber = -1;
  private allViolations: Violation[] = [];

  /**
   * Feed a single streaming event into the validator.
   * Returns the violations detected for this specific event.
   */
  send(event: StreamingEvent): ValidationResult {
    const violations: Violation[] = [];

    // Sequence number must be strictly increasing
    if (event.sequence_number <= this.lastSequenceNumber) {
      violations.push({
        rule: "NON_MONOTONIC_SEQUENCE",
        event,
        currentState: this.router.responseService.current,
        message: `sequence_number ${event.sequence_number} is not greater than previous ${this.lastSequenceNumber}`,
      });
    }
    this.lastSequenceNumber = event.sequence_number;

    // Route the event through the state machines
    const routeViolations = this.router.route(event);
    violations.push(...routeViolations);

    this.allViolations.push(...violations);
    return { valid: violations.length === 0, violations };
  }

  /**
   * Call after the stream ends to check that all machines reached terminal states.
   */
  finalize(): ValidationResult {
    const violations: Violation[] = [];

    // Synthesise a sentinel event for finalize violations (no real event)
    const sentinel = {
      type: "__finalize__",
      sequence_number: this.lastSequenceNumber,
    } as unknown as StreamingEvent;

    const responseState = this.router.responseService.current;
    if (!this.router.responseService.isTerminal) {
      violations.push({
        rule: "RESPONSE_NOT_TERMINATED",
        event: sentinel,
        currentState: responseState,
        message: `Stream ended without a terminal response event (last state: '${responseState}')`,
      });
    }

    for (const [itemId, svc] of this.router.itemServices) {
      if (!svc.isTerminal) {
        violations.push({
          rule: "ITEM_NOT_TERMINATED",
          event: sentinel,
          currentState: svc.current,
          message: `Stream ended with item '${itemId}' in non-terminal state '${svc.current}'`,
        });
      }
    }

    for (const [key, svc] of this.router.contentPartServices) {
      if (!svc.isTerminal) {
        violations.push({
          rule: "CONTENT_PART_NOT_TERMINATED",
          event: sentinel,
          currentState: svc.current,
          message: `Stream ended with content part '${key}' in non-terminal state '${svc.current}'`,
        });
      }
    }

    this.allViolations.push(...violations);
    return { valid: violations.length === 0, violations };
  }

  /** All violations accumulated across all send() and finalize() calls. */
  get violations(): Violation[] {
    return this.allViolations;
  }
}
