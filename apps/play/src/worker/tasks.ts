import { DurableObject } from "cloudflare:workers";

export interface Task {
  id: string;
  status: "open" | "done";
  title: string;
}

const initialTasks: Task[] = [
  { id: "task_1", title: "Connect Lemy to the playground API", status: "done" },
  { id: "task_2", title: "Ask which tasks are still open", status: "open" },
  { id: "task_3", title: "Complete a task with natural language", status: "open" },
];

export class PlayTasks extends DurableObject<Cloudflare.Env> {
  async list(): Promise<Task[]> {
    return await this.ctx.storage.get<Task[]>("tasks") ?? initialTasks.map((task) => ({ ...task }));
  }

  async create(title: string): Promise<Task> {
    const tasks = await this.list();
    if (tasks.length >= 20) throw new Error("The playground is limited to 20 tasks");
    const task: Task = { id: crypto.randomUUID(), title, status: "open" };
    await this.ctx.storage.put("tasks", [...tasks, task]);
    return task;
  }

  async complete(id: string): Promise<Task | null> {
    const tasks = await this.list();
    const task = tasks.find((item) => item.id === id);
    if (!task) return null;
    task.status = "done";
    await this.ctx.storage.put("tasks", tasks);
    return task;
  }

  async reset(): Promise<Task[]> {
    const tasks = initialTasks.map((task) => ({ ...task }));
    await this.ctx.storage.put("tasks", tasks);
    return tasks;
  }
}
