import bcrypt from 'bcryptjs';
import type { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';

/**
 * JWT authentication and role-based access control.
 *
 * Roles mirror the actors in the problem domain. The split that matters: issuance and revocation are
 * privileged administrative actions, while third-party verification is deliberately public — a verifier
 * must be able to check a credential without holding an account on the platform.
 */

export type Role = 'LEARNER' | 'INSTRUCTOR' | 'ADMIN' | 'SUPPORT' | 'PLATFORM_ADMIN' | 'VERIFIER';

export interface AuthUser {
  user_id: string;
  email: string;
  role: Role;
  display_name: string;
  learner_id: string | null;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}

const TOKEN_TTL = '8h';

function secret(): string {
  const value = process.env.JWT_SECRET;
  if (!value || value.length === 0) {
    throw new Error('JWT_SECRET is not set — refusing to sign tokens with a default secret.');
  }
  return value;
}

export function signToken(user: AuthUser): string {
  return jwt.sign(
    { sub: user.user_id, email: user.email, role: user.role, name: user.display_name, learner_id: user.learner_id },
    secret(),
    { expiresIn: TOKEN_TTL, issuer: 'vericred' },
  );
}

export function verifyPassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}

/** Populates req.user when a valid bearer token is present; never rejects on its own. */
export function authenticate(req: Request, _res: Response, next: NextFunction): void {
  const header = req.headers.authorization;
  if (header?.startsWith('Bearer ')) {
    try {
      const payload = jwt.verify(header.slice(7), secret(), { issuer: 'vericred' }) as jwt.JwtPayload;
      req.user = {
        user_id: String(payload.sub),
        email: String(payload.email),
        role: payload.role as Role,
        display_name: String(payload.name ?? ''),
        learner_id: (payload.learner_id as string | null) ?? null,
      };
    } catch {
      // An invalid or expired token is treated as no token; requireRole decides what that costs.
    }
  }
  next();
}

/** Gate a route on a role. Deny reasons are explicit so the UI can say why an action is unavailable. */
export function requireRole(...roles: Role[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({ error: 'authentication_required', message: 'Sign in to perform this action.' });
      return;
    }
    if (!roles.includes(req.user.role)) {
      res.status(403).json({
        error: 'forbidden',
        message: `Role ${req.user.role} may not perform this action.`,
        required_roles: roles,
      });
      return;
    }
    next();
  };
}

/** Learners may read their own records; staff roles may read anyone's. */
export function requireSelfOrStaff(learnerIdParam: (req: Request) => string | undefined) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({ error: 'authentication_required' });
      return;
    }
    const staff: Role[] = ['ADMIN', 'PLATFORM_ADMIN', 'SUPPORT', 'INSTRUCTOR'];
    if (staff.includes(req.user.role)) {
      next();
      return;
    }
    if (req.user.role === 'LEARNER' && req.user.learner_id === learnerIdParam(req)) {
      next();
      return;
    }
    res.status(403).json({ error: 'forbidden', message: 'You may only view your own records.' });
  };
}

export const ROLE_CAPABILITIES: Record<Role, string[]> = {
  PLATFORM_ADMIN: ['issue_credential', 'revoke_credential', 'rescind_revocation', 'view_all', 'view_audit', 'run_ai_review'],
  ADMIN: ['issue_credential', 'revoke_credential', 'view_all', 'view_audit', 'run_ai_review'],
  INSTRUCTOR: ['view_all', 'view_audit'],
  SUPPORT: ['view_all', 'view_audit'],
  LEARNER: ['view_own'],
  VERIFIER: ['verify_credential'],
};
