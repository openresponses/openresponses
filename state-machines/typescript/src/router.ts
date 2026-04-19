import type { StreamingEvent, Violation, ViolationRule } from "./types.ts";
import {
  createResponseService,
  createItemService,
  createContentPartService,
  type TrackedService,
} from "./machines.ts";

// Event types that carry item_id + content_index (content-part deltas/dones)
const CONTENT_PART_DELTA_TYPES = new Set([
  "response.output_text.delta",
  "response.output_text.done",
  "response.output_text.annotation.added",
  "response.refusal.delta",
  "response.refusal.done",
  "response.reasoning.delta",
  "response.reasoning.done",
  "response.reasoning_summary_part.added",
  "response.reasoning_summary_part.done",
  "response.reasoning_summary.delta",
  "response.reasoning_summary.done",
]);

// Event types that carry item_id but NO content_index (item-level deltas/dones)
const ITEM_DELTA_TYPES = new Set([
  "response.function_call_arguments.delta",
  "response.function_call_arguments.done",
]);

// Holds the live machines for a single streaming response.
export class EventRouter {
  readonly responseService: TrackedService = createResponseService();
  readonly itemServices: Map<string, TrackedService> = new Map();
  readonly contentPartServices: Map<string, TrackedService> = new Map();

  route(event: StreamingEvent): Violation[] {
    const violations: Violation[] = [];
    const { type } = event;

    const makeViolation = (
      rule: ViolationRule,
      currentState: string,
      message: string,
    ): Violation => ({ rule, event, currentState, message });

    // -----------------------------------------------------------------------
    // Response lifecycle
    // -----------------------------------------------------------------------
    if (
      type === "response.created" ||
      type === "response.queued" ||
      type === "response.in_progress" ||
      type === "response.completed" ||
      type === "response.failed" ||
      type === "response.incomplete"
    ) {
      const currentState = this.responseService.current;
      const ok = this.responseService.send(event);
      if (!ok) {
        violations.push(
          makeViolation(
            "INVALID_RESPONSE_TRANSITION",
            currentState,
            `Event '${type}' is not valid in response state '${currentState}'`,
          ),
        );
      }
      return violations;
    }

    // -----------------------------------------------------------------------
    // Item added
    // -----------------------------------------------------------------------
    if (type === "response.output_item.added") {
      const itemId = event.item?.id;
      if (!itemId) return violations;

      if (this.itemServices.has(itemId)) {
        violations.push(
          makeViolation(
            "DUPLICATE_ITEM",
            this.itemServices.get(itemId)!.current,
            `Item '${itemId}' was already added`,
          ),
        );
        return violations;
      }

      const svc = createItemService();
      this.itemServices.set(itemId, svc);
      svc.send(event);
      return violations;
    }

    // -----------------------------------------------------------------------
    // Item done
    // -----------------------------------------------------------------------
    if (type === "response.output_item.done") {
      const itemId = event.item?.id;
      if (!itemId) return violations;

      const svc = this.itemServices.get(itemId);
      if (!svc) {
        violations.push(
          makeViolation(
            "UNKNOWN_ITEM",
            "—",
            `output_item.done for unknown item '${itemId}'`,
          ),
        );
        return violations;
      }

      const currentState = svc.current;
      const ok = svc.send(event);
      if (!ok) {
        violations.push(
          makeViolation(
            "INVALID_ITEM_TRANSITION",
            currentState,
            `Event '${type}' is not valid in item state '${currentState}' for item '${itemId}'`,
          ),
        );
      }
      return violations;
    }

    // -----------------------------------------------------------------------
    // Content part added
    // -----------------------------------------------------------------------
    if (type === "response.content_part.added") {
      const { item_id, content_index } = event;
      const key = `${item_id}:${content_index}`;

      if (!this.itemServices.has(item_id)) {
        violations.push(
          makeViolation(
            "UNKNOWN_ITEM",
            "—",
            `content_part.added references unknown item '${item_id}'`,
          ),
        );
        return violations;
      }

      if (this.contentPartServices.has(key)) {
        violations.push(
          makeViolation(
            "DUPLICATE_CONTENT_PART",
            this.contentPartServices.get(key)!.current,
            `Content part '${key}' was already added`,
          ),
        );
        return violations;
      }

      const svc = createContentPartService();
      this.contentPartServices.set(key, svc);
      svc.send(event);
      return violations;
    }

    // -----------------------------------------------------------------------
    // Content part done
    // -----------------------------------------------------------------------
    if (type === "response.content_part.done") {
      const { item_id, content_index } = event;
      const key = `${item_id}:${content_index}`;

      const svc = this.contentPartServices.get(key);
      if (!svc) {
        violations.push(
          makeViolation(
            "UNKNOWN_CONTENT_PART",
            "—",
            `content_part.done for unknown content part '${key}'`,
          ),
        );
        return violations;
      }

      const currentState = svc.current;
      const ok = svc.send(event);
      if (!ok) {
        violations.push(
          makeViolation(
            "INVALID_CONTENT_PART_TRANSITION",
            currentState,
            `Event '${type}' is not valid in content-part state '${currentState}' for '${key}'`,
          ),
        );
      }
      return violations;
    }

    // -----------------------------------------------------------------------
    // Content-part delta/done events (carry item_id + content_index)
    // -----------------------------------------------------------------------
    if (CONTENT_PART_DELTA_TYPES.has(type)) {
      const deltaEvent = event as {
        type: string;
        item_id: string;
        content_index: number;
      };
      const { item_id, content_index } = deltaEvent;
      const key = `${item_id}:${content_index}`;

      if (!this.itemServices.has(item_id)) {
        violations.push(
          makeViolation(
            "UNKNOWN_ITEM",
            "—",
            `Event '${type}' references unknown item '${item_id}'`,
          ),
        );
        return violations;
      }

      const cpSvc = this.contentPartServices.get(key);
      if (!cpSvc) {
        violations.push(
          makeViolation(
            "UNKNOWN_CONTENT_PART",
            "—",
            `Event '${type}' references unknown content part '${key}'`,
          ),
        );
        return violations;
      }

      if (cpSvc.isTerminal) {
        violations.push(
          makeViolation(
            "INVALID_CONTENT_PART_TRANSITION",
            cpSvc.current,
            `Event '${type}' arrived after content part '${key}' was already done`,
          ),
        );
      }
      return violations;
    }

    // -----------------------------------------------------------------------
    // Item-level delta/done events (carry item_id, no content_index)
    // -----------------------------------------------------------------------
    if (ITEM_DELTA_TYPES.has(type)) {
      const deltaEvent = event as { type: string; item_id: string };
      const { item_id } = deltaEvent;

      const itemSvc = this.itemServices.get(item_id);
      if (!itemSvc) {
        violations.push(
          makeViolation(
            "UNKNOWN_ITEM",
            "—",
            `Event '${type}' references unknown item '${item_id}'`,
          ),
        );
        return violations;
      }

      if (itemSvc.isTerminal) {
        violations.push(
          makeViolation(
            "INVALID_ITEM_TRANSITION",
            itemSvc.current,
            `Event '${type}' arrived after item '${item_id}' was already done`,
          ),
        );
      }
      return violations;
    }

    // error events and anything else are pass-through
    return violations;
  }
}
