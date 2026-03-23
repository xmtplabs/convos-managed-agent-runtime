import type { AgentSkill } from "./types";

const BLOCKED_CONTACT_SKILLS = new Set(["email", "phone", "sms"]);

function normalizeSkill(skill: string): string {
  return skill.trim().toLowerCase();
}

export function isReleaseCandidateTemplate(template: AgentSkill): boolean {
  return !template.skills.some((skill) =>
    BLOCKED_CONTACT_SKILLS.has(normalizeSkill(skill)),
  );
}

export function filterReleaseCandidateTemplates(
  templates: AgentSkill[],
): AgentSkill[] {
  return templates.filter(isReleaseCandidateTemplate);
}
