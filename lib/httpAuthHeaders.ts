export function bearerAuthorization(token: string): string {
  return ['Bearer', token].join(' ');
}

