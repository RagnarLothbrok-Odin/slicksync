const test = require('node:test')
const assert = require('node:assert/strict')
const { sameTitle, pairMatches, titleCore } = require('../server/utils/titleMatch')

test('sameTitle: a sequel is not its original', () => {
  assert.equal(sameTitle('Dune Part Two (2024)', 'Dune'), false)
  assert.equal(sameTitle('Toy Story 2', 'Toy Story'), false)
  assert.equal(sameTitle('Fall 2 (2025)', 'Fall'), false)
  assert.equal(sameTitle('Us', 'The Usual Suspects'), false)
})

test('sameTitle: the same title under different punctuation, case and year', () => {
  assert.equal(sameTitle('Dune: Part Two', 'Dune Part Two (2024)'), true)
  assert.equal(sameTitle('the rock', 'The Rock (1996)'), true)
  assert.equal(sameTitle('Eastbound & Down', 'Eastbound Down'), true)
})

test('sameTitle: an episode name is its show', () => {
  assert.equal(sameTitle('Man on Fire S01E01', 'Man on Fire'), true)
  assert.equal(sameTitle('Man on Fire S01E01 Pilot', 'Man on Fire'), true)
  assert.equal(sameTitle('Show 2x05', 'Show'), true)
  assert.equal(titleCore('[Group] Some Show S02E03'), 'some show')
})

test('sameTitle: a bare trailing episode number counts for a series only', () => {
  assert.equal(sameTitle('[Group] Show - 05', 'Show', { series: true }), true)
  assert.equal(sameTitle('Show', '[Group] Show - 05', { series: true }), true)
  assert.equal(sameTitle('Toy Story 2', 'Toy Story', { series: false }), false)
})

test('sameTitle: nothing matches an empty name', () => {
  assert.equal(sameTitle('', 'Dune'), false)
  assert.equal(sameTitle(null, null), false)
})

test('pairMatches: IMDb ids decide when both sides have one', () => {
  // A remake shares the name and nothing else.
  assert.equal(pairMatches({ id: 'tt1396484', titles: ['It (2017)'] }, { id: 'tt0099864', name: 'It', type: 'movie' }), false)
  // Same id under a localized name.
  assert.equal(pairMatches({ id: 'tt0114709', titles: ['Toy Story - Il mondo dei giocattoli'] }, { id: 'tt0114709', name: 'Toy Story', type: 'movie' }), true)
})

test('pairMatches: falls back to the name when an id is missing or not an IMDb one', () => {
  assert.equal(pairMatches({ id: null, titles: ['Hercules (1997)'] }, { id: 'tt0119282', name: 'Hercules', type: 'movie' }), true)
  assert.equal(pairMatches({ id: 'tt0119282', titles: ['Hercules (1997)'] }, { id: 'tmdb:11970', name: 'Hercules', type: 'movie' }), true)
  assert.equal(pairMatches({ id: null, titles: ['Fall 2 (2025)'] }, { id: 'tt15325794', name: 'Fall', type: 'movie' }), false)
  assert.equal(pairMatches({ id: null, titles: ['[Grp] Show - 05', 'Show - 05'] }, { id: 'kitsu:1', name: 'Show', type: 'series' }), true)
  assert.equal(pairMatches(null, { name: 'x' }), false)
  assert.equal(pairMatches({ titles: ['x'] }, null), false)
})

test('sameTitle: a series release name that goes on past the show name still matches it', () => {
  const series = { series: true }
  const pairs = [
    ['[Group] Attack on Titan - 05v2 (1080p).mkv', 'Attack on Titan'],
    ['[Group] Attack on Titan - 05 [BD 1080p]', 'Attack on Titan'],
    ['[Group] Attack on Titan - 25 END (1080p)', 'Attack on Titan'],
    ['[Group] Attack on Titan - OVA 1', 'Attack on Titan'],
    ['Band.of.Brothers.Part.3.1080p', 'Band of Brothers'],
    ['The.Last.Dance.Part.1', 'The Last Dance'],
    ['Doctor.Who.Christmas.Special.2023', 'Doctor Who'],
    ['Chernobyl Complete Miniseries', 'Chernobyl'],
    // A short show name only accepts episode wording after it.
    ['Dune 05v2 BD', 'Dune'],
    ['Dune Part 2', 'Dune'],
    ['Bleach OVA 1', 'Bleach'],
  ]
  for (const [stream, library] of pairs) {
    assert.equal(sameTitle(stream, library, series), true, `${stream} -> ${library}`)
    assert.equal(sameTitle(library, stream, series), true, `${library} -> ${stream}`)
  }
})

test('sameTitle: a short series name is not the start of another show', () => {
  const series = { series: true }
  for (const [a, b] of [['NCIS Los Angeles', 'NCIS'], ['Dune Prophecy', 'Dune'], ['Dune Part Two', 'Dune'], ['Star Trek Discovery', 'Dune']]) {
    assert.equal(sameTitle(a, b, series), false, `${a} / ${b}`)
    assert.equal(sameTitle(b, a, series), false, `${b} / ${a}`)
  }
})

test('sameTitle: a film never matches on starts-with, whatever its length', () => {
  assert.equal(sameTitle('Band of Brothers Part 3', 'Band of Brothers'), false)
  assert.equal(sameTitle('Attack on Titan 05v2', 'Attack on Titan'), false)
})

test('sameTitle: the other ways a release names an episode of a series', () => {
  const series = { series: true }
  for (const name of ['Show Name Ep05', '[Group] Show Name - Episode 05', '[SubsPlease] Show Name S2 - 05', 'Show Name 2nd Season - 05', 'Show Name 2024-05-12', 'Show Name 12.05.2024', 'Show Name 1090']) {
    assert.equal(sameTitle(name, 'Show Name', series), true, name)
  }
})

test('sameTitle: a country or a year after a series name is ignored', () => {
  const series = { series: true }
  assert.equal(sameTitle('Shameless US S01E01', 'Shameless', series), true)
  assert.equal(sameTitle('The Office US S02E01', 'The Office (2005)', series), true)
  // A show whose whole name is a year or a number is still itself.
  assert.equal(sameTitle('1923 S01E01', '1923', series), true)
  assert.equal(sameTitle('9-1-1 S01E01', '9-1-1', series), true)
  // A different show, not a country.
  assert.equal(sameTitle('Suits LA S01E01', 'Suits', series), false)
  // None of this applies to a film.
  assert.equal(sameTitle('Show Name US', 'Show Name'), false)
})

test('sameTitle: a film under an edition name is the film; anything else after the name is another film', () => {
  assert.equal(sameTitle('Blade Runner The Final Cut (2007)', 'Blade Runner'), true)
  assert.equal(sameTitle('Movie Title Extended Cut (2019)', 'Movie Title'), true)
  assert.equal(sameTitle('Apocalypse Now Redux', 'Apocalypse Now'), true)
  assert.equal(sameTitle('The Matrix Reloaded', 'The Matrix'), false)
  assert.equal(sameTitle('Alien Resurrection', 'Alien'), false)
  assert.equal(sameTitle('Kill Bill The Whole Bloody Affair', 'Kill Bill'), false)
})

test('sameTitle: a title that is only a bracket group is still a title', () => {
  assert.equal(sameTitle('[REC] (2007)', 'REC'), true)
  assert.equal(sameTitle('[REC]', '[REC]'), true)
})
