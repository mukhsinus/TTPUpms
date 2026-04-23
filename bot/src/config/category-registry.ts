import type { CategoryCatalogEntry } from "../types/session";

export interface BotCategoryConfig {
  headline: string;
  subtitle?: string;
  pointsLines: string[];
  titleExamples: [string, string, string];
}

const CATEGORY_CODES_REQUIRING_PLACE_METADATA = new Set(["internal_competitions", "olympiads"]);

const CATEGORY_CONFIG_REGISTRY: Record<string, BotCategoryConfig> = {
  internal_competitions: {
    headline:
      "🏆 Successful participation in internal competitions aimed at developing students' practical skills",
    subtitle:
      "(MS Office skills, AI prompt engineering, communication, leadership, presentation, pitching, speed typing, etc.)",
    pointsLines: [
      "Based on the results of internal competitions:",
      "🥇 1st place — 5 points",
      "🥈 2nd place — 4 points",
      "🥉 3rd place — 3 points",
    ],
    titleExamples: [
      "1st place in AI Prompt Challenge",
      "2nd place in Presentation Skills Contest",
      "3rd place in Speed Typing Tournament",
    ],
  },
  scientific_activity: {
    headline:
      "🔬 Scientific activity: patents, research articles, inventions/MVPs, software development, conference presentations, participation in scientific projects",
    pointsLines: [
      "Available points:",
      "• Patent — 10 points",
      "• DGUs (Indexed journals of higher category) — 6 points",
      "• Articles in international scientific journals — 8 points",
      "• Articles in local scientific journals — 5 points",
      "• MVP — 1-8 points",
      "• Software development — 1-7 points",
      "• Conference presentations — 4 points",
      "• Participation in scientific, innovative, or applied projects — 4 points",
    ],
    titleExamples: [
      "Patent for smart attendance system",
      "IEEE article on AI-based forecasting",
      "MVP for campus service mobile app",
    ],
  },
  student_initiatives: {
    headline: "🎓 Initiatives aimed at improving student life",
    subtitle: "(organizing study courses to support students' academic progress)",
    pointsLines: [
      "Scoring:",
      "Based on the recommendation of the Student Union, up to a maximum of 5 points may be awarded for each course conducted.",
    ],
    titleExamples: [
      "Organized C++ support course for freshmen",
      "Led weekly math tutoring sessions",
      "Created exam preparation workshop series",
    ],
  },
  it_certificates: {
    headline: "💻 Internationally recognized IT certificates",
    subtitle: "(Google, Oracle, Cisco, etc.)",
    pointsLines: [
      "Scoring:",
      "• Google Professional / Cisco CCNP — 9-10 points",
      "• Cisco Associate / Oracle Associate — 7-8 points",
      "• Entry-level certificates (MOS, ICDL) — 5-6 points",
      "• Internationally recognized online courses — 1-3 points",
    ],
    titleExamples: [
      "Google Professional Data Analytics Certificate",
      "Cisco CCNA certification",
      "Microsoft Office Specialist Excel Expert",
    ],
  },
  language_certificates: {
    headline: "🌍 Language proficiency certificates",
    subtitle: "(IELTS, TOEFL, HSK, TestDaF, etc.)",
    pointsLines: [
      "Scoring:",
      "• IELTS 8.0+ / TOEFL 110+ or equivalent — 7 points",
      "• IELTS 7.0–7.5 / TOEFL 90–109 or equivalent — 6 points",
      "• IELTS 6.0–6.5 / TOEFL 70–89 or equivalent — 5 points",
    ],
    titleExamples: [
      "IELTS Academic 7.5 certificate",
      "TOEFL iBT 102 result",
      "HSK 5 certificate",
    ],
  },
  standardized_tests: {
    headline: "📘 International standardized tests",
    subtitle: "(SAT, GRE, GMAT, etc.)",
    pointsLines: [
      "Scoring:",
      "• SAT 1400+, GRE 160+, GMAT 700+ — 7 points",
      "• SAT 1300–1400, GRE 150–160, GMAT 650–700 — 6 points",
      "• SAT 1200–1300, GRE 140–150, GMAT 600–650 — 5 points",
    ],
    titleExamples: [
      "SAT score 1420 report",
      "GRE Quant 161 result",
      "GMAT score 680 report",
    ],
  },
  educational_activity: {
    headline:
      "📚 Active participation in improving the university's educational and methodological activities",
    subtitle:
      "(textbooks, study guides, exam questions, content creation, video lessons, digital materials, peer-learning)",
    pointsLines: [
      "Scoring:",
      "Based on the recommendation of the Educational and Methodological Department, a maximum of 7 points may be awarded.",
    ],
    titleExamples: [
      "Co-authored university Python study guide",
      "Prepared exam question bank for Databases",
      "Recorded video lessons for Algorithms course",
    ],
  },
  olympiads: {
    headline: "🏅 Winning in subject Olympiads, hackathons, and competitions",
    subtitle: "In national and international subject Olympiads and hackathons:",
    pointsLines: ["• 1st place — 10 points", "• 2nd place — 8 points", "• 3rd place — 6 points"],
    titleExamples: [
      "1st place at National Programming Olympiad",
      "2nd place in University Hackathon Finals",
      "3rd place in Regional Math Olympiad",
    ],
  },
  volunteering: {
    headline: "🤝 Volunteer activities",
    pointsLines: [
      "Scoring:",
      "• Based on the recommendation of the Student Union — maximum 5 points",
      "• Internships in university departments on a voluntary basis — 1–10 points",
    ],
    titleExamples: [
      "Volunteer coordinator at university open day",
      "Student Union community service volunteer",
      "Volunteer internship at dean's office",
    ],
  },
  work_experience: {
    headline: "💼 Professional work experience in the relevant field for at least 3 months",
    pointsLines: [
      "Scoring:",
      "• Working for more than 1 year — 10 points",
      "• Working for 6 months to 1 year — 8 points",
      "• Working for 3 to 6 months — 5 points",
    ],
    titleExamples: [
      "Software engineer internship at EPAM (6 months)",
      "Frontend developer at local startup (1 year)",
      "Data analyst trainee at IT company (4 months)",
    ],
  },
};

export function normalizedCategoryCode(category: CategoryCatalogEntry): string {
  return (category.code || category.name || "").trim().toLowerCase();
}

export function categoryRequiresPlacementMetadata(category: CategoryCatalogEntry): boolean {
  return CATEGORY_CODES_REQUIRING_PLACE_METADATA.has(normalizedCategoryCode(category));
}

export function getCategoryConfig(category: CategoryCatalogEntry): BotCategoryConfig | undefined {
  return CATEGORY_CONFIG_REGISTRY[normalizedCategoryCode(category)];
}

export function buildCategoryIntroMessage(
  category: CategoryCatalogEntry,
  options?: { includeTitlePrompt?: boolean },
): string {
  const includeTitlePrompt = options?.includeTitlePrompt ?? true;
  const config = getCategoryConfig(category);
  const msgParts = config
    ? [config.headline, config.subtitle ?? "", config.pointsLines.join("\n")].filter(Boolean)
    : [
        `📂 ${category.title}`,
        category.description ?? "",
        `💡 What counts:\n${category.whatCounts ?? ""}`,
        `🏆 Scoring:\n${category.scoring ?? ""}`,
      ].filter((part) => part.trim().length > 0);

  let msg = msgParts.join("\n\n");
  if (includeTitlePrompt) {
    const examples = config?.titleExamples ?? [
      "Achievement title with year",
      "Competition result title",
      "Certificate title and score",
    ];
    msg +=
      `\n\n✏️ Now enter a short title for your achievement:\n\n` +
      `Examples:\n` +
      `• ${examples[0]}\n` +
      `• ${examples[1]}\n` +
      `• ${examples[2]}`;
  }
  return msg;
}
