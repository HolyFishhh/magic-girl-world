export interface StatusProfessionView {
  name: string;
  ability: string;
}

export function readStatusLocation(status: any): string {
  const location = status?.location;
  return typeof location === 'string' ? location : '';
}

export function readStatusProfession(status: any): StatusProfessionView {
  const profession = status?.profession;
  if (profession && typeof profession === 'object') {
    return {
      name: typeof profession.name === 'string' ? profession.name : '',
      ability: typeof profession.ability === 'string' ? profession.ability : '',
    };
  }

  return { name: '', ability: '' };
}
