export type ProfileId = 'daniel' | 'larissa';
export const PROFILES = [
  { id: 'daniel', name: 'Daniel', piece: '♞', color: 'emerald' },
  { id: 'larissa', name: 'Larissa', piece: '♛', color: 'rose' },
] as const;
export function profileName(profile: ProfileId) { return PROFILES.find(item => item.id === profile)!.name; }
