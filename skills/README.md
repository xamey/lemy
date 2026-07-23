# Agent skills

Put each portable skill in its own directory:

```text
skills/
└── task-triage/
    └── SKILL.md
```

The directory name must match the `name` in the file's YAML frontmatter. Compose mounts this directory read-only at `/skills`.

`manage-lemy` is the portable control-plane skill for Lemy Cloud. Copy it into an agent's skills folder, create a token from **Automation MCP** in the Cloud dashboard, and connect the agent's MCP client to:

```text
https://YOUR_LEMY_ORIGIN/control/mcp
Authorization: Bearer lemy_agent_...
```
