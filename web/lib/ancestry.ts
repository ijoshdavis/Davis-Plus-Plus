// Builds a deep link to a person's entry on Ancestry.com, given their
// ancestry_pid external id (e.g. "@I302788161327@" from person_external_id).
// Requires the tree's numeric id (from the tree's own Ancestry URL, not its
// display name) - persona/person_external_id only ever store the latter.
const TREE_ID = process.env.NEXT_PUBLIC_ANCESTRY_TREE_ID;

export function ancestryPersonUrl(pidValue: string): string | null {
  if (!TREE_ID) return null;
  const personId = pidValue.replace(/\D/g, "");
  if (!personId) return null;
  return `https://www.ancestry.com/family-tree/person/tree/${TREE_ID}/person/${personId}/facts`;
}
