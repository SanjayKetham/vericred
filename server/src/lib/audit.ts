import { auditEventId, canonicalize, sha256Hex } from './deterministic.js';
import type { ActorRole, AuditEntityType, AuditEvent, AuditEventType } from './types.js';

export const GENESIS_HASH = '0'.repeat(64);

/**
 * Append-only, hash-chained audit log.
 *
 * Each event hashes (prev_hash + canonical form of the event body). Changing or deleting any historical
 * row breaks every link after it, so the log is tamper-evident rather than merely append-ordered. State
 * changes are recorded as new events; nothing is ever rewritten in place.
 */
export class AuditChain {
  private readonly events: AuditEvent[] = [];
  private prevHash = GENESIS_HASH;
  private seq = 0;

  append(input: {
    entity_type: AuditEntityType;
    entity_id: string;
    event_type: AuditEventType;
    actor_id: string;
    actor_role: ActorRole;
    occurred_at: Date;
    payload: Record<string, unknown>;
  }): AuditEvent {
    this.seq += 1;
    const body = {
      event_id: auditEventId(this.seq),
      event_seq: this.seq,
      entity_type: input.entity_type,
      entity_id: input.entity_id,
      event_type: input.event_type,
      actor_id: input.actor_id,
      actor_role: input.actor_role,
      occurred_at: input.occurred_at.toISOString(),
      payload_json: canonicalize(input.payload),
    };
    const event: AuditEvent = {
      ...body,
      prev_hash: this.prevHash,
      event_hash: sha256Hex(this.prevHash + canonicalize(body)),
    };
    this.prevHash = event.event_hash;
    this.events.push(event);
    return event;
  }

  /** Events sorted by occurrence, then resequenced so event_seq is monotonic in time with no gaps. */
  finalize(): AuditEvent[] {
    const sorted = [...this.events].sort((a, b) => {
      const t = Date.parse(a.occurred_at) - Date.parse(b.occurred_at);
      return t !== 0 ? t : a.event_seq - b.event_seq;
    });

    let prev = GENESIS_HASH;
    return sorted.map((event, index) => {
      const seq = index + 1;
      const body = {
        event_id: auditEventId(seq),
        event_seq: seq,
        entity_type: event.entity_type,
        entity_id: event.entity_id,
        event_type: event.event_type,
        actor_id: event.actor_id,
        actor_role: event.actor_role,
        occurred_at: event.occurred_at,
        payload_json: event.payload_json,
      };
      const rechained: AuditEvent = {
        ...body,
        prev_hash: prev,
        event_hash: sha256Hex(prev + canonicalize(body)),
      };
      prev = rechained.event_hash;
      return rechained;
    });
  }

  get length(): number {
    return this.events.length;
  }
}

/** Replays a chain and reports the first link that does not reconcile. */
export function verifyAuditChain(events: AuditEvent[]): { valid: boolean; brokenAt: string | null } {
  let prev = GENESIS_HASH;
  for (const event of events) {
    const body = {
      event_id: event.event_id,
      event_seq: event.event_seq,
      entity_type: event.entity_type,
      entity_id: event.entity_id,
      event_type: event.event_type,
      actor_id: event.actor_id,
      actor_role: event.actor_role,
      occurred_at: event.occurred_at,
      payload_json: event.payload_json,
    };
    if (event.prev_hash !== prev || event.event_hash !== sha256Hex(prev + canonicalize(body))) {
      return { valid: false, brokenAt: event.event_id };
    }
    prev = event.event_hash;
  }
  return { valid: true, brokenAt: null };
}
