// lib/roleOrder.ts
// ONE sorting rule for accounts, used everywhere they are listed:
//   1. sort_order (admin=0, PD=1, DPDA=2, DPDO=3, P1-P10=10-19, WCPD=20, PPSMU=21, new=100)
//   2. creation date of the role, oldest first
//   3. role name (last tie-breaker so the order never jumps around)

export interface RoleOrderable {
  role: string;
  sortOrder?: number | null;
  roleCreatedAt?: string | null;
}

const LAST = Number.MAX_SAFE_INTEGER;

export function compareRoleOrder(a: RoleOrderable, b: RoleOrderable): number {
  const so = (a.sortOrder ?? LAST) - (b.sortOrder ?? LAST);
  if (so !== 0) return so;

  const at = a.roleCreatedAt ? Date.parse(a.roleCreatedAt) : LAST;
  const bt = b.roleCreatedAt ? Date.parse(b.roleCreatedAt) : LAST;
  if (at !== bt) return at - bt;

  return a.role.localeCompare(b.role, undefined, { numeric: true });
}
