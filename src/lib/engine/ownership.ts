/**
 * Ownership (§3) — a graph, not a field.
 *
 * Two node kinds (people, legal entities) and one edge kind:
 *   owner holds X% of owned, where owned is a property or another entity.
 *
 * Effective share is the sum, over every path from the viewer to the property,
 * of the product of the percentages along that path. 50% of a property held by
 * an entity you hold 50% of is 25%; a further 10% held directly makes it 35%.
 */

import { covers, type IsoDate } from './dates';

export type OwnedType = 'property' | 'entity';
export type OwnershipBasis = 'equity' | 'distribution';

/** Which multiplier a traversal should use. */
export type ShareMode = 'equity' | 'distribution';

export interface OwnershipInterest {
  id: string;
  /** Entity id (a person is an entity with kind 'person'). */
  ownerId: string;
  ownedId: string;
  ownedType: OwnedType;
  /** Whole-number percentage: 50 means 50%. */
  percent: number;
  startDate: IsoDate;
  endDate: IsoDate | null;
  /**
   * 'equity' — an ownership record; used by both traversals.
   * 'distribution' — a cash-split override for the same owner/owned pair,
   *   used only by the distribution traversal (§3, "operating agreements often
   *   split cash differently from equity").
   */
  basis: OwnershipBasis;
  /**
   * Optional shorthand on an equity record: the cash split, when it differs.
   * Empty means cash follows equity.
   */
  distributionPercent?: number | null;
}

export interface EffectivePath {
  /** Node ids from viewer to target, inclusive. */
  nodes: string[];
  /** Interest ids traversed, in order. */
  interestIds: string[];
  /** Product of the percentages along the path, as a percentage. */
  percent: number;
}

export interface EffectiveShare {
  percent: number;
  paths: EffectivePath[];
}

const EMPTY_SHARE: EffectiveShare = { percent: 0, paths: [] };

/** Interests in force on a date, with the mode's multiplier resolved. */
interface ResolvedEdge {
  interestId: string;
  ownerId: string;
  ownedId: string;
  ownedType: OwnedType;
  percent: number;
}

function resolveEdges(
  interests: readonly OwnershipInterest[],
  asOf: IsoDate,
  mode: ShareMode,
): ResolvedEdge[] {
  const active = interests.filter((i) => covers(i, asOf));

  if (mode === 'equity') {
    return active
      .filter((i) => i.basis === 'equity')
      .map((i) => ({
        interestId: i.id,
        ownerId: i.ownerId,
        ownedId: i.ownedId,
        ownedType: i.ownedType,
        percent: i.percent,
      }));
  }

  // Distribution mode: an explicit 'distribution' record wins over the equity
  // record for the same owner/owned pair; otherwise distributionPercent
  // overrides; otherwise cash follows equity.
  const overrides = new Map<string, OwnershipInterest>();
  for (const i of active) {
    if (i.basis === 'distribution') overrides.set(`${i.ownerId}>${i.ownedId}`, i);
  }

  const edges: ResolvedEdge[] = [];
  for (const i of active) {
    if (i.basis === 'distribution') continue;
    const override = overrides.get(`${i.ownerId}>${i.ownedId}`);
    const percent = override ? override.percent : (i.distributionPercent ?? i.percent);
    edges.push({
      interestId: override ? override.id : i.id,
      ownerId: i.ownerId,
      ownedId: i.ownedId,
      ownedType: i.ownedType,
      percent,
    });
  }

  // A distribution record with no matching equity record still grants cash.
  for (const [key, i] of overrides) {
    if (!edges.some((e) => `${e.ownerId}>${e.ownedId}` === key)) {
      edges.push({
        interestId: i.id,
        ownerId: i.ownerId,
        ownedId: i.ownedId,
        ownedType: i.ownedType,
        percent: i.percent,
      });
    }
  }

  return edges;
}

/** owner -> edges out of that owner. */
function indexByOwner(edges: readonly ResolvedEdge[]): Map<string, ResolvedEdge[]> {
  const byOwner = new Map<string, ResolvedEdge[]>();
  for (const e of edges) {
    const list = byOwner.get(e.ownerId);
    if (list) list.push(e);
    else byOwner.set(e.ownerId, [e]);
  }
  return byOwner;
}

/**
 * Effective share of `targetId` held by `viewerId` on `asOf`.
 *
 * Walks every path and sums the products. Cycles are impossible in valid data
 * (they are rejected on entry, see `findCycles`) but the traversal guards
 * against them anyway rather than hanging on a bad record.
 */
export function effectiveShare(
  interests: readonly OwnershipInterest[],
  viewerId: string,
  targetId: string,
  asOf: IsoDate,
  mode: ShareMode = 'equity',
): EffectiveShare {
  if (viewerId === targetId) return { percent: 100, paths: [{ nodes: [viewerId], interestIds: [], percent: 100 }] };

  const byOwner = indexByOwner(resolveEdges(interests, asOf, mode));
  const paths: EffectivePath[] = [];

  const walk = (nodeId: string, factor: number, nodes: string[], interestIds: string[], onPath: Set<string>) => {
    for (const edge of byOwner.get(nodeId) ?? []) {
      if (onPath.has(edge.ownedId)) continue; // cycle guard
      const nextFactor = (factor * edge.percent) / 100;
      const nextNodes = [...nodes, edge.ownedId];
      const nextInterests = [...interestIds, edge.interestId];

      if (edge.ownedId === targetId) {
        paths.push({ nodes: nextNodes, interestIds: nextInterests, percent: nextFactor });
        continue; // a property is a leaf; an entity that is the target ends the path
      }
      if (edge.ownedType === 'entity') {
        onPath.add(edge.ownedId);
        walk(edge.ownedId, nextFactor, nextNodes, nextInterests, onPath);
        onPath.delete(edge.ownedId);
      }
    }
  };

  walk(viewerId, 100, [viewerId], [], new Set([viewerId]));

  if (paths.length === 0) return EMPTY_SHARE;
  const percent = paths.reduce((sum, p) => sum + p.percent, 0);
  return { percent, paths };
}

/** Effective share of every property reachable from the viewer. */
export function effectiveShares(
  interests: readonly OwnershipInterest[],
  viewerId: string,
  asOf: IsoDate,
  mode: ShareMode = 'equity',
): Map<string, EffectiveShare> {
  const targets = new Set(
    resolveEdges(interests, asOf, mode)
      .filter((e) => e.ownedType === 'property')
      .map((e) => e.ownedId),
  );

  const out = new Map<string, EffectiveShare>();
  for (const target of targets) {
    const share = effectiveShare(interests, viewerId, target, asOf, mode);
    if (share.percent > 0) out.set(target, share);
  }
  return out;
}

export interface TotalsWarning {
  ownedId: string;
  ownedType: OwnedType;
  totalPercent: number;
}

/**
 * Interests in any one thing should total 100% on a given date.
 * Warn rather than block — partial records are normal during entry (§3).
 */
export function findTotalsWarnings(
  interests: readonly OwnershipInterest[],
  asOf: IsoDate,
  basis: OwnershipBasis = 'equity',
): TotalsWarning[] {
  const totals = new Map<string, { type: OwnedType; total: number }>();
  for (const i of interests) {
    if (i.basis !== basis || !covers(i, asOf)) continue;
    const current = totals.get(i.ownedId);
    if (current) current.total += i.percent;
    else totals.set(i.ownedId, { type: i.ownedType, total: i.percent });
  }

  const warnings: TotalsWarning[] = [];
  for (const [ownedId, { type, total }] of totals) {
    // Tolerate float dust from percentages like 33.333.
    if (Math.abs(total - 100) > 0.005) {
      warnings.push({ ownedId, ownedType: type, totalPercent: total });
    }
  }
  return warnings.sort((a, b) => a.ownedId.localeCompare(b.ownedId));
}

/**
 * Cycles are rejected outright (§3). Returns each cycle as a node list.
 * Ignores dates: a cycle at any point in time is a data error.
 */
export function findCycles(interests: readonly OwnershipInterest[]): string[][] {
  const byOwner = new Map<string, string[]>();
  for (const i of interests) {
    if (i.ownedType !== 'entity') continue; // properties own nothing
    const list = byOwner.get(i.ownerId);
    if (list) list.push(i.ownedId);
    else byOwner.set(i.ownerId, [i.ownedId]);
  }

  const cycles: string[][] = [];
  const seen = new Set<string>();
  const stack: string[] = [];
  const onStack = new Set<string>();

  const visit = (node: string) => {
    stack.push(node);
    onStack.add(node);
    for (const next of byOwner.get(node) ?? []) {
      if (onStack.has(next)) {
        cycles.push([...stack.slice(stack.indexOf(next)), next]);
      } else if (!seen.has(next)) {
        visit(next);
      }
    }
    onStack.delete(node);
    stack.pop();
    seen.add(node);
  };

  for (const owner of byOwner.keys()) if (!seen.has(owner)) visit(owner);
  return cycles;
}

/** Would adding this interest create a cycle? Used to reject before write. */
export function wouldCreateCycle(
  existing: readonly OwnershipInterest[],
  candidate: Pick<OwnershipInterest, 'ownerId' | 'ownedId' | 'ownedType'>,
): boolean {
  if (candidate.ownedType !== 'entity') return false;
  if (candidate.ownerId === candidate.ownedId) return true;
  const probe: OwnershipInterest = {
    id: '__candidate__',
    ownerId: candidate.ownerId,
    ownedId: candidate.ownedId,
    ownedType: 'entity',
    percent: 0,
    startDate: '1970-01-01',
    endDate: null,
    basis: 'equity',
  };
  return findCycles([...existing, probe]).length > 0;
}
