/** Exact authorization vocabulary and grant rules ported from northstar_api/access_policy.py.
 * Pure module: transport authentication and workspace membership checks remain separate.
 */
export const ORGANIZATION_PERMISSIONS = new Set([
  "organization.view","organization.profile.update","organization.members.invite",
  "organization.roles.manage","organization.ownership.transfer","organization.audit.view",
  "workspace.create","billing.view","billing.manage","security.view","security.manage",
  "usage.view","organization.branding.edit","organization.branding.publish",
]);
export const PERMISSION_ALIASES: Readonly<Record<string,string>> = {
  "workspace.read":"workspace.view","members.read":"members.view",
  "members.update":"members.manage","members.remove":"members.manage",
  "roles.read":"roles.manage","roles.create":"roles.manage",
  "roles.update":"roles.manage","roles.delete":"roles.manage",
  "agents.read":"agents.view","channels.read":"channels.view",
  "channels.connect":"channels.connections.manage","channels.update":"channels.manage",
  "channels.disconnect":"channels.connections.manage",
  "conversations.read":"conversations.view","conversations.close":"conversations.resolve",
  "leads.read":"leads.view","leads.create":"leads.update",
  "crm.read":"crm.view","crm.configure":"crm.manage","crm.sync":"crm.manage",
  "education.read":"education.view","education.manage_courses":"education.courses.manage",
  "education.manage_students":"education.students.manage",
  "education.manage_enrollments":"education.enrollments.manage",
  "analytics.read":"analytics.view","analytics.export":"analytics.view",
  "api_keys.read":"api_keys.view","audit.read":"audit.view",
};
const WORKSPACE_PERMISSION_NAMES = new Set([
  "workspace.view","workspace.update","workspace.archive","workspace.restore",
  "workspace.export","workspace.delete","members.view","members.manage","members.invite",
  "members.roles.assign","roles.manage","teams.manage","agents.view","agents.create",
  "agents.update","agents.test","agents.deploy","agents.delete","knowledge.view",
  "knowledge.manage","knowledge.upload","knowledge.approve","knowledge.reindex",
  "knowledge.delete","knowledge.export","conversations.view","conversations.reply",
  "conversations.resolve","conversations.assign","conversations.export","conversations.delete",
  "leads.view","leads.update","leads.export","integrations.view","integrations.manage",
  "crm.view","crm.manage","crm.connections.manage","crm.mapping.manage","crm.deliveries.retry",
  "channels.view","channels.manage","channels.connections.manage","analytics.view",
  "education.view","education.manage","education.courses.manage","education.students.view",
  "education.students.manage","education.enrollments.manage","education.recovery.manage",
  "settings.view","settings.manage","branding.view","branding.edit","branding.publish",
  "branding.domain.manage","audit.view","audit.export","api_keys.view","api_keys.manage",
  "api_keys.create","api_keys.rotate","api_keys.revoke","starter_content.read","playground.use",
]);
export const WORKSPACE_PERMISSIONS = new Set([...WORKSPACE_PERMISSION_NAMES, ...Object.keys(PERMISSION_ALIASES)]);
const READ = new Set([
  "workspace.view","agents.view","knowledge.view","conversations.view","leads.view",
  "analytics.view","education.view","starter_content.read",
]);
const union = (...sets: ReadonlySet<string>[]): Set<string> => new Set(sets.flatMap(x => [...x]));
const subtract = (set: ReadonlySet<string>, ...entries: string[]): Set<string> => new Set([...set].filter(x => !entries.includes(x)));
export const WORKSPACE_GRANTS: Readonly<Record<string, ReadonlySet<string>>> = {
  workspace_admin: WORKSPACE_PERMISSIONS,
  manager: union(READ,new Set([
    "members.view","agents.create","agents.update","agents.test","agents.deploy",
    "knowledge.manage","conversations.reply","conversations.resolve","conversations.assign",
    "leads.update","leads.export","integrations.view","crm.view","education.manage",
    "settings.view","branding.view","playground.use",
  ])),
  operator: union(subtract(READ,"analytics.view"),new Set([
    "conversations.reply","conversations.resolve","conversations.assign","leads.update",
  ])),
  analyst: union(READ,new Set(["leads.export","integrations.view","crm.view"])),
  viewer: READ,
};
export const ORGANIZATION_GRANTS: Readonly<Record<string, ReadonlySet<string>>> = {
  owner: ORGANIZATION_PERMISSIONS,
  admin: subtract(ORGANIZATION_PERMISSIONS,"organization.ownership.transfer"),
  billing_admin: new Set(["organization.view","billing.view","billing.manage","usage.view"]),
  security_admin: new Set(["organization.view","security.view","security.manage","organization.audit.view"]),
  member: new Set(["organization.view"]),
  analyst: new Set(["organization.view"]),
};
export function effectivePermissions(organizationRole: string, workspaceRole?: string | null): Set<string> {
  return union(ORGANIZATION_GRANTS[organizationRole] ?? new Set(),WORKSPACE_GRANTS[workspaceRole ?? ""] ?? new Set());
}
function grantContains(grants: ReadonlySet<string>,canonical: string): boolean {
  if (grants.has(canonical)) return true;
  return Object.entries(PERMISSION_ALIASES).some(([alias,target]) => target===canonical && grants.has(alias));
}
export function permits(permission: string, organizationRole: string, grants: ReadonlySet<string>, hasWorkspace: boolean): boolean {
  const canonical = PERMISSION_ALIASES[permission] ?? permission;
  if (ORGANIZATION_PERMISSIONS.has(canonical)) {
    return grantContains(grants,canonical) && (ORGANIZATION_GRANTS[organizationRole]?.has(canonical) ?? false);
  }
  return hasWorkspace && WORKSPACE_PERMISSION_NAMES.has(canonical) && grantContains(grants,canonical);
}
export function validateDelegatedPermissions(requested: readonly string[], actorGrants: ReadonlySet<string>): Set<string> {
  const selected = new Set(requested);
  if (!selected.size || [...selected].some(p => !WORKSPACE_PERMISSIONS.has(p))) {
    throw new Error("Select known workspace permissions only");
  }
  if ([...selected].some(p => !grantContains(actorGrants,PERMISSION_ALIASES[p] ?? p))) {
    throw new Error("Cannot delegate a permission you do not hold");
  }
  return selected;
}
