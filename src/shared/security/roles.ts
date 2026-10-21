export const ROLES = { USER: 'USER', ADMIN: 'ADMIN' } as const;

export type Role = (typeof ROLES)[keyof typeof ROLES];

export const ROLE_VALUES = [ROLES.USER, ROLES.ADMIN] as const;
