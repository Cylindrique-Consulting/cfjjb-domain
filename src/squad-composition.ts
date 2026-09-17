import { fnv1a, mulberry32 } from "./prng";
import { DEFAULT_SEEDING_PLAN, type SeedingPlan } from "./seeding-plan";

export const SQUAD_LETTERS = ["A", "B", "C"] as const;
export type SquadLetter = (typeof SQUAD_LETTERS)[number];

export type SquadSource = "club" | "auto" | "federation";

export const SQUAD_WINDOW_HOURS_DEFAULT = 72;
export const SQUAD_WINDOW_HOURS_MAX = 336;

export type SquadCandidate = {
  readonly registrationId: string;
  readonly clubId: string | null;
  readonly teamId?: string | null;
  readonly categoryKey: string;
  readonly letter?: SquadLetter | null;
  readonly source?: SquadSource | null;
};

export type SquadAssignment = {
  readonly registrationId: string;
  readonly clubId: string;
  readonly ownerId: string;
  readonly categoryKey: string;
  readonly letter: SquadLetter;
  readonly source: SquadSource;
};

export type SquadComposition = {
  readonly assignments: readonly SquadAssignment[];
  readonly squads: readonly {
    readonly clubId: string;
    readonly teamId: string | null;
    readonly letter: SquadLetter;
  }[];
  readonly withoutClub: readonly string[];
};

export function squadCompositionDeadline(
  registrationsCloseAtIso: string | null | undefined,
  windowHours: number = SQUAD_WINDOW_HOURS_DEFAULT,
): string | null {
  if (!registrationsCloseAtIso) return null;
  const closeAt = Date.parse(registrationsCloseAtIso);
  if (!Number.isFinite(closeAt) || !Number.isFinite(windowHours)) return null;
  return new Date(closeAt + windowHours * 3_600_000).toISOString();
}

export function isSquadWindowOpen(
  nowIso: string,
  registrationsCloseAtIso: string | null | undefined,
  windowHours: number = SQUAD_WINDOW_HOURS_DEFAULT,
): boolean {
  const deadline = squadCompositionDeadline(registrationsCloseAtIso, windowHours);
  if (deadline === null) return false;
  const now = Date.parse(nowIso);
  if (!Number.isFinite(now)) return false;
  return now < Date.parse(deadline);
}

function drawKey(seed: string, registrationId: string): number {
  return mulberry32(fnv1a(`${seed}|squad|${registrationId}`))();
}

function leastLoadedLetter(load: ReadonlyMap<SquadLetter, number>): SquadLetter {
  let best: SquadLetter = "A";
  let bestLoad = Number.POSITIVE_INFINITY;
  for (const letter of SQUAD_LETTERS) {
    const n = load.get(letter) ?? 0;
    if (n < bestLoad) {
      best = letter;
      bestLoad = n;
    }
  }
  return best;
}

export function autoComposeSquads(
  candidates: readonly SquadCandidate[],
  seed: string,
): SquadComposition {
  const withoutClub: string[] = [];

  const load = new Map<string, Map<SquadLetter, number>>();
  const loadOf = (ownerId: string, categoryKey: string): Map<SquadLetter, number> => {
    const key = ownerId.length + ":" + ownerId + ":" + categoryKey;
    const existing = load.get(key);
    if (existing) return existing;
    const fresh = new Map<SquadLetter, number>();
    load.set(key, fresh);
    return fresh;
  };

  const withClub = (c: SquadCandidate): c is SquadCandidate & { clubId: string } =>
    typeof c.clubId === "string" && c.clubId.length > 0;

  const owner = (c: SquadCandidate & { clubId: string }): string =>
    typeof c.teamId === "string" && c.teamId.length > 0 ? c.teamId : c.clubId;

  for (const c of candidates) {
    if (!withClub(c) || !c.letter) continue;
    const l = loadOf(owner(c), c.categoryKey);
    l.set(c.letter, (l.get(c.letter) ?? 0) + 1);
  }

  const aComposer = candidates
    .filter(withClub)
    .filter((c) => !c.letter)
    .map((candidate) => ({ candidate, key: drawKey(seed, candidate.registrationId) }))
    .sort(
      (a, b) => a.key - b.key || (a.candidate.registrationId < b.candidate.registrationId ? -1 : 1),
    );

  const composed = new Map<string, SquadLetter>();
  for (const { candidate } of aComposer) {
    const l = loadOf(owner(candidate), candidate.categoryKey);
    const letter = leastLoadedLetter(l);
    l.set(letter, (l.get(letter) ?? 0) + 1);
    composed.set(candidate.registrationId, letter);
  }

  const assignments: SquadAssignment[] = [];
  const squads: { clubId: string; teamId: string | null; letter: SquadLetter }[] = [];
  const seen = new Set<string>();

  for (const c of candidates) {
    if (!withClub(c)) {
      withoutClub.push(c.registrationId);
      continue;
    }
    const letter = c.letter ?? composed.get(c.registrationId);
    if (!letter) continue;
    const ownerId = owner(c);
    assignments.push({
      registrationId: c.registrationId,
      clubId: c.clubId,
      ownerId,
      categoryKey: c.categoryKey,
      letter,
      source: c.letter ? (c.source ?? "club") : "auto",
    });
    const squadKey = squadTeamId(ownerId, letter);
    if (!seen.has(squadKey)) {
      seen.add(squadKey);
      squads.push({
        clubId: c.clubId,
        teamId: ownerId === c.clubId ? null : ownerId,
        letter,
      });
    }
  }

  return { assignments, squads, withoutClub };
}

export function squadTeamId(ownerId: string, letter: SquadLetter): string {
  return `${ownerId}#${letter}`;
}

export const SQUAD_SEEDING_PLAN: SeedingPlan = {
  order: DEFAULT_SEEDING_PLAN.order,
  constraints: DEFAULT_SEEDING_PLAN.constraints.map((c) =>
    c.key === "team" ? { ...c, enabled: true } : c,
  ),
  pins: DEFAULT_SEEDING_PLAN.pins,
};

export type DepassementParEquipe = {
  readonly ownerId: string;
  readonly categoryKey: string;
  readonly registrationIds: readonly string[];
};

export function detecterDepassementsParEquipe(
  candidates: readonly SquadCandidate[],
  seuil = 2,
): DepassementParEquipe[] {
  const groupes = new Map<string, { ownerId: string; categoryKey: string; ids: string[] }>();

  for (const c of candidates) {
    if (typeof c.clubId !== "string" || c.clubId.length === 0) continue;
    const ownerId = typeof c.teamId === "string" && c.teamId.length > 0 ? c.teamId : c.clubId;
    const key = ownerId.length + ":" + ownerId + ":" + c.categoryKey;
    const g = groupes.get(key) ?? { ownerId, categoryKey: c.categoryKey, ids: [] };
    g.ids.push(c.registrationId);
    groupes.set(key, g);
  }

  return [...groupes.values()]
    .filter((g) => g.ids.length > seuil)
    .map((g) => ({ ownerId: g.ownerId, categoryKey: g.categoryKey, registrationIds: g.ids }))
    .sort(
      (a, b) =>
        b.registrationIds.length - a.registrationIds.length ||
        a.ownerId.localeCompare(b.ownerId) ||
        a.categoryKey.localeCompare(b.categoryKey),
    );
}
