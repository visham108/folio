import { describe, expect, it } from 'vitest'
import { nameCase, titleCase } from '../../src/lib/titleCase'

describe('titleCase', () => {
  it.each([
    ['the left hand of darkness', 'The Left Hand of Darkness'],
    ['THE LORD OF THE RINGS', 'The Lord of the Rings'],
    ["harry potter and the philosopher's stone", "Harry Potter and the Philosopher's Stone"],
    ['sapiens: a brief history of humankind', 'Sapiens: A Brief History of Humankind'],
    ['the three-body problem', 'The Three-Body Problem'],
    ['a history of NASA', 'A History of NASA'],
    ['the iPhone years', 'The iPhone Years'],
    ['world war ii', 'World War II'],
    ['what are you looking at', 'What Are You Looking At'],
    ['  dune   messiah ', 'Dune Messiah'],
  ])('%s → %s', (input, want) => expect(titleCase(input)).toBe(want))
})

describe('nameCase', () => {
  it.each([
    ['j.r.r. tolkien', 'J.R.R. Tolkien'],
    ['ursula k. le guin', 'Ursula K. Le Guin'],
    ['cormac mccarthy', 'Cormac McCarthy'],
    ["tim o'brien", "Tim O'Brien"],
    ['ludwig van beethoven', 'Ludwig van Beethoven'],
    ['Don DeLillo', 'Don DeLillo'],
    ['gabriel garcía márquez', 'Gabriel García Márquez'],
    ['r. f. kuang', 'R. F. Kuang'],
  ])('%s → %s', (input, want) => expect(nameCase(input)).toBe(want))
})
