/**
 * Who a person is, for the top of their page in Discover: what they do, when
 * and where they were born, and two or three sentences about them - cut from
 * TMDb's person record, once, here.
 */

// TMDb's departments, as the work a person does.
const DEPARTMENT_WORK = {
  Acting: 'Acting', Directing: 'Directing', Writing: 'Writing', Production: 'Producing',
  Sound: 'Music', Camera: 'Cinematography', Editing: 'Editing', Creator: 'Creating',
  Art: 'Art direction', 'Costume & Make-Up': 'Costume and make-up', 'Visual Effects': 'Visual effects',
  Lighting: 'Lighting', Crew: 'Crew',
}

// A bracket worth dropping from a biography: a pronunciation (/.../ or IPA),
// a "born"/"née", a semicolon, or another script. "Top Gun (1986)" stays.
// The range is "anything outside Latin and its punctuation", so it starts at the first code point.
// eslint-disable-next-line no-control-regex
const BIO_ASIDE = /\/[^/]+\/|\bborn\b|\bn[ée]e\b|;|[^\u0000-ɏḀ-ỿ‐-‟]/i

/**
 * The first sentences of a biography, up to about three hundred letters.
 * The first paragraph, carried into the next when it is one short line
 * ("X is an American actress.") - TMDb's later ones are career detail, and a
 * "From Wikipedia" credit is dropped. Wikipedia's opening aside
 * ("(/ˈmeɪ̯pɒθər/; born July 3, 1962)") goes, since the facts beside it
 * already say that. A sentence ends at a stop followed by a space and a
 * capital, so "$15.4 billion" stays one sentence.
 */
function shortBiography(text) {
  const paragraphs = String(text || '').split(/\n\s*\n/).map((p) => p.trim()).filter((p) => p && !/wikipedia/i.test(p))
  let lead = paragraphs[0] || ''
  for (let i = 1; lead.length < 160 && i < paragraphs.length; i++) lead += ' ' + paragraphs[i]
  const first = lead
    .replace(/\s*\(([^()]*)\)/g, (bracket, inner) => (BIO_ASIDE.test(inner) ? '' : bracket))
    .replace(/\[\d+\]/g, '')
    .replace(/\s+/g, ' ')
    .replace(/\s+([,.;:])/g, '$1')
    .trim()
  if (!first) return null
  const sentences = first.split(/(?<=[.!?])\s+(?=[A-Z"'(])/)
  let out = ''
  for (const sentence of sentences) {
    const next = (out ? out + ' ' : '') + sentence.trim()
    if (out && (next.length > 300 || out.split(/[.!?]\s/).length >= 3)) break
    out = next
  }
  if (out.length > 340) out = out.slice(0, 330).replace(/\s+\S*$/, '') + '…'
  return out
}

/** The facts on a person's card, from TMDb's /person/{id}?append_to_response=combined_credits. */
function personFacts(data) {
  if (!data) return {}
  const counts = {}
  for (const c of data.combined_credits?.crew || []) counts[c.department] = (counts[c.department] || 0) + 1
  counts.Acting = (data.combined_credits?.cast || []).length
  const primary = data.known_for_department || null
  const others = Object.entries(counts)
    .filter(([dep, n]) => dep !== primary && n >= 3 && DEPARTMENT_WORK[dep])
    .sort((a, b) => b[1] - a[1])
    .map(([dep]) => dep)
  const knownFor = [primary, ...others].filter((d) => d && DEPARTMENT_WORK[d]).slice(0, 2).map((d) => DEPARTMENT_WORK[d])
  return {
    knownFor,
    birthday: /^\d{4}-\d{2}-\d{2}$/.test(data.birthday || '') ? data.birthday : null,
    deathday: /^\d{4}-\d{2}-\d{2}$/.test(data.deathday || '') ? data.deathday : null,
    placeOfBirth: data.place_of_birth || null,
    bio: shortBiography(data.biography),
  }
}

module.exports = { personFacts, shortBiography }
