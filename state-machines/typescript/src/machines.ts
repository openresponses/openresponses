import {
  createMachine as _createMachine,
  state as _state,
  transition as _transition,
  guard as _guard,
  interpret,
  type Machine,
  type Service,
  type Transition,
} from "robot3";

// robot3's TypeScript types are overly narrow when mixing multiple event names
// in a single state definition. These thin wrappers relax the generic constraint.
function state(...args: Transition<string>[]): ReturnType<typeof _state> {
  return _state(...(args as Parameters<typeof _state>));
}
function transition(
  event: string,
  target: string,
  ...guards: ReturnType<typeof _guard>[]
): Transition<string> {
  return _transition(event, target, ...guards) as Transition<string>;
}
function guard(fn: (ctx: unknown, ev: unknown) => boolean) {
  return _guard(fn);
}
function createMachine(
  states: Record<string, ReturnType<typeof _state>>,
): Machine {
  return _createMachine(
    states as Parameters<typeof _createMachine>[0],
  ) as Machine;
}

// A tracked service wraps a robot3 service and exposes whether the last send
// caused a state transition. This lets callers detect when robot3 silently
// ignored an unrecognised event (no transition = invalid).
export interface TrackedService {
  readonly current: string;
  readonly isTerminal: boolean;
  // Returns true if the event caused a state transition, false if rejected.
  send(event: { type: string }): boolean;
}

function createTrackedService(machine: Machine): TrackedService {
  // robot3's interpret requires an onChange callback; we use a no-op.
  const service: Service<Machine> = interpret(machine, () => {});

  return {
    get current(): string {
      return service.machine.current as string;
    },
    get isTerminal(): boolean {
      return service.machine.state.value.final;
    },
    send(event: { type: string }): boolean {
      const before = service.machine.current;
      // robot3 uses event.type to look up the transition; cast is safe here.
      service.send(event as Parameters<typeof service.send>[0]);
      return service.machine.current !== before;
    },
  };
}

// ---------------------------------------------------------------------------
// Response FSM
//
// idle → created → queued → in_progress → completed | failed | incomplete
//
// Key rules:
//  - response.failed can appear from idle (immediate failure)
//  - response.completed / response.incomplete require prior in_progress
//  - in_progress cannot loop back to in_progress
// ---------------------------------------------------------------------------
const responseMachineDef = createMachine({
  idle: state(
    transition("response.created", "created"),
    transition("response.queued", "queued"),
    transition("response.in_progress", "in_progress"),
    transition("response.failed", "failed"),
  ),
  created: state(
    transition("response.queued", "queued"),
    transition("response.in_progress", "in_progress"),
  ),
  queued: state(transition("response.in_progress", "in_progress")),
  in_progress: state(
    transition("response.completed", "completed"),
    transition("response.failed", "failed"),
    transition("response.incomplete", "incomplete"),
  ),
  // Terminal states — no transitions, so final: true is set by robot3
  completed: state(),
  failed: state(),
  incomplete: state(),
});

export function createResponseService(): TrackedService {
  return createTrackedService(responseMachineDef);
}

// ---------------------------------------------------------------------------
// Item FSM (one instance per item.id)
//
// idle → active → completed | incomplete
// ---------------------------------------------------------------------------
const itemMachineDef = createMachine({
  idle: state(transition("response.output_item.added", "active")),
  active: state(
    // Guard on item.status to route to the correct terminal state
    transition(
      "response.output_item.done",
      "completed",
      guard(
        (_ctx: unknown, ev: unknown) =>
          (ev as { item?: { status?: string } }).item?.status !== "incomplete",
      ),
    ),
    transition(
      "response.output_item.done",
      "incomplete",
      guard(
        (_ctx: unknown, ev: unknown) =>
          (ev as { item?: { status?: string } }).item?.status === "incomplete",
      ),
    ),
  ),
  completed: state(),
  incomplete: state(),
});

export function createItemService(): TrackedService {
  return createTrackedService(itemMachineDef);
}

// ---------------------------------------------------------------------------
// Content-Part FSM (one instance per `${item_id}:${content_index}`)
//
// idle → active → completed
// ---------------------------------------------------------------------------
const contentPartMachineDef = createMachine({
  idle: state(transition("response.content_part.added", "active")),
  active: state(transition("response.content_part.done", "completed")),
  completed: state(),
});

export function createContentPartService(): TrackedService {
  return createTrackedService(contentPartMachineDef);
}
