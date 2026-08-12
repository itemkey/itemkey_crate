export type CategoryNavigationAction = "drill" | "enter" | "back";

export function shouldKeepCategoryPanelOpen(
  action: CategoryNavigationAction,
  activePanel: string | null
): boolean {
  if (activePanel !== "categories") {
    return false;
  }

  return action === "drill" || action === "back";
}
