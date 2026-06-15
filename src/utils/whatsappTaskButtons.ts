/** Dynamic URL button vars for WhatsApp templates that open the mobile app bridge. */
export type WhatsAppTemplateButtonVar = {
  index: number;
  var_1: string;
};

const MONGO_ID_RE = /^[a-f0-9]{24}$/i;

export function isMongoTaskId(value: string): boolean {
  return MONGO_ID_RE.test(String(value || '').trim());
}

/** Button index 0 → suffix for https://extrahand.in/open/tasks/{{1}} (or .../track). */
export function taskOpenAppButton(taskId: string): WhatsAppTemplateButtonVar[] | undefined {
  const id = String(taskId || '').trim();
  if (!isMongoTaskId(id)) return undefined;
  return [{ index: 0, var_1: id }];
}
