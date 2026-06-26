type TaskBudgetEditShape = {
  isNegotiable?: boolean;
  pickDropDetails?: unknown;
  subcategory?: string;
};

export function taskHasPickDropDetails(task: TaskBudgetEditShape): boolean {
  if (task.pickDropDetails && typeof task.pickDropDetails === 'object') {
    return true;
  }
  const sub = String(task.subcategory || '').toLowerCase();
  return sub.includes('pick') && sub.includes('drop');
}

/** Poster may change listed budget at most once via updateTask (Edit Work / Pick & Drop edit). */
export function enforcesOneTimePosterBudgetFormEdit(task: TaskBudgetEditShape): boolean {
  return task.isNegotiable === false || taskHasPickDropDetails(task);
}
