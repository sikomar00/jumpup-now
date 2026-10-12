// 할 일은 별도 저장소 없이 이벤트 로그에서 복원한다.
import { sortByTime, type AppEvent, type TaskSize } from './events'

export interface Task {
  id: string
  title: string
  due?: number
  size?: TaskSize
  done: boolean
  createdAt: number
}

/** 삭제되지 않은 할 일을 등록 순서대로 반환한다. 완료된 항목도 포함한다. */
export function foldTasks(events: readonly AppEvent[]): Task[] {
  const byId = new Map<string, Task>()
  for (const e of sortByTime(events)) {
    switch (e.type) {
      case 'task_add': {
        const task: Task = { id: e.id, title: e.title, done: false, createdAt: e.t }
        if (e.due !== undefined) task.due = e.due
        if (e.size !== undefined) task.size = e.size
        byId.set(e.id, task)
        break
      }
      case 'task_update': {
        const task = byId.get(e.id)
        if (!task) break
        if (e.title !== undefined) task.title = e.title
        if (e.due === null) delete task.due
        else if (e.due !== undefined) task.due = e.due
        if (e.size === null) delete task.size
        else if (e.size !== undefined) task.size = e.size
        break
      }
      case 'task_done': {
        const task = byId.get(e.id)
        if (task) task.done = true
        break
      }
      case 'task_delete':
        byId.delete(e.id)
        break
      default:
        break
    }
  }
  return [...byId.values()]
}

export function openTasks(tasks: readonly Task[]): Task[] {
  return tasks.filter((t) => !t.done)
}
