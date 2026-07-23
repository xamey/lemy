import { parse as parseYaml, stringify as stringifyYaml } from "yaml";

export interface AgentSkill {
  name: string;
  description: string;
  instructions: string;
}

const skillNamePattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const frontmatterPattern = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)([\s\S]*)$/;

function validateSkill(skill: AgentSkill): AgentSkill {
  const name = skill.name.trim();
  const description = skill.description.trim();
  const instructions = skill.instructions.trim();

  if (!skillNamePattern.test(name) || name.length > 64) throw new Error("Invalid skill name");
  if (!description || description.length > 1_024) throw new Error("Invalid skill description");
  if (!instructions || instructions.length > 20_000) throw new Error("Invalid skill instructions");

  return { name, description, instructions };
}

export function parseSkillMarkdown(markdown: string): AgentSkill {
  const document = frontmatterPattern.exec(markdown);
  if (!document) throw new Error("SKILL.md must start with YAML frontmatter");

  const metadata = parseYaml(document[1]);
  if (!metadata || typeof metadata !== "object") throw new Error("SKILL.md frontmatter is invalid");

  return validateSkill({
    name: "name" in metadata && typeof metadata.name === "string" ? metadata.name : "",
    description: "description" in metadata && typeof metadata.description === "string" ? metadata.description : "",
    instructions: document[2],
  });
}

export function formatSkillMarkdown(skill: AgentSkill): string {
  const validated = validateSkill(skill);
  const frontmatter = stringifyYaml({
    name: validated.name,
    description: validated.description,
  }).trim();
  return `---\n${frontmatter}\n---\n\n${validated.instructions}\n`;
}
