const DEFAULT_TASK_PRIORITIES = {
  emergency: 100,
  supply: 85,
  combat: 55,
  mining: 45,
  pathfinder: 30,
  fishing: 20,
  chat: 10
};

class TaskScheduler {
  constructor(settings = {}) {
    this.current = null;
    this.queue = [];
    this.sequence = 0;
    this.configure(settings);
  }

  configure(settings = {}) {
    const source = settings.priorities || settings.scheduler?.priorities || settings;
    const priorities = {};
    for (const name of Object.keys(DEFAULT_TASK_PRIORITIES)) {
      const value = source?.[name];
      const priority = typeof value === 'object' && value !== null ? value.priority : value;
      if (priority !== undefined && Number.isFinite(Number(priority))) priorities[name] = Number(priority);
    }
    this.priorities = { ...DEFAULT_TASK_PRIORITIES, ...priorities };
  }

  priority(name) {
    return Number(this.priorities[name]) || 0;
  }

  async acquire(name = 'pathfinder') {
    const taskName = String(name || 'pathfinder');
    if (this.current?.name === taskName) {
      this.current.depth += 1;
      return this.createRelease(this.current);
    }
    return new Promise((resolve) => {
      this.queue.push({ name: taskName, priority: this.priority(taskName), sequence: this.sequence++, resolve });
      this.pump();
    });
  }

  createRelease(task) {
    let released = false;
    return () => {
      if (released) return;
      released = true;
      if (this.current !== task) return;
      task.depth -= 1;
      if (task.depth <= 0) {
        this.current = null;
        this.pump();
      }
    };
  }

  pump() {
    if (this.current || !this.queue.length) return;
    this.queue.sort((a, b) => b.priority - a.priority || a.sequence - b.sequence);
    const request = this.queue.shift();
    this.current = { ...request, depth: 1 };
    request.resolve(this.createRelease(this.current));
  }

  isBlocked(name) {
    return Boolean(this.current && this.current.name !== name && this.priority(this.current.name) > this.priority(name));
  }

  status() {
    return {
      active: this.current?.name || null,
      queued: this.queue.map((item) => item.name),
      priorities: { ...this.priorities }
    };
  }
}

module.exports = { TaskScheduler, DEFAULT_TASK_PRIORITIES };
