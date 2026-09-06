/**
 * The transient half of persistent-credential enrollment.
 *
 * A device mints a credential and hands the plaintext here so a browser can show
 * it to its owner exactly once. That is the only reason the cloud ever sees it.
 *
 * Everything in this file is deliberately in memory:
 *
 *   the user   holds the plaintext credential, durably;
 *   the device holds a verifier it cannot reverse;
 *   the cloud  holds nothing once the reveal has happened.
 *
 * A restart losing pending enrollments is correct behaviour, not a gap. The
 * plaintext must never reach PostgreSQL, a log, a trace, an event payload or a
 * metrics label, which is why it lives here and nowhere else.
 */

import { randomBytes } from 'node:crypto';

/** Where an enrollment has got to. */
export type EnrollmentStatus = 'pending' | 'approved' | 'revealed' | 'denied' | 'expired';

/** What the device asked for. */
export type EnrollmentRequest = Readonly<{
  deviceId: string;
  username: string;
  linuxUid: number;
  credentialId: string;
  /** Held only until the reveal, then destroyed. */
  credential: string;
  durationHours: number;
}>;

/** What a device learns when it polls. */
export type EnrollmentState = Readonly<{
  id: string;
  userCode: string;
  status: EnrollmentStatus;
  /** Set once a browser has approved; the device needs it to bind the record. */
  userId: string | null;
  approvedDurationHours: number | null;
}>;

/** What the browser is shown before approving. */
export type EnrollmentSummary = Readonly<{
  deviceId: string;
  username: string;
  durationHours: number;
  status: EnrollmentStatus;
}>;

type Enrollment = {
  id: string;
  userCode: string;
  request: EnrollmentRequest;
  status: EnrollmentStatus;
  userId: string | null;
  approvedDurationHours: number | null;
  /** Cleared the moment it is revealed; undefined thereafter. */
  credential: string | undefined;
  expiresAt: number;
};

/** Codes are read off a screen and retyped, so no confusable characters. */
const USER_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const USER_CODE_LENGTH = 8;
const ID_BYTES = 16;

/** An abandoned enrollment is worthless after this, and is swept away. */
const FIVE_MINUTES_MS = 300_000;
const DEFAULT_TTL_MS = FIVE_MINUTES_MS;

/** Raised when a reveal is attempted more than once. */
export class AlreadyRevealedError extends Error {
  constructor() {
    super('That credential has already been shown and cannot be shown again.');
    this.name = 'AlreadyRevealedError';
  }
}

const randomCode = (): string => {
  const bytes = randomBytes(USER_CODE_LENGTH);
  let code = '';
  for (const byte of bytes) {
    code += USER_CODE_ALPHABET[byte % USER_CODE_ALPHABET.length];
  }
  return code;
};

/** Relays a pending credential from a device to its owner's browser, once. */
export class EnrollmentRelay {
  readonly #byId = new Map<string, Enrollment>();
  readonly #byUserCode = new Map<string, string>();
  readonly #ttlMs: number;
  readonly #now: () => number;

  constructor(options: { ttlMs?: number; now?: () => number } = {}) {
    this.#ttlMs = options.ttlMs ?? DEFAULT_TTL_MS;
    this.#now = options.now ?? Date.now;
  }

  /** Accepts a device's enrollment and returns the code its owner will type. */
  create(request: EnrollmentRequest): EnrollmentState {
    this.#sweep();

    const id = randomBytes(ID_BYTES).toString('hex');
    const userCode = randomCode();
    const enrollment: Enrollment = {
      id,
      userCode,
      request,
      status: 'pending',
      userId: null,
      approvedDurationHours: null,
      credential: request.credential,
      expiresAt: this.#now() + this.#ttlMs,
    };

    this.#byId.set(id, enrollment);
    this.#byUserCode.set(userCode, id);
    return this.#state(enrollment);
  }

  /** What the browser shows before anyone approves anything. */
  summary(userCode: string): EnrollmentSummary | null {
    const enrollment = this.#find(userCode);
    if (enrollment === null) {
      return null;
    }
    return {
      deviceId: enrollment.request.deviceId,
      username: enrollment.request.username,
      durationHours: enrollment.request.durationHours,
      status: enrollment.status,
    };
  }

  /**
   * Records a browser approval. The caller has already checked that this user may
   * log in to the device and that the duration is acceptable; this only records
   * the decision.
   */
  approve(userCode: string, userId: string, approvedDurationHours: number): EnrollmentState | null {
    const enrollment = this.#find(userCode);
    if (enrollment?.status !== 'pending') {
      return null;
    }

    enrollment.status = 'approved';
    enrollment.userId = userId;
    enrollment.approvedDurationHours = approvedDurationHours;
    return this.#state(enrollment);
  }

  /** Records a refusal. The credential is destroyed with it. */
  deny(userCode: string): boolean {
    const enrollment = this.#find(userCode);
    if (enrollment?.status !== 'pending') {
      return false;
    }
    enrollment.status = 'denied';
    enrollment.credential = undefined;
    return true;
  }

  /**
   * Hands the plaintext over exactly once and destroys the cloud's copy in the
   * same step. There is no second chance by design: a credential that could be
   * re-read is a credential the cloud is storing.
   */
  reveal(userCode: string, userId: string): string {
    const enrollment = this.#find(userCode);
    if (enrollment?.userId !== userId) {
      throw new Error('That enrollment is not available.');
    }
    if (enrollment.status === 'revealed' || enrollment.credential === undefined) {
      throw new AlreadyRevealedError();
    }
    if (enrollment.status !== 'approved') {
      throw new Error('That enrollment has not been approved.');
    }

    const { credential } = enrollment;
    enrollment.credential = undefined;
    enrollment.status = 'revealed';
    return credential;
  }

  /** What the waiting device sees. */
  poll(id: string): EnrollmentState | null {
    this.#sweep();
    const enrollment = this.#byId.get(id);
    if (enrollment === undefined) {
      return null;
    }
    return this.#state(enrollment);
  }

  /** Drops an enrollment once the device has finished with it. */
  discard(id: string): void {
    const enrollment = this.#byId.get(id);
    if (enrollment === undefined) {
      return;
    }
    this.#byId.delete(id);
    this.#byUserCode.delete(enrollment.userCode);
  }

  #state(enrollment: Enrollment): EnrollmentState {
    return {
      id: enrollment.id,
      userCode: enrollment.userCode,
      status: enrollment.status,
      userId: enrollment.userId,
      approvedDurationHours: enrollment.approvedDurationHours,
    };
  }

  /** Looks an enrollment up by the code its owner types, sweeping stale ones. */
  #find(userCode: string): Enrollment | null {
    this.#sweep();
    const id = this.#byUserCode.get(userCode.trim().toUpperCase());
    if (id === undefined) {
      return null;
    }
    return this.#byId.get(id) ?? null;
  }

  /** Removes anything past its window, plaintext included. */
  #sweep(): void {
    const now = this.#now();
    for (const [id, enrollment] of this.#byId) {
      if (enrollment.expiresAt > now) {
        continue;
      }
      enrollment.credential = undefined;
      this.#byId.delete(id);
      this.#byUserCode.delete(enrollment.userCode);
    }
  }
}
