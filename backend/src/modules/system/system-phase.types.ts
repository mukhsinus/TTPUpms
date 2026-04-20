export type ProjectPhase = "submission" | "evaluation";

export interface ProjectPhaseState {
  phase: ProjectPhase;
  submissionDeadline: string | null;
  evaluationDeadline: string | null;
  lastChangedByUserId: string | null;
  lastChangedAt: string | null;
  lastChangedByName: string | null;
  lastChangedByEmail: string | null;
}
