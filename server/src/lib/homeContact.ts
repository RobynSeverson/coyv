export const CONTACT_TYPES = ['other', 'spotify', 'email', 'phone'] as const
export type ContactType = typeof CONTACT_TYPES[number]

export function contactDestination(type: ContactType, input: string): string | null {
  const value = input.trim()
  if (type === 'email') {
    const address = value.replace(/^mailto:/i, '')
    return /^[^\s@<>?&#:%]+@[a-z\d.-]+\.[a-z]{2,}$/i.test(address) ? `mailto:${address}` : null
  }
  if (type === 'phone') {
    const number = value.replace(/^tel:/i, '').replace(/[ ().-]/g, '')
    return /^\+?\d{3,15}$/.test(number) ? `tel:${number}` : null
  }
  try {
    const url = new URL(value)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
    if (type === 'spotify' && (url.protocol !== 'https:' || url.hostname !== 'open.spotify.com'
      || !/^\/(?:intl-[a-z-]+\/)?(?:user|playlist|artist)\/[^/]+\/?$/.test(url.pathname)
      || url.username || url.password || url.port)) return null
    return value
  } catch {
    return null
  }
}
