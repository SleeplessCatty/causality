declare const relationCaseKeyBrand: unique symbol;

export type RelationCaseKey = string & { readonly [relationCaseKeyBrand]: true };

export function relationCaseKey(
  relationIdentifier: string,
  caseIdentifier: string,
): RelationCaseKey {
  return `${relationIdentifier}\u0000${caseIdentifier}` as RelationCaseKey;
}
