import { describe, expect, it } from 'vitest'
import { fullCsv, goodreadsCsv } from '../../src/lib/exporter'
import { buildImport, guessColumns, guessValues, parseTable } from '../../src/lib/importer'
import { sampleLibrary } from '../../src/lib/sample'

const lib = sampleLibrary() as Required<ReturnType<typeof sampleLibrary>>

describe('Goodreads export', () => {
  const csv = goodreadsCsv(lib)
  it('round-trips through the importer', () => {
    const { headers, rows } = parseTable(csv)
    expect(headers[0]).toBe('Book Id')
    expect(rows).toHaveLength(lib.entries.length)
    const cols = guessColumns(headers, rows)
    const plan = buildImport(rows, cols, guessValues(rows, cols), { works: [], editions: [], entries: [], shelves: [] })
    expect(plan.data.entries).toHaveLength(lib.entries.length)
    const dune = plan.data.works.find((w) => w.title === 'Dune')!
    expect(dune.series).toBe('Dune')
    const duneEntry = plan.data.entries.find((e) => e.workId === dune.id)!
    const original = lib.entries.find((e) => lib.works.find((w) => w.id === e.workId)?.title === 'Dune')!
    expect(duneEntry.status).toBe(original.status === 'paused' ? 'paused' : original.status)
    const finishedBefore = lib.reads.filter((r) => r.entryId === original.id && r.state === 'finished').length
    expect(plan.data.reads.filter((r) => r.entryId === duneEntry.id && r.state === 'finished')).toHaveLength(finishedBefore)
  })
})

describe('full CSV', () => {
  it('has one row per read plus books never started', () => {
    const { rows } = parseTable(fullCsv(lib))
    const started = new Set(lib.reads.map((r) => r.entryId))
    expect(rows).toHaveLength(lib.reads.length + lib.entries.filter((e) => !started.has(e.id)).length)
  })
})
