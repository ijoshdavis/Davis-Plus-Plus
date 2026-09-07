// Mirrors rules/gedcom_helpers.py's accessors over the same
// structure_to_dict() shape stored in persona.raw - display-only here, no
// write path touches this shape.

type Node = {
  level: number;
  tag: string;
  xref?: string;
  payload?: string;
  children?: Node[];
};

export function findChild(node: Node, tag: string): Node | undefined {
  return node.children?.find((c) => c.tag === tag);
}

export function findChildren(node: Node, tag: string): Node[] {
  return node.children?.filter((c) => c.tag === tag) ?? [];
}

export function primaryName(raw: Node): { given?: string; surname?: string; display: string } {
  const name = findChild(raw, "NAME");
  if (!name) return { display: "(no name)" };
  const given = findChild(name, "GIVN")?.payload;
  const surname = findChild(name, "SURN")?.payload;
  const display = [given, surname].filter(Boolean).join(" ") || name.payload || "(no name)";
  return { given, surname, display };
}

export function sex(raw: Node): string | undefined {
  return findChild(raw, "SEX")?.payload;
}

const YEAR_RE = /(1[4-9]\d{2}|20\d{2})/;

function eventYear(raw: Node, tag: string): number | undefined {
  const event = findChild(raw, tag);
  const date = event ? findChild(event, "DATE")?.payload : undefined;
  const match = date?.match(YEAR_RE);
  return match ? parseInt(match[1], 10) : undefined;
}

export function birthYear(raw: Node): number | undefined {
  return eventYear(raw, "BIRT");
}

export function deathYear(raw: Node): number | undefined {
  return eventYear(raw, "DEAT");
}
