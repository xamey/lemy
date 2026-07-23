import { describe, expect, it } from "vitest";

import { formatSkillMarkdown, parseSkillMarkdown } from "../src/skill-file";

describe("SKILL.md", () => {
  it("imports standard frontmatter and Markdown instructions", () => {
    expect(parseSkillMarkdown(`---
name: task-triage
description: Use when reviewing or prioritizing tasks.
---

# Workflow

Check overdue tasks first.
`)).toEqual({
      name: "task-triage",
      description: "Use when reviewing or prioritizing tasks.",
      instructions: "# Workflow\n\nCheck overdue tasks first.",
    });
  });

  it("exports a document that round-trips", () => {
    const skill = {
      name: "task-triage",
      description: "Use when reviewing or prioritizing tasks.",
      instructions: "# Workflow\n\nCheck overdue tasks first.",
    };

    expect(parseSkillMarkdown(formatSkillMarkdown(skill))).toEqual(skill);
  });

  it("rejects missing instructions and invalid names", () => {
    expect(() => parseSkillMarkdown("---\nname: Task Triage\ndescription: Use it.\n---\n"))
      .toThrow("skill name");
    expect(() => parseSkillMarkdown("---\nname: task-triage\ndescription: Use it.\n---\n"))
      .toThrow("instructions");
  });
});
