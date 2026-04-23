export type ProjectPhase = "submission" | "evaluation";

export type AcademicSemester = "first" | "second";

export interface ProjectPhaseState {
  phase: ProjectPhase;
  semester: AcademicSemester;
  submissionDeadline: string | null;
  evaluationDeadline: string | null;
  lastChangedByUserId: string | null;
  lastChangedAt: string | null;
  lastChangedByName: string | null;
  lastChangedByEmail: string | null;
  lastSemesterChangedByUserId: string | null;
  lastSemesterChangedAt: string | null;
  lastSemesterChangedByName: string | null;
  lastSemesterChangedByEmail: string | null;
}
